import { describe, expect, test } from 'vitest';
import { PttButton, TAP_MS } from './ptt-button';

function setup() {
  let t = 0;
  const calls: boolean[] = [];
  const b = new PttButton((p) => calls.push(p), () => t);
  return { b, calls, advance: (ms: number) => (t += ms) };
}

describe('PttButton', () => {
  test('Halten sendet, Loslassen beendet', () => {
    const { b, calls, advance } = setup();
    b.down();
    advance(TAP_MS + 200);
    b.up();
    expect(calls).toEqual([true, false]);
    expect(b.latched).toBe(false);
  });

  test('kurzes Antippen rastet ein, zweites Antippen beendet', () => {
    const { b, calls, advance } = setup();
    b.down();
    advance(100);
    b.up();
    expect(calls).toEqual([true]);
    expect(b.latched).toBe(true);
    advance(5000);
    b.down();
    expect(calls).toEqual([true, false]);
    expect(b.latched).toBe(false);
    advance(50);
    b.up();
    expect(calls).toEqual([true, false]);
  });

  test('cancel löst gehaltene und eingerastete Taste', () => {
    const { b, calls, advance } = setup();
    b.down();
    advance(50);
    b.up();
    b.cancel();
    expect(calls).toEqual([true, false]);
    expect(b.latched).toBe(false);
    b.down();
    b.cancel();
    expect(calls).toEqual([true, false, true, false]);
  });

  test('cancel ohne gedrückte Taste meldet nichts', () => {
    const { b, calls } = setup();
    b.cancel();
    expect(calls).toEqual([]);
  });

  test('up ohne vorheriges down meldet nichts', () => {
    const { b, calls } = setup();
    b.up();
    expect(calls).toEqual([]);
  });

  test('Abbruch während des Haltens rastet nicht ein', () => {
    const { b, calls, advance } = setup();
    b.down();
    advance(50);
    b.cancel();
    b.up();
    expect(calls).toEqual([true, false]);
    expect(b.latched).toBe(false);
  });
});
