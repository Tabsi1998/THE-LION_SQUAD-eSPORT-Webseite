import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Verwaltungsliste der Turniere (#1028): die Seite fragt die Liste „zum Verwalten“ ab - der Server gibt der
// Turnierleitung alle Turniere, einem Helfer nur das Turnier seines Einsatzes. Kein fremdes Turnier mit Knöpfen,
// die der Server dann ablehnt.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
const authState = { isAdmin: false, isTournamentLead: false, user: { role: "tournament_admin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true } };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_error, fallback) => fallback, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));

const { default: AdminTournamentsPage } = await import("./AdminTournamentsPage");

const OWN = { id: "t-own", slug: "eigenes", title: "Eigenes Turnier", status: "registration_open", start_date: "2026-11-01T10:00:00Z", participant_count: 2, max_participants: 16 };

test("ein Helfer sieht in der Verwaltung nur sein Turnier - die Seite fragt die Verwaltungsliste ab", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/tournaments?include_drafts=true&managed=true&limit=500") return { data: [OWN] };
    return { data: [OWN, { ...OWN, id: "t-fremd", slug: "fremd", title: "Fremdes Turnier" }] };
  });
  render(
    <MemoryRouter>
      <AdminTournamentsPage />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Eigenes Turnier")).toBeInTheDocument();
  expect(screen.queryByText("Fremdes Turnier")).toBeNull();
  expect(apiMock.get).toHaveBeenCalledWith("/tournaments?include_drafts=true&managed=true&limit=500");
});

test("globale Aktionen nur für die Turnierleitung mit Zwei-Faktor - nicht für Adminbereich plus Helfer-Einsatz", async () => {
  apiMock.get.mockResolvedValue({ data: [{ ...OWN, status: "draft" }] });
  authState.isAdmin = true;
  authState.isTournamentLead = false;
  const helper = render(<MemoryRouter><AdminTournamentsPage /></MemoryRouter>);
  expect(await screen.findByText("Eigenes Turnier")).toBeInTheDocument();
  expect(screen.queryByTestId("admin-new-tournament")).toBeNull();
  expect(screen.queryByTitle("Löschen")).toBeNull();
  expect(screen.queryByTitle("Anmeldung öffnen")).toBeNull();
  helper.unmount();

  authState.isTournamentLead = true;
  render(<MemoryRouter><AdminTournamentsPage /></MemoryRouter>);
  expect(await screen.findByTestId("admin-new-tournament")).toBeInTheDocument();
  expect(screen.getByTitle("Löschen")).toBeInTheDocument();
});

// Liga-Staffeln (#2109, S26, L-D3): gekennzeichnet, filterbar, gestartet nicht löschbar, kein „Anmeldung öffnen“.
const STAFFEL = { ...OWN, id: "t-staffel", slug: "liga-a", title: "Probe-Liga Season 1 · Liga 1 · Staffel A", status: "draft",
  league_context: { league_id: "l1", season_id: "s1", division_id: "d1", staffel: "A" }, league_label: "Liga · Staffel A" };

test("Staffeln tragen ihr Kennzeichen und lassen sich filtern", async () => {
  apiMock.get.mockResolvedValue({ data: [OWN, STAFFEL] });
  authState.isTournamentLead = true;
  render(<MemoryRouter><AdminTournamentsPage /></MemoryRouter>);
  expect(await screen.findByText("Probe-Liga Season 1 · Liga 1 · Staffel A")).toBeInTheDocument();
  expect(screen.getByTestId("admin-tr-league-label-liga-a")).toHaveTextContent("Liga · Staffel A");
  fireEvent.change(screen.getByTestId("admin-tournament-kind-filter"), { target: { value: "league" } });
  expect(screen.queryByText("Eigenes Turnier")).toBeNull();
  expect(screen.getByText("Probe-Liga Season 1 · Liga 1 · Staffel A")).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("admin-tournament-kind-filter"), { target: { value: "tournament" } });
  expect(screen.getByText("Eigenes Turnier")).toBeInTheDocument();
  expect(screen.queryByText("Probe-Liga Season 1 · Liga 1 · Staffel A")).toBeNull();
});

// Liga-Stand (#2453): Eine Staffel im Entwurf bei offener Anmeldung der Season zeigt „Anmeldung offen bis …“ statt „Entwurf“, dazu was ihr
// fehlt mit Weg in den Eingang. Der Status-Filter kennt die Liga-Stände, „Entwurf“ meint nur noch Turniere.
test("Staffeln zeigen den Stand ihrer Season, was fehlt, und der Status-Filter passt dazu", async () => {
  const day = 24 * 60 * 60 * 1000;
  const at = (offset) => new Date(Date.now() + offset).toISOString();
  const open = { ...STAFFEL, participant_count: 1, max_participants: 8, league_plan: { fixed_matches: 0 },
    league_season: { id: "s1", status: "draft", visibility: "public", application_opens_at: at(-day), application_closes_at: at(3 * day), start_date: at(9 * day) } };
  const running = { ...STAFFEL, id: "t-live", slug: "liga-b", title: "Laufende Staffel", status: "live", participant_count: 8, league_plan: { fixed_matches: 28 },
    league_season: { id: "s0", status: "active", visibility: "public", start_date: at(-20 * day) } };
  const plain = { ...OWN, id: "t-draft", slug: "entwurf", title: "Entwurfs-Turnier", status: "draft" };
  apiMock.get.mockResolvedValue({ data: [open, running, plain] });
  authState.isTournamentLead = true;
  render(<MemoryRouter><AdminTournamentsPage /></MemoryRouter>);
  await screen.findByText("Laufende Staffel");
  expect(screen.getByTestId("admin-tr-stand-liga-a")).toHaveTextContent(/^Anmeldung offen bis /);
  expect(within(screen.getByTestId("admin-tr-liga-a")).queryByText("ENTWURF")).toBeNull();
  expect(screen.getByTestId("admin-tr-stand-liga-b")).toHaveTextContent("Spielbetrieb");
  expect(within(screen.getByTestId("admin-tr-entwurf")).getByText("ENTWURF")).toBeInTheDocument();
  const needs = screen.getByTestId("admin-tr-needs-liga-a");
  expect(needs).toHaveTextContent("Teams zuteilen · 1 von 8");
  expect(within(needs).getByRole("link")).toHaveAttribute("href", "/admin/leagues/seasons/s1#anmeldungen");
  expect(screen.queryByTestId("admin-tr-needs-liga-b")).toBeNull();

  const filter = screen.getByTestId("admin-tournament-status-filter");
  expect(filter.querySelector("option[value='draft']")).toHaveTextContent("Entwurf (1)");
  expect(filter.querySelector("option[value='league:anmeldung']")).toHaveTextContent("Liga: Anmeldung offen (1)");
  expect(filter.querySelector("option[value='league:spielbetrieb']")).toHaveTextContent("Liga: Spielbetrieb (1)");
  fireEvent.change(filter, { target: { value: "league:anmeldung" } });
  expect(screen.getByText("Probe-Liga Season 1 · Liga 1 · Staffel A")).toBeInTheDocument();
  expect(screen.queryByText("Entwurfs-Turnier")).toBeNull();
  expect(screen.queryByText("Laufende Staffel")).toBeNull();
  fireEvent.change(filter, { target: { value: "draft" } });
  expect(screen.getByText("Entwurfs-Turnier")).toBeInTheDocument();
  expect(screen.queryByText("Probe-Liga Season 1 · Liga 1 · Staffel A")).toBeNull();
});

// Review #2453 (1): Die Kacheln der Übersicht verlinken „?status=live“ - eine laufende Staffel gehört dazu, gezählt bei „Live“ und
// bei „Liga: Spielbetrieb“. Nur der Entwurf einer Staffel weicht dem Liga-Stand.
test("Filter „Live“ aus der Adresse zeigt auch die laufende Staffel", async () => {
  const day = 24 * 60 * 60 * 1000;
  const at = (offset) => new Date(Date.now() + offset).toISOString();
  const running = { ...STAFFEL, id: "t-live", slug: "liga-b", title: "Laufende Staffel", status: "live", participant_count: 8, league_plan: { fixed_matches: 28 },
    league_season: { id: "s0", status: "active", visibility: "public", start_date: at(-20 * day) } };
  const cup = { ...OWN, id: "t-cup", slug: "cup", title: "Laufender Cup", status: "live" };
  apiMock.get.mockResolvedValue({ data: [running, cup, { ...OWN, title: "Offenes Turnier" }] });
  authState.isTournamentLead = true;
  render(<MemoryRouter initialEntries={["/admin/tournaments?status=live"]}><AdminTournamentsPage /></MemoryRouter>);
  expect(await screen.findByText("Laufende Staffel")).toBeInTheDocument();
  expect(screen.getByText("Laufender Cup")).toBeInTheDocument();
  expect(screen.queryByText("Offenes Turnier")).toBeNull();
  const filter = screen.getByTestId("admin-tournament-status-filter");
  expect(filter.querySelector("option[value='live']")).toHaveTextContent("Live (2)");
  expect(filter.querySelector("option[value='league:spielbetrieb']")).toHaveTextContent("Liga: Spielbetrieb (1)");
  fireEvent.change(filter, { target: { value: "league:spielbetrieb" } });
  expect(screen.getByText("Laufende Staffel")).toBeInTheDocument();
  expect(screen.queryByText("Laufender Cup")).toBeNull();
});

// Review #2453 (4): Was fehlt, steht bei jeder Staffel mit Season-Angaben - der Server schickt sie nur mit dem Liga-Recht.
test("„was fehlt“ hängt an den Season-Angaben, nicht an beiden Bereichen", async () => {
  const day = 24 * 60 * 60 * 1000;
  const at = (offset) => new Date(Date.now() + offset).toISOString();
  const open = { ...STAFFEL, participant_count: 0, max_participants: 8,
    league_season: { id: "s1", status: "draft", visibility: "public", application_opens_at: at(-day), application_closes_at: at(3 * day), start_date: at(9 * day) } };
  apiMock.get.mockResolvedValue({ data: [open, { ...STAFFEL, id: "t-bare", slug: "liga-c", title: "Staffel ohne Angaben" }] });
  const before = { lead: authState.isTournamentLead, user: authState.user };
  authState.isTournamentLead = false;
  authState.user = { ...before.user, areas: ["leagues"] };
  render(<MemoryRouter><AdminTournamentsPage /></MemoryRouter>);
  await screen.findByText("Staffel ohne Angaben");
  expect(screen.getByTestId("admin-tr-needs-liga-a")).toHaveTextContent("Teams zuteilen · 0 von 8");
  expect(screen.queryByTestId("admin-tr-needs-liga-c")).toBeNull();
  authState.isTournamentLead = before.lead;
  authState.user = before.user;
});

// Löschen nur für Entwürfe (#2111, TA18) - alles andere sagt man ab oder archiviert.
test("ein Turnier lässt sich nur als Entwurf löschen", async () => {
  apiMock.get.mockResolvedValue({ data: [{ ...OWN, status: "draft" }, { ...OWN, id: "t-open", slug: "offen", title: "Offenes Turnier", status: "registration_open" }] });
  authState.isTournamentLead = true;
  render(<MemoryRouter><AdminTournamentsPage /></MemoryRouter>);
  await screen.findByText("Offenes Turnier");
  expect(within(screen.getByTestId("admin-tr-eigenes")).getByTitle("Löschen")).toBeInTheDocument();
  expect(within(screen.getByTestId("admin-tr-offen")).queryByTitle("Löschen")).toBeNull();
});

test("eine Staffel: vor dem Start löschbar, danach nicht, und nie „Anmeldung öffnen“", async () => {
  apiMock.get.mockResolvedValue({ data: [STAFFEL, { ...STAFFEL, id: "t-live", slug: "liga-b", title: "Laufende Staffel", status: "live" }] });
  authState.isTournamentLead = true;
  render(<MemoryRouter><AdminTournamentsPage /></MemoryRouter>);
  await screen.findByText("Laufende Staffel");
  expect(within(screen.getByTestId("admin-tr-liga-a")).getByTitle("Löschen")).toBeInTheDocument();
  expect(within(screen.getByTestId("admin-tr-liga-b")).queryByTitle("Löschen")).toBeNull();
  expect(screen.queryByTitle("Anmeldung öffnen")).toBeNull();
});

// Turnierliste (#2111, TA21): dieselben Statuswörter wie im Kopf (mit „Check-in offen“), Archiv nur über den Filter,
// Suche nach deutschen Formatnamen, Meldungen ohne Rohschlüssel.
test("Turnierliste: Archiv nur im Filter, Suche nach „K.-o.“, Status in Worten", async () => {
  const { toast } = await import("sonner");
  const toastSpy = vi.spyOn(toast, "success");
  apiMock.get.mockResolvedValue({ data: [
    { ...OWN, format: "single_elim", status: "draft" },
    { ...OWN, id: "t-old", slug: "alt", title: "Altes Turnier", format: "swiss", status: "archived" },
  ] });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  authState.isTournamentLead = true;
  render(<MemoryRouter><AdminTournamentsPage /></MemoryRouter>);
  await screen.findByText("Eigenes Turnier");
  expect(screen.queryByText("Altes Turnier")).toBeNull();
  const filter = screen.getByTestId("admin-tournament-status-filter");
  expect([...filter.querySelectorAll("option")].map((option) => option.value)).toContain("check_in");
  expect(filter.querySelector("option[value='check_in']")).toHaveTextContent("Check-in offen");
  fireEvent.change(filter, { target: { value: "archived" } });
  expect(screen.getByText("Altes Turnier")).toBeInTheDocument();
  fireEvent.change(filter, { target: { value: "" } });
  fireEvent.change(screen.getByTestId("admin-tournament-search"), { target: { value: "K.-o." } });
  expect(screen.getByText("Eigenes Turnier")).toBeInTheDocument();
  fireEvent.click(screen.getByTitle("Anmeldung öffnen"));
  await vi.waitFor(() => expect(toastSpy).toHaveBeenCalledWith("Status: Anmeldung offen"));
});

test("eine Staffel: die Turnierleitung ohne Bereich Ligen bekommt keine Knöpfe zum Ändern (#2203)", async () => {
  apiMock.get.mockResolvedValue({ data: [STAFFEL, { ...STAFFEL, id: "t-live", slug: "liga-b", title: "Laufende Staffel", status: "live" }, { ...OWN, status: "draft" }] });
  authState.isTournamentLead = true;
  const before = authState.user;
  authState.user = { ...before, areas: ["tournaments"] };
  render(<MemoryRouter><AdminTournamentsPage /></MemoryRouter>);
  await screen.findByText("Laufende Staffel");
  expect(screen.getAllByTitle("Löschen")).toHaveLength(1);
  expect(screen.queryByTitle("Pause")).toBeNull();
  authState.user = before;
});
