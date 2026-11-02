import { readFileSync } from "node:fs";
import path from "node:path";
import { reportablePath } from "./reportPath";

// Fehler melden: Pfad ohne Kennungen.

test("der Pfad geht ohne Abfrage mit, Seiten mit einer Kennung in der Adresse nur bis zum festen Teil", () => {
  expect(reportablePath("/events/herbst")).toBe("/events/herbst");
  expect(reportablePath("/events/herbst?a=1#b")).toBe("/events/herbst");
  expect(reportablePath("/karte/pruefen/abc123")).toBe("/karte/pruefen/…");
  expect(reportablePath("/karte/pruefen/abc123?x=1")).toBe("/karte/pruefen/…");
  expect(reportablePath("")).toBe("");
  expect(reportablePath(null)).toBe("");
});

// Wächter: eine neue öffentliche Seite mit so einem Platzhalter in der Adresse gehört auch in die Liste.
test("jede Route mit einer Kennung als Platzhalter wird gekürzt", () => {
  const app = readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  const routes = [...app.matchAll(/path="(\/[^"]*:(?:token|code|secret|hash|signature)[^"]*)"/gi)].map((match) => match[1]);
  expect(routes.length).toBeGreaterThan(0);
  for (const route of routes) {
    const sample = route.replace(/:[a-z]+/gi, "wert");
    expect(reportablePath(sample), route).toContain("…");
    expect(reportablePath(sample), route).not.toContain("wert");
  }
});
