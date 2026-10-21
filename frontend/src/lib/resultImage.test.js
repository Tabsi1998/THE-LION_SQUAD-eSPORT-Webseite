import { afterEdit, checkImageFile, confirmRow, imageFormFields, imageFromClipboard, imageHeader, imageToRows, isUncertain, openImageItems, openImageRows, uncertainText } from "@/lib/resultImage";
import { formToPayload } from "@/lib/referenceResults";
import { resultImageOptions } from "@/lib/referenceSeries";

// Ergebnis-Bild auslesen (#1756): Antwort des Servers → Zeilen des Blatts, gelbe Felder und ihr Ende. Nur erfundene Namen.

const PARTICIPANTS = [
  { id: "p1", name: "Anna Probe", start_number: "7", default_team: "Rotor Racing" },
  { id: "p2", name: "Bert Bolzt", start_number: "12", default_team: "Blaupfeil GP" },
];

const RESULT = {
  template: { id: "rennliga-dunkel", name: "Rennliga-Ergebnis (dunkel)" },
  rows: [
    { index: 0, place: 1, dnf: false, marks: [], start_number: "7", name: "Anna Probe", participant_id: "p1", team: "Rotor Racing", grid: 2, time: "1:32:15.123", gap: null, uncertain: [], read: {} },
    { index: 1, place: 2, dnf: false, marks: [], start_number: "12", name: "Bert Bolzt", participant_id: "p2", team: "Blaupfeil GP", grid: 1, time: "1:32:17.456", gap: "+2.333", uncertain: ["start_number", "time"], read: { start_number: "18" } },
    { index: 2, place: null, dnf: true, marks: ["dnf"], start_number: "31", name: "Dora Neu", participant_id: null, team: "Kometen Team", grid: 3, time: null, gap: null, uncertain: ["name"], read: { name: "Dora Nev" } },
  ],
  track: { name: "Probering Nord", uncertain: [] },
  fastest_lap: { name: "Bert Bolzt", participant_id: "p2", time: "1:31.207", uncertain: [] },
  driver_of_the_day: { name: "Anna Probe", participant_id: "p1", uncertain: ["name"] },
  uncertain_rows: 2,
  warnings: [],
};

test("die gelesenen Zeilen werden Zeilen des Blatts – mit Kennung, Marken, Ausfall ohne Platz und den Zusatzfeldern", () => {
  const rows = imageToRows(RESULT, PARTICIPANTS);
  expect(rows.map((row) => [row.participant_id, row.name, row.place, row.team, row.start_number])).toEqual([
    ["p1", "Anna Probe", "1", "Rotor Racing", "7"],
    ["p2", "Bert Bolzt", "2", "Blaupfeil GP", "12"],
    ["", "Dora Neu", "", "Kometen Team", "31"],
  ]);
  // Startplatz, Zeit und Abstand gehen in die Zeile (#1927); die schnellste Runde ist ein Feld des Rennens, keine Marke.
  expect(rows[1].marks).toEqual([]);
  expect([rows[1].grid, rows[1].time, rows[1].gap]).toEqual(["1", "1:32:17.456", "+2.333"]);
  expect([rows[2].marks, rows[2].no_place]).toEqual([["dnf"], true]);
  // Gelb sind die Felder, die das Blatt zeigt – auch Startplatz, Zeit und Abstand.
  expect(rows.map((row) => row.ocr?.uncertain || [])).toEqual([[], ["start_number", "time"], ["name"]]);
  expect(openImageRows(rows)).toBe(2);
  // Im Body an den Server: Ausfall ohne Platz, Kennungen, Rennfelder; keine Felder aus dem Bild, die das Blatt nicht kennt.
  const { payload } = formToPayload({ rows, matches: [], table: [], teamTotals: {}, note: "", ...imageFormFields(RESULT) });
  expect(payload.rows.map((row) => [row.participant_id || row.name, row.place, row.marks])).toEqual([
    ["p1", 1, []], ["p2", 2, []], ["Dora Neu", null, ["dnf"]],
  ]);
  expect([payload.rows[1].grid, payload.rows[1].time, payload.rows[1].gap]).toEqual([1, "1:32:17.456", "+2.333"]);
  expect(payload.fastest_lap).toEqual({ participant_id: "p2", time: "1:31.207" });
  expect(payload.driver_of_the_day).toEqual({ participant_id: "p1" });
  expect(payload.rows[0]).not.toHaveProperty("ocr");
  expect(payload.rows[0]).not.toHaveProperty("color");
});

test("unsichere schnellste Runde oder Fahrer des Tages sind gelbe Felder des Rennens und halten das Übernehmen auf", () => {
  const fields = imageFormFields({ ...RESULT, fastest_lap: { name: "Bert Bolzt", participant_id: "p2", time: "4:31.207", uncertain: ["time"], read: "Bert Bolzt 431,207" } });
  expect(fields.fastestLap).toEqual({ name: "Bert Bolzt", time: "4:31.207" });
  expect(fields.raceOcr).toEqual({ uncertain: ["fastest_lap_time", "driver_of_the_day"], read: { fastest_lap_time: "Bert Bolzt 431,207" } });
  const rows = imageToRows(RESULT, PARTICIPANTS);
  expect(openImageItems({ rows, ...fields })).toBe(3);
  expect(uncertainText({ ocr: fields.raceOcr })).toBe("Rundenzeit (gelesen „Bert Bolzt 431,207“), Fahrer des Tages");
  // Ändern nimmt die Markierung vom Feld; ohne gelbe Felder zählt das Rennen nicht mehr mit.
  const after = afterEdit({ ocr: fields.raceOcr }, ["fastest_lap_time", "driver_of_the_day"]).ocr;
  expect(after).toBeNull();
  expect(openImageItems({ rows, raceOcr: after })).toBe(2);
});

test("Punkte aus dem Bild gehen als Punkte laut Veranstalter mit; die Art der Sitzung steht im Kopf", () => {
  const rows = imageToRows({ ...RESULT, rows: [{ ...RESULT.rows[0], points: 25, color: "#e62832" }] }, PARTICIPANTS);
  expect([rows[0].points, rows[0].color]).toEqual(["25", "#e62832"]);
  const { payload } = formToPayload({ rows, matches: [], table: [], teamTotals: {}, note: "" });
  expect([payload.rows[0].points, payload.rows[0].points_source]).toEqual([25, "organizer"]);
  expect(imageHeader({ rows: [], track: { name: "Probering", uncertain: [] }, session: { name: "Qualifying", kind: "qualifying" } })).toEqual([
    { key: "track", label: "Strecke", value: "Probering", uncertain: false },
    { key: "session", label: "Art", value: "Qualifying", uncertain: false },
  ]);
});

test("Pole aus dem Kopf des Bilds wird Marke an der Zeile; unsicherer Fahrer macht die Marken gelb", () => {
  const rows = imageToRows({ ...RESULT, pole: { name: "Anna Probe", participant_id: "p1", time: "1:30.000", uncertain: [] } }, PARTICIPANTS);
  expect([rows[0].marks, rows[0].ocr]).toEqual([["pole"], null]);
  const unsure = imageToRows({ ...RESULT, pole: { name: "Anna Probe", participant_id: "p1", time: null, uncertain: ["name"] } }, PARTICIPANTS);
  expect(unsure[0].ocr.uncertain).toEqual(["marks"]);
  expect(imageHeader({ rows: [], pole: { name: "Anna Probe", time: "1:30.000", uncertain: [] } })).toEqual([
    { key: "pole", label: "Pole", value: "Anna Probe · 1:30.000", uncertain: false },
  ]);
});

test("ein nicht gelesener Platz ist immer gelb – die Reihenfolge, die das Blatt einsetzt, ist nur geschätzt", () => {
  const rows = imageToRows({ ...RESULT, rows: [
    { ...RESULT.rows[0], place: null, uncertain: [] },
    { ...RESULT.rows[2], place: null, uncertain: [] },
  ] }, PARTICIPANTS);
  // Ohne Platz und ohne Ausfall: gelb, auch wenn der Server es nicht sagt. Ein Ausfall hat keinen Platz – nicht gelb.
  expect(rows[0].ocr.uncertain).toEqual(["place"]);
  expect([rows[1].no_place, rows[1].ocr]).toEqual([true, null]);
  // Erst wer den Platz einträgt oder „Passt so“ drückt, hat ihn geprüft.
  expect(afterEdit(rows[0], ["place"]).ocr).toBeNull();
});

test("ändern nimmt die gelbe Markierung vom Feld, „Passt so“ von der Zeile", () => {
  const [, bert, dora] = imageToRows(RESULT, PARTICIPANTS);
  expect(isUncertain(bert, "start_number")).toBe(true);
  expect(afterEdit(bert, ["team"]).ocr.uncertain).toEqual(["start_number", "time"]);
  expect(afterEdit(bert, ["start_number"]).ocr.uncertain).toEqual(["time"]);
  expect(afterEdit(bert, ["start_number", "time"]).ocr).toBeNull();
  // Ein anderer Teilnehmer (nur die Kennung wechselt) gilt als geprüfter Name.
  expect(afterEdit(dora, ["participant_id"]).ocr).toBeNull();
  expect(confirmRow(bert).ocr).toBeNull();
  const plain = { key: "x", name: "Ohne Bild", ocr: null };
  expect(afterEdit(plain, ["name"])).toBe(plain);
  expect(uncertainText(bert)).toBe("Startnummer (gelesen „18“), Zeit");
  expect(uncertainText(dora)).toBe("Name (gelesen „Dora Nev“)");
});

test("Kopf des Bilds als Felder des Blatts (schnellste Runde, Fahrer des Tages)", () => {
  expect(imageFormFields(RESULT)).toEqual({
    fastestLap: { name: "Bert Bolzt", time: "1:31.207" }, driverOfTheDay: "Anna Probe",
    raceOcr: { uncertain: ["driver_of_the_day"], read: {} },
  });
  expect(imageFormFields({ rows: [], fastest_lap: null, driver_of_the_day: null })).toEqual({ raceOcr: null });
});

test("Kopf des Bilds für die Übersicht", () => {
  expect(imageHeader(RESULT)).toEqual([
    { key: "track", label: "Strecke", value: "Probering Nord", uncertain: false },
    { key: "fastest_lap", label: "Schnellste Rennrunde", value: "Bert Bolzt · 1:31.207", uncertain: false },
    { key: "driver_of_the_day", label: "Fahrer des Tages", value: "Anna Probe", uncertain: true },
  ]);
  expect(imageHeader({ rows: [] })).toEqual([]);
});

test("Bild aus der Zwischenablage – Text bleibt Text", () => {
  const png = new File(["x"], "bild.png", { type: "image/png" });
  expect(imageFromClipboard({ clipboardData: { files: [png], items: [] } })).toBe(png);
  expect(imageFromClipboard({ clipboardData: { files: [], items: [{ kind: "file", type: "image/webp", getAsFile: () => png }] } })).toBe(png);
  expect(imageFromClipboard({ clipboardData: { files: [], items: [{ kind: "string", type: "text/plain" }] } })).toBeNull();
  expect(imageFromClipboard({})).toBeNull();
});

test("vorab im Browser: nur PNG, JPG oder WebP und nicht zu groß", () => {
  expect(checkImageFile(new File(["x"], "a.png", { type: "image/png" }), 1)).toBeNull();
  expect(checkImageFile(new File(["x"], "a.heic", { type: "image/heic" }))).toMatch(/Nur PNG, JPG oder WebP/);
  const big = new File(["x"], "a.jpg", { type: "image/jpeg" });
  Object.defineProperty(big, "size", { value: 3 * 1024 * 1024 });
  expect(checkImageFile(big, 2)).toBe("Das Bild ist zu groß (höchstens 2 MB).");
  expect(checkImageFile(null)).toBe("Kein Bild gefunden.");
});

test("Vorlage je Spur und Saison: Auswahl nur, wo eine passt", () => {
  expect(resultImageOptions("racing")).toEqual([
    ["", "Standard: Rennliga-Ergebnis (dunkel)"], ["rennliga-dunkel", "Rennliga-Ergebnis (dunkel)"], ["none", "Aus – kein Auslesen"],
  ]);
  expect(resultImageOptions("racing", { inherit: true })[0]).toEqual(["", "Wie bei der Spur"]);
  expect(resultImageOptions("team_league")).toEqual([]);
  expect(resultImageOptions("team_league", { value: "rennliga-dunkel" })[0]).toEqual(["", "Keine Vorlage"]);
});
