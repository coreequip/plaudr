import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { IceBatcher } from './ice-batcher';

const c = (n: number): RTCIceCandidateInit => ({ candidate: `candidate:${n}`, sdpMid: '0' });
let flushed: RTCIceCandidateInit[][];
let b: IceBatcher;

beforeEach(() => {
  vi.useFakeTimers();
  flushed = [];
  b = new IceBatcher((x) => flushed.push(x));
});
afterEach(() => vi.useRealTimers());

test('bündelt Kandidaten innerhalb von 80 ms zu einem Aufruf', () => {
  for (let i = 0; i < 5; i++) {
    b.add(c(i));
    vi.advanceTimersByTime(10);
  }
  expect(flushed).toHaveLength(0);
  vi.advanceTimersByTime(30);
  expect(flushed).toEqual([[c(0), c(1), c(2), c(3), c(4)]]);
});

test('startet danach einen neuen Timer', () => {
  b.add(c(1));
  vi.advanceTimersByTime(80);
  b.add(c(2));
  vi.advanceTimersByTime(79);
  expect(flushed).toHaveLength(1);
  vi.advanceTimersByTime(1);
  expect(flushed).toEqual([[c(1)], [c(2)]]);
});

test('Ende der Kandidaten liefert sofort', () => {
  b.add(c(1));
  b.add(null);
  expect(flushed).toEqual([[c(1)]]);
  vi.advanceTimersByTime(200);
  expect(flushed).toHaveLength(1);
});

test('dispose verwirft Ausstehendes', () => {
  b.add(c(1));
  b.dispose();
  vi.advanceTimersByTime(200);
  expect(flushed).toHaveLength(0);
});

test('leerer Puffer erzeugt keinen Aufruf', () => {
  b.add(null);
  vi.advanceTimersByTime(200);
  expect(flushed).toHaveLength(0);
});
