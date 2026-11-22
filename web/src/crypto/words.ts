import { fromBase64url } from '../util/base64url';

/**
 * 256 deutsche Substantive zum Vorlesen am Telefon (Spec §4). Kleingeschrieben, ohne Umlaute und ß, 3 bis 7
 * Buchstaben, kein Wort ist Anfang eines anderen. Die Reihenfolge ist Teil des Protokolls: Wer sie ändert,
 * macht alle bisherigen Vergleiche ungültig.
 */
export const WORDS: readonly string[] = [
  'apfel', 'birne', 'tisch', 'stuhl', 'lampe', 'hund', 'katze', 'maus',
  'vogel', 'fisch', 'pferd', 'kuh', 'schaf', 'ziege', 'hase', 'igel',
  'fuchs', 'wolf', 'esel', 'ente', 'gans', 'huhn', 'hahn', 'adler',
  'eule', 'storch', 'taube', 'rabe', 'biene', 'ameise', 'fliege', 'spinne',
  'wespe', 'frosch', 'krebs', 'hummer', 'robbe', 'delfin', 'hai', 'tiger',
  'loewe', 'affe', 'zebra', 'panda', 'koala', 'otter', 'reh', 'hirsch',
  'elch', 'kamel', 'brot', 'butter', 'kaese', 'milch', 'honig', 'zucker',
  'salz', 'pfeffer', 'suppe', 'nudel', 'reis', 'kuchen', 'torte', 'keks',
  'nuss', 'mandel', 'kirsche', 'pflaume', 'traube', 'zitrone', 'orange', 'banane',
  'melone', 'tomate', 'gurke', 'karotte', 'zwiebel', 'kohl', 'salat', 'erbse',
  'bohne', 'pilz', 'haus', 'tuer', 'fenster', 'dach', 'wand', 'boden',
  'treppe', 'keller', 'garten', 'zaun', 'brunnen', 'bruecke', 'turm', 'schloss',
  'kirche', 'markt', 'strasse', 'weg', 'platz', 'bahnhof', 'hafen', 'insel',
  'berg', 'tal', 'huegel', 'fluss', 'bach', 'see', 'meer', 'strand',
  'wiese', 'wald', 'baum', 'blume', 'rose', 'tulpe', 'ast', 'blatt',
  'gras', 'moos', 'stein', 'sand', 'erde', 'wolke', 'regen', 'schnee',
  'nebel', 'sturm', 'blitz', 'sonne', 'mond', 'stern', 'himmel', 'auto',
  'bus', 'zug', 'schiff', 'boot', 'ruder', 'anker', 'segel', 'rad',
  'roller', 'motor', 'reifen', 'ticket', 'koffer', 'tasche', 'schirm', 'hut',
  'muetze', 'schuh', 'socke', 'hemd', 'hose', 'jacke', 'mantel', 'schal',
  'guertel', 'knopf', 'nadel', 'faden', 'buch', 'heft', 'stift', 'papier',
  'brief', 'karte', 'bild', 'foto', 'uhr', 'glocke', 'kerze', 'spiegel',
  'kissen', 'decke', 'bett', 'sofa', 'schrank', 'regal', 'teppich', 'vorhang',
  'messer', 'gabel', 'loeffel', 'teller', 'tasse', 'glas', 'flasche', 'topf',
  'pfanne', 'kanne', 'eimer', 'besen', 'seife', 'buerste', 'kamm', 'hammer',
  'zange', 'saege', 'bohrer', 'nagel', 'leiter', 'seil', 'kette', 'geige',
  'floete', 'trommel', 'harfe', 'klavier', 'gitarre', 'tuba', 'puppe', 'spiel',
  'wuerfel', 'drache', 'ballon', 'bank', 'kran', 'zelt', 'fahne', 'flagge',
  'krone', 'ring', 'perle', 'gold', 'silber', 'eisen', 'feuer', 'asche',
  'rauch', 'welle', 'sumpf', 'pfad', 'tunnel', 'fabrik', 'laden', 'kiosk',
  'bauer', 'koch', 'pilot', 'maler', 'arzt', 'pirat', 'ritter', 'koenig',
  'clown', 'wiege', 'nest', 'sessel', 'hocker', 'tafel', 'kreide', 'lupe',];

/** Vier Wörter aus den ersten vier Bytes von SHA-256(Schlüssel roh), derselben Hashbasis wie die peerId. */
export async function fingerprintWords(pub: string): Promise<string[]> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', fromBase64url(pub)));
  return [0, 1, 2, 3].map((i) => WORDS[h[i]]);
}
