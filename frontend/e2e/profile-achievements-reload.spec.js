const { test, expect } = require("@playwright/test");

// Profil → Erfolge lud ohne Ende neu: das Öffnen wertet einmal aus (POST /achievements/evaluate), der POST meldet eine
// Änderung an „achievements“, und die Profilseite lud darauf mit „LADE PROFIL …“ neu - die eigenen Erfolge hingen sich
// aus und wieder ein und werteten wieder aus. Hier zählt der nachgestellte Server mit; ein zweiter Fall schickt die Änderung
// über den Änderungsstrom des Servers, wie ihn Staff-Konten bekommen.

const ME = { id: "u-neon", username: "neonfalke", display_name: "NeonFalke", role: "player", is_club_member: true };
const PROFILE = {
  ...ME, privacy_public_profile: true, created_at: "2023-03-01T10:00:00Z",
  stats: { points: 900, wins: 1, top3: 2, tournaments: 3, fast_laps: 0 },
  achievement_level: { level: 9, points: 900, next_level_points: 1000, progress: 40 },
  teams: [], awards: [], honours: [], tournaments: [], f1_bests: [], references: { items: [], stats: {} }, relationship: { status: "self" },
};
const TIER = (code, earnedAt) => ({ code, rank: 1, level: 3, name: code, material: "gold", material_name: "Gold", material_color: "#FFD700", points: 50, earned: true, earned_at: earnedAt });
const ME_ACHIEVEMENTS = {
  level: { level: 9, title: "Jäger", prestige: 0, points: 900, next_level_points: 1000, progress: 40 },
  groups: [{ code: "sieg", name: "Siege", category: "match", icon: "trophy", tiers: [TIER("sieg-1", "2026-10-01T10:00:00Z"), TIER("sieg-2", "2026-10-13T10:00:00Z")] }],
  awards: [{ code: "sieg-1", award_id: "a1", name: "Sieg I" }, { code: "sieg-2", award_id: "a2", name: "Sieg II" }],
  pinned_codes: ["sieg-1", "sieg-2"],
  pinned: [{ code: "sieg-1", name: "Sieg I" }, { code: "sieg-2", name: "Sieg II" }],
  next_up: [],
};

// Der Änderungsstrom: die erste Verbindung wartet, bis der Test `release()` ruft, und liefert dann ein Ereignis an
// „achievements“. Neue Verbindungen bekommen dasselbe Ereignis (gleiche Kennung - die Seite verwirft es) und `retry` lang.
const STREAM_EVENT = { event_id: "evt-ach-1", id: "evt-ach-1", event_type: "api.changed", method: "POST", path: "/api/achievements/evaluate", resource: "achievements", status: 200 };
const STREAM_BODY = ["retry: 60000", "event: change", "id: evt-ach-1", `data: ${JSON.stringify(STREAM_EVENT)}`, "", ""].join("\n");

async function mockServer(page, { stream = false } = {}) {
  let release = () => {};
  const released = new Promise((resolve) => { release = resolve; });
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  const calls = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path.startsWith("/changes")) {
      if (!stream) return route.abort();
      await released;
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body: STREAM_BODY });
    }
    calls.push(`${request.method()} ${path}`);
    if (path === "/auth/me") return json(ME);
    if (path === "/achievements/evaluate") return json({ newly_awarded: 0 });
    if (request.method() !== "GET") return json({ ok: true });
    if (path === "/users/public/neonfalke") return json(PROFILE);
    if (path === "/achievements/me") return json(ME_ACHIEVEMENTS);
    if (path === "/achievements/user/u-neon") return json({ groups: ME_ACHIEVEMENTS.groups, awards: ME_ACHIEVEMENTS.awards });
    if (path === "/users/me/profile-completeness") return json({ score: 80, missing: [] });
    if (path === "/users/me/level") return json({ level: 9, title: "Jäger", prestige: 0 });
    if (path === "/seasonal/active") return json({ now: "2026-10-13T12:00:00+02:00", enabled: true, preview: false, weather: null, seasons: [] });
    if (path === "/friends") return json({ incoming: [], friends: [], outgoing: [] });
    const objects = ["/settings/public", "/home/about", "/users/me/notification-preferences", "/chats/unread"];
    return json(objects.includes(path) ? {} : []);
  });
  return { calls, release };
}

test("Profil → Erfolge: einmal auswerten, dann bleibt die Seite stehen", async ({ page }) => {
  const { calls } = await mockServer(page);
  await page.goto("/u/neonfalke?tab=achievements");
  await expect(page.getByTestId("profile-achievements-tab")).toBeVisible();
  // Zwei Sekunden zum Einschwingen (Auswertung, ein stilles Nachladen), dann drei Sekunden ohne einen einzigen Abruf.
  await page.waitForTimeout(2000);
  const settled = calls.length;
  await page.waitForTimeout(3000);
  await expect(page.getByTestId("profile-achievements-tab")).toBeVisible();
  expect(calls.filter((call) => call === "POST /achievements/evaluate")).toHaveLength(1);
  expect(calls.slice(settled)).toEqual([]);
});

test("Änderung aus dem Strom des Servers: still nachladen, kein Reiter ausgehängt, keine zweite Auswertung", async ({ page }) => {
  const { calls, release } = await mockServer(page, { stream: true });
  await page.goto("/u/neonfalke?tab=achievements");
  const tab = page.getByTestId("profile-achievements-tab");
  await expect(tab).toBeVisible();
  await page.waitForTimeout(2000);
  // Ein Merker am DOM-Knoten: wird der Reiter aus- und wieder eingehängt, ist er weg.
  await tab.evaluate((node) => { node.dataset.e2eMark = "same-node"; });
  const profileLoads = () => calls.filter((call) => call === "GET /users/public/neonfalke").length;
  const before = profileLoads();
  release();
  await expect.poll(profileLoads).toBeGreaterThan(before);
  await page.waitForTimeout(1500);
  await expect(tab).toHaveAttribute("data-e2e-mark", "same-node");
  expect(calls.filter((call) => call === "POST /achievements/evaluate")).toHaveLength(1);
});
