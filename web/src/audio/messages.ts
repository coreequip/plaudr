import type { SpeakMode } from './gate';

/** Hauptthread → Worklet. */
export interface CaptureControl {
  mode?: SpeakMode;
  pressed?: boolean;
  threshold?: number;
  preroll?: boolean;
  denoise?: boolean;
}

/** Worklet → Hauptthread, höchstens alle 50 ms und bei jedem Wechsel von open. */
export interface CaptureActivity {
  open: boolean;
  vad: number;
}
