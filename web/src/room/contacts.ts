export type Contacts = Record<string, { name: string; firstSeen: number }>;

const norm = (n: string) => n.trim().toLowerCase();

/**
 * Trägt einen Teilnehmer ein (Spec §4). keyChanged: Ein bisher unbekannter Schlüssel trägt einen Namen,
 * den schon ein anderer bekannter Schlüssel trägt; typisch nach gelöschten Browserdaten. Rein, ändert c nicht.
 */
export function noteContact(c: Contacts, peerId: string, name: string, now: number): { contacts: Contacts; keyChanged: boolean } {
  const known = c[peerId];
  if (known) return { contacts: { ...c, [peerId]: { ...known, name } }, keyChanged: false };
  const keyChanged = Object.values(c).some((x) => norm(x.name) === norm(name));
  return { contacts: { ...c, [peerId]: { name, firstSeen: now } }, keyChanged };
}
