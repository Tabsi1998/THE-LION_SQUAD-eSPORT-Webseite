// Klartext auf der Matchseite (#1220, #1139): Website und App sagen dasselbe - beide lesen matchText.cases.json
// (App: mobile/src/lib/matchText.test.ts).
import cases from "./matchText.cases.json";
import { finishedMatchText, matchHeadline, slotName, stationText } from "./tournamentLabels";

test.each(cases.headline)("Überschrift: $text", ({ participants, match, text }) => {
  expect(matchHeadline(participants, match)).toBe(text);
});

test.each(cases.finished)("Beendet: $text", ({ participants, match, text }) => {
  expect(finishedMatchText(participants, match)).toBe(text);
});

test.each(cases.station)("Station: „$text“", ({ match, text }) => {
  expect(stationText(match)).toBe(text);
});

test.each(cases.slot)("Platz: $text", ({ name, slot, match, text }) => {
  expect(slotName(name, slot, match)).toBe(text);
});
