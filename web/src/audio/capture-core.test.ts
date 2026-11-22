import { describe, expect, test } from 'vitest';
import { CaptureCore } from './capture-core';
import { Gate } from './gate';
import type { CaptureActivity } from './messages';
import { createDenoiser, FRAME_SIZE, type Denoiser } from './rnnoise';
import { rnnoiseModule, speechSamples } from './test-audio';

/** Halbiert das Signal und liefert VAD-Werte aus einer Liste (danach den letzten). */
function fakeDenoiser(vads: number[] = [0.95]): Denoiser & { calls: number } {
  const d = {
    calls: 0,
    process(f: Float32Array) {
      for (let i = 0; i < f.length; i++) f[i] /= 2;
      return vads[Math.min(d.calls++, vads.length - 1)];
    },
    destroy() {},
  };
  return d;
}

const saw = (n: number, from = 0) => Float32Array.from({ length: n }, (_, i) => ((from + i) % 1000) / 1000);
const pullAll = (c: CaptureCore, n: number) => {
  const out = new Float32Array(n);
  c.pull(out);
  return out;
};

test('128er-Blöcke werden zu 480er-Frames gesammelt und in Reihenfolge ausgegeben', () => {
  const d = fakeDenoiser();
  const c = new CaptureCore(d, new Gate({ preroll: false }));
  c.control({ denoise: false });
  for (let k = 0; k < 3; k++) c.push(saw(128, k * 128));
  expect(d.calls).toBe(0);
  expect(c.bufferedSamples).toBe(0);
  c.push(saw(128, 384));
  expect(d.calls).toBe(1);
  expect(c.bufferedSamples).toBe(FRAME_SIZE);
  expect(pullAll(c, FRAME_SIZE)).toEqual(saw(FRAME_SIZE));
  expect(c.bufferedSamples).toBe(0);
});

test('fehlende Samples beim Lesen sind Null', () => {
  const c = new CaptureCore(fakeDenoiser(), new Gate({ preroll: false }));
  expect(pullAll(c, 128)).toEqual(new Float32Array(128));
});

describe('Rauschunterdrückung an und aus', () => {
  test('an: entrauschtes (hier halbiertes) Signal', () => {
    const c = new CaptureCore(fakeDenoiser(), new Gate({ preroll: false }));
    c.push(new Float32Array(FRAME_SIZE).fill(0.8));
    expect(pullAll(c, FRAME_SIZE)[0]).toBeCloseTo(0.4);
  });
  test('aus: Originalsignal, die VAD wirkt trotzdem', () => {
    const d = fakeDenoiser();
    const c = new CaptureCore(d, new Gate({ preroll: false }));
    c.control({ denoise: false });
    c.push(new Float32Array(FRAME_SIZE).fill(0.8));
    expect(d.calls).toBe(1);
    expect(pullAll(c, FRAME_SIZE)[0]).toBeCloseTo(0.8);
  });
});

test('stumm: nur Nullen, obwohl laut', () => {
  const c = new CaptureCore(fakeDenoiser([1]), new Gate());
  c.control({ mode: 'muted' });
  for (let k = 0; k < 10; k++) c.push(new Float32Array(FRAME_SIZE).fill(0.9));
  expect(pullAll(c, 10 * FRAME_SIZE).every((v) => v === 0)).toBe(true);
});

test('Steuerung erreicht das Gate: PTT gedrückt öffnet', () => {
  const c = new CaptureCore(fakeDenoiser([0]), new Gate());
  c.control({ mode: 'ptt' });
  c.push(new Float32Array(FRAME_SIZE).fill(0.8));
  expect(pullAll(c, FRAME_SIZE)[0]).toBe(0);
  c.control({ pressed: true });
  c.push(new Float32Array(FRAME_SIZE).fill(0.8));
  expect(pullAll(c, FRAME_SIZE)[0]).toBeCloseTo(0.4);
});

test('Obergrenze: ohne Lesen höchstens 400 ms gepuffert', () => {
  const c = new CaptureCore(fakeDenoiser(), new Gate());
  for (let k = 0; k < 375; k++) c.push(new Float32Array(128).fill(0.5)); // 1 s
  expect(c.bufferedSamples).toBeLessThanOrEqual(19_200);
  expect(c.bufferedSamples).toBeGreaterThan(19_000);
});

test('Aktivität: Wechsel sofort, sonst höchstens alle 5 Frames', () => {
  const c = new CaptureCore(fakeDenoiser([0, 0, 0, 0, 0, 0, 0, 0.95]), new Gate({ preroll: false }));
  const seen: [number, CaptureActivity][] = [];
  let frame = 0;
  c.onActivity = (a) => seen.push([frame, a]);
  for (frame = 1; frame <= 8; frame++) c.push(new Float32Array(FRAME_SIZE));
  expect(seen.map(([f, a]) => [f, a.open])).toEqual([[5, false], [8, true]]);
  expect(seen[1][1].vad).toBe(0.95);
});

test('mit echtem RNNoise und der Sprachprobe öffnet und schließt das Gate', () => {
  const c = new CaptureCore(createDenoiser(rnnoiseModule()), new Gate());
  const opens: boolean[] = [];
  c.onActivity = (a) => opens.push(a.open);
  const s = speechSamples();
  const out = new Float32Array(128);
  for (let i = 0; i + 128 <= s.length; i += 128) {
    c.push(s.subarray(i, i + 128));
    c.pull(out);
  }
  const firstOpen = opens.indexOf(true);
  expect(firstOpen).toBeGreaterThanOrEqual(0);
  expect(opens.indexOf(false, firstOpen)).toBeGreaterThan(firstOpen);
});
