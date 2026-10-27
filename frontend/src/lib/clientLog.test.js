import { scrubClientLogText, startWebClientLogging } from "./clientLog";

vi.mock("./api", () => ({ api: { post: vi.fn(() => Promise.resolve({ data: {} })) } }));

// Web-Fehler waren nur mit VITE_CLIENT_LOGGING=true sichtbar; im Standard blieb
// der Adminbereich blind (#233). Ohne die Variable ist die Sammlung jetzt an.
test("web client logging starts by default", () => {
  delete window.__tlsWebClientLoggingStarted;
  startWebClientLogging();
  expect(window.__tlsWebClientLoggingStarted).toBe(true);
});


test("client log sanitizer removes credentials and URL details", () => {
  const raw = [
    "https://lionsquad.at/reset-password?token=secret-value#step",
    "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
    "person@example.com",
  ].join(" ");
  const safe = scrubClientLogText(raw, 2000);

  expect(safe).toContain("https://lionsquad.at/reset-password");
  expect(safe).toContain("Bearer [redacted]");
  expect(safe).toContain("[redacted-email]");
  expect(safe).not.toContain("secret-value");
  expect(safe).not.toContain("person@example.com");
});

// #1230: die Fehlerseite zeigt Admins die Kennung der Meldung - dieselbe wie unter „Betrieb & Logs“.
test("reportCaughtError liefert die Kennung der Meldung, ein gleicher Fehler gleich danach dieselbe", async () => {
  const { api } = await import("./api");
  const { reportCaughtError } = await import("./clientLog");
  api.post.mockClear();
  api.post.mockResolvedValueOnce({ data: { ok: true, id: "log-4711" } });
  const error = new TypeError("liste.map is not a function");
  await expect(reportCaughtError(error, "in Seite")).resolves.toBe("log-4711");
  await expect(reportCaughtError(error, "in Seite")).resolves.toBe("log-4711");
  expect(api.post).toHaveBeenCalledTimes(1);

  // Ohne Anmeldung lehnt der Server ab - dann gibt es keine Kennung, und nichts bricht.
  api.post.mockRejectedValueOnce(new Error("401"));
  await expect(reportCaughtError(new Error("anderer Fehler"))).resolves.toBeNull();
});

// #2080: ein veralteter Baustein nach einem Deploy ist kein Fehler der Website - höchstens ein Hinweis.
test("ein veralteter Baustein kommt nur als Hinweis an, nicht als Fehler", async () => {
  const { api } = await import("./api");
  const { reportCaughtError } = await import("./clientLog");
  api.post.mockClear();
  await reportCaughtError(new TypeError("Failed to fetch dynamically imported module: https://lionsquad.at/assets/ReferenceRoundPage-1.js"), "in Seite");
  expect(api.post).toHaveBeenCalledTimes(1);
  const [, body] = api.post.mock.calls[0];
  expect(body.level).toBe("info");
  expect(body.message).toMatch(/^Veralteter Stand nach Update/);
  expect(body.stack).toContain("ReferenceRoundPage");
});

test("lädt die Seite schon neu, meldet ein veralteter Baustein gar nichts", async () => {
  const { api } = await import("./api");
  const { requestChunkReload } = await import("./chunkReload");
  const storage = { getItem: () => null, setItem: () => {} };
  expect(requestChunkReload({ reload: vi.fn(), storage })).toBe(true);
  delete window.__tlsWebClientLoggingStarted;
  startWebClientLogging();
  api.post.mockClear();
  const event = new Event("unhandledrejection");
  event.reason = new TypeError("Failed to fetch dynamically imported module: https://lionsquad.at/assets/Other-2.js");
  window.dispatchEvent(event);
  expect(api.post).not.toHaveBeenCalled();
});
