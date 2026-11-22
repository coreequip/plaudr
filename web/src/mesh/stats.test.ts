import { expect, test } from 'vitest';
import { summarizeStats } from './stats';

const report = (entries: Record<string, unknown>[]) => new Map(entries.map((e) => [e.id as string, e]));

const FULL = report([
  { id: 'p1', type: 'candidate-pair', nominated: false, state: 'failed', currentRoundTripTime: 0.5, localCandidateId: 'l2' },
  { id: 'p2', type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 0.042, localCandidateId: 'l1' },
  { id: 'l1', type: 'local-candidate', candidateType: 'srflx' },
  { id: 'l2', type: 'local-candidate', candidateType: 'relay' },
  { id: 'v1', type: 'inbound-rtp', kind: 'video', jitter: 9, packetsLost: 50, packetsReceived: 50 },
  { id: 'a1', type: 'inbound-rtp', kind: 'audio', jitter: 0.003, jitterBufferDelay: 4.8, jitterBufferEmittedCount: 120, packetsLost: 5, packetsReceived: 95 },
]);

test('wertet das nominierte, erfolgreiche Paar und den Audio-Empfang aus', () => {
  expect(summarizeStats(FULL)).toEqual({
    rttMs: 42,
    jitterMs: 3,
    jitterBufferMs: 40,
    lossPct: 5,
    candidateType: 'srflx',
    estimateMs: 10 + 20 + 21 + 40 + 10,
  });
});

test('leerer Report: alles null, nie NaN', () => {
  expect(summarizeStats(new Map())).toEqual({
    rttMs: null, jitterMs: null, jitterBufferMs: null, lossPct: null, candidateType: null, estimateMs: null,
  });
});

test('ohne Kandidatenpaar kommt die RTT aus remote-inbound-rtp', () => {
  const r = report([{ id: 'r1', type: 'remote-inbound-rtp', kind: 'audio', roundTripTime: 0.03 }]);
  expect(summarizeStats(r).rttMs).toBe(30);
});

test('noch nichts ausgegeben: Jitterpuffer null statt Division durch null', () => {
  const r = report([{ id: 'a1', type: 'inbound-rtp', kind: 'audio', jitterBufferDelay: 0, jitterBufferEmittedCount: 0, packetsLost: 0, packetsReceived: 0 }]);
  expect(summarizeStats(r)).toMatchObject({ jitterBufferMs: null, lossPct: null, estimateMs: null });
});
