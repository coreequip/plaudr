import type { Rooms } from './rooms';

/** Geheimnis des Raums, dem beim Start automatisch beigetreten wird, sonst null. */
export function autoJoinTarget(o: { hash: string; booted: boolean; autoJoin: boolean; rooms: Rooms }): string | null {
  const hash = o.hash.startsWith('#') ? o.hash.slice(1) : o.hash;
  if (hash !== '' || o.booted || !o.autoJoin) return null;
  return o.rooms[0]?.secret ?? null;
}
