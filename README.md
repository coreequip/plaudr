# plaudr

Ende-zu-Ende-verschlüsselte Sprachkonferenz für kleine Runden (3 bis 4 Personen), im Browser unter
<https://plaudr.room.ws> und als schlanker Desktop-Client für Windows und macOS. Keine Accounts:
Wer den Link hat, ist dabei. Signaling über [room_ws](https://github.com/coreequip/room_ws), Audio direkt
zwischen den Teilnehmern per WebRTC.

Details: [docs/spec.md](docs/spec.md).

## Entwicklung

```sh
git clone --recurse-submodules https://github.com/coreequip/plaudr.git
cd plaudr/web
npm ci
npm run dev        # Vite-Dev-Server
npx vitest run     # Unit-Tests
npx playwright test  # Ende-zu-Ende-Tests (startet lokal room_ws per Go und Chromium)
```

## Desktop-App bauen

Die Desktop-App (Tauri 2) bündelt den Build aus `web/` und lädt nie die Live-Seite. Voraussetzungen:
Rust (stable), Node.js und ein eingerichtetes `web/` (`npm ci` dort, siehe oben).

```sh
cd desktop
npm ci
npm run dev        # App mit dem Vite-Dev-Server aus web/
npm run build      # baut web/ und danach plaudr.app (macOS)
```

Ergebnis unter `desktop/src-tauri/target/release/bundle/macos/plaudr.app`. Das DMG-Bundling scheitert
auf macOS 27 (`hdiutil create` veraltet), daher baut `npm run build` lokal nur das `.app`-Bündel; das DMG
entsteht in CI. Lokal gebaute Apps sind ad-hoc signiert; wenn macOS sie blockiert:
`xattr -dr com.apple.quarantine plaudr.app`.

Windows lässt sich von macOS aus mit [cargo-xwin](https://github.com/rust-cross/cargo-xwin)
übersetzen (vorher `npm --prefix web run build`):

```sh
cd desktop/src-tauri
cargo xwin build --release --target x86_64-pc-windows-msvc
```

Abhängigkeiten sind exakt gepinnt und mindestens zwei Wochen alt; das gilt auch für `Cargo.lock`. Nach
einer neuen Abhängigkeit die Lockfile mit Stichtag neu auflösen (in `desktop/src-tauri`, Stichtag = heute
minus zwei Wochen): `RUSTC_BOOTSTRAP=1 cargo -Zunstable-options generate-lockfile --publish-time 2026-11-08T00:00:00Z`.
Für npm entsprechend `npm install --save-exact --before=2026-11-08 paket@x.y.z`.

Die Tray-Symbole (`desktop/src-tauri/icons/tray-*.png`) erzeugt `desktop/scripts/tray-icons.sh` aus dem
App-Symbol neu (braucht `rsvg-convert`).

Links `plaudr://raum#<Geheimnis>` öffnen die App. macOS kennt das Schema, sobald das `.app`-Bündel einmal
gestartet (oder mit `lsregister -f` eingetragen) wurde; unter Windows trägt die App es bei jedem Start
für den Benutzer ein. Ein zweiter Start reicht Link und Argumente an die laufende App weiter.

Prüfpunkte von Hand (Handprobe auf echten Systemen): [docs/m4-handprobe.md](docs/m4-handprobe.md).

Release-Builds baut der GitHub-Workflow „Desktop“: macOS als DMG für Apple Silicon (signiert und notarisiert, wenn
die Apple-Secrets gesetzt sind, sonst ad-hoc), Windows als NSIS-Installer (unsigniert, SmartScreen warnt).
Er läuft bei einem Tag `desktop-v<Version>` oder von Hand; gewöhnliche Pushes lösen ihn nicht aus. Die
Artefakte eines Laufs lädst du über die Actions-Seite oder `gh run download <Lauf-ID>`. Die App
aktualisiert sich selbst aus dem jeweils neuesten veröffentlichten Release. Signatur, Notarisierung,
Update-Schlüssel und Secrets: [docs/release.md](docs/release.md).

## Lizenz

Copyright (C) 2026 core.equip

Dieses Programm ist freie Software: Du kannst es unter den Bedingungen der GNU Affero General Public
License, Version 3, weitergeben und verändern (siehe [LICENSE](LICENSE)). Wer eine veränderte Fassung
über ein Netzwerk anbietet, muss deren Quellcode den Nutzern zugänglich machen.
