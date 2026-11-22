/** Kürzer gedrückt gilt als Antippen und rastet ein; länger gilt als Halten. */
export const TAP_MS = 300;

/**
 * Push-to-Talk-Knopf mit zwei Bedienarten: halten (sendet bis zum Loslassen) oder kurz antippen (sendet,
 * bis man erneut antippt). Auf dem Telefon ist Antippen bequemer als minutenlanges Halten. Meldet nur Wechsel.
 */
export class PttButton {
  private downAt: number | null = null;
  private pressed = false;
  /** Das Antippen, das eine eingerastete Taste löst, soll beim Loslassen nicht wieder einrasten. */
  private swallowUp = false;
  latched = false;

  constructor(
    private readonly onChange: (pressed: boolean) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  down(): void {
    if (this.latched) {
      this.latched = false;
      this.swallowUp = true;
      this.set(false);
      return;
    }
    this.downAt = this.now();
    this.set(true);
  }

  up(): void {
    if (this.swallowUp) {
      this.swallowUp = false;
      return;
    }
    if (this.downAt === null) return;
    const held = this.now() - this.downAt;
    this.downAt = null;
    if (held < TAP_MS) this.latched = true;
    else this.set(false);
  }

  /** Abbruch, Moduswechsel, Tab im Hintergrund, Leertaste losgelassen: immer lösen. */
  cancel(): void {
    this.downAt = null;
    this.latched = false;
    this.swallowUp = false;
    this.set(false);
  }

  private set(p: boolean): void {
    if (p === this.pressed) return;
    this.pressed = p;
    this.onChange(p);
  }
}
