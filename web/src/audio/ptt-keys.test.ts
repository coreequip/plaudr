import { beforeEach, expect, test } from 'vitest';
import { bindPttKeys } from './ptt-keys';

let target: EventTarget;
let changes: boolean[];
let typing: boolean;
let active: boolean;
let unbind: () => void;

const key = (type: 'keydown' | 'keyup', code = 'Space', repeat = false) => {
  const e = Object.assign(new Event(type, { cancelable: true }), { code, repeat });
  target.dispatchEvent(e);
  return e;
};

beforeEach(() => {
  target = new EventTarget();
  changes = [];
  typing = false;
  active = true;
  unbind = bindPttKeys(target, (p) => changes.push(p), () => typing, () => active);
});

test('Drücken und Loslassen der Leertaste', () => {
  key('keydown');
  key('keyup');
  expect(changes).toEqual([true, false]);
});

test('Auto-Repeat meldet nichts zusätzlich', () => {
  key('keydown');
  key('keydown', 'Space', true);
  key('keydown', 'Space', true);
  key('keyup');
  expect(changes).toEqual([true, false]);
});

test('andere Tasten zählen nicht', () => {
  key('keydown', 'KeyA');
  key('keyup', 'KeyA');
  expect(changes).toEqual([]);
});

test('beim Tippen in Eingabefeldern keine PTT', () => {
  typing = true;
  const e = key('keydown');
  key('keyup');
  expect(changes).toEqual([]);
  expect(e.defaultPrevented).toBe(false);
});

test('Fokusverlust bei gedrückter Taste lässt los, bei losgelassener nichts', () => {
  key('keydown');
  target.dispatchEvent(new Event('blur'));
  expect(changes).toEqual([true, false]);
  target.dispatchEvent(new Event('blur'));
  target.dispatchEvent(new Event('visibilitychange'));
  expect(changes).toEqual([true, false]);
  key('keyup');
  expect(changes).toEqual([true, false]);
});

test('Tab wird unsichtbar: lässt los', () => {
  key('keydown');
  target.dispatchEvent(new Event('visibilitychange'));
  expect(changes).toEqual([true, false]);
});

test('Leertaste scrollt nicht (preventDefault)', () => {
  expect(key('keydown').defaultPrevented).toBe(true);
  expect(key('keyup').defaultPrevented).toBe(true);
});

test('Abmelden entfernt alle Listener', () => {
  unbind();
  key('keydown');
  expect(changes).toEqual([]);
});

test('außerhalb des PTT-Modus bleibt die Leertaste frei (kein preventDefault, keine Meldung)', () => {
  active = false;
  const e = key('keydown');
  key('keyup');
  expect(changes).toEqual([]);
  expect(e.defaultPrevented).toBe(false);
});

test('Loslassen kommt auch an, wenn der PTT-Modus inzwischen verlassen wurde', () => {
  key('keydown');
  active = false;
  key('keyup');
  expect(changes).toEqual([true, false]);
});
