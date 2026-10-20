import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { resolveAuditBaseUrl, isProductionHost, assertNotProduction } = require("../../scripts/audit-base-url.js");

describe("Content-Audit: Basis-Adresse (#1007)", () => {
  it("bricht ohne ausdrücklich gesetzte Adresse ab", () => {
    expect(() => resolveAuditBaseUrl({})).toThrow(/PUBLIC_AUDIT_BASE_URL fehlt/);
    expect(() => resolveAuditBaseUrl({ PUBLIC_AUDIT_BASE_URL: "   " })).toThrow(/fehlt/);
  });

  it("lehnt ungültige Adressen ab", () => {
    expect(() => resolveAuditBaseUrl({ PUBLIC_AUDIT_BASE_URL: "kein url" })).toThrow(/keine gültige Adresse/);
    expect(() => resolveAuditBaseUrl({ PUBLIC_AUDIT_BASE_URL: "ftp://127.0.0.1" })).toThrow(/http/);
    expect(() => resolveAuditBaseUrl({ PUBLIC_AUDIT_BASE_URL: "http://nutzer:geheim@127.0.0.1" })).toThrow(/Zugangsdaten/);
  });

  it("nimmt lokale und Staging-Adressen ohne abschließenden Schrägstrich", () => {
    expect(resolveAuditBaseUrl({ PUBLIC_AUDIT_BASE_URL: "http://127.0.0.1:3000/" })).toBe("http://127.0.0.1:3000");
    expect(resolveAuditBaseUrl({ PUBLIC_AUDIT_BASE_URL: "https://staging.example.test" })).toBe("https://staging.example.test");
  });

  it("lässt die echte Seite nur mit bewusstem zweiten Schalter zu", () => {
    const production = "https://www.lionsquad.at/";
    expect(() => resolveAuditBaseUrl({ PUBLIC_AUDIT_BASE_URL: production })).toThrow(/echte Seite/);
    expect(() => resolveAuditBaseUrl({ PUBLIC_AUDIT_BASE_URL: production, PUBLIC_AUDIT_ALLOW_PRODUCTION: "true" })).toThrow(/echte Seite/);
    expect(resolveAuditBaseUrl({ PUBLIC_AUDIT_BASE_URL: production, PUBLIC_AUDIT_ALLOW_PRODUCTION: "1" })).toBe("https://www.lionsquad.at");
  });
});

describe("Content-Audit: Schutz vor der echten Seite (#1007)", () => {
  it("erkennt die echte Seite trotz Schreibweise, Punkt am Ende, Subdomain und IDN", () => {
    ["lionsquad.at", "LionSquad.AT", "lionsquad.at.", "www.lionsquad.at", "api.staging.lionsquad.at.", "ｌｉｏｎｓｑｕａｄ.at"]
      .forEach((host) => expect(isProductionHost(host), host).toBe(true));
    ["evil-lionsquad.at", "lionsquad.at.example.test", "127.0.0.1", "localhost"]
      .forEach((host) => expect(isProductionHost(host), host).toBe(false));
  });

  it("lehnt die echte Seite mit DNS-Punkt in der Basis-Adresse ab", () => {
    expect(() => resolveAuditBaseUrl({ PUBLIC_AUDIT_BASE_URL: "https://lionsquad.at." })).toThrow(/echte Seite/);
    expect(() => resolveAuditBaseUrl({ PUBLIC_AUDIT_BASE_URL: "https://staging.lionsquad.at" })).toThrow(/echte Seite/);
  });

  it("bricht bei Weiterleitung auf die echte Seite ab, außer mit Freigabe", () => {
    expect(() => assertNotProduction("http://127.0.0.1:3000/news", {})).not.toThrow();
    expect(() => assertNotProduction("https://lionsquad.at./news", {})).toThrow(/Abbruch/);
    expect(() => assertNotProduction("https://cdn.lionsquad.at/a.png", { PUBLIC_AUDIT_ALLOW_PRODUCTION: "0" })).toThrow(/Abbruch/);
    expect(() => assertNotProduction("https://lionsquad.at/", { PUBLIC_AUDIT_ALLOW_PRODUCTION: "1" })).not.toThrow();
  });
});
