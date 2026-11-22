export interface JoinState {
  name: string;
  tabLocked: boolean;
  identity: { backedUp: boolean; persistent: boolean } | null;
}

/** Beitreten erst mit Namen, eigener Tab-Sperre und gesicherter (oder bewusst flüchtiger) Identität. */
export function canJoin(s: JoinState): boolean {
  return s.tabLocked && s.identity !== null && (s.identity.backedUp || !s.identity.persistent) && s.name.trim() !== '';
}
