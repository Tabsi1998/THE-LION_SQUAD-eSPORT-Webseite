import { eventFacts } from "./eventPage";
import { formToMinimum, minimumChip, minimumFact, minimumFormError, minimumSummary, minimumToForm, minimumUnit, reasonProblem } from "./eventMinimum";

// Mindestanzahl bis zu einer Frist (#2614): die Wörter für Event-Seite und Verwaltung. Feste Uhr, Frist in Wiener Zeit.
const NOW = new Date("2026-12-01T10:00:00Z");
const DEADLINE = "2026-12-18T17:00:00+00:00"; // Fr 18. Dezember, 18:00 in Wien

const view = (patch = {}) => ({ count: 8, have: 5, missing: 3, companions: 2, deadline: DEADLINE, count_companions: false, public: true, deadline_passed: false, state: "open", ...patch });

test("Event-Seite: „Findet ab 8 Anmeldungen statt“ und darunter, wie viele bis wann fehlen", () => {
  expect(minimumFact({ minimum: view(), status: "registration_open" }, { now: NOW })).toEqual({
    key: "minimum", label: "Mindestzahl", title: "Findet ab 8 Anmeldungen statt", lines: ["Noch 3 bis Fr 18. Dezember · 18:00"],
  });
});

test("zählen Begleitpersonen mit, heißt es Personen", () => {
  expect(minimumFact({ minimum: view({ count_companions: true }) }, { now: NOW }).title).toBe("Findet ab 8 Personen statt");
  expect(minimumUnit(true, 1)).toBe("Person");
  expect(minimumUnit(false, 1)).toBe("Anmeldung");
});

test("erreicht bzw. nach der Frist nicht erreicht: eigener Satz, nie eine Zusage", () => {
  expect(minimumFact({ minimum: view({ state: "reached", missing: 0 }) }, { now: NOW }).lines).toEqual(["Mindestzahl erreicht."]);
  expect(minimumFact({ minimum: view({ state: "short", deadline_passed: true }) }, { now: NOW }).lines[0]).toContain("der Verein entscheidet");
});

test("keine Zeile ohne Mindestzahl, nach der Absage und nach dem Event", () => {
  expect(minimumFact({}, { now: NOW })).toBeNull();
  expect(minimumFact({ minimum: view(), status: "cancelled" }, { now: NOW })).toBeNull();
  expect(minimumFact({ minimum: view() }, { now: NOW, over: true })).toBeNull();
});

test("Fakten-Kasten: die Zeile steht nach dem Eintritt", () => {
  const rows = eventFacts({ start_date: "2026-12-31T17:00:00Z", minimum: view(), bring_along: ["Schlitten"] }, { now: NOW });
  expect(rows.map((row) => row.key)).toEqual(["when", "entry", "minimum", "bring"]);
  expect(eventFacts({ start_date: "2026-12-31T17:00:00Z" }, { now: NOW }).map((row) => row.key)).toEqual(["when", "entry"]);
});

test("Verwaltung: Schild ohne „live“ und der Stand in einem Satz", () => {
  expect(minimumChip(view())).toEqual({ kind: "waiting", label: "Noch offen" });
  expect(minimumChip(view({ state: "reached" }))).toEqual({ kind: "joined", variant: "quiet", label: "Erreicht" });
  expect(minimumChip(view({ state: "short" }))).toEqual({ kind: "problem", label: "Zu wenige" });
  expect(minimumSummary(view({ count_companions: true, have: 7 }), { now: NOW })).toBe("7 von 8 Personen (davon 2 Begleitpersonen) · Frist Fr 18. Dezember · 18:00");
  expect(minimumSummary(view({ deadline_passed: true }), { now: NOW })).toBe("5 von 8 Anmeldungen · Frist war Fr 18. Dezember · 18:00");
});

test("Formular: aus und wieder hin - null heißt keine Mindestzahl", () => {
  expect(minimumToForm(null)).toEqual({ enabled: false, count: "", deadline: "", count_companions: true, public: true });
  const form = minimumToForm({ count: 8, deadline: DEADLINE, count_companions: false, public: false });
  expect(form.enabled).toBe(true);
  expect(formToMinimum(form)).toEqual({ count: 8, deadline: new Date(DEADLINE).toISOString(), count_companions: false, public: false });
  expect(formToMinimum({ ...form, enabled: false })).toBeNull();
});

test("Formular-Prüfung wie am Server: Zahl, Frist, vor dem Beginn, nicht mehr als Plätze", () => {
  const form = { enabled: true, count: "8", deadline: "2026-12-18T18:00", count_companions: true, public: true };
  expect(minimumFormError(form, { startDate: "2026-12-31T18:00", maxParticipants: "20" })).toBe("");
  expect(minimumFormError({ ...form, count: "0" })).toContain("ab 1");
  expect(minimumFormError({ ...form, deadline: "" })).toContain("Frist eintragen");
  expect(minimumFormError(form, { startDate: "2026-12-18T17:00" })).toContain("vor dem Beginn");
  expect(minimumFormError(form, { maxParticipants: "6" })).toContain("mehr als die Plätze (6)");
  expect(minimumFormError({ ...form, enabled: false, count: "" })).toBe("");
});

test("Grund der Absage: mindestens fünf Zeichen", () => {
  expect(reasonProblem("  kurz ")).toContain("mindestens 5 Zeichen");
  expect(reasonProblem("Zu wenige Anmeldungen")).toBe("");
});
