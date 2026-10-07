import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

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
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
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
