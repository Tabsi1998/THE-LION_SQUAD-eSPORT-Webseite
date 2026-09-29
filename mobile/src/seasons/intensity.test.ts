import { capabilities, capabilitiesFor, scaleForScreen, screenClass } from "./intensity";

// Screen-Intensität (A3): Klassen nach Screen-Name, Fähigkeiten je Klasse und Stärke, kleine Bildschirme bekommen weniger.

test("Klassen: Dashboard und News lebendig, Details mittel, Turniere und Formulare ruhig, Sperre und Einstellungen still", () => {
  expect(screenClass("Dashboard")).toBe("lively");
  expect(screenClass("NewsList")).toBe("lively");
  expect(screenClass("Gallery")).toBe("lively");
  expect(screenClass("NewsDetail")).toBe("medium");
  expect(screenClass("EventDetail")).toBe("medium");
  expect(screenClass("Teams")).toBe("medium");
  expect(screenClass("MoreHub")).toBe("medium");
  expect(screenClass("TournamentDetail")).toBe("calm");
  expect(screenClass("MatchDetail")).toBe("calm");
  expect(screenClass("FastLapList")).toBe("calm");
  expect(screenClass("Login")).toBe("calm");
  expect(screenClass("Profile")).toBe("calm");
  expect(screenClass("DirectThread")).toBe("calm");
  expect(screenClass("Consent")).toBe("quiet");
  expect(screenClass("NotificationSettings")).toBe("quiet");
  expect(screenClass("")).toBe("lively");
});

test("Fähigkeiten: lebendig mit allem, ruhig ohne Schwarm, Spinnen und Gräber, still ohne alles; dezent nur Netze und ferner Nebel; voll eine Fledermaus mehr", () => {
  const lively = capabilities("Dashboard", "normal");
  expect(lively).toMatchObject({ cls: "lively", hangingBats: 2, flock: true, webs: 2, cornerWebs: 2, rappel: true, crawler: true, graves: true, cat: true, fog: "near", slots: 2 });
  const calm = capabilities("TournamentDetail", "normal");
  expect(calm).toMatchObject({ cls: "calm", hangingBats: 1, flock: false, webs: 1, cornerWebs: 0, rappel: false, crawler: false, dropSpider: false, graves: false, cat: false, fog: "far", slots: 1 });
  const quiet = capabilities("Consent", "normal");
  expect(quiet).toMatchObject({ hangingBats: 0, flock: false, webs: 0, cornerWebs: 0, rappel: false, graves: false, fog: "none", slots: 0 });
  const subtle = capabilities("Dashboard", "subtle");
  expect(subtle).toMatchObject({ hangingBats: 0, flock: false, cornerWebs: 1, rappel: false, crawler: false, graves: false, fog: "far", slots: 0, subtle: true });
  const full = capabilities("Dashboard", "full");
  expect(full.hangingBats).toBe(3);
  expect(full.flockRange).toEqual([4, 6]);
  expect(capabilitiesFor("medium", "full").crawler).toBe(true);
  expect(capabilitiesFor("quiet", "full").hangingBats).toBe(0);
});

test("kleine Bildschirme: höchstens eine Fledermaus, keine Ecknetze, kein Krabbler, ferner Nebel", () => {
  const lively = capabilities("Dashboard", "normal");
  expect(scaleForScreen(lively, 390, 844)).toBe(lively);
  const small = scaleForScreen(lively, 320, 568);
  expect(small).toMatchObject({ hangingBats: 1, cornerWebs: 0, crawler: false, webs: 1, fog: "far", slots: 1, small: true });
  expect(small.flockRange).toEqual([2, 3]);
});
