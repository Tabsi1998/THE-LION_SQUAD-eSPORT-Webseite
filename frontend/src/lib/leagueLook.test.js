import {
  accentProblem,
  accentStyle,
  bannerFocus,
  contrastRatio,
  placeLabel,
  placeTone,
  prizesPayload,
  prizesToForm,
} from "./leagueLook";

// Gestaltung der Liga (#2107): Farbe, Fokuspunkt und Gewinne - die Regeln stehen auch am Server (league_look.py).

test("Kontrast wie WCAG: Weiß auf Schwarz 21 : 1, die Vereinsfarbe auf dem Seitengrund lesbar", () => {
  expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 0);
  expect(contrastRatio("#29B6E8", "#0A0A0A")).toBeGreaterThan(4.5);
});

test("Akzentfarbe: leer ist erlaubt (Vereinsfarbe), zu dunkel oder kein Farbwert nicht", () => {
  expect(accentProblem("")).toBe("");
  expect(accentProblem("#FFB020")).toBe("");
  expect(accentProblem("#1A1A40")).toMatch(/Kontrast/);
  expect(accentProblem("blau")).toMatch(/Farbwert/);
});

test("accentStyle setzt die Farbe als RGB-Kanäle und eine lesbare Schrift darauf - ohne Farbe nichts", () => {
  expect(accentStyle(null)).toEqual({});
  expect(accentStyle("#FFB020")).toEqual({ "--league-accent-rgb": "255 176 32", "--league-on-accent": "#0A0A0A" });
  expect(accentStyle("#3F51B5")["--league-on-accent"]).toBe("#FFFFFF");
});

test("Fokuspunkt je Zuschnitt, mittig ohne Angabe", () => {
  const banner = { url: "/api/static/uploads/b.webp", x: 20, y: 70, mobile_x: 80, mobile_y: 30 };
  expect(bannerFocus(banner)).toEqual({ "--league-focus-desktop": "20% 70%", "--league-focus-mobile": "80% 30%" });
  expect(bannerFocus({ url: "x" })).toEqual({ "--league-focus-desktop": "50% 50%", "--league-focus-mobile": "50% 50%" });
});

test("Gewinne: Formular ↔ Anfrage, leere Zeilen fallen weg, Platz als Zahl", () => {
  const form = prizesToForm([{ place: 1, text: "Pokal", image_url: "/api/static/uploads/p.png" }]);
  expect(form).toEqual([{ place: "1", text: "Pokal", image_url: "/api/static/uploads/p.png" }]);
  expect(prizesPayload([...form, { place: "2", text: "  ", image_url: "" }, { place: "3", text: "Gutschein", image_url: "" }]))
    .toEqual([{ place: 1, text: "Pokal", image_url: "/api/static/uploads/p.png" }, { place: 3, text: "Gutschein", image_url: null }]);
  expect(prizesPayload([])).toBeNull();
});

test("Platz zum Lesen und als Ton: Gold, Silber, Bronze, dann ruhig", () => {
  expect(placeLabel(1)).toBe("1. Platz");
  expect([1, 2, 3, 4].map(placeTone)).toEqual(["gold", "silver", "bronze", "plain"]);
});
