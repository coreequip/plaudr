/// <reference lib="webworker" />
import { CaptureCore } from './capture-core';
import { Gate } from './gate';
import type { CaptureControl } from './messages';
import { createDenoiser } from './rnnoise';

// Minimale Typen des AudioWorkletGlobalScope (fehlen in lib.dom).
declare const AudioWorkletProcessor: { new (): { readonly port: MessagePort } };
declare function registerProcessor(name: string, ctor: unknown): void;

const SILENCE = new Float32Array(128);

/** Dünne Hülle um CaptureCore; das WASM-Modul kommt kompiliert über processorOptions. */
class CaptureProcessor extends AudioWorkletProcessor {
  private readonly core: CaptureCore;

  constructor(options: { processorOptions: { module: WebAssembly.Module; control?: CaptureControl } }) {
    super();
    this.core = new CaptureCore(createDenoiser(options.processorOptions.module), new Gate());
    if (options.processorOptions.control) this.core.control(options.processorOptions.control);
    this.core.onActivity = (a) => this.port.postMessage(a);
    this.port.onmessage = (e: MessageEvent<CaptureControl>) => this.core.control(e.data);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    this.core.push(inputs[0]?.[0] ?? SILENCE);
    const [first, ...rest] = outputs[0] ?? [];
    if (first) {
      this.core.pull(first);
      for (const ch of rest) ch.set(first);
    }
    return true;
  }
}

registerProcessor('plaudr-capture', CaptureProcessor);
