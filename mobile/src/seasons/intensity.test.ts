import { EFFECT_CLASSES, SEASON_CAPABILITIES, allows, capabilities, capabilitiesFor, effectClasses, scaleForScreen, screenClass, seasonCapabilities } from "./intensity";

// Screen-Intensität (A3): Klassen nach Screen-Name, Fähigkeiten je Klasse und Stärke, kleine Bildschirme bekommen weniger.
// Effektklassen (C5, #725): welche Art Effekt ein Screen tragen darf, saisonneutral; Halloween leitet seine Schlüssel daraus ab.

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
  // Der Adventkalender ist selbst das Bild - wie /advent im Web.
  expect(screenClass("AdventCalendar")).toBe("calm");
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
  expect(full.cornerWebs).toBe(2);
  expect(capabilitiesFor("medium", "full").crawler).toBe(true);
  expect(capabilitiesFor("quiet", "full").hangingBats).toBe(0);
  expect(capabilities("EventDetail", "normal")).toMatchObject({ cls: "medium", hangingBats: 2, cornerWebs: 1, graves: true, cat: false, dropSpider: true, fog: "far" });
});

test("kleine Bildschirme: höchstens eine Fledermaus, keine Ecknetze, kein Krabbler, ferner Nebel", () => {
  const lively = capabilities("Dashboard", "normal");
  expect(scaleForScreen(lively, 390, 844)).toBe(lively);
  const small = scaleForScreen(lively, 320, 568);
  expect(small).toMatchObject({ hangingBats: 1, cornerWebs: 0, crawler: false, webs: 1, fog: "far", slots: 1, small: true });
  expect(small.flockRange).toEqual([2, 3]);
  expect(small).toMatchObject({ perch: 1, corner: 0, crawl: false, ambient: "far" });
});

test("Effektklassen je Screen-Klasse: nicht nur wie viel, sondern welche Art - Stärke vom Server bleibt übergeordnet", () => {
  const lively = effectClasses("lively");
  const calm = effectClasses("calm");
  const quiet = effectClasses("quiet");
  EFFECT_CLASSES.forEach((effect) => expect(lively).toHaveProperty(effect));
  expect(lively).toMatchObject({ cls: "lively", perch: 2, corner: 2, ambient: "near", watch: true, motion: true, slots: 2, crawl: true, rare: true, scene: "full", interact: true });
  expect(effectClasses("medium")).toMatchObject({ perch: 2, corner: 1, ambient: "far", motion: true, crawl: false, scene: "small" });
  expect(calm).toMatchObject({ perch: 1, corner: 0, ambient: "far", watch: false, motion: false, slots: 1, crawl: false, rare: false, scene: "none", interact: false });
  expect(EFFECT_CLASSES.every((effect) => !allows(quiet, effect))).toBe(true);
  expect(allows(lively, "motion")).toBe(true);
  expect(allows(calm, "motion")).toBe(false);
  expect(allows(calm, "ambient")).toBe(true);
  expect(allows(quiet, "ambient")).toBe(false);
  expect(allows(null, "perch")).toBe(false);
  const subtle = effectClasses("lively", "subtle");
  expect(subtle).toMatchObject({ perch: 0, corner: 1, ambient: "far", watch: false, motion: false, slots: 0, crawl: false, rare: false, scene: "none", interact: false, subtle: true });
  expect(effectClasses("medium", "full")).toMatchObject({ perch: 3, corner: 1, crawl: true, full: true });
  expect(effectClasses("quiet", "full")).toEqual(quiet);
});

test("Saison-Übersetzung: Halloween leitet seine Schlüssel aus den Effektklassen ab, eine Saison ohne Übersetzung bekommt nur die Klassen", () => {
  expect(Object.keys(SEASON_CAPABILITIES)).toEqual(["halloween"]);
  (["lively", "medium", "calm", "quiet"] as const).forEach((cls) => {
    ["normal", "subtle", "full"].forEach((intensity) => {
      const caps = capabilitiesFor(cls, intensity);
      expect(caps.season).toBe("halloween");
      expect(caps.hangingBats).toBe(caps.perch);
      expect(caps.cornerWebs).toBe(caps.corner);
      expect(caps.fog).toBe(caps.ambient);
      expect(caps.flock).toBe(caps.motion);
      expect(caps.rappel).toBe(caps.motion);
      expect(caps.dropSpider).toBe(caps.motion);
      expect(caps.crawler).toBe(caps.crawl);
      expect(caps.graves).toBe(caps.scene !== "none");
      expect(caps.cat).toBe(caps.scene === "full");
      expect(caps.flockRange[1] > 0).toBe(caps.motion);
    });
  });
  const plain = seasonCapabilities("winter", "Dashboard", "normal");
  expect(plain).toMatchObject({ cls: "lively", season: "winter", perch: 2, motion: true });
  expect(plain.hangingBats).toBeUndefined();
  expect(seasonCapabilities("halloween", "Dashboard", "normal")).toMatchObject({ hangingBats: 2, cat: true, season: "halloween" });
});
