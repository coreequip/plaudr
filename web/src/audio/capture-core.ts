import type { Gate } from './gate';
import type { CaptureActivity, CaptureControl } from './messages';
import { FRAME_SIZE, type Denoiser } from './rnnoise';

const SAMPLE_RATE = 48_000;
/** Mehr als 400 ms Rückstand heißt: Takt läuft auseinander oder niemand liest; dann Älteste verwerfen. */
const MAX_BUFFERED = (SAMPLE_RATE * 400) / 1000;
const ACTIVITY_EVERY_FRAMES = 5;

/**
 * Kern des Aufnahme-Worklets, ohne Web-Audio-Abhängigkeit: sammelt Render-Blöcke zu 480er-Frames, lässt sie durch
 * RNNoise (immer, wegen der VAD) und das Gate laufen und puffert die Ausgabe.
 */
export class CaptureCore {
  onActivity?: (a: CaptureActivity) => void;
  private readonly frame = new Float32Array(FRAME_SIZE);
  private fill = 0;
  private denoise = true;
  private readonly ring = new Float32Array(MAX_BUFFERED);
  private read = 0;
  private count = 0;
  private sinceReport = 0;
  private lastOpen = false;

  constructor(
    private readonly denoiser: Denoiser,
    private readonly gate: Gate,
  ) {}

  get bufferedSamples(): number {
    return this.count;
  }

  control(c: CaptureControl): void {
    if (c.mode !== undefined) this.gate.mode = c.mode;
    if (c.pressed !== undefined) this.gate.setPressed(c.pressed);
    if (c.threshold !== undefined) this.gate.set({ threshold: c.threshold });
    if (c.preroll !== undefined) this.gate.set({ preroll: c.preroll });
    if (c.denoise !== undefined) this.denoise = c.denoise;
  }

  push(input: Float32Array): void {
    let i = 0;
    while (i < input.length) {
      const n = Math.min(FRAME_SIZE - this.fill, input.length - i);
      this.frame.set(input.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === FRAME_SIZE) {
        this.fill = 0;
        this.processFrame();
      }
    }
  }

  pull(out: Float32Array): void {
    const n = Math.min(out.length, this.count);
    for (let k = 0; k < n; k++) out[k] = this.ring[(this.read + k) % MAX_BUFFERED];
    out.fill(0, n);
    this.read = (this.read + n) % MAX_BUFFERED;
    this.count -= n;
  }

  private processFrame(): void {
    const work = this.frame.slice();
    const original = this.denoise ? null : this.frame.slice();
    const vad = this.denoiser.process(work);
    for (const f of this.gate.process(original ?? work, vad)) this.write(f);
    this.report(vad);
  }

  private write(f: Float32Array): void {
    for (const v of f) {
      if (this.count === MAX_BUFFERED) {
        this.read = (this.read + 1) % MAX_BUFFERED;
        this.count--;
      }
      this.ring[(this.read + this.count) % MAX_BUFFERED] = v;
      this.count++;
    }
  }

  private report(vad: number): void {
    const open = this.gate.open;
    this.sinceReport++;
    if (open === this.lastOpen && this.sinceReport < ACTIVITY_EVERY_FRAMES) return;
    this.lastOpen = open;
    this.sinceReport = 0;
    this.onActivity?.({ open, vad });
  }
}
