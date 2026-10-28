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
