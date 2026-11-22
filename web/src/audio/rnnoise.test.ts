import { expect, test } from 'vitest';
import { createDenoiser, FRAME_SIZE } from './rnnoise';
import { rnnoiseModule, speechSamples } from './test-audio';

const mod = rnnoiseModule();
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const quantile = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];

test('Framegröße ist 480', () => {
  expect(FRAME_SIZE).toBe(480);
});

test('Stille ergibt VAD unter 0,05 und bleibt still', () => {
  const d = createDenoiser(mod);
  for (let i = 0; i < 100; i++) {
    const f = new Float32Array(FRAME_SIZE);
    expect(d.process(f)).toBeLessThan(0.05);
    expect(rms(f)).toBe(0);
  }
  d.destroy();
});

// Die Testdatei besteht zu etwa 40 % aus Pausen; gemessen 31 %.
test('Sprache aus der Testdatei: mindestens 25 % der Frames über 0,85', () => {
  const d = createDenoiser(mod);
  const s = speechSamples();
  const vads: number[] = [];
  for (let i = 0; i + FRAME_SIZE <= s.length; i += FRAME_SIZE) vads.push(d.process(s.slice(i, i + FRAME_SIZE)));
  expect(vads.filter((v) => v > 0.85).length / vads.length).toBeGreaterThanOrEqual(0.25);
  d.destroy();
});

// Gemessen 57 % leiser bei Amplitude 0,05.
test('weißes Rauschen wird um mindestens 50 % leiser, VAD bleibt niedrig', () => {
  const d = createDenoiser(mod);
  let inE = 0;
  let outE = 0;
  const vads: number[] = [];
  for (let i = 0; i < 300; i++) {
    const f = Float32Array.from({ length: FRAME_SIZE }, () => (Math.random() * 2 - 1) * 0.05);
    const before = rms(f);
    const vad = d.process(f);
    if (i >= 50) {
      inE += before;
      outE += rms(f);
      vads.push(vad);
    }
  }
  expect(outE / inE).toBeLessThan(0.5);
  expect(quantile(vads, 0.9)).toBeLessThan(0.2);
  d.destroy();
});

test('falsche Framelänge wirft', () => {
  const d = createDenoiser(mod);
  expect(() => d.process(new Float32Array(128))).toThrow();
  d.destroy();
});

test('zwei Denoiser sind unabhängig', () => {
  const a = createDenoiser(mod);
  const b = createDenoiser(mod);
  const c = createDenoiser(mod);
  const s = speechSamples();
  for (let i = 0; i < 50; i++) a.process(s.slice(i * FRAME_SIZE, (i + 1) * FRAME_SIZE));
  const fb = s.slice(60 * FRAME_SIZE, 61 * FRAME_SIZE);
  const fc = fb.slice();
  b.process(fb);
  c.process(fc);
  expect(fb).toEqual(fc);
  for (const d of [a, b, c]) d.destroy();
});
