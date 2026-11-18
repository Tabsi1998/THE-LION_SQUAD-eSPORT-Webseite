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
    if (url === "/tournaments?include_drafts=true&managed=true&league=exclude&limit=500") return { data: [OWN] };
    return { data: [OWN, { ...OWN, id: "t-fremd", slug: "fremd", title: "Fremdes Turnier" }] };
  });
  render(
    <MemoryRouter>
      <AdminTournamentsPage />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Eigenes Turnier")).toBeInTheDocument();
  expect(screen.queryByText("Fremdes Turnier")).toBeNull();
  expect(apiMock.get).toHaveBeenCalledWith("/tournaments?include_drafts=true&managed=true&league=exclude&limit=500");
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
// Paket D (#2262, Nr. 192): Die Turnierliste fragt ohne Staffeln - die stehen in der Liga-Verwaltung. Es gibt keinen Filter „Art“,
// keine Status-Gruppe „Liga-Staffeln“ und keinen Hinweis „Staffeln deiner Ligen“ mehr.
test("die Liste fragt ohne Staffeln und hat weder Filter „Art“ noch eine Status-Gruppe „Liga-Staffeln“", async () => {
  apiMock.get.mockResolvedValue({ data: [OWN] });
  authState.isTournamentLead = true;
  render(<MemoryRouter><AdminTournamentsPage /></MemoryRouter>);
  await screen.findByText("Eigenes Turnier");
  expect(apiMock.get).toHaveBeenCalledWith("/tournaments?include_drafts=true&managed=true&league=exclude&limit=500");
  expect(screen.queryByTestId("admin-tournament-kind-filter")).toBeNull();
  const status = screen.getByTestId("admin-tournament-status-filter");
  expect(status.querySelector("optgroup")).toBeNull();
  expect(status).not.toHaveTextContent("Liga");
  expect(screen.queryByTestId("admin-tournaments-league-scope")).toBeNull();
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

// Handy (#2463): unter 768 px Karten statt der Tabelle zum Wischen - nur eine Form im DOM, Filter, Zähler und CSV bleiben.
function withScreen(narrow, run) {
  const original = window.matchMedia;
  window.matchMedia = (query) => ({ matches: narrow && query.includes("max-width: 767px"), media: query, addEventListener: () => {}, removeEventListener: () => {} });
  return Promise.resolve(run()).finally(() => { window.matchMedia = original; });
}

const LEAGUE_CUP = () => ({ ...OWN, id: "t-liga", slug: "liga-cup", title: "Herbst-Liga (Turnier)", participant_count: 1, max_participants: 8,
  game: { name: "Probe Shooter" }, format: "league" });

test("unter 768 px: Karten mit Titel, Spiel, Format, Status, Teilnehmern, Regeln und Aktionen", () => withScreen(true, async () => {
  apiMock.get.mockResolvedValue({ data: [LEAGUE_CUP(), { ...OWN, status: "draft", game: { name: "Probe Racer" }, format: "single_elim" }] });
  authState.isTournamentLead = true;
  render(<MemoryRouter><AdminTournamentsPage /></MemoryRouter>);
  await screen.findByText("Eigenes Turnier");
  expect(screen.getByTestId("admin-tournament-cards")).toBeInTheDocument();
  expect(screen.queryByRole("table")).toBeNull();
  const league = screen.getByTestId("admin-tr-liga-cup");
  expect(league.tagName).toBe("LI");
  expect(league).toHaveTextContent("Herbst-Liga (Turnier)");
  expect(league).toHaveTextContent("Probe Shooter");
  expect(within(league).getByTestId("admin-tr-participants-liga-cup")).toHaveTextContent("1/8");
  expect(within(league).getByTestId("admin-tr-rules-liga-cup")).toHaveTextContent(/Online/i);
  const cup = screen.getByTestId("admin-tr-eigenes");
  expect(cup).toHaveTextContent("Probe Racer");
  expect(cup).toHaveTextContent("ENTWURF");
  expect(within(cup).getByRole("button", { name: /^Anmeldung öffnen:/ })).toBeInTheDocument();
  expect(within(cup).getByRole("button", { name: /^Löschen:/ })).toBeInTheDocument();
  expect(within(cup).getByRole("link", { name: /^Teilnehmer:/ })).toHaveAttribute("href", "/admin/tournaments/t-own?tab=participants");
  // Filter, Zähler und CSV wie bisher.
  expect(screen.getByText("2 / 2 sichtbar")).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("admin-tournament-status-filter"), { target: { value: "registration_open" } });
  expect(screen.queryByTestId("admin-tr-eigenes")).toBeNull();
  expect(screen.getByText("1 / 2 sichtbar")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /CSV/ })).toBeEnabled();
}));

test("ab 768 px bleibt die Tabelle, ohne Karten", () => withScreen(false, async () => {
  apiMock.get.mockResolvedValue({ data: [LEAGUE_CUP(), OWN] });
  authState.isTournamentLead = true;
  render(<MemoryRouter><AdminTournamentsPage /></MemoryRouter>);
  await screen.findByText("Eigenes Turnier");
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.queryByTestId("admin-tournament-cards")).toBeNull();
  expect(screen.getByTestId("admin-tr-liga-cup").tagName).toBe("TR");
}));

test.each([[true, "Karte"], [false, "Tabelle"]])("Aktions-Symbole (%s → %s): feste Größe, 44-px-Tippfläche, Name zum Vorlesen", (narrow) => withScreen(narrow, async () => {
  apiMock.get.mockResolvedValue({ data: [{ ...OWN, status: "draft" }, { ...OWN, id: "t-live", slug: "live", title: "Live-Cup", status: "live" }] });
  authState.isTournamentLead = true;
  render(<MemoryRouter><AdminTournamentsPage /></MemoryRouter>);
  await screen.findByText("Live-Cup");
  const actions = [
    ...within(screen.getByTestId("admin-tr-eigenes")).getAllByRole("button"),
    ...within(screen.getByTestId("admin-tr-eigenes")).getAllByRole("link", { name: /^Teilnehmer:/ }),
    within(screen.getByTestId("admin-tr-live")).getByRole("button", { name: /^Pause:/ }),
  ];
  expect(actions.length).toBeGreaterThanOrEqual(4);
  for (const action of actions) {
    expect(action).toHaveAttribute("aria-label");
    expect(action.className).toMatch(/\bh-11\b/);
    expect(action.className).toMatch(/\bw-11\b/);
    expect(action.className).toMatch(/\bshrink-0\b/);
    const icon = action.querySelector("svg");
    expect(icon.getAttribute("class")).toMatch(/\bshrink-0\b/);
    expect(icon.getAttribute("aria-hidden")).toBe("true");
  }
}));

test("Überschrift: der Kopf bricht als Ganzes um, nicht das Wort „Turniere“", async () => {
  apiMock.get.mockResolvedValue({ data: [OWN] });
  authState.isTournamentLead = true;
  render(<MemoryRouter><AdminTournamentsPage /></MemoryRouter>);
  const heading = await screen.findByRole("heading", { level: 1, name: "Turniere" });
  // Der Knopf „Neues Turnier“ rutscht unter die Überschrift, statt ihr die Breite zu nehmen; das Wort selbst bricht nicht.
  expect(screen.getByTestId("admin-tournaments-head").className).toMatch(/\bflex-wrap\b/);
  expect(heading.className).toMatch(/\[overflow-wrap:normal\]/);
});

test("die Turnierleitung sieht keinen Hinweis auf eigene Staffeln", async () => {
  apiMock.get.mockResolvedValue({ data: [OWN] });
  authState.isTournamentLead = true;
  render(<MemoryRouter><AdminTournamentsPage /></MemoryRouter>);
  await screen.findByText("Eigenes Turnier");
  expect(screen.queryByTestId("admin-tournaments-league-scope")).toBeNull();
});

