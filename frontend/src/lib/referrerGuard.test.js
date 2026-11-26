import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { guardReferrer, releaseReferrer } from "./referrerGuard";

// Dritte Prüfrunde (#1662): Auf den Seiten mit Schlüssel in der Adresse gilt „no-referrer“, bevor ein Abruf startet.
describe("Referrer-Schutz", () => {
  it("setzt no-referrer nur auf den Seiten mit Schlüssel", () => {
    document.head.querySelectorAll('meta[name="referrer"]').forEach((node) => node.remove());
    expect(guardReferrer(document, "/profile")).toBe(false);
    expect(document.querySelector('meta[name="referrer"]')).toBeNull();
    expect(guardReferrer(document, "/sammel-mail/einzeln")).toBe(true);
    expect(document.querySelector('meta[name="referrer"]').getAttribute("content")).toBe("no-referrer");
    expect(guardReferrer(document, "/newsletter/abbestellen/")).toBe(false); // schon gesetzt
  });

  it("ist der erste Import der Website", () => {
    const entry = readFileSync(path.join(process.cwd(), "src", "index.jsx"), "utf8");
    const firstImport = entry.split("\n").map((line) => line.trim()).find((line) => line.startsWith("import "));
    expect(firstImport).toBe('import "@/lib/referrerGuard";');
  });

  it("gibt die übliche Regel zurück, sobald der Schlüssel weg ist", () => {
    document.head.querySelectorAll('meta[name="referrer"]').forEach((node) => node.remove());
    guardReferrer(document, "/sammel-mail/einzeln");
    expect(releaseReferrer(document)).toBe(true);
    const metas = [...document.querySelectorAll('meta[name="referrer"]')].map((node) => node.getAttribute("content"));
    expect(metas).toEqual(["strict-origin-when-cross-origin"]);
    expect(releaseReferrer(document)).toBe(false);
  });
});
