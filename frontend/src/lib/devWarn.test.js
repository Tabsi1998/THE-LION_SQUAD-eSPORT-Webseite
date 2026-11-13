import { afterEach, expect, test, vi } from "vitest";
import { devWarn } from "./devWarn";

// Hinweise nur beim Entwickeln (#937): in Tests und im fertigen Build still, beim Entwickeln eine Warnung mit Grund.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("beim Entwickeln eine Warnung mit der Fehlermeldung", () => {
  vi.stubEnv("MODE", "development");
  vi.stubEnv("DEV", true);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  devWarn("Branding nicht geladen", new Error("Network Error"));
  expect(warn).toHaveBeenCalledWith("[TLS] Branding nicht geladen", "Network Error");
});

test("in Tests und im fertigen Build still", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  devWarn("im Test");
  vi.stubEnv("MODE", "production");
  vi.stubEnv("DEV", false);
  devWarn("im Build");
  expect(warn).not.toHaveBeenCalled();
});
