import { cardExpired, refreshDelayMs, validUntilLine, type MemberCard } from "./memberCard";
import { qrRows } from "./qr";

// Mitgliedskarte (#346): der Code erneuert sich vor Ablauf; der QR-Code ist echt lesbar aufgebaut.

const valid: MemberCard = {
  status: "valid", club_name: "THE LION SQUAD", name: "Paula", member_number: "TLS-0007", type_label: "Ordentliches Mitglied",
  verify_url: "https://lionsquad.at/karte/pruefen/abcDEF123456xyz0", token_expires_at: "2026-09-22T10:05:00Z",
};

test("erneuern eine Minute vor Ablauf, nie schneller als alle 15 Sekunden", () => {
  const now = new Date("2026-09-22T10:00:00Z").getTime();
  expect(refreshDelayMs(valid, now)).toBe(4 * 60 * 1000);
  expect(refreshDelayMs(valid, now + 4.5 * 60 * 1000)).toBe(15 * 1000);
  expect(refreshDelayMs({ status: "none", club_name: "x" }, now)).toBeNull();
  expect(refreshDelayMs(null, now)).toBeNull();
});

test("abgelaufen erkennt die App selbst", () => {
  expect(cardExpired(valid, new Date("2026-09-22T10:04:59Z").getTime())).toBe(false);
  expect(cardExpired(valid, new Date("2026-09-22T10:05:00Z").getTime())).toBe(true);
  expect(cardExpired({ status: "ended", club_name: "x" })).toBe(false);
});

test("gültig bis: Datum oder solange die Mitgliedschaft besteht", () => {
  expect(validUntilLine(valid)).toBe("Gültig, solange die Mitgliedschaft besteht");
  expect(validUntilLine({ ...valid, valid_until: "2026-12-31" })).toBe("Gültig bis 31.12.2026");
  expect(validUntilLine({ status: "none", club_name: "x" })).toBe("");
});

test("QR-Matrix: quadratisch, mit Suchmustern in den Ecken, als Strichfolgen", () => {
  const { size, rows } = qrRows(valid.verify_url);
  expect(size).toBeGreaterThanOrEqual(21);
  expect(size % 4).toBe(1);
  expect(rows).toHaveLength(size);
  // Suchmuster oben links: erste Zeile beginnt mit sieben dunklen Feldern.
  expect(rows[0][0]).toEqual([0, 7]);
  // Und oben rechts: die letzten sieben Felder der ersten Zeile sind dunkel.
  expect(rows[0][rows[0].length - 1]).toEqual([size - 7, 7]);
  // Jede Strichfolge liegt innerhalb der Matrix.
  for (const runs of rows) for (const [start, length] of runs) expect(start + length).toBeLessThanOrEqual(size);
});
