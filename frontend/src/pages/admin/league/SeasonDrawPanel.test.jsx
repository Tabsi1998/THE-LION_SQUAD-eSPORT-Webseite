import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Staffeln auslosen (docs/LIGA.md, B.4, #1623): Platzprüfung, Vorschau des Loses, Tausch mit Grund, Übernehmen. Nur erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { SeasonDrawPanel } = await import("./SeasonDrawPanel");

const AT = "2026-11-23T13:05:00+00:00";
const DRAW = {
  id: "draw1", seed: "3f9a6c01d2e4b587", number: 1, status: "draft", stale: false, fingerprint: "fp1", created_at: AT, applied_at: null,
  staffeln: [
    { tournament_id: "t1", staffel: "A", capacity: 8, seated: ["Probe Alt · Eins"], size: 3,
      teams: [{ squad_id: "s1", application_id: "a1", display_name: "Probe Rot · Eins", swapped: false, done: false },
        { squad_id: "s2", application_id: "a2", display_name: "Probe Blau · Eins", swapped: false, done: false }] },
    { tournament_id: "t2", staffel: "B", capacity: 8, seated: [], size: 2,
      teams: [{ squad_id: "s3", application_id: "a3", display_name: "Probe Rot · Zwei", swapped: false, done: false },
        { squad_id: "s4", application_id: "a4", display_name: "Probe Gelb · Eins", swapped: false, done: false }] },
  ],
  swaps: [], log: [{ action: "create", number: 1, at: AT, by_name: "Probe Leitung" }],
};
const DIVISION = {
  id: "d1", level: 1, label: "Liga 1", lowest: true, own_team: false, problem: null, can_draw: true, draw: null,
  staffeln: [{ tournament_id: "t1", staffel: "A", status: "draft", open: true, max_participants: 8, seats: 1 },
    { tournament_id: "t2", staffel: "B", status: "draft", open: true, max_participants: 8, seats: 0 }],
  waiting: [{ application_id: "a1", squad_id: "s1", display_name: "Probe Rot · Eins" }, { application_id: "a2", squad_id: "s2", display_name: "Probe Blau · Eins" },
    { application_id: "a3", squad_id: "s3", display_name: "Probe Rot · Zwei" }, { application_id: "a4", squad_id: "s4", display_name: "Probe Gelb · Eins" }],
  suggestion: { teams: 5, cap: 8, needed: 1, sizes: [3, 2], fits: true, text: "5 Co-Teams, höchstens 8 je Staffel: 2 Staffeln mit 3 und 2 Teams." },
};

const body = (division, extra = {}) => ({ superadmin: false, siblings_allowed: false, divisions: [division], ...extra });

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

test("ohne Liga mit mehreren Staffeln und ohne Hinweis steht nichts da", async () => {
  apiMock.get.mockResolvedValue({ data: body({ ...DIVISION, staffeln: DIVISION.staffeln.slice(0, 1), can_draw: false, problem: "Liga 1 hat nur eine Staffel." }) });
  const { container } = render(<SeasonDrawPanel seasonId="s1" />);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/admin/leagues/seasons/s1/draws"));
  expect(container).toBeEmptyDOMElement();
});

test("die Platzprüfung warnt, wenn die Teams nicht in die Staffeln passen - auch mit nur einer Staffel", async () => {
  const text = "9 Co-Teams, höchstens 8 je Staffel: 2 Staffeln mit 5 und 4 Teams. Es gibt 1 Staffel – es fehlt 1.";
  apiMock.get.mockResolvedValue({ data: body({ ...DIVISION, staffeln: DIVISION.staffeln.slice(0, 1), can_draw: false, problem: "Liga 1 hat nur eine Staffel – dort teilst du im Eingang direkt zu.",
    suggestion: { teams: 9, needed: 2, sizes: [5, 4], fits: false, text } }) });
  render(<SeasonDrawPanel seasonId="s1" />);
  const seats = await screen.findByTestId("draw-seats-1");
  expect(seats).toHaveTextContent(`Passt nicht: ${text}`);
  expect(seats).toHaveAttribute("data-fits", "no");
  expect(screen.queryByTestId("draw-run-1")).toBeNull();
  expect(screen.getByTestId("draw-problem-1")).toHaveTextContent("nur eine Staffel");
});

test("Auslosen öffnet die Vorschau: Seed, Verteilung, wer schon steht - und Übernehmen schickt den Fingerabdruck", async () => {
  apiMock.get.mockResolvedValueOnce({ data: body(DIVISION) }).mockResolvedValue({ data: body({ ...DIVISION, draw: DRAW }) });
  apiMock.post.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/apply")
    ? { assigned: 4, draw: { ...DRAW, status: "applied", applied_at: AT } } : { replay: false, draw: DRAW } }));
  render(<SeasonDrawPanel seasonId="s1" />);
  expect(await screen.findByTestId("draw-division-1")).toHaveTextContent("4 Co-Teams warten auf eine Staffel · Staffel A 1 von 8 · Staffel B 0 von 8");
  expect(screen.getByTestId("draw-seats-1")).toHaveAttribute("data-fits", "yes");
  fireEvent.click(screen.getByTestId("draw-run-1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/draws/d1", {}));

  const sheet = await screen.findByTestId("draw-sheet");
  expect(within(sheet).getByTestId("draw-status")).toHaveTextContent("Los Nr. 1 – Vorschau, noch nicht übernommen");
  expect(within(sheet).getByTestId("draw-seed")).toHaveTextContent("3f9a6c01d2e4b587");
  expect(within(sheet).getByTestId("draw-staffel-A")).toHaveTextContent("3 von 8 Plätzen");
  expect(within(sheet).getByTestId("draw-staffel-A")).toHaveTextContent("Probe Alt · Eins · schon zugeteilt");
  expect(within(sheet).getByTestId("draw-staffel-B")).toHaveTextContent("Probe Gelb · Eins");
  expect(within(sheet).getByTestId("draw-log")).toHaveTextContent("23.11.2026, 14:05: Ausgelost (Los Nr. 1), Probe Leitung");
  const apply = within(sheet).getByTestId("draw-apply");
  expect(apply).toHaveTextContent("4 Co-Teams zuteilen");
  fireEvent.click(apply);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/draws/d1/apply", { fingerprint: "fp1", confirm: true }));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("4 Co-Teams zugeteilt. Die Teams bekommen eine Nachricht."));
});

test("Tausch: nur mit Partner aus einer anderen Staffel und mit Grund", async () => {
  apiMock.get.mockResolvedValue({ data: body({ ...DIVISION, draw: DRAW }) });
  apiMock.post.mockResolvedValue({ data: { draw: { ...DRAW, fingerprint: "fp2" } } });
  render(<SeasonDrawPanel seasonId="s1" />);
  fireEvent.click(await screen.findByTestId("draw-open-1"));
  fireEvent.click(await screen.findByTestId("draw-swap-open-s1"));
  const options = Array.from(screen.getByTestId("draw-swap-with").querySelectorAll("option")).map((option) => option.textContent);
  expect(options).toEqual(["Co-Team wählen …", "Probe Rot · Zwei · Staffel B", "Probe Gelb · Eins · Staffel B"]);
  expect(screen.getByTestId("draw-swap-send")).toBeDisabled();
  fireEvent.change(screen.getByTestId("draw-swap-with"), { target: { value: "s4" } });
  fireEvent.change(screen.getByTestId("draw-swap-reason"), { target: { value: "ja" } });
  expect(screen.getByTestId("draw-swap-send")).toBeDisabled();
  fireEvent.change(screen.getByTestId("draw-swap-reason"), { target: { value: "Terminwunsch beider Teams" } });
  fireEvent.click(screen.getByTestId("draw-swap-send"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/draws/d1/swap",
    { squad_id: "s1", other_squad_id: "s4", reason: "Terminwunsch beider Teams" }));
});

test("neu auslosen verlangt einen Grund; ein veraltetes Los lässt sich nicht übernehmen, aber ohne Grund neu losen", async () => {
  apiMock.get.mockResolvedValue({ data: body({ ...DIVISION, draw: DRAW }) });
  apiMock.post.mockResolvedValue({ data: { draw: { ...DRAW, id: "draw2", number: 2, stale: true } } });
  render(<SeasonDrawPanel seasonId="s1" />);
  fireEvent.click(await screen.findByTestId("draw-open-1"));
  fireEvent.click(await screen.findByTestId("draw-redraw-open"));
  expect(screen.getByTestId("draw-reason-send")).toBeDisabled();
  fireEvent.change(screen.getByTestId("draw-reason"), { target: { value: "Falsche Staffelzahl" } });
  fireEvent.click(screen.getByTestId("draw-reason-send"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/draws/d1/redraw", { reason: "Falsche Staffelzahl" }));

  expect(await screen.findByTestId("draw-stale")).toHaveTextContent("Seit dem Los hat sich etwas geändert");
  expect(screen.getByTestId("draw-apply")).toBeDisabled();
  expect(screen.queryByTestId("draw-swap-open-s1")).toBeNull();
  fireEvent.click(screen.getByTestId("draw-redraw-stale"));
  await waitFor(() => expect(apiMock.post).toHaveBeenLastCalledWith("/admin/leagues/seasons/s1/draws/d1/redraw", {}));
});

test("steht das eigene Team im Los, gibt es keine Knöpfe - der Superadmin schickt den Grund der Notausnahme mit", async () => {
  apiMock.get.mockResolvedValue({ data: body({ ...DIVISION, own_team: true }) });
  const { unmount } = render(<SeasonDrawPanel seasonId="s1" />);
  expect(await screen.findByTestId("draw-own-team-1")).toHaveTextContent("Über dein eigenes Team entscheidet eine andere Person.");
  expect(screen.queryByTestId("draw-run-1")).toBeNull();
  unmount();

  apiMock.get.mockResolvedValue({ data: body({ ...DIVISION, own_team: true, draw: DRAW }, { superadmin: true }) });
  apiMock.post.mockResolvedValue({ data: { assigned: 4, draw: { ...DRAW, status: "applied", applied_at: AT } } });
  render(<SeasonDrawPanel seasonId="s1" />);
  fireEvent.click(await screen.findByTestId("draw-open-1"));
  expect(await screen.findByTestId("draw-apply")).toBeDisabled();
  fireEvent.change(screen.getByTestId("draw-conflict-reason"), { target: { value: "Niemand sonst erreichbar" } });
  fireEvent.click(screen.getByTestId("draw-apply"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/draws/d1/apply",
    { fingerprint: "fp1", confirm: true, conflict_reason: "Niemand sonst erreichbar" }));
});

test("ein übernommenes Los lässt sich nachlesen, aber nicht mehr ändern", async () => {
  const applied = { ...DRAW, status: "applied", applied_at: AT, log: [...DRAW.log, { action: "apply", at: AT, by_name: "Probe Leitung" }],
    swaps: [{ a: "s1", b: "s4", a_name: "Probe Rot · Eins", b_name: "Probe Gelb · Eins", reason: "Terminwunsch", at: AT, by_name: "Probe Leitung" }] };
  apiMock.get.mockResolvedValue({ data: body({ ...DIVISION, waiting: [], can_draw: false, draw: applied }) });
  render(<SeasonDrawPanel seasonId="s1" />);
  expect(await screen.findByTestId("draw-state-1")).toHaveTextContent("Los Nr. 1 – übernommen am 23.11.2026, 14:05");
  fireEvent.click(screen.getByTestId("draw-open-1"));
  expect(await screen.findByTestId("draw-swaps")).toHaveTextContent("Tausch: Probe Rot · Eins und Probe Gelb · Eins – Terminwunsch (Probe Leitung)");
  expect(screen.queryByTestId("draw-apply")).toBeNull();
  expect(screen.queryByTestId("draw-redraw-open")).toBeNull();
  expect(screen.queryByTestId("draw-swap-open-s1")).toBeNull();
});
