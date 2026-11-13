import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Reiter „Abschluss“ der Season (F.1, #1645): Checkliste mit Link, Entscheid bei Gleichstand auf Platz 1, Abschließen mit
// Bestätigung, Verlauf und Wieder öffnen durch eine zweite Person. Erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "") }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));

const { SeasonCloseTab } = await import("./SeasonCloseTab");

const row = (index, extra = {}) => ({ registration_id: `r${index}`, display_name: `Probe ${index}`, rank: index, played: 3, won: 4 - index, drawn: 0, lost: index - 1,
  score_for: 8 - index, score_against: index, score_diff: 8 - 2 * index, points: 12 - 3 * index, form: [], ...extra });
const ROWS = [row(1), row(2), row(3), row(4)];
const staffel = (extra = {}) => ({
  tournament_id: "t1", title: "Probe-Liga · Staffel A", staffel: "A", division_label: "Liga 1", status: "live", champion_place: true, own_team: false,
  history: [], closed: false, final: null, standings: ROWS, table_rules: { allow_draws: false, tiebreakers: ["head_to_head", "lead_decision"] },
  blockers: [], ties: [], can_decide: true, champion: { registration_id: "r1", display_name: "Probe 1" }, can_close: true, closed_by_me: false, can_reopen: false, ...extra });
const data = (rows, extra = {}) => ({ season: { id: "s1", closed: false }, can_act: true, superadmin: false, responsible: "„Season konfigurieren“",
  methods: { playoff: "Entscheidungsspiel", lot: "Los", lead: "Entscheid der Leitung" }, staffeln: rows, ...extra });
const FINAL = { id: "f1", version: 1, closed_at: "2026-11-12T17:00:00+00:00", closed_by_name: "Erste Leitung", champion: { registration_id: "r1", display_name: "Probe 1" },
  decisions: [], rules_label: "Fassung 1.0" };
const HISTORY = [{ id: "f1", version: 1, active: true, closed_at: "2026-11-12T17:00:00+00:00", closed_by_name: "Erste Leitung", reopened_at: null, champion: "Probe 1" }];

function renderTab(body, props = {}) {
  apiMock.get.mockImplementation(async (url) => ({ data: url.includes("/final-tables/") ? { standings: ROWS, decisions: [], table_rules: null } : body }));
  return render(<MemoryRouter><SeasonCloseTab seasonId="s1" {...props} /></MemoryRouter>);
}

beforeEach(() => {
  for (const fn of [...Object.values(apiMock), ...Object.values(toastMock)]) fn.mockReset();
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  apiMock.put.mockResolvedValue({ data: { id: "d1" } });
});

test("die Checkliste nennt jeden Sperrgrund mit Link und hält den Knopf zu", async () => {
  renderTab(data([staffel({ can_close: false, blockers: [
    { code: "open_matches", label: "Offene Spiele", text: "Jedes Spiel braucht ein Ergebnis.", count: 2, items: [
      { text: "Spieltag 3: Probe 3 – Probe 4", url: "/matches/m1" }, { text: "Spieltag 3: Probe 1 – Probe 2", url: "/matches/m2" }] },
    { code: "deadlines", label: "Laufende Fristen", text: "Eine Frist läuft.", count: 1, items: [
      { text: "Protestfrist · Spieltag 2: Probe 1 – Probe 3", url: "/matches/m3", until: "2026-11-14T17:00:00+00:00" }] },
  ] })]));
  expect(await screen.findByTestId("season-close-summary")).toHaveTextContent("0 von 1 Staffel abgeschlossen");
  expect(screen.getByTestId("close-state-t1")).toHaveTextContent("2 offen");
  const open = screen.getByTestId("close-blocker-t1-open_matches");
  expect(open).toHaveTextContent("Offene Spiele (2)");
  expect(within(open).getByRole("link", { name: "Spieltag 3: Probe 3 – Probe 4" })).toHaveAttribute("href", "/matches/m1");
  expect(screen.getByTestId("close-blocker-t1-deadlines")).toHaveTextContent("bis 14.11.2026, 18:00");
  expect(screen.getByTestId("close-button-t1")).toBeDisabled();
  expect(screen.getByRole("table", { name: "Vorschau Liga 1 · Staffel A" })).toBeInTheDocument();
});

test("ohne Sperrgrund: abschließen mit Bestätigung, der Meister steht im Fenster", async () => {
  renderTab(data([staffel()]));
  expect(await screen.findByTestId("close-ready-t1")).toHaveTextContent("Alle Spiele sind entschieden");
  expect(screen.getByTestId("close-state-t1")).toHaveTextContent("Bereit zum Abschluss");
  fireEvent.click(screen.getByTestId("close-button-t1"));
  expect(apiMock.post).not.toHaveBeenCalled();
  const sheet = screen.getByTestId("close-sheet");
  expect(within(sheet).getByTestId("close-sheet-champion")).toHaveTextContent("Meister: Probe 1");
  expect(sheet).toHaveTextContent("Eine spätere Regeländerung ändert den Endstand nicht.");
  fireEvent.click(within(sheet).getByTestId("close-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/staffeln/t1/close", { confirm: true }));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Staffel abgeschlossen. Der Endstand steht."));
  expect(apiMock.get).toHaveBeenCalledTimes(2);
});

test("Gleichstand auf Platz 1: der Entscheid braucht Art und Grund", async () => {
  const tie = { rank: 1, registration_ids: ["r1", "r2"], names: ["Probe 1", "Probe 2"], points: 9, own_team: false };
  renderTab(data([staffel({ can_close: false, champion: null, ties: [tie], blockers: [
    { code: "champion_tie", label: "Gleichstand auf Platz 1", text: "Der Meister steht nicht fest.", count: 1, items: [{ text: "Probe 1 – Probe 2", url: "/admin/leagues/seasons/s1#abschluss" }] }] })]),
  { canResults: true });
  fireEvent.click(await screen.findByTestId("close-decide-t1"));
  const sheet = screen.getByTestId("table-decision-sheet");
  fireEvent.change(within(sheet).getByTestId("table-decision-reason"), { target: { value: "Entscheidungsspiel 2:1 gewonnen" } });
  fireEvent.submit(sheet);
  expect(toastMock.error).toHaveBeenCalledWith("Bitte wählen, wie entschieden wurde.");
  expect(apiMock.put).not.toHaveBeenCalled();
  fireEvent.change(within(sheet).getByTestId("table-decision-method"), { target: { value: "playoff" } });
  fireEvent.click(within(sheet).getByTestId("table-decision-down-0"));
  fireEvent.submit(sheet);
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/staffeln/t1/table-decision",
    { registration_ids: ["r2", "r1"], reason: "Entscheidungsspiel 2:1 gewonnen", method: "playoff" }));
});

test("Gleichstand: ohne „Ergebnisse korrigieren“ und über das eigene Team gibt es keinen Knopf, sondern den Grund", async () => {
  const tie = { rank: 1, registration_ids: ["r1", "r2"], names: ["Probe 1", "Probe 2"], points: 9, own_team: true };
  const blockers = [{ code: "champion_tie", label: "Gleichstand auf Platz 1", text: "Der Meister steht nicht fest.", count: 1, items: [] }];
  const view = renderTab(data([staffel({ can_close: false, champion: null, ties: [tie], blockers })]), { canResults: false });
  expect(await screen.findByTestId("close-blocker-t1-champion_tie")).toHaveTextContent("„Ergebnisse korrigieren“");
  expect(screen.queryByTestId("close-decide-t1")).toBeNull();
  view.unmount();
  renderTab(data([staffel({ can_close: false, champion: null, ties: [tie], blockers })]), { canResults: true });
  expect(await screen.findByTestId("close-tie-own-t1")).toHaveTextContent("Über dein eigenes Team entscheidet eine andere Person.");
  view.unmount();
});

test("abgeschlossen: Endstand, Meister und Verlauf - wer abgeschlossen hat, öffnet nicht selbst", async () => {
  renderTab(data([staffel({ closed: true, status: "completed", final: FINAL, history: HISTORY, closed_by_me: true, can_reopen: false, can_close: false })],
    { season: { id: "s1", closed: true } }));
  expect(await screen.findByTestId("season-close-summary")).toHaveTextContent("Die Staffel ist abgeschlossen – die Season ist beendet.");
  expect(screen.getByTestId("close-final-t1")).toHaveTextContent("Abgeschlossen am 12.11.2026, 18:00 von Erste Leitung · Fassung 1 · Regelwerk Fassung 1.0");
  expect(screen.getByTestId("close-final-t1")).toHaveTextContent("Meister: Probe 1");
  expect(screen.getByRole("table", { name: "Endstand Liga 1 · Staffel A" })).toBeInTheDocument();
  expect(screen.queryByTestId("reopen-button-t1")).toBeNull();
  expect(screen.getByTestId("reopen-note-t1")).toHaveTextContent("Wieder öffnen muss eine zweite Person.");
  fireEvent.click(screen.getByTestId("close-version-t1-1"));
  expect(await screen.findByRole("table", { name: "Endstand Fassung 1" })).toBeInTheDocument();
  expect(apiMock.get).toHaveBeenCalledWith("/admin/leagues/staffeln/t1/final-tables/1");
});

test("wieder öffnen: der Grund ist Pflicht; der Superadmin, der selbst abschloss, braucht dazu die Notausnahme", async () => {
  renderTab(data([staffel({ closed: true, final: FINAL, history: HISTORY, closed_by_me: true, can_reopen: true, can_close: false })], { superadmin: true }));
  fireEvent.click(await screen.findByTestId("reopen-button-t1"));
  const sheet = screen.getByTestId("reopen-sheet");
  fireEvent.submit(sheet);
  expect(toastMock.error).toHaveBeenCalledWith("Bitte einen Grund mit mindestens 5 Zeichen angeben.");
  fireEvent.change(within(sheet).getByTestId("reopen-reason"), { target: { value: "Ergebnis war vertauscht" } });
  fireEvent.submit(sheet);
  expect(toastMock.error).toHaveBeenLastCalledWith(expect.stringContaining("selbst abgeschlossen"));
  expect(apiMock.post).not.toHaveBeenCalled();
  fireEvent.change(within(sheet).getByTestId("reopen-emergency-reason"), { target: { value: "Niemand sonst erreichbar" } });
  fireEvent.submit(sheet);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/staffeln/t1/reopen",
    { reason: "Ergebnis war vertauscht", emergency_reason: "Niemand sonst erreichbar" }));
});

test("ohne die Zuständigkeit: lesen ja, Knöpfe nein - mit dem Satz, wer es darf", async () => {
  renderTab(data([staffel({ can_close: false }), staffel({ tournament_id: "t2", staffel: "B", closed: true, final: FINAL, history: HISTORY, can_close: false })],
    { can_act: false }));
  expect(await screen.findByTestId("close-readonly-t1")).toHaveTextContent("wer „Season konfigurieren“ hat");
  expect(screen.queryByTestId("close-button-t1")).toBeNull();
  expect(screen.queryByTestId("reopen-button-t2")).toBeNull();
  expect(screen.queryByTestId("reopen-note-t2")).toBeNull();
});

test("das eigene Team in der Staffel: abschließen macht eine andere Person", async () => {
  renderTab(data([staffel({ own_team: true, can_close: false })]));
  expect(await screen.findByTestId("close-own-t1")).toHaveTextContent("Über dein eigenes Team entscheidet eine andere Person.");
  expect(screen.queryByTestId("close-button-t1")).toBeNull();
});

test("ein abgelehnter Abschluss lädt die Karte neu und sagt, warum", async () => {
  apiMock.post.mockRejectedValue({ response: { data: { detail: "Abschließen geht noch nicht: Offene Verfahren." } } });
  renderTab(data([staffel()]));
  fireEvent.click(await screen.findByTestId("close-button-t1"));
  fireEvent.click(screen.getByTestId("close-confirm"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Abschließen geht noch nicht: Offene Verfahren."));
  await waitFor(() => expect(screen.queryByTestId("close-sheet")).toBeNull());
  expect(apiMock.get).toHaveBeenCalledTimes(2);
});

test("ein abgebrochener Abschluss steht ehrlich da: kein Abschließen, Wieder öffnen gibt die Staffel frei", async () => {
  renderTab(data([staffel({ status: "completed", incomplete: true, can_close: false, can_reopen: true, champion: null, blockers: [
    { code: "incomplete_close", label: "Abschluss unvollständig", text: "Der Abschluss wurde nicht fertig geschrieben.", count: 0, items: [] },
  ] })]));
  expect(await screen.findByTestId("close-state-t1")).toHaveTextContent("Unvollständig");
  expect(screen.getByTestId("close-blocker-t1-incomplete_close")).toHaveTextContent("Abschluss unvollständig");
  expect(screen.queryByTestId("close-button-t1")).toBeNull();
  fireEvent.click(screen.getByTestId("reopen-button-t1"));
  const sheet = screen.getByTestId("reopen-sheet");
  expect(sheet).toHaveTextContent("einen Endstand gibt es nicht");
  fireEvent.change(within(sheet).getByTestId("reopen-reason"), { target: { value: "Abschluss brach ab" } });
  fireEvent.click(within(sheet).getByTestId("reopen-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/staffeln/t1/reopen", { reason: "Abschluss brach ab" }));
});

test("Gleichstand an der Grenze zu Auf- oder Abstieg (F.2, #1627): eigener Knopf je Platz, Zonen und Legende an der Tabelle", async () => {
  const zoneTie = { kind: "zone", rank: 3, registration_ids: ["r3", "r4"], names: ["Probe 3", "Probe 4"], points: 3, own_team: false };
  const rows = [row(1, { zone: "promotion" }), row(2), row(3, { rank: 3, zone: "relegation" }), row(4, { rank: 3 })];
  renderTab(data([staffel({ champion_place: false, champion: null, can_close: false, standings: rows, ties: [zoneTie], zones_label: "1 Aufsteiger · 1 Absteiger",
    blockers: [{ code: "zone_tie", label: "Gleichstand an der Grenze zu Auf- oder Abstieg", text: "Teams stehen gleich.", count: 1,
      items: [{ text: "Probe 3 – Probe 4", url: "/admin/leagues/seasons/s1#abschluss" }] }] })]), { canResults: true });
  expect(await screen.findByTestId("close-zones-t1")).toHaveTextContent("1 Aufsteiger · 1 Absteiger");
  // Kein Link auf die eigene Seite, sondern die Namen - wie beim Meister.
  expect(within(screen.getByTestId("close-blocker-t1-zone_tie")).queryByRole("link")).toBeNull();
  expect(screen.queryByTestId("close-decide-t1")).toBeNull();
  fireEvent.click(screen.getByTestId("close-decide-zone-t1-3"));
  expect(within(screen.getByTestId("table-decision-sheet")).getAllByText(/Probe 3/).length).toBeGreaterThan(0);
  expect(screen.getByRole("list", { name: "Zonen der Tabelle" })).toHaveTextContent(/Aufstieg.*Abstieg/);
});


test("Wieder öffnen mit schon angelegter neuer Season (F.2, Nr. 162): deutlicher Hinweis aufs Neuberechnen", async () => {
  const closed = staffel({ closed: true, status: "completed", final: { ...FINAL, champion: null }, history: HISTORY, can_close: false, can_reopen: true });
  const view = renderTab(data([closed], { successor: { id: "s2", name: "Season 2" } }));
  fireEvent.click(await screen.findByTestId("reopen-button-t1"));
  expect(screen.getByTestId("reopen-successor")).toHaveTextContent("Es gibt schon die neue Season Season 2. Nach dem neuen Abschluss die Übernahme dort neu berechnen.");
  view.unmount();
  // Gegenprobe: ohne neue Season kein Hinweis.
  renderTab(data([closed]));
  fireEvent.click(await screen.findByTestId("reopen-button-t1"));
  expect(screen.queryByTestId("reopen-successor")).toBeNull();
});
