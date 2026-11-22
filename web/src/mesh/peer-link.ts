import type { Bodies, Payload } from '../signaling/types';
import { IceBatcher } from './ice-batcher';
import { tuneOpus } from './sdp';
import { encodeCtl, parseCtl } from './ctl';

export interface PeerLinkOptions {
  peerId: string;
  polite: boolean;
  iceServers: RTCIceServer[];
  localStream: MediaStream | null;
  send: (kind: 'offer' | 'answer' | 'ice', body: Bodies['offer'] | Bodies['answer'] | Bodies['ice']) => void;
  onTrack: (s: MediaStream) => void;
  onState: (s: RTCPeerConnectionState) => void;
  /** Das Gegenüber hat seinen Stumm-Status über den Kontrollkanal geändert. */
  onRemoteState: () => void;
}

export interface PeerLinkLike {
  readonly peerId: string;
  cid: string;
  name: string;
  readonly state: RTCPeerConnectionState;
  /** Stumm-Status des Gegenübers laut Kontrollkanal; anfangs false. */
  readonly remoteMuted: boolean;
  /** Teilt dem Gegenüber den eigenen Stumm-Status mit (vor dem Öffnen des Kanals nur gemerkt). */
  setLocalMuted(m: boolean): void;
  handle(p: Payload): Promise<void>;
  getStats(): Promise<RTCStatsReport>;
  /** Pegel 0..1 des zuletzt empfangenen Audiopakets; 0, wenn älter als 500 ms. */
  audioLevel(): number;
  senderTrackId(): string | null;
  remoteSdp(): string | null;
  close(): void;
}

const MAX_ICE_RESTARTS = 3;
const LEVEL_STALE_MS = 500;
/** So lange darf ein ICE-Neustart dauern, bevor er als gescheitert zählt (z. B. Gegenüber antwortet nie). */
const ICE_RESTART_TIMEOUT_MS = 10_000;

/** Eine RTCPeerConnection zu genau einem Gegenüber, verhandelt nach dem Perfect-Negotiation-Muster. */
export class PeerLink implements PeerLinkLike {
  readonly pc: RTCPeerConnection;
  cid = '';
  name = '';
  remoteMuted = false;
  private localMuted = false;
  private readonly ctl: RTCDataChannel;
  private makingOffer = false;
  private ignoreOffer = false;
  private iceFailures = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly batcher: IceBatcher;

  constructor(private readonly o: PeerLinkOptions) {
    const pc = (this.pc = new RTCPeerConnection({ iceServers: o.iceServers }));
    const ctl = (this.ctl = pc.createDataChannel('ctl', { negotiated: true, id: 0 }));
    ctl.onopen = () => this.sendState();
    ctl.onmessage = (e) => {
      const m = parseCtl(e.data);
      if (!m) return;
      this.remoteMuted = m.muted;
      o.onRemoteState();
    };
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
        // Explizit statt setLocalDescription() ohne Argument: Die Opus-Parameter müssen vor dem Setzen ins SDP.
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') return; // inzwischen kam ein Angebot herein (Perfect Negotiation)
        await pc.setLocalDescription({ type: 'offer', sdp: tuneOpus(offer.sdp ?? '') });
        o.send('offer', { sdp: pc.localDescription!.sdp });
      } catch (err) {
        console.warn('[plaudr] Angebot fehlgeschlagen', err);
      } finally {
        this.makingOffer = false;
      }
    };

    pc.ontrack = (e) => {
      // Chromium: so wenig Puffer wie möglich, der Jitterpuffer wächst bei Bedarf selbst.
      if ('jitterBufferTarget' in e.receiver) (e.receiver as { jitterBufferTarget: number | null }).jitterBufferTarget = 0;
      o.onTrack(e.streams[0] ?? new MediaStream([e.track]));
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === 'connected' || s === 'completed') {
        this.iceFailures = 0;
        this.clearRestartTimer();
      } else if (s === 'failed') {
        this.onIceFailure();
      }
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

  setLocalMuted(m: boolean): void {
    this.localMuted = m;
    this.sendState();
  }

  private sendState(): void {
    if (this.ctl.readyState !== 'open') return;
    try {
      this.ctl.send(encodeCtl({ type: 'state', muted: this.localMuted }));
    } catch (err) {
      console.warn('[plaudr] Kontrollkanal sendet nicht', err);
    }
  }

  /** Verarbeitet Signaling-Nachrichten strikt nacheinander, damit ICE nie vor der Remote-Description landet. */
  handle(p: Payload): Promise<void> {
    this.queue = this.queue.then(() => this.process(p)).catch((err) => console.warn('[plaudr] Signaling-Fehler', err));
    return this.queue;
  }

  getStats(): Promise<RTCStatsReport> {
    return this.pc.getStats();
  }

  audioLevel(): number {
    const receiver = this.pc.getReceivers().find((r) => r.track.kind === 'audio');
    const src = receiver?.getSynchronizationSources()[0];
    if (!src || performance.now() - src.timestamp > LEVEL_STALE_MS) return 0;
    return src.audioLevel ?? 0;
  }

  remoteSdp(): string | null {
    return this.pc.remoteDescription?.sdp ?? null;
  }

  senderTrackId(): string | null {
    return this.pc.getSenders().find((s) => s.track?.kind === 'audio')?.track?.id ?? null;
  }

  close(): void {
    this.clearRestartTimer();
    this.batcher.dispose();
    this.pc.close();
  }

  private onIceFailure(): void {
    this.clearRestartTimer();
    if (++this.iceFailures >= MAX_ICE_RESTARTS) {
      this.o.onState('failed');
      return;
    }
    this.pc.restartIce();
    this.restartTimer = setTimeout(() => {
      const s = this.pc.iceConnectionState;
      if (s !== 'connected' && s !== 'completed') this.onIceFailure();
    }, ICE_RESTART_TIMEOUT_MS);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer !== null) clearTimeout(this.restartTimer);
    this.restartTimer = null;
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
        const answer = await pc.createAnswer();
        await pc.setLocalDescription({ type: 'answer', sdp: tuneOpus(answer.sdp ?? '') });
        this.o.send('answer', { sdp: pc.localDescription!.sdp });
      }
    } else if (p.kind === 'ice') {
      for (const c of (p.body as Bodies['ice']).c) {
        try {
          await pc.addIceCandidate(c);
        } catch (err) {
          // Ein kaputter Kandidat darf den Rest des Bündels nicht verwerfen.
          if (!this.ignoreOffer) console.warn('[plaudr] ICE-Kandidat abgelehnt', err);
        }
      }
    }
  }
}
