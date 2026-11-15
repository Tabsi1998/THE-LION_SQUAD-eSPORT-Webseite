/* eslint-env node */
// Zeitreise-Probe (#775): ein Date, das ab TLS_TEST_NOW weiterläuft. Gleiche Regeln wie im Web
// (frontend/src/setupZeitreise.js): nur das Datum springt, die Uhr steht nicht still, und es bleibt für instanceof
// dasselbe wie das echte Date.

function shiftedDateClass(target, RealDateClass) {
  const offset = RealDateClass.parse(target) - RealDateClass.now();
  if (Number.isNaN(offset)) throw new Error(`TLS_TEST_NOW als ISO-Datum angeben, nicht "${target}"`);
  const now = () => RealDateClass.now() + offset;
  function ShiftedDate(...args) {
    // Ohne new liefert Date() wie das echte den Text der aktuellen Zeit.
    if (!new.target) return new RealDateClass(now()).toString();
    return Reflect.construct(RealDateClass, args.length ? args : [now()], new.target);
  }
  ShiftedDate.prototype = RealDateClass.prototype;
  Object.setPrototypeOf(ShiftedDate, RealDateClass);
  ShiftedDate.now = now;
  ShiftedDate.parse = RealDateClass.parse;
  ShiftedDate.UTC = RealDateClass.UTC;
  return ShiftedDate;
}

module.exports = { shiftedDateClass };
