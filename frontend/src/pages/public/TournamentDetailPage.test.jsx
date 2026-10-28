import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";

// Startgeld (#319): die Seite nennt das Startgeld vor der Anmeldung, die Anmeldung geht nur mit
// der Kostenübernahme raus, und danach sieht nur die anmeldende Person ihren Preis.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
let authUser = null;
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (e, f) => f || String(e), resolveMediaUrl: (u) => u }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const liveCalls = [];
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: (load, resources, options) => { liveCalls.push({ resources, options }); } }));
vi.mock("@/hooks/useCanonicalSlugRedirect", () => ({ useCanonicalSlugRedirect: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/Breadcrumbs", () => ({ Breadcrumbs: () => null }));
vi.mock("@/components/tls/StreamEmbed", () => ({ StreamEmbed: () => null }));
vi.mock("@/components/tls/tournament/TournamentLiveStreams", () => ({ TournamentLiveStreams: () => <div data-testid="tournament-live-streams-stub" /> }));
vi.mock("@/components/tls/PrizeList", () => ({ PrizeList: () => null }));
vi.mock("@/components/tls/AddToCalendar", () => ({ AddToCalendar: () => <div data-testid="add-to-calendar" /> }));
vi.mock("@/components/tls/MentionTextarea", () => ({ MentionTextarea: () => null }));
vi.mock("@/components/tls/MentionText", () => ({ MentionText: ({ text }) => <span>{text}</span> }));
vi.mock("@/components/tls/ChatAttachments", () => ({ ChatAttachButton: () => null, ChatAttachmentDrafts: () => null, ChatMessageAttachments: () => null, useChatAttachmentDrafts: () => ({ drafts: [], add: () => {}, remove: () => {}, clear: () => {}, uploading: false }) }));
vi.mock("@/components/tls/ChatStickers", () => ({ ChatMessageSticker: () => null, ChatStickerButton: () => null, ChatStickerPicker: () => null }));

const TournamentDetailPage = (await import("./TournamentDetailPage")).default;

const OFFER = { enabled: true, currency: "EUR", positions: [{ key: "startgeld", label: "Startgeld", amount_cents: 1000, basis: "per_person", optional: false }] };
const base = {
  id: "t1", slug: "cup", title: "Herbst-Cup", status: "registration_open", registration_enabled: true, participant_count: 0, max_participants: 16,
  team_mode: "solo", team_size: 1, event_mode: "online", game: { id: "g1", slug: "rl", name: "Rocket League", player_id_fields: [] },
  public_phase: { state: "registration_open", label: "Anmeldung" },
};

function mockApi(tournament, registrations = [], discord = { available: false }) {
  apiMock.get.mockImplementation((path) => {
    if (path === "/tournaments/cup") return Promise.resolve({ data: tournament });
    if (path === "/tournaments/t1/registrations") return Promise.resolve({ data: registrations });
    if (path === "/teams/my") return Promise.resolve({ data: [] });
    if (path === "/games/g1/discord") return Promise.resolve({ data: discord });
    return Promise.resolve({ data: [] });
  });
}

function renderPage(path = "/tournaments/cup") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/tournaments/:slug" element={<TournamentDetailPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authUser = { id: "u1", username: "paula", display_name: "Paula" };
  apiMock.post.mockResolvedValue({ data: { id: "r1", status: "approved" } });
});

test("Discord-Server zum Spiel (#626): Kachel mit Status; ohne Server keine Kachel", async () => {
  mockApi(base, [], { available: true, guild_id: "2", name: "Rocket League DE", member_count: 40, invite_url: "https://discord.gg/rocket", main: false, for_game: true, linked: true, member: true });
  const { unmount } = renderPage();
  expect(await screen.findByTestId("game-discord-tile")).toHaveTextContent("Discord-Server für Rocket League");
  expect(screen.getByTestId("game-discord-tile-joined")).toHaveTextContent("Du bist dabei");
  unmount();
  mockApi(base);
  renderPage();
  expect(await screen.findByTestId("tournament-title")).toBeInTheDocument();
  expect(screen.queryByTestId("game-discord-tile")).toBeNull();
});

// Map-Pool (#1616): mit Spiel lädt die Seite die Pools und zeigt sie als Karten; ohne Spiel fragt sie gar nicht.
test("Map-Pool des Turniers erscheint mit Spiel, ein Cup ohne Spiel fragt nicht danach", async () => {
  mockApi(base);
  const { unmount } = renderPage();
  expect(await screen.findByTestId("tournament-title")).toBeInTheDocument();
  expect(apiMock.get).not.toHaveBeenCalledWith("/map-pools/tournaments/t1");
  unmount();

  const pool = { id: "p1", origin: "tournament", modes: [{ mode: "snd", label: "Suchen & Zerstören", maps: [{ map_id: "nebel", name: "Nebelwerk" }] }] };
  apiMock.get.mockImplementation((path) => {
    if (path === "/tournaments/cup") return Promise.resolve({ data: { ...base, game_id: "g1" } });
    if (path === "/map-pools/tournaments/t1") return Promise.resolve({ data: { tournament: pool, stages: [] } });
    return Promise.resolve({ data: [] });
  });
  renderPage();
  expect(await screen.findByTestId("map-pool")).toHaveTextContent("Nebelwerk");
});

// Bestätigungs-Blatt (#1261): jede Anmeldung geht über das Blatt - auch Einzel ohne Startgeld und ohne Kennungen.
const RULES = "Fair Play gilt immer. Ergebnisse meldet der Sieger. Wer zu spät kommt, verliert kampflos. Proteste gehen an die Turnierleitung.";

test("Einzel ohne Startgeld (#1261): der Knopf öffnet das Blatt, erst „Verbindlich anmelden“ meldet an", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-05-20T10:00:00Z"));
  try {
    const user = userEvent.setup();
    mockApi({ ...base, rules: RULES, start_date: "2026-05-23T19:00:00Z", check_in_from: "2026-05-23T18:00:00Z", check_in_until: "2026-05-23T18:45:00Z" });
    renderPage();
    await user.click(await screen.findByTestId("tournament-register-btn"));
    const sheet = await screen.findByRole("dialog", { name: /Herbst-Cup/ });
    expect(apiMock.post).not.toHaveBeenCalled();
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(sheet.contains(document.activeElement)).toBe(true);
    expect(screen.getByTestId("register-sheet-start")).toHaveTextContent("Sa 23. Mai · 21:00");
    expect(screen.getByTestId("register-sheet-checkin")).toHaveTextContent("Sa 23. Mai · 20:00–20:45");
    expect(screen.getByTestId("register-sheet-place")).toHaveTextContent("Online");
    expect(screen.queryByTestId("register-sheet-fee")).toBeNull();
    expect(screen.getByTestId("register-sheet-rules")).toHaveTextContent("Fair Play gilt immer. Ergebnisse meldet der Sieger. Wer zu spät kommt, verliert kampflos.");
    expect(screen.getByTestId("register-sheet-rules")).not.toHaveTextContent("Proteste");
    expect(sheet).toHaveTextContent("Mit der Anmeldung akzeptierst du die Turnierregeln und den Datenschutz");
    await user.click(screen.getByTestId("register-sheet-rules-all"));
    expect(screen.getByTestId("register-sheet-rules-full")).toHaveTextContent("Proteste gehen an die Turnierleitung.");
    const submit = screen.getByTestId("tournament-register-submit");
    expect(submit).toHaveTextContent("Verbindlich anmelden");
    await user.click(submit);
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t1/register", expect.objectContaining({ accept_rules: true, accept_privacy: true, accept_costs: false, selected_positions: [] }), expect.anything()));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  } finally {
    vi.useRealTimers();
  }
});

test("Abbrechen, Schließen und Escape (#1261): keine Anmeldung, der Fokus geht zurück auf den Knopf", async () => {
  const user = userEvent.setup();
  mockApi(base);
  renderPage();
  const button = await screen.findByTestId("tournament-register-btn");
  await user.click(button);
  await user.click(await screen.findByTestId("register-sheet-cancel"));
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("tournament-register-btn")));
  await user.click(screen.getByTestId("tournament-register-btn"));
  await screen.findByRole("dialog");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(screen.getByTestId("tournament-register-btn"));
  await user.click(await screen.findByRole("button", { name: "Schließen" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("Tab bleibt im Blatt (#1261)", async () => {
  const user = userEvent.setup();
  mockApi(base);
  renderPage();
  await user.click(await screen.findByTestId("tournament-register-btn"));
  const sheet = await screen.findByRole("dialog");
  for (let step = 0; step < 8; step += 1) {
    await user.tab();
    expect(sheet.contains(document.activeElement)).toBe(true);
  }
});

test("Spieler-Kennungen (#1261): im selben Blatt, die Anmeldung schickt sie mit", async () => {
  const user = userEvent.setup();
  mockApi({ ...base, event_mode: "local", location: "Vereinsheim Probehausen", game: { ...base.game, player_id_fields: [{ key: "epic", label: "Epic-ID", required: true }] } });
  renderPage();
  await user.click(await screen.findByTestId("tournament-register-btn"));
  await screen.findByRole("dialog");
  expect(screen.getByTestId("register-sheet-place")).toHaveTextContent("Vor Ort · Vereinsheim Probehausen");
  expect(screen.getByTestId("register-sheet-rules")).toHaveTextContent("keine eigenen Regeln");
  await user.type(screen.getByLabelText(/Epic-ID/), "probe-123");
  await user.click(screen.getByTestId("tournament-register-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t1/register", expect.objectContaining({ player_ids: { epic: "probe-123" } }), expect.anything()));
});

// Aus der News (#1266): „Anmelden“ führt mit ?anmelden=1 hierher - nie ungefragt angemeldet.
test("?anmelden=1 mit Formular (Startgeld): das Formular ist gleich offen", async () => {
  mockApi({ ...base, offer: OFFER });
  renderPage("/tournaments/cup?anmelden=1");
  expect(await screen.findByTestId("tournament-register-submit")).toBeDisabled();
  expect(apiMock.post).not.toHaveBeenCalledWith("/tournaments/t1/register", expect.anything(), expect.anything());
});

test("?anmelden=1 ohne Formular: der Anmelde-Knopf bekommt den Fokus, angemeldet wird erst mit dem Klick", async () => {
  apiMock.post.mockClear();
  mockApi(base);
  renderPage("/tournaments/cup?anmelden=1");
  const button = await screen.findByTestId("tournament-register-btn");
  await waitFor(() => expect(button).toHaveFocus());
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("mit Startgeld steht der Betrag vorne, und angemeldet wird erst mit dem Haken", async () => {
  const user = userEvent.setup();
  mockApi({ ...base, offer: OFFER });
  renderPage();
  expect(await screen.findByTestId("tournament-offer")).toHaveTextContent("10,00 € Startgeld");
  await user.click(screen.getByTestId("tournament-register-btn"));

  const submit = await screen.findByTestId("tournament-register-submit");
  // Schritt-Leiste (#1081): im Formular steht man bei der Anmeldung, das Startgeld ist ein eigener Schritt.
  expect(screen.getByTestId("tournament-register-steps")).toHaveAttribute("aria-label", "Schritt 1 von 4: Anmeldung");
  expect(screen.getByTestId("tournament-register-steps")).toHaveTextContent("Startgeld");
  expect(submit).toBeDisabled();
  expect(screen.getByTestId("tournament-quote")).toHaveTextContent("10,00 €");
  expect(screen.getByTestId("register-sheet-fee")).toHaveTextContent("10,00 € Startgeld");
  await user.click(screen.getByTestId("tournament-accept-costs"));
  expect(submit).toBeEnabled();
  expect(submit).toHaveTextContent("Verbindlich anmelden · 10,00 €");
  await user.click(submit);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t1/register", expect.objectContaining({ accept_costs: true }), expect.anything()));
});

test("bei Teams rechnet die Summe mit der Teamgröße und die Teamleitung übernimmt", async () => {
  const user = userEvent.setup();
  apiMock.get.mockImplementation((path) => {
    if (path === "/tournaments/cup") return Promise.resolve({ data: { ...base, team_mode: "team", team_size: 5, offer: OFFER } });
    if (path === "/teams/my") return Promise.resolve({ data: [{ id: "team-1", name: "Lions", tag: "TLS", my_role: "leader", can_manage: true }] });
    return Promise.resolve({ data: [] });
  });
  renderPage();
  expect(await screen.findByTestId("tournament-offer")).toHaveTextContent("10,00 € je Spieler · Team mit 5 Spielern 50,00 €");
  expect(screen.getByTestId("tournament-offer")).toHaveTextContent("Die Teamleitung übernimmt das Startgeld");
  await user.click(screen.getByTestId("tournament-register-btn"));
  expect(await screen.findByTestId("tournament-quote")).toHaveTextContent("50,00 €");
  expect(screen.getByTestId("tournament-accept-costs").closest("label")).toHaveTextContent("für das Team");
  // Teams im selben Blatt (#1261): Team-Auswahl und Zusammenfassung zusammen.
  expect(screen.getByRole("dialog")).toContainElement(screen.getByLabelText(/Team/, { selector: "select" }));
  expect(screen.getByTestId("register-sheet-fee")).toHaveTextContent("50,00 €");
});

test("die eigene Anmeldung zeigt den eingefrorenen Preis, Warteliste den Hinweis", async () => {
  mockApi({ ...base, offer: OFFER }, [
    { id: "r1", user_id: "u1", display_name: "Paula", status: "approved", price: { total_cents: 1000, currency: "EUR", billing_status: "pending", payer_user_id: "u1" } },
    { id: "r2", display_name: "Fremd", status: "approved" },
  ]);
  renderPage();
  expect(await screen.findByTestId("tournament-own-price")).toHaveTextContent("10,00 €");
  expect(screen.getByTestId("tournament-my-stand")).toHaveTextContent("Startgeld");
  // Freigegeben, Rechnung offen: die Leiste steht beim Startgeld.
  expect(screen.getByTestId("tournament-my-steps")).toHaveAttribute("aria-label", "Schritt 3 von 4: Startgeld");
  expect(screen.getByTestId("tournament-own-price")).toHaveTextContent("Meine Rechnungen");
  expect(screen.queryByTestId("tournament-register-btn")).not.toBeInTheDocument();

  mockApi({ ...base, offer: OFFER }, [{ id: "r1", user_id: "u1", display_name: "Paula", status: "waitlist" }]);
  renderPage();
  expect(await screen.findByTestId("tournament-price-pending")).toHaveTextContent("erst, wenn deine Teilnahme bestätigt ist");
  const waitingStand = screen.getByTestId("tournament-price-pending").closest("[data-testid='tournament-my-stand']");
  expect(waitingStand.querySelector("[data-testid='tournament-my-steps']")).toHaveAttribute("aria-label", "Schritt 2 von 4: Warteliste");
});

test("Partner II (#469): das Turnier nennt seine Partner mit Link auf die Partnerseite", async () => {
  mockApi({ ...base, partners: [{ id: "p1", slug: "pineapps-esports", name: "PineApps eSports" }] });
  renderPage();
  expect(await screen.findByTestId("tournament-partner-pineapps-esports")).toHaveAttribute("href", "/partners/pineapps-esports");
  expect(screen.getByTestId("tournament-partner-pineapps-esports")).toHaveTextContent("mit PineApps eSports");
});

// Turnierseite aufgeräumt (#401): eine Hauptaktion je Phase, Reiter, Termine einmal als Zeitleiste,
// „Dein Stand“ für Angemeldete, Teilnehmer sortiert mit Team, Spielerzahl und „du“.
const DATES = { registration_open_from: "2026-09-01T10:00:00+00:00", registration_open_until: "2099-10-01T18:00:00+00:00", check_in_from: "2099-10-04T17:00:00+00:00", start_date: "2099-10-04T18:00:00+00:00", end_date: "2099-10-04T22:00:00+00:00" };

test("Anmeldung offen: Anmelden ist die eine Hauptaktion, die anderen Wege sind Textlinks, Reiter und Zeitleiste stehen einmal", async () => {
  mockApi({ ...base, ...DATES, format: "double_elimination" });
  renderPage();
  const actions = await screen.findByTestId("tournament-actions");
  expect(actions.querySelector("button[data-testid='tournament-register-btn']")).toHaveClass("tls-btn--primary");
  expect(screen.getByTestId("tournament-bracket-link")).not.toHaveClass("tls-btn--primary");
  expect(screen.getByTestId("tournament-tabs")).toHaveTextContent("Übersicht");
  expect(screen.getByTestId("tournament-tab-participants")).toHaveTextContent("Teilnehmer (0)");
  expect(screen.getByTestId("tournament-timeline-registration_close")).toHaveTextContent("Anmeldung endet");
  // Weit weg kein Countdown, sondern der Monat (#1264).
  expect(screen.getByTestId("tournament-timeline-next")).toHaveTextContent("Anmeldung endet im Oktober 2099");
  expect(screen.getAllByText(/Anmeldung endet/).length).toBe(3); // Statuskasten, Zeitleiste, „nächster Schritt“ - nicht mehr in der Seitenleiste
  // Die offene Anmeldung läuft (#1938): in der Zeitleiste „Anmeldung läuft“ statt „Anmeldung öffnet“ - nur dort.
  expect(screen.getByTestId("tournament-timeline-registration_open")).toHaveTextContent("Anmeldung läuft");
  expect(screen.getAllByText(/Anmeldung läuft/).length).toBe(1);
  expect(screen.queryAllByText(/Anmeldung öffnet/).length).toBe(0);
  expect(screen.getByTestId("tournament-registration-state")).toHaveTextContent("alle Termine unten in der Zeitleiste");
  expect(screen.getByTestId("add-to-calendar")).toBeInTheDocument();
  expect(screen.queryByTestId("tournament-my-stand")).toBeNull();
});

test("angemeldet im Check-in: Check-in ist die Hauptaktion, „Dein Stand“ zeigt Status, Team und Abmelden als leisen Link", async () => {
  mockApi({ ...base, ...DATES, status: "check_in", team_mode: "team", team_size: 3, public_phase: { state: "check_in", label: "Check-in" } }, [
    { id: "r1", status: "approved", display_name: "Paula", user_id: "u1", team_id: "tm1", team: { id: "tm1", name: "Neon Kings", tag: "NK", member_count: 3 }, is_mine: true, seed: 2 },
    { id: "r2", status: "pending", display_name: "Max", team_id: "tm2", team: { id: "tm2", name: "Rex", tag: "RX", member_count: 2 } },
    { id: "r3", status: "checked_in", display_name: "Mia", team_id: "tm3", team: { id: "tm3", name: "Turbo", tag: "TB", member_count: 3 }, seed: 1 },
  ]);
  apiMock.get.mockImplementation((path) => {
    if (path === "/tournaments/cup") return Promise.resolve({ data: { ...base, ...DATES, status: "check_in", team_mode: "team", team_size: 3, public_phase: { state: "check_in", label: "Check-in" } } });
    if (path === "/tournaments/t1/registrations") return Promise.resolve({ data: [
      { id: "r1", status: "approved", display_name: "Paula", user_id: "u1", team_id: "tm1", team: { id: "tm1", name: "Neon Kings", tag: "NK", member_count: 3 }, is_mine: true, seed: 2 },
      { id: "r2", status: "pending", display_name: "Max", team_id: "tm2", team: { id: "tm2", name: "Rex", tag: "RX", member_count: 2 } },
      { id: "r3", status: "checked_in", display_name: "Mia", team_id: "tm3", team: { id: "tm3", name: "Turbo", tag: "TB", member_count: 3 }, seed: 1 },
    ] });
    if (path === "/teams/my") return Promise.resolve({ data: [{ id: "tm1", name: "Neon Kings", tag: "NK", can_manage: true, my_role: "leader" }] });
    return Promise.resolve({ data: [] });
  });
  renderPage();
  expect(await screen.findByTestId("tournament-checkin-btn")).toHaveTextContent("Check-in");
  expect(screen.queryByTestId("tournament-register-btn")).toBeNull();
  const stand = screen.getByTestId("tournament-my-stand");
  expect(stand).toHaveTextContent("Dein Stand");
  expect(screen.getByTestId("tournament-my-team")).toHaveTextContent("Neon Kings [NK]");
  expect(screen.getByTestId("tournament-unregister-btn")).toHaveTextContent("Vom Turnier abmelden");
  const rows = [...screen.getByTestId("tournament-participants").querySelectorAll("[data-testid^='tournament-participant-r']")].map((el) => el.getAttribute("data-testid"));
  expect(rows).toEqual(["tournament-participant-r3", "tournament-participant-r1", "tournament-participant-r2"]);
  expect(screen.getByTestId("tournament-participant-r1")).toHaveTextContent("#2");
  expect(screen.getByTestId("tournament-participant-r1")).toHaveTextContent("[NK] · 3 Spieler");
  expect(screen.getByTestId("tournament-participant-me-r1")).toHaveTextContent("du");
  expect(screen.getByTestId("tournament-format-tile")).toHaveAttribute("title", expect.stringContaining("Team"));
});

test("Turnier vorbei: die Rangliste ist die Hauptaktion", async () => {
  mockApi({ ...base, ...DATES, status: "completed", public_phase: { state: "completed", label: "Beendet" } });
  renderPage();
  const actions = await screen.findByTestId("tournament-actions");
  // Knöpfe (#1082): die Hauptaktion ist überall der wichtige Knopf.
  expect(actions.querySelector("a[data-testid='tournament-standings-link']")).toHaveClass("tls-btn", "tls-btn--primary");
  expect(screen.queryByTestId("tournament-register-btn")).toBeNull();
  expect(screen.queryByTestId("tournament-closed-btn")).toBeNull();
});

const GATE = { required: true, event: { id: "e1", name: "Vereins-LAN", slug: "vereins-lan" }, registered: false, team_need: 1 };

test("Turnier nur mit Event-Anmeldung (#875): ohne Event-Anmeldung führt die Hauptaktion zum Event, mit ihr meldet der Knopf an", async () => {
  mockApi({ ...base, event_gate: GATE });
  const { unmount } = renderPage();
  const first = await screen.findByTestId("tournament-event-first");
  expect(first).toHaveTextContent("Zuerst beim Event anmelden");
  expect(first).toHaveAttribute("href", "/events/vereins-lan?turnier=cup");
  expect(screen.queryByTestId("tournament-register-btn")).toBeNull();
  expect(screen.getByTestId("tournament-event-gate")).toHaveTextContent("Melde dich zuerst beim Event „Vereins-LAN“ an.");
  unmount();

  mockApi({ ...base, event_gate: { ...GATE, registered: true } });
  renderPage();
  expect(await screen.findByTestId("tournament-register-btn")).toBeInTheDocument();
  expect(screen.getByTestId("tournament-event-gate")).toHaveTextContent("Du bist beim Event „Vereins-LAN“ angemeldet – die Turnieranmeldung ist frei.");
});

test("Teams (#875): der Hinweis nennt, wie viele beim Event sein müssen - der Server prüft das Team beim Anmelden", async () => {
  mockApi({ ...base, team_mode: "team", team_size: 5, event_gate: { ...GATE, team_need: 5 } });
  renderPage();
  expect(await screen.findByTestId("tournament-event-gate")).toHaveTextContent("Mindestens 5 Spieler deines Teams müssen beim Event „Vereins-LAN“ angemeldet sein.");
  expect(screen.queryByTestId("tournament-event-first")).toBeNull();
});

// Datum ganz (#1220): die Kachel „Start“ zeigt Tag und Uhrzeit vollständig - „Sa 23. Mai · 21:00“, ohne „…“.
test("Start-Kachel mit ganzem Datum in Klartext", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-05-20T10:00:00Z"));
  try {
    mockApi({ ...base, start_date: "2026-05-23T19:00:00Z" });
    renderPage();
    const tile = await screen.findByTestId("tournament-start-tile");
    expect(tile).toHaveTextContent("Sa 23. Mai · 21:00");
    expect(tile.querySelector(".truncate")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

// Nach dem Ende (#1221): ein beendetes Turnier hat keinen Kalender-Knopf mehr.
test("Kalender-Knopf nur, solange das Turnier nicht vorbei ist", async () => {
  mockApi({ ...base, start_date: "2026-11-14T13:00:00Z" });
  const { unmount } = renderPage();
  expect(await screen.findByTestId("add-to-calendar")).toBeInTheDocument();
  unmount();
  mockApi({ ...base, status: "results_published", start_date: "2026-05-23T19:00:00Z", public_phase: { state: "results_published" } });
  renderPage();
  expect(await screen.findByTestId("tournament-title")).toBeInTheDocument();
  expect(screen.queryByTestId("add-to-calendar")).toBeNull();
});

// Turnierwechsel (#1047): eine späte Antwort für das vorige Turnier ändert das neue nicht.
function GoTo({ to }) {
  const navigate = useNavigate();
  return <button type="button" data-testid={`goto-${to}`} onClick={() => navigate(to)}>wechseln</button>;
}

test("Wechsel von Turnier A zu B: die späte Antwort von A ändert B nicht", async () => {
  let resolveA;
  const lateA = new Promise((done) => { resolveA = done; });
  const winter = { ...base, id: "t2", slug: "winter", title: "Winter-Cup" };
  apiMock.get.mockImplementation((path) => {
    if (path === "/tournaments/cup") return lateA;
    if (path === "/tournaments/winter") return Promise.resolve({ data: winter });
    if (path === "/teams/my") return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
  render(
    <MemoryRouter initialEntries={["/tournaments/cup"]}>
      <Routes><Route path="/tournaments/:slug" element={<><GoTo to="/tournaments/winter" /><TournamentDetailPage /></>} /></Routes>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByTestId("goto-/tournaments/winter"));
  expect(await screen.findByTestId("tournament-title")).toHaveTextContent("Winter-Cup");

  await act(async () => resolveA({ data: base }));

  expect(screen.getByTestId("tournament-title")).toHaveTextContent("Winter-Cup");
});

test("die Anmeldung lädt erst nach der Seite: kein zweiter Aufbau, der erste Stand bleibt", async () => {
  authUser = undefined;
  mockApi(base);
  const page = () => (
    <MemoryRouter initialEntries={["/tournaments/cup"]}>
      <Routes><Route path="/tournaments/:slug" element={<TournamentDetailPage />} /></Routes>
    </MemoryRouter>
  );
  const view = render(page());
  const title = await screen.findByTestId("tournament-title");

  authUser = { id: "u1", username: "paula", display_name: "Paula" };
  view.rerender(page());

  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/teams/my"));
  expect(title.isConnected).toBe(true);
  expect(screen.getByTestId("tournament-title")).toBe(title);
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

// Vor-Ort-Zugang (#1592): Wer den QR-Code eingelöst hat, aber das Turnier sonst nicht sieht, bekommt die schlanke Form.
const SLIM = {
  id: "t1", slug: "cup", title: "Herbst-Cup", status: "registration_open", registration_enabled: true,
  participant_count: 5, max_participants: 16, team_mode: "solo", event_mode: "local", start_date: "2026-10-31T13:00:00+00:00",
  game: { id: "g1", slug: "rl", name: "Rocket League", display_name: "Rocket League", player_id_fields: [] },
  public_phase: { state: "registration_open", label: "Anmeldung" }, onsite_view: true,
};

test("schlanke Ansicht: Titel, Termin, Spiel, freie Plätze und „Mitspielen“ - sonst nichts nachgeladen", async () => {
  mockApi(SLIM);
  renderPage();
  const view = await screen.findByTestId("onsite-tournament-view");
  expect(view).toHaveTextContent("Herbst-Cup");
  expect(view).toHaveTextContent("Rocket League");
  expect(screen.getByTestId("onsite-seats")).toHaveTextContent("11 von 16 Plätzen frei");
  expect(screen.getByTestId("onsite-start")).toHaveTextContent("31");
  expect(screen.getByTestId("onsite-register-btn")).toHaveTextContent("Mitspielen");
  expect(apiMock.get).not.toHaveBeenCalledWith("/tournaments/t1/registrations", expect.anything());
  expect(screen.queryByTestId("tournament-bracket-link")).toBeNull();
});

test("schlanke Ansicht ohne Konto: „Mitspielen“ führt zu Login mit Rückweg ohne Code", async () => {
  authUser = null;
  const user = userEvent.setup();
  mockApi(SLIM);
  render(
    <MemoryRouter initialEntries={["/tournaments/cup"]}>
      <Routes>
        <Route path="/tournaments/:slug" element={<TournamentDetailPage />} />
        <Route path="/login" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  await user.click(await screen.findByTestId("onsite-register-btn"));
  expect(await screen.findByTestId("location-probe")).toHaveTextContent("/login?next=%2Ftournaments%2Fcup");
});

test("schlanke Ansicht mit Konto: „Mitspielen“ öffnet das Blatt (#1261), „Verbindlich anmelden“ meldet an", async () => {
  const user = userEvent.setup();
  mockApi({ ...SLIM, location: "Halle Probe" });
  renderPage();
  await user.click(await screen.findByTestId("onsite-register-btn"));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByTestId("register-sheet-place")).toHaveTextContent("Vor Ort · Halle Probe");
  expect(screen.getByTestId("register-sheet-rules")).toHaveTextContent("alle Regeln siehst du nach der Anmeldung");
  expect(apiMock.post).not.toHaveBeenCalled();
  await user.click(screen.getByTestId("tournament-register-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t1/register", expect.objectContaining({ accept_rules: true }), expect.anything()));
});

test("schlanke Ansicht: voll heißt Warteliste, geschlossen heißt kein Knopf", async () => {
  mockApi({ ...SLIM, participant_count: 16 });
  const { unmount } = renderPage();
  expect(await screen.findByTestId("onsite-seats")).toHaveTextContent("Alle Plätze belegt – Warteliste");
  unmount();
  mockApi({ ...SLIM, status: "check_in", public_phase: { state: "check_in", label: "Check-in" } });
  renderPage();
  await screen.findByTestId("onsite-tournament-view");
  expect(screen.queryByTestId("onsite-register-btn")).toBeNull();
  expect(screen.getByTestId("onsite-closed")).toBeInTheDocument();
});

// Podest und Sieger-Moment (#1339, #1180) mit der echten Rangliste eines beendeten Turniers
// (scripts/make_table_schedule_fixture.py): Treppchen statt drei Kästen, der Moment einmal je Browser.
test("beendet: Treppchen mit Platz 1 in der Mitte, der eigene Platz kommt einmal in die Zeremonie-Warteschlange", async () => {
  const generated = (await import("../../../e2e/fixtures/tableScheduleGenerated.json")).default;
  const { ceremonyQueue } = await import("@/components/achievements/ceremony/queue");
  const { tournament, standings, bracket } = generated.finished;
  window.localStorage.clear();
  ceremonyQueue.clear();
  apiMock.get.mockImplementation((path) => {
    if (path === "/tournaments/cup") return Promise.resolve({ data: { ...tournament, slug: "cup", id: "t1" } });
    if (path === "/tournaments/t1/registrations") return Promise.resolve({ data: bracket.registrations });
    if (path === "/tournaments/t1/standings") return Promise.resolve({ data: standings });
    return Promise.resolve({ data: [] });
  });
  const { unmount } = renderPage();
  const podium = await screen.findByTestId("podium");
  expect([...podium.querySelectorAll("[data-place]")].map((el) => el.getAttribute("data-place"))).toEqual(["2", "1", "3"]);
  await waitFor(() => expect(ceremonyQueue.getCurrent()?.placement?.title).toBe("Champion"));
  // Die Teilnehmerliste nennt nach dem Ende den Endplatz statt der Anmelde-Nummer (Abnahme #1593).
  const ranked = [...standings].sort((a, b) => a.rank - b.rank);
  const rows = screen.getAllByTestId(/^tournament-participant-(?!me-|rank-)/);
  expect(rows.map((row) => row.getAttribute("data-testid").replace("tournament-participant-", ""))).toEqual(ranked.map((row) => row.registration_id));
  expect(screen.getByTestId(`tournament-participant-rank-${ranked[0].registration_id}`)).toHaveTextContent("1.");
  ceremonyQueue.clear();
  unmount();
  renderPage();
  await screen.findByTestId("podium");
  expect(ceremonyQueue.getCurrent()).toBeNull();
});

test("läuft noch: die Teilnehmerliste nennt keinen Endplatz (#2121)", async () => {
  const generated = (await import("../../../e2e/fixtures/tableScheduleGenerated.json")).default;
  const { tournament, standings, bracket } = generated.finished;
  apiMock.get.mockImplementation((path) => {
    if (path === "/tournaments/cup") return Promise.resolve({ data: { ...tournament, status: "live", slug: "cup", id: "t1" } });
    if (path === "/tournaments/t1/registrations") return Promise.resolve({ data: bracket.registrations });
    if (path === "/tournaments/t1/standings") return Promise.resolve({ data: standings });
    return Promise.resolve({ data: [] });
  });
  renderPage();
  await screen.findByTestId(`tournament-participant-${bracket.registrations[0].id}`);
  expect(screen.queryAllByTestId(/^tournament-participant-rank-/)).toHaveLength(0);
});

test("beendet, aber noch nicht veröffentlicht: Podest als „vorläufig“, noch kein Sieger-Moment", async () => {
  const generated = (await import("../../../e2e/fixtures/tableScheduleGenerated.json")).default;
  const { ceremonyQueue } = await import("@/components/achievements/ceremony/queue");
  const { tournament, standings, bracket } = generated.finished;
  window.localStorage.clear();
  ceremonyQueue.clear();
  apiMock.get.mockImplementation((path) => {
    if (path === "/tournaments/cup") return Promise.resolve({ data: { ...tournament, status: "completed", slug: "cup", id: "t1" } });
    if (path === "/tournaments/t1/registrations") return Promise.resolve({ data: bracket.registrations });
    if (path === "/tournaments/t1/standings") return Promise.resolve({ data: standings });
    return Promise.resolve({ data: [] });
  });
  renderPage();
  await screen.findByTestId("podium");
  expect(screen.getByTestId("podium-provisional")).toHaveTextContent("vorläufig");
  expect(ceremonyQueue.getCurrent()).toBeNull();
});

// #1801: Die Turnierseite lädt nur bei Änderungen ihres Turniers nach - bis es geladen ist, bei jeder.
test("die Seite hört nach dem Laden nur noch auf das eigene Turnier", async () => {
  mockApi(base);
  liveCalls.length = 0;
  renderPage();
  const page = () => liveCalls.filter((call) => call.options?.fallbackMs === 10000);
  expect(page()[0].options.tournamentId).toBeFalsy();
  await screen.findAllByText("Herbst-Cup");
  await waitFor(() => expect(page().at(-1).options.tournamentId).toBe("t1"));
});

test("#1888: die Livestream-Karte folgt der öffentlichen Phase - nach dem Ende keine, solange es läuft schon", async () => {
  mockApi({ ...base, status: "live", public_phase: { state: "completed", label: "Beendet" } });
  const { unmount } = renderPage();
  expect(await screen.findByTestId("tournament-title")).toBeInTheDocument();
  expect(screen.queryByTestId("tournament-live-streams-stub")).toBeNull();
  unmount();
  mockApi({ ...base, status: "live", public_phase: { state: "live", label: "Läuft" } });
  renderPage();
  expect(await screen.findByTestId("tournament-live-streams-stub")).toBeInTheDocument();
});

// #1939: Ein verborgenes oder falsches Turnier zeigt eine Meldung statt ewig das Ladeskelett. Was der Server meldet, gilt:
// 404 (unbekannt oder verborgen) heißt für alle „nicht gefunden“, 403 heißt „nur für Mitglieder bzw. über den QR-Code“.
const failure = (status) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { detail: "x" } } });

function failWith(error) {
  apiMock.get.mockImplementation((path) => (path === "/tournaments/cup" ? Promise.reject(error) : Promise.resolve({ data: [] })));
}

test("#1939: Tippfehler oder verborgenes Turnier (404): „Turnier nicht gefunden“ mit Weg zur Turnierliste", async () => {
  authUser = null;
  failWith(failure(404));
  renderPage();
  expect(await screen.findByRole("heading", { name: "Turnier nicht gefunden" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Zur Turnierliste" })).toHaveAttribute("href", "/tournaments");
  expect(screen.queryByTestId("page-loading")).toBeNull();
  expect(screen.queryByText(/nur für Mitglieder/)).toBeNull();
});

test("#1939: Gast ohne QR-Code (403): nur für Mitglieder bzw. über den QR-Code, mit Anmelden und Rückweg", async () => {
  authUser = null;
  failWith(failure(403));
  renderPage("/tournaments/cup?access=abc");
  expect(await screen.findByRole("heading", { name: "Dieses Turnier ist nur für Mitglieder bzw. über den QR-Code vor Ort sichtbar" })).toBeInTheDocument();
  expect(screen.getByText(/QR-Code am Eingang scannen/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Anmelden" })).toHaveAttribute("href", `/login?next=${encodeURIComponent("/tournaments/cup?access=abc")}`);
  expect(screen.getByRole("link", { name: "Zur Turnierliste" })).toHaveAttribute("href", "/tournaments");
});

test("#1939: angemeldet ohne Freigabe (403): dieselbe Meldung, ohne Anmelden-Knopf", async () => {
  failWith(failure(403));
  renderPage();
  expect(await screen.findByRole("heading", { name: /nur für Mitglieder bzw\. über den QR-Code/ })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Anmelden" })).toBeNull();
});

test("#1939: ohne Netz: „Nochmal versuchen“ lädt erneut und zeigt dann das Turnier", async () => {
  failWith(new Error("Network Error"));
  renderPage();
  const retry = await screen.findByTestId("public-error-retry");
  expect(retry).toHaveTextContent("Nochmal versuchen");
  mockApi(base);
  fireEvent.click(retry);
  expect(await screen.findByTestId("tournament-title")).toHaveTextContent("Herbst-Cup");
  expect(screen.queryByTestId("public-error-retry")).toBeNull();
});

test("Check-in-Ende vorbei (#2124): statt „Check-in“ steht „Check-in vorbei“, auch bevor der Baum gebaut ist", async () => {
  for (const timing of [{ check_in_until: "2026-01-01T10:00:00+00:00" }, { check_in_until: "2099-10-04T17:45:00+00:00", check_in_closed_at: "2026-01-01T10:00:00+00:00" }]) {
    mockApi({ ...base, ...DATES, ...timing, status: "check_in", public_phase: { state: "check_in", label: "Check-in" } }, [
      { id: "r1", status: "approved", display_name: "Paula", user_id: "u1", is_mine: true },
    ]);
    const { unmount } = renderPage();
    expect(await screen.findByTestId("tournament-checkin-over")).toBeDisabled();
    expect(screen.queryByTestId("tournament-checkin-btn")).toBeNull();
    unmount();
  }
});