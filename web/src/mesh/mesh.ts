import type { Signaling } from '../signaling/signaling';
import type { Bodies, Payload } from '../signaling/types';
import { PeerLink, type PeerLinkLike, type PeerLinkOptions } from './peer-link';

const LEAVE_GRACE_MS = 5000;

export type SignalingLike = Pick<Signaling, 'send' | 'onReady' | 'onMessage' | 'onLeave' | 'close'>;

export interface PeerView {
  peerId: string;
  name: string;
  state: RTCPeerConnectionState;
}

export interface MeshOptions {
  signaling: SignalingLike;
  selfId: string;
  selfPub: string;
  name: string;
  localStream: MediaStream | null;
  iceServers: RTCIceServer[];
  createLink?: (o: PeerLinkOptions) => PeerLinkLike;
  onTrack: (peerId: string, s: MediaStream) => void;
  onPeerGone: (peerId: string) => void;
  onChange: (peers: PeerView[]) => void;
  /** Jedes geprüfte hello eines anderen Teilnehmers, etwa für die Kontaktliste. */
  onHello?: (peerId: string, name: string) => void;
}

/** Hält zu jedem anderen Teilnehmer genau einen PeerLink (Full Mesh). */
export class Mesh {
  private readonly links = new Map<string, PeerLinkLike>();
  private readonly pendingNames = new Map<string, string>();
  private readonly leaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly createLink: (o: PeerLinkOptions) => PeerLinkLike;

  constructor(private readonly o: MeshOptions) {
    this.createLink = o.createLink ?? ((opts) => new PeerLink(opts));
  }

  start(): void {
    const s = this.o.signaling;
    s.onReady(() => s.send('hello', '*', this.helloBody()));
    s.onMessage((p) => this.onMessage(p));
    // room_ws meldet member_leave auch, wenn ein Teilnehmer nur kurz neu verbindet; der P2P-Pfad läuft dann
    // weiter. Deshalb erst nach einer Gnadenfrist abbauen, ein hello mit neuer cid hebt sie auf.
    s.onLeave((cid) => {
      for (const [id, link] of this.links) {
        if (link.cid !== cid || this.leaveTimers.has(id)) continue;
        this.leaveTimers.set(id, setTimeout(() => this.remove(id), LEAVE_GRACE_MS));
      }
    });
  }

  peers(): PeerView[] {
    return [...this.links.values()].map((l) => ({ peerId: l.peerId, name: l.name, state: l.state }));
  }

  /** Empfangene Audio-Bytes je Peer, für Diagnose und Tests. */
  async bytesReceived(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const [id, link] of this.links) {
      let sum = 0;
      (await link.getStats()).forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio') sum += r.bytesReceived ?? 0;
      });
      out[id] = sum;
    }
    return out;
  }

  async leave(): Promise<void> {
    this.o.signaling.send('bye', '*', {});
    for (const id of [...this.links.keys()]) this.remove(id);
    await this.o.signaling.close();
  }

  private onMessage(p: Payload): void {
    if (p.from === this.o.selfId) return;
    let link = this.links.get(p.from);
    switch (p.kind) {
      case 'hello': {
        const name = (p.body as Bodies['hello']).name;
        this.o.onHello?.(p.from, name);
        if (link) {
          this.setCid(p.from, link, p.cid);
          link.name = name;
          this.changed();
        } else if (p.to === '*') {
          // Neuer Teilnehmer: ihm den eigenen Namen nennen, das Angebot kommt über negotiationneeded.
          this.o.signaling.send('hello', p.from, this.helloBody());
          this.add(p.from, p.cid, name);
        } else {
          // Antwort auf mein eigenes hello: Das Gegenüber bietet an, ich merke mir nur den Namen.
          this.pendingNames.set(p.from, name);
        }
        return;
      }
      case 'offer':
        link ??= this.add(p.from, p.cid, '');
        this.setCid(p.from, link, p.cid);
        void link.handle(p);
        return;
      case 'answer':
      case 'ice':
        if (link) void link.handle(p);
        return;
      case 'bye':
        if (link) this.remove(p.from);
        return;
    }
  }

  private helloBody(): Bodies['hello'] {
    return { pub: this.o.selfPub, name: this.o.name, caps: [] };
  }

  private add(peerId: string, cid: string, name: string): PeerLinkLike {
    const polite = this.o.selfId < peerId;
    let link: PeerLinkLike | null = null;
    const isCurrent = () => link !== null && this.links.get(peerId) === link;
    link = this.createLink({
      peerId,
      polite,
      iceServers: this.o.iceServers,
      localStream: this.o.localStream,
      send: (kind, body) => this.o.signaling.send(kind, peerId, body as never),
      onTrack: (s) => {
        if (isCurrent()) this.o.onTrack(peerId, s);
      },
      onState: (state) => {
        if (!isCurrent()) return;
        if (state === 'failed') {
          const { cid: c, name: n } = link!;
          this.remove(peerId);
          if (!polite) this.add(peerId, c, n);
        } else if (state === 'closed') {
          this.remove(peerId);
        } else {
          this.changed();
        }
      },
    });
    link.cid = cid;
    link.name = name || (this.pendingNames.get(peerId) ?? '');
    this.pendingNames.delete(peerId);
    this.links.set(peerId, link);
    this.changed();
    return link;
  }

  private setCid(peerId: string, link: PeerLinkLike, cid: string): void {
    if (link.cid === cid) return;
    link.cid = cid;
    this.cancelLeave(peerId);
  }

  private cancelLeave(peerId: string): void {
    const t = this.leaveTimers.get(peerId);
    if (t !== undefined) clearTimeout(t);
    this.leaveTimers.delete(peerId);
  }

  private remove(peerId: string): void {
    this.cancelLeave(peerId);
    const link = this.links.get(peerId);
    if (!link) return;
    this.links.delete(peerId);
    link.close();
    this.o.onPeerGone(peerId);
    this.changed();
  }

  private changed(): void {
    this.o.onChange(this.peers());
  }
}
