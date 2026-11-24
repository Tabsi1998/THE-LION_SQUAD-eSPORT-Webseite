// Playoffs und Relegation (#2404, docs/LIGA.md „F.6 Playoffs und Relegation“): Texte und kleine Rechnungen für das Cockpit im Reiter
// „Abschluss“ und für die Ligaseite. Was gilt und was geht, sagt der Server - hier steht nur, wie es heißt.

export const REASON_MIN = 5;
export const KIND_LABELS = { playoff: "Playoffs", relegation: "Relegation" };
export const PLAYOFF_PLACE = "Playoff-Platz";

const STATES = {
  waiting: { key: "blocked", label: "Wartet" },
  ready: { key: "ready", label: "Bereit zum Anlegen" },
  created: { key: "running", label: "Angelegt" },
  closed: { key: "closed", label: "Abgeschlossen" },
};

/** Stand der Playoffs bzw. der Relegation einer Liga: wartet, bereit, angelegt, abgeschlossen. */
export function partState(part) {
  return STATES[part?.state] || STATES.waiting;
}

/** „31.03.“ aus „2031-03-31“ - ein Kalendertag ohne Uhrzeit, darum ohne Zeitzone gerechnet. */
export function shortDay(value) {
  const [year, month, day] = String(value || "").slice(0, 10).split("-");
  return year && month && day ? `${day}.${month}.` : "";
}

/** „31.03.2031“ aus „2031-03-31“. */
export function fullDay(value) {
  const [year, month, day] = String(value || "").slice(0, 10).split("-");
  return year && month && day ? `${day}.${month}.${year}` : "";
}

/** „31.03.–06.04.2031“ - die Woche einer Runde. */
export function weekRange(start, end) {
  if (!start || !end) return fullDay(start || end);
  return `${shortDay(start)}–${fullDay(end)}`;
}

/** „Staffel A · Platz 2“ - woher ein Team in der Setzliste kommt. */
export function seedOrigin(row) {
  return [row?.staffel ? `Staffel ${row.staffel}` : "", row?.rank ? `Platz ${row.rank}` : ""].filter(Boolean).join(" · ");
}

const TIE_TEXT = { ppg: "mehr Punkte je Spiel", map_diff: "bessere Map-Differenz je Spiel", lot: "Los" };

/** Warum diese Staffel vor der nächsten steht - leer, wenn nichts zu erklären ist (die erste Staffel, eine einzige Staffel). */
export function tieText(row) {
  return TIE_TEXT[row?.tie] || "";
}

/** Eine Paarung der ersten Runde: „1 Probe A – 4 Probe D“, mit Freilos. */
export function pairingLine(pair) {
  const side = (entry) => (entry ? `${entry.seed} ${entry.display_name}` : "Freilos");
  return `${side(pair?.a)} – ${side(pair?.b)}`;
}

/** „Viertelfinale · Best of 3 · 31.03.–06.04.2031“. */
export function roundLine(round) {
  return [round?.label, round?.best_of ? `Best of ${round.best_of}` : "", weekRange(round?.start_day, round?.end_day)].filter(Boolean).join(" · ");
}

/** Kurzer Satz zu den Playoffs einer Liga: „4 je Staffel · Best of 3 · Platz 3 geteilt · Heimrecht: besser Gesetzter“. */
export function playoffLine(settings) {
  const playoffs = settings?.playoffs;
  if (!playoffs?.enabled) return "Keine Playoffs";
  return [
    `${playoffs.per_staffel} je Staffel`,
    `Best of ${playoffs.best_of}`,
    ...(playoffs.best_of_rounds || []).map((row) => `Runde ${row.round}: Best of ${row.best_of}`),
    playoffs.third_place ? "Spiel um Platz 3" : "Platz 3 geteilt",
    playoffs.home === "draw" ? "Team A per Los" : "Heimrecht: besser Gesetzter",
  ].join(" · ");
}

/** Kurzer Satz zur Relegation einer Liga gegen die darunter. */
export function relegationLine(row) {
  const relegation = row?.settings?.relegation;
  if (!relegation?.enabled) return "Keine Relegation";
  if (!row?.has_lower) return "Unterste Liga: keine Relegation nach unten";
  return [`gegen ${row.lower_label}`, `Best of ${relegation.best_of}`, "ein Spiel je Paarung", "Heimrecht: Team der oberen Liga"].join(" · ");
}

/** „Meister aus der Tabelle“ bzw. „… aus den Playoffs“. */
export function championLine(settings) {
  return settings?.champion_source === "playoffs" ? "Meister aus den Playoffs" : "Meister aus der Tabelle";
}

/** Die Einstellungen als Formular: leere Felder heißen „wie die Vorgabe“. */
export function formOf(settings) {
  const playoffs = settings?.playoffs || {};
  const relegation = settings?.relegation || {};
  return {
    playoffs: {
      enabled: Boolean(playoffs.enabled), per_staffel: playoffs.per_staffel ? String(playoffs.per_staffel) : "",
      best_of: playoffs.best_of ? String(playoffs.best_of) : "", third_place: Boolean(playoffs.third_place), home: playoffs.home || "better_seed",
      start_date: playoffs.start_date || "", best_of_rounds: (playoffs.best_of_rounds || []).map((row) => ({ round: String(row.round), best_of: String(row.best_of) })),
    },
    relegation: { enabled: Boolean(relegation.enabled), best_of: relegation.best_of ? String(relegation.best_of) : "", start_date: relegation.start_date || "" },
    champion_source: settings?.champion_source || "table",
    reopen_guard: settings?.reopen_guard || "hint",
  };
}

const number = (value) => (value === "" || value === null || value === undefined ? null : Number(value));

function playoffsBody(form) {
  return {
    enabled: Boolean(form.enabled), per_staffel: number(form.per_staffel), best_of: number(form.best_of), third_place: Boolean(form.third_place),
    home: form.home || "better_seed", start_date: form.start_date || null,
    best_of_rounds: (form.best_of_rounds || []).filter((row) => row.round && row.best_of).map((row) => ({ round: Number(row.round), best_of: Number(row.best_of) })),
  };
}

function relegationBody(form) {
  return { enabled: Boolean(form.enabled), best_of: number(form.best_of), start_date: form.start_date || null };
}

/** Der Körper für die Vorlage der Season. */
export function seasonBody(form) {
  return { playoffs: playoffsBody(form.playoffs), relegation: relegationBody(form.relegation), champion_source: form.champion_source, reopen_guard: form.reopen_guard };
}

/** Der Körper für die Abweichung einer Liga: nur die Teile, die sie selbst trägt - ohne eigenen Teil leer („wie die Season“). */
export function divisionBody(form, own) {
  return { ...(own.playoffs ? { playoffs: playoffsBody(form.playoffs) } : {}), ...(own.relegation ? { relegation: relegationBody(form.relegation) } : {}) };
}

/** Fehlt im Formular noch etwas? Der Satz dazu - leer, wenn gespeichert werden kann. Der Server prüft alles noch einmal. */
export function formProblem(form) {
  if (form.playoffs.enabled && !(Number(form.playoffs.per_staffel) >= 1)) return "Bitte angeben, wie viele Teams je Staffel in die Playoffs kommen.";
  const rounds = (form.playoffs.best_of_rounds || []).filter((row) => row.round || row.best_of);
  if (rounds.some((row) => !row.round || !row.best_of)) return "Best of je Runde: bitte Runde und Best of wählen oder die Zeile entfernen.";
  if (new Set(rounds.map((row) => row.round)).size !== rounds.length) return "Best of je Runde: jede Runde höchstens einmal.";
  return "";
}

/** „Wird beim Anlegen gelost: Probe A, Probe B“ - die Vorschau lost nie selbst. */
export function lotLine(groups) {
  const rows = (groups || []).filter((group) => group?.length > 1);
  if (!rows.length) return "";
  return `Steht gleich und wird beim Anlegen gelost: ${rows.map((group) => group.join(", ")).join(" · ")}`;
}

/** Was im Reiter „Abschluss“ über noch fehlende Staffeln steht: „Noch nicht angelegt: …“. */
export function missingLine(missing) {
  return (missing || []).map((row) => row.text).join(" ");
}

/** Ein Platz im Endstand der Playoffs: „1“, „3“, bei unvergebenem Titel „–“. */
export function placeText(row) {
  return Number(row?.rank) > 0 ? String(row.rank) : "–";
}

/** Was hinter einem Team im Endstand der Playoffs steht: „Finale“, „Halbfinale“ - mit „zurückgezogen“ bzw. „disqualifiziert“. */
export function reachedText(row) {
  const exit = { withdrawn: "zurückgezogen", disqualified: "disqualifiziert" }[row?.exit?.kind];
  return [row?.reached, exit].filter(Boolean).join(" · ");
}

const RESULT = { won: "gewonnen", lost: "verloren", none: "nicht gespielt" };

/** Eine Zeile der Relegation: „Oben · gewonnen · bleibt“. */
export function relegationRowText(row) {
  return [row?.side === "upper" ? "obere Liga" : "untere Liga", RESULT[row?.result] || "", row?.outcome_label].filter(Boolean).join(" · ");
}

/** „Playoffs“ bzw. „Relegation“ zu einer Staffel-Zusammenfassung mit Art - sonst leer. */
export function kindLabel(row) {
  return row?.label || KIND_LABELS[row?.kind] || "";
}

/** Stand einer Paarung der Relegation auf der Ligaseite: wer gewonnen hat und was daraus folgt - oder dass noch gespielt wird. */
export function relegationPairState(pair) {
  if (pair?.void) return "Nicht gespielt – beide bleiben in ihrer Liga.";
  if (!pair?.decided) return "Noch nicht gespielt";
  if (pair.lower?.won) return `${pair.lower.display_name} steigt auf, ${pair.upper.display_name} steigt ab.`;
  return `${pair.upper?.display_name} bleibt in ${pair.upper?.division_label}, ${pair.lower?.display_name} in ${pair.lower?.division_label}.`;
}
