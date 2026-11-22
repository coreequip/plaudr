import { FRAME_SIZE } from './rnnoise';

export type SpeakMode = 'vad' | 'ptt' | 'muted';

export interface GateOptions {
  pttTailMs: number;
  vadHoldMs: number;
  prerollMs: number;
  threshold: number;
  preroll: boolean;
}

export const DEFAULT_GATE: GateOptions = { pttTailMs: 150, vadHoldMs: 400, prerollMs: 200, threshold: 0.85, preroll: true };

const FRAME_MS = 10;
const frames = (ms: number) => Math.round(ms / FRAME_MS);

/**
 * Entscheidet je 10-ms-Frame, was gesendet wird (Spec §6, Sprechmodi). Geschlossen geht ein Nullframe raus.
 * Beim Öffnen per Sprachaktivierung kommen die gepufferten Vorlauf-Frames mit; der dadurch entstandene Rückstand
 * wird in Pausen zwischen Wörtern (VAD unter halber Schwelle) wieder abgebaut, indem solche Frames entfallen.
 */
export class Gate {
  private o: GateOptions;
  private _mode: SpeakMode = 'vad';
  private pressed = false;
  private tailLeft = 0;
  private below = 0;
  private ring: Float32Array[] = [];
  private _open = false;
  private lag = 0;

  constructor(o: Partial<GateOptions> = {}) {
    this.o = { ...DEFAULT_GATE, ...o };
  }

  get mode(): SpeakMode {
    return this._mode;
  }
  set mode(m: SpeakMode) {
    this._mode = m;
    this.close();
    this.tailLeft = 0;
    // Sonst bliebe eine beim Wechsel gehaltene Taste „gedrückt“, wenn ihr Loslassen nicht mehr durchgereicht wird.
    this.pressed = false;
  }

  get open(): boolean {
    return this._open;
  }
  get lagFrames(): number {
    return this.lag;
  }

  set(o: Partial<GateOptions>): void {
    this.o = { ...this.o, ...o };
    if (!this.o.preroll) this.ring = [];
  }

  setPressed(b: boolean): void {
    if (this.pressed && !b) this.tailLeft = frames(this.o.pttTailMs);
    this.pressed = b;
  }

  process(frame: Float32Array, vad: number): Float32Array[] {
    switch (this._mode) {
      case 'muted':
        return [zero()];
      case 'ptt':
        return this.ptt(frame);
      case 'vad':
        return this.vad(frame, vad);
    }
  }

  private ptt(frame: Float32Array): Float32Array[] {
    if (this.pressed) {
      this._open = true;
      return [frame.slice()];
    }
    if (this.tailLeft > 0) {
      this.tailLeft--;
      this._open = this.tailLeft > 0;
      return [frame.slice()];
    }
    this._open = false;
    return [zero()];
  }

  private vad(frame: Float32Array, vad: number): Float32Array[] {
    const { threshold } = this.o;
    if (vad > threshold) {
      this.below = 0;
      if (this._open) return [frame.slice()];
      this._open = true;
      const out = [...this.ring, frame.slice()];
      this.lag = this.ring.length;
      this.ring = [];
      return out;
    }
    if (this._open) {
      if (++this.below >= frames(this.o.vadHoldMs)) {
        this.close();
        this.remember(frame);
        return [zero()];
      }
      if (this.lag > 0 && vad < threshold / 2) {
        this.lag--;
        return [];
      }
      return [frame.slice()];
    }
    this.remember(frame);
    return [zero()];
  }

  private remember(frame: Float32Array): void {
    if (!this.o.preroll) return;
    this.ring.push(frame.slice());
    if (this.ring.length > frames(this.o.prerollMs)) this.ring.shift();
  }

  private close(): void {
    this._open = false;
    this.lag = 0;
    this.below = 0;
    this.ring = [];
  }
}

function zero(): Float32Array {
  return new Float32Array(FRAME_SIZE);
}
