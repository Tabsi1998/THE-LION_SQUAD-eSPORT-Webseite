// Podest und TV lesen Abschnittsnamen aus der gemeinsamen Quelle (#1591, Codex): Rand-Leerzeichen und alle
// Server-Werte für den Hauptbaum (auch „winners“) zählen gleich.
import { describe, expect, it } from "vitest";
import { normalizeSection } from "@/lib/bracketPodium";
import { MAIN_SECTIONS, LOSER_SECTIONS } from "@/lib/bracketSections";

describe("Abschnittsnamen im Podest", () => {
  it("vergleicht ohne Rand-Leerzeichen und ohne Groß/Klein", () => {
    expect(normalizeSection("  Winners ")).toBe("winners");
    expect(normalizeSection(undefined)).toBe("main");
  });

  it("kennt alle Hauptbaum- und Loser-Namen des Servers", () => {
    expect(MAIN_SECTIONS.has(normalizeSection("WINNERS"))).toBe(true);
    expect(LOSER_SECTIONS.has(normalizeSection(" LB "))).toBe(true);
  });
});
