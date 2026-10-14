// Gegner mischen (#1548): „Neu auslosen“ in der Turnierverwaltung, solange keines der betroffenen Spiele begonnen hat.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialogProvider } from "@/components/tls/ConfirmDialog";
import { drawGroupsOf, leagueRedrawAllowed } from "./shared";

const apiMock = { post: vi.fn() };
vi.mock("@/lib/api", () => ({
  api: apiMock,
  formatRequestError: (error, fallback) => error?.response?.data?.detail || fallback,
}));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { DrawControls } = await import("./DrawControls");

const target = (id, extra = {}) => ({
  id,
  match_key: id,
  stage_id: "s-1",
  section: "WB",
  round: 2,
  round_name: "Runde 2",
  status: "ready",
  settings: { draw_group: "WB:2", randomize_advancement_rounds: true },
  draw: { id: "d-1", group: "WB:2", drawn_at: "2026-10-14T10:00:00+00:00" },
  slots: [],
  ...extra,
});
const STAGE = { id: "s-1", stage_type: "single_elimination" };

function renderControls(props) {
  const onChanged = vi.fn();
  render(
    <ConfirmDialogProvider>
      <DrawControls tournamentId="t-1" stage={STAGE} onChanged={onChanged} {...props} />
    </ConfirmDialogProvider>,
  );
  return { onChanged };
}

beforeEach(() => {
  apiMock.post.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

test("Gruppen: ausgelost und noch nicht begonnen heißt neu auslosen erlaubt", () => {
  const groups = drawGroupsOf([target("E"), target("F"), { id: "A", round: 1, settings: {} }]);
  expect(groups).toEqual([expect.objectContaining({ group: "WB:2", label: "Runde 2", drawn: true, canRedraw: true, matchKeys: ["E", "F"] })]);
  const started = drawGroupsOf([target("E"), target("F", { status: "in_progress" })]);
  expect(started[0].canRedraw).toBe(false);
  const called = drawGroupsOf([target("E"), target("F", { called_at: "2026-10-14T10:05:00+00:00" })]);
  expect(called[0].canRedraw).toBe(false);
  const waiting = drawGroupsOf([target("E", { draw: null, status: "pending" }), target("F", { draw: null, status: "pending" })]);
  expect(waiting[0]).toMatchObject({ drawn: false, canRedraw: false });
  // Abgesagte Läufe (Umbau, #1550) zählen nicht mit.
  expect(drawGroupsOf([target("E"), target("F", { status: "cancelled" })])[0].matchKeys).toEqual(["E"]);
});

test("Neu auslosen fragt nach und schickt die Gruppe an den Server", async () => {
  const user = userEvent.setup();
  apiMock.post.mockResolvedValue({ data: { ok: true, draw: { id: "d-2" } } });
  const { onChanged } = renderControls({ matches: [target("E"), target("F")] });
  expect(screen.getByText(/Runde 2/)).toBeInTheDocument();
  await user.click(screen.getByTestId("redraw-WB:2"));
  expect(await screen.findByTestId("confirm-dialog")).toHaveTextContent(/neu auslosen/i);
  await user.click(screen.getByTestId("confirm-dialog-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t-1/stages/s-1/redraw", { group: "WB:2" }));
  expect(onChanged).toHaveBeenCalled();
  expect(toastMock.success).toHaveBeenCalled();
});

test("Abbrechen schickt nichts", async () => {
  const user = userEvent.setup();
  renderControls({ matches: [target("E"), target("F")] });
  await user.click(screen.getByTestId("redraw-WB:2"));
  await user.click(await screen.findByTestId("confirm-dialog-cancel"));
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("Hat die Runde begonnen, gibt es keinen Knopf - nur den Hinweis", () => {
  renderControls({ matches: [target("E"), target("F", { status: "completed", results: [{ rank: 1 }] })] });
  expect(screen.queryByTestId("redraw-WB:2")).toBeNull();
  expect(screen.getByText(/hat begonnen/i)).toBeInTheDocument();
});

test("Vor der Auslosung steht, worauf sie wartet", () => {
  renderControls({ matches: [target("E", { draw: null, status: "pending" }), target("F", { draw: null, status: "pending" })] });
  expect(screen.queryByTestId("redraw-WB:2")).toBeNull();
  expect(screen.getByText(/sobald alle Spiele davor fertig sind/i)).toBeInTheDocument();
});

test("Ablehnung des Servers (409) kommt als Meldung", async () => {
  const user = userEvent.setup();
  apiMock.post.mockRejectedValue({ response: { status: 409, data: { detail: "Runde 2 hat schon begonnen – neu auslosen geht nicht mehr." } } });
  renderControls({ matches: [target("E"), target("F")] });
  await user.click(screen.getByTestId("redraw-WB:2"));
  await user.click(await screen.findByTestId("confirm-dialog-confirm"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Runde 2 hat schon begonnen – neu auslosen geht nicht mehr."));
});

test("Liga: Spieltage neu auslosen nur vor Spieltag 1", async () => {
  const user = userEvent.setup();
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  const day = (id, extra = {}) => ({ id, round: 1, status: "scheduled", settings: { randomize_advancement_rounds: true }, draw: { id: "d", kind: "league" }, ...extra });
  const league = { id: "s-1", stage_type: "league" };
  expect(leagueRedrawAllowed(league, [day("a"), day("b")])).toBe(true);
  expect(leagueRedrawAllowed(league, [day("a"), day("b", { status: "in_progress" })])).toBe(false);
  expect(leagueRedrawAllowed(league, [day("a", { settings: {} })])).toBe(false);
  expect(leagueRedrawAllowed(STAGE, [day("a")])).toBe(false);
  renderControls({ stage: league, matches: [day("a"), day("b")] });
  await user.click(screen.getByTestId("redraw-league"));
  await user.click(await screen.findByTestId("confirm-dialog-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t-1/stages/s-1/redraw", {}));
});

// Show-Auslosung (#1590): die Runde ist bereit, die Leitung lost mit „Jetzt auslosen“ - ohne Rückfrage, der Topf steht.
test("Show: „Auslosung bereit“ mit „Jetzt auslosen“, danach wie jede Auslosung", async () => {
  const user = userEvent.setup();
  apiMock.post.mockResolvedValue({ data: { ok: true, draw: { id: "d-3" } } });
  const show = (id, extra = {}) => target(id, { draw: undefined, status: "pending", settings: { draw_group: "WB:2", advancement_mode: "draw_show" }, draw_ready: { group: "WB:2", since: "2026-10-14T10:00:00+00:00" }, ...extra });
  const groups = drawGroupsOf([show("E"), show("F")]);
  expect(groups[0]).toMatchObject({ mode: "draw_show", ready: true, drawn: false, canRedraw: false });
  // Noch nicht bereit: kein Knopf, der Satz nennt die Leitung.
  renderControls({ matches: [show("E", { draw_ready: null }), show("F", { draw_ready: null })] });
  expect(screen.getByText(/dann lost die Turnierleitung/)).toBeInTheDocument();
  expect(screen.queryByTestId("draw-now-WB:2")).toBeNull();
  cleanup();
  const { onChanged } = renderControls({ matches: [show("E"), show("F")] });
  expect(screen.getByText(/Auslosung bereit/)).toBeInTheDocument();
  expect(screen.queryByTestId("redraw-WB:2")).toBeNull();
  await user.click(screen.getByTestId("draw-now-WB:2"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t-1/stages/s-1/draw", { group: "WB:2" }));
  expect(onChanged).toHaveBeenCalled();
});

// Sofort zufällig (#1590): gezogen wird je Platz; neu auslosen nur für Spiele, die noch nicht begonnen haben.
test("Sofort zufällig: Plätze zählen je Platz, neu auslosen nur für nicht begonnene Spiele", async () => {
  const user = userEvent.setup();
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  const seat = (slot, reg) => ({ slot, status: reg ? "filled" : "pending", registration_id: reg, source: { type: "rank", flow: "W", match_key: "A", rank: 1, draw: { group: "WB:2", label: "Runde 1" } }, source_result: reg ? { from_match_key: "A", draw_id: `dr-${reg}` } : null });
  const instant = (id, slots, extra = {}) => target(id, { draw: undefined, status: "pending", settings: { draw_group: "WB:2", advancement_mode: "instant" }, slots, ...extra });
  const fresh = drawGroupsOf([instant("E", [seat(1), seat(2)]), instant("F", [seat(1), seat(2)])]);
  expect(fresh[0]).toMatchObject({ mode: "instant", drawn: false, assigned: 0, open: 4, canRedraw: false });
  const half = [instant("E", [seat(1, "r1"), seat(2)]), instant("F", [seat(1, "r2"), seat(2, "r3")], { status: "in_progress" })];
  const groups = drawGroupsOf(half);
  expect(groups[0]).toMatchObject({ drawn: true, assigned: 3, open: 1, canRedraw: true, redrawKeys: ["E"] });
  renderControls({ matches: half });
  expect(screen.getByText(/3 von 4 Plätzen gezogen/)).toBeInTheDocument();
  await user.click(screen.getByTestId("redraw-WB:2"));
  expect(await screen.findByTestId("confirm-dialog")).toHaveTextContent("die Spiele E");
  await user.click(screen.getByTestId("confirm-dialog-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t-1/stages/s-1/redraw", { group: "WB:2" }));
  // Alles begonnen: kein Knopf mehr.
  expect(drawGroupsOf([instant("E", [seat(1, "r1"), seat(2, "r4")], { status: "in_progress" }), instant("F", [seat(1, "r2"), seat(2, "r3")], { status: "completed", results: [{ rank: 1 }] })])[0].canRedraw).toBe(false);
});

test("Fester Baum: nichts anzuzeigen", () => {
  const { container } = render(
    <ConfirmDialogProvider>
      <DrawControls tournamentId="t-1" stage={STAGE} matches={[{ id: "A", round: 1, settings: {} }]} onChanged={() => {}} />
    </ConfirmDialogProvider>,
  );
  expect(container.querySelector("[data-testid='draw-controls']")).toBeNull();
});

// Schlimmster Fall (break-ui): 40 Fahrer in 10 Läufen, lange Rundennamen aus zwei Runden, ohne Zeitpunkt.
test("Schlimmster Fall: viele Läufe, lange Rundennamen, fehlender Zeitpunkt", async () => {
  const user = userEvent.setup();
  const keys = Array.from({ length: 10 }, (_, index) => `L${String.fromCharCode(65 + index)}`);
  const heats = keys.map((key, index) => target(key, {
    order: index, section: "LB", round: 7, round_name: "Loser Runde 4 (Winner Runde 3 / Loser Runde 3)",
    settings: { draw_group: "LB:7" }, draw: { id: "d-9", group: "LB:7" },
  }));
  renderControls({ matches: heats });
  expect(screen.getByText("Loser Runde 4 (Winner Runde 3 / Loser Runde 3)")).toBeInTheDocument();
  expect(screen.getByText(/– ausgelost\.$/)).toBeInTheDocument();
  await user.click(screen.getByTestId("redraw-LB:7"));
  expect(await screen.findByTestId("confirm-dialog")).toHaveTextContent("die 10 Spiele dieser Runde");
});
