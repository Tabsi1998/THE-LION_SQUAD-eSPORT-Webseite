import { applyApiPath, applyParams, canGoOn, canStartApplication, dayText, isSelectable, platformLines, platformShort, submittedText } from "./leagueApply";

// Mit Co-Team anmelden in der App (#2542, docs/LIGA.md B.4, Web: pages/public/LeagueApplyPage.jsx, lib/leagueApplications.js,
// lib/leaguePlatform.js): dieselben Regeln und Sätze - geprüft wird beim Einreichen noch einmal auf dem Server.

test("Adresse /liga/<liga>/<season>/anmelden - nur echte Namen", () => {
  expect(applyParams("/liga/cod/season-3/anmelden")).toEqual({ league: "cod", season: "season-3" });
  expect(applyParams("/liga/cod/season-3/anmelden?x=1")).toEqual({ league: "cod", season: "season-3" });
  expect(applyParams("/liga/cod/season-3")).toBeNull();
  expect(applyParams("/liga/../season-3/anmelden")).toBeNull();
  expect(applyApiPath("cod", "season 3")).toBe("/leagues/cod/season%203/application");
});

test("wählbar ist nur ein Co-Team, das anmelden darf und keinen laufenden Antrag hat", () => {
  expect(isSelectable({ can_apply: true, state: "none" })).toBe(true);
  expect(isSelectable({ can_apply: true, state: "withdrawn" })).toBe(true);
  expect(isSelectable({ can_apply: true, state: "submitted" })).toBe(false);
  expect(isSelectable({ can_apply: true, state: "waitlist" })).toBe(false);
  expect(isSelectable({ can_apply: false, state: "none" })).toBe(false);
});

test("Knopf „Mit Co-Team anmelden“ nur bei offenem Fenster ohne Probleme der Season und mit einem freien Co-Team", () => {
  const free = { squad_id: "s1", can_apply: true, state: "none" };
  expect(canStartApplication({ application: { state: "open" }, squads: [free] })).toBe(true);
  expect(canStartApplication({ application: { state: "upcoming" }, squads: [free] })).toBe(false);
  expect(canStartApplication({ application: { state: "open" }, season_problems: ["Kein Regelwerk"], squads: [free] })).toBe(false);
  expect(canStartApplication({ application: { state: "open" }, squads: [{ squad_id: "s2", can_apply: true, state: "accepted" }] })).toBe(false);
  expect(canStartApplication(null)).toBe(false);
});

test("Weiter je Schritt: Co-Team gewählt, keine Probleme, beides zugestimmt", () => {
  const view = { rules: { version_id: "v1" }, season_problems: [] };
  const row = { squad_id: "s1", problems: [] };
  expect(canGoOn(0, null, view, false, false)).toBe(false);
  expect(canGoOn(0, row, view, false, false)).toBe(true);
  expect(canGoOn(1, { ...row, problems: ["Zu wenige Spieler"] }, view, false, false)).toBe(false);
  expect(canGoOn(1, row, { ...view, season_problems: ["Fenster zu"] }, false, false)).toBe(false);
  expect(canGoOn(1, row, view, false, false)).toBe(true);
  expect(canGoOn(2, row, view, true, false)).toBe(false);
  expect(canGoOn(2, row, view, true, true)).toBe(true);
  expect(canGoOn(2, row, { ...view, rules: null }, true, true)).toBe(false);
  expect(canGoOn(3, row, view, true, true)).toBe(false);
});

test("nach dem Einreichen: was jetzt gilt", () => {
  expect(submittedText("accepted")).toBe("Angemeldet. Ihr habt einen Startplatz.");
  expect(submittedText("waitlist")).toBe("Eingereicht. Ihr steht auf der Warteliste.");
  expect(submittedText("submitted")).toBe("Anmeldung eingereicht. Die Liga-Leitung prüft sie jetzt.");
  expect(submittedText(undefined)).toBe("Anmeldung eingereicht. Die Liga-Leitung prüft sie jetzt.");
});

test("Plattform der Season: je Angabe ein Satz, eine Liga N mit eigener Regel kurz", () => {
  expect(platformLines({ field_label: "Plattform", allowed: ["PC", "PlayStation", "Xbox"], crossplay: false, input_device: "controller" })).toEqual([
    "Plattform: nur PC, PlayStation und Xbox.", "Crossplay: aus.", "Eingabegerät: Controller.",
  ]);
  expect(platformLines({ allowed: [], crossplay: true })).toEqual(["Crossplay: an, plattformübergreifend."]);
  expect(platformLines(null)).toEqual([]);
  expect(platformShort({ allowed: ["PC"], crossplay: false, input_device: "mouse_keyboard" })).toBe("nur PC · Crossplay aus · Maus und Tastatur");
  expect(platformShort({ allowed: [] })).toBe("alle Plattformen");
});

test("Tag ohne Uhrzeit bleibt der Tag - auch in anderen Zeitzonen", () => {
  expect(dayText("2026-11-01")).toBe("01.11.2026");
  expect(dayText("")).toBe("");
});
