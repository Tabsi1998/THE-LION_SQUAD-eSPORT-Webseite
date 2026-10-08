import { isDeputyPosition } from "./boardSeats";

test("Stellvertretungen erkennen - aus Dolibarr und von Hand", () => {
  expect(isDeputyPosition({ neutral_title: "Stellvertretung Kassier:in" })).toBe(true);
  expect(isDeputyPosition({ title_male: "Obmann-Stellvertreter" })).toBe(true);
  expect(isDeputyPosition({ title_male: "Stv. Schriftführer" })).toBe(true);
  expect(isDeputyPosition({ neutral_title: "Vize-Obmann" })).toBe(true);
  expect(isDeputyPosition({ code: "STV_KASSIER", neutral_title: "Kassier" })).toBe(true);
  expect(isDeputyPosition({ neutral_title: "Kassier:in" })).toBe(false);
  expect(isDeputyPosition({ neutral_title: "Jugendreferent:in" })).toBe(false);
  expect(isDeputyPosition({ neutral_title: "Gastvorsitz" })).toBe(false);
  expect(isDeputyPosition(null)).toBe(false);
});
