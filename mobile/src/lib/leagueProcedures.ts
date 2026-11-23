// Verfahren der Liga (E.2, #1619; App #2173): Beanstandung, Protest, Einspruch - Wörter, Restzeit und die Anfrage aus dem geführten
// Formular wie frontend/src/lib/leagueProcedures.js. Wer was sieht und darf, sagt der Server (Block `league.procedures` und
// `league.procedure_form` der Matchseite).

export type ProcedureReason = { key: string; label: string; ask_notified?: boolean };
export type ProcedureGuide = {
  open?: boolean;
  kind?: "objection" | "protest" | string;
  kind_label?: string;
  until?: string | null;
  reasons?: ProcedureReason[];
  result_reason?: string | null;
  reason_min?: number | null;
  reason_max?: number | null;
  incidents?: Array<{ id: string; position?: number | null; kind?: string | null }>;
  appealable?: { type: "forfeit" | "correction" | string; ref_id: string; until?: string | null } | null;
};
export type Procedure = {
  id: string;
  kind?: string;
  kind_label?: string;
  state?: "open" | "withdrawn" | "decided" | string;
  side?: string | null;
  own?: boolean;
  at?: string | null;
  reason?: string | null;
  reason_label?: string | null;
  against?: { type?: string } | null;
  additions?: Array<{ text: string; at: string }>;
  claimed?: { results?: Array<{ registration_id: string; score: number }> } | null;
  notified_immediately?: boolean | null;
  evidence_until?: string | null;
  statement?: { side?: string | null; text?: string | null; at?: string | null; due_at?: string | null; expired?: boolean } | null;
  assignee?: { name?: string | null; at?: string | null } | null;
  decision?: string | null;
  decision_note?: string | null;
  appeal_until?: string | null;
  moss_requests?: Array<{ id: string; own?: boolean; state?: string }>;
  can_state?: boolean;
  can_amend?: boolean;
  can_withdraw?: boolean;
  can_appeal?: boolean;
  can_lead?: boolean;
};

export const PROCEDURE_STATE_LABELS: Record<string, string> = { open: "Läuft", withdrawn: "Zurückgezogen", decided: "Entschieden" };

export const KIND_HINTS: Record<string, string> = {
  objection: "Das Ergebnis ist noch nicht bestätigt. Deine Beanstandung hält das Spiel an, bis die Liga-Leitung entschieden hat.",
  protest: "Das Ergebnis ist bestätigt. Dein Protest geht an die Liga-Leitung; die Gegenseite kann Stellung nehmen.",
  appeal: "Über einen Einspruch entscheidet eine andere Person als bei der ersten Entscheidung. Ihre Entscheidung ist endgültig.",
};

export const AGAINST_LABELS: Record<string, string> = {
  protest_decision: "gegen die Entscheidung über den Protest",
  forfeit: "gegen die Wertung kampflos",
  correction: "gegen die Korrektur des Ergebnisses",
};

/** „noch 1 Tag 4 Std.“, „noch 35 Min.“ oder „abgelaufen“ - `null`, wenn es keine Frist gibt. */
export function remainingText(until?: string | null, now = Date.now()): string | null {
  if (!until) return null;
  const left = new Date(until).getTime() - now;
  if (Number.isNaN(left)) return null;
  if (left <= 0) return "abgelaufen";
  const minutes = Math.floor(left / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `noch ${days} ${days === 1 ? "Tag" : "Tage"}${hours ? ` ${hours} Std.` : ""}`;
  if (hours > 0) return `noch ${hours} Std.${minutes % 60 ? ` ${minutes % 60} Min.` : ""}`;
  return `noch ${Math.max(1, minutes)} Min.`;
}

/** Was der Entscheid bedeutet, in einem Satz. */
export function decisionText(procedure: Pick<Procedure, "state" | "kind" | "decision">): string {
  if (procedure.state === "withdrawn") return "Zurückgezogen – es wird nicht mehr entschieden.";
  if (procedure.state !== "decided") return "";
  if (procedure.kind === "appeal") return procedure.decision === "keep" ? "Einspruch abgewiesen – die Entscheidung bleibt." : "Dem Einspruch wurde stattgegeben.";
  return procedure.decision === "keep" ? "Das Ergebnis bleibt." : "Das Ergebnis wurde geändert.";
}

/** Das abweichende Ergebnis als „Rudel A 1 : 2 Horst“. */
export function claimedText(claimed: Procedure["claimed"], sideNames: Record<string, string> = {}): string {
  const rows = claimed?.results || [];
  if (rows.length !== 2) return "";
  const [a, b] = rows;
  return `${sideNames[a.registration_id] || "Seite 1"} ${a.score} : ${b.score} ${sideNames[b.registration_id] || "Seite 2"}`;
}

const wholeNumber = (value: unknown) => (/^\d{1,3}$/.test(String(value ?? "").trim()) ? Number.parseInt(String(value).trim(), 10) : null);

export type ProcedureForm = { reasonKey: string; text: string; notified: boolean | null; scores: Record<string, string>; incidentId: string };
export type ProcedurePayload = { reason: string; reason_key: string; claimed?: { results: Array<{ registration_id: string; score: number }> }; notified_immediately?: boolean; incident_id?: string };

/** Prüft das geführte Formular und baut die Anfrage für POST /matches/{id}/dispute: `{ error }` oder `{ payload }`. */
export function procedurePayload(form: ProcedureForm, guide: ProcedureGuide | null | undefined, sideIds: string[] = []): { error: string; payload?: undefined } | { payload: ProcedurePayload; error?: undefined } {
  const reason = (guide?.reasons || []).find((row) => row.key === form.reasonKey);
  if (!reason) return { error: "Bitte antippen, worum es geht." };
  const text = String(form.text || "").trim();
  const min = guide?.reason_min || 10;
  if (text.length < min) return { error: `Bitte beschreibe in mindestens ${min} Zeichen, was nicht stimmt.` };
  const payload: ProcedurePayload = { reason: text, reason_key: reason.key };
  const isResult = reason.key === (guide?.result_reason || "wrong_result");
  const scores = sideIds.map((side) => wholeNumber(form.scores?.[side]));
  const anyScore = sideIds.some((side) => String(form.scores?.[side] ?? "").trim() !== "");
  if (isResult || anyScore) {
    if (sideIds.length !== 2 || scores.some((score) => score === null)) return { error: "Bitte das Ergebnis angeben, das aus eurer Sicht stimmt – je Seite eine Zahl." };
    payload.claimed = { results: sideIds.map((side, index) => ({ registration_id: side, score: scores[index] as number })) };
  }
  if (reason.ask_notified) {
    if (typeof form.notified !== "boolean") return { error: "Bitte angeben, ob ihr die Gegenseite sofort darauf hingewiesen habt." };
    payload.notified_immediately = form.notified;
  }
  if (form.incidentId) payload.incident_id = form.incidentId;
  return { payload };
}

const INCIDENT_LABELS: Record<string, string> = { disconnect: "Verbindungsabbruch", rehost: "Rehost", pause: "Pause", moss_crash: "MOSS-Absturz", restart_early: "Neustart", replay: "Wiederholung", other: "Vorfall" };

export function incidentLabel(incident: { position?: number | null; kind?: string | null }): string {
  return `Map ${incident.position ?? "?"}: ${INCIDENT_LABELS[String(incident.kind || "")] || "Vorfall"}`;
}
