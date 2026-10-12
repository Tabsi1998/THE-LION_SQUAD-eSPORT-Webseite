import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Ergebnis melden (#1132): Spieler finden auf der Matchseite ein Meldeformular - online melden sie selbst, die
// Gegenseite bestätigt mit einem Klick. Ohne das Recht kein Formular; die Turnierleitung trägt weiter über /result ein.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
const authState = { user: { id: "u1", username: "neon" } };
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

const NEON = { slot: 1, status: "filled", registration_id: "r1", display_name: "NeonFalke" };
const LUNA = { slot: 2, status: "filled", registration_id: "r2", display_name: "LunaByte" };
const PAGE = {
  tournament: { id: "t1", slug: "mk-cup", title: "Mario Kart Cup" },
  match: { id: "m1", match_key: "A", status: "scheduled", round_name: "Halbfinale", slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }] },
  participants: [NEON, LUNA], matchday_label: "Halbfinale", schedule_proposals: [], collection: "matches_v2",
  can_act: true, can_report_score: true, can_player_report_result: true, can_submit_result: false, can_staff_submit_result: false,
  can_propose_schedule: false, can_manage_schedule: false, can_dispute: false, can_forfeit: false, allows_draw: false,
  event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal",
  report_state: { status: "open", own_summary: null, proposal: null, proposal_summary: null },
};

function renderMatch(page) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/matches/m1/page") return { data: page };
    return { data: [] };
  });
  return render(
    <MemoryRouter initialEntries={["/matches/m1"]}>
      <Routes><Route path="/matches/:id" element={<MatchPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { awaiting_confirmation: true } });
});

test("Spieler melden (#1157): große Plus/Minus-Knöpfe, Satz vor dem Absenden, die Platzierungsliste geht an /report", async () => {
  renderMatch(PAGE);
  const form = await screen.findByTestId("match-report-form");
  expect(form).toContainElement(screen.getByTestId("result-score"));
  expect(screen.queryByTestId("result-flag-r1")).toBeNull();
  fireEvent.click(screen.getByTestId("match-report-submit"));
  expect(await screen.findByTestId("match-report-error")).toHaveTextContent("Gleichstand geht in diesem Spiel nicht");
  expect(apiMock.post).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId("result-score-r1-plus"));
  for (let step = 0; step < 3; step += 1) fireEvent.click(screen.getByTestId("result-score-r2-plus"));
  expect(screen.getByTestId("match-report-sentence")).toHaveTextContent("LunaByte gewinnt 3:1");
  fireEvent.click(screen.getByTestId("match-report-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(1));
  expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/report", {
    results: [{ registration_id: "r2", rank: 1, score: 3 }, { registration_id: "r1", rank: 2, score: 1 }],
    screenshot_url: null, note: null, photo_id: null,
  });
  expect(screen.queryByTestId("match-staff-result-form")).toBeNull();
});

test("Foto vom Ergebnis: sofort hochgeladen, die Kennung geht mit der Meldung", async () => {
  apiMock.post.mockImplementation(async (url) => (url === "/matches/m1/proof-photos" ? { data: { id: "p1", url: "/api/matches/m1/proof-photos/p1", scan_state: "safe" } } : { data: { awaiting_confirmation: true } }));
  window.URL.createObjectURL = vi.fn(() => "blob:vorschau");
  window.URL.revokeObjectURL = vi.fn();
  renderMatch(PAGE);
  await screen.findByTestId("match-report-form");
  const file = new File(["bild"], "ergebnis.jpg", { type: "image/jpeg" });
  fireEvent.change(screen.getByTestId("proof-photo-input"), { target: { files: [file] } });
  expect(await screen.findByText("Foto angehängt – sehen nur die Gegenseite und die Turnierleitung.")).toBeInTheDocument();
  expect(apiMock.post.mock.calls[0][0]).toBe("/matches/m1/proof-photos");
  expect(apiMock.post.mock.calls[0][1]).toBeInstanceOf(FormData);
  fireEvent.click(screen.getByTestId("result-score-r1-plus"));
  fireEvent.click(screen.getByTestId("match-report-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/report", expect.objectContaining({ photo_id: "p1" })));
});

test("Nur Turnierleitung (#1157): kein Melde-Knopf, sondern wer das Ergebnis einträgt", async () => {
  renderMatch({ ...PAGE, result_entry_mode: "staff_only", event_mode: "local", can_player_report_result: false, can_report_score: false, report_state: null, acting_registration_id: "r1" });
  expect(await screen.findByTestId("match-staff-enters")).toHaveTextContent("Das Ergebnis trägt die Turnierleitung ein.");
  expect(screen.queryByTestId("match-report")).toBeNull();
});

test("nach der eigenen Meldung: „wartet auf die Gegenseite“, ändern geht", async () => {
  renderMatch({ ...PAGE, report_state: { status: "waiting", own_summary: "LunaByte gewinnt 3:1.", proposal: null, proposal_summary: null } });
  const box = await screen.findByTestId("match-report-state");
  expect(box).toHaveAttribute("data-status", "waiting");
  expect(box).toHaveTextContent("Deine Meldung ist da – wartet auf die Gegenseite.");
  expect(box).toHaveTextContent("Deine Meldung: LunaByte gewinnt 3:1.");
  expect(screen.queryByTestId("match-report-form")).toBeNull();
  fireEvent.click(screen.getByTestId("match-report-change"));
  expect(screen.getByTestId("match-report-form")).toBeInTheDocument();
});

test("„Meldung ändern“ gleich beim Erscheinen öffnet das Formular - ein später Effekt schließt es nicht wieder", async () => {
  renderMatch({ ...PAGE, report_state: { status: "waiting", own_summary: "LunaByte gewinnt 3:1.", proposal: null, proposal_summary: null } });
  // Ohne den Umweg über findBy: geklickt wird im selben Takt, in dem der Knopf erscheint - also bevor React die Effekte
  // des Aufbaus nachholt. Unter Last auf GitHub ist genau das passiert.
  await new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector("[data-testid='match-report-change']")) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(document.body, { subtree: true, childList: true });
  });
  fireEvent.click(screen.getByTestId("match-report-change"));
  expect(screen.getByTestId("match-report-form")).toBeInTheDocument();
});

test("neuer Meldestand vom Server (die Gegenseite meldet): das offene „Meldung ändern“ schließt, „Stimmt“ steht da", async () => {
  renderMatch({ ...PAGE, report_state: { status: "waiting", own_summary: "LunaByte gewinnt 3:1.", proposal: null, proposal_summary: null } });
  fireEvent.click(await screen.findByTestId("match-report-change"));
  expect(screen.getByTestId("match-report-form")).toBeInTheDocument();
  // Dasselbe noch einmal vom Server (gleicher Stand): das Formular bleibt offen.
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await waitFor(() => expect(apiMock.get.mock.calls.filter(([url]) => url === "/matches/m1/page")).toHaveLength(2));
  expect(screen.getByTestId("match-report-form")).toBeInTheDocument();
  // Die Gegenseite hat inzwischen anders gemeldet: neuer Stand, das Formular schließt.
  const proposal = [{ registration_id: "r1", rank: 1, score: 2 }, { registration_id: "r2", rank: 2, score: 0 }];
  apiMock.get.mockImplementation(async (url) => (url === "/matches/m1/page"
    ? { data: { ...PAGE, report_state: { status: "confirm", proposal, proposal_text: "NeonFalke meldet 2:0 für sich.", can_confirm: true } } }
    : { data: [] }));
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(await screen.findByTestId("match-report-confirm")).toBeInTheDocument();
  expect(screen.getByTestId("match-report-state")).toHaveAttribute("data-status", "confirm");
  expect(screen.queryByTestId("match-report-form")).toBeNull();
});

test("die Gegenseite hat gemeldet (#1159): der Satz in Worten, „Stimmt“ schickt genau diese Meldung", async () => {
  const proposal = [{ registration_id: "r2", rank: 1, score: 3 }, { registration_id: "r1", rank: 2, score: 1 }];
  renderMatch({ ...PAGE, report_state: { status: "confirm", own_summary: null, proposal, proposal_summary: "LunaByte gewinnt 3:1.",
    proposal_text: "LunaByte meldet 3:1 für sich.", proposal_by: "LunaByte", proposal_at: "2026-05-23T16:10:00Z", can_confirm: true } });
  const box = await screen.findByTestId("match-report-confirm");
  expect(screen.getByTestId("match-report-state")).toHaveAttribute("data-status", "confirm");
  expect(screen.getByTestId("match-report-proposal")).toHaveTextContent("LunaByte meldet 3:1 für sich.");
  expect(screen.getByText(/gemeldet von LunaByte um/)).toBeInTheDocument();
  expect(box).toHaveTextContent("Stimmt");
  fireEvent.click(box);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/report", { results: proposal, screenshot_url: null, note: null }));
});

test("„Stimmt nicht“ öffnet „Problem melden“ mit „Falsches Ergebnis“", async () => {
  const proposal = [{ registration_id: "r2", rank: 1 }, { registration_id: "r1", rank: 2 }];
  renderMatch({ ...PAGE, can_dispute: true, report_state: { status: "confirm", proposal, proposal_text: "LunaByte meldet einen Sieg für sich.", can_confirm: true } });
  fireEvent.click(await screen.findByTestId("match-report-wrong"));
  await waitFor(() => expect(screen.getByTestId("match-dispute-reason-wrong_result")).toHaveAttribute("aria-pressed", "true"));
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("Team-Mitglied ohne Leitung: sieht die Meldung, bestätigen kann die Teamleitung", async () => {
  const proposal = [{ registration_id: "r2", rank: 1 }, { registration_id: "r1", rank: 2 }];
  renderMatch({ ...PAGE, can_player_report_result: false, can_report_score: false,
    report_state: { status: "confirm", proposal, proposal_text: "LunaByte meldet einen Sieg für sich.", can_confirm: false } });
  expect(await screen.findByTestId("match-report-lead-confirms")).toHaveTextContent("Bestätigen kann die Teamleitung.");
  expect(screen.queryByTestId("match-report-confirm")).toBeNull();
  expect(screen.queryByTestId("match-report-form")).toBeNull();
});

test("Meldungen weichen ab: die Turnierleitung entscheidet", async () => {
  renderMatch({ ...PAGE, report_state: { status: "conflict", own_summary: "NeonFalke gewinnt 2:0.", proposal: null, proposal_summary: null } });
  expect(await screen.findByTestId("match-report-state")).toHaveTextContent("Die Meldungen weichen ab – die Turnierleitung entscheidet.");
});

test("ohne Recht kein Formular; die Turnierleitung trägt über das Ergebnis-Fenster ein (#1370)", async () => {
  const { unmount } = renderMatch({ ...PAGE, can_player_report_result: false, can_report_score: false, report_state: null });
  expect(await screen.findByTestId("match-headline")).toBeInTheDocument();
  expect(screen.queryByTestId("match-report")).toBeNull();
  unmount();

  apiMock.post.mockResolvedValue({ data: { held: true, hold: { id: "h1" } } });
  const entry = {
    id: "m1", kind: "duel", best_of: 1, ranking_mode: "higher_score", allows_draw: false, has_result: false, result: [], advance: {},
    participants: [{ registration_id: "r1", name: "NeonFalke" }, { registration_id: "r2", name: "LunaByte" }],
  };
  renderMatch({ ...PAGE, can_player_report_result: false, report_state: null, can_staff_submit_result: true, can_submit_result: true, result_entry: entry });
  fireEvent.click(await screen.findByTestId("match-staff-result-open"));
  expect(screen.queryByTestId("match-report")).toBeNull();
  expect(screen.queryByText(/Forfeit|DNF/)).toBeNull();
  fireEvent.click(screen.getByTestId("result-flag-r2-no_show"));
  fireEvent.click(screen.getByTestId("result-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/result", {
    results: [{ registration_id: "r1", rank: 1 }, { registration_id: "r2", rank: 2, forfeit: true }], hold: true, reason: null,
  }));
  expect(await screen.findByTestId("result-undo-bar")).toHaveTextContent("NeonFalke gewinnt kampflos, LunaByte ist nicht erschienen");
  expect(apiMock.post.mock.calls.some(([url]) => url === "/matches/m1/report" || url === "/matches/m1/forfeit")).toBe(false);
});

// Dispute (#1134): jeder Teilnehmer in jedem Modus, auch gegen ein eingetragenes Ergebnis - bis zur Frist vom Server.
test("Dispute auch nach dem Ergebnis: mit Frist; in Klärung steht der Hinweis für alle", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-05-23T16:10:00Z"));
  const done = {
    ...PAGE, result_entry_mode: "staff_only", can_player_report_result: false, report_state: null,
    match: { ...PAGE.match, status: "completed", winner_id: "r1", results: [{ registration_id: "r1", rank: 1 }, { registration_id: "r2", rank: 2 }] },
    can_dispute: true, dispute_until: "2026-05-23T16:30:00Z",
  };
  apiMock.post.mockResolvedValue({ data: {} });
  const { unmount } = renderMatch(done);
  expect(await screen.findByTestId("match-dispute-hint")).toHaveTextContent("Möglich bis heute 18:30.");
  // Problem melden (#1158): erst den Grund antippen, dann kurz beschreiben.
  fireEvent.change(screen.getByTestId("match-dispute-input"), { target: { value: "Falscher Spielstand" } });
  fireEvent.click(screen.getByTestId("match-dispute-btn"));
  expect(await screen.findByTestId("match-dispute-error")).toHaveTextContent("Bitte antippen, was nicht stimmt.");
  fireEvent.click(screen.getByTestId("match-dispute-reason-wrong_result"));
  fireEvent.click(screen.getByTestId("match-dispute-btn"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/dispute", { reason: "Falscher Spielstand", category: "wrong_result", photo_id: null }));
  unmount();

  renderMatch({ ...done, can_dispute: false, in_dispute: true, match: { ...done.match, status: "disputed" } });
  expect(await screen.findByTestId("match-in-dispute")).toHaveTextContent("In Klärung – zu diesem Spiel liegt ein Dispute vor.");
  expect(screen.queryByTestId("match-dispute-form")).toBeNull();
  vi.useRealTimers();
});
