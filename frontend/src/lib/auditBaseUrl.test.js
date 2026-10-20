import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { resolveAuditBaseUrl } = require("../../scripts/audit-base-url.js");

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
