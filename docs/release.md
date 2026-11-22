# Release der Desktop-App

Die Desktop-App baut der Workflow `.github/workflows/desktop.yml` („Desktop“) auf GitHub Actions: macOS auf
`macos-15` als Universal-Bündel (Apple Silicon und Intel), Windows auf `windows-latest` als NSIS-Installer.
Er läuft nie bei einem gewöhnlichen Push auf `main`, sondern nur in zwei Fällen:

- **Release-Tag `desktop-v<Version>`**, etwa `desktop-v0.1.0`. Die Version im Tag muss zu `version` in
  `desktop/src-tauri/tauri.conf.json` passen, sonst bricht der Lauf ab. Ergebnis ist ein Release-Entwurf
  „plaudr <Version>“ mit `plaudr_<Version>_universal.dmg`, `plaudr_<Version>_universal.app.tar.gz`,
  `plaudr_<Version>_x64-setup.exe`, den Update-Signaturen `plaudr_<Version>_universal.app.tar.gz.sig` und
  `plaudr_<Version>_x64-setup.exe.sig` sowie `latest.json` (siehe [Updates](#updates)). Den Entwurf prüfst
  du und veröffentlichst ihn von Hand; erst dann bekommen die installierten Apps das Update.
- **Von Hand** unter Actions › Desktop › „Run workflow“ (oder `gh workflow run desktop.yml`). Dann wird nur
  gebaut, die Bündel liegen als Workflow-Artefakte am Lauf (`gh run download <Lauf-ID>`).

## Ablauf eines Releases

1. Version in `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml` und
   `desktop/package.json` anheben, committen.
2. `git tag desktop-v0.2.0 && git push origin desktop-v0.2.0`
3. Warten, bis beide Jobs grün sind; Größen stehen in der Zusammenfassung des Laufs.
4. Release-Entwurf öffnen, Handprobe „Release-Build aus CI“ in `docs/m4-handprobe.md` an den Dateien aus
   dem Entwurf machen, dann veröffentlichen (nicht als Pre-Release, siehe [Updates](#updates)).

## Größenprüfung

Der Schritt „Größenprüfung“ schlägt fehl, sobald eine Datei über 5 MB (5 000 000 Bytes) liegt. Geprüft
werden unter macOS das `.app` je Architektur (das Universal-Bündel enthält die Binärdatei doppelt und ist
deshalb etwa 7,6 MiB groß; maßgeblich ist, was ohne die jeweils andere Hälfte übrig bleibt), das DMG und,
mit Update-Artefakten, `.app.tar.gz` und `.sig`, unter Windows `plaudr.exe`, der Installer und seine `.sig`.
Die Zusammenfassung des Laufs zeigt alle Werte, dazu das Universal-Bündel und die Entitlements der Signatur.

Gemessen lokal mit Version 0.1.0 (Rust 1.98.1, mit Updater, `opt-level = "z"`, ad-hoc signiert):

| Datei | Größe |
|---|---|
| `plaudr.app`, universal | 7 965 285 Bytes |
| `plaudr.app`, nur x86_64 | 4 511 141 Bytes |
| `plaudr.app`, nur arm64 | 3 574 373 Bytes |
| `plaudr.app.tar.gz`, universal (Update-Artefakt) | 4 235 916 Bytes |
| `plaudr.exe` (cargo-xwin, vor dem Updater) | 3 132 928 Bytes |
| `plaudr_<Version>_universal.dmg` (CI) | noch offen, nach dem ersten Lauf eintragen |
| `plaudr_<Version>_x64-setup.exe` (CI) | noch offen, nach dem ersten Lauf eintragen |

## Updates

Die App fragt beim Start und danach alle 6 Stunden
`https://github.com/coreequip/plaudr/releases/latest/download/latest.json` ab, aber nie während eines
Gesprächs. Gibt es eine neuere Version, steht auf dem Startbildschirm „Neue Version <v> verfügbar.“ mit dem
Knopf „Jetzt aktualisieren“. Der lädt das Update, prüft seine Signatur gegen den öffentlichen Schlüssel in
`desktop/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`), installiert es und startet plaudr neu. Unter
Windows beendet der Installer die App dabei selbst. Fehler beim Prüfen (offline, kein Release) zeigt die
App nicht an, sie landen nur als Warnung in der Konsole.

**Ein Update erreicht die Apps erst, wenn der Release veröffentlicht ist.** `releases/latest` übergeht
Entwürfe und Pre-Releases. Solange der Entwurf aus dem Tag-Lauf nicht veröffentlicht ist, sieht keine App
etwas; ein als Pre-Release veröffentlichter Release wird nie ausgeliefert. Wer ein Update zurückhalten will,
lässt den Entwurf einfach liegen.

### Signaturschlüssel

Updates sind mit einem eigenen minisign-Schlüssel signiert, unabhängig von Apples Developer-ID. Eine App
nimmt nur Updates an, die mit dem privaten Schlüssel zum eingebauten öffentlichen Schlüssel signiert sind.

- **Den privaten Schlüssel und sein Passwort sicher aufbewahren und sichern.** Wer sie verliert, kann für
  die installierten Apps kein Update mehr signieren: Die Nutzer müssen dann von Hand eine neue Version mit
  einem neuen öffentlichen Schlüssel installieren. Der Schlüssel des Maintainers liegt nur bei ihm und als
  Repository-Secret, nie im Repository.
- **Neuen Schlüssel anlegen** (etwa für einen Fork mit eigenen Releases):
  `npx tauri signer generate -w <Pfad zur Schlüsseldatei>` im Verzeichnis `desktop/`, das Passwort im
  Terminal eingeben. Den Inhalt der erzeugten `.pub`-Datei als `plugins.updater.pubkey` in
  `desktop/src-tauri/tauri.conf.json` eintragen und `endpoints` auf das eigene Repository umstellen.
- **Secrets für den Workflow:** `TAURI_SIGNING_PRIVATE_KEY` (Inhalt der privaten Schlüsseldatei) und
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, etwa mit `gh secret set TAURI_SIGNING_PRIVATE_KEY < <Pfad zur
  Schlüsseldatei>` und `gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (fragt den Wert ab). Bei einem
  Tag bricht der Lauf ohne den Schlüssel ab, sonst käme ein Release ohne `latest.json` heraus. Von Hand
  gestartet baut er ohne Schlüssel weiter, dann nur ohne Update-Artefakte (Warnung „Ohne Updates“).

### Update-Artefakte lokal

Ein gewöhnliches `cd desktop && npm run build` braucht keinen Schlüssel und erzeugt keine
Update-Artefakte. Die schaltet erst `desktop/src-tauri/tauri.release.conf.json` ein
(`bundle.createUpdaterArtifacts`), die der Workflow mit `--config` dazunimmt. Lokal genauso, mit dem
Schlüssel in der Umgebung (`TAURI_SIGNING_PRIVATE_KEY` darf der Inhalt oder der Pfad der Schlüsseldatei
sein):

```sh
cd desktop
export TAURI_SIGNING_PRIVATE_KEY=<Pfad zur Schlüsseldatei>
read -rs TAURI_SIGNING_PRIVATE_KEY_PASSWORD && export TAURI_SIGNING_PRIVATE_KEY_PASSWORD   # Passwort, ohne Echo
npm run tauri -- build --bundles app --config src-tauri/tauri.release.conf.json
```

Daneben liegen dann `plaudr.app.tar.gz` und `plaudr.app.tar.gz.sig` unter
`src-tauri/target/release/bundle/macos/`.

## macOS: Signatur und Notarisierung

Sind alle sechs Secrets gesetzt, signiert der Job mit deinem Developer-ID-Zertifikat, aktiviert die
Hardened Runtime und lässt Apple das Bündel notarisieren (das dauert ein paar Minuten). Fehlt auch nur eins,
baut er ad-hoc-signiert und schreibt die Warnung „Nicht signiert“ mit den fehlenden Namen ins Job-Log.

Die Entitlements stehen in `desktop/src-tauri/Entitlements.plist`. Wichtig ist
`com.apple.security.device.audio-input`: Mit Hardened Runtime bleibt das Mikrofon ohne diese Berechtigung
stumm, obwohl macOS die Freigabe anzeigt.

### Secrets anlegen

Unter Settings › Secrets and variables › Actions › „New repository secret“ im Repository, oder mit
`gh secret set NAME` (fragt den Wert ab, er landet nicht in der Shell-History):

| Secret | Inhalt |
|---|---|
| `APPLE_CERTIFICATE` | Developer-ID-Application-Zertifikat samt privatem Schlüssel als `.p12`, base64-kodiert |
| `APPLE_CERTIFICATE_PASSWORD` | Passwort, das du beim Export der `.p12` vergeben hast |
| `APPLE_SIGNING_IDENTITY` | Name des Zertifikats, etwa `Developer ID Application: Vorname Nachname (TEAMID1234)` |
| `APPLE_ID` | E-Mail-Adresse deines Apple-Developer-Kontos |
| `APPLE_PASSWORD` | App-spezifisches Passwort für die Notarisierung (nicht das Kontopasswort) |
| `APPLE_TEAM_ID` | zehnstellige Team-ID |

So kommst du an die Werte:

1. **Zertifikat:** In Xcode › Settings › Accounts › Manage Certificates ein „Developer ID Application“
   anlegen, oder auf <https://developer.apple.com/account/resources/certificates> mit einer
   Zertifikatsanfrage aus der Schlüsselbundverwaltung. Danach steht es im Schlüsselbund „Anmeldung“.
2. **Export als .p12:** In der Schlüsselbundverwaltung unter „Meine Zertifikate“ das Zertifikat aufklappen,
   Zertifikat und privaten Schlüssel zusammen markieren, „2 Objekte exportieren“, Format „Privater
   Informationsaustausch (.p12)“, ein Passwort vergeben (das wird `APPLE_CERTIFICATE_PASSWORD`).
3. **base64 und hochladen**, ohne dass der Inhalt im Terminal erscheint:
   `base64 -i plaudr-developer-id.p12 | gh secret set APPLE_CERTIFICATE`. Die `.p12` danach löschen.
4. **Signaturname:** `security find-identity -v -p codesigning` zeigt ihn in Anführungszeichen; die Team-ID
   steht in Klammern am Ende und unter <https://developer.apple.com/account> › Membership details.
5. **App-spezifisches Passwort:** Auf <https://account.apple.com> › Anmelden und Sicherheit ›
   App-spezifische Passwörter ein neues anlegen, etwa „plaudr notarize“.

### Ad-hoc-signiertes Build starten

Ohne Secrets ist das Bündel nur ad-hoc signiert und nicht notarisiert. Gatekeeper meldet dann, die App sei
beschädigt oder stamme von einem nicht verifizierten Entwickler. Nach dem Kopieren nach „Programme“ hilft:

```sh
xattr -dr com.apple.quarantine /Applications/plaudr.app
```

Danach startet die App normal. Nach jedem neuen ad-hoc-Build kann macOS erneut nach dem Mikrofon fragen.

## Windows: unsigniert

Ein Code-Signing-Zertifikat für Windows gibt es nicht (Spec §13). Beim ersten Start des Installers zeigt
SmartScreen „Der Computer wurde durch Windows geschützt“; über „Weitere Informationen“ › „Trotzdem
ausführen“ geht es weiter. Für den kleinen Kreis ist das hingenommen. Der Installer richtet die App für den
angemeldeten Benutzer ein (ohne Adminrechte) und lädt die WebView2-Runtime nach, falls sie fehlt
(`downloadBootstrapper`; ab Windows 11 ist sie vorinstalliert).
