declare module 'roomws' {
  export interface PublishMeta {
    client_id: string;
    room: string;
    id?: string;
    timestamp?: number;
  }

  export class Room {
    members: string[];
    on(ev: 'open', cb: () => void): void;
    on(ev: 'members', cb: (ids: string[]) => void): void;
    on(ev: 'member_join' | 'member_leave', cb: (cid: string) => void): void;
    on(ev: 'message', cb: (msg: unknown, meta: PublishMeta) => void): void;
    unsubscribe(): void;
  }

  export default class RoomWS {
    constructor(channel: string, opts?: { url?: string; reconnect?: boolean });
    clientId: string | null;
    socket: WebSocket;
    on(ev: 'open', cb: (err?: string) => void): void;
    on(ev: 'close' | 'error', cb: (e?: unknown) => void): void;
    subscribe(room: string): Room;
    publish(m: { room: string; message: unknown; no_echo?: boolean }): void;
    close(): void;
  }
}
