import * as SecureStore from "expo-secure-store";
import { hashString } from "../rng";
import { DAY_LABELS, greetingFor, greetingShownToday, linkTarget, localDay, markGreetingShown, starField, yearSaltFor } from "./greeting";

// Der Weihnachtsgruß in der App (S11, #642): Text des Tages wie im Web, Sterne aus dem Jahres-Seed (derselbe
// Fingerabdruck wie in frontend/src/seasons/christmas/index.test.jsx), einmal je Tag nach der Uhr am Gerät.

/** Derselbe Fingerabdruck wie im Web: weicht eine Seite ab, wird die andere rot. */
export const STARS_PARITY = 2991777711;

function xmas(overrides: Record<string, unknown> = {}) {
  return { key: "christmas", phase: "gruss", starts_at: "2026-12-24T00:00:00+01:00", texts: { greeting: "Frohe Weihnachten wünscht THE LION SQUAD", greeting_25: "Schöne Feiertage vom Rudel!", farewell: "Danke fürs Mitfeiern", farewell_link: "/news/rueckblick" }, ...overrides };
}

test("Parität mit dem Web: dieselben Sterne aus demselben Seed", () => {
  expect(hashString(JSON.stringify([starField(2026), starField("2027", 5)]))).toBe(STARS_PARITY);
});

test("Text des Tages: Heiligabend, eigener Text am 25., der eine Gruß am 26., Abschied mit Link, außerhalb der Tage Heiligabend", () => {
  expect(greetingFor(xmas(), new Date(2026, 11, 24, 18))).toEqual({ title: "Heiligabend", text: "Frohe Weihnachten wünscht THE LION SQUAD", link: "", day: 24 });
  expect(greetingFor(xmas(), new Date(2026, 11, 25, 9))).toMatchObject({ title: DAY_LABELS[25], text: "Schöne Feiertage vom Rudel!", day: 25 });
  expect(greetingFor(xmas(), new Date(2026, 11, 26, 9))).toMatchObject({ title: DAY_LABELS[26], text: "Frohe Weihnachten wünscht THE LION SQUAD", day: 26 });
  expect(greetingFor(xmas({ phase: "abschied" }), new Date(2027, 0, 6, 9))).toEqual({ title: "Heilige Drei Könige", text: "Danke fürs Mitfeiern", link: "/news/rueckblick", day: 6 });
  expect(greetingFor(xmas({ texts: {} }), new Date(2026, 11, 20))).toMatchObject({ day: 24, text: "Frohe Weihnachten wünscht THE LION SQUAD" });
  expect(greetingFor(xmas({ phase: "abschied", texts: {} }))).toMatchObject({ link: "", text: expect.stringContaining("Danke") });
});

test("Jahres-Salz aus dem Beginn, sonst aus der Uhr - der Abschied im Jänner zählt zum alten Jahr; Sterne je Jahr stabil", () => {
  expect(yearSaltFor(xmas())).toBe("2026");
  expect(yearSaltFor({ phase: "abschied" }, new Date(2027, 0, 6, 9))).toBe("2026");
  expect(yearSaltFor(null, new Date(2026, 11, 24, 9))).toBe("2026");
  const stars = starField(2026);
  expect(stars).toHaveLength(14);
  expect(starField(2026)).toEqual(stars);
  expect(starField(2027)).not.toEqual(stars);
  stars.forEach((star) => {
    expect(star.x).toBeGreaterThanOrEqual(0);
    expect(star.x).toBeLessThanOrEqual(100);
    expect(star.size).toBeGreaterThanOrEqual(1);
    expect(star.size).toBeLessThanOrEqual(2.6);
  });
});

test("Link aus dem Admin: Pfad der Website bekommt deren Anfang, volle Adresse bleibt, alles andere fällt weg", () => {
  expect(linkTarget("/news/rueckblick", "https://lionsquad.at/")).toBe("https://lionsquad.at/news/rueckblick");
  expect(linkTarget("https://example.org/x", "https://lionsquad.at")).toBe("https://example.org/x");
  expect(linkTarget("javascript:alert(1)", "https://lionsquad.at")).toBe("");
  expect(linkTarget("", "https://lionsquad.at")).toBe("");
});

test("Einmal je Tag nach der Uhr am Gerät: kurz nach Mitternacht ist schon der neue Tag; je Phase getrennt", async () => {
  expect(localDay(new Date(2026, 11, 25, 0, 30))).toBe("2026-12-25");
  expect(await greetingShownToday("christmas-gruss", new Date(2026, 11, 24, 18))).toBe(false);
  await markGreetingShown("christmas-gruss", new Date(2026, 11, 24, 18));
  expect(await greetingShownToday("christmas-gruss", new Date(2026, 11, 24, 23, 59))).toBe(true);
  expect(await greetingShownToday("christmas-gruss", new Date(2026, 11, 25, 0, 30))).toBe(false);
  expect(await greetingShownToday("christmas-abschied", new Date(2026, 11, 24, 23))).toBe(false);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith("season_greeting_christmas-gruss", "2026-12-24");
});

test("Ohne Speicher kommt der Gruß eben noch einmal - kein Absturz", async () => {
  (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error("kein Speicher"));
  expect(await greetingShownToday("christmas-gruss")).toBe(false);
  (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error("kein Speicher"));
  await expect(markGreetingShown("christmas-gruss")).resolves.toBeUndefined();
});
