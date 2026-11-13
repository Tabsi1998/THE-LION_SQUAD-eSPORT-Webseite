import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// „Mein Dienst“ (#1352): Helfer sehen genau ihre Turniere mit ihrer Rolle, heute zuerst, je mit einem Knopf zur
// Turnierleitung; Moderation sieht die Meldungen; wer nichts hat, liest einen Satz statt einer leeren Seite.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
const authState = { user: { id: "u", role: "player", mfa_enabled: true, auth_mfa_verified: true } };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));

const { default: AdminDutyPage } = await import("./AdminDutyPage");

function renderWith(data) {
  apiMock.get.mockResolvedValue({ data });
  return render(<MemoryRouter><AdminDutyPage /></MemoryRouter>);
}

const TODAY = {
  kind: "tournament", id: "t-1", slug: "herbst-cup", title: "Herbst-Cup", today: true, starts_at: "2026-10-13T16:00:00Z",
  roles: ["referee", "scorekeeper"], url: "/tournaments/herbst-cup/leitung", admin_url: "/admin/tournaments/t-1",
};
const LATER = {
  kind: "fastlap", id: "f-1", title: "Monza Fast Lap", today: false, starts_at: "2026-10-17T10:00:00Z",
  roles: ["scorekeeper"], url: "/admin/f1/f-1", admin_url: "/admin/f1/f-1",
};

beforeEach(() => apiMock.get.mockReset());

test("Helfer: eigene Einsätze in der Reihenfolge des Servers, mit Rolle und Knopf zur Turnierleitung", async () => {
  renderWith({ assignments: [TODAY, LATER], moderation: null, lead_today: [] });
  expect(await screen.findByTestId("duty-heading")).toHaveTextContent("Mein Dienst");
  const rows = within(screen.getByTestId("duty-assignments")).getAllByRole("listitem");
  expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual(["duty-row-t-1", "duty-row-f-1"]);
  expect(screen.getByTestId("duty-when-t-1")).toHaveTextContent(/^Heute · \d\d:\d\d$/);
  expect(screen.getByTestId("duty-roles-t-1")).toHaveTextContent("Deine Rolle: Schiedsrichter, Ergebnisdienst");
  expect(screen.getByTestId("duty-open-t-1")).toHaveAttribute("href", "/tournaments/herbst-cup/leitung");
  expect(screen.getByTestId("duty-open-t-1")).toHaveTextContent("Turnierleitung öffnen");
  expect(screen.getByTestId("duty-admin-t-1")).toHaveAttribute("href", "/admin/tournaments/t-1");
  expect(screen.getByTestId("duty-open-f-1")).toHaveTextContent("Fast Lap öffnen");
  expect(screen.queryByTestId("duty-moderation")).toBeNull();
  expect(apiMock.get).toHaveBeenCalledWith("/users/me/duty", { params: { desks: 1 } });
});

test("Moderation: die Meldungen mit Zähler, keine Turnierliste", async () => {
  renderWith({ assignments: [], moderation: { open_reports: 3 }, lead_today: [] });
  expect(await screen.findByTestId("duty-moderation-count")).toHaveTextContent("3 offene Meldungen");
  expect(screen.getByTestId("duty-moderation-open")).toHaveAttribute("href", "/admin/moderation");
  expect(screen.queryByTestId("duty-assignments")).toBeNull();
  expect(screen.queryByTestId("duty-empty")).toBeNull();
});

test("ohne Einsatz ein Satz statt einer leeren Seite", async () => {
  renderWith({ assignments: [], moderation: null, lead_today: [] });
  expect(await screen.findByTestId("duty-empty")).toHaveTextContent("Gerade hast du keinen Einsatz.");
});

// „Meine Serien“ (#1749): Captains sehen ihre Serien mit Ablauf und Knopf zur Saison - ohne Zwei-Faktor mit Hinweis.
const SERIES_ROW = {
  id: "s-1", season: "2026", tier: "Division 1", status: "active", lineage_title: "Probe Racing F1", lineage_kind: "racing",
  valid_until: "2026-12-31", can_publish: false, url: "/admin/reference-series/s-1",
};

test("Captain: Meine Serien mit Ablauf, Entwurfs-Hinweis und Knopf zur Saison - kein leerer Einsatz-Satz", async () => {
  renderWith({ assignments: [], series: [SERIES_ROW], moderation: null, lead_today: [] });
  expect(await screen.findByTestId("duty-series")).toBeInTheDocument();
  expect(screen.getByTestId("duty-series-row-s-1")).toHaveTextContent("Probe Racing F1");
  expect(screen.getByTestId("duty-series-row-s-1")).toHaveTextContent("Entwürfe");
  expect(screen.getByTestId("duty-series-until-s-1")).toHaveTextContent("bis 31.12.2026");
  expect(screen.getByTestId("duty-series-open-s-1")).toHaveAttribute("href", "/admin/reference-series/s-1");
  expect(screen.queryByTestId("duty-empty")).toBeNull();
  expect(screen.queryByTestId("duty-series-mfa")).toBeNull();
});

test("Captain ohne Zwei-Faktor: Hinweis mit Weg zur Einrichtung", async () => {
  authState.user = { id: "u", role: "player" };
  renderWith({ assignments: [], series: [SERIES_ROW], moderation: null, lead_today: [] });
  expect(await screen.findByTestId("duty-series-mfa")).toHaveTextContent("Zwei-Faktor");
  authState.user = { id: "u", role: "player", mfa_enabled: true, auth_mfa_verified: true };
});

test("Zuständige (#2203): „Meine Ligen“ mit den Zuständigkeiten - kein leerer Einsatz-Satz", async () => {
  authState.user = { id: "z", role: "player", has_league_staff: true, mfa_enabled: true, auth_mfa_verified: true };
  renderWith({ assignments: [], series: [], moderation: null, lead_today: [], leagues: [{ id: "l1", name: "Probeliga", slug: "probeliga", capabilities: ["results", "roster"] }] });
  expect(await screen.findByTestId("duty-league-l1")).toHaveTextContent("Probeliga");
  expect(screen.getByTestId("duty-league-l1")).toHaveTextContent("Ergebnisse korrigieren · Kader prüfen");
  expect(screen.getByTestId("duty-league-l1")).toHaveAttribute("href", "/admin/leagues");
  expect(screen.queryByTestId("duty-empty")).toBeNull();
  expect(screen.queryByTestId("duty-leagues-mfa")).toBeNull();
});

test("Zuständige ohne Zwei-Faktor (#2203): der Weg zur Einrichtung", async () => {
  authState.user = { id: "z", role: "player", has_league_staff: true, mfa_enabled: false };
  renderWith({ assignments: [], series: [], moderation: null, lead_today: [], leagues: [] });
  expect(await screen.findByTestId("duty-leagues-mfa")).toHaveTextContent("Zwei-Faktor");
});

// Leitstand (E.4, Nr. 152): „Mein Dienst“ führt je Season mit der eigenen Zahl in den Leitstand.
test("Leitstand der Seasons mit eigener und offener Zahl und Link auf #leitstand", async () => {
  renderWith({ assignments: [], moderation: null, lead_today: [], league_desks: [
    { season_id: "s1", league_name: "Probe-Liga", season_name: "Season 1", mine: 2, total: 5, url: "/admin/leagues/seasons/s1#leitstand" },
    { season_id: "s2", league_name: "Probe-Liga", season_name: "Season 2", mine: 0, total: 0, url: "/admin/leagues/seasons/s2#leitstand" },
  ] });
  const first = await screen.findByTestId("duty-desk-s1");
  expect(first).toHaveAttribute("href", "/admin/leagues/seasons/s1#leitstand");
  expect(first).toHaveTextContent("2 Aufgaben für dich, 5 offen in der Season");
  expect(screen.getByTestId("duty-desk-s2")).toHaveTextContent("Alles erledigt");
});
