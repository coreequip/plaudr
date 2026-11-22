import type { AppState } from './platform';

export type TrayItemId = 'mute' | 'auto' | 'show' | 'leave' | 'quit';

export interface TrayModel {
  /** Erste Zeile: Raum und Anzahl (du zählst mit) oder „Kein Gespräch“. */
  header: string;
  /** Zweite Zeile: Modus; leer außerhalb eines Gesprächs. */
  status: string;
  tooltip: string;
  icon: 'idle' | 'sending';
  items: { id: TrayItemId; label: string; enabled: boolean }[];
}

/** Inhalt des Tray-Menüs (Mock „Tray-Menü“, Spec §7). pttLabel: wirksame globale Taste, sonst null. */
export function trayModel(s: AppState, pttLabel: string | null): TrayModel {
  const header = s.inCall ? `${s.roomTitle ?? 'Raum'} · ${s.peerCount + 1} im Raum` : 'Kein Gespräch';
  const status = !s.inCall
    ? ''
    : !s.hasMic
      ? 'Nur zuhören'
      : s.mode === 'muted'
        ? 'Stumm'
        : s.mode === 'vad'
          ? 'Automatisch'
          : pttLabel
            ? `Push-to-Talk (${pttLabel})`
            : 'Push-to-Talk';
  const speak = s.inCall && s.hasMic;
  return {
    header,
    status,
    tooltip: s.inCall ? `plaudr · ${s.roomTitle ?? 'Raum'} · ${status}` : 'plaudr · Kein Gespräch',
    icon: s.sending ? 'sending' : 'idle',
    items: [
      { id: 'mute', label: s.mode === 'muted' ? 'Stummschaltung aufheben' : 'Stumm schalten', enabled: speak },
      { id: 'auto', label: 'Automatisch sprechen', enabled: speak },
      { id: 'show', label: 'Fenster zeigen', enabled: true },
      { id: 'leave', label: 'Raum verlassen', enabled: s.inCall },
      { id: 'quit', label: 'plaudr beenden', enabled: true },
    ],
  };
}
