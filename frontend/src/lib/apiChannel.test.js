import { describe, expect, it } from "vitest";
import { api, uploadApi } from "./api";
import { CHANNEL_HEADER } from "./newsChannels";

// Kanal (#1532): Website und App teilen sich /api/news, die Suche und die Event-Seite. Die Website meldet sich bei
// jedem Aufruf als „web“ - sonst sähe sie News „nur App“, denn ohne Kopfzeile gilt ein Aufruf als App.
function runRequestInterceptors(client, config) {
  return client.interceptors.request.handlers.filter(Boolean).reduce((current, handler) => handler.fulfilled(current), config);
}

function headerOf(config, name) {
  const headers = config.headers || {};
  return typeof headers.get === "function" ? headers.get(name) : headers[name];
}

describe("api: Kanal-Kopfzeile", () => {
  it("meldet jeden Aufruf der Website als web", () => {
    for (const method of ["get", "post", "patch", "delete"]) {
      const config = runRequestInterceptors(api, { method, url: "/news", headers: {} });
      expect(headerOf(config, CHANNEL_HEADER)).toBe("web");
    }
  });

  it("auch beim Hochladen", () => {
    const config = runRequestInterceptors(uploadApi, { method: "post", url: "/uploads", headers: {} });
    expect(headerOf(config, CHANNEL_HEADER)).toBe("web");
  });
});
