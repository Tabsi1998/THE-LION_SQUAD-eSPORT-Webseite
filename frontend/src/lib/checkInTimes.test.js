import { checkInLine, effectiveCheckIn } from "./checkInTimes";

// Wirksame Check-in-Zeiten (#1938): was wirklich galt, auch bei Turnieren, deren Zeiten nach einem Check-in von Hand
// nicht nachgezogen sind - nie „ab 10:56 bis 10:48“.

const NOW = Date.parse("2026-10-21T08:50:00+00:00");
const at = (minutes) => new Date(NOW + minutes * 60000).toISOString();

test("ohne Widerspruch gelten die eingestellten Zeiten", () => {
  expect(effectiveCheckIn({ status: "registration_closed", check_in_from: at(10), check_in_until: at(40) }, NOW)).toEqual({ from: at(10), until: at(40) });
  expect(effectiveCheckIn({ status: "check_in", check_in_from: at(-5), check_in_until: at(20) }, NOW)).toEqual({ from: at(-5), until: at(20) });
  expect(effectiveCheckIn({}, NOW)).toEqual({ from: null, until: null });
});

test("früher beendet: das wirkliche Ende statt der Planzeit", () => {
  const t = { status: "live", check_in_from: at(-30), check_in_until: at(10), check_in_closed_at: at(-2) };
  expect(effectiveCheckIn(t, NOW)).toEqual({ from: at(-30), until: at(-2) });
  // Zur Planzeit beendet (der Job schließt kurz danach): die Planzeit bleibt.
  expect(effectiveCheckIn({ ...t, check_in_until: at(-3), check_in_closed_at: at(-2) }, NOW).until).toBe(at(-3));
});

test("von Hand früher geöffnet, Beginn nicht nachgezogen: kein Beginn nach dem Ende, keiner in der Zukunft", () => {
  // Generalprobe 3: Check-in ab 10:56, „Check-in endet“ auf 10:48 gesetzt, Cup läuft.
  const gp3 = { status: "live", check_in_from: at(6), check_in_until: at(-2), check_in_closed_at: at(-1) };
  expect(effectiveCheckIn(gp3, NOW)).toEqual({ from: null, until: at(-2) });
  // Der Check-in läuft schon, die eingestellte Öffnung liegt noch vor uns.
  expect(effectiveCheckIn({ status: "check_in", check_in_from: at(5), check_in_until: at(20) }, NOW)).toEqual({ from: null, until: at(20) });
});

test("checkInLine: „ab … bis …“, nur „bis …“ oder nur „ab …“", () => {
  expect(checkInLine({ status: "check_in", check_in_from: "2026-10-21T08:45:00+00:00", check_in_until: "2026-10-21T08:55:00+00:00" }, NOW)).toBe("ab 21.10.2026, 10:45 bis 21.10.2026, 10:55");
  expect(checkInLine({ status: "live", check_in_from: at(6), check_in_until: "2026-10-21T08:48:00+00:00" }, NOW)).toBe("bis 21.10.2026, 10:48");
  expect(checkInLine({ status: "registration_open", check_in_from: "2026-10-21T09:00:00+00:00" }, NOW)).toBe("ab 21.10.2026, 11:00");
  expect(checkInLine({}, NOW)).toBe("");
});
