// Schweizer System und Gleichstand in Turnier-Tabellen (#1559): Wörter und Formularwerte für die Einstellungen der
// Turnierleitung, die Erklärung unter der öffentlichen Tabelle und den Stand des Schweizer Systems. Gerechnet wird nur
// auf dem Server (services/graph_swiss.py, services/competition_standings.py) - hier wird beschriftet.

/** Abschlussregel des Schweizer Systems (Server: graph_swiss.END_RULES). */
export const SWISS_END_RULE_OPTIONS = [
  ["rounds", "Feste Rundenzahl"],
  ["wins_losses", "Siege und Niederlagen"],
  ["manual", "Kein festes Ende"],
];

/** Reihenfolge bei Punktgleichheit im Schweizer System (Server: graph_swiss.TIEBREAKERS). */
export const SWISS_TIEBREAK_LABELS = {
  median_buchholz: "Median-Buchholz",
  buchholz: "Buchholz",
  head_to_head: "Direkter Vergleich",
  wins: "Mehr Siege",
};
export const SWISS_TIEBREAK_KEYS = Object.keys(SWISS_TIEBREAK_LABELS);

/** Reihenfolge bei Punktgleichheit in Gruppen und „Jeder gegen jeden“ (Server: competition_standings.TOURNAMENT_TABLE_TIEBREAKERS). */
export const TABLE_TIEBREAK_LABELS = {
  head_to_head: "Direkter Vergleich",
  score_diff: "Differenz",
  score_for: "Mehr erzielt",
  wins: "Mehr Siege",
};
export const TABLE_TIEBREAK_KEYS = Object.keys(TABLE_TIEBREAK_LABELS);
/** Was an einer Zeile steht, wenn ein Kriterium den Platz entschied - für jede Turnier-Tabelle dieselben Wörter. */
export const TOURNAMENT_TIEBREAK_LABELS = { ...SWISS_TIEBREAK_LABELS, ...TABLE_TIEBREAK_LABELS };

// So rechnet ein Turnier ohne gespeicherte Einstellung (Stand vor #1559) - das Formular zeigt es, ändert aber nichts,
// solange niemand etwas anklickt.
export const SWISS_BEFORE = Object.freeze({
  end_rule: "manual", rounds: "", top_n: "", wins_to_advance: "3", losses_to_exit: "3", auto_next_round: false,
  tiebreakers: ["buchholz", "wins"],
});
export const TABLE_BEFORE = Object.freeze(["wins", "score_diff"]);

// Vorgabe für neue Turniere - alles bleibt änderbar.
export const SWISS_RECOMMENDED = Object.freeze({
  end_rule: "rounds", rounds: "", top_n: "", wins_to_advance: "3", losses_to_exit: "3", auto_next_round: true,
  tiebreakers: ["median_buchholz", "buchholz", "head_to_head", "wins"],
});
export const TABLE_RECOMMENDED = Object.freeze(["head_to_head", "score_diff", "score_for", "wins"]);

const TABLE_TIEBREAK_FORMATS = new Set(["groups", "round_robin", "league"]);
const MAX_ROUNDS = 30;
const MAX_RECORD = 20;

/** Hat dieses Format die Einstellung „Bei Punktgleichheit“ für Tabellen? (Gruppenphase, Jeder gegen jeden) */
export function usesTableTiebreakers(format) {
  return TABLE_TIEBREAK_FORMATS.has(format);
}

const text = (value) => (value == null ? "" : String(value));

/** Die gespeicherten Schweizer Einstellungen als Formularwerte - ohne Einstellung `fallback`. */
export function swissForm(settings, fallback = SWISS_BEFORE) {
  if (!settings || typeof settings !== "object") return { ...fallback, tiebreakers: [...fallback.tiebreakers] };
  return {
    end_rule: settings.end_rule || "manual",
    rounds: text(settings.rounds),
    top_n: text(settings.top_n),
    wins_to_advance: text(settings.wins_to_advance ?? 3),
    losses_to_exit: text(settings.losses_to_exit ?? 3),
    auto_next_round: Boolean(settings.auto_next_round),
    tiebreakers: Array.isArray(settings.tiebreakers) ? [...settings.tiebreakers] : [...SWISS_BEFORE.tiebreakers],
  };
}

const whole = (value) => {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && String(value).trim() !== "" ? number : null;
};

/** Die Formularwerte zurück in `swiss_settings` - `null` bleibt `null` (nichts gewählt, nichts ändern). */
export function swissPayload(form) {
  if (!form) return null;
  return {
    end_rule: form.end_rule || "manual",
    rounds: whole(form.rounds),
    top_n: whole(form.top_n),
    wins_to_advance: whole(form.wins_to_advance) ?? 3,
    losses_to_exit: whole(form.losses_to_exit) ?? 3,
    auto_next_round: Boolean(form.auto_next_round),
    tiebreakers: [...(form.tiebreakers || [])],
  };
}

const outside = (value, minimum, maximum) => {
  const number = Number(value);
  return !Number.isInteger(number) || number < minimum || number > maximum;
};

/** Was an den Zahlen nicht passt - leer, wenn alles passt. Geprüft wird nur, was zur gewählten Regel gehört. */
export function swissFormError(form) {
  if (!form) return "";
  if (form.end_rule === "rounds") {
    if (text(form.rounds).trim() !== "" && outside(form.rounds, 1, MAX_ROUNDS)) return `Schweizer System: Runden bitte zwischen 1 und ${MAX_ROUNDS} – oder leer lassen.`;
    if (text(form.top_n).trim() !== "" && outside(form.top_n, 1, 4096)) return "Schweizer System: „So viele kommen weiter“ bitte ab 1 – oder leer lassen.";
  }
  if (form.end_rule === "wins_losses") {
    if (outside(form.wins_to_advance, 1, MAX_RECORD)) return `Schweizer System: Siege zum Weiterkommen bitte zwischen 1 und ${MAX_RECORD}.`;
    if (outside(form.losses_to_exit, 1, MAX_RECORD)) return `Schweizer System: Niederlagen zum Ausscheiden bitte zwischen 1 und ${MAX_RECORD}.`;
  }
  return "";
}

/** So viele Runden braucht ein Feld, bis höchstens einer ungeschlagen ist (Server: graph_swiss.recommended_rounds). */
export function recommendedSwissRounds(participants) {
  const count = Math.max(2, Number(participants) || 0);
  return Math.max(1, Math.ceil(Math.log2(count)));
}

const count = (number, one, many) => `${number} ${Number(number) === 1 ? one : many}`;

/** Die Abschlussregel in einem Satz für Teilnehmer - leer ohne festes Ende. */
export function swissRuleText(settings) {
  if (!settings) return "";
  if (settings.end_rule === "rounds") {
    if (!settings.rounds) return "Die Zahl der Runden richtet sich nach der Größe des Felds.";
    const rounds = Number(settings.rounds) === 1 ? "Gespielt wird 1 Runde." : `Gespielt werden ${settings.rounds} Runden.`;
    return settings.top_n ? `${rounds} Die besten ${settings.top_n} kommen weiter.` : rounds;
  }
  if (settings.end_rule === "wins_losses") {
    const wins = settings.wins_to_advance ?? 3;
    const losses = settings.losses_to_exit ?? 3;
    return `Wer ${count(wins, "Sieg", "Siege")} hat, ist weiter. Wer ${count(losses, "Niederlage", "Niederlagen")} hat, ist raus.`;
  }
  return "";
}

/** „Punkte → Direkter Vergleich → Differenz“ - `kind`: „swiss“ oder „table“. */
export function tiebreakOrderText(keys, kind = "table") {
  const labels = kind === "swiss" ? SWISS_TIEBREAK_LABELS : TABLE_TIEBREAK_LABELS;
  return ["Punkte", ...(keys || []).map((key) => labels[key]).filter(Boolean)].join(" → ");
}

const EXPLANATIONS = {
  median_buchholz: "Median-Buchholz: die Punkte der bisherigen Gegner ohne den besten und den schlechtesten.",
  buchholz: "Buchholz: die Punkte aller bisherigen Gegner – wer stärkere Gegner hatte, steht vorn.",
};

/**
 * Was unter der öffentlichen Tabelle steht: die Abschlussregel (Schweizer System), die Reihenfolge bei Punktgleichheit und
 * kurz, was die Begriffe heißen. `kind`: lib/standingsTable.tableKind. Leer bei K.-o. und Läufen - und in einer
 * Liga-Staffel, die ihre Regeln auf der Ligaseite nennt.
 */
export function tableRuleLines(tournament, kind) {
  if (!tournament || tournament.league_context || tournament.scoring_rules) return [];
  const lines = [];
  if (kind === "swiss" || kind === "swiss_median") {
    const settings = tournament.swiss_settings || null;
    const keys = Array.isArray(settings?.tiebreakers) ? settings.tiebreakers : SWISS_BEFORE.tiebreakers;
    const rule = swissRuleText(settings);
    if (rule) lines.push({ key: "rule", text: rule });
    lines.push({ key: "order", text: `Reihenfolge: ${tiebreakOrderText(keys, "swiss")}` });
    for (const key of ["median_buchholz", "buchholz"]) if (keys.includes(key)) lines.push({ key, text: EXPLANATIONS[key] });
    if (keys.includes("head_to_head")) lines.push({ key: "head_to_head", text: "Direkter Vergleich: das Spiel gegeneinander – zählt nur, wenn sich alle Punktgleichen getroffen haben." });
    return lines;
  }
  if (kind !== "league") return [];
  const keys = Array.isArray(tournament.table_tiebreakers) ? tournament.table_tiebreakers : TABLE_BEFORE;
  lines.push({ key: "order", text: `Reihenfolge: ${tiebreakOrderText(keys, "table")}` });
  if (keys.includes("head_to_head")) lines.push({ key: "head_to_head", text: "Direkter Vergleich: nur die Spiele der Punktgleichen untereinander – zählt, sobald sie alle gespielt sind." });
  return lines;
}

/** Der Stand des Schweizer Systems für die Turnierleitung (`swiss` aus GET /bracket) - leer ohne Angabe. */
export function swissStateText(swiss) {
  if (!swiss) return "";
  const played = Number(swiss.rounds_played) || 0;
  const tally = `${swiss.advanced} weiter, ${swiss.eliminated} raus`;
  if (swiss.complete) {
    return swiss.end_rule === "wins_losses"
      ? `Schweizer System abgeschlossen: ${tally}`
      : `Schweizer System abgeschlossen: alle ${swiss.rounds_total ?? played} Runden gespielt`;
  }
  if (!played) return "Noch keine Runde · die erste startest du mit „Schweizer Runde“";
  const parts = [`Runde ${played}${swiss.rounds_total ? ` von ${swiss.rounds_total}` : ""} ${swiss.round_open ? "läuft" : "ist gewertet"}`];
  if (swiss.end_rule === "wins_losses") parts.push(`${tally}, ${swiss.active} offen`);
  if (swiss.auto_next_round) parts.push("die nächste Runde entsteht automatisch");
  else if (!swiss.round_open) parts.push("die nächste Runde startest du mit „Schweizer Runde“");
  return parts.join(" · ");
}

/** Hinweis an einer Zeile der Schweizer Tabelle: weiter oder ausgeschieden nach der Abschlussregel - sonst `null`. */
export function swissStatusNote(row) {
  if (row?.swiss_status === "advanced") return { key: "swiss", tone: "advance", text: "Weiter", title: "Nach der Abschlussregel weiter" };
  if (row?.swiss_status === "eliminated") return { key: "swiss", tone: "exit", text: "Ausgeschieden", title: "Nach der Abschlussregel ausgeschieden" };
  return null;
}
