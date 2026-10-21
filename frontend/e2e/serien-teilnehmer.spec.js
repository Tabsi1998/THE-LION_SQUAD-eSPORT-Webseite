const { test, expect } = require("@playwright/test");

// Teilnehmer nachträglich bearbeiten (#1929) im echten Browser, Server nachgestellt. Prüffall: eine Rennliga mit
// 20 Fahrern, alle versehentlich als Gast angelegt. Filter „Gäste“ → alle auswählen → die drei echten Gäste abwählen
// → „Als Extern“: ein einziger Aufruf mit 17 Kennungen. Danach Bearbeiten und Zusammenführen öffnen. Bei 390 px ohne
// seitliches Scrollen. `TEILNEHMER_SHOTS` legt Bilder ab (optional). Nur erfundene Namen.

const BOARD = { id: "vorstand-1", username: "vorstand", display_name: "Vorstand", role: "club_admin", areas: ["content"], mfa_enabled: true, auth_mfa_verified: true };
const SERIES = {
  id: "serie-1", season: "2026", stage: "F1", status: "running", rules_version: 1,
  rules: { points_mode: "scheme", points_by_place: [25, 18, 15, 12], count_mode: "all", tiebreakers: [], team_scoring: { enabled: true, guests_count: false } },
  team_name: "Probe Löwen", lineage: { id: "spur-1", title: "Probe Rennliga", kind: "racing" }, access: { role: "board", can_publish: true },
};
const NAMES = Array.from({ length: 20 }, (_, index) => `Probe Fahrer ${String(index + 1).padStart(2, "0")}`);
const TEAMS = ["Probe Löwen", "Fremd Rot", "Fremd Blau"];

function participant(name, index, link) {
  const team = index < 3 ? TEAMS[0] : TEAMS[1 + (index % 2)];
  return {
    id: `t${index + 1}`, name, start_number: String(index + 2), default_team: team, link, link_status: "decided",
    guest_name: link === "guest" ? name : null, profile_id: null, profile_name: null, in_results: index < 18,
  };
}

function listed(strangersExternal) {
  const participants = NAMES.map((name, index) => participant(name, index, strangersExternal && index >= 3 ? "external" : "guest"));
  const guests = participants.filter((row) => row.link === "guest").length;
  return {
    participants, profiles: [{ id: "p-anna", name: "Anna Probe" }, { id: "p-bert", name: "Bert Probe" }],
    counts: { member: 0, guest: guests, external: participants.length - guests, open: 0, club: 0 },
  };
}

async function mockServer(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/**", json({}));
  for (const path of ["sponsors**", "notifications/me", "games"]) await page.route(`**/api/${path}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", json(BOARD));
  await page.route("**/api/reference-series/admin/series/serie-1", json(SERIES));
  await page.route("**/api/reference-series/admin/series/serie-1/calendar", json({ version: 1, today: "2026-10-21", counts: {}, hints: [], archived: [], rounds: [] }));
  await page.route("**/api/reference-series/admin/series/serie-1/staff", json({ staff: [] }));
  const state = { external: false, bulk: [] };
  await page.route("**/api/reference-series/admin/series/serie-1/participants", (route) => json(listed(state.external))(route));
  await page.route("**/api/reference-series/admin/series/serie-1/participants/bulk-assign", (route) => {
    const body = route.request().postDataJSON();
    state.bulk.push(body);
    state.external = true;
    return json({ changed: body.participant_ids, unchanged: [], other_series: { updated: ["serie-0"], pending: [] } })(route);
  });
  return state;
}

async function shot(locator, name, width) {
  if (!process.env.TEILNEHMER_SHOTS) return;
  // Hinweise (Toasts) liegen sonst über dem Bild.
  await locator.page().addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" });
  await locator.screenshot({ path: `${process.env.TEILNEHMER_SHOTS}/nachher-${name}-${width}.png`, animations: "disabled" });
}

async function noSidewaysScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Teilnehmer bearbeiten (${width} px): 17 von 20 Gästen mit einer Sammelaktion auf Extern`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const state = await mockServer(page);
    await page.goto("/admin/reference-series/serie-1");
    const section = page.getByTestId("series-participants");
    await expect(section.getByTestId("series-participants-counts")).toHaveText("0 Mitglieder · 20 Gäste · 0 Extern · 0 offen");
    await expect(section.getByTestId("series-participants-hint")).toContainText("Gast fährt für ein Vereinsteam");

    await section.getByTestId("participants-filter-guest").click();
    await section.getByTestId("participants-select-all").check();
    for (const id of ["t1", "t2", "t3"]) await section.getByTestId(`participant-select-${id}`).uncheck();
    await expect(section.getByTestId("participants-bulk-count")).toHaveText("17 ausgewählt");
    await noSidewaysScroll(page);
    await section.scrollIntoViewIfNeeded();
    await shot(section, "auswahl", width);

    await section.getByTestId("participants-bulk-external").click();
    await expect(section.getByTestId("series-participants-counts")).toHaveText("0 Mitglieder · 3 Gäste · 17 Extern · 0 offen");
    expect(state.bulk).toHaveLength(1);
    expect(state.bulk[0]).toEqual({ participant_ids: NAMES.slice(3).map((_, index) => `t${index + 4}`), link: "external" });
    // Im Filter „Gäste“ stehen jetzt nur noch die drei echten.
    await expect(section.getByTestId("series-participants-list").locator("li")).toHaveCount(3);
    await section.getByTestId("participants-filter-all").click();
    await shot(section, "liste", width);

    await section.getByTestId("participant-edit-t1").click();
    const sheet = page.getByTestId("participant-edit");
    await expect(sheet.getByTestId("participant-edit-name")).toHaveValue("Probe Fahrer 01");
    await expect(sheet.getByTestId("participant-edit-in-results")).toBeVisible();
    await noSidewaysScroll(page);
    await shot(sheet, "bearbeiten", width);
    await sheet.getByTestId("participant-edit-cancel").click();

    await section.getByTestId("participant-select-t19").check();
    await section.getByTestId("participant-select-t20").check();
    await section.getByTestId("participants-bulk-merge").click();
    const merge = page.getByTestId("participant-merge");
    await expect(merge.getByTestId("participant-merge-keep-t19")).toBeChecked();
    await noSidewaysScroll(page);
    await shot(merge, "zusammenfuehren", width);
  });
}
