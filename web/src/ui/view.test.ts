import { describe, expect, it } from 'vitest';
import { initial, peerStateText } from './view';

describe('peerStateText', () => {
  it('Verbindungsprobleme stehen vor stumm geschaltet', () => {
    expect(peerStateText({ state: 'disconnected', muted: true, speaking: false })).toBe('unterbrochen');
    expect(peerStateText({ state: 'failed', muted: true, speaking: false })).toBe('fehlgeschlagen');
    expect(peerStateText({ state: 'connecting', muted: true, speaking: true })).toBe('verbindet …');
  });
  it('verbunden: stumm geschaltet vor spricht vor verbunden', () => {
    expect(peerStateText({ state: 'connected', muted: true, speaking: true })).toBe('stumm geschaltet');
    expect(peerStateText({ state: 'connected', muted: false, speaking: true })).toBe('spricht');
    expect(peerStateText({ state: 'connected', muted: false, speaking: false })).toBe('verbunden');
  });
});

describe('initial', () => {
  it('nimmt den ersten Buchstaben groß', () => {
    expect(initial(' anna')).toBe('A');
    expect(initial('')).toBe('?');
  });
});
