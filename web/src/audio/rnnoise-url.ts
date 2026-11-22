import wasmUrl from '@shiguredo/rnnoise-wasm/dist/rnnoise.wasm?url';

/** Getrennt von rnnoise.ts, damit das Worklet-Bundle die URL nicht mitschleppt. */
export const RNNOISE_WASM_URL: string = wasmUrl;
