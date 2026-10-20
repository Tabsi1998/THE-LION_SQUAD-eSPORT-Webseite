import fs from "fs";
import path from "path";
import { finishedMatchText, matchHeadline, slotName, slotStatusText, stationText } from "./matchText";

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

// Teilnehmerliste (#1870): der Zustand eines Platzes nie als Rohwert („Filled“). Wie die Website steht bei einem
// belegten, offenen oder Freilos-Platz keine eigene Zeile - das sagt schon der Name („NeonFalke“, „noch offen“,
// „Freilos“). Was darüber hinaus etwas sagt, steht deutsch; Unbekanntes gar nicht.
test.each([
  ["filled", ""],
  ["Filled", ""],
  ["pending", ""],
  ["bye", ""],
  ["checked_in", "Eingecheckt"],
  ["no_show", "Nicht erschienen"],
  ["withdrawn", "Zurückgezogen"],
  ["disqualified", "Disqualifiziert"],
  ["irgendwas_neues", ""],
  [null, ""],
])("Platz-Zustand %p → %p", (status, text) => {
  expect(slotStatusText(status)).toBe(text);
});
