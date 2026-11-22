import { fromBase64url } from '../util/base64url';

/**
 * 256 deutsche Substantive zum Vorlesen am Telefon (Spec §4). Kleingeschrieben, ohne Umlaute und ß, 3 bis 7
 * Buchstaben, kein Wort ist Anfang eines anderen, keine Umschriften (ae, oe, ue). Je zwei Wörter unterscheiden
 * sich in mehr als einem Buchstaben, auch nach grober Lautangleichung (d/t, b/p, g/k, Dehnungs-h, Doppelbuchstaben),
 * damit „Hund“ und „Huhn“ am Telefon nicht verwechselt werden. Die Reihenfolge ist Teil des Protokolls: Wer sie
 * ändert, macht alle bisherigen Vergleiche ungültig.
 */
export const WORDS: readonly string[] = [
  'apfel', 'birne', 'tisch', 'stuhl', 'lampe', 'hund', 'katze', 'vogel',
  'pferd', 'schaf', 'ziege', 'hase', 'fuchs', 'wolf', 'esel', 'ente',
  'gans', 'adler', 'storch', 'taube', 'ameise', 'spinne', 'wespe', 'frosch',
  'krebs', 'hummer', 'robbe', 'delfin', 'tiger', 'zebra', 'panda', 'koala',
  'otter', 'hirsch', 'elch', 'kamel', 'pinguin', 'papagei', 'gorilla', 'giraffe',
  'dachs', 'biber', 'falke', 'spatz', 'kranich', 'qualle', 'muschel', 'krabbe',
  'forelle', 'hering', 'brot', 'butter', 'honig', 'zucker', 'pfeffer', 'suppe',
  'nudel', 'kuchen', 'torte', 'mandel', 'kirsche', 'pflaume', 'zitrone', 'orange',
  'banane', 'melone', 'tomate', 'gurke', 'karotte', 'zwiebel', 'salat', 'erbse',
  'bohne', 'pilz', 'brezel', 'waffel', 'joghurt', 'quark', 'kakao', 'wurst',
  'senf', 'essig', 'ananas', 'kiwi', 'feige', 'dattel', 'ingwer', 'paprika',
  'spinat', 'avocado', 'mango', 'kokos', 'fenster', 'boden', 'treppe', 'keller',
  'garten', 'zaun', 'brunnen', 'turm', 'schloss', 'markt', 'bahnhof', 'berg',
  'fluss', 'meer', 'strand', 'wiese', 'blume', 'tulpe', 'blatt', 'stein',
  'regen', 'schnee', 'blitz', 'himmel', 'asche', 'rauch', 'welle', 'sumpf',
  'tunnel', 'vulkan', 'kaktus', 'palme', 'tanne', 'linde', 'auto', 'anker',
  'roller', 'motor', 'reifen', 'koffer', 'schirm', 'fahrrad', 'rakete', 'kutsche',
  'traktor', 'bagger', 'zelt', 'schuh', 'socke', 'jacke', 'knopf', 'faden',
  'stiefel', 'kleid', 'brille', 'stift', 'papier', 'brief', 'uhr', 'glocke',
  'kerze', 'kissen', 'decke', 'sofa', 'schrank', 'regal', 'teppich', 'vorhang',
  'flasche', 'pfanne', 'eimer', 'zange', 'bohrer', 'nagel', 'leiter', 'trommel',
  'klavier', 'gitarre', 'drache', 'ballon', 'krone', 'perle', 'silber', 'kreide',
  'hocker', 'kompass', 'laterne', 'magnet', 'kugel', 'wecker', 'radio', 'kamera',
  'zirkus', 'orgel', 'posaune', 'pirat', 'ritter', 'clown', 'fabrik', 'kiosk',
  'schule', 'museum', 'theater', 'rathaus', 'schwan', 'pelikan', 'tukan', 'hamster',
  'kobra', 'pudding', 'bonbon', 'praline', 'lakritz', 'popcorn', 'toaster', 'sieb',
  'korken', 'anorak', 'pulli', 'stempel', 'schere', 'lineal', 'pinsel', 'farbe',
  'zettel', 'ordner', 'mappe', 'pokal', 'gondel', 'globus', 'atlas', 'leuchte',
  'tablett', 'nashorn', 'kapelle', 'scheune', 'orkan', 'oliven', 'vanille', 'nelke',
  'krokus', 'lilie', 'violine', 'cello', 'flagge', 'saturn', 'planet', 'komet',
  'eichel', 'zapfen', 'mammut', 'strumpf', 'banjo', 'pflug', 'elefant', 'rentier',
  'walross', 'domino', 'murmel', 'kreisel', 'rosine', 'muffin', 'fohlen', 'kuckuck',
];

/** Vier Wörter aus den ersten vier Bytes von SHA-256(Schlüssel roh), derselben Hashbasis wie die peerId. */
export async function fingerprintWords(pub: string): Promise<string[]> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', fromBase64url(pub)));
  return [0, 1, 2, 3].map((i) => WORDS[h[i]]);
}
