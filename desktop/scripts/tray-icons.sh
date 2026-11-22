#!/bin/sh
# Erzeugt die Tray-Symbole aus dem „p“ mit Pegelbalken (assets/icon/icon.svg) nach src-tauri/icons/.
# macOS: Ruhe als Template-Icon (schwarz auf transparent, das System färbt es ein), Senden grün.
# Windows: Ruhe neutral grau, Senden grün. Braucht rsvg-convert (Homebrew: librsvg).
# Senden-Grün #2e8b3e statt des Akzents #0f5c1a: Es braucht auf heller wie dunkler Leiste mindestens 3:1
# (≈ 4,3:1 auf Weiß, ≈ 3,9:1 auf #1e1e1e); #0f5c1a verschwindet auf dunkler Leiste fast (≈ 2:1).
set -eu
SENDING='#2e8b3e'
out="$(cd "$(dirname "$0")/../src-tauri/icons" && pwd)"

glyph() { # $1 = Farbe
  cat <<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="202 188 648 648">
<g fill="none" stroke="$1" stroke-linecap="round">
<circle cx="526" cy="432" r="180" stroke-width="88"/>
<path d="M346 432v340" stroke-width="88"/>
<path d="M466 405v54M526 365v134M586 405v54" stroke-width="44"/>
</g>
</svg>
SVG
}

png() { # $1 = Farbe, $2 = Größe, $3 = Datei
  glyph "$1" | rsvg-convert -w "$2" -h "$2" -o "$out/$3"
}

# macOS zeichnet das Symbol 18 pt hoch und skaliert selbst; 64 px reichen auch für Retina.
png '#000000' 64 'tray-mac@2x.png'
png "$SENDING" 64 'tray-mac-sending@2x.png'
png '#8a8a85' 32 'tray-win.png'
png "$SENDING" 32 'tray-win-sending.png'
echo "Tray-Symbole in $out"
