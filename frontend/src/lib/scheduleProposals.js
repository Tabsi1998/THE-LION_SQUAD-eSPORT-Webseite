// Terminabstimmung auf der Matchseite (#2110, L-D7): Zustand eines Vorschlags auf Deutsch und wessen Vorschlag es ist.
// Der eigene, offene Vorschlag wartet auf die Gegenseite - annehmen oder ablehnen kann ihn nur sie, die eigene Seite
// zieht ihn zurück.

export const PROPOSAL_STATUS_LABELS = {
  pending: "offen",
  accepted: "angenommen",
  declined: "abgelehnt",
  countered: "Gegenvorschlag gemacht",
  withdrawn: "zurückgezogen",
};

export function proposalStatusLabel(proposal) {
  const status = String(proposal?.status || "");
  if (status === "pending" && proposal?.kind === "counter") return "Gegenvorschlag, offen";
  // Liga-Termine (#2194): nach der Frist ohne Antwort gilt der Heimvorschlag; die übrigen sind damit erledigt.
  if (status === "accepted" && proposal?.decision_rule === "home_rule") return "gilt nach der 72-h-Regel";
  if (status === "declined" && proposal?.decision_rule) return "erledigt – anderer Termin steht";
  return PROPOSAL_STATUS_LABELS[status] || "unbekannt";
}

/** Hat die eigene Seite (oder ohne eigene Seite: die Person selbst) diesen Vorschlag gemacht? */
export function isOwnProposal(proposal, page, userId) {
  if (!proposal) return false;
  const side = page?.acting_registration_id;
  if (side) return proposal.actor_registration_id === side;
  return Boolean(userId && proposal.actor_user_id === userId);
}

/** Wartet ein offener Vorschlag auf die Gegenseite, weil er von der eigenen Seite kommt? */
export function waitingForOtherSide(proposals, page, userId) {
  const open = (proposals || []).filter((proposal) => proposal?.status === "pending");
  return open.length > 0 && open.every((proposal) => isOwnProposal(proposal, page, userId));
}

// ---------------------------------------------------------------- Mehrere Termine auf einmal (#2325)

/** Höchstens so viele Termine je Vorschlag oder Gegenvorschlag - wie der Server (models.SCHEDULE_PROPOSAL_MAX_TIMES). */
export const MAX_PROPOSAL_TIMES = 3;

// Frühestens 5 Minuten ab jetzt (#2124) - wie services/schedule_proposal_time.py.
export const PROPOSAL_LEAD_MS = 5 * 60 * 1000;
export const PAST_PROPOSAL_TEXT = "Der Termin liegt in der Vergangenheit – bitte einen Zeitpunkt frühestens 5 Minuten ab jetzt wählen.";
export const MISSING_TIME_TEXT = "Bitte Datum und Uhrzeit wählen.";
export const DUPLICATE_TIME_TEXT = "Diesen Termin hast du schon eingetragen – bitte einen anderen wählen.";

/**
 * Offene Vorschläge einer Gruppe stehen zusammen (#2325): eine Karte mit allen Terminen, früheste zuerst, an der Stelle des
 * ersten. Alles andere - erledigte Vorschläge, einzelne, eine Gruppe mit nur noch einem offenen - bleibt eine Zeile für sich.
 */
export function bundleProposals(proposals) {
  const list = proposals || [];
  const openByGroup = new Map();
  for (const proposal of list) {
    if (proposal?.status === "pending" && proposal.group_id) {
      openByGroup.set(proposal.group_id, [...(openByGroup.get(proposal.group_id) || []), proposal]);
    }
  }
  const placed = new Set();
  const bundles = [];
  list.forEach((proposal, index) => {
    const members = proposal?.status === "pending" && proposal.group_id ? openByGroup.get(proposal.group_id) : null;
    if (members && members.length > 1) {
      if (placed.has(proposal.group_id)) return;
      placed.add(proposal.group_id);
      const sorted = [...members].sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
      bundles.push({ key: `gruppe-${proposal.group_id}`, group: true, groupId: proposal.group_id, proposals: sorted });
      return;
    }
    bundles.push({ key: proposal?.id || `zeile-${index}`, group: false, proposals: [proposal], index });
  });
  return bundles;
}

/**
 * Jeder Termin einzeln (#2325): `values` sind Zeitpunkte (ISO) oder `null` für ein leeres Feld. Antwort: je Termin ein Satz
 * oder `null`. Prüft leer, zu früh und doppelt - Sperrzeiten kennt erst der Server, er antwortet mit derselben Stelle.
 * Die Spielwoche hält nichts auf, dazu `proposalTimeHints`. Im Gegenvorschlag (`offered`: die offenen Termine, auf die man
 * antwortet) ist ein angebotener Termin ein Fehler - er ist eine Annahme, kein Gegenvorschlag. Wie der Server.
 */
export function proposalTimeErrors(values, { now = Date.now(), offered = [] } = {}) {
  const seen = new Set();
  const already = offeredMoments(offered);
  return (values || []).map((value) => {
    const moment = value ? new Date(value).getTime() : Number.NaN;
    if (Number.isNaN(moment)) return MISSING_TIME_TEXT;
    if (moment < now + PROPOSAL_LEAD_MS) return PAST_PROPOSAL_TEXT;
    if (seen.has(moment)) return DUPLICATE_TIME_TEXT;
    seen.add(moment);
    return already.has(moment) ? OFFERED_TIME_TEXT : null;
  });
}

export const OFFERED_TIME_TEXT = "Steht schon zur Auswahl – passt er, einfach „Annehmen“ tippen; sonst einen anderen Termin wählen.";

function offeredMoments(offered) {
  return new Set((offered || []).map((value) => new Date(value).getTime()).filter((moment) => !Number.isNaN(moment)));
}

/** Der Name der Regel nach der eingestellten Frist (#2406): „48-h-Regel“; ohne gültigen Wert die Vorgabe 72 (wie am Server). */
export function homeRuleName(hours) {
  const count = Math.trunc(Number(hours));
  return `${count > 0 ? count : 72}-h-Regel`;
}

/**
 * Hinweise schon beim Eingeben (#2325): In einer Staffel mit Terminregeln (`window` aus `schedule_block`) zählt ein Termin
 * außerhalb der Spielwoche nicht für die 72-h-Regel - er gilt nur, wenn die Gegenseite annimmt; die 72-h-Regel nennt der Satz nur,
 * wenn sie an ist (`homeRule` aus `schedule_block.rules.home_rule`). Im Gegenvorschlag steht bei einem angebotenen Termin
 * (`offered`) schon vor dem Absenden, dass er zur Auswahl steht. Dieselben Sätze wie am Server.
 */
export function proposalTimeHints(values, { window = null, weekLabel = "", homeRule = true, homeRuleHours = null, offered = [] } = {}) {
  const start = window?.start ? new Date(window.start).getTime() : null;
  const end = window?.end ? new Date(window.end).getTime() : null;
  const already = offeredMoments(offered);
  return (values || []).map((value) => {
    const moment = value ? new Date(value).getTime() : Number.NaN;
    if (!Number.isNaN(moment) && already.has(moment)) return OFFERED_TIME_TEXT;
    if (Number.isNaN(moment) || start === null || end === null || (moment >= start && moment < end)) return null;
    const week = weekLabel ? ` (${weekLabel})` : "";
    return `Liegt außerhalb der Spielwoche${week} – gilt nur, wenn die Gegenseite annimmt${homeRule ? `; die ${homeRuleName(homeRuleHours)} greift hier nicht.` : "."}`;
  });
}

/** Die Fehler des Servers je Termin (`detail.errors` mit `index`) - als Liste in der Länge der Eingabe. */
export function serverTimeErrors(detail, count) {
  const errors = Array.from({ length: count }, () => null);
  for (const row of Array.isArray(detail?.errors) ? detail.errors : []) {
    if (Number.isInteger(row?.index) && row.index >= 0 && row.index < count) errors[row.index] = String(row.detail || "");
  }
  return errors;
}

/** Text des Knopfs: „Vorschlagen“ für einen Termin, sonst mit Zahl - „3 Termine vorschlagen“. */
export function proposeButtonLabel(count, counter = false) {
  if (counter) return count > 1 ? `${count} Termine als Gegenvorschlag senden` : "Gegenvorschlag senden";
  return count > 1 ? `${count} Termine vorschlagen` : "Vorschlagen";
}
