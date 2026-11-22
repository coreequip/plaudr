import workletUrl from './capture.worklet.ts?worker&url';
import type { CaptureActivity, CaptureControl } from './messages';
import { RNNOISE_WASM_URL } from './rnnoise-url';
import type { AudioSettings } from './settings';

export interface Capture {
  /** Der eine Track für alle Peers; bleibt bei jedem update derselbe. */
  readonly stream: MediaStream;
  /** false: Worklet oder WASM nicht nutzbar, es geht das Rohmikrofon raus. */
  readonly processed: boolean;
  update(s: Partial<AudioSettings>): Promise<void>;
  setPressed(b: boolean): void;
  onActivity(cb: (a: CaptureActivity) => void): void;
  activity(): CaptureActivity;
  close(): void;
}

const constraints = (noiseSuppression: boolean): MediaStreamConstraints => ({
  audio: { echoCancellation: true, noiseSuppression, autoGainControl: true, channelCount: 1 },
});

async function openMic(noiseSuppression: boolean): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia(constraints(noiseSuppression));
  } catch {
    return null;
  }
}

async function compileRnnoise(): Promise<WebAssembly.Module> {
  const res = await fetch(RNNOISE_WASM_URL);
  return WebAssembly.compile(await res.arrayBuffer());
}

const toControl = (s: Partial<AudioSettings>): CaptureControl => {
  const c: CaptureControl = {};
  if (s.mode !== undefined) c.mode = s.mode;
  if (s.threshold !== undefined) c.threshold = s.threshold;
  if (s.preroll !== undefined) c.preroll = s.preroll;
  if (s.denoise !== undefined) c.denoise = s.denoise;
  return c;
};

/**
 * Aufnahmekette aus Spec §6: Mikrofon → AudioWorklet (RNNoise + Gate) → MediaStreamDestination.
 * Ohne Mikrofon null. Scheitert das Worklet, geht das Rohmikrofon raus (Stumm und PTT über track.enabled).
 */
export async function openCapture(initial: AudioSettings): Promise<Capture | null> {
  let settings = { ...initial };
  const mic = await openMic(!settings.denoise);
  if (!mic) return null;
  try {
    return await processedCapture(mic, settings);
  } catch (err) {
    console.warn('[plaudr] Audiokette nicht verfügbar, sende Rohmikrofon', err);
    mic.getTracks().forEach((t) => t.stop());
    const raw = (await openMic(true)) ?? (await openMic(false));
    if (!raw) return null;
    return rawCapture(raw, settings);
  }

  async function processedCapture(firstMic: MediaStream, s: AudioSettings): Promise<Capture> {
    const ctx = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' });
    try {
      const [module] = await Promise.all([compileRnnoise(), ctx.audioWorklet.addModule(workletUrl)]);
      const node = new AudioWorkletNode(ctx, 'plaudr-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        processorOptions: { module, control: toControl(s) },
      });
      const dest = ctx.createMediaStreamDestination();
      node.connect(dest);
      let micStream = firstMic;
      let source = ctx.createMediaStreamSource(micStream);
      source.connect(node);
      // Ohne Nutzergeste bleibt der Kontext sonst „suspended“ und es geht Stille raus.
      await ctx.resume();

      let last: CaptureActivity = { open: false, vad: 0 };
      const cbs: ((a: CaptureActivity) => void)[] = [];
      node.port.onmessage = (e: MessageEvent<CaptureActivity>) => {
        last = e.data;
        for (const cb of cbs) cb(last);
      };

      return {
        stream: dest.stream,
        processed: true,
        async update(p) {
          const denoiseChanged = p.denoise !== undefined && p.denoise !== settings.denoise;
          settings = { ...settings, ...p };
          node.port.postMessage(toControl(p));
          if (!denoiseChanged) return;
          // Browser-Rauschunterdrückung lässt sich nur beim Öffnen setzen; nur die Quelle tauschen, der Track bleibt.
          const next = await openMic(!settings.denoise);
          if (!next) return;
          source.disconnect();
          micStream.getTracks().forEach((t) => t.stop());
          micStream = next;
          source = ctx.createMediaStreamSource(micStream);
          source.connect(node);
        },
        setPressed: (b) => node.port.postMessage({ pressed: b } satisfies CaptureControl),
        onActivity: (cb) => void cbs.push(cb),
        activity: () => last,
        close() {
          micStream.getTracks().forEach((t) => t.stop());
          void ctx.close();
        },
      };
    } catch (err) {
      void ctx.close();
      throw err;
    }
  }
}

function rawCapture(mic: MediaStream, initial: AudioSettings): Capture {
  let settings = { ...initial };
  let pressed = false;
  const track = mic.getAudioTracks()[0];
  const cbs: ((a: CaptureActivity) => void)[] = [];
  const apply = () => {
    track.enabled = settings.mode === 'vad' || (settings.mode === 'ptt' && pressed);
    for (const cb of cbs) cb({ open: track.enabled, vad: 0 });
  };
  apply();
  return {
    stream: mic,
    processed: false,
    async update(p) {
      settings = { ...settings, ...p };
      apply();
    },
    setPressed(b) {
      pressed = b;
      apply();
    },
    onActivity: (cb) => void cbs.push(cb),
    activity: () => ({ open: track.enabled, vad: 0 }),
    close: () => mic.getTracks().forEach((t) => t.stop()),
  };
}
