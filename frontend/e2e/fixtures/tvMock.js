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

/**
 * Meilenstein 60: dieselben festen Antworten für Hallen-Tafel, Aufrufe und Fast Lap. `state` darf der Test jederzeit
 * ändern: `bracket` bzw. `brackets` (je Turnier), `stations`, `event`, `challenge`, `board`, `sponsors`, `settings`.
 * `push(resource)` meldet eine Änderung über den Änderungsstrom - der TV lädt ohne Neuladen der Seite nach.
 */
async function mockHallApi(page, state) {
  await page.addInitScript(() => {
    const sentinel = { released: false, addEventListener() {}, removeEventListener() {}, release: async () => {} };
    Object.defineProperty(window.navigator, "wakeLock", { configurable: true, value: { request: async () => sentinel } });
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  const json = (body, status = 200) => (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(typeof body === "function" ? body() : body) });
  const stream = [];
  state.calls = { bracket: 0, board: 0 };
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
  await page.route("**/api/tv/settings", json(() => ({ settings: state.settings || {}, defaults: {} })));
  await page.route("**/api/sponsors**", json(() => state.sponsors || [{ id: "sp1", name: "Pixelwerk Druckerei", logo_url: "/assets/brand/tls-mascot.png?s=1", tier: "gold" }]));
  await page.route(/\/api\/tournaments\/(t\d+)\/bracket(\/display)?(\?.*)?$/, (route) => {
    const id = /\/tournaments\/(t\d+)\//.exec(route.request().url())[1];
    const bracket = (state.brackets || {})[id] || (id === "t1" ? state.bracket : null);
    if (!bracket) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    state.calls.bracket += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(bracket) });
  });
  await page.route(/\/api\/stations\?(tournament_id|event_id)=/, (route) => {
    const tournament = new URL(route.request().url()).searchParams.get("tournament_id");
    const rows = state.stations || [];
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(tournament ? rows.filter((row) => row.tournament_id === tournament) : rows) });
  });
  await page.route("**/api/events/event-1", json(() => state.event || {}));
  await page.route("**/api/f1/challenges/f1-1", json(() => state.challenge));
  await page.route(/\/api\/f1\/challenges\/f1-1\/leaderboard/, (route) => {
    state.calls.board += 1;
    const trackId = new URL(route.request().url()).searchParams.get("track_id");
    const board = (state.boards || {})[trackId] || state.board;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(board) });
  });
  let counter = 0;
  state.push = (resource = "matches") => {
    counter += 1;
    stream.push({ event_id: `tv60-${counter}`, event_type: "api.changed", resource, path: `/api/${resource}`, visibility_scope: "public" });
  };
  return state;
}

module.exports = { mockTvApi, mockHallApi };
