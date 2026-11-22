import { expect, test } from 'vitest';
import { micChoices } from './devices';

const dev = (deviceId: string, label: string, kind = 'audioinput') => ({ kind, deviceId, label });

test('gemerktes Gerät fehlt: Standardgerät ist ausgewählt', () => {
  const r = micChoices([dev('a', 'Headset')], 'weg');
  expect(r).toEqual([
    { value: '', label: 'Standardgerät', selected: true },
    { value: 'a', label: 'Headset', selected: false },
  ]);
});

test('gemerktes Gerät vorhanden: es ist ausgewählt', () => {
  const r = micChoices([dev('a', 'Headset'), dev('b', 'USB')], 'b');
  expect(r.map((c) => c.selected)).toEqual([false, false, true]);
});

test('leere Labels werden nummeriert', () => {
  const r = micChoices([dev('a', ''), dev('b', 'USB'), dev('c', '')], null);
  expect(r.map((c) => c.label)).toEqual(['Standardgerät', 'Mikrofon 1', 'USB', 'Mikrofon 3']);
});

test('default, communications und Nicht-Eingänge fehlen in der Liste', () => {
  const r = micChoices([dev('default', 'Standard'), dev('communications', 'Komm'), dev('x', 'Lautsprecher', 'audiooutput'), dev('a', 'Headset')], null);
  expect(r.map((c) => c.value)).toEqual(['', 'a']);
});
