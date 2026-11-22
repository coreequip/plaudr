import { renameRoom, roomTitle, type Rooms } from '../room/rooms';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface CallHeaderOptions {
  secret: string;
  link: string;
  rooms: () => Rooms;
  setRooms: (r: Rooms) => void;
  notice: (text: string) => void;
}

/** Kopfzeile im Gespräch: Raumtitel aus dem Verlauf, Umbenennen an Ort und Stelle, Link kopieren. */
export function initCallHeader(o: CallHeaderOptions): void {
  const title = $('room-title');
  const rename = $<HTMLButtonElement>('room-rename');
  const input = $<HTMLInputElement>('room-name-input');
  const entry = () => o.rooms().find((e) => e.secret === o.secret);

  const showTitle = () => {
    const e = entry();
    title.textContent = e ? roomTitle(e, Date.now()) : 'Raum';
    title.hidden = rename.hidden = false;
    input.hidden = true;
  };

  // Escape löst danach noch blur aus; das darf nicht speichern.
  let open = false;
  const close = (save: boolean) => {
    if (!open) return;
    open = false;
    if (save) o.setRooms(renameRoom(o.rooms(), o.secret, input.value));
    showTitle();
    rename.focus();
  };
  rename.onclick = () => {
    open = true;
    input.value = entry()?.name ?? '';
    title.hidden = rename.hidden = true;
    input.hidden = false;
    input.focus();
    input.select();
  };
  // preventDefault: sonst löst dieselbe Taste am danach fokussierten Stift gleich wieder das Umbenennen aus.
  input.onkeydown = (ev) => {
    if (ev.key !== 'Enter' && ev.key !== 'Escape') return;
    ev.preventDefault();
    close(ev.key === 'Enter');
  };
  input.onblur = () => close(true);

  const copy = $<HTMLButtonElement>('copy');
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(o.link);
    } catch {
      o.notice('Kopieren ging nicht. Dein Link: ' + o.link);
      return;
    }
    copy.classList.add('done');
    copy.title = 'Kopiert';
    setTimeout(() => {
      copy.classList.remove('done');
      copy.title = 'Link kopieren';
    }, 1500);
  };

  showTitle();
}
