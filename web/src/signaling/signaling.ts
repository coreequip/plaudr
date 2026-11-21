import { randomBase64url } from '../util/base64url';
import type { Bodies, Kind, Payload } from './types';

export interface DroneLike {
  clientId: string | null;
  subscribe(room: string): RoomLike;
  publish(m: { room: string; message: unknown; no_echo?: boolean }): void;
  close(): void;
}

export interface RoomLike {
  on(ev: string, cb: (...a: any[]) => void): void;
}

const MAX_SKEW_MS = 120_000;
const NONCE_TTL_MS = 2 * MAX_SKEW_MS;
const KINDS: ReadonlySet<string> = new Set<Kind>(['hello', 'offer', 'answer', 'ice', 'bye']);

export class Signaling {
  private readonly drone: DroneLike;
  private readonly roomId: string;
  private readonly selfId: string;
  private readonly now: () => number;
  private readonly seen = new Map<string, number>();
  private readyCbs: ((cid: string) => void)[] = [];
  private messageCbs: ((p: Payload) => void)[] = [];
  private leaveCbs: ((cid: string) => void)[] = [];

  constructor(o: { drone: DroneLike; roomId: string; selfId: string; now?: () => number }) {
    this.drone = o.drone;
    this.roomId = o.roomId;
    this.selfId = o.selfId;
    this.now = o.now ?? Date.now;
    const room = this.drone.subscribe(this.roomId);
    room.on('members', () => {
      const cid = this.drone.clientId;
      if (cid) for (const cb of this.readyCbs) cb(cid);
    });
    room.on('member_leave', (cid: string) => {
      for (const cb of this.leaveCbs) cb(cid);
    });
    room.on('message', (msg: unknown, meta: { client_id?: string } | undefined) => this.receive(msg, meta?.client_id));
  }

  send<K extends Kind>(kind: K, to: string, body: Bodies[K]): void {
    const p: Payload<K> = {
      kind, from: this.selfId, to, cid: this.drone.clientId ?? '', ts: this.now(), nonce: randomBase64url(16), body,
    };
    this.drone.publish({ room: this.roomId, message: { v: 0, p }, no_echo: true });
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

  close(): void {
    this.drone.close();
  }

  private receive(msg: unknown, senderCid: string | undefined): void {
    const p = parse(msg);
    if (!p || !senderCid) return;
    if (p.to !== this.selfId && p.to !== '*') return;
    if (p.cid !== senderCid) return;
    const now = this.now();
    if (Math.abs(now - p.ts) > MAX_SKEW_MS) return;
    this.pruneNonces(now);
    if (this.seen.has(p.nonce)) return;
    this.seen.set(p.nonce, p.ts);
    for (const cb of this.messageCbs) cb(p);
  }

  private pruneNonces(now: number): void {
    for (const [n, ts] of this.seen) if (now - ts > NONCE_TTL_MS) this.seen.delete(n);
  }
}

function parse(msg: unknown): Payload | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const env = msg as { v?: unknown; p?: unknown };
  if (env.v !== 0 || typeof env.p !== 'object' || env.p === null) return null;
  const p = env.p as Record<string, unknown>;
  if (typeof p.kind !== 'string' || !KINDS.has(p.kind)) return null;
  for (const k of ['from', 'to', 'cid', 'nonce'] as const) if (typeof p[k] !== 'string') return null;
  if (typeof p.ts !== 'number' || typeof p.body !== 'object' || p.body === null) return null;
  return p as unknown as Payload;
}
