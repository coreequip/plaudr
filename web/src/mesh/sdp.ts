/** Opus für Sprache (Spec §6): mono, FEC, DTX, 32 kbit/s. */
export const OPUS_PARAMS: Readonly<Record<string, string>> = {
  stereo: '0',
  'sprop-stereo': '0',
  useinbandfec: '1',
  usedtx: '1',
  maxaveragebitrate: '32000',
};

const RTPMAP_OPUS = /^a=rtpmap:(\d+) opus\/48000\/2$/i;

/** Setzt die Opus-Parameter in allen fmtp-Zeilen für Opus; fremde Parameter bleiben, fehlende Zeilen entstehen. */
export function tuneOpus(sdp: string): string {
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(eol);
  const opus = new Set(lines.map((l) => RTPMAP_OPUS.exec(l)?.[1]).filter((pt): pt is string => pt !== undefined));
  if (opus.size === 0) return sdp;

  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const fmtp = /^a=fmtp:(\d+) (.*)$/.exec(line);
    if (fmtp && opus.has(fmtp[1])) {
      seen.add(fmtp[1]);
      out.push(`a=fmtp:${fmtp[1]} ${merge(fmtp[2])}`);
    } else {
      out.push(line);
    }
  }
  // Fehlende fmtp-Zeilen direkt hinter der rtpmap-Zeile ergänzen.
  for (const pt of opus) {
    if (seen.has(pt)) continue;
    const at = out.findIndex((l) => RTPMAP_OPUS.exec(l)?.[1] === pt);
    out.splice(at + 1, 0, `a=fmtp:${pt} ${merge('')}`);
  }
  return out.join(eol);
}

function merge(existing: string): string {
  const params = new Map<string, string>();
  for (const kv of existing.split(';')) {
    const [k, ...v] = kv.trim().split('=');
    if (k) params.set(k, v.join('='));
  }
  for (const [k, v] of Object.entries(OPUS_PARAMS)) params.set(k, v);
  return [...params].map(([k, v]) => `${k}=${v}`).join(';');
}
