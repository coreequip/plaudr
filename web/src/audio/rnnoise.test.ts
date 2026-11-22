import { expect, test } from 'vitest';
import { createDenoiser, FRAME_SIZE } from './rnnoise';
import { rnnoiseModule, speechSamples } from './test-audio';

const mod = rnnoiseModule();
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

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

/** Deterministisches Rauschen (mulberry32), damit der Test nicht vom Zufall abhängt. */
function noise(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

// Reines weißes Rauschen ist kein brauchbares Testsignal (RNNoise reagiert darauf sprunghaft); deshalb Sprache plus
// Rauschen. Gemessen: in den Pausen 7 % der Rauschamplitude übrig, Sprache unverändert.
test('Rauschen in Sprechpausen wird um mindestens 75 % leiser, Sprache bleibt erhalten', () => {
  const d = createDenoiser(mod);
  const s = speechSamples();
  const rnd = noise(1);
  const energy = (f: Float32Array) => f.reduce((sum, v) => sum + v * v, 0);
  let pauseIn = 0, pauseOut = 0, speechIn = 0, speechOut = 0;
  for (let i = 0; i + FRAME_SIZE <= s.length; i += FRAME_SIZE) {
    const clean = s.subarray(i, i + FRAME_SIZE);
    const cleanE = energy(clean) / FRAME_SIZE;
    const f = Float32Array.from(clean, (v) => v + rnd() * 0.01);
    const before = energy(f);
    d.process(f);
    if (i < 100 * FRAME_SIZE) continue; // Einschwingen
    if (cleanE < 1e-7) [pauseIn, pauseOut] = [pauseIn + before, pauseOut + energy(f)];
    else if (cleanE > 1e-3) [speechIn, speechOut] = [speechIn + before, speechOut + energy(f)];
  }
  expect(Math.sqrt(pauseOut / pauseIn)).toBeLessThan(0.25);
  expect(Math.sqrt(speechOut / speechIn)).toBeGreaterThan(0.8);
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
