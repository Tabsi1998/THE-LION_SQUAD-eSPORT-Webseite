import { EFFECT_CLASSES, PAGE_CLASSES, SEASON_CAPABILITIES, allows, capabilities, capabilitiesFor, effectClasses, pageClass, scaleForViewport } from "./intensity";

// Seitenintensität (H17): Klasse aus der Adresse, Fähigkeiten aus Klasse und Stärke, schmale Fenster bekommen weniger.
// Effektklassen (C5, #725): welche Art Effekt eine Seite tragen darf, saisonneutral; Halloween leitet seine Schlüssel daraus ab.

test("ordnet Seiten ihren Klassen zu", () => {
  expect(pageClass("/")).toBe("lively");
  expect(pageClass("/events")).toBe("lively");
  expect(pageClass("/news/")).toBe("lively");
  expect(pageClass("/galerie")).toBe("lively");
  expect(pageClass("/events/lan-party-2026")).toBe("medium");
  expect(pageClass("/news/ein-artikel")).toBe("medium");
  expect(pageClass("/community")).toBe("medium");
  expect(pageClass("/u/anna")).toBe("medium");
  expect(pageClass("/tournaments")).toBe("medium");
  expect(pageClass("/tournaments/cup/bracket")).toBe("calm");
  expect(pageClass("/tournaments/cup/standings")).toBe("calm");
  expect(pageClass("/fastlap/spielberg")).toBe("calm");
  expect(pageClass("/login")).toBe("calm");
  expect(pageClass("/contact")).toBe("calm");
  expect(pageClass("/membership/join")).toBe("calm");
  expect(pageClass("/profile?tab=achievements".split("?")[0])).toBe("calm");
  expect(pageClass("/admin/achievements")).toBe("quiet");
  expect(pageClass("/display/tv")).toBe("quiet");
  expect(pageClass("/irgendwas-neues")).toBe("medium");
});

test("Startseite reicher als Bracket, jede Seite erkennbar, still bleibt still", () => {
  const home = capabilities("/", "normal");
  const bracket = capabilities("/tournaments/cup/bracket", "normal");
  const admin = capabilities("/admin/x", "normal");
  expect(home.cls).toBe("lively");
  expect(home.hangingBats).toBeGreaterThan(bracket.hangingBats);
  expect(home.flock).toBe(true);
  expect(bracket.flock).toBe(false);
  expect(bracket.rappel).toBe(false);
  expect(bracket.webs).toBe(1);
  expect(bracket.hangingBats).toBe(1);
  expect(bracket.scares).toBe(false);
  expect(bracket.slots).toBe(1);
  expect(admin.webs).toBe(0);
  expect(capabilitiesFor("lively", "full").flockRange).toEqual([5, 8]);
  expect(capabilitiesFor("medium", "full").crawler).toBe(true);
  expect(capabilitiesFor("lively", "full").hangingBats).toBe(5);
  const subtle = capabilitiesFor("lively", "subtle");
  expect(subtle.hangingBats).toBe(0);
  expect(subtle.flock).toBe(false);
  expect(subtle.webs).toBe(2);
  expect(subtle.fog).toBe("far");
  expect(subtle.slots).toBe(0);
});

test("schmale Fenster bekommen weniger, Handys am wenigsten", () => {
  const home = capabilities("/", "full");
  const tablet = scaleForViewport(home, 800);
  expect(tablet.hangingBats).toBe(2);
  expect(tablet.flockRange).toEqual([2, 3]);
  expect(tablet.webs).toBe(1);
  expect(tablet.crawler).toBe(false);
  expect(tablet.eyes).toBe(true);
  const phone = scaleForViewport(home, 390);
  expect(phone.hangingBats).toBe(1);
  expect(phone.eyes).toBe(false);
  expect(phone.mobile).toBe(true);
  expect(phone.fog).toBe("far");
  expect(scaleForViewport(home, 1440)).toBe(home);
});

test("Effektklassen je Seitenklasse: nicht nur wie viel, sondern welche Art - Stärke vom Server bleibt übergeordnet", () => {
  expect(PAGE_CLASSES).toEqual(["lively", "medium", "calm", "quiet"]);
  const lively = effectClasses("lively");
  const calm = effectClasses("calm");
  const quiet = effectClasses("quiet");
  EFFECT_CLASSES.forEach((effect) => expect(lively).toHaveProperty(effect));
  expect(lively).toMatchObject({ cls: "lively", perch: 4, corner: 3, ambient: "near", watch: true, motion: true, slots: 2, crawl: true, rare: true, scene: "full", interact: true });
  expect(calm).toMatchObject({ perch: 1, corner: 1, ambient: "far", watch: false, motion: false, slots: 1, crawl: false, rare: false, scene: "small", interact: false });
  expect(EFFECT_CLASSES.every((effect) => !allows(quiet, effect))).toBe(true);
  expect(allows(lively, "motion")).toBe(true);
  expect(allows(calm, "motion")).toBe(false);
  expect(allows(calm, "ambient")).toBe(true);
  expect(allows(quiet, "ambient")).toBe(false);
  expect(allows(null, "perch")).toBe(false);
  // Server-Stärke: „dezent“ nimmt jede Bewegung, lässt eine Ecke und ferne Atmosphäre; „voll“ hebt an, still bleibt still.
  const subtle = effectClasses("lively", "subtle");
  expect(subtle).toMatchObject({ perch: 0, corner: 1, ambient: "far", watch: false, motion: false, slots: 0, crawl: false, rare: false, scene: "small", interact: false, subtle: true });
  expect(effectClasses("medium", "full")).toMatchObject({ perch: 3, corner: 3, crawl: true, full: true });
  expect(effectClasses("quiet", "full")).toEqual(quiet);
  expect(effectClasses("unbekannt")).toMatchObject({ cls: "unbekannt", perch: 2 });
});

test("Saison-Übersetzung: Halloween leitet seine Schlüssel aus den Effektklassen ab, eine Saison ohne Übersetzung bekommt nur die Klassen", () => {
  expect(Object.keys(SEASON_CAPABILITIES)).toEqual(["halloween", "snow"]);
  expect(capabilities("/", "normal", "snow")).toMatchObject({ season: "snow", flakes: 1, caps: true, capsMax: 18, tint: true });
  expect(capabilities("/login", "normal", "snow")).toMatchObject({ flakes: 0.6, caps: true, capsMax: 6 });
  expect(capabilities("/admin", "normal", "snow")).toMatchObject({ flakes: 0, caps: false, capsMax: 0, tint: false });
  expect(scaleForViewport(capabilities("/", "normal", "snow"), 390)).toMatchObject({ flakes: 0.6, caps: false, capsMax: 0, mobile: true });
  ["lively", "medium", "calm", "quiet"].forEach((cls) => {
    ["normal", "subtle", "full"].forEach((intensity) => {
      const caps = capabilitiesFor(cls, intensity);
      expect(caps.season).toBe("halloween");
      expect(caps.hangingBats).toBe(caps.perch);
      expect(caps.cornerWebs).toBe(caps.corner);
      expect(caps.fog).toBe(caps.ambient);
      expect(caps.eyes).toBe(caps.watch);
      expect(caps.flock).toBe(caps.motion);
      expect(caps.rappel).toBe(caps.motion);
      expect(caps.wisps).toBe(caps.motion);
      expect(caps.crawler).toBe(caps.crawl);
      expect(caps.rareEvents).toBe(caps.rare);
      expect(caps.scares).toBe(caps.interact);
      expect(caps.footerScene).toBe(caps.scene);
      expect(caps.flockRange[1] > 0).toBe(caps.motion);
    });
  });
  const plain = capabilities("/", "normal", "winter");
  expect(plain).toMatchObject({ cls: "lively", season: "winter", perch: 4, motion: true });
  expect(plain.hangingBats).toBeUndefined();
  // Schmale Fenster: die Klassen schrumpfen, die Saison-Schlüssel folgen ihnen.
  const phone = scaleForViewport(capabilities("/", "normal"), 390);
  expect(phone).toMatchObject({ perch: 1, corner: 0, watch: false, crawl: false, rare: false, ambient: "far", slots: 1, scene: "small", mobile: true, narrow: true });
  expect(phone).toMatchObject({ hangingBats: 1, cornerWebs: 0, eyes: false, crawler: false, rareEvents: false, fog: "far", footerScene: "small", webs: 1 });
  const winterPhone = scaleForViewport(plain, 390);
  expect(winterPhone).toMatchObject({ perch: 1, corner: 0, season: "winter" });
  expect(winterPhone.hangingBats).toBeUndefined();
});
