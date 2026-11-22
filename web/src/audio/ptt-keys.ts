const PTT_CODE = 'Space';

type KeyLike = Event & { code?: string; repeat?: boolean };

/**
 * Leertaste als Push-to-Talk (Spec §6), nur solange der Tab den Fokus hat. Meldet nur Wechsel; Auto-Repeat und
 * Tippen in Eingabefeldern zählen nicht. Verliert der Tab den Fokus oder wird unsichtbar, gilt die Taste als losgelassen,
 * weil das keyup sonst nie ankommt. Liefert eine Funktion zum Abmelden.
 */
export function bindPttKeys(target: EventTarget, onChange: (pressed: boolean) => void, isTyping: (e: Event) => boolean): () => void {
  let pressed = false;
  const set = (p: boolean) => {
    if (p === pressed) return;
    pressed = p;
    onChange(p);
  };
  const down = (e: KeyLike) => {
    if (e.code !== PTT_CODE || isTyping(e)) return;
    e.preventDefault();
    if (!e.repeat) set(true);
  };
  const up = (e: KeyLike) => {
    if (e.code !== PTT_CODE || !pressed) return;
    e.preventDefault();
    set(false);
  };
  const release = () => set(false);
  const listeners: [string, (e: KeyLike) => void][] = [
    ['keydown', down],
    ['keyup', up],
    ['blur', release],
    ['visibilitychange', release],
  ];
  for (const [t, l] of listeners) target.addEventListener(t, l as EventListener);
  return () => {
    for (const [t, l] of listeners) target.removeEventListener(t, l as EventListener);
  };
}
