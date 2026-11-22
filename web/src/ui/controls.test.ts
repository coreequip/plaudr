import { describe, expect, test } from 'vitest';
import { pttHint } from './controls';

describe('Hinweis am PTT-Knopf', () => {
  test('ohne globale Taste: oder Leertaste', () => {
    expect(pttHint(null).join('')).toBe('oder Leertaste');
  });
  test('mit globaler Taste: deren Bezeichnung, auch im Hintergrund', () => {
    expect(pttHint('⌥ Leertaste')).toEqual(['oder ', '⌥ Leertaste', ' überall, auch im Hintergrund']);
  });
});
