import workletUrl from './capture.worklet.ts?worker&url';
import type { CaptureActivity, CaptureControl } from './messages';
import { resumeWithin } from './resume';
import { createSwapper } from './swap';
import { RNNOISE_WASM_URL } from './rnnoise-url';
import type { AudioSettings } from './settings';

export interface Capture {
  /** Der eine Track für alle Peers; bleibt bei jedem update derselbe. */
  readonly stream: MediaStream;
  /** false: Worklet oder WASM nicht nutzbar, es geht das Rohmikrofon raus. */
  readonly processed: boolean;
  /** Das Worklet ist im Gespräch ausgefallen; ab jetzt geht das Rohmikrofon raus (gleicher Track). */
  onFallback(cb: () => void): void;
  /** Der Kontext läuft noch nicht (kein Klick bisher): bis resume() geht Stille raus. */
  needsGesture(): boolean;
  /** Im Klick-Handler aufrufen, um den Kontext zu starten. */
  resume(): Promise<void>;
  update(s: Partial<AudioSettings>): Promise<void>;
  setPressed(b: boolean): void;
  onActivity(cb: (a: CaptureActivity) => void): void;
  activity(): CaptureActivity;
  close(): void;
}

const constraints = (noiseSuppression: boolean, deviceId: string | null): MediaStreamConstraints => ({
  audio: {
    echoCancellation: true,
    noiseSuppression,
    autoGainControl: true,
    channelCount: 1,
    ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
  },
});

async function openMic(noiseSuppression: boolean, deviceId: string | null): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia(constraints(noiseSuppression, deviceId));
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
  const mic = await openMic(!settings.denoise, settings.deviceId);
  if (!mic) return null;
  try {
    return await processedCapture(mic, settings);
  } catch (err) {
    console.warn('[plaudr] Audiokette nicht verfügbar, sende Rohmikrofon', err);
    mic.getTracks().forEach((t) => t.stop());
    const raw = (await openMic(true, settings.deviceId)) ?? (await openMic(false, settings.deviceId));
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
      // Ohne Nutzergeste bleibt der Kontext „suspended“ (resume löst dann nie auf): nicht warten, needsGesture meldet es.
      await resumeWithin(ctx, 300);

      let last: CaptureActivity = { open: false, vad: 0 };
      let pressed = false;
      const cbs: ((a: CaptureActivity) => void)[] = [];
      const fallbackCbs: (() => void)[] = [];
      const emit = (a: CaptureActivity) => {
        last = a;
        for (const cb of cbs) cb(a);
      };
      node.port.onmessage = (e: MessageEvent<CaptureActivity>) => emit(e.data);

      // Fällt das Worklet aus (Fehler im Konstruktor oder in process()), gibt es nur noch Stille. Dann das Mikrofon
      // über einen Gain-Knoten direkt auf dasselbe Ziel legen: Stumm und PTT wirken weiter, VAD wirkt wie offen.
      let gain: GainNode | null = null;
      const target = (): AudioNode => gain ?? node;
      const applyGain = () => {
        if (!gain) return;
        const open = settings.mode === 'vad' || (settings.mode === 'ptt' && pressed);
        gain.gain.value = open ? 1 : 0;
        emit({ open, vad: 0 });
      };
      node.onprocessorerror = () => {
        if (gain) return;
        console.warn('[plaudr] Audio-Worklet ausgefallen, sende Rohmikrofon');
        gain = ctx.createGain();
        gain.connect(dest);
        source.disconnect();
        node.disconnect();
        source.connect(gain);
        capture.processed = false;
        applyGain();
        for (const cb of fallbackCbs) cb();
      };

      const swapper = createSwapper<MediaStream>({
        open: () => openMic(!settings.denoise, settings.deviceId),
        apply(next) {
          source.disconnect();
          micStream.getTracks().forEach((t) => t.stop());
          micStream = next;
          source = ctx.createMediaStreamSource(micStream);
          source.connect(target());
        },
        discard: (next) => next.getTracks().forEach((t) => t.stop()),
      });

      const capture = {
        stream: dest.stream,
        processed: true,
        async update(p: Partial<AudioSettings>) {
          const sourceChanged =
            (p.denoise !== undefined && p.denoise !== settings.denoise) ||
            (p.deviceId !== undefined && p.deviceId !== settings.deviceId);
          settings = { ...settings, ...p };
          node.port.postMessage(toControl(p));
          applyGain();
          if (!sourceChanged) return;
          // Rauschunterdrückung und Gerät lassen sich nur beim Öffnen setzen; nur die Quelle tauschen, der Track bleibt.
          await swapper.swap();
        },
        needsGesture: () => ctx.state !== 'running',
        resume: async () => {
          if (!swapper.isClosed()) await ctx.resume();
        },
        setPressed(b: boolean) {
          pressed = b;
          node.port.postMessage({ pressed: b } satisfies CaptureControl);
          applyGain();
        },
        onActivity: (cb: (a: CaptureActivity) => void) => void cbs.push(cb),
        onFallback: (cb: () => void) => void fallbackCbs.push(cb),
        activity: () => last,
        close() {
          if (swapper.isClosed()) return;
          swapper.close();
          micStream.getTracks().forEach((t) => t.stop());
          void ctx.close();
        },
      };
      return capture;
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
    onFallback: () => {},
    needsGesture: () => false,
    resume: async () => {},
    activity: () => ({ open: track.enabled, vad: 0 }),
    close: () => mic.getTracks().forEach((t) => t.stop()),
  };
}
