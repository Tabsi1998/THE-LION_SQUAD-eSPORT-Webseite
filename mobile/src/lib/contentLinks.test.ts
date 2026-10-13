import { parseContentTarget } from "./contentLinks";
import { ARTICLE, FOREIGN_ARTICLE_LINKS, OWN_ARTICLE_LINKS } from "./linkOrigins.fixture";

// Verweise im Inhalt (News, Chat, Events): RichText liest sie schon beim Zeichnen. Ein kaputter Verweis ist darum nur
// Text - er wirft nie (#997) - und nur die eigene Website wird ein Screen der App (#921, #998).

test("eigene Website und relativer Pfad: der Beitrag", () => {
  for (const link of OWN_ARTICLE_LINKS) {
    expect([link, parseContentTarget(link)]).toEqual([link, { type: "news", id: ARTICLE }]);
  }
});

test("fremde, protokoll-relative und andere Herkunft: nie ein Screen der App (#998)", () => {
  for (const link of FOREIGN_ARTICLE_LINKS) {
    expect([link, parseContentTarget(link)]).toEqual([link, null]);
  }
});

test("Platzhalter im Text: Typ, Kennung und Beschriftung", () => {
  expect(parseContentTarget("[[news:saisonstart]]")).toEqual({ type: "news", id: "saisonstart" });
  expect(parseContentTarget("[[ turnier : herbst-cup | Herbst-Cup ]]")).toEqual({ type: "tournament", id: "herbst-cup", label: "Herbst-Cup" });
  expect(parseContentTarget("[[u:neonfalke]]")).toEqual({ type: "profile", id: "neonfalke" });
  expect(parseContentTarget("[[unbekannt:x]]")).toBeNull();
});

test("ungültige Prozentkodierung wirft nicht, sondern ist kein Verweis (#997)", () => {
  const broken = [
    "[[news:%]]",
    "[[news:%E0%A4%A]]",
    "[[event:abc%zz]]",
    "[[news:%C3%28|Kaputt]]",
    "[[news:%ED%A0%80]]",
    "/news/%",
    "/events/%E0%A4%A",
    "/news/%FF",
    "https://lionsquad.at/news/%",
    "https://www.lionsquad.at/teams/%C3%28",
  ];
  for (const value of broken) {
    expect(() => parseContentTarget(value)).not.toThrow();
    expect([value, parseContentTarget(value)]).toEqual([value, null]);
  }
});

test("gültig kodierte Kennungen funktionieren unverändert (#997)", () => {
  expect(parseContentTarget("[[news:sommer%20cup]]")).toEqual({ type: "news", id: "sommer cup" });
  expect(parseContentTarget("[[u:j%C3%BCrgen]]")).toEqual({ type: "profile", id: "jürgen" });
  expect(parseContentTarget("/news/l%C3%B6wen-cup")).toEqual({ type: "news", id: "löwen-cup" });
  expect(parseContentTarget("https://lionsquad.at/u/j%C3%BCrgen?tab=teams")).toEqual({ type: "profile", id: "jürgen" });
  expect(parseContentTarget("/news/saisonstart?ref=app#oben")).toEqual({ type: "news", id: "saisonstart" });
});

test("eine Kennung bleibt eine Kennung: kein Pfad, kein Steuerzeichen nach dem Dekodieren", () => {
  for (const value of ["[[news:..%2Fadmin%2Fusers]]", "[[news:%2e%2e]]", "[[news:.]]", "/news/a%2Fb", "/news/%5Cetc", "[[news:a%00b]]", "/news/x%3Fy"]) {
    expect([value, parseContentTarget(value)]).toEqual([value, null]);
  }
});

test("Eingaben außerhalb der vorgesehenen Typen: nie ein Fehler, nie ein Verweis", () => {
  const odd = [undefined, null, "", "   ", 0, 42, true, {}, [], ["/news/x"], "news", "/", "/news", "/news/", "[[news:]]", "[[:x]]"];
  for (const value of odd) {
    expect(() => parseContentTarget(value as never)).not.toThrow();
  }
  expect(parseContentTarget(undefined)).toBeNull();
  expect(parseContentTarget(42 as never)).toBeNull();
  expect(parseContentTarget({} as never)).toBeNull();
  expect(parseContentTarget("/news")).toBeNull();
  expect(parseContentTarget("[[news:]]")).toBeNull();
});
