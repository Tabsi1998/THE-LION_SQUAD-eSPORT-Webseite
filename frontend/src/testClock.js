// Feste Uhr für Tests mit Datums-Texten (#1307): Die eine Form „Sa 23. Mai · 18:00“ lässt das Jahr weg, solange es das
// laufende ist, und sagt „heute“ und „morgen“. Ein Test, der solche Texte prüft, läuft darum an einem festen Tag - sonst
// kippt er zum Jahreswechsel oder in der Zeitreise-Probe (setupZeitreise.js). Wie dort läuft die Uhr ab dem Zeitpunkt
// weiter (keine stehende Uhr); Tests, die selbst vi.useFakeTimers/vi.setSystemTime nehmen, behalten ihre Zeit.
import { afterAll, beforeAll, beforeEach } from "vitest";
import { shiftedDateClass } from "./setupZeitreise";

/** Der feste Tag der Datums-Tests: Samstag, 28. November 2026, 11:00 in Wien. */
export const TEST_NOW = "2026-11-28T10:00:00Z";

export function runAtTestClock(iso = TEST_NOW) {
  let before;
  let shifted;
  beforeAll(() => {
    before = globalThis.Date;
    shifted = shiftedDateClass(iso, before);
    globalThis.Date = shifted;
  });
  // vi.useRealTimers() stellt das Date zurück, das vor vi.useFakeTimers() galt - nach einem Test ohne Fake-Timer gilt
  // wieder der feste Tag.
  beforeEach(() => {
    if (globalThis.Date === before) globalThis.Date = shifted;
  });
  afterAll(() => {
    globalThis.Date = before;
  });
}
