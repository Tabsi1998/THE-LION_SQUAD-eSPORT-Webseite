// Vorfälle im Spiel auf der Matchseite (D.5, #1619; docs/LIGA.md „D.5/E.2-Vertrag“ → „Vorfälle“; Regelwerk § 9, Anlage C):
// Sätze, Auswahl und Prüfung im Klartext, damit Captains ohne Vorwissen melden und antworten können. Stand, Fristen, Rechte und
// Kontingent kommen vom Server (Block `league`: `map_state`, `incidents`, `incident_info`) - hier wird nur formuliert.
import { viennaTime } from "@/lib/vienna";

export const STATE_LABELS = {
  proposed: "Wartet auf Antwort",
  agreed: "Einig",
  in_review: "In Klärung",
  decided: "Entschieden",
  withdrawn: "Zurückgezogen",
  // Ohne Einigung und ohne Entscheidung: das Spiel ist zu Ende, oder die Liga-Leitung hat den Vorfall geschlossen.
  closed: "Geschlossen",
};

// Was passiert ist - je Art ein Satz, wann sie passt. `pause_between` ist die Map-Pause (nur dokumentiert).
export const KIND_HELP = {
  disconnect: "Ein Spieler ist aus der Lobby geflogen oder hat die Verbindung verloren.",
  rehost: "Die Lobby musste neu aufgemacht werden.",
  pause: "Technische Pause während der Map, etwa wegen Hardware oder Netz.",
  moss_crash: "MOSS ist abgestürzt (PC). Zählt nie gegen das Kontingent.",
  restart_early: "Abbruch ganz am Anfang, bevor die erste Runde lief oder der erste Punkt fiel.",
  replay: "Die Map soll neu gespielt werden.",
  other: "Etwas anderes – bitte kurz beschreiben.",
};
export const PAUSE_BETWEEN = "pause_between";
export const PAUSE_BETWEEN_LABEL = "Pause zwischen den Maps";
export const PAUSE_BETWEEN_HELP = "Ihr habt zwischen zwei Maps länger oder kürzer pausiert als üblich. Wird nur festgehalten – niemand muss antworten.";

export const PROPOSAL_HELP = {
  continue_at_score: "Es geht beim letzten nachweisbaren Stand weiter.",
  rehost: "Neue Lobby, weiter beim letzten nachweisbaren Stand.",
  restart: "Die Map beginnt neu bei 0:0 – nur, wenn noch nichts Spielwirksames passiert ist.",
  replay: "Die ganze Map wird wiederholt. Die erste Austragung zählt dann nicht.",
};

export const OUTCOME_HELP = {
  ...PROPOSAL_HELP,
  awarded: "Die Map wird einer Seite zugesprochen und zählt ohne Punkte.",
  no_action: "Es bleibt bei dem, was gespielt und gemeldet wurde.",
};

/** „20:14“ in Wiener Zeit. */
export function clock(value) {
  return value ? viennaTime(value, { hour: "2-digit", minute: "2-digit" }) : "";
}

/** Wie viel die Uhr des Geräts von der des Servers abweicht (ms) - der Countdown rechnet mit der Serverzeit. */
export function clockOffset(serverTime, now = Date.now()) {
  const server = serverTime ? Date.parse(serverTime) : NaN;
  return Number.isFinite(server) ? server - now : 0;
}

/** Restzeit bis zur Antwortfrist in Millisekunden, nie negativ. */
export function remainingMs(deadline, now = Date.now(), offset = 0) {
  const end = deadline ? Date.parse(deadline) : NaN;
  return Number.isFinite(end) ? Math.max(0, end - (now + offset)) : 0;
}

/** „4:07“ - Minuten und Sekunden. */
export function remainingText(ms) {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Anteil der Antwortzeit, der noch läuft (1 = eben gemeldet, 0 = vorbei) - für den Balken. */
export function remainingShare(incident, now = Date.now(), offset = 0) {
  const start = incident?.at ? Date.parse(incident.at) : NaN;
  const end = incident?.answer_deadline ? Date.parse(incident.answer_deadline) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.min(1, Math.max(0, (end - (now + offset)) / (end - start)));
}

/** „3:4“ in der Reihenfolge der Seiten - leer ohne Stand. */
export function scoreText(score, sides = []) {
  if (!score) return "";
  const values = sides.map((side) => score[side.registration_id]);
  return values.every((value) => value !== undefined && value !== null) ? values.join(":") : "";
}

/** Der Name der Map dieser Position, wenn das Veto sie festgelegt hat - sonst „Map 2“. */
export function positionLabel(league, position) {
  const planned = (league?.planned_games || []).find((row) => Number(row.position) === Number(position));
  return planned?.map_name ? `Map ${position} · ${planned.map_name}` : `Map ${position}`;
}

/** Wie viele Rehosts und Pausen eine Seite auf einer Map schon genutzt hat. */
export function quotaUsed(info, registrationId, position) {
  const row = (info?.quota?.used || []).find((item) => item.registration_id === registrationId && Number(item.position) === Number(position));
  return Number(row?.count || 0);
}

/** „1 von 1 genutzt“ - das Kontingent je Team und Map (§ 9.6). */
export function quotaText(info, registrationId, position) {
  return `${quotaUsed(info, registrationId, position)} von ${Number(info?.quota?.limit ?? 1)} genutzt`;
}

/** Zählt diese Art gegen das Kontingent? Rehost und technische Pause - nie der MOSS-Absturz, nie die Map-Pause. */
export function countsQuota(kind) {
  return kind === "rehost" || kind === "pause";
}

/** Der Hinweis im Formular, sobald das Kontingent der eigenen Seite auf dieser Map aufgebraucht ist. Nichts wird verweigert. */
export function quotaHint(info, registrationId, position, kind) {
  if (!registrationId || !countsQuota(kind)) return "";
  const limit = Number(info?.quota?.limit ?? 1);
  const used = quotaUsed(info, registrationId, position);
  if (used < limit) return `Zählt gegen euer Kontingent auf dieser Map: bisher ${used} von ${limit} genutzt.`;
  return `Euer Kontingent auf dieser Map ist aufgebraucht (${used} von ${limit}). Ihr könnt trotzdem melden – es braucht die Zustimmung der Gegenseite, sonst entscheidet die Liga-Leitung.`;
}

/**
 * Der Hinweis über den Vorfällen: nur, was an keiner Karte steht - nach Neustart oder Wiederholung „Map N wird wiederholt, danach
 * meldet ihr die Serie neu“. Alles andere, was ein Ergebnis aufhält, sagt die Karte selbst (Abzeichen, Antwortzeit, Feststellung).
 */
export function holdNotice(info) {
  return info?.hold?.code === "rereport" ? info.hold.text : "";
}

/** Der eine Vorfall, dessen Abzeichen „In Klärung“ atmet - höchstens ein Element bewegt sich. */
export function pulsingIncidentId(incidents = []) {
  return incidents.find((incident) => incident.state === "in_review")?.id || null;
}

/** Was öffentlich zu einer Position steht: „in Klärung“ oder „zählt nicht“. „Map wiederholt“ zeigt die Map selbst. */
export function mapStateNotes(league) {
  return (league?.map_state || []).flatMap((row) => {
    if (row.state === "in_clarification") return [{ position: row.position, kind: "clarification", text: `Map ${row.position} ist in Klärung` }];
    if (row.surplus) return [{ position: row.position, kind: "surplus", text: `Map ${row.position} zählt nicht (Entscheidung der Liga-Leitung)` }];
    return [];
  });
}

// Warum die Leitung entscheidet - ohne den Stand zu wiederholen: „In Klärung“ steht am Abzeichen der Karte und an der Map.
const REVIEW_CAUSE = {
  rejected: "Die Gegenseite hat abgelehnt.",
  expired: "Keine Antwort in der Antwortzeit.",
  lead: "Von der Liga-Leitung aufgenommen.",
};
// Was die Serie solange tut - je nach Einstellung der Season (`clarification_mode`).
const SERIES_MEANWHILE = {
  continue: "Die Serie läuft unter Vorbehalt weiter, gewertet wird nach der Entscheidung.",
  pause_series: "Die Serie pausiert: Spätere Maps meldet ihr erst nach der Entscheidung.",
};

/**
 * Der eine Satz zu einem Vorfall: was gilt und wer jetzt dran ist. Jede Angabe steht an einer Stelle - die Uhrzeit der Frist nur am
 * Countdown, „In Klärung“ nur am Abzeichen. `otherName`: die Seite, die antworten muss; `ownSide`: die Person gehört zu einer Seite;
 * `mode`: wie die Serie bei einer Map in Klärung weitergeht.
 */
export function stateSentence(incident, { otherName = "die Gegenseite", ownSide = false, mode = "" } = {}) {
  if (!incident) return "";
  if (incident.between_maps) return `Pause von ${Number(incident.minutes || 0)} Minuten nach Map ${incident.position} – nur festgehalten.`;
  switch (incident.state) {
    case "proposed":
      if (incident.expired) return "Die Antwortzeit ist vorbei – der Vorfall geht an die Liga-Leitung.";
      if (incident.can_answer) return "Ihr seid dran: stimmt zu oder lehnt ab.";
      if (incident.reported_by?.own) return "Die Gegenseite antwortet noch.";
      // Mitglied der Seite, die antworten muss, ohne selbst handeln zu dürfen - oder die Liga-Leitung.
      return ownSide ? "Euer Captain oder Vertreter ist dran: zustimmen oder ablehnen." : `${otherName} antwortet noch.`;
    case "agreed":
      return `Beide Seiten sind sich einig: ${incident.proposal_label || "wie vorgeschlagen"}.`;
    case "in_review":
      return [REVIEW_CAUSE[incident.review_cause], SERIES_MEANWHILE[mode]].filter(Boolean).join(" ");
    case "decided":
      return `Entscheidung der Liga-Leitung: ${incident.decision?.outcome_label || "entschieden"}${incident.decision?.awarded_to ? ` (${incident.decision.awarded_to})` : ""}.`;
    case "withdrawn":
      return "Zurückgezogen – es ist nichts weiter zu tun.";
    case "closed":
      return incident.close_reason === "lead" ? "Die Liga-Leitung hat den Vorfall ohne Entscheidung geschlossen."
        : "Das Spiel ist zu Ende – der Vorfall wurde ohne Entscheidung geschlossen.";
    default:
      return "";
  }
}

/** Was nach der Entscheidung noch zur Serie gilt - leer, solange es keine Entscheidung gibt. */
export function settleSentence(decision) {
  if (!decision) return "";
  if (!decision.settled_at) return "Die Serie ist noch nicht festgestellt – bis dahin gilt kein Ergebnis.";
  const missing = decision.missing_positions || [];
  const surplus = decision.surplus_positions || [];
  if (missing.length) return `Serie festgestellt: Es fehlt noch Map ${missing.join(", ")}.`;
  if (surplus.length) return `Serie festgestellt: Map ${surplus.join(", ")} zählt nicht.`;
  return "Serie festgestellt – es fehlt keine Map.";
}

export function emptyIncidentForm(info) {
  return { position: "", kind: "", proposal: "", scores: {}, round: "", players: [], note: "", minutes: String(info?.break_minutes ?? 5) };
}

const whole = (value) => /^\d+$/.test(String(value ?? "").trim());

/** Der erste Satz, der fehlt - leer, wenn die Meldung so abgeschickt werden kann. */
export function incidentProblem(form, sides = []) {
  if (!form.position) return "Bitte wählen, um welche Map es geht.";
  if (!form.kind) return "Bitte wählen, was passiert ist.";
  if (form.kind === PAUSE_BETWEEN) {
    return whole(form.minutes) && Number(form.minutes) <= 120 ? "" : "Bitte die Länge der Pause in Minuten angeben (0 bis 120).";
  }
  const given = sides.filter((side) => String(form.scores?.[side.registration_id] ?? "").trim() !== "");
  if (given.length && (given.length !== sides.length || given.some((side) => !whole(form.scores[side.registration_id])))) {
    return "Bitte den Stand beider Seiten als ganze Zahl angeben – oder beide Felder leer lassen.";
  }
  if (String(form.round ?? "").trim() !== "" && !whole(form.round)) return "Die Runde ist eine ganze Zahl.";
  if (!form.proposal) return "Bitte einen Vorschlag wählen, wie es weitergeht.";
  if (form.kind === "other" && String(form.note || "").trim().length < 5) return "Bitte kurz beschreiben, was passiert ist (mindestens fünf Zeichen).";
  return "";
}

/** Die Anfrage an POST /matches/{id}/incidents aus dem Formular. */
export function incidentPayload(form, sides = []) {
  const position = Number(form.position);
  if (form.kind === PAUSE_BETWEEN) return { position, kind: "pause", between_maps: true, minutes: Number(form.minutes), note: String(form.note || "").trim() || null };
  const given = sides.every((side) => String(form.scores?.[side.registration_id] ?? "").trim() !== "");
  return {
    position,
    kind: form.kind,
    proposal: form.proposal,
    score: given && sides.length ? Object.fromEntries(sides.map((side) => [side.registration_id, Number(form.scores[side.registration_id])])) : null,
    round: String(form.round ?? "").trim() === "" ? null : Number(form.round),
    players: form.players || [],
    note: String(form.note || "").trim() || null,
  };
}

/** Darf die Serie gleich mit der Entscheidung festgestellt werden? Nach Neustart oder Wiederholung wird erst gespielt. */
export function canSettleAtOnce(outcome) {
  return Boolean(outcome) && outcome !== "restart" && outcome !== "replay";
}

/** Der erste Satz, der an der Entscheidung fehlt. */
export function decisionProblem(form) {
  if (!form.outcome) return "Bitte wählen, wie entschieden wird.";
  if (form.outcome === "awarded" && !form.registration_id) return "Bitte die Seite wählen, der die Map zugesprochen wird.";
  if (String(form.reason || "").trim().length < 5) return "Bitte die Entscheidung begründen (mindestens fünf Zeichen).";
  return "";
}

/** Der erste Satz, der an der Feststellung fehlt. */
export function settleProblem(form) {
  const missing = form.missing_positions || [];
  const surplus = form.surplus_positions || [];
  if (missing.some((position) => surplus.includes(position))) return "Eine Map kann nicht zugleich fehlen und überzählig sein.";
  if (String(form.reason || "").trim().length < 5) return "Bitte die Feststellung begründen (mindestens fünf Zeichen).";
  return "";
}

/** Der erste Satz, der am Schließen fehlt. */
export function closeProblem(form) {
  return String(form.reason || "").trim().length < 5 ? "Bitte begründen, warum du den Vorfall schließt (mindestens fünf Zeichen)." : "";
}

/** Offene Vorfälle zuerst, darin die neuesten oben - Abgeschlossenes danach. */
export function sortedIncidents(incidents = []) {
  return [...incidents].sort((a, b) => (Number(b.open) - Number(a.open)) || String(b.at || "").localeCompare(String(a.at || "")));
}
