import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Reiter „Abschluss“ der Season (F.1, #1645): Checkliste mit Link, Entscheid bei Gleichstand auf Platz 1, Abschließen mit
// Bestätigung, Verlauf und Wieder öffnen durch eine zweite Person. Erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
// Wie oft der Reiter den Abschluss geladen hat - ohne die eigene Abfrage des TV-Kastens (#1641).
const closingLoads = () => apiMock.get.mock.calls.filter(([url]) => String(url).endsWith("/closing")).length;
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

const POSTSEASON_OFF = { season: { id: "s1", name: "Season 1" }, settings: {}, configured: false, can_act: false, superadmin: false, options: {}, missing: [], divisions: [] };

function renderTab(body, props = {}) {
  // Der Kasten „Saisonfinale am TV“ (#1641) lädt seinen Stand selbst.
  apiMock.get.mockImplementation(async (url) => ({ data: url.includes("/tv-finale") ? { step: 0, count: 0, labels: [], closed: 0, reason: "none_closed" }
    : url.includes("/final-tables/") ? { standings: ROWS, decisions: [], table_rules: null }
      // Playoffs und Relegation (#2404) laden ihr Cockpit ebenfalls selbst - hier: nichts eingestellt.
      : url.endsWith("/postseason") ? POSTSEASON_OFF : body }));
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
  expect(closingLoads()).toBe(2);
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
  expect(closingLoads()).toBe(2);
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

test("Belohnungen (F.4): Anzahl und - ohne gemeldete Aufstellung - der Hinweis auf den Kader (Nr. 167)", async () => {
  renderTab(data([staffel({ closed: true, status: "completed", final: FINAL, history: HISTORY, can_close: false, rewards: 6, rewards_roster_fallback: ["Probe 3"] }),
    staffel({ tournament_id: "t2", staffel: "B", closed: true, final: FINAL, history: HISTORY, can_close: false, rewards: 2, rewards_roster_fallback: [] })]));
  expect(await screen.findByTestId("close-rewards-t1")).toHaveTextContent("6 Belohnungen vergeben");
  expect(screen.getByTestId("close-rewards-fallback-t1")).toHaveTextContent("Kader statt Einsatz, weil keine Aufstellungen gemeldet: Probe 3.");
  expect(screen.queryByTestId("close-rewards-fallback-t2")).toBeNull();
});

test("Nachmeldung (#2422): eine offene Nachmeldung steht als Hinweis mit Link da, der Abschluss bleibt möglich", async () => {
  renderTab(data([staffel({ hints: [{ code: "late_entry_open", label: "Nachmeldung nicht entschieden", text: "Kein Sperrgrund.", count: 1,
    items: [{ text: "Probe 5", url: "/admin/leagues/seasons/s1#nachmeldungen" }] }] })]));
  const hint = await screen.findByTestId("close-hint-t1-late_entry_open");
  expect(hint).toHaveTextContent("Nachmeldung nicht entschieden");
  expect(within(hint).getByRole("link", { name: "Probe 5" })).toHaveAttribute("href", "/admin/leagues/seasons/s1#nachmeldungen");
  expect(screen.getByTestId("close-ready-t1")).toBeInTheDocument();
  expect(screen.getByTestId("close-button-t1")).not.toBeDisabled();
});

// Plätze über Staffeln hinweg (#1627): Kandidaten mit Schnitt je Spiel, Gleichstand an der Grenze, Entscheid ohne Los.
const candidate = (id, name, staffel, extra = {}) => ({ registration_id: id, display_name: name, tournament_id: `t-${staffel}`, staffel, rank: 2, played: 3, points: 6,
  score_diff: 2, points_per_game: 2, map_diff_per_game: 0.667, chosen: false, tied: false, ...extra });
const side = (extra = {}) => ({ kind: "promote_best", label: "Aufstieg über den Vergleich der Staffeln", count: 1, zone: "promotion", tie: null, decision: null, own_team: false,
  candidates: [candidate("ra", "Probe Rot", "A", { chosen: true }), candidate("rb", "Probe Blau", "B", { points_per_game: 1.5, map_diff_per_game: 0 })], ...extra });
const cross = (sides, extra = {}) => ({ cross: [{ division_id: "d2", label: "Liga 2", final: false, sides, ...extra }], cross_methods: { playoff: "Entscheidungsspiel", lead: "Entscheid der Leitung" } });
const TIE = { kind: "promote_best", open: 1, registration_ids: ["ra", "rb"], names: ["Probe Rot", "Probe Blau"], staffeln: ["A", "B"] };
const tiedSide = (extra = {}) => side({ tie: TIE, candidates: [candidate("ra", "Probe Rot", "A", { tied: true }), candidate("rb", "Probe Blau", "B", { tied: true })], ...extra });

test("ohne die Regel steht nichts über Staffeln hinweg da", async () => {
  renderTab(data([staffel()]));
  await screen.findByTestId("season-close-summary");
  expect(screen.queryByTestId("season-cross-zones")).toBeNull();
});

test("Kandidaten über Staffeln hinweg: Schnitt je Spiel, wer aufsteigt, und dass es erst nach allen Abschlüssen gilt", async () => {
  renderTab(data([staffel()], cross([side()])));
  const section = await screen.findByTestId("cross-division-d2");
  expect(section).toHaveTextContent("Liga 2 · Plätze über Staffeln hinweg");
  expect(screen.getByTestId("cross-status-d2")).toHaveTextContent("Stand von jetzt. Fest steht es erst, wenn alle Staffeln dieser Liga abgeschlossen sind");
  expect(screen.getByTestId("cross-candidate-ra")).toHaveTextContent("Probe RotStaffel A, Platz 2 · 2,00 Punkte je Spiel · +0,67 Maps je Spielsteigt auf");
  expect(screen.getByTestId("cross-candidate-rb")).toHaveTextContent("1,50 Punkte je Spiel · 0,00 Maps je Spiel");
  expect(screen.getByTestId("cross-candidate-rb")).not.toHaveTextContent("steigt auf");
  expect(screen.queryByTestId("cross-tie-d2-promote_best")).toBeNull();
});

test("Gleichstand zwischen Staffeln: entscheiden mit genau einem Team, Art und Grund - ein Los steht nicht zur Wahl", async () => {
  renderTab(data([staffel()], cross([tiedSide()])), { canResults: true });
  expect(await screen.findByTestId("cross-tie-d2-promote_best")).toHaveTextContent("Probe Rot – Probe Blau. Nur einer bekommt den Platz.");
  fireEvent.click(screen.getByTestId("cross-decide-d2-promote_best"));
  const sheet = await screen.findByTestId("cross-decision-sheet");
  const methods = Array.from(within(sheet).getByTestId("cross-decision-method").querySelectorAll("option")).map((option) => option.textContent);
  expect(methods).toEqual(["Bitte wählen …", "Entscheidungsspiel", "Entscheid der Leitung"]);
  const save = within(sheet).getByTestId("cross-decision-save");
  expect(save).toBeDisabled();
  fireEvent.click(within(sheet).getByTestId("cross-decision-pick-rb"));
  fireEvent.change(within(sheet).getByTestId("cross-decision-method"), { target: { value: "playoff" } });
  fireEvent.change(within(sheet).getByTestId("cross-decision-reason"), { target: { value: "ja" } });
  expect(save).toBeDisabled();
  fireEvent.change(within(sheet).getByTestId("cross-decision-reason"), { target: { value: "Entscheidungsspiel 3:1" } });
  // Zwei gewählt, aber nur ein Platz: geht nicht.
  fireEvent.click(within(sheet).getByTestId("cross-decision-pick-ra"));
  expect(save).toBeDisabled();
  fireEvent.click(within(sheet).getByTestId("cross-decision-pick-ra"));
  fireEvent.click(save);
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/divisions/d2/zone-decision",
    { kind: "promote_best", registration_ids: ["rb"], method: "playoff", reason: "Entscheidungsspiel 3:1" }));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Entscheid gespeichert."));
});

test("Gleichstand zwischen Staffeln: ohne das Recht nur der Hinweis, beim eigenen Team eine andere Person", async () => {
  const { unmount } = renderTab(data([staffel()], cross([tiedSide()])));
  expect(await screen.findByTestId("cross-tie-d2-promote_best")).toHaveTextContent("Den Entscheid trifft, wer in dieser Liga „Ergebnisse korrigieren“ darf.");
  expect(screen.queryByTestId("cross-decide-d2-promote_best")).toBeNull();
  unmount();
  renderTab(data([staffel()], cross([tiedSide({ own_team: true })])), { canResults: true });
  expect(await screen.findByTestId("cross-own-d2-promote_best")).toHaveTextContent("Über dein eigenes Team entscheidet eine andere Person.");
  expect(screen.queryByTestId("cross-decide-d2-promote_best")).toBeNull();
});

test("ein Entscheid steht mit Art und Grund da und lässt sich mit Grund zurücknehmen", async () => {
  apiMock.delete = vi.fn().mockResolvedValue({ data: { ok: true } });
  const decided = side({ candidates: [candidate("rb", "Probe Blau", "B", { chosen: true }), candidate("ra", "Probe Rot", "A")],
    decision: { registration_ids: ["rb"], names: ["Probe Blau"], method: "playoff", method_label: "Entscheidungsspiel", reason: "3:1 gewonnen", decided_at: "2026-11-23T17:00:00+00:00" } });
  renderTab(data([staffel()], cross([decided], { final: true })), { canResults: true });
  expect(await screen.findByTestId("cross-decision-d2-promote_best")).toHaveTextContent("Entscheid: Probe Blau – Entscheidungsspiel: 3:1 gewonnen");
  expect(screen.getByTestId("cross-status-d2")).toHaveTextContent("Alle Staffeln dieser Liga sind abgeschlossen");
  fireEvent.click(screen.getByTestId("cross-clear-d2-promote_best"));
  const sheet = await screen.findByTestId("cross-clear-sheet");
  expect(within(sheet).getByTestId("cross-clear-save")).toBeDisabled();
  fireEvent.change(within(sheet).getByTestId("cross-clear-reason"), { target: { value: "Spiel wird wiederholt" } });
  fireEvent.click(within(sheet).getByTestId("cross-clear-save"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/admin/leagues/divisions/d2/zone-decision/promote_best", { data: { reason: "Spiel wird wiederholt" } }));
});

test("der Sperrgrund „Gleichstand zwischen den Staffeln“ nennt die Teams ohne toten Link und hält den Knopf zu", async () => {
  renderTab(data([staffel({ can_close: false, blockers: [{ code: "zone_cross_tie", label: "Gleichstand zwischen den Staffeln", count: 1,
    text: "Vor dem Abschluss der letzten Staffel braucht es einen begründeten Entscheid.", items: [{ text: "Probe Rot – Probe Blau", url: "/admin/leagues/seasons/s1#abschluss" }] }] })],
  cross([tiedSide()])), { canResults: true });
  const blocker = await screen.findByTestId("close-blocker-t1-zone_cross_tie");
  expect(blocker).toHaveTextContent("Probe Rot – Probe Blau");
  expect(within(blocker).queryByRole("link")).toBeNull();
  expect(screen.getByTestId("close-button-t1")).toBeDisabled();
  expect(screen.getByTestId("cross-decide-d2-promote_best")).toBeInTheDocument();
});

// Fix-Runde (#1627): Zurücknehmen folgt denselben Regeln wie das Entscheiden, der Unterlegene trägt „bleibt“.
const DECISION = { registration_ids: ["rb"], names: ["Probe Blau"], tied: ["ra", "rb"], method: "playoff", method_label: "Entscheidungsspiel", reason: "3:1 gewonnen" };
const decidedSide = (extra = {}) => side({ decision: DECISION,
  candidates: [candidate("rb", "Probe Blau", "B", { chosen: true }), candidate("ra", "Probe Rot", "A", { passed: true })], ...extra });

test("nach dem Entscheid: der Gewählte steigt auf, der Unterlegene bleibt", async () => {
  renderTab(data([staffel()], cross([decidedSide()])), { canResults: true });
  expect(await screen.findByTestId("cross-candidate-rb")).toHaveTextContent("steigt auf");
  expect(screen.getByTestId("cross-candidate-ra")).toHaveTextContent("bleibt");
});

test("beim eigenen Team gibt es kein „Zurücknehmen“, sondern den Hinweis auf eine andere Person", async () => {
  renderTab(data([staffel()], cross([decidedSide({ own_team: true })])), { canResults: true });
  expect(await screen.findByTestId("cross-clear-own-d2-promote_best")).toHaveTextContent("Über dein eigenes Team entscheidet eine andere Person.");
  expect(screen.queryByTestId("cross-clear-d2-promote_best")).toBeNull();
});

test("der Superadmin nimmt beim eigenen Team nur mit dem Grund der Notausnahme zurück", async () => {
  apiMock.delete = vi.fn().mockResolvedValue({ data: { ok: true } });
  renderTab(data([staffel()], { ...cross([decidedSide({ own_team: true })]), superadmin: true }), { canResults: true });
  fireEvent.click(await screen.findByTestId("cross-clear-d2-promote_best"));
  const sheet = await screen.findByTestId("cross-clear-sheet");
  fireEvent.change(within(sheet).getByTestId("cross-clear-reason"), { target: { value: "Spiel wird wiederholt" } });
  expect(within(sheet).getByTestId("cross-clear-save")).toBeDisabled();
  fireEvent.change(within(sheet).getByTestId("cross-clear-conflict"), { target: { value: "Niemand sonst erreichbar" } });
  fireEvent.click(within(sheet).getByTestId("cross-clear-save"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/admin/leagues/divisions/d2/zone-decision/promote_best",
    { data: { reason: "Spiel wird wiederholt", conflict_reason: "Niemand sonst erreichbar" } }));
});


// ---------------------------------------------------------------- Playoffs und Relegation (#2404, F.6)

test("eine Playoff-Staffel zeigt Plätze aus dem Baum statt einer Tabelle und heißt „Playoffs“", async () => {
  const standings = [
    { registration_id: "p1", display_name: "Probe 1", rank: 1, reached: "Finale" }, { registration_id: "p2", display_name: "Probe 2", rank: 2, reached: "Finale" },
    { registration_id: "p3", display_name: "Probe 3", rank: 3, reached: "Halbfinale" }, { registration_id: "p4", display_name: "Probe 4", rank: 3, reached: "Halbfinale", exit: { kind: "withdrawn" } }];
  renderTab(data([staffel({ tournament_id: "po1", staffel: "PO", kind: "playoff", label: "Playoffs", standings, table_rules: null, champion: { registration_id: "p1", display_name: "Probe 1" } })]));
  expect(await screen.findByRole("heading", { name: "Liga 1 · Playoffs" })).toBeInTheDocument();
  const list = screen.getByTestId("close-placements-po1");
  expect(within(list).getAllByRole("listitem")).toHaveLength(4);
  expect(list).toHaveTextContent("Probe 4");
  expect(list).toHaveTextContent("Halbfinale · zurückgezogen");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("close-button-po1"));
  expect(within(screen.getByTestId("close-sheet")).getByTestId("close-sheet-champion")).toHaveTextContent("Meister: Probe 1");
});

test("die Relegation zeigt je Team Ergebnis und Wirkung - und sagt im Fenster, wofür das Ergebnis gilt", async () => {
  const standings = [
    { registration_id: "u1", display_name: "Probe Oben", rank: 0, side: "upper", result: "lost", outcome_label: "steigt ab" },
    { registration_id: "l1", display_name: "Probe Unten", rank: 0, side: "lower", result: "won", outcome_label: "steigt auf" }];
  renderTab(data([staffel({ tournament_id: "rel1", staffel: "REL", kind: "relegation", label: "Relegation", standings, table_rules: null, champion_place: false, champion: null })]));
  expect(await screen.findByTestId("close-placements-rel1")).toHaveTextContent("obere Liga · verloren · steigt ab");
  expect(screen.getByTestId("close-placements-rel1")).toHaveTextContent("untere Liga · gewonnen · steigt auf");
  fireEvent.click(screen.getByTestId("close-button-rel1"));
  expect(screen.getByTestId("close-sheet-relegation")).toHaveTextContent("Auf- und Abstieg der nächsten Season");
});

test("Gleichstand an der Playoff-Grenze: entscheiden wie an einer Zonengrenze", async () => {
  const tie = { kind: "playoff", rank: 2, registration_ids: ["r2", "r3"], names: ["Probe 2", "Probe 3"], points: 6, own_team: false };
  renderTab(data([staffel({ can_close: false, ties: [tie], blockers: [
    { code: "playoff_tie", label: "Gleichstand an der Playoff-Grenze", text: "Nur ein Teil kommt in die Playoffs.", count: 1, items: [{ text: "Probe 2 – Probe 3", url: "#abschluss" }] }] })]),
  { canResults: true });
  expect(await screen.findByTestId("close-blocker-t1-playoff_tie")).toHaveTextContent("Gleichstand an der Playoff-Grenze");
  expect(screen.getByTestId("close-decide-playoff-t1-2")).toHaveTextContent("Playoff-Platz entscheiden");
});

test("fehlen eingestellte Playoffs noch, ist die Season nicht beendet", async () => {
  renderTab(data([staffel({ closed: true, final: FINAL, history: HISTORY, can_close: false })],
    { postseason_missing: [{ kind: "playoff", division_id: "d1", text: "Die Playoffs von Liga 1 sind noch nicht angelegt." }] }));
  expect(await screen.findByTestId("season-close-summary")).toHaveTextContent("Die Playoffs von Liga 1 sind noch nicht angelegt. Solange läuft die Season weiter.");
});

// Startrechte (#1627, docs/LIGA.md „F.2a“): Die Nachricht zum bestätigten Auf- und Abstieg stellt man vor dem Abschluss ein - der Weg dorthin.
test("der Abschluss zeigt den Weg zu den Startrechten", async () => {
  renderTab(data([staffel()]));
  const link = await screen.findByTestId("season-close-start-rights");
  expect(link).toHaveAttribute("href", "/#startrechte");
  expect(link).toHaveTextContent("Startrechte");
});
