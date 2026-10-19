const { test, expect } = require("@playwright/test");
const { ENABLED, state, signIn, watch } = require("./abnahmeSession");
const { bild } = require("./anleitungBilder");

// Abnahme gegen den echten Server (docs/entwicklung/abnahme-lokal.md): „Mein Kalender“ (#1788). Eine Person meldet sich
// zu einem Turnier an - der Abo-Hinweis erscheint einmal, der Termin steht sofort in „Mein Kalender“ (ohne Abo). Dann
// das Abo: Adresse erzeugen, der Kalender-Feed enthält den Termin; Abmeldung → weg in Ansicht und Feed; „Neu erzeugen“
// → die alte Adresse gibt 404. Zum Schluss abschalten (wiederholbar; der Seed setzt Hinweis und Abo des Kontos zurück).
// Läuft nur mit ABNAHME=1; Stand aus scripts/seed_abnahme.py (Konto „calendar“, Turnier „calendar_cup“).

const DESKTOP = { width: 1440, height: 900 };
const tid = state?.tournaments?.calendar_cup;
const slug = state?.slugs?.calendar_cup;

test.skip(!ENABLED || !tid || !state?.accounts?.calendar, "Nur mit ABNAHME=1 und dem Kalender-Cup aus scripts/seed_abnahme.py");
test.describe.configure({ mode: "serial" });

// Die Login-Seite fragt Passkeys an, die der Abnahme-Stand nicht eingerichtet hat (503); der alte Link soll 404 geben.
const allow = (response) => response.status() === 503 && response.url().includes("/passkey");

async function feedText(page, url) {
  const response = await page.request.get(url);
  return { status: response.status(), text: response.status() === 200 ? await response.text() : "" };
}

test("anmelden → Hinweis einmal, Termin in Mein Kalender, Abo mit Termin, abmelden → weg, neu erzeugen → alter Link 404", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(DESKTOP);
  await signIn(page, "calendar");
  const problems = watch(page, { allow });

  // Vorher: nicht dabei, kein Abo, Hinweis fällig.
  const before = await (await page.request.get("/api/calendar/me")).json();
  expect(before.items.some((item) => item.id === tid)).toBe(false);
  expect(before.subscription.active).toBe(false);
  expect(before.hint_due).toBe(true);

  // Anmelden auf der Turnierseite.
  await page.goto(`/tournaments/${slug}`);
  await page.getByTestId("tournament-register-btn").click();
  const submit = page.getByTestId("tournament-register-submit");
  if (await submit.isVisible().catch(() => false)) await submit.click();
  await expect(page.getByTestId("tournament-my-stand")).toBeVisible();

  // Der Hinweis erscheint - einmal, am Konto gemerkt.
  const hint = page.getByTestId("calendar-hint");
  await expect(hint).toBeVisible();
  await expect(hint).toContainText("Deine Termine automatisch im Kalender?");
  await page.waitForTimeout(400);
  await bild(page, "mein-kalender-hinweis", hint, { pad: 10 });
  await expect.poll(async () => (await (await page.request.get("/api/calendar/hint")).json()).due).toBe(false);

  // Weg zum Abo: „Mein Kalender“ mit dem Termin und seinem Stand - ohne Abo.
  await page.getByTestId("calendar-hint-go").click();
  await expect(page).toHaveURL(/\/calendar\/mine#abo$/);
  await expect(hint).toHaveCount(0);
  await page.getByTestId("calendar-view-list").click();
  const row = page.getByTestId(`calendar-item-tournament-${tid}`);
  await expect(row).toBeVisible();
  await expect(page.getByTestId(`calendar-badge-tournament-${tid}`)).not.toBeEmpty();
  await bild(page, "mein-kalender-liste", page.getByTestId("calendar-list"));

  // Ein zweites Mal kommt der Hinweis nicht: Seite neu laden, die Anmeldung steht, kein Hinweis.
  await page.goto(`/tournaments/${slug}`);
  await expect(page.getByTestId("tournament-my-stand")).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByTestId("calendar-hint")).toHaveCount(0);

  // Abo erzeugen: die Adresse einmal sichtbar, der Feed enthält den Termin.
  await page.goto("/calendar/mine#abo");
  const card = page.getByTestId("calendar-personal");
  await card.getByTestId("calendar-personal-create").click();
  const firstUrl = await page.getByTestId("calendar-personal-feed-url").inputValue();
  expect(firstUrl).toMatch(/\/api\/calendar\/personal\/[A-Za-z0-9_-]{40,}\.ics$/);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await page.getByTestId("calendar-personal-feed-copy").click();
  await expect(page.getByTestId("calendar-personal-feed-copy")).toContainText("Kopiert");
  await bild(page, "mein-kalender-abo", card);
  const title = ((await (await page.request.get("/api/calendar/me")).json()).items.find((item) => item.id === tid) || {}).title || "";
  expect(title).toContain("Kalender-Cup");
  let feed = await feedText(page, firstUrl);
  expect(feed.status).toBe(200);
  expect(feed.text).toContain("BEGIN:VCALENDAR");
  expect(feed.text.replace(/\r?\n[ \t]/g, "")).toContain((title || "").trim().replace(/,/g, "\\,"));
  expect((await (await page.request.get("/api/calendar/hint")).json()).due).toBe(false);

  // Abmelden: weg aus „Mein Kalender“ und aus dem Feed.
  await page.goto(`/tournaments/${slug}`);
  await page.getByTestId("tournament-unregister-btn").click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page.getByTestId("tournament-my-stand")).toHaveCount(0);
  await page.goto("/calendar/mine");
  await expect(page.getByTestId(`calendar-item-tournament-${tid}`)).toHaveCount(0);
  feed = await feedText(page, firstUrl);
  expect(feed.status).toBe(200);
  expect(feed.text).not.toContain((title || "").trim().replace(/,/g, "\\,"));

  // Neu erzeugen: die alte Adresse gibt 404, die neue gilt.
  await page.getByTestId("calendar-personal-renew").click();
  await page.getByTestId("calendar-personal-renew-confirm").click();
  const secondUrl = await page.getByTestId("calendar-personal-feed-url").inputValue();
  expect(secondUrl).not.toBe(firstUrl);
  expect((await feedText(page, firstUrl)).status).toBe(404);
  expect((await feedText(page, secondUrl)).status).toBe(200);
  await expect(page.getByTestId("calendar-personal-once")).toBeVisible();

  // Aufräumen: abschalten mit Rückfrage.
  await page.getByTestId("calendar-personal-revoke").click();
  await page.getByTestId("calendar-personal-revoke-confirm").click();
  await expect(page.getByTestId("calendar-personal-create")).toBeVisible();
  expect((await feedText(page, secondUrl)).status).toBe(404);

  expect(problems.filter((problem) => !/\/api\/calendar\/personal\/.+\.ics/.test(problem))).toEqual([]);
});

test("Einstellungen: fester Eintrag „Mein Kalender-Abo“ führt zu Mein Kalender", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page, "calendar");
  const problems = watch(page, { allow });
  await page.goto("/profile?tab=calendar");
  await expect(page.getByTestId("profile-tab-calendar")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("settings-calendar-personal")).toContainText("Automatisch in deinen Kalender");
  await page.getByTestId("settings-calendar-open").click();
  await expect(page).toHaveURL(/\/calendar\/mine$/);
  await expect(page.getByTestId("calendar-scope-mine")).toHaveAttribute("aria-current", "page");
  expect(problems).toEqual([]);
});
