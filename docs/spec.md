# plaudr: Spezifikation

Stand: 2026-11-22

## 1. Ziel

Sprachkonferenz für 3 bis 4 Personen, Ende-zu-Ende-verschlüsselt, ohne Accounts.
Erreichbar im Browser unter `https://plaudr.room.ws` und als schlanker Desktop-Client
für Windows und macOS. Signaling über den bestehenden Pub/Sub-Server room_ws
(`wss://live.room.ws`), TURN über das vorhandene coturn (`/turn`-Endpoint).

**Nicht-Ziele:** Gruppen über 6 Personen, Video, Bildschirmfreigabe, dauerhafter Textchat,
Aufzeichnung, serverseitige Nutzerverwaltung.

## 2. Architektur

```
 Browser / Tauri-WebView                         Browser / Tauri-WebView
 ┌───────────────────────┐   verschlüsselte      ┌───────────────────────┐
 │ UI ─ Session ─ Crypto │◄── Umschläge ────────►│ UI ─ Session ─ Crypto │
 │        │              │   (room_ws, Broadcast)│        │              │
 │  RTCPeerConnection ×3 │◄══ DTLS-SRTP (P2P) ══►│  RTCPeerConnection ×3 │
 └───────────────────────┘   ggf. via coturn     └───────────────────────┘
```

- **Full Mesh:** jeder Teilnehmer hält eine `RTCPeerConnection` zu jedem anderen.
- **room_ws** sieht nur: Raum-ID (Hash), client_ids, IP-Adressen, Zeitpunkte, Größe
  verschlüsselter Umschläge. Keine Namen, keine Schlüssel, keine SDPs, kein Audio.
- **coturn** sieht nur verschlüsselte SRTP/DTLS-Pakete.

### Repository-Aufbau

```
web/        Vite + TypeScript ohne UI-Framework: die gesamte App
  src/crypto/     Schlüssel, HKDF, Umschläge, Signaturen
  src/signaling/  room_ws-Anbindung, Nachrichtentypen
  src/mesh/       PeerConnections, Perfect Negotiation, ICE-Bündelung
  src/audio/      Aufnahmekette, RNNoise-Worklet, PTT/VAD-Gate
  src/ui/
desktop/    Tauri 2.x (src-tauri), bündelt den Build aus web/
docs/
```

Der room_ws-Client (`roomws.js`) wird als Abhängigkeit eingebunden, nicht kopiert.

## 3. Räume und Einladungslink

**Vertrauensmodell: Wer den Link hat, darf rein.**

- Ein Raum entsteht durch 32 zufällige Bytes `S` (Raumgeheimnis).
- Link: `https://plaudr.room.ws/#<base64url(S)>`. Das Fragment verlässt den Browser nie.
- Ableitungen (HKDF-SHA-256, Salt leer):
  - `roomId = hex(HKDF(S, info="plaudr/v1/room-id", 32 Byte))`: room_ws-Raumname
  - `roomKey = HKDF(S, info="plaudr/v1/room-key")` als AES-256-GCM-Schlüssel
- Raum „neu erzeugen“ = neues `S`, neuer Link; der alte Raum ist damit verlassen.
- Bekannte Räume speichert der Client lokal mit selbst gewähltem Namen (Abschnitt 7).

Folge des Modells: Ein weitergegebener Link ist ein gültiger Zutritt. Gegenmittel sind
sichtbare Teilnehmerliste, lokales Blockieren (Abschnitt 5) und Raum neu erzeugen.

## 4. Identität

- Beim ersten Start: Ed25519-Schlüsselpaar über WebCrypto, abgelegt in IndexedDB;
  dazu `navigator.storage.persist()`. Der private Schlüssel ist exportierbar, damit er
  gesichert werden kann (Abwägung: Schadcode auf der Seite könnte ihn abgreifen, könnte
  aber ohnehin in deinem Namen signieren, solange er läuft).
- `peerId = base32(SHA-256(publicKeyRaw))[0..26]`, Anzeige zusätzlich als 4 Wörter
  aus einer Wortliste (für Vergleich am Telefon, optional).
- Anzeigename wählt der Nutzer frei und muss ihn angeben (kein Standardname); er reist im `hello` mit.
- Lokale Kontaktliste pro Client: `peerId → zuletzt gesehener Name, erstmals gesehen`.
  Taucht ein bekannter Name mit **anderer** peerId auf, zeigt die UI einen Hinweis
  („Anna hat einen neuen Schlüssel“): typischer Fall Browserdaten gelöscht.
- **Sicherung ist Pflicht:** Nach dem Anlegen kann man erst beitreten, wenn der Schlüssel
  gesichert ist. Sicherungsdatei `plaudr-<Name>.plaudr-key` (JSON: `format`, `v`, `pub`,
  `kdf` = PBKDF2-SHA-256 mit 600 000 Runden und 16 Byte Salt, `iv`, `ct` = AES-256-GCM
  über den PKCS#8-Schlüssel, `pub` als Zusatzdaten gebunden), Passwort mindestens 8 Zeichen.
  Später jederzeit erneut sicherbar. Über „Sicherung laden“ nimmt man die Identität in die
  App oder einen anderen Browser mit. Ohne nutzbaren Speicher (flüchtige Identität) entfällt
  die Pflicht.
- Verlust von Datei oder Passwort = neue Identität, man wird über den Link wieder Mitglied.

Was die Identität bei „Link reicht“ leistet: room_ws kann ohne `roomKey` weder lesen
noch einschleusen. Die Signaturen schützen gegen **andere Linkinhaber**, die die
Umschläge entschlüsseln und sonst zwischen zwei Teilnehmern SDPs austauschen könnten,
und sorgen dafür, dass „Anna“ von Sitzung zu Sitzung dieselbe Anna ist.

## 5. Signaling-Protokoll

### Transport

room_ws-Publish in `roomId`, immer mit `no_echo: true`. History wird nicht genutzt.

```json
{ "v": 1, "iv": "<b64 12 Byte>", "ct": "<b64 AES-GCM(roomKey)>" }
```

### Klartext im `ct`

```json
{ "p": "<JSON-String der Nutzlast>", "sig": "<b64 Ed25519(privKey, UTF-8(p))>" }
```

Signiert wird der unveränderte String `p`; dadurch keine Kanonisierungsprobleme.

Nutzlast:

```json
{ "kind": "hello|offer|answer|ice|bye",
  "from": "<peerId>", "to": "<peerId>|*",
  "cid": "<eigene room_ws client_id>",
  "ts": 1763740000000, "nonce": "<b64 16 Byte>",
  "body": { } }
```

### Prüfregeln (Empfänger, in dieser Reihenfolge)

1. Entschlüsseln, sonst verwerfen.
2. `to` ist eigene peerId oder `*`, sonst verwerfen.
3. Signatur gegen den öffentlichen Schlüssel von `from` prüfen. Den Schlüssel kennt man
   aus `hello` (dort steckt er in `body.pub`, und `from` muss zu ihm passen).
4. `|now − ts| ≤ 120 s` und `nonce` nicht bereits gesehen, sonst verwerfen (Replay).
5. `cid` muss zum room_ws-Absender (`client_id` des Publish) passen.

### Ablauf

| Ereignis | Aktion |
|---|---|
| Eigener Beitritt (`members`) | `hello` an `*`: `{pub, sid, name, caps}`; `sid` zufällig je Seitenaufruf |
| `hello` von unbekanntem Peer | Peer anlegen; bestehende Mitglieder senden `offer` |
| `hello` mit bekannter peerId, neuer `sid` | alte Sitzung ist tot (Neuladen ohne `bye`): Link verwerfen, wie unbekannten Peer behandeln |
| Gleichzeitiger Beitritt | Perfect Negotiation; **polite = kleinere peerId** |
| `ice` | Kandidaten gebündelt: alle 80 ms ein Umschlag pro Peer, `body.c = [...]` |
| `member_leave(cid)` / `bye` | PeerConnection zu dieser cid schließen |
| `iceConnectionState = failed` | `restartIce()`, nach 3 Fehlschlägen Peer neu aufbauen |

**SDP-Bindung:** `offer`/`answer` tragen das vollständige SDP inklusive
`a=fingerprint`. Durch die Signatur ist der DTLS-Fingerprint an die Identität gebunden;
`setRemoteDescription` erst nach erfolgreicher Prüfung.

**Lokales Blockieren:** Ein blockierter peerId bekommt kein `offer`, seine Nachrichten
werden verworfen. Im Mesh reicht das, um ihn für sich selbst stumm zu schalten. Er wird
nicht aus dem Raum geworfen; das kann ohne Server niemand.

### Grenzen von room_ws

32 KB pro Nachricht (SDP für Audio ca. 3 bis 6 KB nach Verschlüsselung), 20 Publish/s
mit Burst 40 pro Client. Die ICE-Bündelung hält einen Beitritt mit 3 Peers bei unter
20 Nachrichten.

## 6. Medien

### Kontrollkanal

Pro Peer ein ausgehandelter DataChannel `ctl` (`negotiated: true, id: 0`, geordnet,
zuverlässig) für: Stumm-Status, „spricht gerade“, Namensänderung, RTT-Ping.
Nachrichten sind JSON-Objekte mit `type`; unbekannte Typen werden ignoriert. Umgesetzt ist
`{"type":"state","muted":true|false}`: beim Öffnen des Kanals und bei jedem Wechsel;
`muted` heißt Modus Stumm oder kein Mikrofon.
Er existiert von Anfang an, damit Dateitransfer (Abschnitt 10) ohne neues Signaling
weitere Kanäle öffnen kann.

### Opus

SDP-`fmtp` vor `setLocalDescription` setzen:
`stereo=0; sprop-stereo=0; useinbandfec=1; usedtx=1; maxaveragebitrate=32000`.
`ptime` bleibt 20 ms; 10 ms als Experiment im Debug-Panel.
Empfangsseitig `receiver.jitterBufferTarget = 0` wo unterstützt (Chromium).

### Aufnahmekette

```
getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false,
                        autoGainControl: true, channelCount: 1 } })
  → AudioWorklet: RNNoise (48 kHz, 480-Sample-Frames) → liefert Audio + VAD-Wahrscheinlichkeit
  → Gate (PTT / VAD / offen)
  → MediaStreamAudioDestinationNode → RTCRtpSender (ein Track für alle Peers)
```

- RNNoise per WASM (`@sapphi-red/web-noise-suppressor` oder `@jitsi/rnnoise-wasm`;
  Auswahl danach, welche Bibliothek die VAD-Wahrscheinlichkeit herausgibt).
- Rauschunterdrückung abschaltbar; dann Browser-`noiseSuppression: true`.
- **Wiedergabe über ein `<audio>`-Element pro Peer**, nicht über WebAudio:
  Chromiums Echounterdrückung erfasst sonst die Wiedergabe nicht als Referenz.
  Lautstärke pro Peer über `audio.volume`.

### Sprechmodi

| Modus | Verhalten |
|---|---|
| Push-to-Talk | Gate offen, solange Taste gedrückt; 150 ms Nachlauf nach Loslassen |
| Sprachaktivierung (UI: „Automatisch“) | Öffnen bei VAD > Schwelle (einstellbar, Standard 0,85); Schließen nach 400 ms unter Schwelle; 200 ms Vorlauf-Puffer, damit Silbenanfänge nicht abgeschnitten werden |
| Stumm | Gate zu |

Das Gate sitzt **im Worklet**: Die Kette läuft immer, Öffnen wirkt sofort. Bei
geschlossenem Gate gehen Nullsamples raus, DTX drückt die Bandbreite auf nahe null.
Das Gate kostet 200 ms Latenz nur im Moment des Einsetzens, wenn der Vorlauf-Puffer
abgespielt wird: Abwägung gegen abgeschnittene Anfänge, im Debug-Panel abschaltbar.

**PTT-Taste:** im Browser nur bei fokussiertem Tab (`keydown`/`keyup`, Standard: Leertaste
außerhalb von Eingabefeldern). Im Desktop-Client global (Abschnitt 8).

### Messwerte

Debug-Panel aus `getStats()`: RTT, Jitter, `jitterBufferDelay`, Paketverlust,
Kandidatentyp (host/srflx/relay) pro Peer. Ziel: unter 120 ms Mund-zu-Ohr bei
direkter Verbindung.

## 7. Bedienung

Gestaltung nach dem UI-Mock (6 Bildschirme, Fenster 400 × 780; im Browser dieselben
Bildschirme, höchstens 32 rem breit). Texte deutsch, duzen, keine Gedankenstriche.

### Deine Räume (Startbildschirm)

- Liste der betretenen Räume, neueste zuerst. Gespeichert lokal (`localStorage`
  `plaudr.rooms`): Raumgeheimnis, eigener Name (optional), erster und letzter Beitritt,
  Namen der zuletzt gesehenen Teilnehmer. Der Server sieht nie einen Raumnamen.
- Anzeige: eigener Name, sonst „Raum vom <Tag>“ (Tag des ersten Beitritts, z. B.
  „Raum vom 3. November“, mit Jahr, wenn nicht im laufenden). Darunter letzter Beitritt
  („heute“, „gestern“, sonst Datum) und die zuletzt gesehenen Namen.
- Je Eintrag: Beitreten, Umbenennen (Name leer = kein Name), Aus der Liste entfernen.
- Unten: „Neuen Raum erstellen“ und ein Feld „Einladungslink einfügen“ mit „Öffnen“
  (nimmt den ganzen Link oder nur das Geheimnis).
- **Auto-Beitritt:** Beim ersten Laden einer Browsersitzung betritt plaudr den zuletzt
  genutzten Raum sofort, wenn das in den Einstellungen an ist (Standard: an). Nach
  „Verlassen“ oder Neuladen nicht erneut.

### Erster Start

Name und Schlüsselsicherung (Abschnitt 4) erscheinen nur, solange etwas fehlt: kein
Name gespeichert, Sicherung ausstehend oder plaudr schon in einem anderen Tab offen.
Sonst führt Beitreten direkt ins Gespräch.

### Gespräch

- Kopfzeile: „‹“ (verlässt das Gespräch, zurück zu den Räumen), Raumname mit Stift
  zum Umbenennen, Knopf „Link kopieren“ nur als Icon (Tooltip), Einstellungen.
- Teilnehmerkarten: Initiale, Name, Zustand („verbindet …“, „verbunden“,
  „stumm geschaltet“, „spricht“), Lautstärkeregler; grüner Rahmen beim Sprechen.
- Unten: Modus-Umschalter **Automatisch · Push-to-Talk · Stumm**. Bei Automatisch ein
  Pegelbalken (eigene Sprachwahrscheinlichkeit) mit Strich an der Schwelle und
  „Schwelle 85 %“; bei Push-to-Talk ein großer Knopf: halten sendet bis zum Loslassen, kurz antippen (unter 300 ms) rastet ein bis zum nächsten Antippen (fürs Telefon); Moduswechsel, Leertaste loslassen oder Tab im Hintergrund lösen immer. Der Hinweis auf die Leertaste erscheint nur mit Maus und Tastatur; langes Drücken öffnet weder Textauswahl noch Kontextmenü.
  Dazu Rauschunterdrückung und „Verlassen“.
- Kann der Browser ohne Nutzergeste kein Audio starten (Auto-Beitritt, geöffneter
  Link), erscheint „Ton aktivieren“; der Klick startet Wiedergabe und Aufnahme.

### Einstellungen

Erreichbar aus den Räumen und aus dem Gespräch (das Gespräch läuft weiter).
- **Push-to-Talk:** im Browser Leertaste bei fokussiertem Fenster (Hinweis); im
  Desktop-Client globale Taste aufnehmen, ohne Vorgabe (Abschnitt 8).
- **Mikrofon:** Eingabegerät (wird gemerkt, fehlt es, gilt das Standardgerät),
  Schwelle für „Automatisch“ in Prozent (50 bis 99 %) mit Live-Pegel, Rauschunterdrückung.
- **Darstellung:** System, Hell oder Dunkel; Farbton 0 bis 359°. Nur der Farbton ist
  frei, Sättigung und Helligkeit wählt plaudr so, dass Kontrast ≥ 4,5 : 1 bleibt.
  „Standardfarbe (Grün)“ setzt zurück. Gilt je Gerät.
- **Identität:** Name (änderbar), 4 Wörter zum Vergleichen am Telefon (Abschnitt 4),
  Schlüssel sichern, Sicherung laden. Im Gespräch zusätzlich „Im Raum“: Name und 4 Wörter
  jedes anderen Teilnehmers (auch als Tooltip am Namen seiner Karte). Eine im Gespräch
  geladene Sicherung gilt erst ab dem nächsten Beitritt; bis dahin stehen die Wörter des
  Schlüssels, mit dem das Gespräch signiert.
- **Start:** zuletzt genutzten Raum automatisch betreten; im Desktop-Client zusätzlich
  „Beim Anmelden starten (im Tray)“.

### Tray-Menü (Desktop)

Raum und Modus als Kopf, Stumm, Automatisch, Fenster zeigen, Verlassen, Beenden.

## 8. Desktop-Client (Tauri 2.x)

Entscheidung für Tauri 2 nach Spike gegen Wails v3 (`docs/spike-desktop.md`):
etwa ein Drittel der Größe (ca. 1,5 MB Download), ausgereifte Plugins für globale
Tasten, Deep-Links und Updates; Mikrofon im macOS-WebView ohne Zusatzabfrage.
Tauri 3 ist zum Stand der Spec Alpha; Umstieg erst nach dem stabilen Release.

- Bündelt den Build aus `web/` und lädt nie die Live-Seite: Der Code der App kann
  dann nicht serverseitig ausgetauscht werden.
- Release-Profil auf Größe optimiert (`opt-level = "s"`, `lto`, `codegen-units = 1`,
  `panic = "abort"`, `strip`): 3,2 MB statt 10 MB.
- Zusätze gegenüber dem Browser:
  - globale PTT-Taste über `tauri-plugin-global-shortcut` (Pressed/Released-Ereignisse),
    frei belegbar
  - Tray-Icon mit Stumm/PTT-Status, Fenster schließen = in den Tray
  - Link-Übernahme: `plaudr://`-Deep-Link (`tauri-plugin-deep-link`) und Einfügen eines
    `https://plaudr.room.ws/#…`-Links
  - optional Autostart
  - Sicherungsdatei über den nativen Speichern- und Öffnen-Dialog statt Browser-Download
- Origin: macOS `tauri://localhost`, Windows `http://tauri.localhost`. Beide sind ohne
  Änderung an der VM erlaubt: room_ws trägt `localhost` fest in die Freigabeliste ein
  (`newHub`, per Admin-Befehl nicht entfernbar), und `isAllowed` akzeptiert neben dem
  Hostnamen selbst jede Unterdomäne (Endung `.localhost`). Das gilt auch für `/turn` (CORS).
- macOS: `NSMicrophoneUsageDescription` in `src-tauri/Info.plist`; signiert mit
  Developer-ID-Zertifikat und notarisiert (Apple-Developer-Konto vorhanden).
  DMG-Bundling scheitert auf macOS 27 (`hdiutil create` veraltet): in CI auf einem
  älteren macOS-Runner bauen oder vorerst `.app` als ZIP ausliefern.
- Updates über `tauri-plugin-updater` mit signierten Paketen.
- Vor M4 ein Prototyp: Mikrofon unter Windows (WebView2), globale PTT-Taste mit
  Loslassen auf beiden Plattformen, notarisierte macOS-Build.

## 9. Web-Auslieferung

- Statisch über GitHub Pages unter `plaudr.room.ws` (eigenes Repo bzw. Pages-Workflow,
  `CNAME`). Bewusst **nicht** auf der Oracle-VM: Wer die Seite ausliefert, kann die
  Verschlüsselung aushebeln; Signaling und Auslieferung bleiben getrennt.
- CSP als `<meta>`:
  `default-src 'self'; connect-src 'self' wss://live.room.ws https://live.room.ws;
  script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; media-src 'self' blob:`
- Installierbar als PWA (Manifest, Service Worker), auch gegen Safaris Speicherlöschung.

## 10. Phase 2: Dateitransfer

Direkt nach dem MVP. Nur zwischen gerade verbundenen Teilnehmern, über WebRTC.

- Angebot über `ctl`: `{type: "file-offer", id, name, size, mime}` an einen oder mehrere
  Peers; Empfänger bestätigt oder lehnt ab.
- Pro Transfer und Peer ein eigener DataChannel `file:<id>` (geordnet, zuverlässig),
  Blöcke zu 64 KB, Gegendruck über `bufferedAmountLowThreshold`.
- Prüfsumme SHA-256 am Ende (inkrementell, da WebCrypto nicht streamt: per WASM-Hash).
- Empfang: Desktop schreibt direkt in den Download-Ordner; Browser per File System Access
  API (Chromium) als Stream, sonst Blob im Speicher mit Warnung ab 500 MB.
- Fortschritt, Abbruch beidseitig; kein Fortsetzen nach Verbindungsabbruch im ersten Schritt.
- Verschlüsselung: DTLS des DataChannels, an die Identität gebunden wie bei Audio.

## 11. Meilensteine

| # | Inhalt | Fertig, wenn |
|---|---|---|
| M1 | Gerüst, room_ws-Anbindung, Mesh mit Klartext-Signaling | 3 Browser-Tabs hören sich gegenseitig |
| M2 | Raumlink, HKDF, Umschläge, Ed25519, SDP-Bindung | manipulierter Fingerprint wird abgewiesen (Test) |
| M3 | Audiokette, RNNoise, PTT, VAD, Opus-Tuning, Debug-Panel | Latenz und VAD im Zweiergespräch geprüft |
| M3b | Bedienung nach Mock (Abschnitt 7) | alle Bildschirme im Browser bedienbar, E2E grün |
| M4 | Tauri Windows + macOS, globale PTT-Taste, Tray | Installer für beide Plattformen |
| M5 | GitHub Pages, CSP, PWA | `plaudr.room.ws` live |
| P2 | Dateitransfer | Datei > 1 GB zwischen Browser und Desktop übertragen |

## 12. Tests

- **Vitest:** HKDF-Ableitungen (feste Testvektoren), Umschlag ver-/entschlüsseln,
  Signaturprüfung, Replay- und Zuordnungsregeln, SDP-fmtp-Anpassung, VAD-Gate-Zustände.
- **Playwright:** 3 Chromium-Instanzen mit `--use-fake-device-for-media-stream`
  gegen ein lokales room_ws (`go run`), prüft Verbindungsaufbau, Abbau bei
  `member_leave` und Abweisung eines gefälschten Offers.

## 13. Offene Punkte

- **Windows-Code-Signing:** ohne Zertifikat SmartScreen-Warnung; für den kleinen Kreis
  vorerst hingenommen.
