import { describe, expect, test } from 'vitest';
import { loadRooms, noteJoin, notePeers, relDay, removeRoom, renameRoom, roomSubtitle, roomTitle, saveRooms, type Rooms } from './rooms';

const A = 'a'.repeat(43);
const B = 'b'.repeat(43);
const NOW = new Date(2026, 10, 22, 12).getTime();
const day = (m: number, d: number, y = 2026) => new Date(y, m, d, 9).getTime();

function fakeStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  } as Storage;
}

describe('noteJoin', () => {
  test('noteJoin legt an und setzt firstJoined = lastJoined', () => {
    expect(noteJoin([], A, 100)).toEqual([{ secret: A, name: null, firstJoined: 100, lastJoined: 100, peers: [] }]);
  });
  test('noteJoin auf bekannten Raum zieht ihn nach vorn, firstJoined bleibt', () => {
    const r: Rooms = [
      { secret: A, name: null, firstJoined: 10, lastJoined: 20, peers: [] },
      { secret: B, name: 'B', firstJoined: 5, lastJoined: 8, peers: ['Anna'] },
    ];
    const n = noteJoin(r, B, 30);
    expect(n.map((e) => e.secret)).toEqual([B, A]);
    expect(n[0]).toMatchObject({ name: 'B', firstJoined: 5, lastJoined: 30, peers: ['Anna'] });
  });
});

describe('notePeers', () => {
  test('merkt höchstens 8 Namen, jeden auf 40 Zeichen gekürzt', () => {
    const r = noteJoin([], A, 1);
    const names = Array.from({ length: 12 }, (_, i) => `${i}`.padEnd(100, 'x'));
    const peers = notePeers(r, A, names)[0].peers;
    expect(peers).toHaveLength(8);
    expect(peers[0]).toBe('0'.padEnd(40, 'x'));
    for (const p of peers) expect(p.length).toBeLessThanOrEqual(40);
  });
  test('ersetzt die Namen des Raums', () => {
    const r = noteJoin([], A, 1);
    expect(notePeers(r, A, ['Anna', 'Bert'])[0].peers).toEqual(['Anna', 'Bert']);
  });
});

describe('renameRoom', () => {
  test('renameRoom mit Leerraum ergibt null', () => {
    const r = renameRoom(noteJoin([], A, 1), A, '   ');
    expect(r[0].name).toBeNull();
  });
  test('renameRoom trimmt', () => {
    expect(renameRoom(noteJoin([], A, 1), A, '  Familie ')[0].name).toBe('Familie');
  });
  test('renameRoom kürzt auf 40', () => {
    expect(renameRoom(noteJoin([], A, 1), A, 'x'.repeat(60))[0].name).toBe('x'.repeat(40));
  });
});

test('removeRoom', () => {
  const r = noteJoin(noteJoin([], A, 1), B, 2);
  expect(removeRoom(r, A).map((e) => e.secret)).toEqual([B]);
});

describe('Titel und Untertitel', () => {
  test('roomTitle ohne Namen: Raum vom 3. November', () => {
    const e = { secret: A, name: null, firstJoined: day(10, 3), lastJoined: day(10, 3), peers: [] };
    expect(roomTitle(e, NOW)).toBe('Raum vom 3. November');
  });
  test('roomTitle mit Namen', () => {
    expect(roomTitle({ secret: A, name: 'Familie', firstJoined: 1, lastJoined: 1, peers: [] }, NOW)).toBe('Familie');
  });
  test('roomSubtitle: gestern · Anna, Bert', () => {
    const e = { secret: A, name: null, firstJoined: 1, lastJoined: day(10, 21), peers: ['Anna', 'Bert'] };
    expect(roomSubtitle(e, NOW)).toBe('gestern · Anna, Bert');
  });
  test('roomSubtitle ohne Namen: nur der Tag', () => {
    const e = { secret: A, name: null, firstJoined: 1, lastJoined: day(10, 22), peers: [] };
    expect(roomSubtitle(e, NOW)).toBe('heute');
  });
});

describe('relDay', () => {
  test('heute', () => expect(relDay(day(10, 22), NOW)).toBe('heute'));
  test('gestern', () => expect(relDay(day(10, 21), NOW)).toBe('gestern'));
  test('früher im Jahr', () => expect(relDay(day(10, 3), NOW)).toBe('3. November'));
  test('anderes Jahr', () => expect(relDay(day(10, 3, 2025), NOW)).toBe('3. November 2025'));
});

describe('loadRooms', () => {
  test('loadRooms: kein JSON → []', () => {
    expect(loadRooms(fakeStorage({ 'plaudr.rooms': '{kaputt' }))).toEqual([]);
    expect(loadRooms(fakeStorage())).toEqual([]);
  });
  test('loadRooms: Zugriffsfehler → []', () => {
    const s = { getItem: () => { throw new Error('x'); } } as unknown as Storage;
    expect(loadRooms(s)).toEqual([]);
  });
  test('loadRooms verwirft Einträge mit ungültigem Geheimnis oder falschen Typen', () => {
    const ok = { secret: A, name: 'X', firstJoined: 1, lastJoined: 2, peers: ['Anna'] };
    const bad = [
      { ...ok, secret: 'kurz' },
      { ...ok, name: 5 },
      { ...ok, firstJoined: 'x' },
      { ...ok, peers: [1] },
      null,
      'text',
    ];
    const r = loadRooms(fakeStorage({ 'plaudr.rooms': JSON.stringify([...bad, ok]) }));
    expect(r).toEqual([ok]);
  });
  test('loadRooms sortiert nach lastJoined absteigend', () => {
    const e1 = { secret: A, name: null, firstJoined: 1, lastJoined: 2, peers: [] };
    const e2 = { secret: B, name: null, firstJoined: 1, lastJoined: 9, peers: [] };
    expect(loadRooms(fakeStorage({ 'plaudr.rooms': JSON.stringify([e1, e2]) })).map((e) => e.secret)).toEqual([B, A]);
  });
});

describe('saveRooms', () => {
  test('saveRooms hält höchstens 50', () => {
    const s = fakeStorage();
    let r: Rooms = [];
    for (let i = 0; i < 60; i++) r = noteJoin(r, String(i).padStart(43, 'a'), i);
    saveRooms(r, s);
    const back = loadRooms(s);
    expect(back).toHaveLength(50);
    expect(back[0].lastJoined).toBe(59);
    expect(back[49].lastJoined).toBe(10);
  });
  test('saveRooms schluckt Schreibfehler', () => {
    const s = { setItem: () => { throw new Error('voll'); } } as unknown as Storage;
    expect(() => saveRooms([], s)).not.toThrow();
  });
});

test('Funktionen ändern die Eingabe nicht', () => {
  const r = noteJoin(noteJoin([], A, 1), B, 2);
  const snap = JSON.stringify(r);
  noteJoin(r, A, 5);
  notePeers(r, A, ['Z']);
  renameRoom(r, A, 'N');
  removeRoom(r, A);
  expect(JSON.stringify(r)).toBe(snap);
});

// localStorage-Zugriff wirft (gesperrte Websitedaten): ohne übergebenen Speicher müssen Standardwerte kommen.
function ohneLesbaresLocalStorage(f: () => void): void {
  const alt = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    f();
  } finally {
    if (alt) Object.defineProperty(globalThis, 'localStorage', alt);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
}

test('gesperrtes localStorage: leere Liste, kein Wurf', () => {
  ohneLesbaresLocalStorage(() => {
    expect(loadRooms()).toEqual([]);
    expect(() => saveRooms([])).not.toThrow();
  });
});
