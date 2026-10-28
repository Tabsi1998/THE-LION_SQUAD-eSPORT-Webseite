import { isOwnProposal, proposalStatusLabel, waitingForOtherSide } from "./scheduleProposals";

// Terminabstimmung (#2110, L-D7): Zustände auf Deutsch, eigener Vorschlag nach Seite - ohne Seite nach Person.

test("proposalStatusLabel nennt jeden Zustand auf Deutsch", () => {
  expect(proposalStatusLabel({ status: "pending" })).toBe("offen");
  expect(proposalStatusLabel({ status: "pending", kind: "counter" })).toBe("Gegenvorschlag, offen");
  expect(proposalStatusLabel({ status: "accepted" })).toBe("angenommen");
  expect(proposalStatusLabel({ status: "declined" })).toBe("abgelehnt");
  expect(proposalStatusLabel({ status: "countered" })).toBe("Gegenvorschlag gemacht");
  expect(proposalStatusLabel({ status: "withdrawn" })).toBe("zurückgezogen");
  expect(proposalStatusLabel({ status: "seltsam" })).toBe("unbekannt");
});

test("isOwnProposal: die eigene Seite zählt, ohne Seite (Turnierleitung) die eigene Person", () => {
  const proposal = { actor_registration_id: "a", actor_user_id: "u1" };
  expect(isOwnProposal(proposal, { acting_registration_id: "a" }, "u2")).toBe(true);
  expect(isOwnProposal(proposal, { acting_registration_id: "b" }, "u1")).toBe(false);
  expect(isOwnProposal({ actor_registration_id: null, actor_user_id: "lead" }, {}, "lead")).toBe(true);
  expect(isOwnProposal(proposal, {}, null)).toBe(false);
});

test("waitingForOtherSide nur, wenn alles Offene von der eigenen Seite kommt", () => {
  const page = { acting_registration_id: "a" };
  expect(waitingForOtherSide([{ status: "pending", actor_registration_id: "a" }], page, "u1")).toBe(true);
  expect(waitingForOtherSide([{ status: "pending", actor_registration_id: "b" }], page, "u1")).toBe(false);
  expect(waitingForOtherSide([{ status: "declined", actor_registration_id: "a" }], page, "u1")).toBe(false);
  expect(waitingForOtherSide([], page, "u1")).toBe(false);
});
