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
