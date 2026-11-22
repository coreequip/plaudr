import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { startUpdater, UPDATE_FAILED, updateText, UPDATE_INTERVAL_MS, type PendingUpdate, type UpdaterDeps } from './updater';

const flush = () => vi.advanceTimersByTimeAsync(0);

function setup(over: Partial<UpdaterDeps> = {}) {
  const log: string[] = [];
  let call = false;
  const update = (version: string): PendingUpdate => ({
    version,
    downloadAndInstall: async () => void log.push(`install ${version}`),
    close: async () => void log.push(`close ${version}`),
  });
  let next: PendingUpdate | null = update('0.2.0');
  const deps: UpdaterDeps = {
    check: async () => {
      log.push('check');
      return next;
    },
    relaunch: async () => void log.push('relaunch'),
    inCall: () => call,
    leave: async () => void log.push('leave'),
    show: (v) => log.push(`show ${v}`),
    busy: (on) => log.push(`busy ${on}`),
    failed: () => log.push('failed'),
    ...over,
  };
  return {
    log,
    deps,
    update,
    setNext: (u: PendingUpdate | null) => (next = u),
    setCall: (b: boolean) => (call = b),
  };
}

describe('startUpdater', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('Text des Hinweises', () => {
    expect(updateText('0.2.0')).toBe('Neue Version 0.2.0 verfügbar.');
    expect(UPDATE_FAILED).toBe('Das Update ist fehlgeschlagen. Versuch es später noch einmal.');
  });

  test('prüft beim Start, zeigt die Version, prüft alle 6 h wieder', async () => {
    const t = setup();
    const u = startUpdater(t.deps);
    await flush();
    expect(t.log).toEqual(['check', 'show 0.2.0']);
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS - 1);
    expect(t.log.filter((l) => l === 'check')).toHaveLength(1);
    t.setNext(t.update('0.3.0'));
    await vi.advanceTimersByTimeAsync(1);
    // Das alte Update wird freigegeben, das neue angezeigt.
    expect(t.log.slice(2)).toEqual(['check', 'close 0.2.0', 'show 0.3.0']);
    u.stop();
  });

  test('Update zurückgezogen: Hinweis verschwindet bei der nächsten Prüfung', async () => {
    const t = setup();
    const u = startUpdater(t.deps);
    await flush();
    t.setNext(null);
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS);
    expect(t.log).toEqual(['check', 'show 0.2.0', 'check', 'close 0.2.0', 'show null']);
    u.stop();
  });

  test('kein Update: kein Hinweis', async () => {
    const t = setup();
    t.setNext(null);
    startUpdater(t.deps).stop();
    await flush();
    expect(t.log).toEqual(['check', 'show null']);
  });

  test('im Gespräch: keine Prüfung, kein Hinweis, keine Installation', async () => {
    const t = setup();
    t.setCall(true);
    const u = startUpdater(t.deps);
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS);
    await u.install();
    expect(t.log).toEqual([]);
    u.stop();
  });

  test('Gespräch beginnt während der Prüfung: Update verworfen', async () => {
    const t = setup();
    let resolve!: (x: PendingUpdate | null) => void;
    t.deps.check = () => new Promise((r) => (resolve = r));
    const u = startUpdater(t.deps);
    t.setCall(true);
    resolve(t.update('0.2.0'));
    await flush();
    await u.install();
    expect(t.log).toEqual(['close 0.2.0']);
    u.stop();
  });

  test('Hinweis verschwindet im Gespräch und kommt danach zurück', async () => {
    const t = setup();
    const u = startUpdater(t.deps);
    await flush();
    t.setCall(true);
    u.refresh();
    t.setCall(false);
    u.refresh();
    expect(t.log).toEqual(['check', 'show 0.2.0', 'show null', 'show 0.2.0']);
    u.stop();
  });

  test('Knopf: erst Raum verlassen, dann installieren, dann neu starten; nur einmal', async () => {
    const t = setup();
    const u = startUpdater(t.deps);
    await flush();
    await Promise.all([u.install(), u.install()]);
    expect(t.log.slice(2)).toEqual(['busy true', 'leave', 'install 0.2.0', 'relaunch']);
    // Während der Installation keine neue Prüfung.
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS);
    expect(t.log.filter((l) => l === 'check')).toHaveLength(1);
    u.stop();
  });

  test('Fehler bei der Prüfung bleiben still (nur Warnung)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = setup({ check: async () => Promise.reject(new Error('offline')) });
    startUpdater(t.deps).stop();
    await flush();
    expect(t.log).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  test('Fehler bei der Installation: Knopf wieder frei, Hinweis, kein Neustart', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = setup();
    t.setNext({ version: '0.2.0', downloadAndInstall: () => Promise.reject(new Error('Signatur ungültig')), close: async () => {} });
    const u = startUpdater(t.deps);
    await flush();
    await u.install();
    expect(t.log).toEqual(['check', 'show 0.2.0', 'busy true', 'leave', 'busy false', 'failed']);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    u.stop();
  });
});
