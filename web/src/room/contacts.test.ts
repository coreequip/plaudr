import { expect, test } from 'vitest';
import { noteContact, type Contacts } from './contacts';

const T0 = 1_000;
const T1 = 2_000;

test('neuer Kontakt wird mit firstSeen eingetragen', () => {
  const r = noteContact({}, 'p1', 'Anna', T0);
  expect(r).toEqual({ contacts: { p1: { name: 'Anna', firstSeen: T0 } }, keyChanged: false });
});

test('bekannter peerId mit neuem Namen: Name aktualisiert, firstSeen bleibt', () => {
  const c: Contacts = { p1: { name: 'Anna', firstSeen: T0 } };
  expect(noteContact(c, 'p1', 'Anni', T1)).toEqual({ contacts: { p1: { name: 'Anni', firstSeen: T0 } }, keyChanged: false });
});

test('unbekannter peerId mit dem Namen eines anderen: Schlüsselwechsel', () => {
  const c: Contacts = { p1: { name: 'Anna', firstSeen: T0 } };
  const r = noteContact(c, 'p2', 'Anna', T1);
  expect(r.keyChanged).toBe(true);
  expect(r.contacts.p2).toEqual({ name: 'Anna', firstSeen: T1 });
  expect(r.contacts.p1).toEqual({ name: 'Anna', firstSeen: T0 });
});

test('derselbe Fall ein zweites Mal meldet nichts mehr', () => {
  const first = noteContact({ p1: { name: 'Anna', firstSeen: T0 } }, 'p2', 'Anna', T1).contacts;
  expect(noteContact(first, 'p2', 'Anna', T1 + 1).keyChanged).toBe(false);
});

test('Namensvergleich ignoriert Groß- und Kleinschreibung und Leerraum am Rand', () => {
  expect(noteContact({ p1: { name: 'Anna', firstSeen: T0 } }, 'p2', '  anna ', T1).keyChanged).toBe(true);
});

test('verändert die Eingabe nicht', () => {
  const c: Contacts = { p1: { name: 'Anna', firstSeen: T0 } };
  noteContact(c, 'p2', 'Bert', T1);
  noteContact(c, 'p1', 'Anni', T1);
  expect(c).toEqual({ p1: { name: 'Anna', firstSeen: T0 } });
});
