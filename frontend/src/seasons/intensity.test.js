import { capabilities, capabilitiesFor, pageClass, scaleForViewport } from "./intensity";

// Seitenintensität (H17): Klasse aus der Adresse, Fähigkeiten aus Klasse und Stärke, schmale Fenster bekommen weniger.

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
