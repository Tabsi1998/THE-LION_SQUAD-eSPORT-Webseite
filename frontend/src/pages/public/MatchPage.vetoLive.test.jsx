import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Map-Veto live auf der Matchseite (#1651): Der kurze Abruf bringt einen neueren Veto-Stand, danach kommt eine langsamere volle Antwort
// mit älterem Veto-Block - der übrige Seitenstand wird übernommen, der neuere Veto-Block bleibt. Erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value, resolveMediaUrl: (value) => value }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "c1", username: "kapitaen" } }) }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/MentionTextarea", () => ({ MentionTextarea: () => null }));
vi.mock("@/components/tls/CommendButton", () => ({ CommendButton: () => null }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/hooks/useChats", () => ({ useChatRead: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const MatchPage = (await import("./MatchPage")).default;
const { resetLeagueTrail } = await import("@/hooks/useLeagueTrail");

const SOON = new Date(Date.now() + 5 * 60 * 1000).toISOString();
const SIDES = ["Loewen · Rudel A", "Falken · Horst"];
const at = (seconds) => new Date(Date.now() + seconds * 1000).toISOString();

function veto(number, serverNow) {
  return {
    status: "running", skipped_reason: null, version: number + 1, step_seconds: 60, server_now: serverNow,
    team_a: { registration_id: "a", name: SIDES[0], via: "home" }, team_b: { registration_id: "b", name: SIDES[1] },
    current: { index: number - 1, number, total: 11, kind: "ban", mode: "hp", mode_label: "Stellung", registration_id: number % 2 ? "a" : "b",
      name: SIDES[number % 2 ? 0 : 1], position: null, deadline_at: at(50), remaining_seconds: 50 },
    own_turn: false, can_pick: false, own_side: "A", pick_hint: "Jetzt ist die Gegenseite am Zug.", options: [], remaining: [], history: [],
    planned_games: [], paused: null, lead: null, presets: [], plan: [], week: null, blocked: null, start: null,
  };
}

function page(vetoBlock, presentB) {
  return {
    tournament: { id: "t1", slug: "liga-a", title: "Probe-Liga · Staffel A" },
    match: { id: "m1", match_key: "L1", status: "scheduled", scheduled_at: SOON, slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }] },
    participants: [{ slot: 1, registration_id: "a", display_name: SIDES[0] }, { slot: 2, registration_id: "b", display_name: SIDES[1] }],
    matchday_label: "Spieltag 1", collection: "matches_v2", can_act: true, can_propose_schedule: false, can_manage_schedule: false,
    can_player_report_result: false, can_submit_result: false, can_staff_submit_result: false, can_dispute: false,
    event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal", acting_registration_id: "a",
    schedule_proposals: [], schedule_block: null, veto_view: null,
    checkin: {
      rules: { opens_minutes_before: 15, closes_minutes_after: 15, min_present: 2, remind_minutes_before_close: 5 }, state: "veto", scheduled_at: SOON,
      window: { opens_at: at(-600), closes_at: SOON }, ready_at: at(-60), started_at: null,
      sides: [
        { registration_id: "a", name: SIDES[0], own: true, checked_in: true, present: [], present_count: 2, consent_open: false },
        { registration_id: "b", name: SIDES[1], own: false, checked_in: true, present: [], present_count: presentB, consent_open: false },
      ],
      own_registration_id: "a", can_checkin: true, checkin_hint: null, roster: [], min_present: 2, can_start: false,
      start_hint: "Erst das Veto abschließen, dann starten.", proposal: null, lead: null, veto: vetoBlock,
    },
  };
}

beforeEach(() => {
  resetLeagueTrail();
  apiMock.get.mockReset();
});

test("eine langsame volle Antwort mit älterem Veto-Block: der übrige Stand kommt, der neuere Veto-Block bleibt", async () => {
  let release;
  const slow = new Promise((resolve) => { release = resolve; });
  let pageCalls = 0;
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/matches/m1/page") {
      pageCalls += 1;
      // Erst Schritt 2; das zweite volle Laden ist langsam und bringt Schritt 3 (älter als der kurze Abruf) und neue Seitenwerte.
      return pageCalls === 1 ? { data: page(veto(2, at(-10)), 2) } : slow;
    }
    if (url === "/matches/m1/veto") return { data: { veto: veto(4, at(-1)), now: at(-1), state: "veto", match: null } };
    return { data: [] };
  });
  render(
    <MemoryRouter initialEntries={["/matches/m1"]}>
      <Routes><Route path="/matches/:id" element={<MatchPage />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByTestId("veto-step")).toHaveTextContent("Schritt 2 von 11");
  // Tab wieder sichtbar: die Seite lädt ganz (langsam), der Veto-Block fragt kurz nach (schnell, Schritt 4).
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  await waitFor(() => expect(screen.getByTestId("veto-step")).toHaveTextContent("Schritt 4 von 11"));
  await act(async () => { release({ data: page(veto(3, at(-5)), 3) }); await slow; });
  await waitFor(() => expect(screen.getByTestId("checkin-slim")).toHaveTextContent("(3 Spieler)"));
  expect(screen.getByTestId("veto-step")).toHaveTextContent("Schritt 4 von 11");
});
