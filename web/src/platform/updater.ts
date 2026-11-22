/** Prüfabstand nach dem Start. */
export const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const UPDATE_BUTTON = 'Jetzt aktualisieren';
export const updateText = (version: string) => `Neue Version ${version} verfügbar.`;

/** Ein angebotenes Update (tauri-plugin-updater: Update). */
export interface PendingUpdate {
  readonly version: string;
  /** Lädt und installiert. Unter Windows beendet der Installer die App dabei selbst. */
  downloadAndInstall(): Promise<void>;
  /** Gibt das Update auf der Rust-Seite frei, wenn es nicht installiert wird. */
  close(): Promise<void>;
}

export interface UpdaterDeps {
  check(): Promise<PendingUpdate | null>;
  relaunch(): Promise<void>;
  /** true, solange ein Gespräch läuft oder beginnt: dann wird weder geprüft noch angezeigt noch installiert. */
  inCall(): boolean;
  /** Verlässt den Raum höchstens 1 s lang (wie beim Beenden); lehnt nie ab. */
  leave(): Promise<void>;
  /** Zeigt den Hinweis auf dem Startbildschirm (Version) oder nimmt ihn weg (null). */
  show(version: string | null): void;
  /**
   * true, sobald „Jetzt aktualisieren“ läuft: Bis zum Neustart darf kein Gespräch beginnen (Windows beendet
   * die App beim Installieren, macOS startet neu). false nach einem Fehler.
   */
  busy(on: boolean): void;
  intervalMs?: number;
}

export interface Updater {
  /** Prüft sofort (außerhalb eines Gesprächs). Fehler bleiben eine Warnung in der Konsole. */
  check(): Promise<void>;
  /** „Jetzt aktualisieren“: Raum verlassen, laden und installieren, neu starten. Nie im Gespräch. */
  install(): Promise<void>;
  /** Nach jedem Wechsel des App-Zustands: im Gespräch Hinweis weg, danach wieder da. */
  refresh(): void;
  stop(): void;
}

/** Prüft beim Start und danach alle 6 h; das gefundene Update installiert erst der Knopf. */
export function startUpdater(d: UpdaterDeps): Updater {
  let pending: PendingUpdate | null = null;
  let installing = false;
  let checking = false;

  const drop = (u: PendingUpdate | null) => void u?.close().catch((err) => console.warn('[plaudr] Update nicht freigegeben', err));
  const refresh = () => d.show(pending && !d.inCall() ? pending.version : null);

  async function check(): Promise<void> {
    if (checking || installing || d.inCall()) return;
    checking = true;
    try {
      const u = await d.check();
      // Während der Prüfung hat ein Gespräch begonnen oder das Installieren: verwerfen, die nächste Prüfung kommt.
      if (d.inCall() || installing) return drop(u);
      // Kein Update mehr (etwa zurückgezogen): Hinweis weg.
      if (!u) {
        drop(pending);
        pending = null;
        return refresh();
      }
      drop(pending);
      pending = u;
      refresh();
    } catch (err) {
      console.warn('[plaudr] Suche nach Updates fehlgeschlagen', err);
    } finally {
      checking = false;
    }
  }

  async function install(): Promise<void> {
    const u = pending;
    if (!u || installing || d.inCall()) return;
    installing = true;
    d.busy(true);
    try {
      // Außerhalb eines Gesprächs ist meist nichts zu verlassen; unter Windows beendet der Installer die App
      // aber ohne Vorwarnung, daher sicherheitshalber wie beim Beenden.
      await d.leave();
      await u.downloadAndInstall();
      await d.relaunch();
    } catch (err) {
      console.warn('[plaudr] Update fehlgeschlagen', err);
      installing = false;
      d.busy(false);
    }
  }

  void check();
  const timer = setInterval(() => void check(), d.intervalMs ?? UPDATE_INTERVAL_MS);
  return { check, install, refresh, stop: () => clearInterval(timer) };
}
