import { newsCategoryColorDark, newsResult, seatsLine, signupItems, splitAfterFirstParagraph, stateLine, textCardSentence } from "./newsCards";

// News-Karten der App (#1912) - dieselben Regeln wie im Web (frontend/src/lib/newsCards.js, NewsTextCard.jsx,
// NewsSignupCard.jsx und splitAfterFirstParagraph in NewsDetailPage.jsx).

test("Satz der Text-Karte: erster Satz des Anrisses, sonst der Titel, ohne Tags", () => {
  expect(textCardSentence({ excerpt: "<p>Wir <b>sind</b> Meister! Mehr dazu bald.</p>", title: "T" })).toBe("Wir sind Meister!");
  expect(textCardSentence({ excerpt: "", title: "Neue Trikots" })).toBe("Neue Trikots");
  expect(textCardSentence({})).toBe("");
});

test("Satz der Text-Karte: lange Sätze am Wortende mit „…“ gekürzt", () => {
  const long = `${"Wort ".repeat(40)}Ende.`;
  const sentence = textCardSentence({ excerpt: long });
  expect(sentence.length).toBeLessThanOrEqual(120);
  expect(sentence.endsWith("Wort…")).toBe(true);
});

test("Fläche je Kategorie: dunkle Fassung, sonst Grau", () => {
  expect(newsCategoryColorDark("tournaments")).toBe("#1A7AA3");
  expect(newsCategoryColorDark("events")).toBe("#7655CC");
  expect(newsCategoryColorDark("members")).toBe("#85690A");
  expect(newsCategoryColorDark("sonstiges")).toBe("#3A3A44");
  expect(newsCategoryColorDark(undefined)).toBe("#3A3A44");
});

test("Sieger nur, wenn der Server ihn mitliefert", () => {
  expect(newsResult({ result: { winner: "Lion Alpha", tournament: "Herbst-Cup" } })).toEqual({ winner: "Lion Alpha", tournament: "Herbst-Cup" });
  expect(newsResult({ result: { winner: "" } })).toBeNull();
  expect(newsResult({})).toBeNull();
});

test("Anmelde-Karten: nur verknüpfte Turniere und Events mit Stand, höchstens drei", () => {
  const signup = { state: "open" as const };
  const items = signupItems({
    linked_tournaments: [
      { id: "t1", slug: "cup", title: "Cup", signup },
      { id: "t2", title: "Ohne Stand" },
      { id: "t3", title: "Zwei", signup },
    ],
    linked_events: [{ id: "e1", slug: "lan", name: "LAN", signup }, { id: "e2", name: "Noch eins", signup }],
  });
  expect(items.map((item) => [item.kind, item.id, item.title])).toEqual([
    ["tournament", "cup", "Cup"],
    ["tournament", "t3", "Zwei"],
    ["event", "lan", "LAN"],
  ]);
  expect(signupItems({})).toEqual([]);
});

test("Plätze und Stand wie im Web", () => {
  expect(seatsLine({ state: "open", max: 16, spots_left: 4, taken: 12 })).toBe("Noch 4 von 16 Plätzen frei");
  expect(seatsLine({ state: "full", max: 16, spots_left: 0, taken: 16 })).toBe("Alle 16 Plätze vergeben");
  expect(seatsLine({ state: "open", max: null, taken: 7 })).toBe("7 angemeldet");
  expect(seatsLine({ state: "open", max: null, taken: 0 })).toBe("");
  expect(seatsLine({ state: "results", max: 16, spots_left: 0 })).toBe("");
  expect(stateLine({ state: "full" })).toBe("Ausgebucht");
  expect(stateLine({ state: "cancelled" })).toBe("Abgesagt");
  expect(stateLine({ state: "none" })).toBe("");
  expect(stateLine({ state: "soon", opens_at: "2026-11-02T17:00:00Z" })).toMatch(/^Anmeldung ab /);
});

test("Erster Absatz: HTML bis zum ersten </p>, Text bis zur ersten Leerzeile außerhalb von Code", () => {
  expect(splitAfterFirstParagraph("<p>Eins</p>\n<p>Zwei</p>")).toEqual(["<p>Eins</p>", "<p>Zwei</p>"]);
  expect(splitAfterFirstParagraph("Eins\n\nZwei\n\nDrei")).toEqual(["Eins", "Zwei\n\nDrei"]);
  expect(splitAfterFirstParagraph("```\na\n\nb\n```\n\nRest")).toEqual(["```\na\n\nb\n```", "Rest"]);
  expect(splitAfterFirstParagraph("Nur einer")).toEqual(["Nur einer", ""]);
});
