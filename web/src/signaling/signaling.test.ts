import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { openEnvelope, seal } from '../crypto/envelope';
import { loadOrCreateIdentity, verifySignature, type Identity } from '../crypto/identity';
import { deriveRoom } from '../crypto/room-keys';
import { randomBase64url } from '../util/base64url';
import { Signaling, type DroneLike, type RoomLike } from './signaling';
import type { Payload } from './types';

type Cb = (...a: any[]) => void;

class Emitter {
  handlers = new Map<string, Cb[]>();
  on(ev: string, cb: Cb) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), cb]);
  }
  emit(ev: string, ...a: unknown[]) {
    for (const cb of this.handlers.get(ev) ?? []) cb(...a);
  }
}

class FakeRoom extends Emitter implements RoomLike {}

class FakeDrone extends Emitter implements DroneLike {
  clientId: string | null = 'c-self';
  room = new FakeRoom();
  subscribed: string[] = [];
  published: { room: string; message: any; no_echo?: boolean }[] = [];
  closed = false;
  subscribe(room: string) {
    this.subscribed.push(room);
    return this.room;
  }
  publish(m: { room: string; message: unknown; no_echo?: boolean }) {
    this.published.push(m as any);
  }
  close() {
    this.closed = true;
  }
}

const NOW = 1_763_740_000_000;
const SECRET = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const memory = () => loadOrCreateIdentity({ load: async () => undefined, save: async () => {} });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let roomKey: CryptoKey;
let otherKey: CryptoKey;
let A: Identity;
let B: Identity;
let C: Identity;
const cidOf = new Map<Identity, string>();

beforeAll(async () => {
  roomKey = (await deriveRoom(SECRET)).roomKey;
  otherKey = (await deriveRoom('B' + SECRET.slice(1))).roomKey;
  [A, B, C] = await Promise.all([memory(), memory(), memory()]);
  cidOf.set(B, 'c-b').set(C, 'c-c');
});

let drone: FakeDrone;
let sig: Signaling;
let got: Payload[];

function makeSignaling(identity: Identity = A) {
  drone = new FakeDrone();
  sig = new Signaling({ drone, roomId: 'r1', roomKey, identity, now: () => NOW });
  got = [];
  sig.onMessage((p) => got.push(p));
}

beforeEach(() => makeSignaling());

interface BuildOpts {
  clientId?: string;
  sigFrom?: Identity;
  tamper?: (p: string) => string;
  key?: CryptoKey;
  inner?: string;
}

/** Baut einen Umschlag, wie ihn `from` senden würde; Felder in `p` überschreiben die Vorgaben. */
async function build(from: Identity, p: Partial<Payload> = {}, o: BuildOpts = {}) {
  const kind = p.kind ?? 'hello';
  const body = kind === 'hello' ? { pub: from.pub, sid: 'S', name: 'Name', caps: [] } : { sdp: 'v=0\r\na=fingerprint:sha-256 11:22\r\n' };
  const full = { kind, from: from.peerId, to: '*', cid: cidOf.get(from)!, ts: NOW, nonce: randomBase64url(16), body, ...p };
  const pStr = JSON.stringify(full);
  const signed = await (o.sigFrom ?? from).sign(pStr);
  const inner = o.inner ?? JSON.stringify({ p: o.tamper ? o.tamper(pStr) : pStr, sig: signed });
  return { env: await seal(o.key ?? roomKey, inner), clientId: o.clientId ?? full.cid };
}

function deliver(b: { env: unknown; clientId: string }) {
  drone.room.emit('message', b.env, { client_id: b.clientId, room: 'r1' });
}

async function incoming(from: Identity, p: Partial<Payload> = {}, o: BuildOpts = {}) {
  deliver(await build(from, p, o));
  await sig.idle();
}

async function published(i: number) {
  const inner = JSON.parse((await openEnvelope(roomKey, drone.published[i].message))!);
  return { payload: JSON.parse(inner.p) as Payload, p: inner.p as string, sig: inner.sig as string };
}

const rejected = () => Object.fromEntries(Object.entries(sig.stats().rejected).filter(([, n]) => n > 0));

describe('senden', () => {
  beforeEach(() => drone.room.emit('members', ['c-self']));

  test('abonniert den Raum', () => {
    expect(drone.subscribed).toEqual(['r1']);
  });

  test('send versiegelt: room_ws sieht nur v, iv, ct', async () => {
    sig.send('hello', '*', { pub: A.pub, sid: 'S', name: 'Anna', caps: [] });
    await sig.idle();
    expect(drone.published).toHaveLength(1);
    const m = drone.published[0];
    expect(m.room).toBe('r1');
    expect(m.no_echo).toBe(true);
    expect(Object.keys(m.message).sort()).toEqual(['ct', 'iv', 'v']);
    expect(JSON.stringify(m.message)).not.toMatch(/Anna|hello/);
  });

  test('Gegenprobe: entschlüsselbar, Signatur passt, Nutzlast korrekt', async () => {
    sig.send('hello', '*', { pub: A.pub, sid: 'S', name: 'Anna', caps: [] });
    await sig.idle();
    const { payload, p, sig: s } = await published(0);
    expect(await verifySignature(A.pub, s, p)).toBe(true);
    expect(payload).toMatchObject({ kind: 'hello', from: A.peerId, to: '*', cid: 'c-self', ts: NOW });
    expect(payload.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  test('Reihenfolge beim Senden bleibt erhalten, auch wenn die erste Signatur dauert', async () => {
    let first = true;
    makeSignaling({ ...A, sign: async (d) => ((first ? ((first = false), await sleep(30)) : 0), A.sign(d)) });
    drone.room.emit('members', ['c-self']);
    sig.send('hello', '*', { pub: A.pub, sid: 'S', name: 'Anna', caps: [] });
    sig.send('offer', B.peerId, { sdp: 'x' });
    sig.send('ice', B.peerId, { c: [] });
    await sig.idle();
    const kinds = await Promise.all([0, 1, 2].map(async (i) => (await published(i)).payload.kind));
    expect(kinds).toEqual(['hello', 'offer', 'ice']);
  });

  test('hält Nachrichten während eines Ausfalls bis zum nächsten members zurück und setzt die neue cid', async () => {
    drone.emit('close');
    sig.send('offer', B.peerId, { sdp: 'x' });
    await sleep(10);
    expect(drone.published).toHaveLength(0);
    drone.clientId = 'c-new';
    drone.emit('open');
    drone.room.emit('members', ['c-new']);
    await sig.idle();
    expect(drone.published).toHaveLength(1);
    expect((await published(0)).payload.cid).toBe('c-new');
  });
});

describe('empfangen', () => {
  test('gültiges hello wird zugestellt', async () => {
    await incoming(B);
    expect(got.map((p) => p.kind)).toEqual(['hello']);
    expect(sig.stats().accepted).toBe(1);
    expect(rejected()).toEqual({});
  });

  test('offer nach hello wird zugestellt', async () => {
    await incoming(B);
    await incoming(B, { kind: 'offer', to: A.peerId });
    expect(got.map((p) => p.kind)).toEqual(['hello', 'offer']);
  });

  test('Reihenfolge beim Empfangen: hello und offer im selben Takt', async () => {
    const h = await build(B);
    const o = await build(B, { kind: 'offer', to: A.peerId });
    deliver(h);
    deliver(o);
    await sig.idle();
    expect(got.map((p) => p.kind)).toEqual(['hello', 'offer']);
  });

  test('offer ohne vorheriges hello: unbekannter Schlüssel', async () => {
    await incoming(C, { kind: 'offer', to: A.peerId });
    expect(got).toHaveLength(0);
    expect(rejected()).toEqual({ 'unknown-key': 1 });
  });

  test('gefälschtes offer im Namen von B wird abgewiesen', async () => {
    await incoming(B);
    await incoming(C);
    await incoming(C, { kind: 'offer', from: B.peerId, to: A.peerId });
    expect(got.map((p) => p.from)).toEqual([B.peerId, C.peerId]);
    expect(rejected()).toEqual({ signature: 1 });
  });

  test('manipulierter Fingerprint mit Originalsignatur wird abgewiesen', async () => {
    await incoming(B);
    await incoming(B, { kind: 'offer', to: A.peerId }, { tamper: (p) => p.replace('11:22', 'AA:BB') });
    expect(got.map((p) => p.kind)).toEqual(['hello']);
    expect(rejected()).toEqual({ signature: 1 });
  });

  test('hello mit fremder peerId wird abgewiesen und der Schlüssel nicht gemerkt', async () => {
    await incoming(C, { from: B.peerId, body: { pub: C.pub, sid: 'S', name: 'Bea', caps: [] } });
    expect(rejected()).toEqual({ identity: 1 });
    await incoming(B, { kind: 'offer', to: A.peerId });
    expect(got).toHaveLength(0);
    expect(rejected()).toEqual({ identity: 1, 'unknown-key': 1 });
  });

  test('falscher Raumschlüssel', async () => {
    await incoming(B, {}, { key: otherKey });
    expect(rejected()).toEqual({ decrypt: 1 });
  });

  test.each([null, 'x', 42, {}, { v: 0, p: { from: 'B' } }, { v: 1, iv: 'AAAA', ct: 'AAAA' }])(
    'kaputter Umschlag ohne Wurf: %j',
    async (msg) => {
      expect(() => deliver({ env: msg, clientId: 'c-b' })).not.toThrow();
      await sig.idle();
      expect(got).toHaveLength(0);
      expect(rejected()).toEqual({ decrypt: 1 });
    },
  );

  test.each(['kein json', '{"p":"{}"}', '{"p":42,"sig":"x"}', '{"p":"{\\"kind\\":\\"hello\\"}","sig":"x"}'])(
    'gültiger Umschlag mit kaputtem Inhalt: %j',
    async (inner) => {
      await incoming(B, {}, { inner });
      expect(rejected()).toEqual({ malformed: 1 });
    },
  );

  test('Nachricht an jemand anderen', async () => {
    await incoming(B, { to: C.peerId });
    expect(rejected()).toEqual({ to: 1 });
  });

  test('Zeitfenster ±120 s', async () => {
    await incoming(B, { ts: NOW - 121_000 });
    await incoming(B, { ts: NOW + 121_000 });
    expect(rejected()).toEqual({ replay: 2 });
    await incoming(B, { ts: NOW - 119_000 });
    await incoming(B, { ts: NOW + 119_000 });
    expect(got).toHaveLength(2);
  });

  test('wiederholte nonce', async () => {
    await incoming(B, { nonce: 'n1' });
    await incoming(B, { nonce: 'n1' });
    expect(got).toHaveLength(1);
    expect(rejected()).toEqual({ replay: 1 });
  });

  test('cid passt nicht zum room_ws-Absender', async () => {
    await incoming(B, {}, { clientId: 'c-evil' });
    expect(rejected()).toEqual({ cid: 1 });
  });

  test('Nonce-Cache vergisst nach 240 s', async () => {
    let now = NOW;
    drone = new FakeDrone();
    sig = new Signaling({ drone, roomId: 'r1', roomKey, identity: A, now: () => now });
    got = [];
    sig.onMessage((p) => got.push(p));
    await incoming(B, { nonce: 'n1', ts: NOW });
    now = NOW + 241_000;
    await incoming(B, { nonce: 'n1', ts: now });
    expect(got).toHaveLength(2);
  });
});

describe('Präsenz', () => {
  test('members meldet ready mit eigener cid, auch nach Reconnect', () => {
    const ready: string[] = [];
    sig.onReady((c) => ready.push(c));
    drone.room.emit('members', ['c-self']);
    drone.clientId = 'c-self2';
    drone.room.emit('members', ['c-self2', 'c-b']);
    expect(ready).toEqual(['c-self', 'c-self2']);
  });
  test('member_leave meldet leave', () => {
    const left: string[] = [];
    sig.onLeave((c) => left.push(c));
    drone.room.emit('member_leave', 'c9');
    expect(left).toEqual(['c9']);
  });
  test('close schließt die Verbindung', async () => {
    await sig.close();
    expect(drone.closed).toBe(true);
  });
  test('close veröffentlicht vorher noch, was eingereiht ist (bye)', async () => {
    drone.room.emit('members', ['c-self']);
    sig.send('bye', '*', {});
    await sig.close();
    expect(drone.published).toHaveLength(1);
    expect((await published(0)).payload.kind).toBe('bye');
    expect(drone.closed).toBe(true);
  });
  test('close hängt nicht, wenn das Signaling gerade getrennt ist', async () => {
    sig.send('bye', '*', {});
    const t0 = Date.now();
    await sig.close();
    expect(drone.closed).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
