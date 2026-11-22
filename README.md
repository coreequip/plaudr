# plaudr

Ende-zu-Ende-verschlüsselte Sprachkonferenz für kleine Runden (3 bis 4 Personen), im Browser unter
<https://plaudr.room.ws> und später als schlanker Desktop-Client für Windows und macOS. Keine Accounts:
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
auf macOS 27 (`hdiutil create` veraltet), daher baut `npm run build` nur das `.app`-Bündel.

Windows lässt sich von macOS aus mit [cargo-xwin](https://github.com/rust-cross/cargo-xwin)
übersetzen (vorher `npm --prefix web run build`):

```sh
cd desktop/src-tauri
cargo xwin build --release --target x86_64-pc-windows-msvc
```

Prüfpunkte von Hand: [docs/m4-handprobe.md](docs/m4-handprobe.md).

## Lizenz

Copyright (C) 2026 core.equip

Dieses Programm ist freie Software: Du kannst es unter den Bedingungen der GNU Affero General Public
License, Version 3, weitergeben und verändern (siehe [LICENSE](LICENSE)). Wer eine veränderte Fassung
über ein Netzwerk anbietet, muss deren Quellcode den Nutzern zugänglich machen.
