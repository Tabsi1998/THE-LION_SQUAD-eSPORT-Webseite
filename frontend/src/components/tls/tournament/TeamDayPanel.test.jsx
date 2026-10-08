import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { lineupLabel, presenceLine, starterLabel } from "@/lib/teamDay";

// Team am Spieltag (#1192): Kapitän wählt, wer spielt (genau so viele wie je Team), am Turniertag „Ich bin da“,
// der Kapitän sieht „x von y da“ und kann anstupsen. Erfundene Daten.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { TeamDayPanel } = await import("./TeamDayPanel");

const MEMBERS = [
  { id: "u-cap", display_name: "NeonFalke", role: "captain" },
  { id: "u-co", display_name: "PixelPanther", role: "co_captain" },
  { id: "u-3", display_name: "LunaByte", role: "player" },
  { id: "u-4", display_name: "KiwiKomet", role: "player" },
];

function view(overrides = {}) {
  return {
    applicable: true, registration_id: "r-1", team_size: 2, substitutes_allowed: true, members: MEMBERS,
    lineup: [], substitutes: [], lineup_set: false, can_edit: true, is_lead: true, editable_until: "2026-10-17T11:45:00Z",
    presence: { enabled: false, present: {}, counted: MEMBERS.map((m) => m.id), count: 0, total: 4, me_present: false, can_mark: false },
    can_nudge: false, nudge_available_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
});

test("Sätze: Kapitän heißt so, Hinweis zu Aufruf und Meldungen, „x von y da“", () => {
  expect(starterLabel({ role: "captain" })).toBe("Kapitän");
  expect(starterLabel({ role: "player" })).toBe("Spielt");
  expect(lineupLabel({ team_size: 3, can_edit: true, lineup: [] }, 1)).toBe("Wähle genau 3 – so viele spielen bei diesem Turnier je Team.");
  expect(lineupLabel({ team_size: 3, can_edit: false, lineup_set: false })).toBe("Noch keine Aufstellung – Aufruf und Spiel-Meldungen gehen an alle im Team.");
  expect(lineupLabel({ team_size: 3, can_edit: true, lineup_set: true, lineup: ["a", "b", "c"] }, 3)).toBe("Die Turnierleitung sieht die Aufstellung beim Check-in. Aufruf und Spiel-Meldungen gehen an diese drei.");
  expect(presenceLine({ count: 4, total: 5 })).toBe("4 von 5 da");
});

test("Kapitän wählt genau so viele, wie je Team spielen; die übrigen sind Ersatz", async () => {
  apiMock.get.mockResolvedValue({ data: view() });
  apiMock.put.mockResolvedValue({ data: view({ lineup: ["u-cap", "u-3"], substitutes: ["u-co", "u-4"], lineup_set: true }) });
  render(<TeamDayPanel tournament={{ id: "t-1" }} />);
  await screen.findByTestId("team-lineup");
  expect(screen.getByTestId("team-lineup-count")).toHaveTextContent("0 von 2");
  expect(screen.getByTestId("team-lineup-save")).toBeDisabled();
  fireEvent.click(screen.getByTestId("team-lineup-toggle-u-cap"));
  fireEvent.click(screen.getByTestId("team-lineup-toggle-u-3"));
  expect(screen.getByTestId("team-lineup-count")).toHaveTextContent("2 von 2");
  expect(within(screen.getByTestId("team-lineup-member-u-cap")).getByText("Kapitän")).toBeInTheDocument();
  expect(within(screen.getByTestId("team-lineup-member-u-3")).getByText("Spielt")).toBeInTheDocument();
  expect(within(screen.getByTestId("team-lineup-member-u-4")).getByText("Ersatz")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("team-lineup-toggle-u-4"));
  expect(screen.getByTestId("team-lineup-save")).toBeDisabled();
  fireEvent.click(screen.getByTestId("team-lineup-toggle-u-4"));
  fireEvent.click(screen.getByTestId("team-lineup-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/team-day/t-1/lineup", { lineup: ["u-cap", "u-3"] }));
  await waitFor(() => expect(screen.getByTestId("team-lineup-note")).toHaveTextContent("Aufruf und Spiel-Meldungen gehen an diese zwei."));
});

test("Spieler sehen die Aufstellung nur; vor dem Turniertag der Hinweis auf „Ich bin da“", async () => {
  apiMock.get.mockResolvedValue({ data: view({ can_edit: false, is_lead: false, lineup: ["u-cap", "u-3"], lineup_set: true }) });
  render(<TeamDayPanel tournament={{ id: "t-1" }} />);
  await screen.findByTestId("team-lineup");
  expect(screen.queryByTestId("team-lineup-toggle-u-cap")).toBeNull();
  expect(screen.queryByTestId("team-lineup-save")).toBeNull();
  expect(screen.getByTestId("team-presence-later")).toHaveTextContent("Am Turniertag");
});

test("am Turniertag: „Ich bin da“, der Zähler und Anstupsen für den Kapitän", async () => {
  const day = (present, extra = {}) => view({
    lineup: ["u-cap", "u-3"], substitutes: ["u-co", "u-4"], lineup_set: true, can_nudge: true,
    presence: { enabled: true, present, counted: ["u-cap", "u-3", "u-co", "u-4"], count: Object.keys(present).length, total: 4, me_present: "u-cap" in present, can_mark: true },
    ...extra,
  });
  apiMock.get.mockResolvedValue({ data: day({ "u-3": "2026-10-17T08:12:00Z" }) });
  apiMock.post.mockImplementation(async (url) => (url.endsWith("/presence")
    ? { data: day({ "u-3": "2026-10-17T08:12:00Z", "u-cap": "2026-10-17T08:20:00Z" }) }
    : { data: { ...day({ "u-3": "2026-10-17T08:12:00Z", "u-cap": "2026-10-17T08:20:00Z" }, { nudge_available_at: "2026-10-17T08:31:00Z" }), nudged: 2 } }));
  render(<TeamDayPanel tournament={{ id: "t-1" }} />);
  expect(await screen.findByTestId("team-presence-count")).toHaveTextContent("1 von 4 da");
  expect(screen.getByTestId("team-presence-u-3")).toHaveTextContent("da · 10:12");
  expect(screen.getByTestId("team-presence-u-4")).toHaveTextContent("fehlt");
  fireEvent.click(screen.getByTestId("team-presence-here"));
  await waitFor(() => expect(screen.getByTestId("team-presence-count")).toHaveTextContent("2 von 4 da"));
  expect(screen.getByTestId("team-presence-undo")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("team-presence-nudge"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/team-day/t-1/nudge"));
  await waitFor(() => expect(screen.getByTestId("team-presence-nudge")).toBeDisabled());
  expect(screen.getByTestId("team-presence-nudge")).toHaveTextContent("Wieder ab 10:31");
});

test("bei Einzel-Turnieren taucht nichts auf", async () => {
  apiMock.get.mockResolvedValue({ data: { applicable: false } });
  const { container } = render(<TeamDayPanel tournament={{ id: "t-1" }} />);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/team-day/t-1"));
  expect(container).toBeEmptyDOMElement();
});
