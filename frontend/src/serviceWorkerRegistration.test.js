import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { swNote } from "./serviceWorkerRegistration";

// Hinweise des Service Workers (#1908): ohne Schalter bleibt die Konsole still, mit „tls_sw_debug“ = „true“ nicht.
let info;
beforeEach(() => {
  info = vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  info.mockRestore();
  window.localStorage.removeItem("tls_sw_debug");
});

test("ohne Schalter schreibt der Service Worker nichts in die Konsole", () => {
  swNote("Cache aktiv");
  expect(info).not.toHaveBeenCalled();
});

test("mit Schalter steht der Hinweis in der Konsole", () => {
  window.localStorage.setItem("tls_sw_debug", "true");
  swNote("Cache aktiv");
  expect(info).toHaveBeenCalledWith("[TLS PWA] Cache aktiv");
});

test("ist der Speicher gesperrt, bleibt es still", () => {
  const getItem = vi.spyOn(window.Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("gesperrt");
  });
  swNote("Cache aktiv");
  expect(info).not.toHaveBeenCalled();
  getItem.mockRestore();
});
