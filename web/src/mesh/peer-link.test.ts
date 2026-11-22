import { describe, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PeerLink } from './peer-link';

class FakePC {
  static last: FakePC;
  iceConnectionState: RTCIceConnectionState = 'new';
  connectionState: RTCPeerConnectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  restarts = 0;
  closed = false;
  onicecandidate: unknown = null;
  onnegotiationneeded: unknown = null;
  ontrack: unknown = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  slds: RTCSessionDescriptionInit[] = [];
  /** Wird in createOffer ausgeführt, bevor das Angebot zurückkommt (zum Simulieren von Glare). */
  duringCreateOffer: () => void = () => {};
  added: string[] = [];
  constructor() { FakePC.last = this; }
  async addIceCandidate(c: RTCIceCandidateInit) {
    if (c.candidate === 'kaputt') throw new Error('kaputter Kandidat');
    this.added.push(c.candidate!);
  }
  async createOffer() {
    this.duringCreateOffer();
    return { type: 'offer' as const, sdp: OPUS_SDP };
  }
  async createAnswer() { return { type: 'answer' as const, sdp: OPUS_SDP }; }
  async setLocalDescription(d: RTCSessionDescriptionInit) {
    this.slds.push(d);
    this.localDescription = d;
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
  channel: { readyState: string; sent: string[]; send(d: string): void; onopen?: () => void; onmessage?: (e: { data: unknown }) => void } = {
    readyState: 'connecting', sent: [], send(d: string) { this.sent.push(d); },
  };
  createDataChannel() { return this.channel; }
  addTransceiver() { return {}; }
  addTrack() { return {}; }
  restartIce() { this.restarts++; }
  close() { this.closed = true; }
  setIce(s: RTCIceConnectionState) {
    this.iceConnectionState = s;
    this.oniceconnectionstatechange?.();
  }
}

const OPUS_SDP = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\n';

let states: RTCPeerConnectionState[];
let sent: { kind: string; body: any }[];
let link: PeerLink;
let pc: FakePC;
let remoteStates: number;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('RTCPeerConnection', FakePC);
  states = [];
  remoteStates = 0;
  sent = [];
  link = new PeerLink({
    peerId: 'B', polite: false, iceServers: [], localStream: null,
    send: (kind, body) => sent.push({ kind, body }), onTrack: () => {}, onState: (s) => states.push(s),
    onRemoteState: () => remoteStates++,
  });
  pc = FakePC.last;
});
afterEach(() => {
  link.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('ICE failed startet ICE neu', () => {
  pc.setIce('failed');
  expect(pc.restarts).toBe(1);
  expect(states).not.toContain('failed');
});

test('ein unbeantworteter Neustart zählt nach 10 s als weiterer Fehlschlag, nach dem dritten ist der Link failed', () => {
  pc.setIce('failed');
  pc.setIce('checking');
  vi.advanceTimersByTime(10_000);
  expect(pc.restarts).toBe(2);
  vi.advanceTimersByTime(10_000);
  expect(states).toEqual(['failed']);
  expect(pc.restarts).toBe(2);
});

test('Verbindung innerhalb der Frist setzt den Zähler zurück', () => {
  pc.setIce('failed');
  vi.advanceTimersByTime(5_000);
  pc.setIce('connected');
  vi.advanceTimersByTime(60_000);
  expect(pc.restarts).toBe(1);
  expect(states).toEqual([]);
});

test('close stoppt die Überwachung', () => {
  pc.setIce('failed');
  link.close();
  vi.advanceTimersByTime(60_000);
  expect(pc.restarts).toBe(1);
  expect(states).toEqual([]);
});

const negotiate = () => (pc.onnegotiationneeded as () => Promise<void>)();
const payload = (kind: 'offer' | 'answer', sdp: string) =>
  ({ kind, from: 'B', to: 'A', cid: 'c', ts: 0, nonce: 'n', body: { sdp } }) as const;

test('gesendetes Angebot ist für Opus abgestimmt', async () => {
  await negotiate();
  expect(sent.map((m) => m.kind)).toEqual(['offer']);
  expect(sent[0].body.sdp).toContain('usedtx=1');
  expect(sent[0].body.sdp).toContain('maxaveragebitrate=32000');
  expect(pc.slds[0]).toEqual({ type: 'offer', sdp: sent[0].body.sdp });
});

test('gesendete Antwort ist für Opus abgestimmt', async () => {
  await link.handle(payload('offer', OPUS_SDP));
  expect(sent.map((m) => m.kind)).toEqual(['answer']);
  expect(sent[0].body.sdp).toContain('usedtx=1');
  expect(pc.slds[0].type).toBe('answer');
});

test('wird der Zustand während createOffer instabil, geht kein Angebot raus', async () => {
  pc.duringCreateOffer = () => (pc.signalingState = 'have-remote-offer');
  await negotiate();
  expect(sent).toEqual([]);
  expect(pc.slds).toEqual([]);
});

test('ontrack setzt den Jitterpuffer-Zielwert auf 0', () => {
  const receiver = { jitterBufferTarget: 200 as number | null };
  (pc.ontrack as (e: unknown) => void)({ receiver, streams: [{}], track: {} });
  expect(receiver.jitterBufferTarget).toBe(0);
});

test('ein kaputter Kandidat im Bündel verwirft die anderen nicht', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await link.handle({ kind: 'ice', from: 'B', to: 'A', cid: 'c', ts: 0, nonce: 'n', body: { c: [{ candidate: 'eins' }, { candidate: 'kaputt' }, { candidate: 'drei' }] } });
  expect(pc.added).toEqual(['eins', 'drei']);
});

describe('Kontrollkanal', () => {
  const open = () => { pc.channel.readyState = 'open'; pc.channel.onopen!(); };
  test('Stumm-Status vor open wird nur gemerkt und beim Öffnen gesendet', () => {
    link.setLocalMuted(true);
    expect(pc.channel.sent).toEqual([]);
    open();
    expect(pc.channel.sent).toEqual(['{"type":"state","muted":true}']);
  });
  test('jede Änderung nach open wird gesendet', () => {
    open();
    link.setLocalMuted(true);
    link.setLocalMuted(false);
    expect(pc.channel.sent.map((s) => JSON.parse(s).muted)).toEqual([false, true, false]);
  });
  test('empfangener state setzt remoteMuted und meldet die Änderung, Unbekanntes nicht', () => {
    pc.channel.onmessage!({ data: '{"type":"state","muted":true}' });
    expect(link.remoteMuted).toBe(true);
    expect(remoteStates).toBe(1);
    pc.channel.onmessage!({ data: 'müll' });
    pc.channel.onmessage!({ data: new ArrayBuffer(4) });
    expect(link.remoteMuted).toBe(true);
    expect(remoteStates).toBe(1);
  });
});
