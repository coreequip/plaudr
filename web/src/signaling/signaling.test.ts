import { beforeEach, describe, expect, test } from 'vitest';
import { Signaling, type DroneLike, type RoomLike } from './signaling';
import type { Payload } from './types';

type Cb = (...a: any[]) => void;

class FakeRoom implements RoomLike {
  handlers = new Map<string, Cb[]>();
  on(ev: string, cb: Cb) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), cb]);
  }
  emit(ev: string, ...a: unknown[]) {
    for (const cb of this.handlers.get(ev) ?? []) cb(...a);
  }
}

class FakeDrone implements DroneLike {
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
let drone: FakeDrone;
let sig: Signaling;
let got: Payload[];

function incoming(p: Partial<Payload>, clientId = 'c-b') {
  const full: Payload = {
    kind: 'hello', from: 'B', to: '*', cid: 'c-b', ts: NOW, nonce: Math.random().toString(36), body: { name: 'B' },
    ...p,
  } as Payload;
  drone.room.emit('message', { v: 0, p: full }, { client_id: clientId, room: 'r1' });
}

beforeEach(() => {
  drone = new FakeDrone();
  sig = new Signaling({ drone, roomId: 'r1', selfId: 'A', now: () => NOW });
  got = [];
  sig.onMessage((p) => got.push(p));
});

describe('senden', () => {
  test('abonniert den Raum', () => {
    expect(drone.subscribed).toEqual(['r1']);
  });
  test('send publiziert einen Klartext-Umschlag ohne Echo', () => {
    sig.send('hello', '*', { name: 'A' });
    expect(drone.published).toHaveLength(1);
    const m = drone.published[0];
    expect(m.room).toBe('r1');
    expect(m.no_echo).toBe(true);
    expect(m.message.v).toBe(0);
    expect(m.message.p).toMatchObject({ kind: 'hello', from: 'A', to: '*', cid: 'c-self', ts: NOW, body: { name: 'A' } });
    expect(m.message.p.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe('empfangen', () => {
  test('nimmt Nachrichten an mich und an alle an', () => {
    incoming({ to: 'A' });
    incoming({ to: '*' });
    expect(got).toHaveLength(2);
  });
  test('verwirft Nachrichten an andere', () => {
    incoming({ to: 'C' });
    expect(got).toHaveLength(0);
  });
  test('verwirft, wenn cid nicht zum room_ws-Absender passt', () => {
    incoming({ cid: 'c-b' }, 'c-evil');
    expect(got).toHaveLength(0);
  });
  test('Zeitfenster ±120 s', () => {
    incoming({ ts: NOW - 121_000 });
    incoming({ ts: NOW + 121_000 });
    expect(got).toHaveLength(0);
    incoming({ ts: NOW - 119_000 });
    incoming({ ts: NOW + 119_000 });
    expect(got).toHaveLength(2);
  });
  test('verwirft eine wiederholte nonce', () => {
    incoming({ nonce: 'n1' });
    incoming({ nonce: 'n1' });
    expect(got).toHaveLength(1);
  });
  test.each([null, 'x', 42, {}, { v: 1, p: {} }, { v: 0 }, { v: 0, p: { from: 'B' } }])(
    'verwirft kaputte Umschläge ohne Wurf: %j',
    (msg) => {
      expect(() => drone.room.emit('message', msg, { client_id: 'c-b', room: 'r1' })).not.toThrow();
      expect(got).toHaveLength(0);
    },
  );
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
  test('close schließt die Verbindung', () => {
    sig.close();
    expect(drone.closed).toBe(true);
  });
});
