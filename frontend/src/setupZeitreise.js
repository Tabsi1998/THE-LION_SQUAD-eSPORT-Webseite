// Zeitreise-Probe (#775): Mit TLS_TEST_NOW (ISO-Datum) laufen die Tests so, als wäre heute dieser Tag. So fällt
// vorher auf, welcher Test „von selbst“ rot wird, weil der echte Kalender einen festen Termin in den Testdaten
// überholt. Ohne die Variable ändert sich nichts.
//
// Verstellt wird nur das Datum, nicht die Timer, und die Uhr läuft ab dem Zeitpunkt weiter. Eine stehende Uhr
// (vi.setSystemTime ohne Fake-Timer) ließe Tests kippen, die auf vergangene Zeit warten, etwa useSpamGuard.
// Tests, die selbst die Uhr feststellen (vi.useFakeTimers, vi.setSystemTime), behalten ihre Zeit: Die Fake-Timer
// beginnen am verstellten Tag, ein fest gesetzter Tag gilt wie immer.
import { beforeEach } from "vitest";

const RealDate = globalThis.Date;

export function shiftedDateClass(target, RealDateClass = RealDate) {
  const offset = RealDateClass.parse(target) - RealDateClass.now();
  if (Number.isNaN(offset)) throw new Error(`TLS_TEST_NOW als ISO-Datum angeben, nicht "${target}"`);
  const now = () => RealDateClass.now() + offset;
  function ShiftedDate(...args) {
    // Ohne new liefert Date() wie das echte den Text der aktuellen Zeit.
    if (!new.target) return new RealDateClass(now()).toString();
    return Reflect.construct(RealDateClass, args.length ? args : [now()], new.target);
  }
  // Derselbe Prototyp: Auch Daten, die vor dem Umstellen oder von Bibliotheken angelegt wurden, sind „instanceof Date“.
  ShiftedDate.prototype = RealDateClass.prototype;
  Object.setPrototypeOf(ShiftedDate, RealDateClass);
  ShiftedDate.now = now;
  ShiftedDate.parse = RealDateClass.parse;
  ShiftedDate.UTC = RealDateClass.UTC;
  return ShiftedDate;
}

const target = (process.env.TLS_TEST_NOW || "").trim();

if (target) {
  const ShiftedDate = shiftedDateClass(target);
  globalThis.Date = ShiftedDate;
  // vi.useRealTimers() nach vi.setSystemTime() setzt das echte Date zurück; der nächste Test bekommt wieder den
  // verstellten Tag. Ein Date, das ein Test selbst gesetzt hat, bleibt unangetastet.
  beforeEach(() => {
    if (globalThis.Date === RealDate) globalThis.Date = ShiftedDate;
  });
}
