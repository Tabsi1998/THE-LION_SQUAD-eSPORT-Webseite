// Gesamtwertung über Seasons (F.5, #2215, docs/LIGA.md „F.5 Gesamtwertung über Seasons“): Wörter, Zellen und das Formular der
// Verwaltung. Gerechnet wird auf dem Server (services/league_overall_rules.py) - hier steht nur, was Ligaseite und Verwaltung daraus
// machen, und dieselben Prüfungen wie der Server, damit ein Fehler schon beim Tippen steht.

export const POINTS_MODES = [
  { key: "teams", label: "Nach Teamzahl", hint: "Platz 1 bekommt so viele Punkte, wie die Staffel Teams hat, der Letzte 1. Gezählt je Staffel." },
  { key: "table", label: "Eigene Punkte je Platz", hint: "Du legst die Punkte für Platz 1, 2, 3 … fest. Plätze dahinter bekommen 0." },
];
export const COUNTING = [
  { key: "all", label: "Alle Seasons", hint: "Jede Season des Zeitraums zählt." },
  { key: "best", label: "Nur die besten", hint: "Nur die besten Seasons zählen, die übrigen sind Streichergebnisse." },
];
export const TIEBREAKERS = [
  { key: "wins", label: "Mehr Staffelsiege" },
  { key: "best_place", label: "Bessere beste Platzierung" },
  { key: "latest", label: "Mehr Punkte in der jüngsten Season" },
];
export const METHODS = [
  { key: "playoff", label: "Entscheidungsspiel" },
  { key: "lot", label: "Los" },
  { key: "lead", label: "Entscheid der Leitung" },
];
export const TABLE_MAX = 32;
export const POINTS_MAX = 999;
export const BONUS_MAX = 99;
export const BEST_MAX = 50;
export const PERIOD_LIMIT = 20;
export const PERIOD_NAME_MAX = 60;
export const REASON_MIN = 5;

const whole = (value, low, high) => {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return false;
  const number = Number(text);
  return number >= low && number <= high;
};

/** „1 Punkt“, „6 Punkte“. */
export function pointsWord(value) {
  return `${value} ${Number(value) === 1 ? "Punkt" : "Punkte"}`;
}

/** Eine Season-Zelle als kurzer Text für Screenreader und Titel: „6 Punkte · Platz 1 von 4 · Streichergebnis“. */
export function cellText(cell, seasonName = "Season") {
  if (!cell?.played) return `${seasonName}: nicht dabei`;
  const parts = [`${seasonName}: ${pointsWord(cell.points ?? 0)}`];
  if (cell.exit) parts.push("ausgeschieden");
  else if (cell.place) parts.push(`Platz ${cell.place} von ${cell.of}`);
  if (cell.champion) parts.push("Staffelsieg");
  if (cell.counted === false) parts.push("Streichergebnis");
  if (cell.co_team_name) parts.push(`für ${cell.co_team_name}`);
  return parts.join(" · ");
}

/** Die Zeile unter der Tabelle: wie gerechnet wird. */
export function rulesLine(settings) {
  if (!settings) return "";
  const points = settings.points_mode === "table"
    ? `Punkte je Platz: ${(settings.points_table || []).join(", ") || "–"}`
    : "Punkte nach Teamzahl: Platz 1 bekommt so viele Punkte, wie die Staffel Teams hat, der Letzte 1";
  const bonus = Number(settings.champion_bonus) > 0 ? `, Platz 1 der Staffel +${settings.champion_bonus}` : "";
  const counting = settings.counting === "best" && settings.best_count ? `Es zählen die besten ${settings.best_count} Seasons.` : "Es zählen alle Seasons.";
  return `${points}${bonus}. ${counting}`;
}

/** „Bei Gleichstand: Mehr Staffelsiege, dann …, zuletzt Entscheid der Leitung.“ */
export function tiebreakLine(settings) {
  const labels = (settings?.tiebreakers || []).map((row) => row.label || TIEBREAKERS.find((item) => item.key === row)?.label).filter(Boolean);
  return labels.length ? `Bei Gleichstand: ${labels.join(", dann ")}, zuletzt Entscheid der Leitung.` : "Bei Gleichstand entscheidet die Leitung.";
}

/** Die Seasons der Spalten in der Reihenfolge der Antwort - mit Namen. */
export function seasonColumns(seasons, ids) {
  const byId = Object.fromEntries((seasons || []).map((row) => [row.id, row]));
  return (ids || []).map((id) => ({ id, name: byId[id]?.name || "Season", url: byId[id]?.url || null }));
}

/** Formular der Verwaltung aus der Antwort des Servers. */
export function settingsToForm(body) {
  const settings = body?.settings || {};
  return {
    points_mode: settings.points_mode || "teams",
    points_table: (settings.points_table || []).map(String),
    champion_bonus: String(settings.champion_bonus ?? 2),
    counting: settings.counting || "all",
    best_count: settings.best_count ? String(settings.best_count) : "",
    tiebreakers: [...(settings.tiebreakers || TIEBREAKERS.map((row) => row.key))],
  };
}

/** Was an PUT /overall geht (nur die Punkte-Felder). */
export function settingsPayload(form) {
  return {
    points_mode: form.points_mode,
    points_table: form.points_mode === "table" ? form.points_table.map((value) => Number(value)) : form.points_table.filter((value) => whole(value, 0, POINTS_MAX)).map(Number),
    champion_bonus: Number(form.champion_bonus),
    counting: form.counting,
    best_count: form.counting === "best" ? Number(form.best_count) : null,
    tiebreakers: form.tiebreakers,
  };
}

/** Was im Formular nicht passt - leer heißt: passt. */
export function settingsProblem(form) {
  if (!form) return "";
  if (form.points_mode === "table") {
    if (!form.points_table.length) return "Eigene Punkte: bitte mindestens Platz 1 angeben.";
    if (form.points_table.length > TABLE_MAX) return `Eigene Punkte: höchstens ${TABLE_MAX} Plätze.`;
    const bad = form.points_table.findIndex((value) => !whole(value, 0, POINTS_MAX));
    if (bad >= 0) return `Punkte für Platz ${bad + 1}: eine Zahl von 0 bis ${POINTS_MAX}.`;
  }
  if (!whole(form.champion_bonus, 0, BONUS_MAX)) return `Zusatzpunkte für Platz 1: eine Zahl von 0 bis ${BONUS_MAX}.`;
  if (form.counting === "best" && !whole(form.best_count, 1, BEST_MAX)) return `Wie viele Seasons zählen: eine Zahl von 1 bis ${BEST_MAX}.`;
  return "";
}

/** Die Zeiträume als Formular - je Zeitraum ein stabiler Schlüssel für React. */
export function periodsToForm(periods) {
  return (periods || []).map((row) => ({ key: row.id, id: row.id, name: row.name || "", season_ids: [...(row.season_ids || [])],
    closed_levels: [...(row.closed_levels || [])] }));
}

export function periodsPayload(rows) {
  return rows.map((row) => ({ ...(row.id ? { id: row.id } : {}), name: String(row.name || "").trim(), season_ids: row.season_ids }));
}

/** Prüft die Zeiträume wie der Server: Name, höchstens einer je Season. */
export function periodsProblem(rows, seasonNames = {}) {
  if (rows.length > PERIOD_LIMIT) return `Höchstens ${PERIOD_LIMIT} Zeiträume.`;
  const owner = {};
  for (const row of rows) {
    const name = String(row.name || "").trim();
    if (!name) return "Jeder Zeitraum braucht einen Namen, z. B. „2027“ oder „Seasons 1–4“.";
    for (const id of row.season_ids) {
      if (owner[id]) return `„${seasonNames[id] || "Eine Season"}“ steht schon im Zeitraum „${owner[id]}“ – eine Season gehört zu höchstens einem Zeitraum.`;
      owner[id] = name;
    }
  }
  return "";
}

/** In welchem anderen Zeitraum steht diese Season schon? Für das Häkchen, das dann gesperrt ist. */
export function takenBy(rows, seasonId, ownKey) {
  return rows.find((row) => row.key !== ownKey && row.season_ids.includes(seasonId))?.name || "";
}

/** Den Entscheid prüfen: Reihenfolge, Art und Grund. */
export function decisionProblem(decision) {
  if (!decision?.method) return "Bitte angeben, wie entschieden wurde.";
  if (String(decision.reason || "").trim().length < REASON_MIN) return `Bitte einen Grund mit mindestens ${REASON_MIN} Zeichen angeben.`;
  return "";
}

/** „Endstand seit 12.01.2027 · Fassung 2“ bzw. „Laufende Wertung“. */
export function stateLine(block, formatDate) {
  if (!block?.closed) return "Laufende Wertung – rechnet mit jedem neuen Endstand einer Season neu.";
  const when = block.final?.closed_at && formatDate ? formatDate(block.final.closed_at) : "";
  return `Endstand${when ? ` seit ${when}` : ""}${block.final?.version > 1 ? ` · Fassung ${block.final.version}` : ""}`;
}
