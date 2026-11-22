import type { CaptureActivity } from '../audio/messages';
import type { AudioSettings } from '../audio/settings';
import type { PeerView } from '../mesh/mesh';
import type { PeerStats } from '../mesh/stats';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const COLUMNS: (keyof PeerStats)[] = ['rttMs', 'jitterMs', 'jitterBufferMs', 'lossPct', 'candidateType', 'estimateMs'];
const fmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

function cell(k: keyof PeerStats, v: number | string | null): string {
  if (v === null) return 'n. v.';
  if (typeof v === 'string') return v;
  return k === 'lossPct' ? `${fmt.format(v)} %` : `${fmt.format(v)} ms`;
}

export interface DebugOptions {
  peers: () => PeerView[];
  stats: () => Promise<Record<string, PeerStats>>;
  activity: () => CaptureActivity;
  settings: () => AudioSettings;
  setSettings: (p: Partial<AudioSettings>) => Promise<void>;
}

/** Debug-Panel (Spec §6, Messwerte); aktualisiert sich nur, solange es geöffnet ist. */
export function initDebug(o: DebugOptions): () => void {
  const panel = $<HTMLDetailsElement>('debug');
  const body = $('debug-table').querySelector('tbody')!;
  const preroll = $<HTMLInputElement>('debug-preroll');
  preroll.checked = o.settings().preroll;
  preroll.onchange = () => void o.setSettings({ preroll: preroll.checked });

  const update = async () => {
    if (!panel.open) return;
    const stats = await o.stats();
    body.replaceChildren(
      ...o.peers().map((p) => {
        const tr = document.createElement('tr');
        const name = document.createElement('td');
        name.textContent = p.name || 'Unbekannt';
        tr.append(name);
        for (const k of COLUMNS) {
          const td = document.createElement('td');
          td.dataset.k = k;
          td.textContent = cell(k, stats[p.peerId]?.[k] ?? null);
          tr.append(td);
        }
        return tr;
      }),
    );
    $('debug-vad').textContent = `Eigene Sprachwahrscheinlichkeit: ${fmt.format(o.activity().vad)}`;
  };
  panel.ontoggle = () => void update();
  const timer = setInterval(() => void update(), 1000);
  return () => clearInterval(timer);
}
