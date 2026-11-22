import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Nur für Tests: RNNoise-WASM und Sprachprobe von der Platte. */
export function rnnoiseModule(): WebAssembly.Module {
  const path = fileURLToPath(new URL('../../node_modules/@shiguredo/rnnoise-wasm/dist/rnnoise.wasm', import.meta.url));
  return new WebAssembly.Module(readFileSync(path));
}

/** Sprachprobe als Float32 in [-1, 1]; liest ab dem data-Chunk, der bei afconvert nicht bei Byte 44 liegt. */
export function speechSamples(): Float32Array {
  const buf = readFileSync(fileURLToPath(new URL('../../e2e/fixtures/speech.wav', import.meta.url)));
  const at = buf.indexOf('data') + 8;
  const n = (buf.length - at) >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(at + 2 * i) / 32768;
  return out;
}
