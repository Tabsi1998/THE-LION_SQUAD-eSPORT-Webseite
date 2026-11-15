/* eslint-env node */
// Zeitreise-Probe (#775): Testumgebung der App, wenn TLS_TEST_NOW gesetzt ist (jest.config.js wählt sie nur dann).
// Sie ist die Umgebung von jest-expo, nur mit verstelltem Date im Test. jest.useFakeTimers() ohne eigenes `now`
// beginnt am verstellten Tag statt am echten; Tests mit festem `now` behalten ihre Zeit.
const { shiftedDateClass } = require("./jest.zeitreise-date");

const Base = require(require("jest-expo/jest-preset").testEnvironment);

module.exports = class ZeitreiseEnvironment extends (Base.TestEnvironment || Base) {
  constructor(config, context) {
    super(config, context);
    const target = (process.env.TLS_TEST_NOW || "").trim();
    if (!target) return;
    // Das Date des Test-Kontexts, nicht das dieses Prozesses - sonst stimmte instanceof Date im Test nicht.
    const ShiftedDate = shiftedDateClass(target, this.global.Date);
    this.global.Date = ShiftedDate;
    const timers = this.fakeTimersModern;
    const useFakeTimers = timers.useFakeTimers.bind(timers);
    timers.useFakeTimers = (fakeTimersConfig = {}) =>
      useFakeTimers({ ...fakeTimersConfig, now: fakeTimersConfig.now ?? ShiftedDate.now() });
  }
};
