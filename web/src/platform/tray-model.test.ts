import { describe, expect, test } from 'vitest';
import type { AppState } from './platform';
import { trayModel } from './tray-model';

const imGespraech: AppState = {
  inCall: true,
  roomTitle: 'Spieleabend',
  peerCount: 2,
  mode: 'ptt',
  sending: false,
  hasMic: true,
};
const keinGespraech: AppState = { inCall: false, roomTitle: null, peerCount: 0, mode: 'ptt', sending: false, hasMic: false };

const eintrag = (m: ReturnType<typeof trayModel>, id: string) => m.items.find((i) => i.id === id)!;

describe('Tray-Menü', () => {
  test('im Gespräch mit zwei anderen: Kopf zählt dich mit, Einträge wie im Mock', () => {
    const m = trayModel(imGespraech, '⌥ Leertaste');
    expect(m.header).toBe('Spieleabend · 3 im Raum');
    expect(m.status).toBe('Push-to-Talk (⌥ Leertaste)');
    expect(m.items.map((i) => i.label)).toEqual([
      'Stumm schalten',
      'Automatisch sprechen',
      'Fenster zeigen',
      'Raum verlassen',
      'plaudr beenden',
    ]);
    expect(m.items.map((i) => i.id)).toEqual(['mute', 'auto', 'show', 'leave', 'quit']);
    expect(m.items.every((i) => i.enabled)).toBe(true);
    expect(m.icon).toBe('idle');
    expect(m.tooltip).toBe('plaudr · Spieleabend · Push-to-Talk (⌥ Leertaste)');
  });

  test('Push-to-Talk ohne globale Taste: Status ohne Klammer', () => {
    expect(trayModel(imGespraech, null).status).toBe('Push-to-Talk');
  });

  test('allein im Raum: 1 im Raum', () => {
    expect(trayModel({ ...imGespraech, peerCount: 0 }, null).header).toBe('Spieleabend · 1 im Raum');
  });

  test('Stumm: Status und Beschriftung „Stummschaltung aufheben“', () => {
    const m = trayModel({ ...imGespraech, mode: 'muted' }, '⌥ Leertaste');
    expect(m.status).toBe('Stumm');
    expect(eintrag(m, 'mute').label).toBe('Stummschaltung aufheben');
    expect(eintrag(m, 'mute').enabled).toBe(true);
  });

  test('Automatisch: Status „Automatisch“', () => {
    expect(trayModel({ ...imGespraech, mode: 'vad' }, '⌥ Leertaste').status).toBe('Automatisch');
  });

  test('kein Gespräch: Kopf „Kein Gespräch“, ohne Status, Stumm/Automatisch/Verlassen gesperrt', () => {
    const m = trayModel(keinGespraech, '⌥ Leertaste');
    expect(m.header).toBe('Kein Gespräch');
    expect(m.status).toBe('');
    expect(m.tooltip).toBe('plaudr · Kein Gespräch');
    expect(eintrag(m, 'mute').enabled).toBe(false);
    expect(eintrag(m, 'auto').enabled).toBe(false);
    expect(eintrag(m, 'leave').enabled).toBe(false);
    expect(eintrag(m, 'show').enabled).toBe(true);
    expect(eintrag(m, 'quit').enabled).toBe(true);
    expect(eintrag(m, 'mute').label).toBe('Stumm schalten');
  });

  test('ohne Mikrofon: „Nur zuhören“, Stumm/Automatisch gesperrt, Verlassen geht', () => {
    const m = trayModel({ ...imGespraech, hasMic: false }, '⌥ Leertaste');
    expect(m.status).toBe('Nur zuhören');
    expect(eintrag(m, 'mute').enabled).toBe(false);
    expect(eintrag(m, 'auto').enabled).toBe(false);
    expect(eintrag(m, 'leave').enabled).toBe(true);
    expect(eintrag(m, 'show').enabled).toBe(true);
    expect(eintrag(m, 'quit').enabled).toBe(true);
  });

  test('sending → grünes Symbol, sonst idle', () => {
    expect(trayModel({ ...imGespraech, sending: true }, null).icon).toBe('sending');
    expect(trayModel({ ...imGespraech, mode: 'vad', sending: true }, null).icon).toBe('sending');
    expect(trayModel(imGespraech, null).icon).toBe('idle');
  });

  test('keine Gedankenstriche in allen Texten', () => {
    const zustaende: AppState[] = [
      imGespraech,
      keinGespraech,
      { ...imGespraech, mode: 'muted' },
      { ...imGespraech, mode: 'vad', sending: true },
      { ...imGespraech, hasMic: false },
    ];
    for (const s of zustaende) {
      for (const label of [null, '⌥ Leertaste', 'Alt+Leertaste']) {
        const m = trayModel(s, label);
        for (const t of [m.header, m.status, m.tooltip, ...m.items.map((i) => i.label)]) {
          expect(t).not.toMatch(/[–—]/);
        }
      }
    }
  });
});
