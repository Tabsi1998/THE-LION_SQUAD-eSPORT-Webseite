import fs from "fs";
import path from "path";
import { finishedMatchText, matchHeadline, slotName, stationText } from "./matchText";

// Klartext auf der Matchseite (#1139): dieselben Fälle wie auf der Website (frontend/src/lib/matchText.cases.json).
type Case = { participants?: any[]; match?: any; name?: string | null; slot?: any; text: string };
const CASES: Record<"headline" | "finished" | "station" | "slot", Case[]> = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../../frontend/src/lib/matchText.cases.json"), "utf8"),
);

test.each(CASES.headline)("Überschrift: $text", ({ participants, match, text }) => {
  expect(matchHeadline(participants, match)).toBe(text);
});

test.each(CASES.finished)("Beendet: $text", ({ participants, match, text }) => {
  expect(finishedMatchText(participants, match)).toBe(text);
});

test.each(CASES.station)("Station: „$text“", ({ match, text }) => {
  expect(stationText(match)).toBe(text);
});

test.each(CASES.slot)("Platz: $text", ({ name, slot, match, text }) => {
  expect(slotName(name, slot, match)).toBe(text);
});
