import { API_BASE_URL } from "../config";
import { WEB_BASE_URL, authorizedUrl, isOwnUrl, ownPath } from "./siteUrls";
import { ARTICLE, FOREIGN_ARTICLE_LINKS, OWN_ARTICLE_LINKS } from "./linkOrigins.fixture";

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

test("ownPath mit der gemeinsamen Herkunfts-Matrix (#998): eigene Adressen und relative Pfade ja, alles andere nein", () => {
  for (const link of OWN_ARTICLE_LINKS) expect([link, ownPath(link)]).toEqual([link, `/news/${ARTICLE}`]);
  for (const link of FOREIGN_ARTICLE_LINKS) expect([link, ownPath(link)]).toEqual([link, null]);
});

// Abrufe mit Anmeldung (#1054, #1060): Token und Gerätekennung gehen nur an den eigenen Server. Eigene Adressen und
// relative Pfade landen dort, jede andere Herkunft gibt keine Adresse.
test("authorizedUrl mit der gemeinsamen Herkunfts-Matrix: eigene Adressen auf den eigenen Server, sonst null", () => {
  for (const link of OWN_ARTICLE_LINKS) expect([link, authorizedUrl(link)]).toEqual([link, `${API_BASE_URL}/news/${ARTICLE}`]);
  for (const link of FOREIGN_ARTICLE_LINKS) expect([link, authorizedUrl(link)]).toEqual([link, null]);
});

test("authorizedUrl: Pfade der API mit Abfrage, ohne Adresse nichts", () => {
  expect(authorizedUrl("/api/documents/d1/view")).toBe(`${API_BASE_URL}/api/documents/d1/view`);
  expect(authorizedUrl("api/documents/d1/view")).toBe(`${API_BASE_URL}/api/documents/d1/view`);
  expect(authorizedUrl(`${API_BASE_URL}/api/chat-attachments/a1?w=800`)).toBe(`${API_BASE_URL}/api/chat-attachments/a1?w=800`);
  expect(authorizedUrl("https://cdn.example/x.pdf")).toBeNull();
  expect(authorizedUrl("data:image/png;base64,AAAA")).toBeNull();
  expect(authorizedUrl("")).toBeNull();
  expect(authorizedUrl(null)).toBeNull();
});
