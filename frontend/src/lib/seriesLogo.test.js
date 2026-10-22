import { describe, expect, it } from "vitest";
import { inheritedLogoHint, markWithLogo, seriesLogo } from "@/lib/seriesLogo";
import { lineagePayload, lineageToForm, seriesPayload, seriesToForm } from "@/lib/referenceSeries";

// Logo je Spur und Saison (#2014) - nur erfundene Daten.

describe("seriesLogo", () => {
  it("nimmt das Logo der Saison vor dem der Spur", () => {
    expect(seriesLogo({ logo_url: "/api/static/uploads/spur.png" }, { logo_url: "/api/static/uploads/saison.png" })).toBe("/api/static/uploads/saison.png");
    expect(seriesLogo({ logo_url: "/api/static/uploads/spur.png" }, { logo_url: null })).toBe("/api/static/uploads/spur.png");
  });

  it("ohne Logo bleibt es leer - die Stelle zeigt ihren bisherigen Rückfall", () => {
    expect(seriesLogo({}, {})).toBe("");
    expect(seriesLogo(null, undefined)).toBe("");
    const game = { name: "Probe Spiel", logo_url: "/api/static/uploads/spiel.png" };
    expect(markWithLogo(game, "")).toBe(game);
    expect(markWithLogo(game, "/api/static/uploads/spur.png")).toEqual({ name: "Probe Spiel", logo_url: "/api/static/uploads/spur.png" });
    expect(markWithLogo(null, "/api/static/uploads/spur.png")).toEqual({ logo_url: "/api/static/uploads/spur.png" });
  });

  it("nennt in der Verwaltung, was eine Saison ohne eigenes Logo zeigt", () => {
    expect(inheritedLogoHint({ logo_url: "/api/static/uploads/spur.png" })).toMatch(/Logo der Spur/);
    expect(inheritedLogoHint({})).toMatch(/Spiel-Logo/);
  });
});

describe("Formulare", () => {
  it("Spur: Logo hin und zurück, leer heißt null", () => {
    expect(lineageToForm({ title: "Probe", logo_url: "/api/static/uploads/spur.png" }).logo_url).toBe("/api/static/uploads/spur.png");
    expect(lineagePayload(lineageToForm({ title: "Probe", logo_url: "/api/static/uploads/spur.png" })).logo_url).toBe("/api/static/uploads/spur.png");
    expect(lineagePayload(lineageToForm({ title: "Probe" })).logo_url).toBeNull();
  });

  it("Saison: eigenes Logo hin und zurück, leer heißt „wie die Spur“", () => {
    const form = seriesToForm({ season: "2026", logo_url: "/api/static/uploads/saison.png" }, {});
    expect(form.logo_url).toBe("/api/static/uploads/saison.png");
    expect(seriesPayload(form).logo_url).toBe("/api/static/uploads/saison.png");
    expect(seriesPayload(seriesToForm({ season: "2026" }, {})).logo_url).toBeNull();
  });
});
