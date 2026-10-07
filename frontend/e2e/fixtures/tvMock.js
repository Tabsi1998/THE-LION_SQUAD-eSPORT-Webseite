// Feste Antworten für die TV-Seiten (Meilenstein 59): Grundwerte, Turnierbaum mit Anzeige-Schlüssel, Stationen,
// Änderungsstrom. `state.bracket` darf der Test jederzeit austauschen - die nächste Abfrage liefert den neuen Stand;
// `push()` meldet über den Änderungsstrom „matches“, dann lädt der TV ohne Neuladen der Seite nach.

async function mockTvApi(page, state) {
  await page.addInitScript(() => {
    const sentinel = { released: false, addEventListener() {}, removeEventListener() {}, release: async () => {} };
    Object.defineProperty(window.navigator, "wakeLock", { configurable: true, value: { request: async () => sentinel } });
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  const json = (body, status = 200) => (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const stream = [];
  state.calls = { bracket: 0 };
  await page.route("**/api/**", json([]));
  await page.route("**/api/changes/stream", (route) => {
    const events = stream.splice(0, stream.length);
    const body = ["retry: 300", "", "event: connected", "data: {\"ok\":true}", "", ...events.flatMap((event) => [`id: ${event.event_id}`, "event: change", `data: ${JSON.stringify(event)}`, ""])].join("\n");
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: `${body}\n` });
  });
  await page.route("**/api/auth/me", json({ detail: "Nicht angemeldet" }, 401));
  await page.route("**/api/auth/refresh", json({ detail: "Nicht angemeldet" }, 401));
  await page.route("**/api/settings/public", json({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "example.test" }));
  await page.route("**/api/seasonal/active**", json({ seasons: [] }));
  await page.route("**/api/tv/settings", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ settings: state.settings || {}, defaults: {} }) }));
  await page.route("**/api/sponsors**", json([{ id: "sp1", name: "Sponsor 1", logo_url: "/assets/brand/tls-mascot.png?s=1", tier: "gold" }]));
  await page.route("**/api/tournaments/t1/bracket/display**", (route) => {
    state.calls.bracket += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(state.bracket) });
  });
  await page.route("**/api/stations?tournament_id=t1", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(state.stations || []) }));
  let counter = 0;
  state.push = () => {
    counter += 1;
    stream.push({ event_id: `tv59-${counter}`, event_type: "api.changed", resource: "matches", path: "/api/matches", visibility_scope: "public" });
  };
  return state;
}

module.exports = { mockTvApi };
