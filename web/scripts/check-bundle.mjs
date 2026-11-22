// Prüft nach dem Build, dass das Web-Bündel (Einstiegs-JS) keinen Tauri-Code enthält.
// Die Erkennung in isDesktop liest nur den Namen __TAURI_INTERNALS__ und ist erlaubt;
// verboten sind Aufrufe (invoke(, plugin:) und Importe aus @tauri-apps.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath statt .pathname: unter Windows ergäbe .pathname „/D:/…“ und damit kaputte Pfade.
const dist = fileURLToPath(new URL('../dist', import.meta.url));
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const entries = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1].replace(/^\.?\//, ''));
if (entries.length === 0) {
  console.error('check-bundle: kein Einstiegs-Skript in dist/index.html gefunden');
  process.exit(1);
}
// Einstieg plus alles, was statisch daran hängt; dynamisch geladene Chunks (desktop) sind ausgenommen.
const STATIC_IMPORT = /(?:^|[;}\s])(?:import|export)\s*(?:[^"'()]*?\bfrom\s*)?["']([^"']+\.js)["']/g;
const seen = new Set();
const queue = [...entries];
while (queue.length) {
  const rel = queue.shift();
  if (seen.has(rel)) continue;
  seen.add(rel);
  const code = readFileSync(join(dist, rel), 'utf8');
  for (const m of code.matchAll(STATIC_IMPORT)) {
    if (m[1].startsWith('.')) queue.push(join(rel, '..', m[1]));
  }
}
const FORBIDDEN = [/\binvoke\s*\(/, /plugin:/, /@tauri-apps/];
let bad = 0;
for (const rel of seen) {
  const code = readFileSync(join(dist, rel), 'utf8');
  for (const re of FORBIDDEN) {
    if (re.test(code)) {
      console.error(`check-bundle: ${rel} enthält ${re}`);
      bad++;
    }
  }
}
if (bad) process.exit(1);
console.log(`check-bundle: ok (geprüft: ${[...seen].join(', ')}; Chunks gesamt: ${readdirSync(join(dist, 'assets')).length})`);
