import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Liga-Check-in (#1652): geführter Ablauf - Anwesende anhaken mit Mindestzahl und Grund je gesperrtem Spieler, Einchecken, Stand der
// Gegenseite, Regelwerks-Sperre, Start genau dann, wenn beide da sind, Vorschlag und Notfall-Eintrag der Leitung. Erfundene Namen.

const apiMock = { post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { CheckinPanel } = await import("./CheckinPanel");

const RULES = { opens_minutes_before: 15, closes_minutes_after: 15, min_present: 2, remind_minutes_before_close: 5 };
const LATER = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const WINDOW = { opens_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), closes_at: LATER };
const ROSTER = [
  { id: "u1", name: "Mila", blocked: null },
  { id: "u2", name: "Tom", blocked: null },
  { id: "u3", name: "Ida", blocked: "Das Konto ist gesperrt." },
];
const OWN = { registration_id: "a", name: "Löwen · Rudel A", own: true, checked_in: false, present: [], present_count: 0, consent_open: false };
const OTHER = { registration_id: "b", name: "Falken · Horst", own: false, checked_in: false, present: [], present_count: 0, consent_open: false };
const BLOCK = {
  rules: RULES, state: "open", scheduled_at: LATER, window: WINDOW, ready_at: null, started_at: null, sides: [OWN, OTHER],
  own_registration_id: "a", can_checkin: true, checkin_hint: null, roster: ROSTER, min_present: 2, can_start: false,
  start_hint: "Starten geht erst, wenn beide Seiten eingecheckt sind.", proposal: null, lead: null,
};

function renderPanel(block, props = {}) {
  const run = async (task) => { await task(); return true; };
  return render(
    <MemoryRouter>
      <CheckinPanel block={block} matchId="m1" busy={false} run={run} onChanged={async () => {}} leadUrl="/tournaments/t1/leitung?fall=ns-m1" {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { ready: false } });
});

test("offen: anhaken bis zur Mindestzahl, gesperrte stehen grau mit Grund, dann Einchecken", async () => {
  renderPanel(BLOCK);
  expect(screen.getByTestId("checkin-headline")).toHaveTextContent("Check-in offen");
  expect(screen.getByTestId("checkin-text")).toHaveTextContent("mindestens 2");
  expect(screen.getByTestId("checkin-countdown-text")).toHaveTextContent(/^\d+:\d\d$/);
  const blocked = screen.getByTestId("checkin-roster-u3");
  expect(blocked).toBeDisabled();
  expect(screen.getByTestId("checkin-roster")).toHaveTextContent("Das Konto ist gesperrt.");
  const submit = screen.getByTestId("checkin-submit");
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByTestId("checkin-roster-u1"));
  expect(screen.getByTestId("checkin-roster-count")).toHaveTextContent("noch eine Person");
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByTestId("checkin-roster-u2"));
  expect(screen.getByTestId("checkin-roster-count")).toHaveTextContent("das reicht");
  fireEvent.click(submit);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/checkin", { present: ["u1", "u2"] }));
  expect(screen.getByTestId("checkin-side-status-b")).toHaveTextContent("noch nicht eingecheckt");
});

test("eingecheckt: Anwesende sichtbar, Haken gesetzt, Warten auf die Gegenseite, ergänzen bleibt möglich", () => {
  const own = { ...OWN, checked_in: true, at: "2026-11-14T18:52:00+00:00", present: [{ id: "u1", name: "Mila" }, { id: "u2", name: "Tom" }], present_count: 2 };
  renderPanel({ ...BLOCK, sides: [own, OTHER] });
  expect(screen.getByTestId("checkin-side-a")).toHaveAttribute("data-checked", "true");
  expect(within(screen.getByTestId("checkin-side-a")).getByText("Mila")).toBeInTheDocument();
  expect(screen.getByTestId("checkin-text")).toHaveTextContent("jetzt fehlt noch Falken · Horst");
  expect(screen.getByTestId("checkin-waiting")).toHaveTextContent("Falken · Horst");
  expect(screen.getByTestId("checkin-roster-u1")).toBeChecked();
  expect(screen.getByTestId("checkin-submit")).toHaveTextContent("Anwesende aktualisieren");
});

test("Regelwerks-Sperre: deutlicher Hinweis mit Weg zur Fassung statt Knopf", () => {
  const own = { ...OWN, consent_open: true, rules_url: "/liga/probeliga/season-1/regeln" };
  renderPanel({ ...BLOCK, sides: [own, OTHER], can_checkin: false, checkin_hint: "Das Regelwerk hat sich geändert – bitte erst zustimmen." });
  expect(screen.queryByTestId("checkin-submit")).toBeNull();
  expect(screen.getByTestId("checkin-hint")).toHaveTextContent("Das Regelwerk hat sich geändert");
  expect(screen.getByTestId("checkin-rules-link")).toHaveAttribute("href", "/liga/probeliga/season-1/regeln");
  expect(screen.getByTestId("checkin-consent-a")).toHaveTextContent("bitte erst zustimmen");
});

test("geschlossen: der Weg zur Leitung, der Vorschlag steht da", () => {
  renderPanel({ ...BLOCK, state: "closed", can_checkin: false, checkin_hint: "Der Check-in ist seit Sa 14.11. 20:15 geschlossen – das entscheidet die Liga-Leitung. Bitte im Matchchat @leitung schreiben.",
    proposal: { due_at: LATER, missing: ["Falken · Horst"] } }, { onAskLead: vi.fn() });
  expect(screen.getByTestId("checkin-headline")).toHaveTextContent("Check-in geschlossen");
  expect(screen.getByTestId("checkin-hint")).toHaveTextContent("geschlossen");
  expect(screen.getByRole("button", { name: "@leitung schreiben" })).toBeInTheDocument();
  expect(screen.getByTestId("checkin-proposal")).toHaveTextContent("Falken · Horst hat nicht eingecheckt");
  expect(screen.queryByTestId("checkin-proposal-decide")).toBeNull();
  expect(screen.queryByTestId("checkin-countdown")).toBeNull();
});

test("beide da: Spiel starten; der zweite Klick kommt nicht mehr an", async () => {
  const both = [{ ...OWN, checked_in: true, present_count: 2 }, { ...OTHER, checked_in: true, present_count: 3 }];
  renderPanel({ ...BLOCK, state: "ready", sides: both, can_start: true, start_hint: null, ready_at: LATER });
  expect(screen.getByTestId("checkin-headline")).toHaveTextContent("Spielbereit");
  expect(screen.queryByTestId("checkin-own")).toBeNull();
  fireEvent.click(screen.getByTestId("checkin-start-button"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/checkin/start", {}));
});

test("beide da, aber eine Seite muss erst zustimmen: kein Start, der Satz nennt die Seite", () => {
  const both = [{ ...OWN, checked_in: true }, { ...OTHER, checked_in: true, consent_open: true }];
  renderPanel({ ...BLOCK, state: "ready", sides: both, can_start: false, start_hint: "Falken · Horst: Das Regelwerk hat sich geändert – bitte erst zustimmen." });
  expect(screen.queryByTestId("checkin-start-button")).toBeNull();
  expect(screen.getByTestId("checkin-start-hint")).toHaveTextContent("Falken · Horst");
  expect(screen.getByTestId("checkin-consent-b")).toHaveTextContent("diese Seite muss erst zustimmen");
});

test("läuft: nur noch der Stand", () => {
  renderPanel({ ...BLOCK, state: "running", started_at: "2026-11-14T19:02:00+00:00", can_checkin: false, checkin_hint: "Das Spiel läuft schon." });
  expect(screen.getByTestId("checkin-headline")).toHaveTextContent("Spiel läuft");
  expect(screen.queryByTestId("checkin-own")).toBeNull();
  expect(screen.queryByTestId("checkin-start")).toBeNull();
});

test("Leitung: für eine Seite eintragen mit Grund, Weg zur Entscheidung beim Vorschlag", async () => {
  const lead = { can_enter: true, conflict: null, rosters: { a: ROSTER, b: [{ id: "f1", name: "Falke1", blocked: null }, { id: "f2", name: "Falke2", blocked: null }] } };
  renderPanel({ ...BLOCK, state: "closed", own_registration_id: null, roster: [], can_checkin: false, checkin_hint: null,
    sides: [{ ...OWN, own: false, checked_in: true, present_count: 2 }, OTHER], proposal: { due_at: LATER, missing: ["Falken · Horst"] }, lead });
  expect(screen.getByTestId("checkin-proposal-decide")).toHaveAttribute("href", "/tournaments/t1/leitung?fall=ns-m1");
  expect(screen.getByTestId("checkin-lead-side-b")).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByTestId("checkin-lead-submit"));
  expect(screen.getByTestId("checkin-lead-problem")).toHaveTextContent("mindestens 2");
  fireEvent.click(screen.getByTestId("checkin-lead-roster-f1"));
  fireEvent.click(screen.getByTestId("checkin-lead-roster-f2"));
  fireEvent.click(screen.getByTestId("checkin-lead-submit"));
  expect(screen.getByTestId("checkin-lead-problem")).toHaveTextContent("Grund");
  fireEvent.change(screen.getByTestId("checkin-lead-reason"), { target: { value: "Captain ohne Netz, per Telefon" } });
  fireEvent.click(screen.getByTestId("checkin-lead-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/checkin",
    { present: ["f1", "f2"], registration_id: "b", reason: "Captain ohne Netz, per Telefon" }));
});

test("Superadmin im eigenen Spiel: Notausnahme braucht den zweiten Grund", async () => {
  const lead = { can_enter: true, conflict: { kind: "involved", override: true }, rosters: { a: ROSTER, b: [{ id: "f1", name: "Falke1", blocked: null }, { id: "f2", name: "Falke2", blocked: null }] } };
  renderPanel({ ...BLOCK, own_registration_id: null, roster: [], can_checkin: false, lead });
  expect(screen.getByTestId("checkin-lead-conflict")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("checkin-lead-side-b"));
  fireEvent.click(screen.getByTestId("checkin-lead-roster-f1"));
  fireEvent.click(screen.getByTestId("checkin-lead-roster-f2"));
  fireEvent.change(screen.getByTestId("checkin-lead-reason"), { target: { value: "Grund genug" } });
  fireEvent.click(screen.getByTestId("checkin-lead-submit"));
  expect(screen.getByTestId("checkin-lead-problem")).toHaveTextContent("Notausnahme");
  fireEvent.change(screen.getByTestId("checkin-lead-conflict-reason"), { target: { value: "Niemand sonst da" } });
  fireEvent.click(screen.getByTestId("checkin-lead-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/checkin", expect.objectContaining({ conflict_reason: "Niemand sonst da" })));
});

test("Superadmin im eigenen Spiel startet nur als Notausnahme mit Grund", async () => {
  const lead = { can_enter: true, conflict: { kind: "involved", override: true }, rosters: {} };
  const both = [{ ...OWN, own: false, checked_in: true, present_count: 2 }, { ...OTHER, checked_in: true, present_count: 3 }];
  renderPanel({ ...BLOCK, state: "ready", own_registration_id: null, roster: [], can_checkin: false, sides: both, can_start: true, start_hint: null, ready_at: LATER, lead });
  expect(screen.getByTestId("checkin-start-conflict")).toHaveTextContent("Notausnahme");
  fireEvent.click(screen.getByTestId("checkin-start-button"));
  expect(screen.getByTestId("checkin-start-problem")).toHaveTextContent("Grund");
  expect(apiMock.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByTestId("checkin-start-conflict-reason"), { target: { value: "Niemand sonst da" } });
  fireEvent.click(screen.getByTestId("checkin-start-button"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/checkin/start", { conflict_reason: "Niemand sonst da" }));
});

test("ohne Block nichts", () => {
  const { container } = renderPanel(null);
  expect(container).toBeEmptyDOMElement();
});
