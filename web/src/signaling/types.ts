export interface Bodies {
  hello: { name: string };
  offer: { sdp: string };
  answer: { sdp: string };
  ice: { c: RTCIceCandidateInit[] };
  bye: Record<string, never>;
}

export type Kind = keyof Bodies;

export interface Payload<K extends Kind = Kind> {
  kind: K;
  from: string;
  to: string;
  cid: string;
  ts: number;
  nonce: string;
  body: Bodies[K];
}

/** M1: Klartext. M2: { v: 1, iv, ct }. */
export interface Envelope {
  v: 0;
  p: Payload;
}
