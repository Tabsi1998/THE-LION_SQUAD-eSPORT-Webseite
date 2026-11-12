// Verfahren der Liga (E.2, #1619): Beanstandung, Protest, Einspruch. Der Server sagt, wer was sieht und darf
// (services/league_procedures, Block `league.procedures` der Matchseite) - hier stehen nur Wörter, die Restzeit einer Frist
// und die Anfrage aus dem geführten Formular. Jede Angabe steht an einer Stelle (#2023).

export const PROCEDURE_STATE_LABELS = { open: "Läuft", withdrawn: "Zurückgezogen", decided: "Entschieden" };

export const KIND_HINTS = {
  objection: "Das Ergebnis ist noch nicht bestätigt. Deine Beanstandung hält das Spiel an, bis die Liga-Leitung entschieden hat.",
  protest: "Das Ergebnis ist bestätigt. Dein Protest geht an die Liga-Leitung; die Gegenseite kann Stellung nehmen.",
  appeal: "Über einen Einspruch entscheidet eine andere Person als bei der ersten Entscheidung. Ihre Entscheidung ist endgültig.",
};

export const AGAINST_LABELS = {
  protest_decision: "gegen die Entscheidung über den Protest",
  forfeit: "gegen die Wertung kampflos",
  correction: "gegen die Korrektur des Ergebnisses",
};

export const MOSS_STATE_LABELS = { requested: "angefordert", uploaded: "hochgeladen", missing: "fehlt nach Fristablauf", excused: "entschuldigt" };

/** „noch 1 Tag 4 Std.“, „noch 35 Min.“ oder „abgelaufen“ - `null`, wenn es keine Frist gibt. */
export function remainingText(until, now = Date.now()) {
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

/** Wie dringend eine Frist ist - für die Farbe des Countdowns. */
export function deadlineTone(until, now = Date.now()) {
  if (!until) return "none";
  const left = new Date(until).getTime() - now;
  if (left <= 0) return "over";
  return left <= 6 * 3600 * 1000 ? "soon" : "calm";
}

/** Was der Entscheid bedeutet, in einem Satz. */
export function decisionText(procedure) {
  if (procedure.state === "withdrawn") return "Zurückgezogen – es wird nicht mehr entschieden.";
  if (procedure.state !== "decided") return "";
  if (procedure.kind === "appeal") return procedure.decision === "keep" ? "Einspruch abgewiesen – die Entscheidung bleibt." : "Dem Einspruch wurde stattgegeben.";
  return procedure.decision === "keep" ? "Das Ergebnis bleibt." : "Das Ergebnis wurde geändert.";
}

/** Das abweichende Ergebnis als „Rudel A 1 : 2 Horst“. */
export function claimedText(claimed, sideNames = {}) {
  const rows = claimed?.results || [];
  if (rows.length !== 2) return "";
  const [a, b] = rows;
  return `${sideNames[a.registration_id] || "Seite 1"} ${a.score} : ${b.score} ${sideNames[b.registration_id] || "Seite 2"}`;
}

const wholeNumber = (value) => (/^\d{1,3}$/.test(String(value ?? "").trim()) ? Number.parseInt(String(value).trim(), 10) : null);

/**
 * Prüft das geführte Formular und baut die Anfrage für POST /matches/{id}/dispute. Gibt `{ error }` oder `{ payload }` zurück.
 * `form`: { reasonKey, text, notified (true/false/null), scores: { [registrationId]: "2" }, incidentId }.
 */
export function procedurePayload(form, guide, sideIds = []) {
  const reason = (guide?.reasons || []).find((row) => row.key === form.reasonKey);
  if (!reason) return { error: "Bitte antippen, worum es geht." };
  const text = String(form.text || "").trim();
  const min = guide.reason_min || 10;
  if (text.length < min) return { error: `Bitte beschreibe in mindestens ${min} Zeichen, was nicht stimmt.` };
  const payload = { reason: text, reason_key: reason.key };
  const isResult = reason.key === (guide.result_reason || "wrong_result");
  const scores = sideIds.map((side) => wholeNumber(form.scores?.[side]));
  const anyScore = sideIds.some((side) => String(form.scores?.[side] ?? "").trim() !== "");
  if (isResult || anyScore) {
    if (sideIds.length !== 2 || scores.some((score) => score === null)) return { error: "Bitte das Ergebnis angeben, das aus eurer Sicht stimmt – je Seite eine Zahl." };
    payload.claimed = { results: sideIds.map((side, index) => ({ registration_id: side, score: scores[index] })) };
  }
  if (reason.ask_notified) {
    if (typeof form.notified !== "boolean") return { error: "Bitte angeben, ob ihr die Gegenseite sofort darauf hingewiesen habt." };
    payload.notified_immediately = form.notified;
  }
  if (form.incidentId) payload.incident_id = form.incidentId;
  return { payload };
}

const INCIDENT_LABELS = { disconnect: "Verbindungsabbruch", rehost: "Rehost", pause: "Pause", moss_crash: "MOSS-Absturz", restart_early: "Neustart", replay: "Wiederholung", other: "Vorfall" };

export function incidentLabel(incident) {
  return `Map ${incident.position ?? "?"}: ${INCIDENT_LABELS[incident.kind] || "Vorfall"}`;
}
