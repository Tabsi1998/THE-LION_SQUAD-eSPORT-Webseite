// TV & Beamer (#1110): Link-Werte schlagen Grundwerte, Grundwerte schlagen den Standard, der Baukasten baut gültige Links.
import { TV_DEFAULTS, TV_FIELDS, TV_KEYS, buildTvLink, linkOverrides, parseTvParam, parseTvPath, resolveTvSettings, tvValueLabel, validTvValue } from "./tvSettings";

test("der Standard ist Fabians Auswahl aus der TV-Vorschau - Ton beim Ergebnis aus", () => {
  expect(TV_DEFAULTS).toEqual({ text_size: "normal", contrast: false, safe_area: 0, pixel_shift: true, season_header: true, reduce_motion: false, result_sound: false });
  expect(TV_FIELDS.map((field) => field.key)).toEqual(TV_KEYS);
  expect(TV_FIELDS.every((field) => field.label && field.hint)).toBe(true);
});

test("Werte aus dem Link: an/aus, 1/0, groß - Unpassendes zählt nicht", () => {
  expect(parseTvParam("contrast", "1")).toBe(true);
  expect(parseTvParam("contrast", "an")).toBe(true);
  expect(parseTvParam("pixel_shift", "aus")).toBe(false);
  expect(parseTvParam("pixel_shift", "0")).toBe(false);
  expect(parseTvParam("contrast", "vielleicht")).toBeUndefined();
  expect(parseTvParam("text_size", "groß")).toBe("large");
  expect(parseTvParam("text_size", "large")).toBe("large");
  expect(parseTvParam("text_size", "riesig")).toBeUndefined();
  expect(parseTvParam("safe_area", "5")).toBe(5);
  expect(parseTvParam("safe_area", "4")).toBeUndefined();
  expect(parseTvParam("safe_area", "")).toBeUndefined();
  expect(parseTvParam("safe_area", "3.0")).toBeUndefined();
  expect(parseTvParam("blinken", "1")).toBeUndefined();
  expect(parseTvParam("result_sound", "an")).toBe(true);
  expect(parseTvParam("result_sound", "laut")).toBeUndefined();
});

test("Link vor Grundwert vor Standard; kaputte Werte vom Server zählen nicht", () => {
  const server = { contrast: true, text_size: "large", safe_area: 3, pixel_shift: "ja", season_header: 0 };
  expect(resolveTvSettings(server)).toEqual({ ...TV_DEFAULTS, contrast: true, text_size: "large", safe_area: 3 });
  const overrides = linkOverrides(new URLSearchParams("contrast=0&safe_area=5&reduce_motion=1&key=geheim&text_size=nope"));
  expect(overrides).toEqual({ contrast: false, safe_area: 5, reduce_motion: true });
  expect(resolveTvSettings(server, overrides)).toEqual({ ...TV_DEFAULTS, contrast: false, text_size: "large", safe_area: 5, reduce_motion: true });
  // Ohne Antwort vom Server (null): Standard und Link.
  expect(resolveTvSettings(null, { season_header: false })).toEqual({ ...TV_DEFAULTS, season_header: false });
  expect(validTvValue("safe_area", false)).toBe(false);
  expect(validTvValue("safe_area", 0)).toBe(true);
});

test("der Baukasten baut gültige Links - und liest sie wieder genauso zurück", () => {
  const overrides = { contrast: true, text_size: "large", safe_area: 3, pixel_shift: false };
  const bracket = buildTvLink({ origin: "https://club.example", view: "bracket", targetId: "t-1", displayKey: "Schl_ssel-1", overrides });
  const url = new URL(bracket);
  expect(url.pathname).toBe("/display/bracket/t-1");
  expect(url.searchParams.get("key")).toBe("Schl_ssel-1");
  expect(linkOverrides(url.searchParams)).toEqual(overrides);

  const event = buildTvLink({ origin: "https://club.example", view: "event", targetId: "e1", displayKey: "nicht-hier", overrides: { season_header: false } });
  expect(event).toBe("https://club.example/display/event/e1?season_header=0");
  expect(buildTvLink({ view: "fastlap", targetId: "f1" })).toBe("/display/f1/f1");
  // Kein Ziel, unbekannte Ansicht oder ein Ziel mit Sonderzeichen: kein Link.
  expect(buildTvLink({ view: "bracket", targetId: "" })).toBe("");
  expect(buildTvLink({ view: "kino", targetId: "t1" })).toBe("");
  expect(buildTvLink({ view: "event", targetId: "../admin" })).toBe("");
  // Nur gültige Abweichungen landen im Link.
  expect(buildTvLink({ view: "event", targetId: "e1", overrides: { contrast: "ja", safe_area: 4 } })).toBe("/display/event/e1");
  // Ton nur für diesen Bildschirm (#1118).
  expect(buildTvLink({ view: "bracket", targetId: "t1", displayKey: "k", overrides: { result_sound: true } })).toBe("/display/bracket/t1?key=k&result_sound=1");
});

test("Stations-Ansicht (#1120): ein Link je Station, mit dem Schlüssel des Turniers - und zurückgelesen", () => {
  const link = buildTvLink({ origin: "https://club.example", view: "station", targetId: "t-1", stationId: "st_3", displayKey: "geheim", overrides: { contrast: true } });
  expect(link).toBe("https://club.example/display/bracket/t-1/station/st_3?key=geheim&contrast=1");
  expect(buildTvLink({ view: "station", targetId: "t-1" })).toBe("");
  expect(buildTvLink({ view: "station", targetId: "t-1", stationId: "../x" })).toBe("");
  expect(parseTvPath(new URL(link).pathname)).toEqual({ view: "station", targetId: "t-1", stationId: "st_3" });
  expect(parseTvPath("/display/bracket/t-1")).toEqual({ view: "bracket", targetId: "t-1", stationId: "" });
  expect(parseTvPath("/display/f1/f9")).toEqual({ view: "fastlap", targetId: "f9", stationId: "" });
  expect(parseTvPath("/turniere/t-1")).toBeNull();
});

test("der Admin liest Werte in Alltagssprache", () => {
  expect(tvValueLabel("text_size", "large")).toBe("Groß");
  expect(tvValueLabel("safe_area", 5)).toBe("5 %");
  expect(tvValueLabel("contrast", false)).toBe("Aus");
  expect(tvValueLabel("pixel_shift", true)).toBe("An");
  expect(tvValueLabel("result_sound", false)).toBe("Aus");
});
