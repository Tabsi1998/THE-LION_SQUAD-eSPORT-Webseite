import { describe, expect, it } from "vitest";
import { autoBannerKindLabel, autoBannerNumbers, autoBannerPeriod, autoBannerTemplateLabel } from "./autoBanners";

// #2352: automatische Banner in der Verwaltung - Art, Vorlage, Zeitraum und Zahlen.
const now = new Date("2026-11-11T10:00:00Z");

describe("autoBanners", () => {
  it("benennt Art und Vorlage", () => {
    expect(autoBannerKindLabel("tournament")).toBe("Turnier");
    expect(autoBannerKindLabel("fastlap")).toBe("Fast Lap");
    expect(autoBannerKindLabel("server")).toBe("Server-Wartung");
    expect(autoBannerTemplateLabel("tournament", "registration")).toBe("Anmeldung / Check-in");
    expect(autoBannerTemplateLabel("fastlap", "registration")).toBe("Einreichung offen");
    expect(autoBannerTemplateLabel("tournament", "event")).toBe("Startet bald");
  });

  it("schreibt den Zeitraum in Wiener Zeit und lässt freien Text stehen", () => {
    expect(autoBannerPeriod({ period_start: "2026-11-10T17:00:00Z", period_end: "2026-11-12T17:00:00Z" }, { now }))
      .toBe("Di 10. November · 18:00 – morgen 18:00");
    expect(autoBannerPeriod({ kind: "tournament", period_end: "2026-11-11T19:00:00Z" }, { now })).toBe("bis heute 20:00");
    expect(autoBannerPeriod({ kind: "server", period_end: "Freitagabend" }, { now })).toBe("bis Freitagabend");
    expect(autoBannerPeriod({ kind: "server" }, { now })).toBe("bis die Wartung endet");
    expect(autoBannerPeriod({ kind: "tournament" }, { now })).toBe("solange der Status passt");
  });

  it("zeigt Views, Klicks und die letzte Anzeige", () => {
    expect(autoBannerNumbers({ impressions: 9, clicks: 3, last_impression_at: "2026-11-11T07:00:00Z" }, { now }))
      .toBe("Views 9 · Klicks 3 · zuletzt angezeigt vor 3 Std.");
    expect(autoBannerNumbers(undefined, { now })).toBe("Views 0 · Klicks 0");
  });
});
