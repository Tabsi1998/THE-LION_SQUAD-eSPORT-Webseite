import { describe, expect, it } from "vitest";
import { cancelConsequences } from "./seasonCancel";
import { SEASON_STATUS_OPTIONS, SEASON_STATUS_TEXT, isCancelledSeason } from "./league";
import { STATUS_EFFECT, seasonPhases } from "./seasonTabs";

const PLAN = {
  can_cancel: true, kind: "team", applications: 4, applications_by_status: { submitted: 1, in_review: 1, waitlist: 1, accepted: 1 },
  staffeln: 2, people: 8, teams: 4, carried: 0, predecessor: null,
};

describe("cancelConsequences (#2607)", () => {
  it("lists every consequence in the order the cancel does it", () => {
    const lines = cancelConsequences(PLAN);
    expect(lines.map((line) => line.key)).toEqual(["window", "applications", "staffeln", "people", "visible"]);
    expect(lines[1].text).toBe("4 offene Anmeldungen werden mit deinem Grund abgelehnt (1 eingereicht, 1 in Prüfung, 1 auf der Warteliste, 1 angenommen).");
    expect(lines[2].text).toBe("2 Staffeln stehen danach auf „Abgesagt“.");
    expect(lines[3].text).toBe("8 Personen bekommen genau eine Nachricht mit Mail – Captain und Vertreter von 4 Co-Teams.");
  });

  it("speaks of one and of players in a solo league", () => {
    const lines = cancelConsequences({ ...PLAN, kind: "solo", applications: 1, applications_by_status: { submitted: 1 }, staffeln: 1, people: 1, teams: 1 });
    expect(lines[1].text).toBe("1 offene Anmeldung wird mit deinem Grund abgelehnt (1 eingereicht).");
    expect(lines[2].text).toBe("1 Staffel steht danach auf „Abgesagt“.");
    expect(lines[3].text).toBe("1 Person bekommt genau eine Nachricht mit Mail – 1 Spieler.");
  });

  it("names carried teams and that their start rights stay", () => {
    const lines = cancelConsequences({ ...PLAN, carried: 3, predecessor: { id: "s1", name: "Season 1" } });
    expect(lines.find((line) => line.key === "carried").text).toBe("3 Co-Teams sind aus Season 1 übernommen: Ihre Startrechte gelten für die nächste Season weiter.");
  });

  it("says plainly when nobody is in yet", () => {
    const lines = cancelConsequences({ ...PLAN, applications: 0, applications_by_status: {}, staffeln: 0, people: 0, teams: 0 });
    expect(lines.map((line) => line.text)).toContain("Niemand bekommt eine Nachricht – es ist noch niemand angemeldet.");
    expect(lines.map((line) => line.text)).toContain("Es gibt keine offenen Anmeldungen.");
  });

  it("returns nothing without a plan", () => {
    expect(cancelConsequences(null)).toEqual([]);
  });
});

describe("cancelled season status (#2607)", () => {
  it("is shown but never offered as a choice", () => {
    expect(SEASON_STATUS_TEXT.cancelled).toBe("Abgesagt");
    expect(SEASON_STATUS_OPTIONS.map(([value]) => value)).not.toContain("cancelled");
    expect(STATUS_EFFECT.cancelled).toContain("Zurücknehmen geht nicht");
    expect(isCancelledSeason({ status: "cancelled" })).toBe(true);
    expect(isCancelledSeason({ status: "draft" })).toBe(false);
    expect(isCancelledSeason(null)).toBe(false);
  });

  it("closes the phase bar like a finished season, even before the start", () => {
    const steps = seasonPhases({ season: { status: "cancelled", start_date: "2030-01-01T00:00:00Z" }, now: new Date("2026-11-28T12:00:00Z") });
    const last = steps.at(-1);
    expect(last.state).toBe("current");
    expect(last.when).toBe("abgesagt");
    expect(last.note).toContain("ohne Endstand");
  });

  it("marks what never happened as skipped, not as done", () => {
    const season = { status: "cancelled", start_date: "2026-12-07T23:00:00Z", application_opens_at: "2026-11-01T00:00:00Z",
      application_closes_at: "2026-11-27T23:00:00Z", cancelled_at: "2026-11-28T10:30:00Z" };
    const states = Object.fromEntries(seasonPhases({ season, now: new Date("2026-11-28T12:00:00Z") }).map((step) => [step.key, step.state]));
    expect(states).toEqual({ vorbereitung: "done", anmeldung: "done", einteilung: "done", spielbetrieb: "skipped", abschluss: "current" });
    const early = Object.fromEntries(seasonPhases({ season: { ...season, cancelled_at: "2026-11-10T10:00:00Z" }, now: new Date("2026-11-28T12:00:00Z") })
      .map((step) => [step.key, step.state]));
    expect(early).toEqual({ vorbereitung: "done", anmeldung: "done", einteilung: "skipped", spielbetrieb: "skipped", abschluss: "current" });
  });
});
