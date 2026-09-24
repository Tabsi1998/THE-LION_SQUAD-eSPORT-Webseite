import { countdownText, timelineSteps } from "./TournamentTimeline";
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

test("countdownText spricht in Minuten, Stunden oder Tagen", () => {
  expect(countdownText(NOW - 1, NOW)).toBe("jetzt");
  expect(countdownText(NOW + 5 * 60000, NOW)).toBe("in 5 Min.");
  expect(countdownText(NOW + 3 * 3600000, NOW)).toBe("in 3 Std.");
  expect(countdownText(NOW + 7 * 86400000, NOW)).toBe("in 7 Tagen");
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
