// Spiel-Daten für Turniere (#1554): Dauer je Modus, Spieler je Lauf, Geräte, Aufbauzeit, Punktetabelle, Best-of.
// Hier: Formular ↔ API in der Spiele-Verwaltung und die Vorbelegung im Turnierformular. Die Dauer selbst rechnet
// lib/matchDuration.js - dieselbe Kette wie im Backend.
import { matchDurationSource } from "@/lib/matchDuration";

// Dieselben Kennungen wie stations.device_type (Stationsverwaltung, lib/tournamentLabels.js DEVICE_TYPE_LABELS).
export const STATION_DEVICE_OPTIONS = [
  ["switch", "Switch"],
  ["switch2", "Switch 2"],
  ["pc", "PC"],
  ["ps5", "PS5"],
  ["xbox", "Xbox"],
  ["racing_rig", "Renn-Setup"],
];

export const POINTS_MAX_PLACES = 64;
export const MODES_MAX = 20;

const text = (value) => (value === null || value === undefined ? "" : String(value));

function numberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

/** „15, 12, 10, 9“, „4-3-2-1“ oder mit Leerzeichen - Punkte je Platz, oder was nicht passt. */
export function parsePointsTable(value) {
  const parts = String(value || "").split(/[\s,;/–-]+/).filter(Boolean);
  const bad = parts.find((part) => !/^\d+$/.test(part));
  if (bad) return { points: [], error: `„${bad}“ ist keine ganze Zahl.` };
  const points = parts.map(Number);
  if (points.length > POINTS_MAX_PLACES) return { points: [], error: `Höchstens ${POINTS_MAX_PLACES} Plätze.` };
  if (points.some((points_) => points_ > 1000)) return { points: [], error: "Punkte je Platz: 0 bis 1000." };
  return { points, error: "" };
}

export function emptyMode() {
  return { mode: "", label: "", minutes: "", per_game: false };
}

export function gameMatchDataToForm(game) {
  return {
    match_modes: (Array.isArray(game?.match_modes) ? game.match_modes : []).filter(Boolean).map((mode) => ({
      mode: text(mode.mode), label: text(mode.label), minutes: text(mode.minutes), per_game: Boolean(mode.per_game),
    })),
    players_per_run_local: text(game?.players_per_run_local),
    players_per_run_online: text(game?.players_per_run_online),
    station_devices: Array.isArray(game?.station_devices) ? [...game.station_devices] : [],
    setup_minutes: text(game?.setup_minutes),
    points_table: Array.isArray(game?.points_table) ? game.points_table.join(", ") : "",
    default_best_of: text(game?.default_best_of),
  };
}

/** Was an die API geht: leer heißt „keine Vorgabe“ (null bzw. leere Liste), leere Modus-Zeilen fallen weg. */
export function gameMatchDataPayload(form) {
  const modes = (form?.match_modes || [])
    .filter((mode) => String(mode.label || "").trim() || String(mode.minutes || "").trim())
    .map((mode) => {
      const row = { label: String(mode.label || "").trim(), minutes: numberOrNull(mode.minutes), per_game: Boolean(mode.per_game) };
      return mode.mode ? { mode: mode.mode, ...row } : row;
    });
  return {
    match_modes: modes,
    players_per_run_local: numberOrNull(form?.players_per_run_local),
    players_per_run_online: numberOrNull(form?.players_per_run_online),
    station_devices: [...(form?.station_devices || [])],
    setup_minutes: numberOrNull(form?.setup_minutes),
    points_table: parsePointsTable(form?.points_table).points,
    default_best_of: numberOrNull(form?.default_best_of),
  };
}

/** Was vor dem Speichern noch fehlt - leer, wenn alles passt. Dieselben Grenzen wie im Backend (models.py). */
export function gameMatchDataProblem(form) {
  const modes = (form?.match_modes || []).filter((mode) => String(mode.label || "").trim() || String(mode.minutes || "").trim());
  for (const [index, mode] of modes.entries()) {
    const label = String(mode.label || "").trim();
    if (!label) return `Modus ${index + 1}: bitte einen Namen eintragen.`;
    // Minuten freiwillig (#1616): ein Modus nur für Maps hat keine Dauer, dann plant das Turnier mit der nächsten Ebene.
    if (String(mode.minutes ?? "").trim() === "") continue;
    const minutes = numberOrNull(mode.minutes);
    if (minutes === null || minutes < 1 || minutes > 600) return `Modus „${label}“: Minuten von 1 bis 600 – oder leer lassen.`;
  }
  const points = parsePointsTable(form?.points_table);
  return points.error ? `Punktetabelle: ${points.error}` : "";
}

/**
 * Was das Spiel dem Turnierformular vorschlägt: Dauer (aus dem Modus, wenn das Turnier keine eigene hat), Best-of
 * und Laufgröße (vor Ort oder online, je nach Austragung). `tournament` ist der Formularstand.
 */
export function gamePresets(game, tournament = {}) {
  const fromGame = matchDurationSource({}, { tournament: { ...tournament, match_duration_minutes: null }, game });
  const online = tournament?.event_mode === "online";
  return {
    duration: fromGame.source === "game" ? fromGame : null,
    bestOf: numberOrNull(game?.default_best_of),
    runSize: numberOrNull(online ? game?.players_per_run_online : game?.players_per_run_local),
  };
}
