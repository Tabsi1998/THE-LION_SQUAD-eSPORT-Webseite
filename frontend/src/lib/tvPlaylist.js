// Wiedergabeliste des Turnierbaum-TVs (#1121): statt fest alle 11 Sekunden zu blättern, zeigt der TV nacheinander, was
// gerade wichtig ist - jede Folie so lang, wie sie braucht. Folien: Turnierbaum, Live-Spiele, Aufrufe, Sponsor und Zahlen.
// Sponsor und Zahlen kommen „zwischendurch“: Sie stehen in der Reihenfolge, kommen aber höchstens so oft, wie „Sponsoren
// am TV“ (#1125) und „Zahlen zwischendurch“ (#1124) es sagen - und als Moment über die Warteschlange (lib/tvMoments.js),
// also nie während eines Ergebnisses. Leere Folien (keine Aufrufe, kein laufendes Spiel) werden übersprungen. Ein Link
// mit nur einer Folie zeigt genau diese, ohne Wechsel und ohne Balken. Ein Link nur mit Sponsor und/oder Zahlen zeigt
// diese dauerhaft im Wechsel.

export const PLAYLIST_SLIDES = Object.freeze(["tree", "live", "calls", "sponsor", "stats"]);
export const MOMENT_SLIDES = Object.freeze(new Set(["sponsor", "stats"]));
export const PLAYLIST_SECONDS = Object.freeze({ min: 3, max: 120 });

export const DEFAULT_PLAYLIST = Object.freeze([
  Object.freeze({ slide: "tree", seconds: 12 }),
  Object.freeze({ slide: "live", seconds: 8 }),
  Object.freeze({ slide: "calls", seconds: 8 }),
  Object.freeze({ slide: "sponsor", seconds: 6 }),
  Object.freeze({ slide: "stats", seconds: 8 }),
]);

export const SLIDE_LABELS = Object.freeze({
  tree: "Turnierbaum",
  live: "Live-Spiele",
  calls: "Aufrufe",
  sponsor: "Sponsor",
  stats: "Zahlen",
});

// Im Link darf es auch deutsch stehen: „baum-12_aufrufe-8“.
const SLIDE_ALIASES = Object.freeze({ baum: "tree", turnierbaum: "tree", spiele: "live", aufrufe: "calls", aufruf: "calls", zahlen: "stats" });
const DEFAULT_SECONDS = Object.freeze(Object.fromEntries(DEFAULT_PLAYLIST.map((entry) => [entry.slide, entry.seconds])));

/** Eine Wiedergabeliste: eine bis fünf Folien, jede höchstens einmal, je 3 bis 120 Sekunden - wie am Server. */
export function validPlaylist(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > PLAYLIST_SLIDES.length) return false;
  const seen = new Set();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return false;
    const keys = Object.keys(entry);
    if (keys.length !== 2 || !keys.includes("slide") || !keys.includes("seconds")) return false;
    if (!PLAYLIST_SLIDES.includes(entry.slide) || seen.has(entry.slide)) return false;
    if (!Number.isInteger(entry.seconds) || entry.seconds < PLAYLIST_SECONDS.min || entry.seconds > PLAYLIST_SECONDS.max) return false;
    seen.add(entry.slide);
  }
  return true;
}

export function copyPlaylist(list) {
  return (list || []).map((entry) => ({ slide: entry.slide, seconds: entry.seconds }));
}

/**
 * Die Liste aus dem Link: „tree-12_live-8_calls-8“. Ohne Sekunden gilt der Standard der Folie („calls“ = Aufrufe 8 s).
 * Was nicht passt, zählt nicht (dann gilt der Grundwert).
 */
export function parsePlaylist(raw) {
  if (raw === null || raw === undefined) return undefined;
  const parts = String(raw).trim().toLowerCase().split(/[_,;\s]+/).filter(Boolean);
  if (!parts.length) return undefined;
  const list = [];
  for (const part of parts) {
    // Kein Doppelpunkt in eckigen Klammern: Tailwind liest so etwas als CSS-Klasse, und der Build bricht ab.
    const [name, secondsText] = part.split(/[-.]|:/);
    const slide = SLIDE_ALIASES[name] || name;
    if (!PLAYLIST_SLIDES.includes(slide)) return undefined;
    if (secondsText !== undefined && !/^\d+$/.test(secondsText)) return undefined;
    list.push({ slide, seconds: secondsText === undefined ? DEFAULT_SECONDS[slide] : Number(secondsText) });
  }
  return validPlaylist(list) ? list : undefined;
}

/** So steht die Liste im Link. */
export function serializePlaylist(list) {
  return (list || []).map((entry) => `${entry.slide}-${entry.seconds}`).join("_");
}

/** „Turnierbaum 12 s · Live-Spiele 8 s“ - für den Admin. */
export function playlistLabel(list) {
  return (list || []).map((entry) => `${SLIDE_LABELS[entry.slide] || entry.slide} ${entry.seconds} s`).join(" · ");
}

/** Ist eine Folie für „zwischendurch“ wieder dran? `lastAt` ist, wann sie zuletzt kam (Millisekunden). */
export function isDue(lastAt, everyMinutes, now = Date.now()) {
  if (lastAt === null || lastAt === undefined) return true;
  return now - lastAt >= Math.max(0, Number(everyMinutes) || 0) * 60000;
}

/**
 * Besteht die Liste nur aus Sponsor und/oder Zahlen (ein Bildschirm nur dafür)? Dann sind sie gewöhnliche Folien, die
 * dauerhaft stehen und sich abwechseln - statt nur „zwischendurch“ zu kommen.
 */
export function onlyMomentSlides(playlist) {
  const list = playlist || [];
  return list.length > 0 && list.every((entry) => MOMENT_SLIDES.has(entry.slide));
}

/**
 * Die nächste Folie nach `index`: die erste in der Reihenfolge, die etwas zu zeigen hat (`available(slide)`). Gibt
 * `{ index, moments }` zurück - `moments` sind die Folien für „zwischendurch“ auf dem Weg dorthin, die jetzt dran sind
 * (die Seite reiht sie als Moment ein). Hat keine andere Folie etwas, bleibt es bei `index`.
 */
export function advance(playlist, index, available) {
  const list = playlist || [];
  const moments = [];
  if (!list.length) return { index: 0, moments };
  const asSlides = onlyMomentSlides(list);
  for (let step = 1; step <= list.length; step += 1) {
    const position = (index + step) % list.length;
    const slide = list[position].slide;
    if (MOMENT_SLIDES.has(slide) && !asSlides) {
      if (available(slide) && !moments.includes(slide)) moments.push(slide);
      continue;
    }
    if (available(slide)) return { index: position, moments };
  }
  return { index, moments };
}

/** Wo die Liste beginnt: bei der ersten Folie mit Inhalt - sonst bei der ersten, die kein „zwischendurch“ ist. */
export function firstIndex(playlist, available) {
  const list = playlist || [];
  const asSlides = onlyMomentSlides(list);
  const regular = list.map((entry, index) => ({ entry, index })).filter(({ entry }) => asSlides || !MOMENT_SLIDES.has(entry.slide));
  const filled = regular.find(({ entry }) => available(entry.slide));
  return (filled || regular[0] || { index: 0 }).index;
}

/** Gibt es am Ende dieser Folie einen Wechsel? Nur dann zeigt der TV den Balken. */
export function changesAfter(playlist, index, available) {
  const list = playlist || [];
  if (list.length < 2) return false;
  const { index: next, moments } = advance(list, index, available);
  return next !== index || moments.length > 0;
}
