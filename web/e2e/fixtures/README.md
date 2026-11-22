# Testdaten

`speech.wav`: synthetische Sprache mit Pausen von 1,5 s, 48 kHz mono 16 Bit, etwa 11 s. Dient Chromium als
Fake-Mikrofon (`--use-file-for-fake-audio-capture`) und den Unit-Tests von RNNoise als Sprachprobe.
Erzeugt unter macOS:

```sh
say -v Anna -o s.aiff "Hallo, hier spricht plaudr. [[slnc 1500]] Wir prüfen die Sprachaktivierung. [[slnc 1500]] Eins, zwei, drei, vier. [[slnc 1500]]"
afconvert -f WAVE -d LEI16@48000 -c 1 s.aiff speech.wav
```
