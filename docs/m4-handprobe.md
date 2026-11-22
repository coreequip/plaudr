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

Kommt unter einem System kein Loslassen an, ist Push-to-Talk dort nicht sicher nutzbar und der Plan muss
angepasst werden. Die Einstellungs-Oberfläche selbst ist per E2E mit nachgebautem Tauri geprüft
(`web/e2e/desktop.spec.ts`); offen ist, was nur das echte System zeigt.

| # | Plattform | Prüfung | Erwartung | Ergebnis |
|---|---|---|---|---|
| 11 | macOS | Einstellungen › Push-to-Talk: „Neue Taste aufnehmen“, ⌥ Leertaste drücken | `kbd` zeigt „⌥ Leertaste“, kein Hinweis; im Gespräch (Push-to-Talk) steht unter dem Knopf „oder ⌥ Leertaste überall, auch im Hintergrund“ | |
| 12 | macOS | Im Gespräch mit Push-to-Talk in einem anderen Programm die Taste halten, dann loslassen | Gegenüber im Browser hört dich, Loslassen schließt das Gate (Released kommt an); das andere Programm bekommt die Taste nicht | |
| 13 | macOS | Taste halten, dabei Fenster wechseln oder Bildschirm sperren, dann loslassen | Gate schließt trotzdem, kein Dauersenden | |
| 14 | macOS | Kürzel aufnehmen, das eine andere laufende App global belegt hat (etwa ein Launcher oder Bildschirmfoto-Programm) | „Diese Taste ist schon vergeben. Nimm eine andere.“, die bisherige Taste bleibt und wirkt weiter | |
| 15 | macOS | App beenden und neu starten | Taste steht wieder in den Einstellungen und wirkt ohne neues Aufnehmen | |
| 16 | macOS | Taste halten und im Gespräch auf „Automatisch“ wechseln; in „Automatisch“ die Taste drücken | Wechsel beendet das Senden sofort; in „Automatisch“ bewirkt die Taste nichts | |
| 17 | macOS | Im Gespräch per Link in einen anderen Raum wechseln (Seite lädt neu) | Globale Taste wirkt weiter | |
| 18 | macOS | Fenster in den Tray geschickt bzw. minimiert | Globale Taste wirkt weiter | |
| 19 | Windows | wie 11 (Alt+Leertaste, Anzeige „Alt+Leertaste“) | wie 11 | |
| 20 | Windows | wie 12 bis 18 | wie 12 bis 18 | |

Ergebnis und Auffälligkeiten hier oder in STATUS.md festhalten.
