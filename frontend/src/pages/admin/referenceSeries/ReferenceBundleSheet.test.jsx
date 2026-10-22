import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Referenzen bündeln (#1751): Vorschau je Gruppe (Spur neu oder vorhanden, Saisons, Liga-Weg, Hinweise), Bündeln schickt
// nur die gewählten Referenzen samt Titel und Art einer neuen Spur, Rückgängig nimmt eine Bündelung zurück. Nur
// erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn() };
const confirmMock = vi.fn(async () => true);
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ReferenceBundleSheet } = await import("./ReferenceBundleSheet");

const GROUP = {
  key: "probeverband|name:probespiel|4vs4|probeliga",
  lineage: { id: null, title: "Probe Liga", kind: "team_league", organizer: "Probe Verband", label: "4vs4", game_name: "Probespiel", visibility: "public" },
  references: [
    { id: "ref-s1", title: "Probe Liga 4vs4 Season 1", start_date: "2024-03-10", placement: 2, visibility: "public" },
    { id: "ref-s2", title: "Probe Liga 4vs4 Season 2", start_date: null, placement: 1, visibility: "members" },
  ],
  seasons: [
    { key: "a", id: null, season: "Season 1", tier: "Division 3", status: "completed", reference_ids: ["ref-s1"], club: { rank: 2 } },
    { key: "b", id: "serie-2", season: "Season 2", tier: "Division 2", status: "completed", reference_ids: ["ref-s2"], club: { rank: 1 } },
  ],
  hints: [{ code: "missing_date", reference_ids: ["ref-s2"], text: "„Probe Liga 4vs4 Season 2“ hat kein Datum." }],
};

function mockApi({ groups = [GROUP], bundles = [] } = {}) {
  apiMock.get.mockImplementation(async (url) => (url.endsWith("/proposals")
    ? { data: { groups, unlinked: 2 } }
    : { data: { items: bundles } }));
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  confirmMock.mockClear();
  mockApi();
  apiMock.post.mockResolvedValue({ data: { linked: 2 } });
});

test("Vorschau: neue Spur, Saison je Referenz, Liga-Weg und Hinweis", async () => {
  render(<ReferenceBundleSheet onClose={() => {}} onDone={() => {}} />);
  const group = await screen.findByTestId("bundle-group");
  expect(within(group).getByText("Neue Spur")).toBeInTheDocument();
  expect(within(group).getByTestId("bundle-lineage-title")).toHaveTextContent("Probe Liga");
  expect(within(group).getByTestId("bundle-ref-ref-s1")).toHaveTextContent("→ Season 1 · Division 3 (neu)");
  expect(within(group).getByTestId("bundle-ref-ref-s2")).toHaveTextContent("→ Season 2 · Division 2 (vorhanden)");
  expect(within(group).getByTestId("bundle-ref-ref-s2")).toHaveTextContent("Mitglieder");
  const steps = within(group).getAllByTestId("bundle-step");
  expect(steps.map((step) => step.textContent)).toEqual(["Season 1 · neuDivision 32.Aufstieg", "Season 2Division 21."]);
  expect(within(group).getByTestId("bundle-hint-missing_date")).toHaveTextContent("Ohne Datum");
  expect(within(group).getByTestId("bundle-summary")).toHaveTextContent("2 Referenzen · 1 neue Saison · 1 vorhandene");
});

test("Bündeln schickt nur die gewählten Referenzen mit Titel und Art der neuen Spur", async () => {
  const onDone = vi.fn();
  render(<ReferenceBundleSheet onClose={() => {}} onDone={onDone} />);
  await screen.findByTestId("bundle-group");
  fireEvent.click(screen.getByTestId("bundle-pick-ref-s2"));
  expect(screen.queryByTestId("bundle-hint-missing_date")).toBeNull();
  fireEvent.change(screen.getByTestId("bundle-lineage-input"), { target: { value: "Probe Liga Pro" } });
  fireEvent.change(screen.getByTestId("bundle-lineage-kind"), { target: { value: "series" } });
  fireEvent.click(screen.getByTestId("bundle-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  expect(confirmMock).toHaveBeenCalled();
  expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/bundles", {
    group_key: GROUP.key, reference_ids: ["ref-s1"], lineage_title: "Probe Liga Pro", lineage_kind: "series",
  });
  await waitFor(() => expect(onDone).toHaveBeenCalled());
});

test("ohne offene Gruppe sagt das Blatt, warum", async () => {
  mockApi({ groups: [] });
  render(<ReferenceBundleSheet onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByTestId("bundle-empty")).toHaveTextContent("2 Referenzen stehen ohne Saison allein");
});

test("Rückgängig nimmt eine Bündelung zurück; zurückgenommene bieten es nicht mehr an", async () => {
  mockApi({ groups: [], bundles: [
    { id: "b1", status: "active", linked: 2, lineage_title: "Probe Liga", created_at: "2026-10-20T10:00:00+00:00" },
    { id: "b0", status: "undone", linked: 1, lineage_title: "Probe Cup", created_at: "2026-10-19T10:00:00+00:00" },
  ] });
  apiMock.post.mockResolvedValue({ data: { unlinked: 2, series_removed: 2, series_kept: [], lineage_removed: true } });
  render(<ReferenceBundleSheet onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByTestId("bundle-history-b0")).toHaveTextContent("zurückgenommen");
  expect(screen.queryByTestId("bundle-undo-b0")).toBeNull();
  fireEvent.click(screen.getByTestId("bundle-undo-b1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/bundles/b1/undo"));
});
