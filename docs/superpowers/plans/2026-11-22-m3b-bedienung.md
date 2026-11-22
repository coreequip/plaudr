# M3b Bedienung nach Mock: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Web-Client bekommt die vier Bildschirme aus dem UI-Mock (Deine Räume, Erster Start, Gespräch, Einstellungen) mit Raumverlauf, lokalen Raumnamen, Auto-Beitritt, Farbthema, Mikrofonwahl, 4-Wort-Anzeige und Stumm-Status der anderen.

**Architecture:** Reine, unter Node testbare Module für alles mit Regeln (`room/rooms.ts`, `room/auto-join.ts`, `ui/prefs.ts`, `ui/theme.ts`, `crypto/words.ts`, `mesh/ctl.ts`, `audio/devices.ts`). Die Bildschirme sind dünne DOM-Hüllen in `ui/*-view.ts`, `main.ts` verdrahtet sie. Weiterhin kein UI-Framework, ein `index.html` mit vier `<section>`s, Umschalten über `hidden`. Der Raum steht weiter im Fragment; Einstellungen sind ein Bildschirm ohne eigene URL.

**Tech Stack:** Vite + TypeScript, Vitest, Playwright (bestehende Einrichtung).

**Spec:** `docs/spec.md` §7 Bedienung (neu), §4 (4 Wörter), §6 Kontrollkanal. Mock: https://claude.ai/artifact/G5aLE1kEgFVDQR1VgoeLEL (Artboards Start, Lobby, Main, CallPtt, Settings; Tray ist M4).

## Global Constraints

- UI-Texte deutsch, duzen, keine Gedankenstriche („–“, „—“) in sichtbaren Texten. Texte wörtlich aus dem Mock übernehmen.
- Farben bleiben die Tokens aus `web/src/style.css` (`--accent` hell `#0f5c1a`, dunkel `#4caf5c`, `--warn`, `--line` …); neue Tokens: `--accent-soft` (hell `#dcebdd`, dunkel `#1f3322`), `--danger` (hell `#b3261e`, dunkel `#f2928b`).
- Layout: `main` höchstens 32 rem breit; Gesprächs- und Startbildschirm füllen die Höhe (`min-height: 100dvh`, Fußleiste unten). Touch-Ziele ≥ 36 px, Icon-Knöpfe mit `aria-label` und `title`.
- `localStorage`-Schlüssel: `plaudr.rooms`, `plaudr.ui`; bestehende (`plaudr.name`, `plaudr.audio`, `plaudr.volumes`, `plaudr.contacts`) bleiben. Jeder Zugriff in `try/catch`, Fehler ergeben Standardwerte.
- `sessionStorage`-Schlüssel `plaudr.booted`: gesetzt beim ersten `route()` einer Browsersitzung.
- Bestehende Element-IDs, die E2E nutzt, bleiben gültig, sofern ein Task nichts anderes sagt (`#start`, `#lobby`, `#call`, `#name`, `#join`, `#backup*`, `#restore*`, `#peers li[data-peer]`, `input[data-volume]`, `#mode-*`, `#ptt`, `#denoise`, `#me-speaking`, `#notice`, `#leave`, `#debug*`, `#vad-threshold`).
- Commits eine Zeile, Deutsch, Aussage im Stil von `git log`, direkt auf `main`, nach jedem Task.
- Jeder Task endet mit `cd web && npx vitest run && npm run build`; Tasks mit DOM-Änderung zusätzlich `npm run e2e` (alle grün).

## Review Focus

1. **Auto-Beitritt oder geöffneter Link ohne Nutzergeste:** `ctx.resume()` kann ewig hängen; der Beitritt darf nicht blockieren, und „Ton aktivieren“ muss Wiedergabe **und** Aufnahme starten (Task 4, Test „resumeWithin gibt nach 300 ms false“).
2. **Kein Wiederbeitritt in Schleife:** Nach „Verlassen“, „‹“ oder Neuladen kein Auto-Beitritt; ein geöffneter Einladungslink hat Vorrang vor dem zuletzt genutzten Raum (Task 1, Tests zu `autoJoinTarget`; Task 6 E2E).
3. **Kaputter oder fremder Speicherinhalt** (`plaudr.rooms` kein JSON, Einträge mit ungültigem Geheimnis, `hue: "abc"`): Standardwerte, kein Absturz (Task 1 und 2, Tests „kaputt“).
4. **Gemerktes Mikrofon fehlt** (abgesteckt): Standardgerät, Auswahl zeigt „Standardgerät“ (Task 4, Test zu `micChoices`; `deviceId` nur als `ideal`).
5. **Fehlerhafte ctl-Nachricht eines Peers** (kein JSON, falscher Typ, > 1 KB): ignoriert, nichts wirft (Task 3, Tests zu `parseCtl`).

---

### Task 1: Raumverlauf, Linkeingabe, Auto-Beitritt (rein)

**Files:**
- Create: `web/src/room/rooms.ts`, `web/src/room/rooms.test.ts`, `web/src/room/auto-join.ts`, `web/src/room/auto-join.test.ts`
- Modify: `web/src/room/link.ts`, `web/src/room/link.test.ts`

**Interfaces:**
- Produces:
  - `interface RoomEntry { secret: string; name: string | null; firstJoined: number; lastJoined: number; peers: string[] }`; `type Rooms = RoomEntry[]` (immer nach `lastJoined` absteigend)
  - `loadRooms(storage?: Storage): Rooms`, `saveRooms(r: Rooms, storage?: Storage): void` (Schlüssel `plaudr.rooms`, höchstens 50 Einträge, älteste fliegen raus)
  - `noteJoin(r, secret, now): Rooms` · `notePeers(r, secret, names: string[]): Rooms` (ersetzt `peers`) · `renameRoom(r, secret, name: string): Rooms` (trim, höchstens 40 Zeichen, leer → `null`) · `removeRoom(r, secret): Rooms`. Alle rein, Eingabe unverändert.
  - `roomTitle(e: RoomEntry, now: number): string` → Name, sonst `Raum vom ${dayLabel(firstJoined)}`
  - `roomSubtitle(e, now): string` → `relDay(lastJoined, now)` plus `" · " + peers.join(", ")`, wenn Namen da
  - `relDay(ts, now): string` → `"heute"`, `"gestern"`, `"3. November"`, im anderen Jahr `"3. November 2025"` (lokale Zeitzone, `Intl.DateTimeFormat('de-DE')`)
  - `secretFromLink(text: string): string | null` in `link.ts`: trimmen, Teil nach dem letzten `#` (oder alles), dann `secretFromHash`
  - `autoJoinTarget(o: { hash: string; booted: boolean; autoJoin: boolean; rooms: Rooms }): string | null` in `auto-join.ts`: nur wenn Fragment leer, `!booted`, `autoJoin` und ein Eintrag da ist → `rooms[0].secret`

- [ ] **Step 1: Tests**
  - rooms: „noteJoin legt an und setzt firstJoined = lastJoined“, „noteJoin auf bekannten Raum zieht ihn nach vorn, firstJoined bleibt“, „renameRoom mit Leerraum ergibt null“, „renameRoom kürzt auf 40“, „removeRoom“, „roomTitle ohne Namen: Raum vom 3. November“, „roomSubtitle: gestern · Anna, Bert“, „relDay heute/gestern/anderes Jahr“ (Daten mit `new Date(2026, 10, 22, 12)` bauen), „loadRooms: kein JSON → []“, „loadRooms verwirft Einträge mit ungültigem Geheimnis oder falschen Typen“, „saveRooms hält höchstens 50“, „Funktionen ändern die Eingabe nicht“.
  - link: `secretFromLink` nimmt `https://plaudr.room.ws/#<s>`, `plaudr.room.ws/#<s>`, `  <s>  `; verwirft `https://plaudr.room.ws/`, `#abc`, leeren Text.
  - auto-join: Link im Fragment → `null`; `booted` → `null`; `autoJoin: false` → `null`; leere Liste → `null`; sonst neuester Eintrag.
- [ ] **Step 2:** `npx vitest run src/room` → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** `npx vitest run && npm run build` → grün.
- [ ] **Step 5:** `git commit -m "Raumverlauf mit lokalen Namen, Linkeingabe und Regel für den Auto-Beitritt"`

### Task 2: Einstellungen der Oberfläche und Farbthema (rein)

**Files:**
- Create: `web/src/ui/prefs.ts`, `web/src/ui/prefs.test.ts`, `web/src/ui/theme.ts`, `web/src/ui/theme.test.ts`

**Interfaces:**
- Produces:
  - `interface UiPrefs { theme: 'system' | 'light' | 'dark'; hue: number | null; autoJoin: boolean }`, `DEFAULT_PREFS = { theme: 'system', hue: null, autoJoin: true }`, `loadPrefs(storage?)`, `savePrefs(p, storage?)` (Schlüssel `plaudr.ui`; `hue` ganzzahlig 0 bis 359, 360 → 0, sonst `null`)
  - `contrast(a: string, b: string): number` (WCAG-Kontrast zweier `#rrggbb`)
  - `accentFor(hue: number): { light: Palette; dark: Palette }` mit `interface Palette { accent: string; accentFg: string; soft: string }` (alle `#rrggbb`)
  - `themeCss(hue: number | null): string` → `''` bei `null`, sonst Regeln für `:root`, `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) {…} }` und `:root[data-theme='dark']`, die nur `--accent`, `--accent-fg`, `--accent-soft` setzen
  - `applyTheme(p: UiPrefs, doc?: Document): void`: `data-theme` am `<html>` setzen (bei `system` entfernen), Inhalt von `<style id="theme">` (anlegen, falls fehlt) = `themeCss(p.hue)`

- [ ] **Step 1: Tests**
  - prefs: Standardwerte bei leerem, kaputtem und fremdem Inhalt (`hue: "abc"`, `theme: "blau"`), `hue: 360` → 0, `hue: 12.7` → 13.
  - theme: „für jeden Farbton 0 bis 359 hält hell `contrast(accent, '#ffffff')`, `contrast(accent, '#f6f5f2')` und `contrast(accent, soft)` mindestens 4,5“, „für jeden Farbton hält dunkel `contrast(accent, '#0d0d0c')`, `contrast(accent, '#161615')`, `contrast(accent, '#20201e')` mindestens 4,5“, „accentFg ist hell `#ffffff`, dunkel `#0d0d0c`“, „themeCss(null) ist leer“, „themeCss(200) enthält alle drei Selektoren“.
- [ ] **Step 2:** `npx vitest run src/ui` → FAIL.
- [ ] **Step 3:** Implementieren. `accentFor`: hell HSL mit S 72 %, L ab 21 % in 1-%-Schritten abwärts, bis alle Bedingungen halten; `soft` hell `hsl(h 30% 90%)`. Dunkel S 39 %, L ab 49 % aufwärts bis höchstens 85 %; `soft` dunkel `hsl(h 24% 16%)`. HSL → Hex selbst rechnen (keine Abhängigkeit).
- [ ] **Step 4:** `npx vitest run && npm run build` → grün.
- [ ] **Step 5:** `git commit -m "Oberflächen-Einstellungen und Farbthema mit festem Kontrast"`

### Task 3: Vier Wörter und Stumm-Status über ctl

**Files:**
- Create: `web/src/crypto/words.ts`, `web/src/crypto/words.test.ts`, `web/src/mesh/ctl.ts`, `web/src/mesh/ctl.test.ts`
- Modify: `web/src/mesh/peer-link.ts`, `web/src/mesh/mesh.ts`, `web/src/mesh/mesh.test.ts`

**Interfaces:**
- Produces:
  - `WORDS: readonly string[]`: 256 deutsche Substantive, kleingeschrieben, nur `a-z` (keine Umlaute, kein ß), 3 bis 7 Buchstaben, paarweise verschieden, kein Wort Anfang eines anderen, nichts Anstößiges
  - `fingerprintWords(pub: string): Promise<string[]>` → `WORDS[h[0..3]]` mit `h = SHA-256(fromBase64url(pub))` (dieselbe Hashbasis wie `peerIdFor`), Länge 4
  - `type CtlMessage = { type: 'state'; muted: boolean }`, `parseCtl(data: unknown): CtlMessage | null` (nur Strings bis 1024 Zeichen, gültiges JSON, `type === 'state'`, `typeof muted === 'boolean'`; sonst `null`, wirft nie), `encodeCtl(m: CtlMessage): string`
  - `PeerLinkLike` neu: `readonly remoteMuted: boolean; setLocalMuted(m: boolean): void`. `PeerLink` hält den `ctl`-Kanal, sendet beim `open` und bei jedem `setLocalMuted` den eigenen Zustand (vor `open` nur merken), setzt `remoteMuted` aus empfangenen Nachrichten und ruft dann `PeerLinkOptions.onRemoteState(): void`.
  - `PeerView` neu: `muted: boolean`. `Mesh.setMuted(m: boolean): void` merkt den Wert, gibt ihn an alle Links und an jeden neuen Link sofort nach dem Anlegen weiter; `onRemoteState` löst `onChange` aus.
- [ ] **Step 1: Tests**
  - words: Länge 256, alle verschieden, Regex `^[a-z]{3,7}$`, keines Präfix eines anderen; `fingerprintWords` liefert 4 Wörter, ist deterministisch, zwei verschiedene Schlüssel ergeben verschiedene Wörter (Stichprobe), Wort i = `WORDS[hash[i]]` (Hash im Test mit `crypto.subtle` gerechnet).
  - ctl: gültige Nachricht; `null` für `'kein json'`, `'{"type":"state","muted":"ja"}'`, `'{"type":"x"}'`, eine Zahl, ein `ArrayBuffer`, einen String mit 2000 Zeichen.
  - mesh (mit den vorhandenen Fake-Links): „setMuted erreicht bestehende und später angelegte Links“, „remoteMuted erscheint in peers() und löst onChange aus“.
- [ ] **Step 2:** `npx vitest run src/crypto src/mesh` → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** `npx vitest run && npm run build` → grün.
- [ ] **Step 5:** `git commit -m "Vier Wörter zum Schlüsselvergleich und Stumm-Status über den Kontrollkanal"`

### Task 4: Mikrofonwahl und Start ohne Nutzergeste

**Files:**
- Create: `web/src/audio/devices.ts`, `web/src/audio/devices.test.ts`, `web/src/audio/resume.ts`, `web/src/audio/resume.test.ts`
- Modify: `web/src/audio/settings.ts`, `web/src/audio/settings.test.ts`, `web/src/audio/pipeline.ts`

**Interfaces:**
- Produces:
  - `AudioSettings.deviceId: string | null` (Standard `null`; beim Laden nur nicht leere Strings)
  - `micChoices(devices: { kind: string; deviceId: string; label: string }[], saved: string | null): { value: string; label: string; selected: boolean }[]`: zuerst `{ value: '', label: 'Standardgerät' }`, dann alle `audioinput` außer `default`/`communications`, leere Labels als `Mikrofon 1`, `Mikrofon 2` …; ausgewählt ist `saved`, wenn vorhanden, sonst `''`
  - `listMics(): Promise<…>` in `devices.ts` (dünn über `navigator.mediaDevices.enumerateDevices()`)
  - `resumeWithin(ctx: { resume(): Promise<void>; state: string }, ms: number): Promise<boolean>`: `true`, sobald `state === 'running'`, `false` nach `ms`
  - `Capture` neu: `needsGesture(): boolean` (Kontext nicht `running`), `resume(): Promise<void>`. `openCapture` wartet höchstens 300 ms auf `resume` (über `resumeWithin`). `getUserMedia` bekommt `deviceId: { ideal }`, wenn gesetzt; `update({ deviceId })` tauscht die Quelle wie heute bei `denoise` (Track bleibt derselbe). `rawCapture` beachtet `deviceId` nur beim Öffnen.
- [ ] **Step 1: Tests**: settings („deviceId bleibt erhalten“, „leerer String → null“); devices („gemerktes Gerät fehlt → Standardgerät ausgewählt“, „leere Labels werden nummeriert“, „default und communications fehlen in der Liste“); resume („gibt true, wenn resume sofort läuft“, „gibt nach 300 ms false, wenn resume nie fertig wird“ mit `vi.useFakeTimers()`).
- [ ] **Step 2:** `npx vitest run src/audio` → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** `npx vitest run && npm run build && npm run e2e` → grün (Pipeline geändert).
- [ ] **Step 5:** `git commit -m "Mikrofonwahl und Aufnahme, die ohne Nutzergeste nicht hängt"`

### Task 5: Gerüst, Thema und Startbildschirm „Deine Räume“

**Files:**
- Modify: `web/index.html`, `web/src/style.css`, `web/src/ui/view.ts`, `web/src/main.ts`, `web/e2e/helpers.ts`
- Create: `web/src/ui/rooms-view.ts`, `web/e2e/rooms.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`loadRooms`, `saveRooms`, `renameRoom`, `removeRoom`, `roomTitle`, `roomSubtitle`, `secretFromLink`, `autoJoinTarget`), Task 2 (`loadPrefs`, `applyTheme`)
- Produces:
  - `type Screen = 'start' | 'lobby' | 'call' | 'settings'`, `view.show(s: Screen)`
  - `initRoomsView(o: { rooms: () => Rooms; setRooms: (r: Rooms) => void; autoJoin: () => boolean; open: (secret: string) => void; create: () => void; settings: () => void }): { render(): void }`
  - IDs: `#rooms-list` (`li[data-room]` mit `.room-join`, `.room-rename`, Editor `.room-name-input`, `.room-name-save`, `.room-remove`), `#rooms-empty`, `#create`, `#paste-link`, `#paste-open`, `#paste-error`, `#start-settings`
- [ ] **Step 1: Gerüst.** `<h1>plaudr</h1>` entfällt; jeder Bildschirm hat seine Kopfzeile wie im Mock. Vierte Section `#settings` als leere Hülle mit Kopfzeile (`#settings-back`). `style.css`: Tokens nach Global Constraints, `:root[data-theme='dark']` mit denselben Werten wie der Dunkel-Block, Bildschirme als Flex-Spalte über die volle Höhe. Quellcode-Fußzeile ans Ende von `#start` und `#settings`. `applyTheme(loadPrefs())` als Erstes in `boot()`.
- [ ] **Step 2: Startbildschirm** nach Artboard „Deine Räume“: Karte je Raum, neuester mit grünem Rahmen und „zuletzt genutzt, wird beim Start betreten“ (nur bei `autoJoin`, sonst „zuletzt genutzt“), Umbenennen klappt den Editor in der Karte auf (Enter speichert, Escape bricht ab), „Aus der Liste entfernen“ ohne Rückfrage. Leer: „Noch keine Räume. Erstell einen oder füg einen Einladungslink ein.“ „Öffnen“ mit ungültigem Text: „Das ist kein plaudr-Link.“ in `#paste-error`.
- [ ] **Step 3: Routing in `main.ts`.** `route()`: beim ersten Aufruf `plaudr.booted` lesen, dann setzen; `autoJoinTarget` → `location.hash = secret`. Ohne Geheimnis `show('start')`. `create` und „Beitreten“ setzen `location.hash`.
- [ ] **Step 4: E2E `rooms.spec.ts`**: „leerer Start zeigt den Hinweis“; „nach Beitritt und Verlassen steht der Raum als ‚Raum vom <heute>‘ in der Liste und es gibt keinen Auto-Beitritt“ (Verlassen kommt in Task 6; bis dahin über `page.goto('/')` im selben Kontext); „Umbenennen und Entfernen“; „eingefügter Link öffnet die Lobby, Unsinn zeigt den Fehler“; „neue Seite im selben Kontext mit leerem sessionStorage landet im letzten Raum (Fragment gesetzt)“ (neue Seite = neuer Tab, eigener sessionStorage; die erste Seite vorher schließen, sonst greift die Tab-Sperre). `helpers.ts` bleibt kompatibel; `open()` prüft weiter `#lobby` sichtbar.
- [ ] **Step 5:** `npx vitest run && npm run build && npm run e2e` → grün.
- [ ] **Step 6:** `git commit -m "Startbildschirm mit Raumverlauf, Farbthema und Auto-Beitritt"`

### Task 6: Erster Start und Gespräch

**Files:**
- Create: `web/src/room/join-rule.ts`, `web/src/room/join-rule.test.ts`
- Modify: `web/index.html`, `web/src/style.css`, `web/src/main.ts`, `web/src/ui/view.ts`, `web/src/ui/controls.ts`, `web/src/ui/backup-panel.ts`, `web/e2e/*.spec.ts` (nur wo IDs oder Abläufe sich ändern)

**Interfaces:**
- Consumes: Task 1 (`noteJoin`, `notePeers`, `renameRoom`, `roomTitle`), Task 3 (`PeerView.muted`, `Mesh.setMuted`), Task 4 (`Capture.needsGesture`, `Capture.resume`)
- Produces:
  - `canJoin(s: { name: string; tabLocked: boolean; identity: { backedUp: boolean; persistent: boolean } | null }): boolean` (die Bedingung, die heute in `updateJoinButton` steht)
  - IDs im Gespräch: `#back`, `#room-title`, `#room-rename`, `#room-name-input`, `#copy`, `#call-settings`, `#peer-count`, `#vad-meter` (enthält `#me-speaking`, `#vad-threshold-label`, `#vad-level`, `#vad-mark`); `#peers li[data-peer]` bekommt `.avatar`, `.name`, `.state` und die Klassen `speaking`, `muted`
  - `mountBackupPanel(slot: HTMLElement): void` in `backup-panel.ts` (hängt `#backup` in den Slot um; Task 7 nutzt es)
- [ ] **Step 1: Test** `join-rule.test.ts`: die vier Fälle (kein Name, kein Lock, Sicherung fehlt bei persistenter Identität, flüchtige Identität ohne Sicherung darf). → FAIL, dann implementieren, `updateJoinButton` nutzt `canJoin`.
- [ ] **Step 2: Erster Start** nach Artboard „Erster Start“: Kopf „Einladung in einen Raum“ / „Bevor es losgeht“, Hinweis unter dem Namen, Sicherungskarte mit Schlüssel-Icon, Knopf „Sicherung speichern“, `#restore` bleibt `<details>` (Summary sieht aus wie ein Link), Fehler unter dem zweiten Passwortfeld, unter „Beitreten“ `#join-hint` „Beitreten geht, sobald der Schlüssel gesichert ist.“ (nur solange Sicherung fehlt). `#backup-again` entfällt (Sicherung erneut: Einstellungen). **Lobby überspringen:** Nach `prepareLobby()` mit `canJoin(...)` direkt `join(secret)`, sonst `show('lobby')`.
- [ ] **Step 3: Gespräch** nach Artboards „Gespräch“ und „Gespräch dunkel“: Kopfzeile (Raumtitel aus dem Verlauf, Stift öffnet `#room-name-input` an Ort und Stelle, Enter/Blur speichert über `renameRoom`, Escape bricht ab), Link-Icon kopiert; scheitert die Zwischenablage, `notice('Kopieren ging nicht. Dein Link: ' + link)`. Das Feld `#link` entfällt. `#peer-count` „IM RAUM (n)“, n = Zahl der Karten. Karten mit Initiale (erster Buchstabe, groß), Zustand: `muted` → „stumm geschaltet“, sprechend → „spricht“ und grüner Rahmen, sonst `STATE_LABEL`. Modus-Knöpfe „Automatisch“, „Push-to-Talk“, „Stumm“. Bei Automatisch `#vad-meter`: Balken = `capture.activity().vad`, Strich bei `threshold`, „Schwelle 85 %“, „du sprichst“ solange offen. Bei PTT großer Halteknopf mit Mikro-Icon, „Zum Sprechen halten“, „oder Leertaste“. Fußzeile mit `#denoise` und „Verlassen“ (rot). Der Schwellenregler wandert in Task 7 in die Einstellungen; bis dahin bleibt er unter dem Pegel.
- [ ] **Step 4: Verdrahtung in `join()`**: `noteJoin` speichern; bei jedem `onChange` Namen der Sitzung sammeln und `notePeers` speichern; `mesh.setMuted(!capture || settings.mode === 'muted')` beim Start und bei jedem Moduswechsel. Wenn `capture?.needsGesture()`: `#unmute-audio` zeigen, Klick ruft `resumeAllAudio()` und `capture.resume()`. „Verlassen“ und `#back`: `mesh.leave()`, dann `location.assign(location.pathname)`.
- [ ] **Step 5: E2E anpassen und ergänzen**: bestehende Specs auf geänderte Abläufe ziehen (zweiter Beitritt im selben Kontext landet ohne Lobby im Gespräch); neu: „Verlassen führt zu Deine Räume, kein Auto-Beitritt“, „B sieht A als stumm geschaltet, sobald A Stumm wählt“, „Raum im Gespräch umbenennen erscheint in der Liste“, „#peer-count zählt die Karten“.
- [ ] **Step 6:** `npx vitest run && npm run build && npm run e2e` → grün.
- [ ] **Step 7:** `git commit -m "Erster Start und Gespräch nach dem Mock, Lobby nur noch wenn nötig"`

### Task 7: Einstellungen

**Files:**
- Create: `web/src/ui/settings-view.ts`
- Modify: `web/index.html`, `web/src/style.css`, `web/src/main.ts`, `web/src/ui/controls.ts`
- Create: `web/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: Task 2 (`UiPrefs`, `savePrefs`, `applyTheme`), Task 3 (`fingerprintWords`), Task 4 (`micChoices`, `listMics`, `AudioSettings.deviceId`), Task 6 (`mountBackupPanel`)
- Produces: `initSettings(o: SettingsOptions): { show(): void; hide(): void }` mit

  ```ts
  interface SettingsOptions {
    audio(): AudioSettings; setAudio(p: Partial<AudioSettings>): Promise<void>;
    activity(): CaptureActivity | null;          // null: kein Pegel verfügbar
    prefs(): UiPrefs; setPrefs(p: Partial<UiPrefs>): void;
    name(): string; setName(n: string): void;
    identity(): Identity | null;
    back(): void;
  }
  ```
  IDs: `#settings-back`, `#ptt-info`, `#mic-select`, `#vad-threshold` (jetzt hier, `min=50 max=99 step=1`, Wert in Prozent), `#vad-threshold-value`, `#settings-level`, `#settings-mark`, `#settings-denoise`, `#theme-system`, `#theme-light`, `#theme-dark` (`aria-pressed`), `#hue`, `#hue-value`, `#hue-reset`, `#settings-name`, `#my-words`, `#settings-backup`, `#settings-restore`, `#backup-slot`, `#auto-join`
- [ ] **Step 1: Bildschirm** nach Artboard „Einstellungen“, Abschnitte Push-to-Talk, Mikrofon, Darstellung, Identität, Start. Im Browser: Push-to-Talk zeigt nur „Leertaste, solange plaudr im Vordergrund ist.“; „Beim Anmelden starten“ fehlt (kommt mit M4). `#settings-name` ändert den gespeicherten Namen (leer wird nicht übernommen); im Gespräch darunter „Gilt ab dem nächsten Beitritt.“ `#my-words` „tiger · anker · wolke · mond“-Format. „Schlüssel sichern“ / „Sicherung laden“ hängen `#backup` per `mountBackupPanel` in `#backup-slot` (Laden öffnet zusätzlich `#restore`); `hide()` hängt es zurück in die Lobby.
- [ ] **Step 2: Verdrahtung in `main.ts`**: `#start-settings` und `#call-settings` zeigen `settings` und merken den Rückweg; `back()` zeigt ihn wieder, das Gespräch läuft weiter. Außerhalb eines Gesprächs öffnet `show()` eine Test-Aufnahme (`openCapture({ ...settings, mode: 'vad' })`) für den Pegel und `hide()` schließt sie; im Gespräch kommt der Pegel von der Gesprächs-Aufnahme. `setAudio` speichert und gibt an die jeweils laufende Aufnahme weiter; `#denoise` und `#settings-denoise` zeigen denselben Wert. Mikrofonliste beim `show()` neu laden (Labels gibt es erst nach der Freigabe). Der Schwellenregler verschwindet aus dem Gespräch, dort bleibt nur die Anzeige.
- [ ] **Step 3: E2E `settings.spec.ts`**: „Farbton ändert `--accent`, Standardfarbe setzt zurück“, „Dunkel setzt `data-theme=dark`, bleibt nach Neuladen“, „Schwelle 70 % erscheint im Gespräch als ‚Schwelle 70 %‘“, „Einstellungen aus dem Gespräch und zurück: Mesh bleibt verbunden“, „Sicherung aus den Einstellungen lädt eine Datei herunter“ (ersetzt den alten `#backup-again`-Ablauf in `identity.spec.ts`), „Auto-Beitritt aus: neuer Tab zeigt die Liste“, „vier Wörter stehen da und passen zu `fingerprintWords`“. Bestehende Specs, die `#vad-threshold` im Gespräch erwarten, auf die Anzeige `#vad-meter` umstellen.
- [ ] **Step 4:** `npx vitest run && npm run build && npm run e2e` → grün.
- [ ] **Step 5:** `git commit -m "Einstellungen mit Mikrofonwahl, Schwelle, Farbthema, Identität und Auto-Beitritt"`

### Task 8: Abgleich mit dem Mock und Abschluss

**Files:**
- Modify: `README.md` (falls Bedienung beschrieben), STATUS.md des Projekts (außerhalb des Repos)
- [ ] **Step 1:** `npm run dev`, jeden Bildschirm in 400 × 780 hell und dunkel neben das Artboard legen (Chrome-Fenstergröße). Abweichungen in Text, Reihenfolge und Zuständen beheben; Abweichungen, die bewusst sind, im Abschluss nennen.
- [ ] **Step 2:** Bei 320 px Breite: kein waagerechtes Scrollen, Kopfzeile des Gesprächs kürzt den Raumnamen mit „…“.
- [ ] **Step 3:** `npx vitest run && npm run build && npm run e2e` → grün.
- [ ] **Step 4:** `git commit -m "Feinschliff nach Abgleich mit dem UI-Mock"` (nur wenn Step 1 oder 2 etwas geändert hat)
