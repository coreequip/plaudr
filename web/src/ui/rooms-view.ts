import { removeRoom, renameRoom, roomSubtitle, roomTitle, type RoomEntry, type Rooms } from '../room/rooms';
import { secretFromLink } from '../room/link';

export interface RoomsViewOptions {
  rooms: () => Rooms;
  setRooms: (r: Rooms) => void;
  autoJoin: () => boolean;
  open: (secret: string) => void;
  create: () => void;
  settings: () => void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const PENCIL =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Startbildschirm „Deine Räume“: Liste, Umbenennen, Entfernen, neuer Raum, Link einfügen. */
export function initRoomsView(o: RoomsViewOptions): { render(): void } {
  // Raum, dessen Namenseditor gerade offen ist (Geheimnis nur im Speicher und als data-room).
  let editing: string | null = null;

  const card = (e: RoomEntry, i: number, now: number): HTMLLIElement => {
    const li = el('li', i === 0 ? 'room latest' : 'room');
    li.dataset.room = e.secret;
    const title = roomTitle(e, now);

    if (editing === e.secret) {
      li.classList.add('editing');
      const label = el('label', '', 'Name für diesen Raum (nur für dich)');
      const input = el('input', 'room-name-input');
      input.maxLength = 40;
      input.value = e.name ?? '';
      input.id = 'room-name-input';
      label.htmlFor = input.id;
      const save = el('button', 'primary room-name-save', 'Speichern');
      const commit = () => {
        editing = null;
        o.setRooms(renameRoom(o.rooms(), e.secret, input.value));
        render();
      };
      save.onclick = commit;
      input.onkeydown = (ev) => {
        if (ev.key === 'Enter') commit();
        else if (ev.key === 'Escape') {
          editing = null;
          render();
        }
      };
      const row = el('div', 'row');
      row.append(input, save);
      const remove = el('button', 'room-remove', 'Aus der Liste entfernen');
      remove.onclick = () => {
        editing = null;
        o.setRooms(removeRoom(o.rooms(), e.secret));
        render();
      };
      li.append(label, row, remove);
      queueMicrotask(() => input.focus());
      return li;
    }

    const text = el('div', 'room-text');
    text.append(el('span', e.name === null ? 'room-title unnamed' : 'room-title', title), el('span', 'room-sub', roomSubtitle(e, now)));
    if (i === 0) text.append(el('span', 'room-auto', o.autoJoin() ? 'zuletzt genutzt, wird beim Start betreten' : 'zuletzt genutzt'));

    const rename = el('button', 'icon flat room-rename');
    rename.innerHTML = PENCIL;
    rename.setAttribute('aria-label', `${title} umbenennen`);
    rename.title = 'Umbenennen';
    rename.onclick = () => {
      editing = e.secret;
      render();
    };
    const join = el('button', i === 0 ? 'primary room-join' : 'room-join', 'Beitreten');
    join.onclick = () => o.open(e.secret);
    li.append(text, rename, join);
    return li;
  };

  function render(): void {
    const rooms = o.rooms();
    if (editing !== null && !rooms.some((r) => r.secret === editing)) editing = null;
    const now = Date.now();
    $('rooms-list').replaceChildren(...rooms.map((e, i) => card(e, i, now)));
    $('rooms-empty').hidden = rooms.length > 0;
  }

  const openPasted = () => {
    const input = $<HTMLInputElement>('paste-link');
    const err = $('paste-error');
    const secret = secretFromLink(input.value.trim());
    if (!secret) {
      err.textContent = 'Das ist kein plaudr-Link.';
      err.hidden = false;
      return;
    }
    err.hidden = true;
    input.value = '';
    o.open(secret);
  };

  $('create').onclick = o.create;
  $('start-settings').onclick = o.settings;
  $('paste-open').onclick = openPasted;
  $('paste-link').onkeydown = (ev) => {
    if (ev.key === 'Enter') openPasted();
  };
  $('paste-link').oninput = () => ($('paste-error').hidden = true);

  return { render };
}
