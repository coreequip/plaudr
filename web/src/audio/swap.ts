/**
 * Reihenfolge beim Tauschen der Mikrofonquelle: Jeder Tausch öffnet erst ein neues Mikrofon (asynchron).
 * Ein später gestarteter Tausch überholt frühere, und nach close() wird nichts mehr eingehängt;
 * ein dann nicht mehr gebrauchtes Mikrofon wird sofort verworfen (sonst bliebe es eingeschaltet).
 */
export function createSwapper<T>(h: { open(): Promise<T | null>; apply(next: T): void; discard(next: T): void }) {
  let generation = 0;
  let closed = false;
  return {
    async swap(): Promise<void> {
      const mine = ++generation;
      const next = await h.open();
      if (!next) return;
      if (closed || mine !== generation) {
        h.discard(next);
        return;
      }
      h.apply(next);
    },
    close(): void {
      closed = true;
    },
    isClosed: () => closed,
  };
}
