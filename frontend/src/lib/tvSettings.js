// TV & Beamer (#1110): die Einstellungen aller Bildschirme an einer Stelle. Die Grundwerte kommen vom Server
// (/api/tv/settings, ohne Anmeldung, Admin → eSports → TV & Beamer); ein einzelner Bildschirm weicht über Werte im
// Link ab - dieselben Namen wie am Server. Es gilt: Link vor Grundwert vor Standard. Was nicht passt, zählt nicht.
// Der Standard ist Fabians Wahl aus der TV-Vorschau vom 07.10.2026; backend/services/tv_display.py hält dieselben Werte.
// Weitere Werte (Wiedergabeliste #1121, Sponsoren #1125, Streckenwechsel #1127) kommen mit ihren Tickets dazu.
// „Ton beim Ergebnis“ (#1118) ist der einzige Ton am TV und standardmäßig aus.

export const TV_DEFAULTS = Object.freeze({
  text_size: "normal",
  contrast: false,
  safe_area: 0,
  pixel_shift: true,
  season_header: true,
  reduce_motion: false,
  result_sound: false,
});

/** Die Werte, wie die Admin-Seite sie zeigt - Reihenfolge, Name, Auswahl, Erklärung in Alltagssprache. */
export const TV_FIELDS = Object.freeze([
  {
    key: "text_size",
    label: "Schrift",
    type: "choice",
    options: [["normal", "Normal"], ["large", "Groß"]],
    hint: "„Groß“ hebt alle Mindestgrößen um die Hälfte an – für kleine Fernseher in großen Räumen.",
  },
  {
    key: "contrast",
    label: "Kontrast-Modus",
    type: "bool",
    hint: "Für helle Räume und Beamer bei Tageslicht: kräftige Schrift, volle Farben, dickere Linien, nichts halb Durchsichtiges.",
  },
  {
    key: "safe_area",
    label: "Sicherer Bereich",
    type: "choice",
    options: [[0, "Aus"], [3, "3 %"], [5, "5 %"]],
    hint: "Rückt den Inhalt vom Bildrand weg – für Fernseher, die den Rand abschneiden.",
  },
  {
    key: "pixel_shift",
    label: "Pixel-Verschiebung",
    type: "bool",
    hint: "Alle paar Minuten wandert das ganze Bild um 1 bis 3 Punkte – kaum zu sehen, schützt den Fernseher vor eingebrannten Logos.",
  },
  {
    key: "season_header",
    label: "Jahreszeiten in der TV-Kopfleiste",
    type: "bool",
    hint: "Läuft auf der Website eine Jahreszeit (Schnee, Halloween …), steht eine leise Fassung hinter Logo und Titel – nie über Namen oder dem Baum.",
  },
  {
    key: "reduce_motion",
    label: "Bewegung reduzieren",
    type: "bool",
    hint: "Nichts bewegt sich: keine Kamerafahrt, kein Zoom, keine Fahrten über die Linien, kein Konfetti; Laufband, Leuchten und Deko stehen still. Gilt auch, wenn das Gerät „Bewegung reduzieren“ eingestellt hat.",
  },
  {
    key: "result_sound",
    label: "Ton beim Ergebnis",
    type: "bool",
    hint: "Ein kurzer Gong, wenn ein Ergebnis groß über dem Turnierbaum steht – nur für den Bildschirm mit Lautsprecher. Der Browser spielt Ton erst nach einem Klick auf den TV; bis dahin steht dort klein „Für Ton einmal klicken“.",
  },
]);

const CHOICES = { text_size: ["normal", "large"], safe_area: [0, 3, 5] };
const BOOLEANS = new Set(["contrast", "pixel_shift", "season_header", "reduce_motion", "result_sound"]);
const TRUE_WORDS = new Set(["1", "true", "an", "ja", "on"]);
const FALSE_WORDS = new Set(["0", "false", "aus", "nein", "off"]);

export const TV_KEYS = Object.freeze(Object.keys(TV_DEFAULTS));

/** Passt der Wert (vom Server)? Wahrheitswerte nur echt, Auswahl nur aus der Liste - wie am Server. */
export function validTvValue(key, value) {
  if (BOOLEANS.has(key)) return typeof value === "boolean";
  if (CHOICES[key]) return typeof value === typeof TV_DEFAULTS[key] && CHOICES[key].includes(value);
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
  return undefined;
}

/** So steht ein Wert im Link. */
export function serializeTvParam(key, value) {
  if (BOOLEANS.has(key)) return value ? "1" : "0";
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

/** Was am Bildschirm gilt: Standard, darüber die Grundwerte vom Server, darüber der Link. */
export function resolveTvSettings(serverSettings, overrides = {}) {
  const out = { ...TV_DEFAULTS };
  for (const key of TV_KEYS) {
    const fromServer = serverSettings?.[key];
    if (validTvValue(key, fromServer)) out[key] = fromServer;
  }
  for (const key of TV_KEYS) {
    if (validTvValue(key, overrides?.[key])) out[key] = overrides[key];
  }
  return out;
}

/** Wie der Admin einen Wert liest: „Groß“, „An“, „5 %“. */
export function tvValueLabel(key, value) {
  const field = TV_FIELDS.find((entry) => entry.key === key);
  if (!field) return String(value);
  if (field.type === "bool") return value ? "An" : "Aus";
  const option = field.options.find(([optionValue]) => optionValue === value);
  return option ? option[1] : String(value);
}

// Ansichten für den Link-Baukasten. Weitere Ansichten (Hallen-Tafel, Aufrufe …) kommen mit ihren Tickets. Die
// Stations-Ansicht (#1120) gehört zum Turnierbaum: dasselbe Turnier, derselbe Anzeige-Schlüssel, dazu eine Station.
export const TV_VIEWS = Object.freeze([
  { key: "bracket", label: "Turnierbaum", path: "/display/bracket/", target: "Turnier", needsKey: true },
  { key: "station", label: "Station", path: "/display/bracket/", target: "Turnier", needsKey: true, needsStation: true },
  { key: "event", label: "Event", path: "/display/event/", target: "Event", needsKey: false },
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
  return `${origin}${meta.path}${encodeURIComponent(targetId)}${station}${query ? `?${query}` : ""}`;
}

/** Ein TV-Link zurückgelesen: Ansicht, Ziel und Station - oder `null`, wenn es kein Link einer TV-Seite ist. */
export function parseTvPath(pathname) {
  const station = /^\/display\/bracket\/([^/]+)\/station\/([^/]+)\/?$/.exec(pathname || "");
  if (station) return { view: "station", targetId: decodeURIComponent(station[1]), stationId: decodeURIComponent(station[2]) };
  for (const entry of TV_VIEWS) {
    if (entry.needsStation || !String(pathname || "").startsWith(entry.path)) continue;
    const targetId = decodeURIComponent(String(pathname).slice(entry.path.length).split("/")[0] || "");
    if (targetId) return { view: entry.key, targetId, stationId: "" };
  }
  return null;
}
