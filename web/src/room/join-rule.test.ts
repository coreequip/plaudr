import { describe, expect, test } from 'vitest';
import { canJoin, needsBackup } from './join-rule';

const gesichert = { backedUp: true, persistent: true };

describe('canJoin', () => {
  test('ohne Namen kein Beitritt', () => {
    expect(canJoin({ name: '', tabLocked: true, identity: gesichert })).toBe(false);
    expect(canJoin({ name: '   ', tabLocked: true, identity: gesichert })).toBe(false);
    expect(canJoin({ name: 'Anna', tabLocked: true, identity: gesichert })).toBe(true);
  });

  test('ohne eigene Tab-Sperre kein Beitritt', () => {
    expect(canJoin({ name: 'Anna', tabLocked: false, identity: gesichert })).toBe(false);
    expect(canJoin({ name: 'Anna', tabLocked: false, identity: null })).toBe(false);
  });

  test('persistente Identität ohne Sicherung darf nicht', () => {
    expect(canJoin({ name: 'Anna', tabLocked: true, identity: { backedUp: false, persistent: true } })).toBe(false);
    expect(canJoin({ name: 'Anna', tabLocked: true, identity: null })).toBe(false);
  });

  test('flüchtige Identität ohne Sicherung darf', () => {
    expect(canJoin({ name: 'Anna', tabLocked: true, identity: { backedUp: false, persistent: false } })).toBe(true);
  });
});

describe('needsBackup', () => {
  test('nur persistente Identität ohne Sicherung braucht eine', () => {
    expect(needsBackup({ backedUp: false, persistent: true })).toBe(true);
    expect(needsBackup({ backedUp: true, persistent: true })).toBe(false);
    expect(needsBackup({ backedUp: false, persistent: false })).toBe(false);
    expect(needsBackup(null)).toBe(false);
  });
});
