const { test, expect } = require("@playwright/test");
const { generateKeyPairSync, randomBytes } = require("node:crypto");

// Passkey-Anmeldung im echten Browser mit dem virtuellen Authenticator von Chromium. Zwei Wege:
// der Knopf „Mit Passkey anmelden“ und – seit #348 – der Vorschlag im E-Mail-Feld, den der
// Browser von selbst anbietet. Der virtuelle Authenticator bestätigt sofort; ein Mensch wählt
// den Passkey im echten Browser erst aus der Vorschlagsliste.

async function virtualPasskey(page, context) {
  const session = await context.newCDPSession(page);
  await session.send("WebAuthn.enable");
  const { authenticatorId } = await session.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const identifier = randomBytes(24);
  await session.send("WebAuthn.addCredential", { authenticatorId, credential: {
    credentialId: identifier.toString("base64"), isResidentCredential: true, rpId: "localhost",
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    userHandle: Buffer.from("user-1").toString("base64"), signCount: 0,
  } });
  return { session, authenticatorId, identifier };
}

async function mockApi(page, identifier, seen) {
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ contentType: "application/json", body: "null" }));
  await page.route("**/api/auth/passkeys/status", (route) => route.fulfill({ contentType: "application/json", body: '{"enabled":true}' }));
  await page.route("**/api/auth/passkeys/login/options", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ challenge: randomBytes(32).toString("base64url"), rpId: "localhost", userVerification: "required", timeout: 10000 }) }));
  await page.route("**/api/auth/passkeys/login/verify", (route) => {
    const body = route.request().postDataJSON();
    expect(body.credential.id).toBe(identifier.toString("base64url"));
    expect(body.credential.response.signature).toBeTruthy();
    expect(body.credential.response.authenticatorData).toBeTruthy();
    seen.push(body);
    return route.fulfill({ contentType: "application/json", body: '{"mfa_required":true,"mfa_ticket":"passkey-mfa-ticket"}' });
  });
}

async function openLogin(page, baseURL) {
  const loginURL = new URL("/login", baseURL);
  loginURL.hostname = "localhost";
  await page.goto(loginURL.href);
  const consent = page.getByRole("button", { name: /alle akzeptieren/i });
  if (await consent.count()) await consent.click();
}

test("native browser passkey login continues into the existing admin MFA flow", async ({ page, context, browserName, baseURL }) => {
  test.skip(browserName !== "chromium", "The virtual WebAuthn authenticator requires Chromium CDP.");
  const { session, authenticatorId, identifier } = await virtualPasskey(page, context);
  const seen = [];
  await mockApi(page, identifier, seen);
  // Dieser Fall prüft den Knopf: der Vorschlag im E-Mail-Feld bleibt aus.
  await page.addInitScript(() => {
    if (window.PublicKeyCredential) window.PublicKeyCredential.isConditionalMediationAvailable = async () => false;
  });
  await openLogin(page, baseURL);
  await page.getByTestId("login-remember").uncheck();
  await page.getByTestId("login-passkey").click();
  await expect(page.getByTestId("login-mfa-code")).toBeVisible();
  expect(seen).toHaveLength(1);
  expect(seen[0].remember).toBe(false);
  await session.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
});

test("the browser offers saved passkeys by itself and the sign-in continues into MFA", async ({ page, context, browserName, baseURL }) => {
  test.skip(browserName !== "chromium", "The virtual WebAuthn authenticator requires Chromium CDP.");
  const { session, authenticatorId, identifier } = await virtualPasskey(page, context);
  const seen = [];
  await mockApi(page, identifier, seen);
  await openLogin(page, baseURL);
  // Kein Klick: der Vorschlag läuft im Hintergrund, der virtuelle Authenticator bestätigt ihn.
  await expect(page.getByTestId("login-mfa-code")).toBeVisible();
  expect(seen).toHaveLength(1);
  expect(seen[0].remember).toBe(true);
  await session.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
});
