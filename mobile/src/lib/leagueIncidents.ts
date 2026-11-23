// Vorfälle im Spiel (D.5, #1619; App #2173): Sätze, Auswahl und Prüfung wie frontend/src/lib/leagueIncidents.js, damit Captain und
// Vertreter ohne Vorwissen melden und antworten können. Stand, Fristen, Rechte und Kontingent kommen vom Server (Block `league`:
// `map_state`, `incidents`, `incident_info`) - hier wird nur formuliert. Entscheiden, Feststellen und Schließen der Liga-Leitung
// bleiben im Web.
import { viennaTime } from "./vienna";

export type IncidentSide = { registration_id: string; name?: string | null };
export type Incident = {
  id: string;
  position: number;
  kind?: string | null;
  kind_label?: string | null;
  state?: string | null;
  open?: boolean;
  at?: string | null;
  answer_deadline?: string | null;
  expired?: boolean;
  between_maps?: boolean;
  minutes?: number | null;
  reported_by?: { registration_id?: string | null; name?: string | null; own?: boolean } | null;
  proposal?: string | null;
  proposal_label?: string | null;
  score?: Record<string, number | null> | null;
  round?: number | null;
  players?: Array<{ id?: string; name?: string | null }> | null;
  counts_quota?: boolean;
  note?: string | null;
  answer?: { note?: string | null; name?: string | null } | null;
  review_cause?: string | null;
  decision?: {
    outcome?: string | null; outcome_label?: string | null; awarded_to?: string | null; reason?: string | null; settled_at?: string | null;
    settled_by_result?: boolean; missing_positions?: number[]; surplus_positions?: number[]; settle_reason?: string | null;
  } | null;
  close_note?: string | null;
  close_reason?: string | null;
  voided?: { score?: Record<string, number | null> | null } | null;
  procedure?: unknown;
  can_answer?: boolean;
  can_withdraw?: boolean;
  can_decide?: boolean;
  can_settle?: boolean;
  can_close?: boolean;
};
export type IncidentInfo = {
  can_report?: boolean;
  as_lead?: boolean;
  can_decide?: boolean;
  kinds?: Array<{ key: string; label: string }>;
  proposals?: Array<{ key: string; label: string }>;
  answer_minutes?: number | null;
  break_minutes?: number | null;
  break_after?: number | null;
  quota?: { limit?: number | null; used?: Array<{ registration_id: string; position: number; count: number }> } | null;
  hold?: { code?: string | null; text?: string | null } | null;
  clarification_mode?: string | null;
  server_time?: string | null;
  conflict?: { override?: boolean } | null;
};
export type MapStateRow = { position: number; state?: string | null; surplus?: boolean };

export const STATE_LABELS: Record<string, string> = {
  proposed: "Wartet auf Antwort",
  agreed: "Einig",
  in_review: "In Klärung",
  decided: "Entschieden",
  withdrawn: "Zurückgezogen",
  closed: "Geschlossen",
};

export const KIND_HELP: Record<string, string> = {
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

export const PROPOSAL_HELP: Record<string, string> = {
  continue_at_score: "Es geht beim letzten nachweisbaren Stand weiter.",
  rehost: "Neue Lobby, weiter beim letzten nachweisbaren Stand.",
  restart: "Die Map beginnt neu bei 0:0 – nur, wenn noch nichts Spielwirksames passiert ist.",
  replay: "Die ganze Map wird wiederholt. Die erste Austragung zählt dann nicht.",
};

/** „20:14“ in Wiener Zeit. */
export function clock(value?: string | null): string {
  return value ? viennaTime(value, { hour: "2-digit", minute: "2-digit" }) : "";
}

/** Wie viel die Uhr des Geräts von der des Servers abweicht (ms) - der Countdown rechnet mit der Serverzeit. */
export function clockOffset(serverTime?: string | null, now = Date.now()): number {
  const server = serverTime ? Date.parse(serverTime) : NaN;
  return Number.isFinite(server) ? server - now : 0;
}

/** Restzeit bis zur Antwortfrist in Millisekunden, nie negativ. */
export function remainingMs(deadline?: string | null, now = Date.now(), offset = 0): number {
  const end = deadline ? Date.parse(deadline) : NaN;
  return Number.isFinite(end) ? Math.max(0, end - (now + offset)) : 0;
}

/** „4:07“ - Minuten und Sekunden. */
export function remainingText(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Anteil der Antwortzeit, der noch läuft (1 = eben gemeldet, 0 = vorbei) - für den Balken. */
export function remainingShare(incident: Pick<Incident, "at" | "answer_deadline">, now = Date.now(), offset = 0): number {
  const start = incident?.at ? Date.parse(incident.at) : NaN;
  const end = incident?.answer_deadline ? Date.parse(incident.answer_deadline) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.min(1, Math.max(0, (end - (now + offset)) / (end - start)));
}

/** „3:4“ in der Reihenfolge der Seiten - leer ohne Stand. */
export function scoreText(score: Record<string, number | null> | null | undefined, sides: IncidentSide[] = []): string {
  if (!score) return "";
  const values = sides.map((side) => score[side.registration_id]);
  return values.every((value) => value !== undefined && value !== null) ? values.join(":") : "";
}

/** Der Name der Map dieser Position, wenn das Veto sie festgelegt hat - sonst „Map 2“. */
export function positionLabel(league: { planned_games?: Array<{ position: number; map_name?: string | null }> | null } | null | undefined, position: number): string {
  const planned = (league?.planned_games || []).find((row) => Number(row.position) === Number(position));
  return planned?.map_name ? `Map ${position} · ${planned.map_name}` : `Map ${position}`;
}

export function quotaUsed(info: IncidentInfo | null | undefined, registrationId: string, position: number): number {
  const row = (info?.quota?.used || []).find((item) => item.registration_id === registrationId && Number(item.position) === Number(position));
  return Number(row?.count || 0);
}

/** „1 von 1 genutzt“ - das Kontingent je Team und Map (§ 9.6). */
export function quotaText(info: IncidentInfo | null | undefined, registrationId: string, position: number): string {
  return `${quotaUsed(info, registrationId, position)} von ${Number(info?.quota?.limit ?? 1)} genutzt`;
}

/** Rehost und technische Pause zählen gegen das Kontingent - nie der MOSS-Absturz, nie die Map-Pause. */
export function countsQuota(kind?: string | null): boolean {
  return kind === "rehost" || kind === "pause";
}

/** Der Hinweis im Formular, sobald das Kontingent der eigenen Seite auf dieser Map zählt. Nichts wird verweigert. */
export function quotaHint(info: IncidentInfo | null | undefined, registrationId: string | null | undefined, position: number, kind?: string | null): string {
  if (!registrationId || !countsQuota(kind)) return "";
  const limit = Number(info?.quota?.limit ?? 1);
  const used = quotaUsed(info, registrationId, position);
  if (used < limit) return `Zählt gegen euer Kontingent auf dieser Map: bisher ${used} von ${limit} genutzt.`;
  return `Euer Kontingent auf dieser Map ist aufgebraucht (${used} von ${limit}). Ihr könnt trotzdem melden – es braucht die Zustimmung der Gegenseite, sonst entscheidet die Liga-Leitung.`;
}

/** Nach Neustart oder Wiederholung: „Map N wird wiederholt – danach meldet ihr die Serie neu“. */
export function holdNotice(info?: IncidentInfo | null): string {
  return info?.hold?.code === "rereport" ? String(info.hold.text || "") : "";
}

/** Was öffentlich zu einer Position steht: „in Klärung“ oder „zählt nicht“. */
export type MapStateNote = { position: number; kind: "clarification" | "surplus"; text: string };

export function mapStateNotes(league?: { map_state?: MapStateRow[] | null } | null): MapStateNote[] {
  return (league?.map_state || []).flatMap((row): MapStateNote[] => {
    if (row.state === "in_clarification") return [{ position: row.position, kind: "clarification", text: `Map ${row.position} ist in Klärung` }];
    if (row.surplus) return [{ position: row.position, kind: "surplus", text: `Map ${row.position} zählt nicht (Entscheidung der Liga-Leitung)` }];
    return [];
  });
}

const REVIEW_CAUSE: Record<string, string> = {
  rejected: "Die Gegenseite hat abgelehnt.",
  expired: "Keine Antwort in der Antwortzeit.",
  lead: "Von der Liga-Leitung aufgenommen.",
};
const SERIES_MEANWHILE: Record<string, string> = {
  continue: "Die Serie läuft unter Vorbehalt weiter, gewertet wird nach der Entscheidung.",
  pause_series: "Die Serie pausiert: Spätere Maps meldet ihr erst nach der Entscheidung.",
};

/** Der eine Satz zu einem Vorfall: was gilt und wer jetzt dran ist. */
export function stateSentence(incident: Incident | null | undefined, { otherName = "die Gegenseite", ownSide = false, mode = "" }: { otherName?: string | null; ownSide?: boolean; mode?: string | null } = {}): string {
  if (!incident) return "";
  if (incident.between_maps) return `Pause von ${Number(incident.minutes || 0)} Minuten nach Map ${incident.position} – nur festgehalten.`;
  switch (incident.state) {
    case "proposed":
      if (incident.expired) return "Die Antwortzeit ist vorbei – der Vorfall geht an die Liga-Leitung.";
      if (incident.can_answer) return "Ihr seid dran: stimmt zu oder lehnt ab.";
      if (incident.reported_by?.own) return "Die Gegenseite antwortet noch.";
      return ownSide ? "Euer Captain oder Vertreter ist dran: zustimmen oder ablehnen." : `${otherName || "die Gegenseite"} antwortet noch.`;
    case "agreed":
      return "Beide Seiten sind sich einig – es geht weiter wie vorgeschlagen.";
    case "in_review":
      return [REVIEW_CAUSE[incident.review_cause || ""], SERIES_MEANWHILE[mode || ""]].filter(Boolean).join(" ");
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

/** Die Zeile „Vorschlag“ entfällt, wenn die Leitung genau so entschieden hat. */
export function showsProposal(incident: Incident): boolean {
  if (!incident?.proposal_label) return false;
  return !(incident.state === "decided" && incident.decision?.outcome === incident.proposal);
}

/** Was nach der Entscheidung noch zur Serie gilt - leer, solange es keine Entscheidung gibt. */
export function settleSentence(decision?: Incident["decision"]): string {
  if (!decision) return "";
  if (!decision.settled_at) return "Die Serie ist noch nicht festgestellt – bis dahin gilt kein Ergebnis.";
  if (decision.settled_by_result) return "Serie festgestellt: Die Liga-Leitung hat das Ergebnis eingetragen.";
  const missing = decision.missing_positions || [];
  const surplus = decision.surplus_positions || [];
  if (missing.length) return `Serie festgestellt: Es fehlt noch Map ${missing.join(", ")}.`;
  if (surplus.length) return `Serie festgestellt: Map ${surplus.join(", ")} zählt nicht.`;
  return "Serie festgestellt – es fehlt keine Map.";
}

export type IncidentForm = { position: number | ""; kind: string; proposal: string; scores: Record<string, string>; round: string; players: string[]; note: string; minutes: string };

export function emptyIncidentForm(info?: IncidentInfo | null): IncidentForm {
  return { position: "", kind: "", proposal: "", scores: {}, round: "", players: [], note: "", minutes: String(info?.break_minutes ?? 5) };
}

const whole = (value: unknown) => /^\d+$/.test(String(value ?? "").trim());

/** Der erste Satz, der fehlt - leer, wenn die Meldung so abgeschickt werden kann. */
export function incidentProblem(form: IncidentForm, sides: IncidentSide[] = []): string {
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
export function incidentPayload(form: IncidentForm, sides: IncidentSide[] = []): Record<string, unknown> {
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

/** Offene Vorfälle zuerst, darin die neuesten oben - Abgeschlossenes danach. */
export function sortedIncidents(incidents: Incident[] | null | undefined = []): Incident[] {
  return [...(incidents || [])].sort((a, b) => (Number(Boolean(b.open)) - Number(Boolean(a.open))) || String(b.at || "").localeCompare(String(a.at || "")));
}
