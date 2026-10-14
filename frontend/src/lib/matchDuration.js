// Die Spieldauer eines Spiels - eine Funktion für die ganze Website (#1552, #1554).
// Dieselbe Regel wie backend/services/match_duration.py:
//   Spiel → Spiel.settings → Phase → Turnier → Game (Dauer je Modus) → 30 Minuten.
// Game: Modus der Phase, sonst des Turniers, sonst der erste. Ist die Dauer pro Einzelspiel angegeben (per_game),
// zählt Best-of als Erwartungswert (Mitte aus kürzestem und längstem Verlauf: Bo3 = 2,5, Bo5 = 4 Spiele), aufgerundet.
// Dazu die Aufbau-/Wechselzeit des Games. Ein Wert an Turnier, Phase oder Spiel ist immer die ganze Dauer.
// Puffer (#1557): `match_buffer_minutes` am Turnier kommt auf jede Dauer aus Phase, Turnier, Game oder Vorgabe - eine
// Dauer am Spiel selbst bekommt keinen.
// Ein Wächter in matchDuration.test.js hält Kopien der Kette fern.

export const DEFAULT_MATCH_DURATION_MINUTES = 30;

function minutesOf(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  // Wie int() im Backend: Text nur als ganze Zahl („12“), nicht „12.5“.
  if (typeof value === "string" && !/^\s*[+-]?\d+\s*$/.test(value)) return null;
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number >= 1 ? number : null;
}

function settingsOf(doc) {
  const settings = doc?.settings;
  return settings && typeof settings === "object" ? settings : {};
}

/** Wie viele Einzelspiele ein Best-of im Mittel dauert: (N + N//2 + 1) / 2. */
export function expectedGames(bestOf) {
  const count = minutesOf(bestOf) || 1;
  return (count + Math.floor(count / 2) + 1) / 2;
}

function bestOfFor(match, stage, tournament) {
  for (const value of [match?.best_of, settingsOf(match).best_of, settingsOf(stage).best_of, tournament?.best_of]) {
    const count = minutesOf(value);
    if (count !== null) return count;
  }
  return 1;
}

/** Die Modi eines Games - Kaputtes fällt still heraus. */
export function gameModes(game) {
  const modes = game?.match_modes;
  return Array.isArray(modes) ? modes.filter((mode) => mode && typeof mode === "object") : [];
}

/** Der Modus, der gilt: der der Phase, sonst der des Turniers, sonst der erste. */
export function gameMode(game, { stage, tournament } = {}) {
  const modes = gameModes(game);
  if (!modes.length) return null;
  const wanted = settingsOf(stage).game_mode || tournament?.game_mode;
  return (wanted && modes.find((mode) => mode.mode === wanted)) || modes[0];
}

/** Die Dauer, die das Game vorgibt - null, wenn es keine brauchbare kennt. */
export function gameDuration(game, { match, stage, tournament } = {}) {
  const mode = gameMode(game, { stage, tournament });
  let minutes = minutesOf(mode?.minutes);
  if (minutes === null) return null;
  if (mode.per_game) minutes = Math.ceil(expectedGames(bestOfFor(match, stage, tournament)) * minutes);
  const setup = game?.setup_minutes;
  if (typeof setup === "number" && setup > 0) minutes += Math.trunc(setup);
  return minutes;
}

/** Der Puffer je Spiel aus dem Turnier (#1557) - 0 ohne brauchbaren Wert. */
export function bufferMinutes(tournament) {
  return minutesOf(tournament?.match_buffer_minutes) || 0;
}

function withBuffer(result, tournament) {
  const buffer = bufferMinutes(tournament);
  return buffer ? { ...result, minutes: result.minutes + buffer, buffer } : result;
}

/** Dauer und Herkunft: { minutes, source: "match" | "stage" | "tournament" | "game" | "default", mode, buffer? }. */
export function matchDurationSource(match, { stage, tournament, game, updates } = {}) {
  const own = updates && "duration_minutes" in updates ? updates.duration_minutes : match?.duration_minutes;
  for (const value of [own, settingsOf(match).duration_minutes]) {
    const minutes = minutesOf(value);
    if (minutes !== null) return { minutes, source: "match", mode: null };
  }
  const levels = [
    ["stage", settingsOf(stage).duration_minutes],
    ["tournament", tournament?.match_duration_minutes],
  ];
  for (const [source, value] of levels) {
    const minutes = minutesOf(value);
    if (minutes !== null) return withBuffer({ minutes, source, mode: null }, tournament);
  }
  const fromGame = gameDuration(game, { match, stage, tournament });
  if (fromGame !== null) return withBuffer({ minutes: fromGame, source: "game", mode: gameMode(game, { stage, tournament }) }, tournament);
  return withBuffer({ minutes: DEFAULT_MATCH_DURATION_MINUTES, source: "default", mode: null }, tournament);
}

/** Ein eigener Dauer-Wert für ein Eingabefeld: die Zahl als Text, leer heißt „erben“. */
export function ownDurationInput(value) {
  const minutes = minutesOf(value);
  return minutes === null ? "" : String(minutes);
}

/** Ein Eingabefeld für die API: leer oder unbrauchbar ist null (dann gilt die Kette darunter). */
export function ownDurationPayload(value) {
  return minutesOf(value);
}

const SOURCE_WORDS ={ match: "am Spiel", stage: "von der Phase", tournament: "vom Turnier", game: "vom Spiel", default: "Standard" };

/** „vom Spiel: 12 Min. (Grand Prix 4 Rennen) + 8 Min. Puffer“ - woher eine geerbte Dauer kommt, für Hinweise. */
export function durationSourceText({ minutes, source, mode, buffer } = {}) {
  const label = String(mode?.label || "").trim();
  const base = buffer ? minutes - buffer : minutes;
  return `${SOURCE_WORDS[source] || "Standard"}: ${base} Min.${source === "game" && label ? ` (${label})` : ""}${buffer ? ` + ${buffer} Min. Puffer` : ""}`;
}

/** Wie lange dieses Spiel geplant wird, in Minuten. */
export function effectiveMatchDuration(match, context = {}) {
  return matchDurationSource(match, context).minutes;
}
