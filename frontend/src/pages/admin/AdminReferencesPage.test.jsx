import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Referenzen im Admin (#409): Felder statt Titel-Muster, Einträge als Team oder Einzelstarter mit
// eigener Platzierung; alte Referenzen kommen mit den vom Server abgeleiteten Feldern ins Formular.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/components/tls/GermanDateField", () => ({
  GermanDateField: ({ label, value, onChange, testId }) => <label>{label}<input data-testid={testId} value={value || ""} onChange={(e) => onChange(e.target.value)} /></label>,
}));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminReferencesPage = (await import("./AdminReferencesPage")).default;

const HELPERS = {
  platforms: [{ key: "PS", label: "PlayStation" }, { key: "PC", label: "PC" }],
  formats: ["HC", "CORE"], leagues: [], seasons: [], organizers: [], game_names: [], team_names: ["THE LION SQUAD"], placement_labels: [], locations: [], auto: {},
};
const PROFILES = [
  { id: "p1", display_name: "Anna Beispiel", gamertag: "Anni" },
  { id: "p2", display_name: "Ben Beispiel", gamertag: "Benny" },
];
const LEGACY_ITEM = {
  id: "r1", title: "[PS] HC | Liga A | Herbst Cup", display_title: "Herbst Cup", platforms: ["PS"], format: "HC", league: "Liga A", season: null,
  status: "completed", visibility: "public", is_active: true, order_index: 0, mode: "online",
  entries: [{ id: "e1", kind: "team", team_name: "THE LION SQUAD", member_profile_ids: ["p1"], lineup: ["Gast"], lineup_members: [{ profile_id: "p1", display_name: "Anni" }], placement: 2, medal: "silver" }],
};

function mockApi(items) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/references/admin") return { data: { items, summary: { total: items.length } } };
    if (url === "/games") return { data: [{ id: "g1", name: "Call of Duty" }] };
    if (url === "/membership/profiles/admin/all") return { data: PROFILES };
    if (url === "/references/admin/helpers") return { data: HELPERS };
    return { data: [] };
  });
}

beforeEach(() => {
  apiMock.post.mockReset();
  apiMock.patch.mockReset();
  apiMock.post.mockResolvedValue({ data: { id: "new" } });
  apiMock.patch.mockResolvedValue({ data: LEGACY_ITEM });
  toastMock.error.mockReset();
});

test("Neue Referenz: Felder statt Titel, zwei Einzelstarter mit je eigener Platzierung", async () => {
  mockApi([]);
  render(<MemoryRouter><AdminReferencesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("reference-new"));
  expect(screen.getByRole("dialog", { name: "Neue Referenz" })).toBeInTheDocument();

  fireEvent.change(screen.getByTestId("reference-title"), { target: { value: "Winter Cup" } });
  fireEvent.change(screen.getByTestId("reference-league"), { target: { value: "Liga X" } });
  fireEvent.change(screen.getByTestId("reference-season"), { target: { value: "Season 3" } });
  fireEvent.click(await screen.findByTestId("reference-platform-PS"));

  fireEvent.click(screen.getByTestId("reference-add-solo"));
  fireEvent.click(screen.getByTestId("reference-entry-0-member-p1"));
  fireEvent.change(screen.getByTestId("reference-entry-0-placement"), { target: { value: "1" } });
  fireEvent.click(screen.getByTestId("reference-add-solo"));
  fireEvent.click(screen.getByTestId("reference-entry-1-member-p2"));
  fireEvent.change(screen.getByTestId("reference-entry-1-placement"), { target: { value: "4" } });
  fireEvent.change(screen.getByTestId("reference-entry-1-participants"), { target: { value: "32" } });

  fireEvent.submit(screen.getByTestId("reference-sheet"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(1));
  const [url, payload] = apiMock.post.mock.calls[0];
  expect(url).toBe("/references");
  expect(payload).toEqual(expect.objectContaining({ title: "Winter Cup", league: "Liga X", season: "Season 3", platforms: ["PS"] }));
  expect(payload.entries).toEqual([
    expect.objectContaining({ kind: "solo", member_profile_ids: ["p1"], placement: 1, team_name: null }),
    expect.objectContaining({ kind: "solo", member_profile_ids: ["p2"], placement: 4, participant_count: 32 }),
  ]);
});

test("ohne Eintrag wird nicht gespeichert", async () => {
  mockApi([]);
  render(<MemoryRouter><AdminReferencesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("reference-new"));
  fireEvent.change(screen.getByTestId("reference-title"), { target: { value: "Winter Cup" } });
  expect(screen.getByTestId("reference-entries-empty")).toBeInTheDocument();
  fireEvent.submit(screen.getByTestId("reference-sheet"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("Bearbeiten übernimmt die abgeleiteten Felder und den Eintrag der alten Referenz", async () => {
  mockApi([LEGACY_ITEM]);
  render(<MemoryRouter><AdminReferencesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("reference-edit-r1"));
  expect(screen.getByTestId("reference-title")).toHaveValue("Herbst Cup");
  expect(screen.getByTestId("reference-league")).toHaveValue("Liga A");
  expect(screen.getByTestId("reference-format")).toHaveValue("HC");
  expect(screen.getByTestId("reference-entry-0-kind")).toHaveValue("team");
  expect(screen.getByTestId("reference-entry-0-team")).toHaveValue("THE LION SQUAD");
  expect(screen.getByTestId("reference-entry-0-placement")).toHaveValue(2);
  expect(screen.getByTestId("reference-entry-0-lineup")).toHaveValue("Gast");
  expect(screen.getByTestId("reference-entry-0-member-p1")).toBeChecked();

  fireEvent.click(screen.getByTestId("reference-entry-0-member-p2"));
  fireEvent.submit(screen.getByTestId("reference-sheet"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
  const [url, payload] = apiMock.patch.mock.calls[0];
  expect(url).toBe("/references/r1");
  expect(payload.title).toBe("Herbst Cup");
  expect(payload.platforms).toEqual(["PS"]);
  expect(payload.entries).toEqual([expect.objectContaining({ id: "e1", kind: "team", member_profile_ids: ["p1", "p2"], lineup: ["Gast"], placement: 2 })]);
});
