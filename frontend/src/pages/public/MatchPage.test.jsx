import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";

// Matchseite im Klartext (#1220): Überschrift mit Runde und Namen statt „Match A“, ein fertiges Spiel zeigt „Beendet“
// mit Ergebnis statt „Terminstatus: Noch offen“, Freilos heißt Freilos, die Station steht einmal im Klartext.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
const authState = { user: null };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/Breadcrumbs", () => ({ Breadcrumbs: () => null }));
vi.mock("@/components/tls/MentionTextarea", () => ({ MentionTextarea: () => <textarea /> }));
vi.mock("@/components/tls/CommendButton", () => ({ CommendButton: () => null }));
let liveOptions = null;
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: (load, resources, options) => { liveOptions = options; } }));
vi.mock("@/hooks/useChats", () => ({ useChatRead: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const MatchPage = (await import("./MatchPage")).default;

const BASE = {
  tournament: { id: "t1", slug: "mk-cup", title: "Mario Kart Cup" },
  schedule_proposals: [], can_act: false, can_report_score: false, can_player_report_result: false, can_submit_result: false,
  can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: false, can_forfeit: false,
  event_mode: "local", result_entry_mode: "staff_only", schedule_mode: "fixed_by_staff", collection: "matches_v2", matchday: 1,
};
const NEON = { slot: 1, status: "filled", registration_id: "r1", display_name: "NeonFalke" };
const LUNA = { slot: 2, status: "filled", registration_id: "r2", display_name: "LunaByte" };

function renderMatch(page) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/matches/m1/page") return { data: page };
    if (url === "/matches/m1/chat") return { data: [] };
    return { data: [] };
  });
  return render(
    <MemoryRouter initialEntries={["/matches/m1"]}>
      <Routes><Route path="/matches/:id" element={<MatchPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-05-20T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

test("Freilos: Überschrift mit Namen, „Beendet“ mit Satz, Station im Klartext, kein Terminstatus", async () => {
  renderMatch({
    ...BASE,
    match: { id: "m1", match_key: "A", status: "completed", winner_id: "r1", round_name: "Achtelfinale", scheduled_at: "2026-05-23T16:00:00Z",
      slots: [{ slot: 1, status: "filled", registration_id: "r1" }, { slot: 2, status: "bye" }], results: [{ registration_id: "r1", rank: 1 }],
      station_id: "s1", station_label: "Station A - switch2", station_text: "Station A · Switch 2" },
    participants: [NEON, { slot: 2, status: "bye", registration_id: null, display_name: null }],
    matchday_label: "Achtelfinale",
  });
  expect(await screen.findByTestId("match-headline")).toHaveTextContent("NeonFalke gegen Freilos");
  expect(screen.getByTestId("match-key")).toHaveTextContent("Spiel A");
  const box = screen.getByTestId("match-finished");
  expect(box).toHaveTextContent("Beendet");
  expect(box).toHaveTextContent("Sa 23. Mai · 18:00");
  expect(screen.getByTestId("match-outcome")).toHaveTextContent("Freilos – NeonFalke kommt kampflos weiter.");
  expect(screen.getByTestId("match-station")).toHaveTextContent("Station A · Switch 2");
  expect(screen.queryByText("Terminstatus")).toBeNull();
  expect(screen.queryByText(/Station Station/)).toBeNull();
  expect(screen.queryByText("Offen")).toBeNull();
  expect(screen.getAllByText("Freilos").length).toBeGreaterThan(0);
});

test("beendetes Duell: Sieger mit Ergebnis", async () => {
  renderMatch({
    ...BASE,
    match: { id: "m1", match_key: "B", status: "completed", winner_id: "r2", round_name: "Halbfinale",
      slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }],
      results: [{ registration_id: "r1", rank: 2, score: 1 }, { registration_id: "r2", rank: 1, score: 3 }] },
    participants: [NEON, LUNA],
    matchday_label: "Halbfinale",
  });
  expect(await screen.findByTestId("match-headline")).toHaveTextContent("NeonFalke gegen LunaByte");
  expect(screen.getByTestId("match-outcome")).toHaveTextContent("LunaByte gewinnt 3:1.");
});

test("offenes Spiel: „Noch offen“ nur ohne Termin, mit Termin der Tag in Klartext", async () => {
  const open = {
    ...BASE,
    match: { id: "m1", match_key: "C", status: "scheduled", round_name: "Viertelfinale", slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, status: "pending" }] },
    participants: [NEON, { slot: 2, status: "pending", registration_id: null, display_name: null }],
    matchday_label: "Viertelfinale",
  };
  const { unmount } = renderMatch(open);
  expect(await screen.findByTestId("match-headline")).toHaveTextContent("NeonFalke gegen noch offen");
  const box = screen.getByTestId("match-schedule");
  expect(box).toHaveTextContent("Noch offen");
  expect(box).toHaveTextContent("Noch kein Termin");
  expect(screen.queryByTestId("match-finished")).toBeNull();
  unmount();

  renderMatch({ ...open, match: { ...open.match, scheduled_at: "2026-05-21T16:00:00Z" } });
  const dated = await screen.findByTestId("match-schedule");
  expect(dated).toHaveTextContent("Termin steht");
  expect(dated).toHaveTextContent("morgen 18:00");
  expect(dated).not.toHaveTextContent("Noch offen");
});

// Nach dem Ende (#1221): Ergebnis und Verlauf - kein Live-Refresh, keine Terminabstimmung; den Chat sehen nur noch
// Teilnehmer und Turnierleitung zum Nachlesen, ein leerer Chat verschwindet.
const DONE = {
  ...BASE,
  match: { id: "m1", match_key: "B", status: "completed", winner_id: "r2", round_name: "Halbfinale",
    slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }],
    results: [{ registration_id: "r1", rank: 2, score: 1 }, { registration_id: "r2", rank: 1, score: 3 }] },
  participants: [NEON, LUNA],
  matchday_label: "Halbfinale",
};

function renderWithChat(page, chat) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/matches/m1/page") return { data: page };
    if (url === "/matches/m1/chat") return { data: chat };
    return { data: [] };
  });
  return render(
    <MemoryRouter initialEntries={["/matches/m1"]}>
      <Routes><Route path="/matches/:id" element={<MatchPage />} /></Routes>
    </MemoryRouter>,
  );
}

test("beendetes Match: kein Live-Refresh, keine Terminabstimmung, leerer Chat weg", async () => {
  renderWithChat(DONE, []);
  expect(await screen.findByTestId("match-finished")).toBeInTheDocument();
  expect(screen.queryByTestId("match-live-refresh")).toBeNull();
  expect(screen.queryByTestId("match-scheduling")).toBeNull();
  expect(screen.queryByTestId("match-chat")).toBeNull();
});

test("beendetes Match: Teilnehmer lesen den Chat nach, schreiben geht nicht mehr; Gäste sehen ihn nicht", async () => {
  const chat = [{ id: "c1", message: "GG!", author: { display_name: "LunaByte" } }];
  const { unmount } = renderWithChat({ ...DONE, can_act: true }, chat);
  const box = await screen.findByTestId("match-chat");
  expect(box).toHaveTextContent("GG!");
  expect(screen.getByTestId("match-chat-closed")).toHaveTextContent("Das Match ist beendet – der Chat bleibt zum Nachlesen.");
  expect(box.querySelector("form")).toBeNull();
  unmount();
  renderWithChat(DONE, chat);
  expect(await screen.findByTestId("match-finished")).toBeInTheDocument();
  expect(screen.queryByTestId("match-chat")).toBeNull();
});

test("offenes Match: Live-Refresh, Terminabstimmung und Chat bleiben", async () => {
  renderWithChat({ ...DONE, match: { ...DONE.match, status: "scheduled", winner_id: null, results: [] } }, []);
  expect(await screen.findByTestId("match-schedule")).toBeInTheDocument();
  expect(screen.getByTestId("match-live-refresh")).toBeInTheDocument();
  expect(screen.getByTestId("match-scheduling")).toBeInTheDocument();
  expect(screen.getByTestId("match-chat")).toBeInTheDocument();
});

// Matchwechsel (#1047): Chat-Entwurf und Anhänge gehören zu einem Match und einem Konto.
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function GoTo({ to }) {
  const navigate = useNavigate();
  return <button type="button" data-testid={`goto-${to}`} onClick={() => navigate(to)}>wechseln</button>;
}

function openMatch(id, names) {
  return { ...BASE, can_act: true, match: { id, match_key: "A", status: "scheduled", round_name: "Halbfinale", slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }], results: [] },
    participants: [{ ...NEON, display_name: names[0] }, { ...LUNA, display_name: names[1] }], matchday_label: "Halbfinale" };
}

test("Wechsel zu einem anderen Match: keine Anhänge vom vorigen, späte Antworten ändern das neue nicht", async () => {
  authState.user = { id: "u-neon", username: "neonfalke" };
  const urlSpies = [vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:vorschau"), vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})];
  const lateChat = deferred();
  let m1Calls = 0;
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/matches/m1/page") return { data: openMatch("m1", ["NeonFalke", "LunaByte"]) };
    if (url === "/matches/m1/chat") { m1Calls += 1; return m1Calls === 1 ? { data: [] } : lateChat.promise; }
    if (url === "/matches/m2/page") return { data: openMatch("m2", ["PixelPanther", "Schattenwolf"]) };
    if (url === "/matches/m2/chat") return { data: [] };
    return { data: [] };
  });
  apiMock.post.mockImplementation(async (url) => (url === "/chat-attachments" ? { data: { id: "att-m1", kind: "image" } } : { data: {} }));
  try {
    render(
      <MemoryRouter initialEntries={["/matches/m1"]}>
        <Routes><Route path="/matches/:id" element={<><GoTo to="/matches/m2" /><MatchPage /></>} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("match-headline")).toHaveTextContent("NeonFalke gegen LunaByte");
    fireEvent.change(screen.getByTestId("match-chat-attach-input"), { target: { files: [new File(["x"], "bild.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getByTestId("chat-attachment-drafts").querySelector('[data-status="ready"]')).not.toBeNull());
    // Ein Nachladen für m1 läuft noch, während gewechselt wird.
    window.dispatchEvent(new Event("focus"));

    fireEvent.click(screen.getByTestId("goto-/matches/m2"));
    expect(await screen.findByText("PixelPanther gegen Schattenwolf")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-attachment-drafts")).toBeNull();

    await act(async () => lateChat.resolve({ data: [{ id: "c-m1", message: "nur in m1", author: { display_name: "LunaByte" } }] }));
    expect(screen.getByTestId("match-headline")).toHaveTextContent("PixelPanther gegen Schattenwolf");
    expect(screen.queryByText("nur in m1")).toBeNull();
  } finally {
    urlSpies.forEach((spy) => spy.mockRestore());
    authState.user = null;
  }
});

test("die Anmeldung lädt erst nach der Seite: kein zweiter Aufbau", async () => {
  authState.user = undefined;
  try {
    apiMock.get.mockImplementation(async (url) => {
      if (url === "/matches/m1/page") return { data: openMatch("m1", ["NeonFalke", "LunaByte"]) };
      return { data: [] };
    });
    const page = () => (
      <MemoryRouter initialEntries={["/matches/m1"]}>
        <Routes><Route path="/matches/:id" element={<MatchPage />} /></Routes>
      </MemoryRouter>
    );
    const view = render(page());
    const headline = await screen.findByTestId("match-headline");
    const loads = apiMock.get.mock.calls.filter(([url]) => url === "/matches/m1/page").length;

    authState.user = { id: "u-neon", username: "neonfalke" };
    view.rerender(page());

    expect(await screen.findByTestId("match-chat")).toBeInTheDocument();
    expect(headline.isConnected).toBe(true);
    expect(apiMock.get.mock.calls.filter(([url]) => url === "/matches/m1/page")).toHaveLength(loads);
  } finally {
    authState.user = null;
  }
});

test("vor Ort (#1556): die Matchseite sagt, wann und wo das Spiel aus der Warteschlange dran ist", async () => {
  const page = {
    ...BASE,
    match: { id: "m1", match_key: "C", status: "scheduled", round_name: "Viertelfinale", scheduled_at: "2026-05-20T10:30:00Z",
      slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }] },
    participants: [NEON, LUNA],
  };
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/matches/m1/page") return { data: page };
    if (url === "/tournaments/t1/live-queue") {
      return { data: { applies: true, matches: { m1: { match_id: "m1", state: "queued", position: 1, station_text: "Station 2 · Switch 2", forecast_at: "2026-05-20T10:41:00Z", delay_minutes: 11 } } } };
    }
    return { data: [] };
  });
  render(
    <MemoryRouter initialEntries={["/matches/m1"]}>
      <Routes><Route path="/matches/:id" element={<MatchPage />} /></Routes>
    </MemoryRouter>,
  );
  const status = await screen.findByTestId("live-queue-status");
  expect(status).toHaveTextContent("Als Nächstes an Station 2 · Switch 2");
  expect(status).not.toHaveTextContent("Du bist");
  expect(status).toHaveTextContent("ca. 12:41 · +11 Min.");
});

// #1801: Die Matchseite lädt nur bei Änderungen ihres Turniers nach - bis das Spiel geladen ist, bei jeder.
test("hört nach dem Laden nur noch auf das eigene Turnier", async () => {
  renderMatch({
    ...BASE,
    match: { id: "m1", match_key: "A", status: "scheduled", round_name: "Achtelfinale", slots: [NEON, LUNA], results: [] },
    participants: [NEON, LUNA],
  });
  expect(liveOptions.tournamentId).toBeFalsy();
  await screen.findByTestId("match-headline");
  await waitFor(() => expect(liveOptions.tournamentId).toBe("t1"));
});
