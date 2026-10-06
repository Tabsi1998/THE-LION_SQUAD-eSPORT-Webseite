import { WEB_BASE_URL, isOwnUrl, ownPath } from "./siteUrls";

// Eigene Adressen (#921): der Server der App, die öffentliche Domain mit und ohne www - sonst nichts. Der Pfad
// behält die Abfrage (Reiter, Beleg), fremde Adressen mit gleichem Pfad bleiben fremd.

test("eigene Website: Server-Adresse und lionsquad.at mit und ohne www", () => {
  expect(isOwnUrl(`${WEB_BASE_URL}/news/x`)).toBe(true);
  expect(isOwnUrl("https://lionsquad.at/tournaments/t-1")).toBe(true);
  expect(isOwnUrl("https://www.lionsquad.at/tournaments/t-1")).toBe(true);
  expect(isOwnUrl("HTTPS://LIONSQUAD.AT/news")).toBe(true);
  expect(isOwnUrl("https://start.gg/tournaments/t-1")).toBe(false);
  expect(isOwnUrl("https://lionsquad.at.boese.example/news/x")).toBe(false);
  expect(isOwnUrl("https://boese.example/?u=https://lionsquad.at/news")).toBe(false);
  expect(isOwnUrl("/news/x")).toBe(false);
  expect(isOwnUrl("")).toBe(false);
});

test("ownPath: Pfad mit Abfrage von der eigenen Website, sonst null", () => {
  expect(ownPath("/news/advent-gruss")).toBe("/news/advent-gruss");
  expect(ownPath(`${WEB_BASE_URL}/events/lan-2026`)).toBe("/events/lan-2026");
  expect(ownPath(WEB_BASE_URL)).toBe("/");
  expect(ownPath("https://www.lionsquad.at/profile?tab=invoices&invoice=d-7#oben")).toBe("/profile?tab=invoices&invoice=d-7");
  expect(ownPath("//boese.example/news/x")).toBeNull();
  expect(ownPath("https://boese.example/news/x")).toBeNull();
  expect(ownPath(`${WEB_BASE_URL}.boese.example/news/x`)).toBeNull();
  expect(ownPath("mailto:info@lionsquad.at")).toBeNull();
  expect(ownPath("")).toBeNull();
  expect(ownPath(null)).toBeNull();
});
