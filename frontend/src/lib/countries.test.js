import { COUNTRY_CODES, COUNTRY_OPTIONS, countryName, isCountryCode } from "./countries";

// Land als Auswahl (#258): ISO-Codes, deutsche Namen, Vereinsländer zuerst.

test("die Liste ist die ISO-3166-Liste ohne Doppelte", () => {
  expect(COUNTRY_CODES).toHaveLength(249);
  expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
  for (const code of COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/);
});

test("jeder Code bekommt einen deutschen Namen", () => {
  expect(countryName("AT")).toBe("Österreich");
  expect(countryName("DE")).toBe("Deutschland");
  expect(countryName("ch")).toBe("Schweiz");
  const unnamed = COUNTRY_CODES.filter((code) => countryName(code) === code);
  expect(unnamed).toEqual([]);
});

test("Österreich, Deutschland und Schweiz stehen vorne, der Rest ist alphabetisch", () => {
  expect(COUNTRY_OPTIONS.slice(0, 3).map((item) => item.code)).toEqual(["AT", "DE", "CH"]);
  const rest = COUNTRY_OPTIONS.slice(3).map((item) => item.name);
  const sorted = [...rest].sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" }));
  expect(rest).toEqual(sorted);
  expect(rest[0]).toBe("Afghanistan");
});

test("unbekannte Werte bleiben, wie sie sind", () => {
  expect(isCountryCode("Tirol")).toBe(false);
  expect(countryName("Tirol")).toBe("Tirol");
  expect(countryName("")).toBe("");
});
