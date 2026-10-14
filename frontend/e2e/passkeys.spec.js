const { test, expect } = require("@playwright/test");
const { generateKeyPairSync, randomBytes } = require("node:crypto");

// Passkey-Anmeldung im echten Browser mit dem virtuellen Authenticator von Chromium. Zwei Wege (#1520,
// FIDO-Empfehlung): der Vorschlag im E-Mail-Feld, den der Browser von selbst anbietet (#348), und der
// Knopf „Mit Passkey anmelden“, der immer da ist. Der virtuelle Authenticator bestätigt sofort; ein Mensch
// wählt den Passkey im echten Browser erst aus der Vorschlagsliste oder dem Dialog.

async function virtualAuthenticator(page, context) {
  const session = await context.newCDPSession(page);
  await session.send("WebAuthn.enable");
  const { authenticatorId } = await session.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { session, authenticatorId };
}

async function virtualPasskey(page, context) {
  const { session, authenticatorId } = await virtualAuthenticator(page, context);
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
  const consent = page.getByRole("button", { name: /alle erlauben/i });
  if (await consent.count()) await consent.click();
}

// Der Server antwortet in beiden Fällen gemockt mit „Code nötig“ - das ist nur das sichtbare
// Zeichen, dass die Anmeldung beim Server ankam. Seit #358 gibt der echte Server nach einem
// Passkey keinen Code mehr auf; die Seite versteht beide Antworten.
test("native browser passkey login reaches the server and follows its answer", async ({ page, context, browserName, baseURL }) => {
  test.skip(browserName !== "chromium", "The virtual WebAuthn authenticator requires Chromium CDP.");
  const { session, authenticatorId, identifier } = await virtualPasskey(page, context);
  const seen = [];
  await mockApi(page, identifier, seen);
  // Dieser Fall prüft den Knopf in einem Browser ohne Vorschlag im E-Mail-Feld.
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

test("the browser offers saved passkeys by itself and the sign-in follows the server's answer", async ({ page, context, browserName, baseURL }) => {
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

// Ganzer Weg mit einem (virtuellen) Gerät: Passkey nach der Passwort-Anmeldung anlegen, dann mit dem Knopf ohne
// E-Mail anmelden. Der Passkey muss auffindbar sein (residentKey), sonst fände der Browser ihn ohne E-Mail nicht.
test("a passkey created after the password login is discoverable and signs in with the button", async ({ page, context, browserName, baseURL }) => {
  test.skip(browserName !== "chromium", "The virtual WebAuthn authenticator requires Chromium CDP.");
  const { session, authenticatorId } = await virtualAuthenticator(page, context);
  const userHandle = Buffer.from("user-1").toString("base64url");
  const registered = [];
  const signedIn = [];
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ contentType: "application/json", body: "null" }));
  await page.route("**/api/auth/passkeys/status", (route) => route.fulfill({ contentType: "application/json", body: '{"enabled":true}' }));
  await page.route("**/api/auth/passkeys", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/login", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "user-1", email: "paula@example.test", role: "player" }) }));
  // So wie der Server sie baut (py_webauthn, #155): auffindbar und mit Gerätesperre.
  await page.route("**/api/auth/passkeys/register/options", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    rp: { id: "localhost", name: "THE LION SQUAD" }, user: { id: userHandle, name: "paula@example.test", displayName: "Paula" },
    challenge: randomBytes(32).toString("base64url"), pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    timeout: 60000, excludeCredentials: [], authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" }, attestation: "none",
  }) }));
  await page.route("**/api/auth/passkeys/register/verify", (route) => {
    registered.push(route.request().postDataJSON().credential);
    return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  await page.route("**/api/auth/passkeys/login/options", (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ challenge: randomBytes(32).toString("base64url"), rpId: "localhost", allowCredentials: [], userVerification: "required", timeout: 60000 }) }));
  await page.route("**/api/auth/passkeys/login/verify", (route) => {
    signedIn.push(route.request().postDataJSON());
    return route.fulfill({ contentType: "application/json", body: '{"mfa_required":true,"mfa_ticket":"passkey-mfa-ticket"}' });
  });
  // Der Vorschlag im Feld würde mit dem virtuellen Gerät sofort selbst anmelden; hier zählt der Knopf.
  await page.addInitScript(() => {
    if (window.PublicKeyCredential) window.PublicKeyCredential.isConditionalMediationAvailable = async () => false;
  });

  await openLogin(page, baseURL);
  await page.getByTestId("login-email").fill("paula@example.test");
  await page.getByTestId("login-password").fill("geheim-geheim-42");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("passkey-offer-setup").click();
  await expect.poll(() => registered.length).toBe(1);
  const { credentials } = await session.send("WebAuthn.getCredentials", { authenticatorId });
  expect(credentials).toHaveLength(1);
  expect(credentials[0].isResidentCredential).toBe(true);
  expect(credentials[0].rpId).toBe("localhost");
  expect(Buffer.from(credentials[0].credentialId, "base64").toString("base64url")).toBe(registered[0].id);

  await openLogin(page, baseURL);
  await page.getByTestId("login-passkey").click();
  await expect(page.getByTestId("login-mfa-code")).toBeVisible();
  expect(signedIn).toHaveLength(1);
  // Ohne E-Mail und ohne Liste gefunden: derselbe Passkey, mit der Kennung des Kontos (die liefern nur auffindbare Passkeys).
  expect(signedIn[0].credential.id).toBe(registered[0].id);
  expect(signedIn[0].credential.response.userHandle).toBe(userHandle);
  await session.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
});
