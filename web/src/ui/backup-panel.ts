import { BackupError, createBackup, MIN_PASSWORD_LENGTH, restoreBackup } from '../crypto/backup';
import { identityFrom, type Identity, type IdentityStore } from '../crypto/identity';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface BackupPanelOptions {
  store: IdentityStore;
  identity: () => Identity;
  setIdentity: (id: Identity) => void;
  /** Für den Dateinamen der Sicherung. */
  name: () => string;
}

/** Sicherung herunterladen und Sicherung laden, zuerst in der Lobby (Spec §4). */
export function initBackupPanel(o: BackupPanelOptions): void {
  const panel = $('backup');
  const pw2 = $<HTMLInputElement>('backup-pw2');
  const error = $('backup-error');
  const restoreError = $('restore-error');
  const clear = () => {
    error.hidden = restoreError.hidden = true;
    pw2.removeAttribute('aria-invalid');
  };
  // Fehler der Sicherung stehen unter dem zweiten Passwortfeld, Fehler beim Laden unter dessen Passwort.
  const fail = (text: string, at: HTMLElement = error) => {
    clear();
    at.textContent = text;
    at.hidden = false;
  };
  const busy = (on: boolean) => {
    for (const id of ['backup-save', 'restore-load']) $<HTMLButtonElement>(id).disabled = on;
  };

  const persist = async (id: Identity): Promise<Identity> => {
    try {
      await o.store.save(id.stored);
      return id;
    } catch (err) {
      console.warn('[plaudr] Identität nicht speicherbar', err);
      return identityFrom(id.stored, false);
    }
  };

  const done = (id: Identity) => {
    o.setIdentity(id);
    for (const f of ['backup-pw', 'backup-pw2', 'restore-pw']) $<HTMLInputElement>(f).value = '';
    clear();
    panel.hidden = true;
  };

  $('backup-save').onclick = async () => {
    const pw = $<HTMLInputElement>('backup-pw').value;
    if (pw.length < MIN_PASSWORD_LENGTH) return fail(`Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`);
    if (pw !== pw2.value) {
      fail('Die Passwörter stimmen nicht überein.');
      pw2.setAttribute('aria-invalid', 'true');
      return;
    }
    busy(true);
    try {
      const current = o.identity();
      download(await createBackup(current.stored, pw), fileName(o.name() || current.peerId.slice(0, 8)));
      done(await persist(await identityFrom({ ...current.stored, backedUp: true }, current.persistent)));
    } catch (err) {
      console.warn('[plaudr] Sicherung fehlgeschlagen', err);
      fail('Die Sicherung ist fehlgeschlagen.');
    } finally {
      busy(false);
    }
  };

  $('restore-load').onclick = async () => {
    const file = $<HTMLInputElement>('restore-file').files?.[0];
    if (!file) return fail('Wähle zuerst die Sicherungsdatei.', restoreError);
    busy(true);
    try {
      const stored = await restoreBackup(await file.text(), $<HTMLInputElement>('restore-pw').value);
      done(await persist(await identityFrom(stored, true)));
    } catch (err) {
      fail(err instanceof BackupError && err.reason === 'decrypt' ? 'Passwort falsch oder Datei beschädigt.' : 'Das ist keine plaudr-Sicherung.', restoreError);
    } finally {
      busy(false);
    }
  };
}

/** Zeigt die Sicherung als Pflicht (neue Identität) oder nur als Angebot. */
export function showBackupState(id: Identity): void {
  const required = !id.backedUp && id.persistent;
  $('backup').hidden = !required;
}

/** Hängt die Sicherungskarte in einen anderen Bildschirm um (Einstellungen); Zustand und Handler bleiben. */
export function mountBackupPanel(slot: HTMLElement): void {
  slot.append($('backup'));
}

function fileName(base: string): string {
  return `plaudr-${base.replace(/[^\p{L}\p{N}_-]+/gu, '_')}.plaudr-key`;
}

function download(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
