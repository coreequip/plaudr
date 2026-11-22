import { secretFromHash } from './link';

export interface RoomEntry {
  secret: string;
  name: string | null;
  firstJoined: number;
  lastJoined: number;
  peers: string[];
}
/** Immer nach lastJoined absteigend. */
export type Rooms = RoomEntry[];

const KEY = 'plaudr.rooms';
const MAX_ROOMS = 50;
const MAX_NAME = 40;
/** Namen kommen ungeprüft aus dem hello anderer: höchstens so viele, je so lang wie ein eigener Name. */
const MAX_PEERS = 8;

const byRecent = (a: RoomEntry, b: RoomEntry) => b.lastJoined - a.lastJoined;

function valid(e: unknown): e is RoomEntry {
  if (!e || typeof e !== 'object') return false;
  const o = e as Record<string, unknown>;
  return (
    typeof o.secret === 'string' &&
    secretFromHash(o.secret) !== null &&
    (o.name === null || typeof o.name === 'string') &&
    typeof o.firstJoined === 'number' &&
    Number.isFinite(o.firstJoined) &&
    typeof o.lastJoined === 'number' &&
    Number.isFinite(o.lastJoined) &&
    Array.isArray(o.peers) &&
    o.peers.every((p) => typeof p === 'string')
  );
}

export function loadRooms(storage?: Storage): Rooms {
  try {
    const parsed: unknown = JSON.parse((storage ?? localStorage).getItem(KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(valid).map((e) => ({ secret: e.secret, name: e.name, firstJoined: e.firstJoined, lastJoined: e.lastJoined, peers: [...e.peers] })).sort(byRecent);
  } catch {
    return [];
  }
}

export function saveRooms(r: Rooms, storage?: Storage): void {
  try {
    (storage ?? localStorage).setItem(KEY, JSON.stringify([...r].sort(byRecent).slice(0, MAX_ROOMS)));
  } catch {
    /* privater Modus: Verlauf wird nicht gemerkt */
  }
}

/** Trägt einen Beitritt ein und stellt den Raum nach vorn. */
export function noteJoin(r: Rooms, secret: string, now: number): Rooms {
  const known = r.find((e) => e.secret === secret);
  const entry: RoomEntry = known
    ? { ...known, peers: [...known.peers], lastJoined: now }
    : { secret, name: null, firstJoined: now, lastJoined: now, peers: [] };
  return [entry, ...r.filter((e) => e.secret !== secret)].sort(byRecent);
}

const patch = (r: Rooms, secret: string, f: (e: RoomEntry) => RoomEntry): Rooms => r.map((e) => (e.secret === secret ? f(e) : e));

export function notePeers(r: Rooms, secret: string, names: string[]): Rooms {
  return patch(r, secret, (e) => ({ ...e, peers: names.slice(0, MAX_PEERS).map((n) => [...n].slice(0, MAX_NAME).join('')) }));
}

export function renameRoom(r: Rooms, secret: string, name: string): Rooms {
  const n = name.trim().slice(0, MAX_NAME);
  return patch(r, secret, (e) => ({ ...e, name: n === '' ? null : n }));
}

export function removeRoom(r: Rooms, secret: string): Rooms {
  return r.filter((e) => e.secret !== secret);
}

const dayFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' });
const dayYearFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
const dayStart = (ts: number) => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

/** Datum ohne Jahr, im Jahr von `now` weggelassen; sonst mit Jahr. */
function dayLabel(ts: number, now: number): string {
  return new Date(ts).getFullYear() === new Date(now).getFullYear() ? dayFmt.format(ts) : dayYearFmt.format(ts);
}

export function relDay(ts: number, now: number): string {
  const diff = Math.round((dayStart(now).getTime() - dayStart(ts).getTime()) / 86_400_000);
  if (diff === 0) return 'heute';
  if (diff === 1) return 'gestern';
  return dayLabel(ts, now);
}

export function roomTitle(e: RoomEntry, now: number): string {
  return e.name ?? `Raum vom ${dayLabel(e.firstJoined, now)}`;
}

export function roomSubtitle(e: RoomEntry, now: number): string {
  return relDay(e.lastJoined, now) + (e.peers.length ? ' · ' + e.peers.join(', ') : '');
}
