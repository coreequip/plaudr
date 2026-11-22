import { describe, expect, test } from 'vitest';
import { autoJoinTarget } from './auto-join';
import type { Rooms } from './rooms';

const A = 'a'.repeat(43);
const B = 'b'.repeat(43);
const rooms: Rooms = [
  { secret: A, name: null, firstJoined: 1, lastJoined: 5, peers: [] },
  { secret: B, name: null, firstJoined: 1, lastJoined: 2, peers: [] },
];
const base = { hash: '', booted: false, autoJoin: true, rooms };

describe('autoJoinTarget', () => {
  test('Link im Fragment: kein Auto-Beitritt', () => {
    expect(autoJoinTarget({ ...base, hash: '#' + B })).toBeNull();
  });
  test('schon gestartet: null', () => {
    expect(autoJoinTarget({ ...base, booted: true })).toBeNull();
  });
  test('autoJoin aus: null', () => {
    expect(autoJoinTarget({ ...base, autoJoin: false })).toBeNull();
  });
  test('leere Liste: null', () => {
    expect(autoJoinTarget({ ...base, rooms: [] })).toBeNull();
  });
  test('sonst der neueste Eintrag', () => {
    expect(autoJoinTarget(base)).toBe(A);
  });
  test('nacktes # gilt als leer', () => {
    expect(autoJoinTarget({ ...base, hash: '#' })).toBe(A);
  });
});
