export type CtlMessage = { type: 'state'; muted: boolean };

const MAX_LENGTH = 1024;

/** Liest eine Nachricht vom Kontrollkanal; null bei allem Unbekannten oder Kaputten, wirft nie. */
export function parseCtl(data: unknown): CtlMessage | null {
  if (typeof data !== 'string' || data.length > MAX_LENGTH) return null;
  try {
    const m: unknown = JSON.parse(data);
    if (typeof m !== 'object' || m === null) return null;
    const { type, muted } = m as Record<string, unknown>;
    if (type === 'state' && typeof muted === 'boolean') return { type, muted };
  } catch {
    // kein JSON
  }
  return null;
}

export function encodeCtl(m: CtlMessage): string {
  return JSON.stringify(m);
}
