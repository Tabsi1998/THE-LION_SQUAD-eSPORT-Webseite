import { COUNTRY_OPTIONS, countryName, flagSrc } from "@/lib/countryFlags";
import { roundPayload, roundToForm } from "@/lib/referenceCalendar";

// Flagge je Termin (#1925): Name und Datei je Land, die Auswahl im Termin und was das Formular dem Server schickt.

test("ein Land hat seinen deutschen Namen und eine eigene Flagge, ein unbekanntes keines", () => {
  expect(countryName("IT")).toBe("Italien");
  expect(countryName("az")).toBe("Aserbaidschan");
  expect(countryName("XX")).toBe("");
  expect(countryName(null)).toBe("");
  expect(flagSrc("AZ")).toBe("/assets/flags/az.svg");
  expect(flagSrc("XX")).toBeNull();
  expect(flagSrc("")).toBeNull();
});

test("die Auswahl steht nach deutschem Namen, Umlaute wie ihr Grundbuchstabe", () => {
  const names = COUNTRY_OPTIONS.map(([, name]) => name);
  expect(names[0]).toBe("Argentinien");
  expect(names.indexOf("Österreich")).toBe(names.indexOf("Niederlande") + 1);
  expect(names.at(-1)).toBe("Vietnam");
  expect(COUNTRY_OPTIONS.every(([code]) => /^[A-Z]{2}$/.test(code))).toBe(true);
});

test("Termin: automatisch, ohne Flagge oder ein gewähltes Land", () => {
  expect(roundToForm({}, { day: "2026-06-18" }).country).toBe("auto");
  expect(roundToForm({ id: "r1", country_code: "IT", country_auto: true }).country).toBe("auto");
  expect(roundToForm({ id: "r1", country_code: "FR", country_auto: false }).country).toBe("FR");
  expect(roundToForm({ id: "r1", country_code: null, country_auto: false }).country).toBe("none");
  // Alte Termine ohne Angabe gelten als automatisch.
  expect(roundToForm({ id: "r1" }).country).toBe("auto");

  const form = roundToForm({}, { day: "2026-06-18" });
  expect(roundPayload({ ...form, country: "auto" })).toMatchObject({ country_auto: true });
  expect(roundPayload({ ...form, country: "auto" })).not.toHaveProperty("country_code");
  expect(roundPayload({ ...form, country: "none" })).toMatchObject({ country_auto: false, country_code: null });
  expect(roundPayload({ ...form, country: "AZ" })).toMatchObject({ country_auto: false, country_code: "AZ" });
});
