// TV & Beamer (#1110): Link-Werte schlagen Grundwerte, Grundwerte schlagen den Standard, der Baukasten baut gültige Links.
// Meilenstein 60: Wiedergabeliste, Aufrufe, Zahlen, Sponsoren und Streckenwechsel als Einstellungen mit Fabians Wahl.
import { TV_DEFAULTS, TV_FIELDS, TV_GROUPS, TV_KEYS, buildTvLink, fieldsForView, linkOverrides, parseTvParam, parseTvPath, resolveTvSettings, sameTvValue, tvValueLabel, validTvValue } from "./tvSettings";

test("der Standard ist Fabians Auswahl aus der TV-Vorschau - Ton aus, Sponsoren nach Wahl C", () => {
  expect(TV_DEFAULTS).toEqual({
    text_size: "normal", contrast: false, safe_area: 0, pixel_shift: true, season_header: true, reduce_motion: false, result_sound: false,
    playlist: [{ slide: "tree", seconds: 12 }, { slide: "live", seconds: 8 }, { slide: "calls", seconds: 8 }, { slide: "sponsor", seconds: 6 }, { slide: "stats", seconds: 8 }],
    call_sound: false, report_minutes: 2, stats: true, stats_every: 10, sponsor_moment: true, sponsor_every: 3, sponsor_presented: true, sponsor_ticker: false,
    track_seconds: 45,
  });
  expect(TV_FIELDS.map((field) => field.key).sort()).toEqual([...TV_KEYS].sort());
  expect(TV_FIELDS.every((field) => field.label && field.hint && TV_GROUPS.some((group) => group.key === field.group))).toBe(true);
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

test("Zahlen im Link nur ganz und in ihren Grenzen: Streckenwechsel 20 bis 120 Sekunden, Zeit zum Antreten 1 bis 30 Minuten", () => {
  expect(parseTvParam("track_seconds", "30")).toBe(30);
  expect(parseTvParam("track_seconds", "19")).toBeUndefined();
  expect(parseTvParam("track_seconds", "121")).toBeUndefined();
  expect(parseTvParam("track_seconds", "45.5")).toBeUndefined();
  expect(parseTvParam("report_minutes", "5")).toBe(5);
  expect(parseTvParam("report_minutes", "0")).toBeUndefined();
  expect(parseTvParam("sponsor_every", "1")).toBe(1);
  expect(parseTvParam("stats_every", "61")).toBeUndefined();
  expect(validTvValue("track_seconds", 45)).toBe(true);
  expect(validTvValue("track_seconds", "45")).toBe(false);
  expect(validTvValue("report_minutes", 2.5)).toBe(false);
  expect(parseTvParam("sponsor_ticker", "an")).toBe(true);
  expect(parseTvParam("call_sound", "1")).toBe(true);
});

test("Wiedergabeliste im Link: Folien mit Sekunden, ohne Sekunden der Standard, deutsch geht auch", () => {
  expect(parseTvParam("playlist", "tree-12_live-8_calls-8")).toEqual([{ slide: "tree", seconds: 12 }, { slide: "live", seconds: 8 }, { slide: "calls", seconds: 8 }]);
  expect(parseTvParam("playlist", "calls")).toEqual([{ slide: "calls", seconds: 8 }]);
  expect(parseTvParam("playlist", "baum-20,aufrufe")).toEqual([{ slide: "tree", seconds: 20 }, { slide: "calls", seconds: 8 }]);
  // Doppelt, zu kurz, zu lang, unbekannt: zählt nicht - dann gilt der Grundwert.
  expect(parseTvParam("playlist", "tree-12_tree-8")).toBeUndefined();
  expect(parseTvParam("playlist", "tree-2")).toBeUndefined();
  expect(parseTvParam("playlist", "tree-121")).toBeUndefined();
  expect(parseTvParam("playlist", "kino-10")).toBeUndefined();
  expect(parseTvParam("playlist", "")).toBeUndefined();
  const link = buildTvLink({ view: "bracket", targetId: "t1", displayKey: "k", overrides: { playlist: [{ slide: "calls", seconds: 10 }] } });
  expect(link).toBe("/display/bracket/t1?key=k&playlist=calls-10");
  expect(linkOverrides(new URL(link, "https://club.example").searchParams)).toEqual({ playlist: [{ slide: "calls", seconds: 10 }] });
  expect(sameTvValue("playlist", [{ slide: "calls", seconds: 10 }], [{ slide: "calls", seconds: 10 }])).toBe(true);
  expect(sameTvValue("playlist", [{ slide: "calls", seconds: 10 }], [{ slide: "calls", seconds: 9 }])).toBe(false);
});

test("Link vor Grundwert vor Standard; kaputte Werte vom Server zählen nicht", () => {
  const server = { contrast: true, text_size: "large", safe_area: 3, pixel_shift: "ja", season_header: 0, track_seconds: 5, playlist: [{ slide: "tree" }] };
  expect(resolveTvSettings(server)).toEqual({ ...TV_DEFAULTS, contrast: true, text_size: "large", safe_area: 3 });
  const overrides = linkOverrides(new URLSearchParams("contrast=0&safe_area=5&reduce_motion=1&key=geheim&text_size=nope&track_seconds=30"));
  expect(overrides).toEqual({ contrast: false, safe_area: 5, reduce_motion: true, track_seconds: 30 });
  expect(resolveTvSettings(server, overrides)).toEqual({ ...TV_DEFAULTS, contrast: false, text_size: "large", safe_area: 5, reduce_motion: true, track_seconds: 30 });
  // Ohne Antwort vom Server (null): Standard und Link.
  expect(resolveTvSettings(null, { season_header: false })).toEqual({ ...TV_DEFAULTS, season_header: false });
  expect(validTvValue("safe_area", false)).toBe(false);
  expect(validTvValue("safe_area", 0)).toBe(true);
  // Die Liste am Bildschirm ist eine eigene Kopie - der Standard bleibt, wie er ist.
  const resolved = resolveTvSettings(null);
  resolved.playlist.push({ slide: "x", seconds: 1 });
  expect(TV_DEFAULTS.playlist).toHaveLength(5);
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
  expect(buildTvLink({ view: "fastlap", targetId: "f1", overrides: { track_seconds: 60 } })).toBe("/display/f1/f1?track_seconds=60");
  // Kein Ziel, unbekannte Ansicht oder ein Ziel mit Sonderzeichen: kein Link.
  expect(buildTvLink({ view: "bracket", targetId: "" })).toBe("");
  expect(buildTvLink({ view: "kino", targetId: "t1" })).toBe("");
  expect(buildTvLink({ view: "event", targetId: "../admin" })).toBe("");
  // Nur gültige Abweichungen landen im Link.
  expect(buildTvLink({ view: "event", targetId: "e1", overrides: { contrast: "ja", safe_area: 4, sponsor_every: 0 } })).toBe("/display/event/e1");
  // Ton nur für diesen Bildschirm (#1118).
  expect(buildTvLink({ view: "bracket", targetId: "t1", displayKey: "k", overrides: { result_sound: true } })).toBe("/display/bracket/t1?key=k&result_sound=1");
});

test("Aufruf-Tafel für ein ganzes Event (#1122): eigene Ansicht, ohne Schlüssel - und zurückgelesen", () => {
  const link = buildTvLink({ origin: "https://club.example", view: "calls", targetId: "e1", displayKey: "nicht-hier", overrides: { call_sound: true } });
  expect(link).toBe("https://club.example/display/event/e1/calls?call_sound=1");
  expect(parseTvPath("/display/event/e1/calls")).toEqual({ view: "calls", targetId: "e1", stationId: "" });
  expect(parseTvPath("/display/event/e1")).toEqual({ view: "event", targetId: "e1", stationId: "" });
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

test("der Baukasten bietet je Ansicht nur, was dieser Bildschirm nutzt", () => {
  const keys = (view) => fieldsForView(view).map((field) => field.key);
  expect(keys("fastlap")).toContain("track_seconds");
  expect(keys("fastlap")).not.toContain("playlist");
  expect(keys("bracket")).toEqual(expect.arrayContaining(["playlist", "stats", "sponsor_presented", "result_sound", "call_sound"]));
  expect(keys("bracket")).not.toContain("track_seconds");
  expect(keys("event")).toEqual(expect.arrayContaining(["sponsor_moment", "sponsor_ticker", "report_minutes", "contrast"]));
  expect(keys("calls")).toContain("call_sound");
});

test("der Admin liest Werte in Alltagssprache", () => {
  expect(tvValueLabel("text_size", "large")).toBe("Groß");
  expect(tvValueLabel("safe_area", 5)).toBe("5 %");
  expect(tvValueLabel("contrast", false)).toBe("Aus");
  expect(tvValueLabel("pixel_shift", true)).toBe("An");
  expect(tvValueLabel("result_sound", false)).toBe("Aus");
  expect(tvValueLabel("track_seconds", 45)).toBe("45 s");
  expect(tvValueLabel("report_minutes", 2)).toBe("2 Min.");
  expect(tvValueLabel("playlist", [{ slide: "tree", seconds: 12 }, { slide: "calls", seconds: 8 }])).toBe("Turnierbaum 12 s · Aufrufe 8 s");
});
