export interface Bodies {
  hello: { pub: string; name: string; caps: string[] };
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
