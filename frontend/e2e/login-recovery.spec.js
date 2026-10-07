const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({}),
  }));
  await page.route("**/api/auth/me", (route) => route.fulfill({
    contentType: "application/json", body: "null",
  }));
  await page.addInitScript(() => localStorage.setItem("tls_cookie_consent", "all"));
});

async function dismissCookies(page) {
  const button = page.getByRole("button", { name: /alle erlauben/i });
  if (await button.count()) await button.click();
}

test("existing unverified account has a recovery path without re-registration", async ({ page }) => {
  // The old API message remains supported during rolling updates.
  await page.route("**/api/auth/login", (route) => route.fulfill({
    status: 403, contentType: "application/json",
    body: JSON.stringify({ detail: "E-Mail-Adresse noch nicht bestätigt. Bitte prüfe dein Postfach." }),
  }));
  await page.goto("/login");
  await dismissCookies(page);
  await page.getByTestId("login-email").fill("existing@example.test");
  await page.getByTestId("login-password").fill("existing-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-verification-recovery")).toBeVisible();
  await page.getByRole("link", { name: "Bestätigungslink anfordern", exact: true }).click();
  await expect(page.locator("#verify-email")).toHaveValue("existing@example.test");
  expect(new URL(page.url()).search).toBe("");
  await expect(page.locator("#verify-sent")).toHaveCount(0);

  let sends = 0;
  await page.route("**/api/auth/resend-verification", async (route) => {
    sends += 1;
    expect(route.request().postDataJSON()).toEqual({ email: "existing@example.test" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  await page.getByTestId("verify-resend-submit").evaluate((button) => {
    button.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    button.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await expect(page.locator("#verify-sent")).toContainText("Versand angefordert");
  expect(sends).toBe(1);
  await expect(page.getByText(/muss der Betreiber die Mail-Warteschlange/)).toBeVisible();
});

test("verification request errors remain visible and allow retry", async ({ page }) => {
  await page.route("**/api/auth/resend-verification", (route) => route.fulfill({
    status: 429, contentType: "application/json", body: JSON.stringify({ detail: "Bitte später erneut versuchen." }),
  }));
  await page.goto("/verify-email");
  await dismissCookies(page);
  await page.locator("#verify-email").fill("existing@example.test");
  await page.getByTestId("verify-resend-submit").click();
  await expect(page.locator("#verify-error")).toContainText("Bitte später erneut versuchen.");
  await expect(page.getByTestId("verify-resend-submit")).toBeEnabled();
  await expect(page.locator("#verify-sent")).toHaveCount(0);
});

test("MFA supports recovery-code letters and clean restart after expired challenge", async ({ page }) => {
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json", body: '{"mfa_required":true,"mfa_ticket":"expired-test-ticket"}',
  }));
  await page.route("**/api/auth/mfa/complete", (route) => route.fulfill({
    status: 401, contentType: "application/json", body: JSON.stringify({ detail: "MFA-Anmeldung ist ungültig oder abgelaufen." }),
  }));
  await page.goto("/login");
  await dismissCookies(page);
  await page.getByTestId("login-email").fill("existing@example.test");
  await page.getByTestId("login-password").fill("existing-password");
  await page.getByTestId("login-submit").click();
  const code = page.getByTestId("login-mfa-code");
  await expect(code).toHaveAttribute("inputmode", "text");
  await code.fill("ABCD-EFGH");
  await page.getByTestId("login-mfa-submit").click();
  await expect(page.locator("#login-error")).toContainText("abgelaufen");
  await page.getByRole("button", { name: "Zurück zum Login" }).click();
  await expect(page.getByTestId("login-email")).toBeVisible();
  await expect(page.locator("#login-error")).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem("tls.mfa.ticket"))).toBeNull();
});

test("MFA intermediate credentials are not persisted and reload restarts login", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("tls.mfa.ticket", "legacy-ticket"));
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json", body: '{"mfa_required":true,"mfa_ticket":"memory-only-ticket"}',
  }));
  await page.goto("/login");
  await dismissCookies(page);
  await page.getByTestId("login-email").fill("existing@example.test");
  await page.getByTestId("login-password").fill("existing-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-mfa-code")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("tls.mfa.ticket"))).toBeNull();
  await page.reload();
  await expect(page.getByTestId("login-email")).toBeVisible();
});

test("Google login hands MFA to the already mounted login page without browser storage", async ({ page }) => {
  await page.addInitScript(() => {
    let callback;
    window.google = { accounts: { id: {
      initialize(options) { callback = options.callback; },
      renderButton(element) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Test Google login";
        button.onclick = () => callback({ credential: "test-google-credential" });
        element.appendChild(button);
      },
    } } };
  });
  await page.route("**/api/settings/public", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ google_configured: true, google_login_enabled: true, google_client_id: "test-client" }),
  }));
  await page.route("**/api/auth/google/session", (route) => route.fulfill({
    contentType: "application/json", body: '{"mfa_required":true,"mfa_ticket":"google-memory-ticket"}',
  }));
  await page.goto("/login");
  await dismissCookies(page);
  await page.getByRole("button", { name: "Test Google login" }).click();
  await expect(page.getByTestId("login-mfa-code")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("tls.mfa.ticket"))).toBeNull();
});
