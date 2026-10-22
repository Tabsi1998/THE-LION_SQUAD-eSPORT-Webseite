import { cleanOriginals, httpsLink, originalLabel, originalSrc, originalsButtonLabel, originalsOf, sourceLink, viewerWidth } from "./referenceOriginals";

// Original-Bilder des Veranstalters (#1933): Beschriftung wie im Web, Bilder nur von der öffentlichen Adresse des eigenen
// Servers, Quellen-Link nur als https, und ein älterer Server ohne Bilder.

const URL_1 = "/api/reference-series/public/prl/2026/originals/o1";

test("Beschriftung: Art, beim Scoreboard mit Map", () => {
  expect(originalLabel({ kind: "race" })).toBe("Rennen");
  expect(originalLabel({ kind: "scoreboard", map: 2 })).toBe("Scoreboard · Map 2");
  expect(originalLabel({ kind: "table", map: 2 })).toBe("Tabelle");
  expect(originalLabel({ kind: "neu" })).toBe("Original");
  expect(originalLabel(null)).toBe("Original");
});

test("Bildadresse nur der öffentliche Pfad des eigenen Servers - mit Vorschaubreite", () => {
  expect(originalSrc(URL_1)).toBe(URL_1);
  expect(originalSrc(URL_1, 160)).toBe(`${URL_1}?w=160`);
  for (const bad of [
    "https://fremd.example/api/reference-series/public/prl/2026/originals/o1",
    "//fremd.example/api/reference-series/public/prl/2026/originals/o1",
    "/api/uploads/bild.webp",
    "/api/reference-series/public/prl/2026/originals/o1?w=1",
    "/api/reference-series/public/prl/../originals/o1/x",
    "/api/reference-series/public/prl/../originals/o1",
    "/api/reference-series/public/prl/2026/originals/o 1",
    "",
    null,
  ]) {
    expect(originalSrc(bad as string)).toBe("");
  }
  expect(viewerWidth({ width: 3000 })).toBe(1600);
  expect(viewerWidth({ width: 1200 })).toBeUndefined();
  expect(viewerWidth({})).toBeUndefined();
});

test("Links nur als https ohne Anmeldedaten, Leerraum oder Steuerzeichen", () => {
  expect(httpsLink("https://tft.pineapps.at")).toBe("https://tft.pineapps.at");
  expect(sourceLink({ source_url: "https://veranstalter.example/ergebnis" })).toBe("https://veranstalter.example/ergebnis");
  for (const bad of ["http://veranstalter.example", "javascript:alert(1)", "https://gast:geheim@veranstalter.example", "https://localhost/x", "https://a.example/ x", "https://a.example/\u0007", "ftp://a.example", "", null]) {
    expect(httpsLink(bad as string)).toBe("");
  }
  expect(httpsLink(`https://a.example/${"x".repeat(600)}`)).toBe("");
});

test("Bilder eines Termins bzw. aller Läufe einer Runde - mit Lauf nur, wenn er etwas sagt", () => {
  const originals = {
    q: [{ id: "o1", kind: "qualifying", url: URL_1 }],
    s: [{ id: "o2", kind: "race", url: "/api/reference-series/public/prl/2026/originals/o2" }, { id: "x", kind: "race", url: "https://fremd.example/bild.png" }],
    r: [{ id: "o3", kind: "scoreboard", map: 1, url: "/api/reference-series/public/prl/2026/originals/o3" }],
  };
  const rounds = [{ id: "q", session: "Qualifying" }, { id: "s", session: "Sprint" }, { id: "r", session: null }];
  expect(originalsOf(originals, rounds, { withSession: true }).map((item) => [item.id, item.label])).toEqual([
    ["o1", "Qualifying"],
    ["o2", "Sprint · Rennen"],
    ["o3", "Scoreboard · Map 1"],
  ]);
  expect(originalsOf(originals, [{ id: "s", session: "Sprint" }]).map((item) => item.label)).toEqual(["Rennen"]);
  expect(originalsButtonLabel(1)).toBe("Original ansehen");
  expect(originalsButtonLabel(3)).toBe("Original ansehen, 3 Bilder");
});

test("alter Server ohne Bilder oder mit fremdem Format: keine Bilder, kein Absturz", () => {
  expect(originalsOf(undefined, [{ id: "q" }])).toEqual([]);
  expect(originalsOf(null, null)).toEqual([]);
  expect(originalsOf([] as never, [{ id: "q" }])).toEqual([]);
  expect(originalsOf({ q: "kaputt" as never }, [{ id: "q" }])).toEqual([]);
  expect(cleanOriginals(undefined)).toEqual([]);
  expect(cleanOriginals([null, 3, { id: "", url: URL_1 }, { id: "o1" }])).toEqual([]);
});
