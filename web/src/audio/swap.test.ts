import { expect, test } from 'vitest';
import { createSwapper } from './swap';

function setup() {
  const applied: string[] = [];
  const discarded: string[] = [];
  const pending: ((v: string | null) => void)[] = [];
  const s = createSwapper<string>({
    open: () => new Promise((r) => void pending.push(r)),
    apply: (n) => void applied.push(n),
    discard: (n) => void discarded.push(n),
  });
  return { s, applied, discarded, pending };
}

test('ein einzelner Tausch hängt die neue Quelle ein', async () => {
  const { s, applied, pending } = setup();
  const p = s.swap();
  pending[0]('a');
  await p;
  expect(applied).toEqual(['a']);
});

test('überholte Tausche werden verworfen, auch wenn sie in falscher Reihenfolge fertig werden', async () => {
  const { s, applied, discarded, pending } = setup();
  const p1 = s.swap();
  const p2 = s.swap();
  pending[1]('neu');
  pending[0]('alt');
  await Promise.all([p1, p2]);
  expect(applied).toEqual(['neu']);
  expect(discarded).toEqual(['alt']);
});

test('nach close wird das neue Mikrofon verworfen statt eingehängt', async () => {
  const { s, applied, discarded, pending } = setup();
  const p = s.swap();
  s.close();
  pending[0]('a');
  await p;
  expect(applied).toEqual([]);
  expect(discarded).toEqual(['a']);
});

test('scheitert das Öffnen, passiert nichts', async () => {
  const { s, applied, discarded, pending } = setup();
  const p = s.swap();
  pending[0](null);
  await p;
  expect([applied, discarded]).toEqual([[], []]);
});
