import { describe, expect, test } from 'vitest';
import { activeShortcutLabel, detectOs, isDesktop, loadPlatform, type AppActions, type PttShortcut } from './platform';

const actions: AppActions = { setMode: () => {}, setPressed: () => {}, leave: async () => {} };

describe('Plattform', () => {
  test('isDesktop erkennt __TAURI_INTERNALS__', () => {
    expect(isDesktop({ __TAURI_INTERNALS__: {} } as unknown as Window)).toBe(true);
  });
  test('isDesktop ist im Browser false', () => {
    expect(isDesktop({} as Window)).toBe(false);
  });
  test('detectOs liest den User-Agent', () => {
    expect(detectOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('mac');
    expect(detectOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(detectOs('Mozilla/5.0 (X11; Linux x86_64)')).toBe('other');
  });
  test('loadPlatform liefert im Browser kind web', async () => {
    const p = await loadPlatform(actions, {} as Window);
    expect(p.kind).toBe('web');
    expect(() => p.update({ inCall: false, roomTitle: null, peerCount: 0, mode: 'vad', sending: false, hasMic: false })).not.toThrow();
  });
  test('activeShortcutLabel: nur eine wirksame Taste wird genannt', () => {
    const k = (current: string | null, registered: boolean): PttShortcut => ({
      current: () => current,
      registered: () => registered,
      label: (a) => `<${a}>`,
      set: async () => ({ ok: true }),
      onChange: () => {},
    });
    expect(activeShortcutLabel(null)).toBeNull();
    expect(activeShortcutLabel({})).toBeNull();
    expect(activeShortcutLabel({ pttShortcut: k(null, true) })).toBeNull();
    expect(activeShortcutLabel({ pttShortcut: k('Alt+Space', false) })).toBeNull();
    expect(activeShortcutLabel({ pttShortcut: k('Alt+Space', true) })).toBe('<Alt+Space>');
  });
});
