export const FALLBACK_STUN: RTCIceServer = { urls: 'stun:stun.l.google.com:19302' };
const TIMEOUT_MS = 3000;

/** Holt kurzlebige TURN-Zugangsdaten von room_ws (`/turn`); ohne Antwort bleibt nur STUN. */
export async function fetchIceServers(
  url: string,
  fetchFn: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<RTCIceServer[]> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
  const request = (async () => {
    try {
      const res = await fetchFn(url, { cache: 'no-store' });
      if (!res.ok) return null;
      const json = (await res.json()) as { iceServers?: unknown };
      return Array.isArray(json.iceServers) ? (json.iceServers as RTCIceServer[]) : null;
    } catch {
      return null;
    }
  })();
  const servers = await Promise.race([request, timeout]);
  return [...(servers ?? []), FALLBACK_STUN];
}
