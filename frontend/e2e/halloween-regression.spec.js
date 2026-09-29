const { expect } = require("@playwright/test");
const { defineSeasonQa } = require("./seasonQa");

// Halloween IV (H20, #708) über den Abnahme-Standard für jede Saison (Seasonal Core C6, #726, seasonQa.js): die Saison
// auf den Hauptseiten und Breakpoints - kein horizontales Scrollen, Kopfzeile und Menü bedienbar, keine Fledermaus
// und kein Netz über Text oder Bedienelementen, Handy ohne Netze und höchstens eine Fledermaus, Dropdown über der
// Deko, Reduced Motion still, Saison aus = Seite ohne Deko-Elemente. Hier stehen nur noch die Teile und Grenzen
// von Halloween; die Prüfungen liegen im Standard. Screenshots hängen am Bericht.

defineSeasonQa({
  title: "Halloween: Abnahme auf Hauptseiten und Breakpoints",
  seasonKey: "halloween",
  now: "2026-10-28T20:00:00+01:00",
  season: { key: "halloween", phase: "deko", intensity: "full", channels: ["web", "app"], texts: { greeting: "Happy Halloween" }, data: { night: true }, starts_at: "", ends_at: "" },
  pieces: "[data-testid='halloween-bat-hanging'], [data-testid='halloween-corner-web'], [data-testid='halloween-eyes']",
  layers: ".tls-hbats, .tls-cwebs, .tls-eyes, .tls-fog, .tls-edge",
  exempt: "[data-season-anchor='lion']",
  offPieces: "[data-testid^='halloween-']",
  yielding: "[data-testid='halloween-bat-hanging'], [data-testid='halloween-corner-web']",
  countPieces: () => ({
    webs: document.querySelectorAll("[data-testid='halloween-corner-web']").length,
    bats: document.querySelectorAll("[data-testid='halloween-bat-hanging']").length,
    eyes: document.querySelectorAll("[data-testid='halloween-eyes']").length,
    scene: document.querySelector("[data-testid='halloween-footer-scene']")?.dataset.size || null,
  }),
  // Handy: keine Netze, höchstens eine Fledermaus, kleine Fußzeilen-Szene, keine Augen; Tablet: ein Netz, zwei Fledermäuse.
  mobileLimits: (counts, viewport, path) => {
    if (viewport.width < 640) {
      expect(counts.webs, `keine Netze auf ${path}`).toBe(0);
      expect(counts.bats, `höchstens eine Fledermaus auf ${path}`).toBeLessThanOrEqual(1);
      expect(counts.eyes).toBe(0);
      expect([null, "small", "none"]).toContain(counts.scene);
    } else {
      expect(counts.webs).toBeLessThanOrEqual(1);
      expect(counts.bats).toBeLessThanOrEqual(2);
    }
  },
  reducedMotionState: () => ({
    fog: document.querySelector("[data-testid='halloween-fog']")?.className || null,
    bats: [...document.querySelectorAll("[data-testid='halloween-bat-hanging']")].filter((el) => getComputedStyle(el.closest(".tls-hbats")).display !== "none").length,
    eyes: document.querySelectorAll("[data-testid='halloween-eyes']").length,
    staticWeb: document.querySelectorAll("[data-testid='halloween-web-static']").length,
    canvas: document.querySelectorAll("[data-testid='season-sky']").length,
  }),
  // Reduced Motion: Nebel still, keine Fledermäuse, keine Augen, Netz statisch.
  reducedMotion: (state) => {
    expect(state.bats).toBe(0);
    expect(state.eyes).toBe(0);
    if (state.fog) expect(state.fog).toContain("tls-fog--static");
    expect(state.staticWeb + state.canvas).toBeGreaterThanOrEqual(1);
  },
});
