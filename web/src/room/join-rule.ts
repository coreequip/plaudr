export interface JoinState {
  name: string;
  tabLocked: boolean;
  identity: { backedUp: boolean; persistent: boolean } | null;
}

/** Persistente Identität ohne Sicherung: Sicherung ist Pflicht, bevor es losgeht (Spec §4). */
export function needsBackup(identity: JoinState['identity']): boolean {
  return identity !== null && !identity.backedUp && identity.persistent;
}

/** Beitreten erst mit Namen, eigener Tab-Sperre und gesicherter (oder bewusst flüchtiger) Identität. */
export function canJoin(s: JoinState): boolean {
  return s.tabLocked && s.identity !== null && (s.identity.backedUp || !s.identity.persistent) && s.name.trim() !== '';
}
