import {
  allowedText, divisionPlatformPayload, divisionPlatformToForm, platformLines, platformPayload, platformShort, platformToForm, platformWords,
} from "./leaguePlatform";

// Plattform je Season (#2270): Formular ↔ Anfrage und die Sätze für Kaderübersicht, Team-Seite und Anmeldung.

test("Plattformen lesen sich wie im Server", () => {
  expect(platformWords([])).toBe("");
  expect(platformWords(["PC"])).toBe("PC");
  expect(platformWords(["PC", "Xbox"])).toBe("PC und Xbox");
  expect(platformWords(["PC", "PlayStation", "Xbox"])).toBe("PC, PlayStation und Xbox");
  expect(allowedText([])).toBe("alle Plattformen");
  expect(allowedText(["PC"])).toBe("nur PC");
});

test("die Season: Plattformen in der Reihenfolge des Felds, ohne Feld keine Grenze, leer heißt keine Angabe", () => {
  const form = { ...platformToForm({}), platform_field: "platform", allowed_platforms: ["Xbox", "PC"], crossplay: "off", input_device: "both" };
  expect(platformPayload(form, ["PC", "PlayStation", "Xbox"])).toEqual({
    platform_field: "platform", allowed_platforms: ["PC", "Xbox"], crossplay: false, input_device: "both" });
  expect(platformPayload({ ...form, platform_field: "" }, ["PC"])).toEqual({ platform_field: null, allowed_platforms: [], crossplay: false, input_device: "both" });
  expect(platformPayload(platformToForm({}), [])).toEqual({ platform_field: null, allowed_platforms: [], crossplay: null, input_device: null });
  expect(platformToForm({ platform_field: "platform", allowed_platforms: ["PC"], crossplay: true, input_device: null })).toEqual({
    platform_field: "platform", allowed_platforms: ["PC"], crossplay: "on", input_device: "" });
});

test("Liga N: ohne Haken wie Season, mit Haken und leer alle erlaubt", () => {
  expect(divisionPlatformPayload(divisionPlatformToForm({}))).toEqual({});
  expect(divisionPlatformPayload({ ...divisionPlatformToForm({}), platform_own: true })).toEqual({ allowed_platforms: [] });
  const saved = { allowed_platforms: ["PlayStation"], crossplay: false, input_device: "controller" };
  expect(divisionPlatformPayload(divisionPlatformToForm(saved))).toEqual(saved);
  expect(divisionPlatformToForm({ best_of: 5 }).platform_own).toBe(false);
});

test("Sätze und Kurzfassung nennen nur, was gilt", () => {
  expect(platformLines(null)).toEqual([]);
  expect(platformLines({ allowed: [], crossplay: null, input_device: null })).toEqual([]);
  expect(platformLines({ field_label: "Plattform", allowed: ["PC"], crossplay: false, input_device: "mouse_keyboard" })).toEqual([
    "Plattform: nur PC.", "Crossplay: aus.", "Eingabegerät: Maus und Tastatur."]);
  expect(platformLines({ allowed: [], crossplay: true })).toEqual(["Crossplay: an, plattformübergreifend."]);
  expect(platformShort({ allowed: ["PC", "Xbox"], crossplay: true, input_device: "controller" })).toBe("nur PC und Xbox · Crossplay an · Controller");
  expect(platformShort({ allowed: [] })).toBe("alle Plattformen");
});
