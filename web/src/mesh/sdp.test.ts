import { expect, test } from 'vitest';
import { OPUS_PARAMS, tuneOpus } from './sdp';

/** Audio-Teil eines Chrome-Angebots (gekürzt, Zeilenenden wie im Original). */
const CHROME_OFFER = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126',
  'c=IN IP4 0.0.0.0',
  'a=rtcp:9 IN IP4 0.0.0.0',
  'a=ice-ufrag:abcd',
  'a=ice-pwd:aaaaaaaaaaaaaaaaaaaaaaaa',
  'a=fingerprint:sha-256 11:22:33',
  'a=setup:actpass',
  'a=mid:0',
  'a=sendrecv',
  'a=rtpmap:111 opus/48000/2',
  'a=rtcp-fb:111 transport-cc',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:63 red/48000/2',
  'a=fmtp:63 111/111',
  'a=rtpmap:9 G722/8000',
  'a=rtpmap:0 PCMU/8000',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'a=mid:1',
  '',
].join('\r\n');

const fmtp = (sdp: string, pt: string) => sdp.split('\r\n').find((l) => l.startsWith(`a=fmtp:${pt} `))!;
const params = (line: string) => Object.fromEntries(line.replace(/^a=fmtp:\d+ /, '').split(';').map((kv) => kv.trim().split('=')));

test('setzt alle Opus-Parameter und behält fremde', () => {
  const p = params(fmtp(tuneOpus(CHROME_OFFER), '111'));
  expect(p).toEqual({ minptime: '10', ...OPUS_PARAMS });
  expect(OPUS_PARAMS).toEqual({ stereo: '0', 'sprop-stereo': '0', useinbandfec: '1', usedtx: '1', maxaveragebitrate: '32000' });
});

test('jeder Parameter genau einmal', () => {
  const line = fmtp(tuneOpus(CHROME_OFFER), '111');
  for (const k of Object.keys(OPUS_PARAMS)) expect(line.split(';').filter((kv) => kv.trim().startsWith(k + '='))).toHaveLength(1);
});

test('überschreibt vorhandene Werte (stereo=1 wird stereo=0)', () => {
  const sdp = CHROME_OFFER.replace('minptime=10;useinbandfec=1', 'stereo=1;minptime=10;maxaveragebitrate=510000');
  expect(params(fmtp(tuneOpus(sdp), '111'))).toMatchObject({ stereo: '0', maxaveragebitrate: '32000', minptime: '10' });
});

test('fehlende fmtp-Zeile wird direkt nach der rtpmap-Zeile eingefügt', () => {
  const sdp = CHROME_OFFER.replace('a=fmtp:111 minptime=10;useinbandfec=1\r\n', '');
  const lines = tuneOpus(sdp).split('\r\n');
  const at = lines.indexOf('a=rtpmap:111 opus/48000/2');
  expect(lines[at + 1]).toMatch(/^a=fmtp:111 /);
  expect(params(lines[at + 1])).toEqual(OPUS_PARAMS);
});

test('andere Codecs bleiben unberührt, Zeilenenden bleiben CRLF', () => {
  const out = tuneOpus(CHROME_OFFER);
  expect(fmtp(out, '63')).toBe('a=fmtp:63 111/111');
  expect(out.split('\r\n')).toHaveLength(CHROME_OFFER.split('\r\n').length);
  expect(out.replace(/\r\n/g, '')).not.toContain('\n');
});

test('Groß- und Kleinschreibung des Codecnamens egal, mehrere Opus-Typen', () => {
  const sdp = CHROME_OFFER.replace('a=rtpmap:111 opus/48000/2', 'a=rtpmap:111 OPUS/48000/2').replace(
    'a=rtpmap:9 G722/8000',
    'a=rtpmap:96 opus/48000/2\r\na=rtpmap:9 G722/8000',
  );
  const out = tuneOpus(sdp);
  expect(params(fmtp(out, '111'))).toMatchObject(OPUS_PARAMS);
  expect(params(fmtp(out, '96'))).toEqual(OPUS_PARAMS);
});

test('ohne Opus unverändert, und idempotent', () => {
  const noOpus = CHROME_OFFER.replace('a=rtpmap:111 opus/48000/2', 'a=rtpmap:111 ISAC/16000');
  expect(tuneOpus(noOpus)).toBe(noOpus);
  expect(tuneOpus(tuneOpus(CHROME_OFFER))).toBe(tuneOpus(CHROME_OFFER));
});
