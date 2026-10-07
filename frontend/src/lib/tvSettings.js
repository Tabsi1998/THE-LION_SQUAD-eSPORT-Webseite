// TV & Beamer (#1110): die Einstellungen aller Bildschirme an einer Stelle. Die Grundwerte kommen vom Server
// (/api/tv/settings, ohne Anmeldung, Admin → eSports → TV & Beamer); ein einzelner Bildschirm weicht über Werte im
// Link ab - dieselben Namen wie am Server. Es gilt: Link vor Grundwert vor Standard. Was nicht passt, zählt nicht.
// Der Standard ist Fabians Wahl aus der TV-Vorschau vom 07.10.2026; backend/services/tv_display.py hält dieselben Werte.
// Meilenstein 60 bringt die Wiedergabeliste (#1121), die Aufrufe (#1122), die Zahlen zwischendurch (#1124), die
// Sponsoren am TV (#1125) und den Streckenwechsel bei Meisterschaften (#1127). Ton gibt es nur als Gong beim Ergebnis
// oder beim Aufruf - beides standardmäßig aus.
import { DEFAULT_PLAYLIST, copyPlaylist, parsePlaylist, playlistLabel, serializePlaylist, validPlaylist } from "@/lib/tvPlaylist";

export const TV_DEFAULTS = Object.freeze({
  text_size: "normal",
  contrast: false,
  safe_area: 0,
  pixel_shift: true,
  season_header: true,
  reduce_motion: false,
  result_sound: false,
  playlist: DEFAULT_PLAYLIST,
  call_sound: false,
  report_minutes: 2,
  stats: true,
  stats_every: 10,
  sponsor_moment: true,
  sponsor_every: 3,
  sponsor_presented: true,
  sponsor_ticker: false,
  track_seconds: 45,
});

const ALL_VIEWS = Object.freeze(["bracket", "station", "event", "calls", "fastlap"]);

// Die Bereiche der Admin-Seite - jede Einstellung steht an genau einer Stelle.
export const TV_GROUPS = Object.freeze([
  { key: "picture", label: "Bild und Schrift", hint: "Für alle Bildschirme: lesbar aus 5 Metern, auch im hellen Raum." },
  { key: "playlist", label: "Turnierbaum-TV: Wiedergabeliste", hint: "Was der Turnierbaum-TV nacheinander zeigt und wie lange. Ein Ergebnis hält die Liste kurz an." },
  { key: "calls", label: "Aufrufe", hint: "Die Aufruf-Tafel zeigt groß, wer an welche Station soll – mit Countdown." },
  { key: "stats", label: "Zahlen zwischendurch", hint: "Ab und zu ein paar Zahlen zum Turnier, ohne dem Baum die Zeit zu stehlen." },
  { key: "sponsors", label: "Sponsoren am TV", hint: "Drei Schalter, frei kombinierbar. Alle aus heißt: keine Sponsoren am TV. Welcher Sponsor eine Runde präsentiert, stellst du beim Turnier ein." },
  { key: "fastlap", label: "Fast Lap", hint: "Für den Fast-Lap-TV bei Meisterschaften." },
  { key: "sound", label: "Ton", hint: "Ton ist überall standardmäßig aus – nur ein Bildschirm mit Lautsprecher braucht ihn." },
]);

/** Die Werte, wie die Admin-Seite sie zeigt - Bereich, Reihenfolge, Name, Auswahl, Erklärung in Alltagssprache. */
export const TV_FIELDS = Object.freeze([
  {
    key: "text_size",
    group: "picture",
    label: "Schrift",
    type: "choice",
    options: [["normal", "Normal"], ["large", "Groß"]],
    hint: "„Groß“ hebt alle Mindestgrößen um die Hälfte an – für kleine Fernseher in großen Räumen.",
  },
  {
    key: "contrast",
    group: "picture",
    label: "Kontrast-Modus",
    type: "bool",
    hint: "Für helle Räume und Beamer bei Tageslicht: kräftige Schrift, volle Farben, dickere Linien, nichts halb Durchsichtiges.",
  },
  {
    key: "safe_area",
    group: "picture",
    label: "Sicherer Bereich",
    type: "choice",
    options: [[0, "Aus"], [3, "3 %"], [5, "5 %"]],
    hint: "Rückt den Inhalt vom Bildrand weg – für Fernseher, die den Rand abschneiden.",
  },
  {
    key: "pixel_shift",
    group: "picture",
    label: "Pixel-Verschiebung",
    type: "bool",
    hint: "Alle paar Minuten wandert das ganze Bild um 1 bis 3 Punkte – kaum zu sehen, schützt den Fernseher vor eingebrannten Logos.",
  },
  {
    key: "season_header",
    group: "picture",
    label: "Jahreszeiten in der TV-Kopfleiste",
    type: "bool",
    hint: "Läuft auf der Website eine Jahreszeit (Schnee, Halloween …), steht eine leise Fassung hinter Logo und Titel – nie über Namen oder dem Baum.",
  },
  {
    key: "reduce_motion",
    group: "picture",
    label: "Bewegung reduzieren",
    type: "bool",
    hint: "Nichts bewegt sich: keine Kamerafahrt, kein Zoom, keine Fahrten über die Linien, kein Konfetti; Folien wechseln ohne Gleiten; Laufband, Leuchten, Countdown-Ring und Deko stehen still. Gilt auch, wenn das Gerät „Bewegung reduzieren“ eingestellt hat.",
  },
  {
    key: "playlist",
    group: "playlist",
    label: "Wiedergabeliste",
    type: "playlist",
    views: ["bracket"],
    hint: "Reihenfolge und Dauer je Folie. Folien ohne Inhalt (keine Aufrufe, kein laufendes Spiel) werden übersprungen. Sponsor und Zahlen kommen nur so oft, wie unten eingestellt. Ein Bildschirm mit nur einer Folie zeigt genau diese – ohne Wechsel.",
  },
  {
    key: "report_minutes",
    group: "calls",
    label: "Zeit zum Antreten",
    type: "int",
    min: 1,
    max: 30,
    unit: "Min.",
    presets: [1, 2, 3, 5, 10],
    views: ["bracket", "station", "event", "calls"],
    hint: "Hat ein aufgerufenes Spiel keine geplante Uhrzeit, läuft der Countdown so lange ab dem Aufruf.",
  },
  {
    key: "stats",
    group: "stats",
    label: "Zahlen zwischendurch",
    type: "bool",
    views: ["bracket"],
    hint: "Spiele gespielt, meiste Siege, knappster Zieleinlauf – nur mit echten Zahlen, nie während eines Ergebnisses.",
  },
  {
    key: "stats_every",
    group: "stats",
    label: "Zahlen höchstens alle",
    type: "int",
    min: 1,
    max: 60,
    unit: "Min.",
    presets: [5, 10, 15, 20, 30],
    views: ["bracket"],
    hint: "Wie oft die Zahlen höchstens kommen. Wie lange sie stehen, sagt die Wiedergabeliste.",
  },
  {
    key: "sponsor_moment",
    group: "sponsors",
    label: "Sponsor-Moment",
    type: "bool",
    views: ["bracket", "event", "fastlap"],
    hint: "Ein Sponsor groß über die ganze Breite: „Unser Partner“ mit Logo. Die Sponsoren kommen der Reihe nach dran; nie während eines Ergebnisses.",
  },
  {
    key: "sponsor_every",
    group: "sponsors",
    label: "Sponsor-Moment höchstens alle",
    type: "int",
    min: 1,
    max: 60,
    unit: "Min.",
    presets: [1, 2, 3, 5, 10],
    views: ["bracket", "event", "fastlap"],
    hint: "Wie oft der Sponsor-Moment höchstens kommt.",
  },
  {
    key: "sponsor_presented",
    group: "sponsors",
    label: "„Runde präsentiert von“",
    type: "bool",
    views: ["bracket"],
    hint: "Hat eine Runde einen Sponsor, steht oben „Runde 2 präsentiert von“ mit Logo – bis die Runde fertig ist.",
  },
  {
    key: "sponsor_ticker",
    group: "sponsors",
    label: "Laufband unten",
    type: "bool",
    hint: "Die Sponsoren-Leiste unten rechts. Mit „Bewegung reduzieren“ steht sie still und wechselt seitenweise.",
  },
  {
    key: "track_seconds",
    group: "fastlap",
    label: "Streckenwechsel bei Meisterschaften",
    type: "int",
    min: 20,
    max: 120,
    unit: "s",
    presets: [20, 30, 45, 60, 90, 120],
    views: ["fastlap"],
    hint: "So lange bleibt eine Strecke im Bild. Ein Link mit fester Strecke wechselt nie; ein Bestzeit-Moment läuft immer zu Ende.",
  },
  {
    key: "result_sound",
    group: "sound",
    label: "Ton beim Ergebnis",
    type: "bool",
    views: ["bracket"],
    hint: "Ein kurzer Gong, wenn ein Ergebnis groß über dem Turnierbaum steht – nur für den Bildschirm mit Lautsprecher. Der Browser spielt Ton erst nach einem Klick auf den TV; bis dahin steht dort klein „Für Ton einmal klicken“.",
  },
  {
    key: "call_sound",
    group: "sound",
    label: "Gong beim Aufruf",
    type: "bool",
    views: ["bracket", "calls"],
    hint: "Ein kurzer Gong, wenn ein neuer Aufruf auf der Tafel erscheint – wie beim Ergebnis erst nach einem Klick auf den TV.",
  },
].map((field) => Object.freeze({ views: ALL_VIEWS, ...field })));

const FIELD_BY_KEY = new Map(TV_FIELDS.map((field) => [field.key, field]));
const CHOICES = { text_size: ["normal", "large"], safe_area: [0, 3, 5] };
const BOOLEANS = new Set(TV_FIELDS.filter((field) => field.type === "bool").map((field) => field.key));
const TRUE_WORDS = new Set(["1", "true", "an", "ja", "on"]);
const FALSE_WORDS = new Set(["0", "false", "aus", "nein", "off"]);

export const TV_KEYS = Object.freeze(Object.keys(TV_DEFAULTS));

/** Passt der Wert (vom Server)? Wahrheitswerte nur echt, Auswahl nur aus der Liste, Zahlen ganz und in den Grenzen. */
export function validTvValue(key, value) {
  if (BOOLEANS.has(key)) return typeof value === "boolean";
  if (CHOICES[key]) return typeof value === typeof TV_DEFAULTS[key] && CHOICES[key].includes(value);
  const field = FIELD_BY_KEY.get(key);
  if (field?.type === "int") return Number.isInteger(value) && value >= field.min && value <= field.max;
  if (key === "playlist") return validPlaylist(value);
  return false;
}

/** Ein Wert aus dem Link: „1/0“, „an/aus“, „true/false“; „groß“ und „gross“ gehen auch. Unpassendes = nicht gesetzt. */
export function parseTvParam(key, raw) {
  if (raw === null || raw === undefined) return undefined;
  const value = String(raw).trim().toLowerCase();
  if (BOOLEANS.has(key)) {
    if (TRUE_WORDS.has(value)) return true;
    if (FALSE_WORDS.has(value)) return false;
    return undefined;
  }
  if (key === "text_size") {
    if (value === "gross" || value === "groß") return "large";
    return CHOICES.text_size.includes(value) ? value : undefined;
  }
  if (key === "safe_area") {
    if (!/^\d+$/.test(value)) return undefined;
    const number = Number(value);
    return CHOICES.safe_area.includes(number) ? number : undefined;
  }
  if (key === "playlist") return parsePlaylist(value);
  const field = FIELD_BY_KEY.get(key);
  if (field?.type === "int") {
    if (!/^\d+$/.test(value)) return undefined;
    const number = Number(value);
    return number >= field.min && number <= field.max ? number : undefined;
  }
  return undefined;
}

/** So steht ein Wert im Link. */
export function serializeTvParam(key, value) {
  if (BOOLEANS.has(key)) return value ? "1" : "0";
  if (key === "playlist") return serializePlaylist(value);
  return String(value);
}

/** Die Abweichungen eines Bildschirms aus dem Link (URLSearchParams oder Text). */
export function linkOverrides(search) {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search || "");
  const out = {};
  for (const key of TV_KEYS) {
    const value = parseTvParam(key, params.get(key));
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function own(key, value) {
  return key === "playlist" ? copyPlaylist(value) : value;
}

/** Was am Bildschirm gilt: Standard, darüber die Grundwerte vom Server, darüber der Link. */
export function resolveTvSettings(serverSettings, overrides = {}) {
  const out = {};
  for (const key of TV_KEYS) out[key] = own(key, TV_DEFAULTS[key]);
  for (const key of TV_KEYS) {
    const fromServer = serverSettings?.[key];
    if (validTvValue(key, fromServer)) out[key] = own(key, fromServer);
  }
  for (const key of TV_KEYS) {
    if (validTvValue(key, overrides?.[key])) out[key] = own(key, overrides[key]);
  }
  return out;
}

/** Sind zwei Werte gleich? Für die Wiedergabeliste zählt Folie für Folie. */
export function sameTvValue(key, a, b) {
  if (key === "playlist") return serializePlaylist(a) === serializePlaylist(b);
  return a === b;
}

/** Wie der Admin einen Wert liest: „Groß“, „An“, „5 %“, „45 s“, „Turnierbaum 12 s · Aufrufe 8 s“. */
export function tvValueLabel(key, value) {
  const field = FIELD_BY_KEY.get(key);
  if (!field) return String(value);
  if (field.type === "bool") return value ? "An" : "Aus";
  if (field.type === "int") return `${value} ${field.unit}`;
  if (field.type === "playlist") return playlistLabel(value);
  const option = field.options.find(([optionValue]) => optionValue === value);
  return option ? option[1] : String(value);
}

/** Welche Einstellungen ein Bildschirm dieser Ansicht überhaupt nutzt - nur die bietet der Link-Baukasten an. */
export function fieldsForView(view) {
  return TV_FIELDS.filter((field) => field.views.includes(view));
}

// Ansichten für den Link-Baukasten. Die Stations-Ansicht (#1120) gehört zum Turnierbaum: dasselbe Turnier, derselbe
// Anzeige-Schlüssel, dazu eine Station. Die Aufruf-Tafel (#1122) gibt es für ein ganzes Event (alle Turniere); für ein
// einzelnes Turnier ist es der Turnierbaum mit der Wiedergabeliste „nur Aufrufe“.
export const TV_VIEWS = Object.freeze([
  { key: "bracket", label: "Turnierbaum", path: "/display/bracket/", target: "Turnier", needsKey: true },
  { key: "station", label: "Station", path: "/display/bracket/", target: "Turnier", needsKey: true, needsStation: true },
  { key: "event", label: "Event", path: "/display/event/", target: "Event", needsKey: false },
  { key: "calls", label: "Aufrufe", path: "/display/event/", suffix: "/calls", target: "Event", needsKey: false },
  { key: "fastlap", label: "Fast Lap", path: "/display/f1/", target: "Fast-Lap-Challenge", needsKey: false },
]);

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Der Link für einen Bildschirm: Ansicht, Ziel, beim Turnierbaum der Anzeige-Schlüssel und nur die Abweichungen, die
 * der Admin für diesen Bildschirm gewählt hat - alles andere kommt aus den Grundwerten und folgt ihnen live. Die
 * Stations-Ansicht braucht dazu die Station: /display/bracket/<Turnier>/station/<Station>.
 */
export function buildTvLink({ origin = "", view, targetId, stationId = "", displayKey = "", overrides = {} }) {
  const meta = TV_VIEWS.find((entry) => entry.key === view);
  if (!meta || !targetId || !SAFE_ID.test(String(targetId))) return "";
  if (meta.needsStation && (!stationId || !SAFE_ID.test(String(stationId)))) return "";
  const params = new URLSearchParams();
  if (meta.needsKey && displayKey) params.set("key", displayKey);
  for (const key of TV_KEYS) {
    if (validTvValue(key, overrides?.[key])) params.set(key, serializeTvParam(key, overrides[key]));
  }
  const query = params.toString();
  const station = meta.needsStation ? `/station/${encodeURIComponent(stationId)}` : "";
  return `${origin}${meta.path}${encodeURIComponent(targetId)}${station}${meta.suffix || ""}${query ? `?${query}` : ""}`;
}

/** Ein TV-Link zurückgelesen: Ansicht, Ziel und Station - oder `null`, wenn es kein Link einer TV-Seite ist. */
export function parseTvPath(pathname) {
  const path = pathname || "";
  const station = /^\/display\/bracket\/([^/]+)\/station\/([^/]+)\/?$/.exec(path);
  if (station) return { view: "station", targetId: decodeURIComponent(station[1]), stationId: decodeURIComponent(station[2]) };
  const calls = /^\/display\/event\/([^/]+)\/calls\/?$/.exec(path);
  if (calls) return { view: "calls", targetId: decodeURIComponent(calls[1]), stationId: "" };
  for (const entry of TV_VIEWS) {
    if (entry.needsStation || entry.suffix || !String(path).startsWith(entry.path)) continue;
    const targetId = decodeURIComponent(String(path).slice(entry.path.length).split("/")[0] || "");
    if (targetId) return { view: entry.key, targetId, stationId: "" };
  }
  return null;
}
