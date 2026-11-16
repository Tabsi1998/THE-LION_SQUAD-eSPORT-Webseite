import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Betrieb (#233): Fehlergruppen mit Zähler, als gelöst markierbar; die
// langsamsten Routen unter Tempo.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };

vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => false }));
vi.mock("@/components/tls/AdminLayout", () => ({
  AdminLayout: ({ children }) => <div data-testid="admin-layout">{children}</div>,
}));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminOpsPage = (await import("./AdminOpsPage")).default;
const { describeSummary } = await import("./AdminOpsPage");

const GROUP = {
  fingerprint: "abc123",
  error_type: "KeyError",
  message: "'team_id'",
  route: "/api/teams/{team_id}",
  method: "GET",
  status_code: 500,
  count: 7,
  first_seen_at: "2026-09-15T08:00:00Z",
  last_seen_at: "2026-09-15T17:30:00Z",
  actor: "angemeldet",
  stack: "Traceback ...\nKeyError: 'team_id'",
  resolved_at: null,
};

const VITALS = {
  days: 7,
  retention_days: 30,
  samples: 12,
  overall: { LCP: { count: 12, p50: 2100, p75: 3900, good_share: 0.5, rating: "needs-improvement" } },
  routes: [
    { route: "/galerie/:slug", samples: 8, worst: "poor", metrics: { LCP: { count: 8, p50: 4000, p75: 6100, good_share: 0.1, rating: "poor" }, CLS: { count: 8, p50: 0.02, p75: 0.04, good_share: 1, rating: "good" } } },
    { route: "/", samples: 4, worst: "good", metrics: { LCP: { count: 4, p50: 900, p75: 1200, good_share: 1, rating: "good" } } },
  ],
};

const CHECKS = {
  interval_minutes: 5,
  history_days: 7,
  latest: {
    at: "2026-09-16T12:05:00Z",
    status: "crit",
    counts: { ok: 6, warn: 1, crit: 1 },
    failing: ["mail_queue", "disk"],
    checks: [
      { key: "database", label: "Datenbank", status: "ok", value: "12 ms", detail: "Antwortzeit auf ping" },
      { key: "disk", label: "Freier Speicher", status: "warn", value: "9.8 GB frei (12 %)", detail: "" },
      { key: "mail_queue", label: "Mail-Queue", status: "crit", value: "0 wartend, 0 fehlgeschlagen", detail: "0 fällig, 2 hängen im Versand" },
    ],
  },
  history: [{ day: "2026-09-16", runs: 3, warn: 1, crit: 1 }],
  recent_bad: [],
};

function respond(url) {
  const path = String(url);
  if (path.startsWith("/admin/ops/summary")) return { data: { open_error_groups: 1, error_groups_24h: 1, slow_requests_24h: 3, slowest_route_24h: { route: "/api/gallery", duration_ms: 2400 }, threshold_ms: 1000, checks: { at: "2026-09-16T12:05:00Z", status: "crit", counts: { ok: 6, warn: 1, crit: 1 }, failing: ["mail_queue", "disk"] } } };
  if (path.startsWith("/admin/ops/errors")) return { data: [GROUP] };
  if (path.startsWith("/admin/ops/slow")) return { data: { hours: 24, threshold_ms: 1000, total: 3, routes: [{ method: "GET", route: "/api/gallery", count: 3, avg_ms: 1800, p95_ms: 2400, max_ms: 2400 }], recent: [] } };
  if (path.startsWith("/admin/ops/vitals")) return { data: VITALS };
  if (path.startsWith("/admin/ops/checks")) return { data: CHECKS };
  return { data: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockImplementation((url) => Promise.resolve(respond(url)));
  apiMock.post.mockImplementation(() => Promise.resolve({ data: { ...GROUP, resolved_at: "2026-09-15T18:00:00Z" } }));
});

test("Fehlergruppen zeigen Zähler und Route und lassen sich als gelöst markieren", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={["/admin/ops?tab=errors"]}><AdminOpsPage /></MemoryRouter>);

  await waitFor(() => expect(screen.getByText("KeyError")).toBeInTheDocument());
  expect(screen.getByText("GET /api/teams/{team_id}")).toBeInTheDocument();
  expect(screen.getByText(/7× · zuerst/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { expanded: false }));
  expect(screen.getByText(/KeyError: 'team_id'/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Als gelöst markieren/ }));

  expect(apiMock.post).toHaveBeenCalledWith("/admin/ops/errors/abc123/resolve");
  await waitFor(() => expect(screen.getByRole("button", { name: /Wieder öffnen/ })).toBeInTheDocument());
});

test("Tempo listet die langsamsten Routen", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={["/admin/ops?tab=errors"]}><AdminOpsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText("KeyError")).toBeInTheDocument());

  await user.click(screen.getByRole("button", { name: "Tempo" }));
  // Die Route steht in der Kachel "Langsamste Route" und in der Tabelle; p95 und max sind hier gleich.
  expect(screen.getAllByText("/api/gallery").length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByText("2400")).toHaveLength(2);
  expect(screen.getByText("1800")).toBeInTheDocument();
});

test("die Zusammenfassung für die Tageszentrale ist ein Satz", () => {
  expect(describeSummary(null)).toBe("Noch keine Daten.");
  expect(describeSummary({ open_error_groups: 2, slow_requests_24h: 5, slowest_route_24h: { route: "/api/x", duration_ms: 1500 } }))
    .toBe("2 Fehlergruppen offen · 5 langsame Anfragen in 24 h · langsamste: /api/x (1500 ms)");
});

test("Vitals zeigt p75 je Route, gefärbt nach Bewertung", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={["/admin/ops?tab=errors"]}><AdminOpsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText("KeyError")).toBeInTheDocument());

  await user.click(screen.getByRole("button", { name: "Vitals" }));
  const gallery = screen.getByTestId("ops-vitals-/galerie/:slug");
  expect(gallery).toHaveTextContent("6100 ms");
  expect(gallery).toHaveTextContent("0.040");
  expect(screen.getByTestId("ops-vitals-/")).toHaveTextContent("1200 ms");
  expect(screen.getByText("3900 ms")).toBeInTheDocument();
});

test("Checks zeigt die Ampel je Prüfung, und Jetzt prüfen stößt einen Lauf an", async () => {
  const user = userEvent.setup();
  apiMock.post.mockImplementation((url) => Promise.resolve(url.includes("/checks/run")
    ? { data: { ...CHECKS.latest, status: "ok", counts: { ok: 8, warn: 0, crit: 0 }, failing: [], checks: CHECKS.latest.checks.map((c) => ({ ...c, status: "ok" })) } }
    : { data: { ...GROUP, resolved_at: "2026-09-15T18:00:00Z" } }));
  render(<MemoryRouter initialEntries={["/admin/ops?tab=errors"]}><AdminOpsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText("KeyError")).toBeInTheDocument());
  expect(screen.getByText("rot")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Checks" }));
  expect(screen.getByTestId("ops-check-mail_queue")).toHaveTextContent("2 hängen im Versand");
  expect(screen.getByTestId("ops-checks-summary")).toHaveTextContent(/Freier Speicher: gelb · Mail-Queue: rot/);
  expect(screen.getByTestId("ops-checks-history")).toHaveTextContent("1 rot");

  await user.click(screen.getByTestId("ops-checks-run"));
  expect(apiMock.post).toHaveBeenCalledWith("/admin/ops/checks/run");
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Alle Prüfungen grün."));
});

// #2447: „Als gelöst markieren“ direkt in der Zeile, Mehrfachauswahl, „Jetzt neu prüfen“ mit sofortiger Ampel oben und
// Sperre gegen Doppelklick, Datei-Uploads in Tempo gekennzeichnet.
test("eine Fehlergruppe lässt sich ohne Aufklappen als gelöst markieren", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={["/admin/ops?tab=errors"]}><AdminOpsPage /></MemoryRouter>);
  await user.click(await screen.findByTestId("ops-error-resolve-abc123"));
  expect(apiMock.post).toHaveBeenCalledWith("/admin/ops/errors/abc123/resolve");
  expect(screen.queryByText(/KeyError: 'team_id'/)).toBeNull();
  expect(await screen.findByTestId("ops-error-reopen-abc123")).toBeInTheDocument();
});

test("mehrere Fehlergruppen auswählen und auf einmal als gelöst markieren", async () => {
  const user = userEvent.setup();
  const second = { ...GROUP, fingerprint: "def456", error_type: "ValueError", route: "/api/x" };
  apiMock.get.mockImplementation((url) => Promise.resolve(String(url).startsWith("/admin/ops/errors") ? { data: [GROUP, second] } : respond(url)));
  apiMock.post.mockResolvedValue({ data: { resolved: 2, items: [{ ...GROUP, resolved_at: "2026-09-15T18:00:00Z" }, { ...second, resolved_at: "2026-09-15T18:00:00Z" }] } });
  render(<MemoryRouter initialEntries={["/admin/ops?tab=errors"]}><AdminOpsPage /></MemoryRouter>);
  expect(await screen.findByTestId("ops-errors-resolve-picked")).toBeDisabled();
  await user.click(screen.getByTestId("ops-error-pick-abc123"));
  expect(screen.getByTestId("ops-errors-bulk")).toHaveTextContent("1 ausgewählt");
  await user.click(screen.getByTestId("ops-errors-pick-all"));
  await user.click(screen.getByTestId("ops-errors-resolve-picked"));
  expect(apiMock.post).toHaveBeenCalledWith("/admin/ops/errors/resolve", { fingerprints: ["abc123", "def456"] });
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("2 Fehlergruppen als gelöst markiert."));
  expect(screen.getByTestId("ops-errors-bulk")).toHaveTextContent("Alle offenen auswählen");
  // Danach lädt die Seite neu, damit die Kachel „Fehlergruppen offen“ gleich stimmt.
  await waitFor(() => expect(apiMock.get.mock.calls.filter(([url]) => String(url).startsWith("/admin/ops/summary")).length).toBeGreaterThan(1));
});

test("Jetzt neu prüfen färbt die Ampel oben sofort und läuft nur einmal zugleich", async () => {
  const user = userEvent.setup();
  let finish;
  apiMock.post.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<MemoryRouter initialEntries={["/admin/ops?tab=checks"]}><AdminOpsPage /></MemoryRouter>);
  const run = await screen.findByTestId("ops-checks-run");
  expect(run).toHaveTextContent("Jetzt neu prüfen");
  expect(screen.getByText("rot")).toBeInTheDocument();
  await user.click(run);
  await user.click(run);
  expect(apiMock.post).toHaveBeenCalledTimes(1);
  expect(run).toBeDisabled();
  apiMock.get.mockImplementation(() => new Promise(() => {}));
  finish({ data: { ...CHECKS.latest, status: "ok", counts: { ok: 8, warn: 0, crit: 0 }, failing: [], checks: CHECKS.latest.checks.map((c) => ({ ...c, status: "ok" })) } });
  await waitFor(() => expect(screen.getByText("grün")).toBeInTheDocument());
  expect(screen.queryByText("rot")).toBeNull();
});

test("ein Rate-Limit beim Neu-Prüfen kommt als Meldung", async () => {
  const user = userEvent.setup();
  apiMock.post.mockRejectedValue({ response: { status: 429, data: { detail: "Gerade erst geprüft. Bitte warte noch 40 Sekunden." } } });
  render(<MemoryRouter initialEntries={["/admin/ops?tab=checks"]}><AdminOpsPage /></MemoryRouter>);
  await user.click(await screen.findByTestId("ops-checks-run"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Gerade erst geprüft. Bitte warte noch 40 Sekunden."));
  // Danach ist der Knopf wieder frei - der Ref gibt den Lauf auch beim Fehler zurück.
  expect(screen.getByTestId("ops-checks-run")).not.toBeDisabled();
  expect(screen.getByTestId("ops-checks-run")).toHaveTextContent("Jetzt neu prüfen");
});

test("Datei-Uploads stehen in Tempo gekennzeichnet, die Kachel nennt sie", async () => {
  apiMock.get.mockImplementation((url) => {
    const path = String(url);
    if (path.startsWith("/admin/ops/slow")) {
      return Promise.resolve({ data: { hours: 24, threshold_ms: 1000, total: 3, upload_count: 1, routes: [
        { method: "GET", route: "/api/gallery", count: 3, avg_ms: 1800, p95_ms: 2400, max_ms: 2400, upload: false },
        { method: "POST", route: "/api/admin/app-releases", count: 1, avg_ms: 47000, p95_ms: 47000, max_ms: 47000, upload: true },
      ], recent: [] } });
    }
    if (path.startsWith("/admin/ops/summary")) return Promise.resolve({ data: { ...respond(url).data, slow_uploads_24h: 1 } });
    return Promise.resolve(respond(url));
  });
  render(<MemoryRouter initialEntries={["/admin/ops?tab=slow"]}><AdminOpsPage /></MemoryRouter>);
  expect(await screen.findByTestId("ops-slow-POST-/api/admin/app-releases")).toHaveTextContent("Upload");
  expect(screen.getByTestId("ops-slow-GET-/api/gallery")).not.toHaveTextContent("Upload");
  expect(screen.getByText("ohne 1 Datei-Upload")).toBeInTheDocument();
});
