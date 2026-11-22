# Handprobe M3: Zweiergespräch mit echten Mikrofonen

Abnahme laut Spec §10: „Latenz und VAD im Zweiergespräch geprüft“. Die automatischen Tests nutzen
synthetische Sprache als Fake-Mikrofon; Echo, echte Geräusche und gefühlte Latenz prüft nur ein Mensch.

## Vorbereitung

- Zwei Geräte (oder zwei Browser auf zwei Rechnern), beide Chromium-basiert, beide mit Mikrofon.
- `cd web && npm run dev -- --host`, auf dem zweiten Gerät die angezeigte Netzwerkadresse öffnen.
  Hinweis: `getUserMedia` verlangt HTTPS oder `localhost`. Für das zweite Gerät entweder einen Tunnel
  mit HTTPS nehmen oder in Chromium `chrome://flags/#unsafely-treat-insecure-origin-as-secure` für die
  Adresse setzen.
- Raum auf Gerät 1 erstellen, Link auf Gerät 2 öffnen, beide treten bei.

## Prüfpunkte

| # | Prüfung | Erwartung | Ergebnis |
|---|---|---|---|
| 1 | Debug-Panel öffnen, Zeile des Gegenübers | Weg `host` (gleiches Netz) oder `srflx`; RTT plausibel | |
| 2 | „Mund-zu-Ohr (Schätzung)“ bei direkter Verbindung | unter 120 ms | |
| 3 | Gefühlte Latenz: abwechselnd zählen („eins“, „zwei“ …) | flüssig, kein Ins-Wort-Fallen | |
| 4 | Sprachaktivierung, normal sprechen | Anfang der ersten Silbe ist hörbar (Vorlauf) | |
| 5 | Sprachaktivierung, Tastatur tippen, nicht sprechen | Gate bleibt zu („du sprichst“ erscheint nicht) | |
| 6 | Schwelle auf 0,5 und auf 0,95 stellen | 0,5 öffnet leichter, 0,95 schneidet leise Stimmen ab | |
| 7 | Vorlauf im Debug-Panel aus | Silbenanfänge werden hörbar abgeschnitten | |
| 8 | Push-to-Talk: Leertaste kurz drücken und loslassen | Satzende nicht abgeschnitten (150 ms Nachlauf) | |
| 9 | Push-to-Talk: Leertaste halten, in anderes Fenster wechseln | Gate schließt, kein Dauersenden | |
| 10 | Lautsprecher statt Kopfhörer auf beiden Seiten | kein hörbares Echo | |
| 11 | Ventilator oder Lüfter laufen lassen, Rauschunterdrückung an und aus | an: Rauschen deutlich leiser, Stimme klar | |
| 12 | Lautstärkeregler des Gegenübers | wirkt sofort, bleibt nach Neuladen | |
| 13 | Stumm | Gegenüber hört nichts, Punkt in der Liste bleibt grau | |

Ergebnis und Auffälligkeiten hier oder in STATUS.md festhalten.
