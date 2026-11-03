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

// Spielmodi mit Zustand und Ergebnisregel (#2206, C.1) - dieselben Grenzen wie models.GameMatchMode, Vertrag in docs/LIGA.md.
export const MODE_DESCRIPTION_MAX = 500;
export const MODE_FORMAT_MAX = 60;
export const RESULT_TARGET_MAX = 100000;
export const MODE_STATUS_OPTIONS = [
  ["active", "Aktiv"],
  ["inactive", "Inaktiv – nicht mehr für Neues"],
  ["archived", "Archiviert – auch aus Listen ausgeblendet"],
];
export const RESULT_RULE_KINDS = [
  ["", "Keine Regel"],
  ["score", "Punkte bis zum Ziel"],
  ["rounds", "Runden gewinnen"],
  ["highest", "Höherer Endstand gewinnt"],
];
const STATUS_WORDS = { inactive: "inaktiv", archived: "archiviert" };

/** Der Zustand eines Modus - fehlt er oder ist er unbekannt, ist der Modus aktiv. */
export function modeStatusOf(mode) {
  return mode?.status === "inactive" || mode?.status === "archived" ? mode.status : "active";
}

/**
 * Die Modi für eine Auswahlliste der Verwaltung (Pool, Modus je Map, Spielmodus des Turniers): aktive, dazu die schon
 * gesetzten (`kept`) mit „(inaktiv)“ bzw. „(archiviert)“ am Namen. Neu wählen lässt sich ein inaktiver Modus nicht.
 */
export function selectableModes(modes, kept = []) {
  const keep = new Set((kept || []).filter(Boolean));
  return (Array.isArray(modes) ? modes : [])
    .filter((mode) => mode?.mode && (modeStatusOf(mode) === "active" || keep.has(mode.mode)))
    .map((mode) => (modeStatusOf(mode) === "active" ? mode : { ...mode, label: `${mode.label || mode.mode} (${STATUS_WORDS[modeStatusOf(mode)]})` }));
}

/** Eine Ergebnisregel in einem Satzteil: „Runden gewinnen: 4 Siege, höchstens 7 Runden · 2 Min. · Verlängerung“. */
export function resultRuleText(rule) {
  if (!rule?.kind) return "";
  const head = {
    score: `Punkte bis zum Ziel: ${rule.target}`,
    rounds: `Runden gewinnen: ${rule.target} ${Number(rule.target) === 1 ? "Sieg" : "Siege"}${rule.round_limit ? `, höchstens ${rule.round_limit} Runden` : ""}`,
    highest: "Höherer Endstand gewinnt",
  }[rule.kind] || "";
  return [head, rule.time_limit_minutes ? `${rule.time_limit_minutes} Min.` : "", rule.draw_allowed ? "Remis möglich" : "", rule.overtime ? "Verlängerung" : ""]
    .filter(Boolean).join(" · ");
}

export function emptyMode() {
  return {
    mode: "", label: "", minutes: "", per_game: false, status: "active", description: "", players_per_side: "", format: "",
    rule_kind: "", rule_target: "", rule_round_limit: "", rule_time_limit: "", rule_draw: false, rule_overtime: false,
  };
}

function modeToForm(mode) {
  const rule = mode.result_rule && typeof mode.result_rule === "object" ? mode.result_rule : {};
  return {
    mode: text(mode.mode), label: text(mode.label), minutes: text(mode.minutes), per_game: Boolean(mode.per_game),
    status: modeStatusOf(mode), description: text(mode.description), players_per_side: text(mode.players_per_side), format: text(mode.format),
    rule_kind: text(rule.kind), rule_target: text(rule.target), rule_round_limit: text(rule.round_limit),
    rule_time_limit: text(rule.time_limit_minutes), rule_draw: Boolean(rule.draw_allowed), rule_overtime: Boolean(rule.overtime),
  };
}

/** Nur was gesetzt ist - ohne neue Angaben bleibt ein Modus genau so, wie er vor #2206 gespeichert wurde. */
function modeExtras(mode) {
  const out = {};
  if (mode.status && mode.status !== "active") out.status = mode.status;
  const description = String(mode.description || "").trim();
  if (description) out.description = description;
  const players = numberOrNull(mode.players_per_side);
  if (players !== null) out.players_per_side = players;
  const format = String(mode.format || "").split(/\s+/).filter(Boolean).join(" ");
  if (format) out.format = format;
  if (mode.rule_kind) {
    const rule = { kind: mode.rule_kind };
    const target = numberOrNull(mode.rule_target);
    if (target !== null && mode.rule_kind !== "highest") rule.target = target;
    const limit = numberOrNull(mode.rule_round_limit);
    if (limit !== null && mode.rule_kind === "rounds") rule.round_limit = limit;
    const time = numberOrNull(mode.rule_time_limit);
    if (time !== null) rule.time_limit_minutes = time;
    rule.draw_allowed = Boolean(mode.rule_draw);
    rule.overtime = Boolean(mode.rule_overtime);
    out.result_rule = rule;
  }
  return out;
}

const isBlank = (value) => String(value ?? "").trim() === "";

/** Was an einer Ergebnisregel nicht passt - dieselben Regeln wie `GameModeResultRule` im Backend. */
function ruleProblem(mode, label) {
  if (!mode.rule_kind) return "";
  const where = `Modus „${label}“, Ergebnisregel`;
  const target = numberOrNull(mode.rule_target);
  if (mode.rule_kind !== "highest") {
    if (isBlank(mode.rule_target)) return `${where}: bitte das Ziel eintragen.`;
    if (target === null || target < 1 || target > RESULT_TARGET_MAX) return `${where}: Ziel von 1 bis 100.000.`;
  }
  if (mode.rule_kind === "rounds" && !isBlank(mode.rule_round_limit)) {
    const limit = numberOrNull(mode.rule_round_limit);
    if (limit === null || limit < 1 || limit > 999) return `${where}: Rundenlimit von 1 bis 999 – oder leer lassen.`;
    if (limit < target) return `${where}: Das Rundenlimit (${limit}) ist kleiner als das Ziel (${target}).`;
  }
  if (!isBlank(mode.rule_time_limit)) {
    const time = numberOrNull(mode.rule_time_limit);
    if (time === null || time < 1 || time > 600) return `${where}: Zeitlimit von 1 bis 600 Minuten – oder leer lassen.`;
  }
  return "";
}

export function gameMatchDataToForm(game) {
  return {
    match_modes: (Array.isArray(game?.match_modes) ? game.match_modes : []).filter(Boolean).map(modeToForm),
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
      const row = { label: String(mode.label || "").trim(), minutes: numberOrNull(mode.minutes), per_game: Boolean(mode.per_game), ...modeExtras(mode) };
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
    if (!isBlank(mode.minutes)) {
      const minutes = numberOrNull(mode.minutes);
      if (minutes === null || minutes < 1 || minutes > 600) return `Modus „${label}“: Minuten von 1 bis 600 – oder leer lassen.`;
    }
    if (!isBlank(mode.players_per_side)) {
      const players = numberOrNull(mode.players_per_side);
      if (players === null || players < 1 || players > 64) return `Modus „${label}“: Spieler je Seite von 1 bis 64 – oder leer lassen.`;
    }
    if (String(mode.description || "").trim().length > MODE_DESCRIPTION_MAX) return `Modus „${label}“: Beschreibung höchstens ${MODE_DESCRIPTION_MAX} Zeichen.`;
    const rule = ruleProblem(mode, label);
    if (rule) return rule;
  }
  const points = parsePointsTable(form?.points_table);
  return points.error ? `Punktetabelle: ${points.error}` : "";
}

const count = (number, one, many) => `${number} ${number === 1 ? one : many}`;

/** Die Kennung eines Modus aus seinem Namen - dieselbe Regel wie im Backend (`_game_key` in models.py). */
export function modeKey(label) {
  return String(label || "").normalize("NFKD").replace(/[^\p{ASCII}]/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

/**
 * Darf ein gespeicherter Modus weg (#2206)? `true`: verwendet (Pool, Reihenfolge, Turnier, Spiel …) - nur deaktivieren.
 * `false`: unbenutzt. `null`: noch nicht bekannt (Zählung lädt oder fehlt) - der Server prüft beim Speichern ohnehin.
 */
export function modeInUse(usage, key) {
  const row = usage?.modes?.[key];
  if (!row || typeof row.in_use !== "boolean") return null;
  return row.in_use;
}

/** Welche Modi das Speichern entfernt (#2129): gespeicherte, die im Payload nicht mehr vorkommen - auch wer die Zeile leert. */
export function removedModes(before, payload) {
  const kept = new Set((payload?.match_modes || []).map((mode) => mode.mode || modeKey(mode.label)));
  return (before || []).filter((mode) => mode.mode && !kept.has(mode.mode));
}

/**
 * Die Rückfrage vor dem Entfernen (#2129, SP2) mit der Zahl der betroffenen Maps, aus `GET /games/{id}/usage`. `null`: nichts
 * hängt daran, es braucht keine Frage. Ohne Zählung (Abfrage fehlgeschlagen) wird trotzdem gefragt.
 */
export function modeRemovalQuestion(removed, usage) {
  if (!removed?.length) return null;
  const title = removed.length === 1 ? `Modus „${removed[0].label}“ entfernen?` : `${removed.length} Modi entfernen?`;
  const lasting = "Gespeicherte Map-Pools und gemeldete Ergebnisse bleiben, wie sie sind.";
  if (!usage?.modes) return { title, description: `Die Maps verlieren ${removed.length === 1 ? "diesen Modus" : "diese Modi"}. ${lasting}` };
  const sum = (key) => removed.reduce((total, mode) => total + (usage.modes[mode.mode]?.[key] || 0), 0);
  const maps = sum("maps");
  const pools = sum("pools");
  const seasons = sum("seasons");
  const tournaments = sum("tournaments");
  const stages = sum("stages");
  if (!maps && !pools && !seasons && !tournaments && !stages) return null;
  const one = removed.length === 1;
  const parts = [];
  if (maps) parts.push(`${count(maps, "Map verliert", "Maps verlieren")} ${one ? "diesen Modus" : "diese Modi"} und ${maps === 1 ? "steht" : "stehen"} dafür in neuen Pools nicht mehr zur Wahl. Wird ${one ? "er" : "einer"} wieder angelegt, haben die Maps ihn nicht mehr.`);
  const keeping = [pools ? count(pools, "gespeicherter Map-Pool", "gespeicherte Map-Pools") : "", seasons ? count(seasons, "Season", "Seasons") : ""].filter(Boolean).join(" und ");
  parts.push(keeping ? `${keeping} ${pools + seasons === 1 ? "nutzt" : "nutzen"} ${one ? "ihn" : "sie"} weiter: Laufende Spiele melden unverändert daraus. ${lasting}` : lasting);
  const planning = [tournaments ? count(tournaments, "Turnier", "Turniere") : "", stages ? count(stages, "Phase", "Phasen") : ""].filter(Boolean).join(" und ");
  if (planning) parts.push(`${planning} ${tournaments + stages === 1 ? "plant" : "planen"} mit ${one ? "diesem Modus" : "diesen Modi"} und ${tournaments + stages === 1 ? "nimmt" : "nehmen"} danach den ersten Modus des Spiels.`);
  return { title, description: parts.join(" ") };
}

/** Die Meldung nach dem Speichern - sagt, was mit den Maps passiert ist und welche jetzt keinen Modus haben. */
export function gameSavedText(answer) {
  const parts = ["Spiel gespeichert."];
  if (answer?.maps_cleaned) parts.push(`Modus aus ${count(answer.maps_cleaned, "Map", "Maps")} entfernt.`);
  if (answer?.maps_without_mode) parts.push(`${count(answer.maps_without_mode, "Map hat", "Maps haben")} noch keinen Modus – ordne sie unter Maps zu.`);
  return parts.join(" ");
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
