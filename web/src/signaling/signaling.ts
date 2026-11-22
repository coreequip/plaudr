import { openEnvelope, seal } from '../crypto/envelope';
import { peerIdFor, verifySignature, type Identity } from '../crypto/identity';
import { fromBase64url, randomBase64url } from '../util/base64url';
import type { Bodies, Kind, Payload } from './types';

export interface DroneLike {
  clientId: string | null;
  subscribe(room: string): RoomLike;
  publish(m: { room: string; message: unknown; no_echo?: boolean }): void;
  on(ev: 'open' | 'close', cb: () => void): void;
  close(): void;
}

export interface RoomLike {
  on(ev: string, cb: (...a: any[]) => void): void;
}

export type RejectReason = 'malformed' | 'decrypt' | 'to' | 'identity' | 'unknown-key' | 'signature' | 'replay' | 'cid';

export interface SignalingStats {
  accepted: number;
  rejected: Record<RejectReason, number>;
}

export interface SignalingOptions {
  drone: DroneLike;
  roomId: string;
  roomKey: CryptoKey;
  identity: Identity;
  now?: () => number;
}

const MAX_SKEW_MS = 120_000;
const NONCE_TTL_MS = 2 * MAX_SKEW_MS;
const CLOSE_FLUSH_MS = 1000;
const KINDS: ReadonlySet<string> = new Set<Kind>(['hello', 'offer', 'answer', 'ice', 'bye']);

class Rejected {
  constructor(readonly reason: RejectReason) {}
}

/**
 * Verschlüsseltes, signiertes Signaling über room_ws (Spec §5). Senden und Empfangen laufen je über eine
 * serielle Warteschlange: Asynchrone Krypto darf die Reihenfolge (hello vor offer vor ice) nicht ändern.
 */
export class Signaling {
  private readonly o: Required<SignalingOptions>;
  private readonly seen = new Map<string, number>();
  private readonly keys = new Map<string, string>();
  private readonly counts: SignalingStats = {
    accepted: 0,
    rejected: { malformed: 0, decrypt: 0, to: 0, identity: 0, 'unknown-key': 0, signature: 0, replay: 0, cid: 0 },
  };
  private sendQueue: Promise<void> = Promise.resolve();
  private recvQueue: Promise<void> = Promise.resolve();
  private connected = false;
  private waiters: (() => void)[] = [];
  private readyCbs: ((cid: string) => void)[] = [];
  private messageCbs: ((p: Payload) => void)[] = [];
  private leaveCbs: ((cid: string) => void)[] = [];

  constructor(o: SignalingOptions) {
    this.o = { now: Date.now, ...o };
    const room = o.drone.subscribe(o.roomId);
    // Bis zum nächsten members ist die cid unbekannt oder veraltet: so lange wird nichts veröffentlicht.
    o.drone.on('close', () => (this.connected = false));
    room.on('members', () => {
      const cid = o.drone.clientId;
      if (!cid) return;
      this.connected = true;
      for (const w of this.waiters.splice(0)) w();
      for (const cb of this.readyCbs) cb(cid);
    });
    room.on('member_leave', (cid: string) => {
      for (const cb of this.leaveCbs) cb(cid);
    });
    room.on('message', (msg: unknown, meta: { client_id?: string } | undefined) => {
      this.recvQueue = this.recvQueue.then(() => this.receive(msg, meta?.client_id));
    });
  }

  send<K extends Kind>(kind: K, to: string, body: Bodies[K]): void {
    this.sendQueue = this.sendQueue.then(() =>
      this.publishOne(kind, to, body).catch((err) => console.warn('[plaudr] Senden fehlgeschlagen', err)),
    );
  }

  onReady(cb: (cid: string) => void): void {
    this.readyCbs.push(cb);
  }
  onMessage(cb: (p: Payload) => void): void {
    this.messageCbs.push(cb);
  }
  onLeave(cb: (cid: string) => void): void {
    this.leaveCbs.push(cb);
  }

  stats(): SignalingStats {
    return { accepted: this.counts.accepted, rejected: { ...this.counts.rejected } };
  }

  /** Löst auf, sobald alles bis jetzt Eingereihte gesendet bzw. geprüft ist. */
  async idle(): Promise<void> {
    await Promise.all([this.sendQueue, this.recvQueue]);
  }

  /** Veröffentlicht noch Eingereihtes (etwa das bye), höchstens CLOSE_FLUSH_MS lang, und trennt dann. */
  async close(): Promise<void> {
    await Promise.race([this.sendQueue, new Promise((r) => setTimeout(r, CLOSE_FLUSH_MS))]);
    this.o.drone.close();
  }

  private async publishOne<K extends Kind>(kind: K, to: string, body: Bodies[K]): Promise<void> {
    if (!this.connected) await new Promise<void>((r) => this.waiters.push(r));
    const payload: Payload<K> = {
      kind, from: this.o.identity.peerId, to, cid: this.o.drone.clientId ?? '', ts: this.o.now(), nonce: randomBase64url(16), body,
    };
    const p = JSON.stringify(payload);
    const sig = await this.o.identity.sign(p);
    const message = await seal(this.o.roomKey, JSON.stringify({ p, sig }));
    this.o.drone.publish({ room: this.o.roomId, message, no_echo: true });
  }

  private async receive(msg: unknown, senderCid: string | undefined): Promise<void> {
    try {
      const p = await this.verify(msg, senderCid);
      this.counts.accepted++;
      for (const cb of this.messageCbs) cb(p);
    } catch (err) {
      if (err instanceof Rejected) this.counts.rejected[err.reason]++;
      else console.warn('[plaudr] Nachricht nicht verarbeitbar', err);
    }
  }

  /** Prüfregeln aus Spec §5 in der dort festgelegten Reihenfolge. */
  private async verify(msg: unknown, senderCid: string | undefined): Promise<Payload> {
    const plain = await openEnvelope(this.o.roomKey, msg);
    if (plain === null) throw new Rejected('decrypt');
    const { pStr, sig, p } = parseInner(plain);

    if (p.to !== this.o.identity.peerId && p.to !== '*') throw new Rejected('to');

    let pub: string;
    if (p.kind === 'hello') {
      pub = (p.body as Bodies['hello']).pub;
      let derived: string;
      try {
        derived = await peerIdFor(fromBase64url(pub));
      } catch {
        throw new Rejected('identity');
      }
      if (derived !== p.from) throw new Rejected('identity');
    } else {
      const known = this.keys.get(p.from);
      if (!known) throw new Rejected('unknown-key');
      pub = known;
    }
    if (!(await verifySignature(pub, sig, pStr))) throw new Rejected('signature');

    const now = this.o.now();
    if (Math.abs(now - p.ts) > MAX_SKEW_MS) throw new Rejected('replay');
    this.pruneNonces(now);
    if (this.seen.has(p.nonce)) throw new Rejected('replay');

    if (!senderCid || p.cid !== senderCid) throw new Rejected('cid');

    this.seen.set(p.nonce, p.ts);
    if (p.kind === 'hello') this.keys.set(p.from, pub);
    return p;
  }

  private pruneNonces(now: number): void {
    for (const [n, ts] of this.seen) if (now - ts > NONCE_TTL_MS) this.seen.delete(n);
  }
}

function parseInner(plain: string): { pStr: string; sig: string; p: Payload } {
  let inner: unknown;
  let p: unknown;
  try {
    inner = JSON.parse(plain);
    const { p: pStr } = inner as { p?: unknown };
    if (typeof pStr !== 'string') throw 0;
    p = JSON.parse(pStr);
  } catch {
    throw new Rejected('malformed');
  }
  const { p: pStr, sig } = inner as { p: string; sig?: unknown };
  if (typeof sig !== 'string' || !isPayload(p)) throw new Rejected('malformed');
  return { pStr, sig, p };
}

function isPayload(x: unknown): x is Payload {
  if (typeof x !== 'object' || x === null) return false;
  const p = x as Record<string, unknown>;
  if (typeof p.kind !== 'string' || !KINDS.has(p.kind)) return false;
  for (const k of ['from', 'to', 'cid', 'nonce'] as const) if (typeof p[k] !== 'string') return false;
  if (typeof p.ts !== 'number' || typeof p.body !== 'object' || p.body === null) return false;
  if (p.kind === 'hello') {
    const b = p.body as Record<string, unknown>;
    if (typeof b.pub !== 'string' || typeof b.name !== 'string') return false;
  }
  return true;
}
