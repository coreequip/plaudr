import { describe, expect, test } from 'vitest';
import { encodeCtl, parseCtl } from './ctl';

describe('parseCtl', () => {
  test('liest eine gültige state-Nachricht', () => {
    expect(parseCtl('{"type":"state","muted":true}')).toEqual({ type: 'state', muted: true });
    expect(parseCtl('{"type":"state","muted":false}')).toEqual({ type: 'state', muted: false });
  });
  test.each([
    ['kein JSON', 'kein json'],
    ['muted kein Boolean', '{"type":"state","muted":"ja"}'],
    ['unbekannter Typ', '{"type":"x"}'],
    ['null', 'null'],
    ['Zahl', 42],
    ['ArrayBuffer', new ArrayBuffer(8)],
    ['zu langer String', 'x'.repeat(2000)],
    ['zu lang trotz gültigem JSON', '{"type":"state","muted":true,"x":"' + 'a'.repeat(1100) + '"}'],
    ['undefined', undefined],
  ])('gibt null für %s', (_n, input) => {
    expect(parseCtl(input)).toBeNull();
  });
  test('encodeCtl und parseCtl sind zueinander passend', () => {
    expect(parseCtl(encodeCtl({ type: 'state', muted: true }))).toEqual({ type: 'state', muted: true });
  });
});
