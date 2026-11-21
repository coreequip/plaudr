# Spike: Größe Wails v3 gegen Tauri 2

Ergebnis: Entscheidung für Tauri 2.

Stand: 2026-11-21, gebaut auf macOS 27.2 (arm64).

## Aufbau

Beide Apps laden dieselbe statische Testseite (ca. 3 KB HTML/JS, ohne Framework):
Origin und User-Agent anzeigen, Ed25519 in WebCrypto prüfen, Mikrofon öffnen,
Audio über eine lokale WebRTC-Loopback-Verbindung schicken, Pegel anzeigen.

| | Wails | Tauri |
|---|---|---|
| Version | wails3 v3.1.0, Go 1.27.3 | tauri-cli 2.12.6, tauri 2.12.7, Rust 1.98.1 |
| Vorlage | `wails3 init -t vanilla`, Beispieldienst entfernt | `tauri init`, Standard-Plugin `tauri-plugin-log` belassen |
| Release-Flags | Wails-Standard: `-trimpath -ldflags="-w -s"` | Standard bzw. optimiert: `opt-level="s"`, `lto`, `codegen-units=1`, `panic="abort"`, `strip` |
| Windows | `wails3 task windows:build` (Go cross-kompiliert) | `cargo-xwin`, Ziel `x86_64-pc-windows-msvc` |

## Ergebnisse

| | Wails v3 | Tauri 2 (Standardprofil) | Tauri 2 (optimiert) |
|---|---|---|---|
| macOS-Binary arm64 | 9,0 MB | 10,0 MB | 3,1 MB |
| macOS `.app` | 10 MB | 9,8 MB | 3,2 MB |
| macOS `.app` gezippt | 5,2 MB | | 1,6 MB |
| Windows `.exe` x64 | 10,5 MB | | 3,2 MB |
| Windows `.exe` gezippt | 4,2 MB | | 1,3 MB |
| RAM im Leerlauf (macOS, RSS Hauptprozess) | ca. 120 MB | | ca. 105 MB |

Zum RAM: Beide starten dieselben WebKit-Hilfsprozesse (WebContent, GPU, Networking,
zusammen ca. 90 MB). RSS enthält geteilte Systembibliotheken; der Unterschied ist
praktisch bedeutungslos. Unter Windows kommen bei beiden die WebView2-Prozesse dazu.

## Bewertung

- Tauri ist optimiert etwa **dreimal kleiner** (Download ca. 1,5 MB gegen 4 bis 5 MB).
  Der Grund ist die Go-Laufzeit samt Wails-Bibliothek; für die Testseite ist der
  Web-Anteil vernachlässigbar.
- Mit RNNoise-WASM (ca. 100 bis 200 KB) und der eigentlichen App wächst beides nur
  geringfügig. Ein Wails-Client bleibt im einstelligen MB-Bereich: verglichen mit
  Discord (über 100 MB) für beide Varianten „ganz schmal“.
- Unter Windows muss bei beiden das WebView2-Runtime vorhanden sein (ab Windows 11
  und auf aktuellen Windows-10-Systemen vorinstalliert). Ohne Installer wird es nicht
  nachinstalliert.

## Nebenbefunde

- Tauri: Das DMG-Bundling scheitert auf macOS 27, weil `bundle_dmg.sh` den
  veralteten Aufruf `hdiutil create` nutzt (nur Warnung, aber Abbruch).
  Für Wails noch nicht geprüft.
- Wails: Das Projekt-Taskfile enthält Ziele für `.app`, ad-hoc-Signatur, NSIS und MSIX.
- NSIS-Installer wurden nicht gebaut (`makensis` nicht installiert).

## Mikrofonfreigabe (macOS, von Hand getestet)

- Tauri: nur die macOS-Abfrage (TCC), danach läuft das Mikrofon sofort; wry erteilt die
  WebView-Freigabe selbst.
- Wails mit Standard (`PermissionDefault`): erst die macOS-Abfrage, dann zusätzlich die
  WebView-eigene Abfrage. Abhilfe am Fenster:
  `Permissions: map[application.PermissionType]application.Permission{application.PermissionMicrophone: application.PermissionAllow}`.
  Die Option gilt plattformübergreifend, also auch für WebView2 unter Windows.
- Die macOS-Abfrage bleibt bei beiden und ist gewollt; ad-hoc-signierte Builds können
  nach jedem Neubau erneut fragen, weil sich die Signatur ändert.

## Nicht geprüft

Globale PTT-Taste, Notarisierung: Das ist der
Prototyp vor M4 (siehe `docs/spec.md`, Abschnitt 7).
