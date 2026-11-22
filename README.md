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

## Lizenz

Copyright (C) 2026 core.equip

Dieses Programm ist freie Software: Du kannst es unter den Bedingungen der GNU Affero General Public
License, Version 3, weitergeben und verändern (siehe [LICENSE](LICENSE)). Wer eine veränderte Fassung
über ein Netzwerk anbietet, muss deren Quellcode den Nutzern zugänglich machen.
