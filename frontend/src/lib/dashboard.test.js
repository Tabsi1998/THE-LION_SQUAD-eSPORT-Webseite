import { dashboardActions, registrationLabel, seasonLine, splitHomeTimeline, timelineItems } from "./dashboard";

// Das Dashboard als persoenliche Startseite (#256): nur Termine von heute an,
// heute und live zuerst, Aktionen mit Ziel, eine Zeile Jahreswertung.

const NOW = new Date("2026-09-16T10:00:00");

function payload() {
  return {
    me: {
      tournaments: [
        { id: "t-past", slug: "summer-cup", title: "Summer Cup", status: "results_published", start_date: "2026-05-20T18:00:00Z", public_phase: { state: "finished", label: "Beendet" }, my_registration: { status: "approved" } },
        { id: "t-next", slug: "autumn-cup", title: "Autumn Cup", status: "registration_open", start_date: "2026-11-01T18:00:00Z", public_phase: { state: "registration", label: "Anmeldung offen" }, my_registration: { status: "pending" }, game: { display_name: "Rocket League" } },
        { id: "t-today", slug: "heute-cup", title: "Heute-Cup", status: "live", start_date: "2026-09-16T08:00:00", public_phase: { state: "live", label: "Live" }, my_registration: { status: "checked_in" } },
        { id: "t-cancelled", slug: "champ", title: "Championship", status: "cancelled", start_date: "2026-09-19T18:00:00Z", my_registration: { status: "approved" } },
      ],
      events: [
        { id: "e-1", slug: "halloween", name: "Halloween Gaming Night", status: "registration_open", start_date: "2026-10-31T17:00:00Z", location: "Vereinsheim", city: "Telfs", own_registration: { status: "registered" } },
        { id: "e-old", slug: "opening", name: "Summer Opening", status: "completed", start_date: "2026-05-01T17:00:00Z" },
      ],
      actions: [
        { id: "tournament-checkin-t-today", type: "tournament_checkin", label: "Turnier Check-in offen", detail: "Heute-Cup", target_type: "tournament", target_id: "heute-cup", priority: 10 },
        { id: "match-m-1", type: "match_open", label: "Match offen", detail: "Heute-Cup", target_type: "match", target_id: "m-1", priority: 7 },
      ],
    },
  };
}

test("vergangene und abgesagte Termine fallen weg, heute und live stehen vorne", () => {
  const { live, next, moreCount, total } = splitHomeTimeline(timelineItems(payload()), NOW);
  expect(live.map((item) => item.title)).toEqual(["Heute-Cup"]);
  expect(next.map((item) => item.title)).toEqual(["Halloween Gaming Night", "Autumn Cup"]);
  expect(moreCount).toBe(0);
  expect(total).toBe(3);
  expect(next[0].href).toBe("/events/halloween");
  expect(next[1].detail).toBe("Rocket League");
  expect(registrationLabel(next[1].registrationStatus)).toBe("Wartet auf Freigabe");
  expect(registrationLabel(live[0].registrationStatus)).toBe("Eingecheckt");
});

test("ein Termin ohne Ende zaehlt den ganzen Tag, ein beendeter nicht mehr", () => {
  const items = timelineItems({ me: { tournaments: [
    { id: "a", title: "Frühcup", status: "live", start_date: "2026-09-16T06:00:00" },
    { id: "b", title: "Gestern", status: "registration_open", start_date: "2026-09-15T20:00:00" },
  ], events: [] } });
  const { live, next } = splitHomeTimeline(items, NOW);
  expect(live.map((item) => item.title)).toEqual(["Frühcup"]);
  expect(next).toEqual([]);
});

test("Aktionen bekommen ihr Ziel, offene Gewinne kommen als erste Aktion dazu", () => {
  const actions = dashboardActions(payload(), { openPrizes: 2 });
  expect(actions.map((action) => action.href)).toEqual(["/my/prizes", "/tournaments/heute-cup", "/matches/m-1"]);
  expect(actions[0].label).toBe("2 Gewinne abholen");
  expect(dashboardActions({}, { openPrizes: 0 })).toEqual([]);
});

test("die Jahreswertung ist eine Zeile: eigener Platz, sonst die Spitze", () => {
  expect(seasonLine({ my_rank: 3, my_points: 42, participant_count: 20 })).toBe("Du: Platz 3 von 20 · 42 Punkte");
  expect(seasonLine({ my_rank: 1, my_points: 1, participant_count: 1 })).toBe("Du: Platz 1 von 1 · 1 Punkt");
  expect(seasonLine({ leader: { display_name: "Anna", points: 99 } })).toBe("Vorn: Anna · 99 Punkte");
  expect(seasonLine({})).toBe("Noch keine Punkte vergeben.");
  expect(seasonLine(null)).toBe("");
});
