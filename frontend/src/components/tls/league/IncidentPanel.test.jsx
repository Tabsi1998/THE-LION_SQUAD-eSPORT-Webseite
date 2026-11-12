import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Vorfälle im Spiel auf der Matchseite (D.5, #1619): geführt melden, antworten mit Countdown, entscheiden und die Serie
// feststellen. Der Server liefert Stand und Rechte - hier wird geprüft, was die Seite daraus macht. Erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API_BASE: "", formatApiError: (value) => value }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { IncidentPanel, MapStateNotes } = await import("./IncidentPanel");

const SIDES = [{ registration_id: "a", name: "Rudel A" }, { registration_id: "b", name: "Horst" }];
const KINDS = [{ key: "disconnect", label: "Verbindungsabbruch" }, { key: "rehost", label: "Rehost" }, { key: "other", label: "Sonstiges" }];
const PROPOSALS = [{ key: "continue_at_score", label: "Beim Stand fortsetzen" }, { key: "replay", label: "Map wiederholen" }];
const OUTCOMES = [...PROPOSALS, { key: "awarded", label: "Map zugesprochen" }, { key: "no_action", label: "Keine Maßnahme" }];
const INFO = {
  can_report: true, as_lead: false, can_decide: false, conflict: null, kinds: KINDS, proposals: PROPOSALS, outcomes: OUTCOMES, answer_minutes: 10,
  clarification_mode: "continue", break_after: 2, break_minutes: 5, quota: { limit: 1, used: [] }, hold: null, server_time: new Date().toISOString(),
};
const LEAGUE = { best_of: 3, sides: SIDES, own_registration_id: "a", roster: [{ id: "u1", name: "Mila" }], planned_games: [{ position: 2, map_name: "Turm" }],
  map_state: [], incidents: [], incident_info: INFO };

function incident(extra = {}) {
  const now = Date.now();
  return {
    id: "v1", position: 2, kind: "disconnect", kind_label: "Verbindungsabbruch", between_maps: false, at: new Date(now - 60000).toISOString(),
    score: { a: 3, b: 4 }, round: 8, players: [{ id: "u1", name: "Mila" }], note: "Verbindung weg", proposal: "replay", proposal_label: "Map wiederholen",
    reported_by: { registration_id: "a", name: "Rudel A", own: true }, state: "proposed", open: true, expired: false,
    answer_deadline: new Date(now + 247000).toISOString(), answer: null, review_cause: null, counts_quota: false, decision: null, voided: null,
    procedure: false, can_answer: false, can_withdraw: false, can_decide: false, can_settle: false, ...extra,
  };
}

const run = async (task) => { await task(); return true; };

async function show(league, props = {}) {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  await act(async () => {
    render(<MemoryRouter><IncidentPanel league={league} matchId="m1" busy={false} run={run} onChanged={onChanged} {...props} /></MemoryRouter>);
  });
  return onChanged;
}

beforeEach(() => {
  apiMock.get.mockReset().mockResolvedValue({ data: { items: [], open: true, can_add: true, limit: 10, link_max_length: 500 } });
  apiMock.post.mockReset().mockResolvedValue({ data: { result_confirmed: false } });
});

afterEach(() => {
  delete window.matchMedia;
});

test("melden führt durch vier Fragen und schickt genau das Gewählte", async () => {
  const onChanged = await show(LEAGUE);
  expect(screen.getByTestId("incident-empty")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("incident-open-form"));
  // Ohne Angaben sagt das Formular, was als Erstes fehlt - nichts geht hinaus.
  fireEvent.click(screen.getByTestId("incident-form-submit"));
  expect(screen.getByTestId("incident-form-problem")).toHaveTextContent("welche Map");
  expect(apiMock.post).not.toHaveBeenCalled();

  expect(screen.getByTestId("incident-form-position-2")).toHaveTextContent("Map 2 · Turm");
  fireEvent.click(screen.getByTestId("incident-form-position-2"));
  // Stand und Vorschlag erscheinen erst, wenn klar ist, was passiert ist.
  expect(screen.queryByTestId("incident-form-proposal-replay")).toBeNull();
  fireEvent.click(screen.getByTestId("incident-form-kind-disconnect"));
  fireEvent.change(screen.getByTestId("incident-form-score-a"), { target: { value: "3" } });
  fireEvent.change(screen.getByTestId("incident-form-score-b"), { target: { value: "4" } });
  fireEvent.click(screen.getByTestId("incident-form-player-u1"));
  fireEvent.click(screen.getByTestId("incident-form-proposal-replay"));
  expect(screen.getByTestId("incident-form-next")).toHaveTextContent("hat Horst 10 Minuten zum Antworten");
  fireEvent.click(screen.getByTestId("incident-form-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/incidents", {
    position: 2, kind: "disconnect", proposal: "replay", score: { a: 3, b: 4 }, round: null, players: ["u1"], note: null }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(screen.queryByTestId("incident-form")).toBeNull();
});

test("die Map-Pause fragt nur nach ihrer Länge und nennt das Kontingent beim Rehost", async () => {
  await show({ ...LEAGUE, incident_info: { ...INFO, quota: { limit: 1, used: [{ registration_id: "a", position: 2, count: 1 }] } } });
  fireEvent.click(screen.getByTestId("incident-open-form"));
  fireEvent.click(screen.getByTestId("incident-form-position-2"));
  fireEvent.click(screen.getByTestId("incident-form-kind-rehost"));
  expect(screen.getByTestId("incident-form-quota")).toHaveTextContent("Ihr könnt trotzdem melden");
  fireEvent.click(screen.getByTestId("incident-form-kind-pause-between"));
  expect(screen.queryByTestId("incident-form-quota")).toBeNull();
  expect(screen.queryByTestId("incident-form-proposal-replay")).toBeNull();
  fireEvent.change(screen.getByTestId("incident-form-minutes"), { target: { value: "7" } });
  fireEvent.click(screen.getByTestId("incident-form-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/incidents", { position: 2, kind: "pause", between_maps: true, minutes: 7, note: null }));
});

test("die Gegenseite sieht Vorschlag, Stand und Countdown und stimmt zu oder lehnt ab", async () => {
  const row = incident({ reported_by: { registration_id: "a", name: "Rudel A", own: false }, can_answer: true });
  const onChanged = await show({ ...LEAGUE, own_registration_id: "b", incidents: [row], incident_info: { ...INFO, hold: { code: "proposed", position: 2, text: "Zu Map 2 ist ein Vorfall gemeldet." } } });
  const card = screen.getByTestId("incident-v1");
  expect(card).toHaveTextContent("Map 2 · Turm · Verbindungsabbruch");
  expect(card).toHaveTextContent("Gemeldet von Rudel A");
  expect(card).toHaveTextContent("Vorschlag: Map wiederholen");
  expect(card).toHaveTextContent("Stand beim Vorfall: 3:4 · Runde 8");
  expect(card).toHaveTextContent("Betroffen: Mila");
  expect(screen.getByTestId("incident-sentence-v1")).toHaveTextContent("Bitte antwortet.");
  expect(screen.getByTestId("incident-countdown-text-v1").textContent).toMatch(/^4:0\d$/);
  expect(screen.getByTestId("incident-hold")).toHaveTextContent("Zu Map 2 ist ein Vorfall gemeldet.");
  // Offene Vorfälle zeigen ihre Nachweise gleich.
  expect(apiMock.get).toHaveBeenCalledWith("/matches/m1/proofs", { params: { kind: "incident", ref_id: "v1" } });

  fireEvent.click(screen.getByTestId("incident-answer-v1-decline"));
  fireEvent.change(screen.getByTestId("incident-answer-v1-note"), { target: { value: "Der Stand stimmt nicht" } });
  fireEvent.click(screen.getByTestId("incident-answer-v1-decline-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/incidents/v1/answer", { accept: false, note: "Der Stand stimmt nicht" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
});

test("zustimmen ist ein Tipp", async () => {
  await show({ ...LEAGUE, own_registration_id: "b", incidents: [incident({ reported_by: { registration_id: "a", name: "Rudel A", own: false }, can_answer: true })] });
  fireEvent.click(screen.getByTestId("incident-answer-v1-accept"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/incidents/v1/answer", { accept: true, note: null }));
});

test("die meldende Seite wartet auf die Gegenseite und kann zurückziehen", async () => {
  await show({ ...LEAGUE, incidents: [incident({ can_withdraw: true })] });
  expect(screen.getByTestId("incident-sentence-v1")).toHaveTextContent("Wartet auf Horst.");
  expect(screen.queryByTestId("incident-answer-v1")).toBeNull();
  fireEvent.click(screen.getByTestId("incident-withdraw-v1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/incidents/v1/withdraw"));
});

test("ist die Antwortzeit um, lädt die Seite einmal neu", async () => {
  const onChanged = await show({ ...LEAGUE, incidents: [incident({ answer_deadline: new Date(Date.now() - 1000).toISOString() })] });
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId("incident-countdown-text-v1")).toHaveTextContent("vorbei");
});

test("mit „Bewegung reduzieren“ steht der Balken, nur die Zahl zählt", async () => {
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  await show({ ...LEAGUE, incidents: [incident()] });
  const bar = screen.getByTestId("incident-countdown-v1").querySelector(".tls-incident-bar");
  expect(bar.style.transform).toBe("scaleX(1)");
  expect(screen.getByTestId("incident-countdown-text-v1").textContent).toMatch(/^4:0\d$/);
});

test("die Liga-Leitung entscheidet mit Begründung und stellt die Serie fest", async () => {
  const row = incident({ state: "in_review", review_cause: "rejected", can_decide: true });
  await show({ ...LEAGUE, own_registration_id: null, incidents: [row], incident_info: { ...INFO, as_lead: true, can_decide: true, can_report: true } });
  expect(screen.getByTestId("incident-state-v1")).toHaveTextContent("In Klärung");
  expect(screen.getByTestId("incident-sentence-v1")).toHaveTextContent("Abgelehnt");
  fireEvent.click(screen.getByTestId("incident-decision-v1-submit"));
  expect(screen.getByTestId("incident-decision-v1-problem")).toHaveTextContent("wie entschieden wird");
  // Nach „Map wiederholen“ gibt es kein „gleich feststellen“ - die Map wird erst gespielt.
  fireEvent.click(screen.getByTestId("incident-decision-v1-replay"));
  expect(screen.queryByTestId("incident-decision-v1-settle")).toBeNull();
  fireEvent.click(screen.getByTestId("incident-decision-v1-awarded"));
  fireEvent.change(screen.getByTestId("incident-decision-v1-reason"), { target: { value: "Laut Clip beider Seiten" } });
  fireEvent.click(screen.getByTestId("incident-decision-v1-submit"));
  expect(screen.getByTestId("incident-decision-v1-problem")).toHaveTextContent("Seite wählen");
  fireEvent.click(screen.getByTestId("incident-decision-v1-side-a"));
  fireEvent.click(screen.getByTestId("incident-decision-v1-settle"));
  fireEvent.click(screen.getByTestId("incident-decision-v1-surplus-3"));
  fireEvent.click(screen.getByTestId("incident-decision-v1-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/incidents/v1/decision", {
    outcome: "awarded", registration_id: "a", reason: "Laut Clip beider Seiten", settle: { missing_positions: [], surplus_positions: [3] } }));
});

test("nach der Entscheidung stehen Begründung und Feststellung da - die Leitung stellt die Serie fest", async () => {
  const decision = { outcome: "replay", outcome_label: "Map wiederholen", reason: "Serverausfall belegt", missing_positions: [], surplus_positions: [], settled_at: null };
  const row = incident({ state: "decided", open: false, decision, voided: { score: { a: 3, b: 4 } }, can_settle: true, procedure: true });
  await show({ ...LEAGUE, own_registration_id: null, incidents: [row], incident_info: { ...INFO, as_lead: true, can_decide: true } });
  expect(screen.getByTestId("incident-decided-v1")).toHaveTextContent("Serverausfall belegt");
  expect(screen.getByTestId("incident-settled-v1")).toHaveTextContent("noch nicht festgestellt");
  expect(screen.getByTestId("incident-voided-v1")).toHaveTextContent("Die erste Austragung (Stand 3:4) zählt nicht");
  expect(screen.getByTestId("incident-procedure-v1")).toHaveTextContent("Dazu läuft ein Verfahren.");
  // Abgeschlossene Vorfälle laden ihre Nachweise erst beim Aufklappen.
  expect(apiMock.get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("incident-settle-v1-missing-3"));
  fireEvent.click(screen.getByTestId("incident-settle-v1-submit"));
  expect(screen.getByTestId("incident-settle-v1-problem")).toHaveTextContent("begründen");
  fireEvent.change(screen.getByTestId("incident-settle-v1-reason"), { target: { value: "Map 3 fehlt noch" } });
  fireEvent.click(screen.getByTestId("incident-settle-v1-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/incidents/v1/settle", {
    missing_positions: [3], surplus_positions: [], reason: "Map 3 fehlt noch" }));
});

test("die Liga-Leitung schließt einen offenen Vorfall ohne Entscheidung - mit Begründung", async () => {
  const row = incident({ state: "proposed", can_close: true });
  await show({ ...LEAGUE, own_registration_id: null, incidents: [row], incident_info: { ...INFO, as_lead: true, can_decide: true } });
  expect(screen.queryByTestId("incident-close-v1")).toBeNull();
  fireEvent.click(screen.getByTestId("incident-close-v1-open"));
  fireEvent.click(screen.getByTestId("incident-close-v1-submit"));
  expect(screen.getByTestId("incident-close-v1-problem")).toHaveTextContent("begründen");
  expect(apiMock.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByTestId("incident-close-v1-reason"), { target: { value: "Gegner nicht mehr erschienen" } });
  fireEvent.click(screen.getByTestId("incident-close-v1-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/incidents/v1/close", { reason: "Gegner nicht mehr erschienen" }));
});

test("ein geschlossener Vorfall sagt, warum - ohne Knöpfe", async () => {
  const ended = incident({ state: "closed", open: false, close_reason: "match_ended" });
  const byLead = incident({ id: "v2", state: "closed", open: false, close_reason: "lead", close_note: "Gegner nicht mehr erschienen" });
  await show({ ...LEAGUE, incidents: [ended, byLead], incident_info: { ...INFO, can_report: false } });
  expect(screen.getByTestId("incident-state-v1")).toHaveTextContent("Geschlossen");
  expect(screen.getByTestId("incident-sentence-v1")).toHaveTextContent("Das Spiel ist zu Ende – der Vorfall wurde ohne Entscheidung geschlossen.");
  expect(screen.getByTestId("incident-sentence-v2")).toHaveTextContent("Die Liga-Leitung hat den Vorfall ohne Entscheidung geschlossen.");
  expect(screen.getByTestId("incident-close-note-v2")).toHaveTextContent("Gegner nicht mehr erschienen");
  expect(screen.queryByTestId("incident-countdown-v1")).toBeNull();
  expect(screen.queryByTestId("incident-close-v1-open")).toBeNull();
  expect(screen.queryByTestId("incident-answer-v1")).toBeNull();
});

test("wer befangen ist, liest warum - und entscheidet nichts", async () => {
  const row = incident({ state: "in_review", open: true });
  await show({ ...LEAGUE, incidents: [row], incident_info: { ...INFO, can_report: false, conflict: { kind: "involved", override: false } } });
  expect(screen.getByTestId("incident-conflict")).toHaveTextContent("selbst beteiligt");
  expect(screen.queryByTestId("incident-decision-v1")).toBeNull();
  expect(screen.queryByTestId("incident-open-form")).toBeNull();
});

test("ohne Block gibt es keine Fläche; öffentlich steht nur der Stand je Map", async () => {
  await show({ ...LEAGUE, incident_info: null });
  expect(screen.queryByTestId("incident-panel")).toBeNull();
  render(<MapStateNotes league={{ map_state: [{ position: 1, state: "played" }, { position: 2, state: "in_clarification" }, { position: 3, state: "open", surplus: true }] }} />);
  expect(screen.getByTestId("map-state-2")).toHaveTextContent("Map 2 ist in Klärung");
  expect(screen.getByTestId("map-state-3")).toHaveTextContent("Map 3 zählt nicht (Entscheidung der Liga-Leitung)");
  expect(screen.queryByTestId("map-state-1")).toBeNull();
});
