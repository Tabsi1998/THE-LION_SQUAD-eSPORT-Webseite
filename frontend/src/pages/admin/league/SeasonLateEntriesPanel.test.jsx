import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Nachmeldungen (docs/LIGA.md, B.4, #2422): Vorschau mit Vorschlag, was entfällt, und Anlegen per Bestätigung. Nur erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { SeasonLateEntriesPanel, lateEntryLine } = await import("./SeasonLateEntriesPanel");

const ITEM = { registration_id: "r9", tournament_id: "t1", name: "Rudel Neu · Eins", staffel: "A", state: "open", from_week: 3, active: true };
const PREVIEW = {
  registration_id: "r9", name: "Rudel Neu · Eins", legs: 1, from_week: 3, fingerprint: "abc123",
  pairings: [
    { matchday: 3, week: 3, opponent_id: "r2", opponent_name: "Rudel Zwei", home_name: "Rudel Neu · Eins", away_name: "Rudel Zwei", kind: "bye",
      reason: "Rudel Zwei hat in dieser Woche spielfrei.", default_at: "2026-11-29T19:00:00+00:00" },
    { matchday: 4, week: 4, opponent_id: "r3", opponent_name: "Rudel Drei", home_name: "Rudel Drei", away_name: "Rudel Neu · Eins", kind: "reserve",
      reason: "Reservewoche nach dem letzten Spieltag.", default_at: null },
  ],
  missing: [{ opponent_id: "r1", opponent_name: "Rudel Eins", games: 1, text: "Gegen Rudel Eins kein Spiel mehr möglich." }],
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

function route(items, preview = PREVIEW) {
  apiMock.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/late-entries") ? { items } : preview }));
}

test("ohne Nachmeldung steht nichts da", async () => {
  route([]);
  const { container } = render(<SeasonLateEntriesPanel seasonId="s1" />);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/admin/leagues/seasons/s1/late-entries"));
  expect(container).toBeEmptyDOMElement();
});

test("die Vorschau zeigt den Vorschlag und was entfällt, die Bestätigung schickt den Fingerabdruck", async () => {
  route([ITEM]);
  apiMock.post.mockResolvedValue({ data: { state: "done", match_ids: ["m1", "m2"] } });
  render(<SeasonLateEntriesPanel seasonId="s1" />);
  expect(await screen.findByTestId("late-entry-r9")).toHaveTextContent("Spiele noch nicht nachgetragen · ab Woche 3");
  fireEvent.click(screen.getByTestId("late-entry-open-r9"));

  expect(await screen.findByTestId("late-entry-pairings")).toHaveTextContent("Woche 3Rudel Neu · Eins gegen Rudel Zwei");
  expect(screen.getByTestId("late-entry-pairing-3")).toHaveTextContent("Freilos des Gegners – Rudel Zwei hat in dieser Woche spielfrei.");
  expect(screen.getByTestId("late-entry-pairing-3")).toHaveTextContent("29.11., 20:00 Uhr");
  expect(screen.getByTestId("late-entry-pairing-4")).toHaveTextContent("Termin festlegen");
  expect(screen.getByTestId("late-entry-missing")).toHaveTextContent("Gegen Rudel Eins kein Spiel mehr möglich.");
  expect(screen.getByTestId("late-entry-intro")).toHaveTextContent("Nachgemeldet ab Woche 3.");
  expect(screen.getByTestId("late-entry-confirm")).toHaveTextContent("2 Spiele anlegen");

  fireEvent.click(screen.getByTestId("late-entry-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/staffeln/t1/late-entries/r9", { fingerprint: "abc123" }));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("2 Spiele angelegt. Beide Seiten bekommen eine Nachricht."));
});

test("hat sich der Spielplan geändert, kommt die Meldung und die Vorschau lädt neu", async () => {
  route([ITEM]);
  apiMock.post.mockRejectedValue({ response: { data: { detail: "Der Spielplan hat sich seit der Vorschau geändert." } } });
  render(<SeasonLateEntriesPanel seasonId="s1" />);
  fireEvent.click(await screen.findByTestId("late-entry-open-r9"));
  await screen.findByTestId("late-entry-pairings");
  const before = apiMock.get.mock.calls.length;
  fireEvent.click(screen.getByTestId("late-entry-confirm"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Der Spielplan hat sich seit der Vorschau geändert."));
  await waitFor(() => expect(apiMock.get.mock.calls.length).toBeGreaterThan(before));
});

test("ohne offene Woche: ohne Spiele bestätigen", async () => {
  route([{ ...ITEM, from_week: null }], { ...PREVIEW, from_week: null, pairings: [] });
  render(<SeasonLateEntriesPanel seasonId="s1" />);
  expect(await screen.findByTestId("late-entry-r9")).toHaveTextContent("keine Spielwoche mehr offen");
  fireEvent.click(screen.getByTestId("late-entry-open-r9"));
  expect(await screen.findByTestId("late-entry-confirm")).toHaveTextContent("Ohne Spiele bestätigen");
  expect(screen.getByTestId("late-entry-intro")).toHaveTextContent("Keine Spielwoche ist mehr offen.");
});

test("eine erledigte Nachmeldung sagt, was angelegt wurde, und hat keinen Knopf", async () => {
  route([{ ...ITEM, state: "done", created: 2, missing: 1 }]);
  render(<SeasonLateEntriesPanel seasonId="s1" />);
  expect(await screen.findByTestId("late-entry-r9")).toHaveTextContent("2 Spiele nachgetragen · gegen 1 Team kein Spiel mehr möglich");
  expect(screen.queryByTestId("late-entry-open-r9")).toBeNull();
  expect(lateEntryLine({ state: "done", created: 1, missing: 0 })).toBe("1 Spiel nachgetragen");
});

test("eigenes Team (Nr. 187): ohne Superadmin kein Knopf, der Superadmin braucht einen Grund", async () => {
  route([ITEM], { ...PREVIEW, own_team: true, superadmin: false });
  const { unmount } = render(<SeasonLateEntriesPanel seasonId="s1" />);
  fireEvent.click(await screen.findByTestId("late-entry-open-r9"));
  expect(await screen.findByTestId("late-entry-own-team")).toHaveTextContent("Über dein eigenes Team entscheidet eine andere Person.");
  expect(screen.getByTestId("late-entry-confirm")).toBeDisabled();
  unmount();

  route([ITEM], { ...PREVIEW, own_team: true, superadmin: true });
  apiMock.post.mockResolvedValue({ data: { state: "done", match_ids: ["m1"] } });
  render(<SeasonLateEntriesPanel seasonId="s1" />);
  fireEvent.click(await screen.findByTestId("late-entry-open-r9"));
  await screen.findByTestId("late-entry-conflict-reason");
  expect(screen.getByTestId("late-entry-confirm")).toBeDisabled();
  fireEvent.change(screen.getByTestId("late-entry-conflict-reason"), { target: { value: "Niemand sonst erreichbar" } });
  fireEvent.click(screen.getByTestId("late-entry-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/staffeln/t1/late-entries/r9",
    { fingerprint: "abc123", conflict_reason: "Niemand sonst erreichbar" }));
});

test("Hinweise der Vorschau stehen da (verschobenes Spiel, anfechtbare Disqualifikation)", async () => {
  route([ITEM], { ...PREVIEW, notes: ["Rudel Eins gegen Rudel Zwei (Spieltag 1) ist in Woche 3 verschoben - beide sind dort belegt."] });
  render(<SeasonLateEntriesPanel seasonId="s1" />);
  fireEvent.click(await screen.findByTestId("late-entry-open-r9"));
  expect(await screen.findByTestId("late-entry-notes")).toHaveTextContent("ist in Woche 3 verschoben");
});
