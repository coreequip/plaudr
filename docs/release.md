# Release der Desktop-App

Die Desktop-App baut der Workflow `.github/workflows/desktop.yml` („Desktop“) auf GitHub Actions: macOS auf
`macos-15` als Universal-Bündel (Apple Silicon und Intel), Windows auf `windows-latest` als NSIS-Installer.
Er läuft nie bei einem gewöhnlichen Push auf `main`, sondern nur in zwei Fällen:

- **Release-Tag `desktop-v<Version>`**, etwa `desktop-v0.1.0`. Die Version im Tag muss zu `version` in
  `desktop/src-tauri/tauri.conf.json` passen, sonst bricht der Lauf ab. Ergebnis ist ein Release-Entwurf
  „plaudr <Version>“ mit `plaudr_<Version>_universal.dmg`, `plaudr_<Version>_universal.app.tar.gz` und
  `plaudr_<Version>_x64-setup.exe`. Den Entwurf prüfst du und veröffentlichst ihn von Hand.
- **Von Hand** unter Actions › Desktop › „Run workflow“ (oder `gh workflow run desktop.yml`). Dann wird nur
  gebaut, die Bündel liegen als Workflow-Artefakte am Lauf (`gh run download <Lauf-ID>`).

## Ablauf eines Releases

1. Version in `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml` und
   `desktop/package.json` anheben, committen.
2. `git tag desktop-v0.2.0 && git push origin desktop-v0.2.0`
3. Warten, bis beide Jobs grün sind; Größen stehen in der Zusammenfassung des Laufs.
4. Release-Entwurf öffnen, Handprobe „Release-Build aus CI“ in `docs/m4-handprobe.md` an den Dateien aus
   dem Entwurf machen, dann veröffentlichen.

## Größenprüfung

Der Schritt „Größenprüfung“ schlägt fehl, sobald eine Datei über 5 MB (5 000 000 Bytes) liegt. Geprüft
werden unter macOS das `.app` je Architektur (das Universal-Bündel enthält die Binärdatei doppelt und ist
deshalb etwa 8,4 MiB groß; maßgeblich ist, was ohne die jeweils andere Hälfte übrig bleibt) und das DMG,
unter Windows `plaudr.exe` und der Installer. Die Zusammenfassung des Laufs zeigt alle Werte, dazu das
Universal-Bündel und die Entitlements der Signatur.

Gemessen lokal mit Version 0.1.0 (Rust 1.98.1):

| Datei | Größe |
|---|---|
| `plaudr.app`, universal | 8 815 941 Bytes |
| `plaudr.app`, nur x86_64 | 4 678 933 Bytes |
| `plaudr.app`, nur arm64 | 4 244 805 Bytes |
| `plaudr.app` universal als `.tar.gz` | 4 053 005 Bytes |
| `plaudr.exe` (cargo-xwin) | 3 132 928 Bytes |
| `plaudr_<Version>_universal.dmg` (CI) | noch offen, nach dem ersten Lauf eintragen |
| `plaudr_<Version>_x64-setup.exe` (CI) | noch offen, nach dem ersten Lauf eintragen |

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
