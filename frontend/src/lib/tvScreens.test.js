// Pause-, Check-in- und Anmelde-Bildschirm (#1123): welcher Bildschirm bei welchem Status, „Gleich geht es weiter“ statt
// Minuszeit, wer beim Check-in da ist, freie Plätze.
import { singleElimination } from "../../e2e/fixtures/tvBrackets.mjs";
import { call } from "../../e2e/fixtures/tvHall.mjs";
import { getRegistrationState } from "./datetime";
import { checkInView, dayAndTime, nextUp, pauseClock, pauseView, registrationOpen, registrationView, tvScreenFor } from "./tvScreens";

const NOW = Date.parse("2026-10-10T14:32:00+02:00");
const at = (minutes) => new Date(NOW + minutes * 60000).toISOString();

test("der TV wählt selbst: Pause, Check-in, Anmeldung, sonst die Wiedergabeliste", () => {
  expect(tvScreenFor({ status: "paused" }, { now: NOW })).toBe("pause");
  expect(tvScreenFor({ status: "check_in" }, { now: NOW })).toBe("checkin");
  expect(tvScreenFor({ status: "checkin_open" }, { now: NOW })).toBe("checkin");
  expect(tvScreenFor({ status: "registration_open" }, { now: NOW })).toBe("registration");
  expect(tvScreenFor({ status: "live" }, { now: NOW })).toBe("playlist");
  expect(tvScreenFor({ status: "completed" }, { now: NOW })).toBe("playlist");
  expect(tvScreenFor({ status: "scheduled" }, { now: NOW })).toBe("playlist");
  expect(tvScreenFor(null, { now: NOW })).toBe("playlist");
});

test("Anmeldung nur, wenn man sich wirklich anmelden kann - wie am Server", () => {
  expect(tvScreenFor({ status: "registration_open", registration_enabled: false }, { now: NOW })).toBe("playlist");
  expect(tvScreenFor({ status: "registration_open", is_invite_only: true }, { now: NOW })).toBe("playlist");
  expect(tvScreenFor({ status: "registration_open", registration_open_from: at(10) }, { now: NOW })).toBe("playlist");
  expect(tvScreenFor({ status: "registration_open", registration_open_until: at(-1) }, { now: NOW })).toBe("playlist");
  expect(tvScreenFor({ status: "registration_open", registration_open_until: at(60) }, { now: NOW })).toBe("registration");
});

test("Check-in auch im Check-in-Zeitraum - aber nicht mehr nach dem Start", () => {
  const window = { check_in_from: at(-10), check_in_until: at(10) };
  expect(tvScreenFor({ status: "registration_closed", ...window }, { now: NOW })).toBe("checkin");
  expect(tvScreenFor({ status: "registration_closed", ...window, start_date: at(-1) }, { now: NOW })).toBe("playlist");
  expect(tvScreenFor({ status: "registration_closed", check_in_from: at(5) }, { now: NOW })).toBe("playlist");
  // Die Uhr läuft weiter: zehn Minuten später ist der Check-in zu.
  expect(tvScreenFor({ status: "registration_closed", ...window }, { now: NOW + 11 * 60000 })).toBe("playlist");
});

test("#1827: Anmeldung offen im Check-in-Zeitraum - solange Plätze frei sind, bleibt der Anmelde-QR", () => {
  const open = { status: "registration_open", max_participants: 16, check_in_from: at(-10), check_in_until: at(60) };
  // Vor Ort üblich: Einlass mit Anmeldung und Check-in zugleich - der TV bietet weiter die Anmeldung an.
  expect(tvScreenFor(open, { now: NOW, seats: { taken: 0, capacity: 16 } })).toBe("registration");
  expect(tvScreenFor(open, { now: NOW, seats: { taken: 15, capacity: 16 } })).toBe("registration");
  // Ohne Platzzahl vom Server zählen die Anmeldungen, die einen Platz belegen.
  const people = Array.from({ length: 3 }, (_, index) => ({ id: `r${index}`, status: "approved" }));
  expect(tvScreenFor(open, { now: NOW, registrations: people })).toBe("registration");
  // Ohne Obergrenze ist immer ein Platz frei.
  expect(tvScreenFor({ ...open, max_participants: null }, { now: NOW })).toBe("registration");
  // Voll: dann der Check-in (die Warteliste wartet, bis der Check-in vorbei ist).
  expect(tvScreenFor(open, { now: NOW, seats: { taken: 16, capacity: 16 } })).toBe("checkin");
  // Die Turnierleitung startet den Check-in („Check-in starten“): ab dann der Check-in, wie bisher.
  expect(tvScreenFor({ ...open, status: "check_in" }, { now: NOW, seats: { taken: 3, capacity: 16 } })).toBe("checkin");
  // Anmeldezeitraum vorbei, Check-in läuft: der Check-in.
  expect(tvScreenFor({ ...open, registration_open_until: at(-1) }, { now: NOW, seats: { taken: 3, capacity: 16 } })).toBe("checkin");
});

test("#1827: Anmeldung am TV nach derselben Regel wie die Anmeldeseite (getRegistrationState)", () => {
  const cases = [
    { status: "registration_open" },
    { status: "registration_open", registration_enabled: false },
    { status: "registration_open", is_invite_only: true },
    { status: "registration_open", registration_open_from: at(10) },
    { status: "registration_open", registration_open_until: at(-1) },
    { status: "registration_open", registration_open_from: at(-10), registration_open_until: at(10) },
    { status: "scheduled" },
    { status: "draft" },
  ];
  for (const tournament of cases) {
    expect(registrationOpen(tournament, NOW), JSON.stringify(tournament)).toBe(getRegistrationState(tournament, "Anmeldung", NOW).canRegister);
  }
  // Die Uhr des TVs zählt, nicht die des Geräts: zehn Minuten später ist die Anmeldung zu.
  const until = { status: "registration_open", registration_open_until: at(5) };
  expect(registrationOpen(until, NOW)).toBe(true);
  expect(registrationOpen(until, NOW + 10 * 60000)).toBe(false);
  expect(getRegistrationState(until, "Anmeldung", NOW + 10 * 60000).canRegister).toBe(false);
});

test("Pause: Weiter um 14:30 mit Countdown, ohne Uhrzeit nur „Kurze Pause“, danach „Gleich geht es weiter“", () => {
  const running = pauseView({ status: "paused", paused_until: at(12.5) }, [], NOW);
  expect(running.state).toBe("running");
  expect(running.headline).toBe("Weiter um 14:44");
  expect(running.seconds).toBe(750);
  expect(pauseClock(running.seconds)).toBe("12:30");
  expect(pauseView({ status: "paused" }, [], NOW)).toMatchObject({ state: "open", headline: "Kurze Pause", seconds: null });
  const over = pauseView({ status: "paused", paused_until: at(-2) }, [], NOW);
  expect(over).toMatchObject({ state: "over", headline: "Gleich geht es weiter", seconds: 0 });
  expect(pauseClock(3725)).toBe("1:02:05");
});

test("was nach der Pause kommt: zuerst ein Aufruf, dann das nächste eingeplante Spiel", () => {
  const bracket = singleElimination(8);
  expect(nextUp(bracket.matches_v2).text).toBe("Winner Bracket, Runde 1 · Spiel A");
  call(bracket, "C", { station: "PC 3", calledAt: at(-1) });
  expect(nextUp(bracket.matches_v2).text).toBe("Winner Bracket, Runde 1 · Spiel C an PC 3");
  expect(nextUp([])).toBeNull();
});

test("Check-in: alle Bestätigten mit Haken oder ohne, „Alle da“ erst wenn wirklich alle da sind", () => {
  const regs = [
    { id: "r1", display_name: "NeonFalke", status: "checked_in" },
    { id: "r2", display_name: "KartKönigin", status: "approved" },
    { id: "r3", display_name: "Warteliste Willi", status: "waitlist" },
    { id: "r4", display_name: "Offen Otto", status: "pending" },
  ];
  const view = checkInView({ check_in_until: at(13) }, regs);
  expect(view.people.map((person) => `${person.name}:${person.present}`)).toEqual(["KartKönigin:false", "NeonFalke:true"]);
  expect(view).toMatchObject({ present: 1, total: 2, allPresent: false });
  expect(view.closesText).toBe("Check-in schließt um 14:45.");
  expect(checkInView({}, regs.map((reg) => ({ ...reg, status: reg.status === "approved" ? "checked_in" : reg.status }))).allPresent).toBe(true);
  expect(checkInView({}, []).allPresent).toBe(false);
});

test("Anmeldung: freie Plätze aus der Zahl vom Server, Beginn mit Tag", () => {
  const view = registrationView({ max_participants: 16, start_date: "2026-10-18T14:00:00+02:00", registration_open_until: "2026-10-17T20:00:00+02:00" }, { taken: 10, capacity: 16 }, [], NOW);
  expect(view.seatsText).toBe("Noch 6 von 16 Plätzen frei");
  expect(view).toMatchObject({ capacity: 16, taken: 10, free: 6 });
  expect(view.startText).toBe("Sonntag, 18. Oktober · 14:00");
  expect(view.untilText).toBe("Anmeldung bis Samstag, 17. Oktober · 20:00");
  expect(registrationView({ max_participants: 8 }, { taken: 9, capacity: 8 }).seatsText).toBe("Alle 8 Plätze vergeben – Warteliste offen");
  expect(registrationView({}, null, [{ status: "approved" }]).seatsText).toBe("");
  expect(dayAndTime(at(30), NOW)).toBe("Heute · 15:02");
});

test("nach dem Check-in-Ende (#1551) zeigt der TV wieder die Wiedergabeliste, auch wenn der Status noch Check-in ist", () => {
  expect(tvScreenFor({ status: "check_in", check_in_closed_at: at(-2) }, { now: NOW })).toBe("playlist");
});
