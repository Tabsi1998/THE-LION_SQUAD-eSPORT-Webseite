import { dataSourceHint } from "./seriesDataSource";

// „Daten von …“ (#1964): mit Partner seine Seite, sonst die Plattform (nur https); ohne Quelle nichts.

test("mit gewähltem Partner: sein Name und seine Seite im Web", () => {
  expect(dataSourceHint({ provider: "PineApps", url: "https://tft.pineapps.at", partner: { id: "p-ananas", slug: "probe-ananas", name: "Probe Ananas" } }))
    .toEqual({ name: "Probe Ananas", kind: "partner", target: "/partners/probe-ananas" });
});

test("ohne Partner: die Plattform mit ihrer https-Adresse", () => {
  expect(dataSourceHint({ provider: "PineApps", url: "https://tft.pineapps.at", partner: null }))
    .toEqual({ name: "PineApps", kind: "platform", target: "https://tft.pineapps.at" });
});

test("eine Adresse ohne https wird kein Link - der Name bleibt", () => {
  for (const url of ["http://tft.pineapps.at", "javascript:alert(1)", "", null]) {
    expect(dataSourceHint({ provider: "PineApps", url })).toEqual({ name: "PineApps", kind: "text", target: "" });
  }
});

test("älterer Server oder leere Quelle: kein Hinweis", () => {
  expect(dataSourceHint(undefined)).toBeNull();
  expect(dataSourceHint(null)).toBeNull();
  expect(dataSourceHint({})).toBeNull();
  expect(dataSourceHint({ provider: "  ", partner: { name: "" } })).toBeNull();
  expect(dataSourceHint("kaputt" as never)).toBeNull();
});
