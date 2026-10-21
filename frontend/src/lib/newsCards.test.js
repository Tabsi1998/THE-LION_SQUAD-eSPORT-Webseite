import { textCardSentence, withoutRepeatedBanners } from "./newsCards";

// Text-Karte für News ohne Bild (#1343).

test("der erste Satz des Anrisses", () => {
  expect(textCardSentence({ excerpt: "Die Anmeldung ist offen. Meldet euch bis Freitag an!", title: "T" })).toBe("Die Anmeldung ist offen.");
  expect(textCardSentence({ excerpt: "Ohne Punkt am Ende", title: "T" })).toBe("Ohne Punkt am Ende");
  expect(textCardSentence({ excerpt: "Version 1.9 ist da!", title: "T" })).toBe("Version 1.9 ist da!");
});

test("ohne Anriss der Titel, ohne beides nichts", () => {
  expect(textCardSentence({ excerpt: "", title: "Mario Kart Cup im November" })).toBe("Mario Kart Cup im November");
  expect(textCardSentence({})).toBe("");
});

test("höchstens 120 Zeichen, gekürzt am Wortende", () => {
  const long = `${"Wort ".repeat(40).trim()}.`;
  const out = textCardSentence({ excerpt: long });
  expect(out.length).toBeLessThanOrEqual(120);
  expect(out.endsWith("Wort…")).toBe(true);
});

test("dasselbe Bild steht nie zweimal: die Wiederholung wird zur Text-Karte", () => {
  const out = withoutRepeatedBanners([
    { id: 1, banner_url: "/cover.webp" },
    { id: 2, banner_url: "/cover.webp" },
    { id: 3, banner_url: "/anders.webp" },
    { id: 4, banner_url: null },
  ]);
  expect(out.map((item) => item.banner_url)).toEqual(["/cover.webp", null, "/anders.webp", null]);
});
