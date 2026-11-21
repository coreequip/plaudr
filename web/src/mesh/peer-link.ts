import type { Bodies, Payload } from '../signaling/types';
import { IceBatcher } from './ice-batcher';

export interface PeerLinkOptions {
  peerId: string;
  polite: boolean;
  iceServers: RTCIceServer[];
  localStream: MediaStream | null;
  send: (kind: 'offer' | 'answer' | 'ice', body: Bodies['offer'] | Bodies['answer'] | Bodies['ice']) => void;
  onTrack: (s: MediaStream) => void;
  onState: (s: RTCPeerConnectionState) => void;
}

export interface PeerLinkLike {
  readonly peerId: string;
  cid: string;
  name: string;
  readonly state: RTCPeerConnectionState;
  handle(p: Payload): Promise<void>;
  close(): void;
}

const MAX_ICE_RESTARTS = 3;

/** Eine RTCPeerConnection zu genau einem Gegenüber, verhandelt nach dem Perfect-Negotiation-Muster. */
export class PeerLink implements PeerLinkLike {
  readonly pc: RTCPeerConnection;
  cid = '';
  name = '';
  private makingOffer = false;
  private ignoreOffer = false;
  private iceFailures = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly batcher: IceBatcher;

  constructor(private readonly o: PeerLinkOptions) {
    const pc = (this.pc = new RTCPeerConnection({ iceServers: o.iceServers }));
    pc.createDataChannel('ctl', { negotiated: true, id: 0 });
    if (o.localStream) {
      for (const t of o.localStream.getAudioTracks()) pc.addTrack(t, o.localStream);
    } else {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    this.batcher = new IceBatcher((c) => o.send('ice', { c }));
    pc.onicecandidate = (e) => this.batcher.add(e.candidate ? e.candidate.toJSON() : null);

    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        o.send('offer', { sdp: pc.localDescription!.sdp });
      } catch (err) {
        console.warn('[plaudr] Angebot fehlgeschlagen', err);
      } finally {
        this.makingOffer = false;
      }
    };

    pc.ontrack = (e) => o.onTrack(e.streams[0] ?? new MediaStream([e.track]));

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === 'connected' || s === 'completed') this.iceFailures = 0;
      if (s !== 'failed') return;
      if (++this.iceFailures >= MAX_ICE_RESTARTS) o.onState('failed');
      else pc.restartIce();
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState !== 'failed') o.onState(pc.connectionState);
    };
  }

  get peerId(): string {
    return this.o.peerId;
  }

  get state(): RTCPeerConnectionState {
    return this.pc.connectionState;
  }

  /** Verarbeitet Signaling-Nachrichten strikt nacheinander, damit ICE nie vor der Remote-Description landet. */
  handle(p: Payload): Promise<void> {
    this.queue = this.queue.then(() => this.process(p)).catch((err) => console.warn('[plaudr] Signaling-Fehler', err));
    return this.queue;
  }

  close(): void {
    this.batcher.dispose();
    this.pc.close();
  }

  private async process(p: Payload): Promise<void> {
    const pc = this.pc;
    if (p.kind === 'offer' || p.kind === 'answer') {
      const { sdp } = p.body as Bodies['offer'];
      const collision = p.kind === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
      this.ignoreOffer = !this.o.polite && collision;
      if (this.ignoreOffer) return;
      await pc.setRemoteDescription({ type: p.kind, sdp });
      if (p.kind === 'offer') {
        await pc.setLocalDescription();
        this.o.send('answer', { sdp: pc.localDescription!.sdp });
      }
    } else if (p.kind === 'ice') {
      for (const c of (p.body as Bodies['ice']).c) {
        try {
          await pc.addIceCandidate(c);
        } catch (err) {
          if (!this.ignoreOffer) throw err;
        }
      }
    }
  }
}
