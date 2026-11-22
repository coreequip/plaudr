export interface PeerStats {
  rttMs: number | null;
  jitterMs: number | null;
  jitterBufferMs: number | null;
  lossPct: number | null;
  candidateType: string | null;
  /** Grobe Mund-zu-Ohr-Schätzung: Frame + ptime + halbe RTT + Jitterpuffer + Wiedergabe. */
  estimateMs: number | null;
}

type Stat = Record<string, any>;

const FRAME_MS = 10;
const PTIME_MS = 20;
const PLAYOUT_MS = 10;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Fasst einen getStats-Report einer PeerConnection für das Debug-Panel zusammen (Spec §6, Messwerte). */
export function summarizeStats(report: Iterable<[string, Stat]> | Map<string, Stat>): PeerStats {
  const all = new Map<string, Stat>(report as Iterable<[string, Stat]>);
  const values = [...all.values()];
  const pair = values.find((s) => s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded');
  const inbound = values.find((s) => s.type === 'inbound-rtp' && s.kind === 'audio');
  const remote = values.find((s) => s.type === 'remote-inbound-rtp' && s.kind === 'audio');

  const rttS = num(pair?.currentRoundTripTime) ?? num(remote?.roundTripTime);
  const rttMs = rttS === null ? null : round1(rttS * 1000);
  const jitter = num(inbound?.jitter);
  const emitted = num(inbound?.jitterBufferEmittedCount);
  const delay = num(inbound?.jitterBufferDelay);
  const jitterBufferMs = emitted && delay !== null ? round1((delay / emitted) * 1000) : null;
  const lost = num(inbound?.packetsLost);
  const received = num(inbound?.packetsReceived);
  const lossPct = lost !== null && received !== null && lost + received > 0 ? round1((lost / (lost + received)) * 100) : null;
  const local = pair ? all.get(pair.localCandidateId) : undefined;

  return {
    rttMs,
    jitterMs: jitter === null ? null : round1(jitter * 1000),
    jitterBufferMs,
    lossPct,
    candidateType: typeof local?.candidateType === 'string' ? local.candidateType : null,
    estimateMs: rttMs !== null && jitterBufferMs !== null ? round1(FRAME_MS + PTIME_MS + rttMs / 2 + jitterBufferMs + PLAYOUT_MS) : null,
  };
}
