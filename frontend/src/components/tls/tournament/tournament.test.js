import { countdownText, stepCountdown, timelineHeadline, timelineSteps } from "./TournamentTimeline";
import { paymentLine } from "./MyStandCard";
import { tournamentTabs } from "./TournamentTabs";

// Turnierseite (#401): Zeitleiste, Countdown in Worten, Zahlungszeile und Reiter-Adressen.

const NOW = Date.parse("2026-09-24T12:00:00+00:00");

test("timelineSteps sortiert die Termine, markiert vergangene und genau den nächsten", () => {
  const steps = timelineSteps({ registration_open_from: "2026-09-01T10:00:00+00:00", registration_open_until: "2026-10-01T18:00:00+00:00", start_date: "2026-10-04T18:00:00+00:00", check_in_from: null, end_date: "kaputt" }, NOW);
  expect(steps.map((s) => s.key)).toEqual(["registration_open", "registration_close", "start"]);
  expect(steps.map((s) => s.past)).toEqual([true, false, false]);
  expect(steps.map((s) => s.next)).toEqual([false, true, false]);
  expect(timelineSteps({}, NOW)).toEqual([]);
});

// Zeitleiste nach Status und Phase (#1938): Vergangenes abgehakt, Laufendes „läuft“, ein Countdown nur für Kommendes.
const LIVE = Date.parse("2026-10-21T08:50:00+00:00");
const at = (minutes) => new Date(LIVE + minutes * 60000).toISOString();
const view = (steps) => steps.map((s) => `${s.key}:${s.running ? "läuft" : s.past ? "vorbei" : s.next ? "nächster" : "kommt"}`);

test("Generalprobe 3: Check-in von Hand, Start vor der Planzeit - nichts lädt mehr zum Check-in ein", () => {
  const t = {
    status: "live", public_phase: { state: "live" }, registration_open_from: at(-75), check_in_from: at(6),
    check_in_until: at(-2), check_in_closed_at: at(-1), start_date: at(10), end_date: at(400),
  };
  const steps = timelineSteps(t, LIVE);
  expect(view(steps)).toEqual(["registration_open:vorbei", "checkin_close:vorbei", "start:läuft", "end:nächster"]);
  expect(steps.find((s) => s.running).label).toBe("Turnier läuft");
  expect(timelineHeadline(steps, LIVE)).toBe("Ende heute 17:30");
});

test("Check-in läuft (vor der Planzeit geöffnet): Öffnung „läuft“, das Ende ist der nächste Termin", () => {
  const t = { status: "check_in", public_phase: { state: "check_in" }, check_in_from: at(-1), check_in_until: at(10), start_date: at(20) };
  const steps = timelineSteps(t, LIVE);
  expect(view(steps)).toEqual(["checkin_open:läuft", "checkin_close:nächster", "start:kommt"]);
  expect(steps[0].label).toBe("Check-in läuft");
  expect(timelineHeadline(steps, LIVE)).toBe("Check-in endet in 10 Minuten");
});

test("Check-in beendet, Baum steht: Check-in abgehakt, der Start kommt", () => {
  const t = { status: "check_in", public_phase: { state: "registration_closed" }, check_in_from: at(-30), check_in_until: at(-1), check_in_closed_at: at(-1), start_date: at(40) };
  expect(view(timelineSteps(t, LIVE))).toEqual(["checkin_open:vorbei", "checkin_close:vorbei", "start:nächster"]);
});

test("von Hand beendet: alles abgehakt, auch ein Ende, das noch vor uns lag", () => {
  const t = { status: "completed", public_phase: { state: "completed" }, start_date: at(-120), end_date: at(60) };
  const steps = timelineSteps(t, LIVE);
  expect(view(steps)).toEqual(["start:vorbei", "end:vorbei"]);
  expect(timelineHeadline(steps, LIVE)).toBe("Alle Termine vorbei");
});

test("Anmeldung offen: „läuft“, Countdown bis zum Ende der Anmeldung; ohne Ende sagt der Kopf „läuft“", () => {
  const t = { status: "registration_open", public_phase: { state: "registration_open" }, registration_open_from: at(-600), registration_open_until: at(3 * 1440), start_date: at(4 * 1440) };
  const steps = timelineSteps(t, LIVE);
  expect(view(steps)).toEqual(["registration_open:läuft", "registration_close:nächster", "start:kommt"]);
  expect(steps[0].label).toBe("Anmeldung läuft");
  const live = timelineSteps({ status: "live", public_phase: { state: "live" }, start_date: at(-5) }, LIVE);
  expect(view(live)).toEqual(["start:läuft"]);
  expect(timelineHeadline(live, LIVE)).toBe("Turnier läuft");
});

test("countdownText folgt der einen Regel (#1264): ohne Abkürzungen, weit weg Datum oder Monat", () => {
  expect(countdownText(NOW - 1, NOW)).toBe("jetzt");
  expect(countdownText(NOW + 5 * 60000, NOW)).toBe("in 5 Minuten");
  expect(countdownText(NOW + 3 * 3600000, NOW)).toBe("heute 17:00");
  expect(countdownText(NOW + 7 * 86400000, NOW)).toBe("in 7 Tagen");
  expect(countdownText(Date.parse("2026-10-30T12:00:00+00:00"), NOW)).toBe("Fr 30. Oktober");
  expect(countdownText(Date.parse("2026-10-30T12:00:00+00:00"), NOW, 40)).toBe("in 36 Tagen");
});

test("stepCountdown: der Schritt mit seiner Zeitangabe - „Start im März“, „Anmeldung endet am Fr 30. Oktober“", () => {
  expect(stepCountdown({ label: "Start", ms: Date.parse("2027-03-01T12:00:00+00:00") }, NOW)).toBe("Start im März");
  expect(stepCountdown({ label: "Anmeldung endet", ms: Date.parse("2026-10-30T12:00:00+00:00") }, NOW)).toBe("Anmeldung endet am Fr 30. Oktober");
  expect(stepCountdown({ label: "Check-in öffnet", ms: Date.parse("2026-09-25T15:00:00+00:00") }, NOW)).toBe("Check-in öffnet morgen 17:00");
  expect(stepCountdown(null, NOW)).toBe("");
});

test("paymentLine nennt Betrag und Zahlungsstand", () => {
  expect(paymentLine(null)).toBeNull();
  expect(paymentLine({ total_cents: 1000, currency: "EUR", billing_status: "pending" })).toBe("10,00 € · die Rechnung kommt unter „Meine Rechnungen“");
  expect(paymentLine({ total_cents: 1000, currency: "EUR", billing_status: "pending", invoice_ref: "RE-7", invoice_status: "validated" })).toBe("10,00 € · Rechnung RE-7 offen – unter „Meine Rechnungen“");
  expect(paymentLine({ total_cents: 1000, currency: "EUR", billing_status: "paid", invoice_ref: "RE-7" })).toBe("10,00 € · Rechnung RE-7 bezahlt – danke!");
  expect(paymentLine({ total_cents: 1000, currency: "EUR", billing_status: "cancelled" })).toBe("10,00 € · storniert");
});

test("tournamentTabs tragen den Zugangscode weiter und zählen Teilnehmer", () => {
  const tabs = tournamentTabs({ id: "t1", slug: "cup" }, "abc def", 4);
  expect(tabs.map((t) => t.to)).toEqual(["/tournaments/cup?access=abc%20def", "/tournaments/cup?access=abc%20def#teilnehmer", "/tournaments/cup/matches?access=abc%20def", "/tournaments/cup/standings?access=abc%20def", "/tournaments/cup/bracket?access=abc%20def"]);
  expect(tabs[1].label).toBe("Teilnehmer (4)");
  expect(tabs.find((t) => t.key === "bracket").match("/tournaments/cup/bracket")).toBe(true);
  expect(tabs.find((t) => t.key === "overview").match("/tournaments/cup/bracket")).toBe(false);
  expect(tournamentTabs({ id: "t1" })[0].to).toBe("/tournaments/t1");
});

test("ohne Turnierbaum (#2124): Jeder gegen jeden, Liga, Zeitfahren und Rennserie haben keinen Reiter „Turnierbaum“", () => {
  for (const format of ["round_robin", "league", "time_trial", "grand_prix"]) {
    expect(tournamentTabs({ id: "t1", slug: "cup", format }).map((tab) => tab.key)).not.toContain("bracket");
  }
  for (const format of ["single_elim", "double_elim", "swiss", "groups", "ffa", undefined]) {
    expect(tournamentTabs({ id: "t1", slug: "cup", format }).map((tab) => tab.key)).toContain("bracket");
  }
});
test("Turnierbaum vom Server (#2124, Review B1): Jeder gegen jeden mit Playoff-Phase hat den Reiter doch", () => {
  expect(tournamentTabs({ id: "t1", slug: "cup", format: "round_robin", has_bracket_tree: true }).map((tab) => tab.key)).toContain("bracket");
  expect(tournamentTabs({ id: "t1", slug: "cup", format: "single_elim", has_bracket_tree: false }).map((tab) => tab.key)).not.toContain("bracket");
});