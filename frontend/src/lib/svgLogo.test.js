import { isSvgFile, isSvgUpload, rasterLogoUrl, teamLogoUpload } from "./svgLogo";

// Logos als SVG (#1952): Favicon, App-Symbol und Teilen-Bild können kein SVG - sie nehmen die PNG-Fassung daneben.

test("ein hochgeladenes SVG zeigt auf seine PNG-Fassung, alles andere bleibt", () => {
  expect(rasterLogoUrl("/api/static/uploads/abc123.svg")).toBe("/api/static/uploads/abc123.png");
  expect(rasterLogoUrl("https://lionsquad.example/api/static/uploads/abc123.svg?v=2")).toBe("https://lionsquad.example/api/static/uploads/abc123.png?v=2");
  expect(rasterLogoUrl("/api/static/uploads/abc123.SVG#x")).toBe("/api/static/uploads/abc123.png#x");
  expect(rasterLogoUrl("/api/static/uploads/foto.webp")).toBe("/api/static/uploads/foto.webp");
  expect(rasterLogoUrl("/assets/flags/at.svg")).toBe("/assets/flags/at.svg");
  expect(rasterLogoUrl("https://fremd.example/logo.svg")).toBe("https://fremd.example/logo.svg");
  expect(rasterLogoUrl("")).toBe("");
  expect(rasterLogoUrl(null)).toBe(null);
});

test("SVG erkennen: Upload-Adresse und gewählte Datei", () => {
  expect(isSvgUpload("/api/static/uploads/abc123.svg")).toBe(true);
  expect(isSvgUpload("/api/static/uploads/abc123.png")).toBe(false);
  expect(isSvgUpload("/assets/brand/logo.svg")).toBe(false);
  expect(isSvgFile({ name: "logo.svg", type: "" })).toBe(true);
  expect(isSvgFile({ name: "logo", type: "image/svg+xml" })).toBe(true);
  expect(isSvgFile({ name: "logo.png", type: "image/png" })).toBe(false);
});

test("Teamlogo als SVG nur für ein bestehendes Team, über dessen Logo-Route", () => {
  expect(teamLogoUpload({ id: "t 1" })).toEqual({ logo: true, endpoint: "/uploads/team-logo?team_id=t%201" });
  expect(teamLogoUpload({})).toEqual({});
  expect(teamLogoUpload(null)).toEqual({});
});
