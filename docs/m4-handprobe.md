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

## Tray, Fenster schließen, Beenden (nach Task 4)

Menü, Fenster und Beenden sind per E2E mit nachgebautem Tauri geprüft (`web/e2e/desktop.spec.ts`); offen
ist, wie das echte System Symbol und Menü zeigt und ob das Gegenüber beim echten Beenden sofort Bescheid
bekommt. Gegenstelle für 26 bis 29: ein Browser-Tab im selben Raum (die Gnadenfrist dort ist 5 s).

| # | Plattform | Prüfung | Erwartung | Ergebnis |
|---|---|---|---|---|
| 21 | macOS | App starten, Tray-Symbol in der Menüleiste anklicken (ohne Gespräch) | schwarzes „p“ mit Pegelbalken, im Dunkelmodus hell (Template); Menü: „Kein Gespräch“, Trenner, „Stumm schalten“, „Automatisch sprechen“ (beide gesperrt), „Fenster zeigen“, Trenner, „Raum verlassen“ (gesperrt), „plaudr beenden“ | |
| 22 | macOS | Raum mit dem Browser-Tab, Push-to-Talk mit ⌥ Leertaste, Menü öffnen | Kopf „<Raum> · 2 im Raum“, darunter „Push-to-Talk (⌥ Leertaste)“; „Stumm schalten“ schaltet stumm (Kopfzeile „Stumm“, Eintrag heißt „Stummschaltung aufheben“), „Automatisch sprechen“ mit Häkchen schaltet um | |
| 23 | macOS | Globale Taste halten, dann loslassen | Symbol grün, solange du sendest, danach wieder Template; im Modus Automatisch grün beim Sprechen | |
| 24 | macOS | Fenster mit dem roten Knopf (oder Cmd+W) schließen, zum ersten Mal | Hinweis „plaudr läuft im Tray weiter.“ unten im Fenster, nach 2 s verschwindet das Fenster; App läuft weiter, Gespräch und globale Taste auch | |
| 25 | macOS | Noch einmal schließen; dann „Fenster zeigen“ im Tray, dann Klick aufs Dock-Symbol bei verstecktem Fenster | kein Hinweis mehr, Fenster sofort weg; „Fenster zeigen“ und das Dock-Symbol holen es nach vorn | |
| 26 | macOS | Im Gespräch „Raum verlassen“ im Tray | Fenster zeigt „Deine Räume“ (kein Auto-Beitritt), im Browser-Tab verschwindest du sofort; Tray-Kopf „Kein Gespräch“ | |
| 27 | macOS | Im Gespräch „plaudr beenden“ im Tray | App ist binnen 1 s weg, im Browser-Tab verschwindest du sofort (nicht erst nach 5 s) | |
| 28 | macOS | Im Gespräch Cmd+Q (App-Menü heißt jetzt „plaudr beenden“) | wie 27 | |
| 29 | macOS | Im Gespräch Rechtsklick aufs Dock-Symbol › Beenden; Abmelden vom System | App wartet bis 1 s, im Browser-Tab verschwindest du sofort (bestmöglich; geht es nicht, greift dort die Gnadenfrist) | |
| 30 | Windows | Tray-Symbol in der Taskleiste (ggf. unter „Ausgeblendete Symbole“) | graues „p“, beim Senden grün; Tooltip „plaudr · <Raum> · <Modus>“ | |
| 31 | Windows | Linksklick aufs Tray-Symbol bei verstecktem Fenster; Rechtsklick | Linksklick zeigt das Fenster, Rechtsklick das Menü wie unter 21 und 22 | |
| 32 | Windows | wie 24 bis 27 (Schließen mit X oder Alt+F4) | wie 24 bis 27 | |
| 33 | Windows | Im Gespräch abmelden oder herunterfahren | im Browser-Tab verschwindest du sofort (bestmöglich, wie 29) | |

## Deep-Links, Einzelinstanz, Autostart, Dialoge (nach Task 5)

Per E2E mit nachgebautem Tauri geprüft: Startlink vor dem Auto-Beitritt, Link im Gespräch (Gegenüber sieht
dich sofort gehen, dieselbe Identität, ein Tray-Symbol), ungültige Links samt `plaudr://quit`, Autostart-
Schalter mit Fehlern, Speichern und Laden über die Dialoge. An der echten macOS-App beim Bau schon
nachgesehen: 34, 35 (ohne Gespräch), 36, 37, 39 und das Ein- und Ausschalten in 40 (LaunchAgent
`~/Library/LaunchAgents/plaudr.plist` mit `--hidden` erscheint und verschwindet). Offen ist der Rest.
Ein gültiges Geheimnis: im Browser einen Raum erstellen und den Teil nach `#` nehmen.

| # | Plattform | Prüfung | Erwartung | Ergebnis |
|---|---|---|---|---|
| 34 | macOS | App beendet, im Terminal `open 'plaudr://raum#<Geheimnis>'` | App startet, Fenster zeigt diesen Raum (Lobby oder direkt das Gespräch), kein Auto-Beitritt in den letzten Raum | |
| 35 | macOS | App läuft im Gespräch mit einem Browser-Tab, Fenster im Tray; `open 'plaudr://<anderes Geheimnis>/'` | Fenster kommt nach vorn, im Browser-Tab verschwindest du sofort, die App ist im neuen Raum mit denselben 4 Wörtern; ein einziges Tray-Symbol, „Raum verlassen“ und „plaudr beenden“ wirken danach | |
| 36 | macOS | `open 'plaudr://quit'` und `open 'plaudr://raum'` bei laufender App | App bleibt, Hinweis „Das ist kein plaudr-Link.“ unten im Fenster | |
| 37 | macOS | App läuft, das Programm im Bündel noch einmal starten (`plaudr.app/Contents/MacOS/plaudr`) | zweiter Prozess endet sofort, das vorhandene Fenster kommt nach vorn; mit `--hidden` bleibt es im Tray | |
| 38 | macOS | Einladungslink `https://plaudr.room.ws/#…` in Safari anklicken | öffnet die Web-App (das Schema https bleibt beim Browser); Einfügen des Links in „Deine Räume“ der App führt in den Raum | |
| 39 | macOS | `open -a plaudr.app --args --hidden` | kein Fenster, Tray-Symbol da; war „Zuletzt genutzten Raum automatisch betreten“ an, ist die App im letzten Raum (Gegenüber sieht dich) | |
| 40 | macOS | Einstellungen › Start › „Beim Anmelden starten (im Tray)“ an, abmelden, anmelden | plaudr startet ohne Fenster im Tray, Auto-Beitritt wie in 39; Haken nach dem Öffnen der Einstellungen gesetzt; aus: startet nicht mehr | |
| 41 | macOS | Schlüssel sichern: Speichern-Dialog, Vorschlag `plaudr-<Name>.plaudr-key`; einmal abbrechen, einmal speichern | Abbrechen lässt die Sicherung ausstehend; gespeicherte Datei liegt am gewählten Ort | |
| 42 | macOS | Sicherung laden: „Datei wählen“ (Dateifeld fehlt), Datei aus 41 wählen, Passwort, „Sicherung laden“ | Öffnen-Dialog zeigt nur `.plaudr-key`, der Dateiname steht neben dem Knopf, danach „Sicherung geladen.“ und die 4 Wörter der Sicherung | |
| 43 | Windows | App läuft (auch im Tray); in Explorer oder Win+R `plaudr://raum#<Geheimnis>` | kein zweites Fenster, kein zweites Tray-Symbol; die laufende App kommt nach vorn und betritt den Raum (Link kommt über die zweite Instanz an) | |
| 44 | Windows | App beendet, wie 43 | App startet und betritt den Raum | |
| 45 | Windows | wie 36, 37 (zweiter Start von `plaudr.exe`), 39 bis 42 (Autostart über den Registry-Eintrag `HKCU\…\Run`) | wie dort | |

## Release-Build aus CI (nach Task 6)

Artefakte aus dem Workflow „Desktop“ (`docs/release.md`), nicht der lokale Bau. Unter macOS zeigt nur die
signierte und notarisierte Fassung, ob die Hardened Runtime das Mikrofon freigibt; die ad-hoc-signierte
läuft ebenfalls mit Hardened Runtime und Entitlements und ist ein guter Vortest.

| # | Plattform | Prüfung | Erwartung | Ergebnis |
|---|---|---|---|---|
| 46 | macOS | `plaudr_<Version>_universal.dmg` öffnen, App in „Programme“ ziehen, starten | signiert: startet ohne Gatekeeper-Warnung (`spctl -a -vv /Applications/plaudr.app` meldet „Notarized Developer ID“); ad-hoc: erst nach `xattr -dr com.apple.quarantine` | |
| 47 | macOS | Raum betreten, Gespräch gegen den Browser-Tab | Mikrofonabfrage einmal, das Gegenüber hört dich (Entitlement `com.apple.security.device.audio-input` wirkt) | |
| 48 | macOS | Intel-Mac oder `arch -x86_64 /Applications/plaudr.app/Contents/MacOS/plaudr` | App läuft auch als x86_64 (Universal-Bündel) | |
| 49 | Windows | `plaudr_<Version>_x64-setup.exe` ausführen | SmartScreen warnt („Der Computer wurde durch Windows geschützt“), über „Weitere Informationen“ › „Trotzdem ausführen“ geht es weiter; Installation ohne Adminrechte, Eintrag im Startmenü | |
| 50 | Windows | Installation auf einem Rechner ohne WebView2-Runtime (etwa Windows 10 ohne Edge-Update) | Installer lädt die Runtime nach (Bootstrapper), danach startet plaudr | |
| 51 | Windows | Punkte 7 bis 9 und 43 mit der installierten App | wie dort; `plaudr://` ist nach dem ersten Start eingetragen | |
| 52 | Windows | Deinstallation über „Apps“ in den Einstellungen | App und Startmenü-Eintrag sind weg | |

Ergebnis und Auffälligkeiten hier oder in STATUS.md festhalten.
