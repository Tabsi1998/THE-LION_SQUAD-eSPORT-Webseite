import {
  DUPLICATE_TIME_TEXT,
  MISSING_TIME_TEXT,
  PAST_PROPOSAL_TEXT,
  bundleProposals,
  isOwnProposal,
  proposalStatusLabel,
  proposalTimeErrors,
  proposeButtonLabel,
  serverTimeErrors,
  waitingForOtherSide,
} from "./scheduleProposals";

// Mehrere Termine auf einmal (#2325).
const NOW = new Date("2027-03-01T10:00:00Z").getTime();

test("bundleProposals: offene einer Gruppe stehen als eine Karte, früheste zuerst, an der Stelle der ersten", () => {
  const rows = [
    { id: "x", status: "pending", scheduled_at: "2027-03-05T19:00:00Z" },
    { id: "g2", status: "pending", group_id: "g", scheduled_at: "2027-03-12T19:00:00Z" },
    { id: "g1", status: "pending", group_id: "g", scheduled_at: "2027-03-10T19:00:00Z" },
    { id: "alt", status: "declined", group_id: "h", scheduled_at: "2027-03-01T19:00:00Z" },
    { id: "h2", status: "pending", group_id: "h", scheduled_at: "2027-03-02T19:00:00Z" },
  ];
  const bundles = bundleProposals(rows);
  expect(bundles.map((bundle) => bundle.key)).toEqual(["x", "gruppe-g", "alt", "h2"]);
  expect(bundles[1].group).toBe(true);
  expect(bundles[1].proposals.map((row) => row.id)).toEqual(["g1", "g2"]);
  expect(bundles[3].group).toBe(false);
  expect(bundleProposals([{ status: "pending" }])[0].key).toBe("zeile-0");
  expect(bundleProposals(null)).toEqual([]);
});

test("proposalTimeErrors prüft jeden Termin einzeln: leer, zu früh, außerhalb der Spielwoche, doppelt", () => {
  const window = { start: "2027-03-01T00:00:00Z", end: "2027-03-08T00:00:00Z" };
  const errors = proposalTimeErrors(
    [null, "2027-03-01T10:02:00Z", "2027-03-09T19:00:00Z", "2027-03-03T19:00:00Z", "2027-03-03T19:00:00Z"],
    { now: NOW, window, weekLabel: "Mo 01.03. 01:00 bis So 07.03. 23:59" },
  );
  expect(errors).toEqual([
    MISSING_TIME_TEXT,
    PAST_PROPOSAL_TEXT,
    "Der Termin muss in der Spielwoche liegen (Mo 01.03. 01:00 bis So 07.03. 23:59).",
    null,
    DUPLICATE_TIME_TEXT,
  ]);
  expect(proposalTimeErrors(["2027-03-20T19:00:00Z"], { now: NOW })).toEqual([null]);
});

test("serverTimeErrors legt die Sätze des Servers an ihre Stelle", () => {
  expect(serverTimeErrors({ errors: [{ index: 2, detail: "Sperrzeit" }, { index: 9, detail: "weg" }] }, 3)).toEqual([null, null, "Sperrzeit"]);
  expect(serverTimeErrors("Kein Recht", 2)).toEqual([null, null]);
});

test("proposeButtonLabel nennt die Zahl erst ab zwei Terminen", () => {
  expect(proposeButtonLabel(1)).toBe("Vorschlagen");
  expect(proposeButtonLabel(3)).toBe("3 Termine vorschlagen");
  expect(proposeButtonLabel(1, true)).toBe("Gegenvorschlag senden");
  expect(proposeButtonLabel(2, true)).toBe("2 Termine als Gegenvorschlag senden");
});

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

test("proposalStatusLabel: 72-h-Regel und erledigte Vorschläge (#2194)", () => {
  expect(proposalStatusLabel({ status: "accepted", decision_rule: "home_rule" })).toBe("gilt nach der 72-h-Regel");
  expect(proposalStatusLabel({ status: "declined", decision_rule: "agreed_elsewhere" })).toBe("erledigt – anderer Termin steht");
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
