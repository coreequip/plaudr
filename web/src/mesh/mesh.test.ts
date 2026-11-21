import { beforeEach, describe, expect, test } from 'vitest';
import { Mesh, type SignalingLike } from './mesh';
import type { PeerLinkLike, PeerLinkOptions } from './peer-link';
import type { Bodies, Kind, Payload } from '../signaling/types';

class FakeSignaling implements SignalingLike {
  sent: { kind: Kind; to: string; body: unknown }[] = [];
  closed = false;
  ready: ((cid: string) => void)[] = [];
  msg: ((p: Payload) => void)[] = [];
  leave: ((cid: string) => void)[] = [];
  send<K extends Kind>(kind: K, to: string, body: Bodies[K]) {
    this.sent.push({ kind, to, body });
  }
  onReady(cb: (cid: string) => void) { this.ready.push(cb); }
  onMessage(cb: (p: Payload) => void) { this.msg.push(cb); }
  onLeave(cb: (cid: string) => void) { this.leave.push(cb); }
  close() { this.closed = true; }
  emitMsg(p: Partial<Payload> & Pick<Payload, 'kind' | 'from'>) {
    const full = { to: '*', cid: 'c-' + p.from, ts: 0, nonce: '', body: {}, ...p } as Payload;
    for (const cb of this.msg) cb(full);
  }
}

class FakeLink implements PeerLinkLike {
  cid = '';
  name = '';
  state: RTCPeerConnectionState = 'new';
  handled: Payload[] = [];
  closed = false;
  constructor(readonly opts: PeerLinkOptions) {}
  get peerId() { return this.opts.peerId; }
  async handle(p: Payload) { this.handled.push(p); }
  close() { this.closed = true; }
}

let sig: FakeSignaling;
let links: FakeLink[];
let gone: string[];
let mesh: Mesh;

const hello = (from: string, cid = 'c-' + from, name = from) =>
  sig.emitMsg({ kind: 'hello', from, cid, body: { name } });
const linksFor = (id: string) => links.filter((l) => l.peerId === id);
const live = (id: string) => linksFor(id).filter((l) => !l.closed);

beforeEach(() => {
  sig = new FakeSignaling();
  links = [];
  gone = [];
  mesh = new Mesh({
    signaling: sig, selfId: 'M', name: 'Mira', localStream: null, iceServers: [],
    createLink: (o) => { const l = new FakeLink(o); links.push(l); return l; },
    onTrack: () => {}, onPeerGone: (id) => gone.push(id), onChange: () => {},
  });
  mesh.start();
});

test('ready schickt hello an alle', () => {
  sig.ready.forEach((cb) => cb('c-self'));
  expect(sig.sent).toEqual([{ kind: 'hello', to: '*', body: { name: 'Mira' } }]);
});

describe('hello', () => {
  test('legt für einen unbekannten Peer einen Link an, polite = kleinere peerId', () => {
    hello('Z');
    hello('A');
    expect(linksFor('Z')[0].opts.polite).toBe(true); // 'M' < 'Z'
    expect(linksFor('A')[0].opts.polite).toBe(false);
    expect(mesh.peers().map((p) => [p.peerId, p.name]).sort()).toEqual([['A', 'A'], ['Z', 'Z']]);
  });
  test('erneutes hello nach Reconnect legt keinen zweiten Link an und aktualisiert cid', () => {
    hello('B', 'c-old');
    hello('B', 'c-new', 'Bea');
    expect(linksFor('B')).toHaveLength(1);
    expect(linksFor('B')[0].cid).toBe('c-new');
    expect(linksFor('B')[0].name).toBe('Bea');
  });
  test('beantwortet hello eines Unbekannten direkt mit eigenem Namen, ein bekanntes nicht', () => {
    hello('B');
    hello('B', 'c-new');
    expect(sig.sent).toEqual([{ kind: 'hello', to: 'B', body: { name: 'Mira' } }]);
  });
  test('an mich gerichtetes hello eines Unbekannten legt keinen Link an, liefert aber den Namen fürs offer', () => {
    sig.emitMsg({ kind: 'hello', from: 'C', to: 'M', body: { name: 'Cem' } });
    expect(links).toHaveLength(0);
    expect(sig.sent).toEqual([]);
    sig.emitMsg({ kind: 'offer', from: 'C', body: { sdp: 'x' } });
    expect(mesh.peers()).toEqual([{ peerId: 'C', name: 'Cem', state: 'new' }]);
  });
  test('ein Peer aus einem offer bekommt seinen Namen aus dem späteren hello', () => {
    sig.emitMsg({ kind: 'offer', from: 'C', body: { sdp: 'x' } });
    hello('C', 'c-C', 'Cem');
    expect(mesh.peers()).toEqual([{ peerId: 'C', name: 'Cem', state: 'new' }]);
  });
  test('eigene Nachrichten werden ignoriert', () => {
    hello('M');
    expect(links).toHaveLength(0);
  });
});

describe('Abbau', () => {
  test('leave der alten cid nach Reconnect lässt den Link bestehen, leave der neuen schließt ihn', () => {
    hello('B', 'c-old');
    hello('B', 'c-new');
    sig.leave.forEach((cb) => cb('c-old'));
    expect(live('B')).toHaveLength(1);
    sig.leave.forEach((cb) => cb('c-new'));
    expect(live('B')).toHaveLength(0);
    expect(gone).toEqual(['B']);
    expect(mesh.peers()).toEqual([]);
  });
  test('bye schließt den Link', () => {
    hello('B');
    sig.emitMsg({ kind: 'bye', from: 'B' });
    expect(live('B')).toHaveLength(0);
    expect(gone).toEqual(['B']);
  });
});

describe('Verhandlung', () => {
  test('offer von Unbekanntem legt Link an und reicht es weiter', () => {
    sig.emitMsg({ kind: 'offer', from: 'C', body: { sdp: 'x' } });
    expect(linksFor('C')).toHaveLength(1);
    expect(linksFor('C')[0].handled.map((p) => p.kind)).toEqual(['offer']);
    expect(linksFor('C')[0].cid).toBe('c-C');
  });
  test('ice und answer von Unbekanntem werden ignoriert', () => {
    sig.emitMsg({ kind: 'ice', from: 'D', body: { c: [] } });
    sig.emitMsg({ kind: 'answer', from: 'D', body: { sdp: 'x' } });
    expect(links).toHaveLength(0);
  });
  test.each([
    ['hello', 'offer'],
    ['offer', 'hello'],
  ])('%s und %s vom selben Peer ergeben genau einen Link', (a, b) => {
    for (const k of [a, b]) {
      if (k === 'hello') hello('B');
      else sig.emitMsg({ kind: 'offer', from: 'B', body: { sdp: 'x' } });
    }
    expect(linksFor('B')).toHaveLength(1);
  });
  test('send des Links adressiert den Peer', () => {
    hello('B');
    linksFor('B')[0].opts.send('ice', { c: [] });
    expect(sig.sent).toContainEqual({ kind: 'ice', to: 'B', body: { c: [] } });
  });
});

describe('Fehlschlag', () => {
  test('nicht-polite Seite baut den Link neu auf', () => {
    hello('A', 'c-a', 'Anna'); // 'M' > 'A' → nicht polite
    linksFor('A')[0].opts.onState('failed');
    expect(linksFor('A')).toHaveLength(2);
    expect(linksFor('A')[0].closed).toBe(true);
    expect(live('A')[0]).toMatchObject({ cid: 'c-a', name: 'Anna' });
  });
  test('polite Seite schließt nur und wartet auf das neue Angebot', () => {
    hello('Z');
    linksFor('Z')[0].opts.onState('failed');
    expect(linksFor('Z')).toHaveLength(1);
    expect(live('Z')).toHaveLength(0);
    expect(gone).toEqual(['Z']);
  });
  test('Zustandsmeldungen eines alten Links werden ignoriert', () => {
    hello('A');
    const old = linksFor('A')[0];
    old.opts.onState('failed');
    old.opts.onState('closed');
    expect(live('A')).toHaveLength(1);
  });
});

test('leave verabschiedet sich und räumt auf', () => {
  hello('B');
  mesh.leave();
  expect(sig.sent).toContainEqual({ kind: 'bye', to: '*', body: {} });
  expect(linksFor('B')[0].closed).toBe(true);
  expect(sig.closed).toBe(true);
});
