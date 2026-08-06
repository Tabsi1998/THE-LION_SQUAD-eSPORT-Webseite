import { scrubClientLogText } from "./clientLog";


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
