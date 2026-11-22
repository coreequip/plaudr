import wasmUrl from '@shiguredo/rnnoise-wasm/dist/rnnoise.wasm?url';

/** RNNoise arbeitet auf 10-ms-Frames bei 48 kHz. */
export const FRAME_SIZE = 480;
export const RNNOISE_WASM_URL: string = wasmUrl;

export interface Denoiser {
  /** Entrauscht `frame` (Werte in [-1, 1]) in place und liefert die Sprachwahrscheinlichkeit 0..1. */
  process(frame: Float32Array): number;
  destroy(): void;
}

interface RnnoiseExports {
  memory: WebAssembly.Memory;
  __wasm_call_ctors(): void;
  emscripten_stack_init(): void;
  malloc(n: number): number;
  free(p: number): void;
  rnnoise_create(model: number): number;
  rnnoise_destroy(st: number): void;
  rnnoise_process_frame(st: number, out: number, inp: number): number;
}

const SCALE = 32768;

/**
 * Instanziiert das RNNoise-WASM synchron (im AudioWorklet gibt es kein fetch, das Modul kommt fertig kompiliert).
 * Ersetzt den Emscripten-Glue: Das WASM braucht nur drei Imports.
 */
export function createDenoiser(module: WebAssembly.Module): Denoiser {
  let memory: WebAssembly.Memory | undefined;
  const env = {
    emscripten_memcpy_big: (dest: number, src: number, n: number) => {
      new Uint8Array(memory!.buffer).copyWithin(dest, src, src + n);
    },
    emscripten_resize_heap: (size: number) => {
      const need = size - memory!.buffer.byteLength;
      if (need > 0) memory!.grow(Math.ceil(need / 65536));
      return 1;
    },
    __assert_fail: () => {
      throw new Error('RNNoise: assert');
    },
  };
  const x = new WebAssembly.Instance(module, { env }).exports as unknown as RnnoiseExports;
  memory = x.memory;
  // Reihenfolge wichtig: ohne initialisierten Stack hängt rnnoise_process_frame.
  x.emscripten_stack_init();
  x.__wasm_call_ctors();
  const state = x.rnnoise_create(0);
  const inp = x.malloc(FRAME_SIZE * 4);
  const out = x.malloc(FRAME_SIZE * 4);
  let alive = true;

  return {
    process(frame) {
      if (frame.length !== FRAME_SIZE) throw new RangeError(`RNNoise braucht ${FRAME_SIZE} Samples, nicht ${frame.length}`);
      if (!alive) throw new Error('RNNoise: bereits freigegeben');
      // Views jedes Mal neu: Nach memory.grow ist der alte ArrayBuffer abgelöst.
      const heapIn = new Float32Array(x.memory.buffer, inp, FRAME_SIZE);
      for (let i = 0; i < FRAME_SIZE; i++) heapIn[i] = frame[i] * SCALE;
      const vad = x.rnnoise_process_frame(state, out, inp);
      const heapOut = new Float32Array(x.memory.buffer, out, FRAME_SIZE);
      for (let i = 0; i < FRAME_SIZE; i++) frame[i] = heapOut[i] / SCALE;
      return vad;
    },
    destroy() {
      if (!alive) return;
      alive = false;
      x.rnnoise_destroy(state);
      x.free(inp);
      x.free(out);
    },
  };
}
