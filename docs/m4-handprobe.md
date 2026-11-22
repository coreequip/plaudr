# Handprobe M4: Desktop-Client

Was die automatischen Prüfungen nicht abdecken: Systemabfragen, echte Mikrofone, das Gespräch
zwischen Desktop-App und Browser und Plattformeigenheiten von WebKit (macOS) und WebView2 (Windows).
Die Ergebnisse fließen in die Spec (§8) und in STATUS.md zurück.

## Vorbereitung

- macOS: `cd desktop && npm ci && npm run build`, dann
  `desktop/src-tauri/target/release/bundle/macos/plaudr.app` starten. Ad-hoc-signiert: Nach jedem
  Neubau kann macOS erneut nach dem Mikrofon fragen.
- Windows: `cd desktop/src-tauri && cargo xwin build --release --target x86_64-pc-windows-msvc`,
  `target/x86_64-pc-windows-msvc/release/plaudr.exe` auf den Windows-Rechner kopieren und starten
  (WebView2-Runtime muss vorhanden sein, ab Windows 11 vorinstalliert).
- Gegenstelle: ein Browser-Tab auf <https://plaudr.room.ws>, auf einem zweiten Gerät oder mit Kopfhörern.
- Konsole der WebView: macOS per Rechtsklick „Element untersuchen“ geht nur im Debug-Build
  (`npm run tauri build -- --debug --bundles app`); unter Windows ebenso.

## Prototyp

Stand des Builds: Task 1 von M4 (Gerüst ohne Plattformschicht). Größen beim Bau: `.app` 3,2 MB
(gezippt 1,6 MB), `.exe` 3,1 MB (gezippt 1,3 MB).

| # | Plattform | Prüfung | Erwartung | Ergebnis |
|---|---|---|---|---|
| 1 | macOS | App starten | Fenster 400 × 780, Titel „plaudr“, Startbildschirm wie im Browser | |
| 2 | macOS | Raum erstellen und beitreten | macOS fragt einmal nach dem Mikrofon mit „plaudr braucht das Mikrofon für Sprachgespräche.“, danach keine zweite Abfrage der WebView | |
| 3 | macOS | Einladungslink im Browser-Tab öffnen, beitreten | Verbindung kommt zustande (Origin `tauri://localhost` wird von room_ws angenommen), beide hören sich | |
| 4 | macOS | App beenden und neu starten, dann demselben Raum wieder beitreten | Raumverlauf und Einstellungen sind noch da, das Gegenüber sieht dieselbe Identität (Ed25519-Schlüssel in IndexedDB bleibt erhalten) | |
| 5 | macOS | Sprachaktivierung und Rauschunterdrückung | Pegel bewegt sich, „du sprichst“ erscheint, RNNoise lässt sich schalten (AudioWorklet und WASM laufen unter der CSP) | |
| 6 | macOS | Debug-Build, Konsole | keine CSP-Verstöße | |
| 7 | Windows | App starten | Fenster wie unter 1, kein Konsolenfenster | |
| 8 | Windows | Raum erstellen und beitreten | Mikrofon läuft unter WebView2, höchstens eine Abfrage | |
| 9 | Windows | Gespräch gegen den Browser-Tab | Verbindung kommt zustande (Origin `http://tauri.localhost` wird über die Endung `.localhost` angenommen), beide hören sich | |
| 10 | Windows | Punkte 4 und 5 wiederholen | wie unter macOS | |

## Globale Taste (nach Task 3)

Erst prüfbar, wenn die globale PTT-Taste eingebaut ist. Kommt unter einem System kein Loslassen an,
ist Push-to-Talk dort nicht sicher nutzbar und der Plan muss angepasst werden.

| # | Plattform | Prüfung | Erwartung | Ergebnis |
|---|---|---|---|---|
| 11 | macOS | PTT-Taste belegen, in einem anderen Programm halten und loslassen | Drücken öffnet das Gate, Loslassen schließt es (Released kommt an) | |
| 12 | macOS | Taste halten, dabei Fenster wechseln, dann loslassen | Gate schließt trotzdem, kein Dauersenden | |
| 13 | Windows | wie 11 | wie 11 | |
| 14 | Windows | wie 12 | wie 12 | |

Ergebnis und Auffälligkeiten hier oder in STATUS.md festhalten.
