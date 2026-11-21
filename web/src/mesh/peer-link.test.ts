import { afterEach, beforeEach, expect, test, vi } from 'vitest';
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
  constructor() { FakePC.last = this; }
  createDataChannel() { return {}; }
  addTransceiver() { return {}; }
  addTrack() { return {}; }
  restartIce() { this.restarts++; }
  close() { this.closed = true; }
  setIce(s: RTCIceConnectionState) {
    this.iceConnectionState = s;
    this.oniceconnectionstatechange?.();
  }
}

let states: RTCPeerConnectionState[];
let link: PeerLink;
let pc: FakePC;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('RTCPeerConnection', FakePC);
  states = [];
  link = new PeerLink({
    peerId: 'B', polite: false, iceServers: [], localStream: null,
    send: () => {}, onTrack: () => {}, onState: (s) => states.push(s),
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
