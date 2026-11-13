import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Reiter „Belohnungen“ der Season (F.4, #2214): Zusammenstellung, Spieler mit Einsatz oder Kader, Liga N eigen oder wie die Season,
// Stand der Vergabe je Staffel; nur lesen ohne „Season konfigurieren“. Erfundene Namen.
const apiMock = { get: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || ""), resolveMediaUrl: (url) => url }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", role: "superadmin" } }) }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: ({ testId }) => <div data-testid={testId} /> }));

const { SeasonRewardsTab, rewardsPayload, rewardsToForm } = await import("./SeasonRewardsTab");

const GOLD = { id: "gold", kind: "medal", name: "Goldmedaille", description: "", places: { mode: "rank", rank: 1 }, place_label: "1. Platz", recipients: ["team", "players"],
  image_url: null, prize: null };
const body = (extra = {}) => ({
  season: { id: "s1", name: "Season 1" }, can_edit: true, reward_players: "fielded", items: [GOLD],
  divisions: [
    { id: "d1", level: 1, label: "Liga 1", own: false, items: [GOLD], staffeln: [
      { tournament_id: "t1", staffel: "A", closed: true, version: 2, awards: 5, teams: 1, players: 8, suspended: false },
      { tournament_id: "t2", staffel: "B", closed: false, version: null, awards: 0, teams: 0, players: 0, suspended: false }] },
    { id: "d2", level: 2, label: "Liga 2", own: true, items: [], staffeln: [] },
  ],
  ...extra,
});

function renderTab(data = body()) {
  apiMock.get.mockResolvedValue({ data });
  return render(<MemoryRouter><SeasonRewardsTab seasonId="s1" /></MemoryRouter>);
}

beforeEach(() => {
  for (const fn of [...Object.values(apiMock), ...Object.values(toastMock)]) fn.mockReset();
});

test("zeigt Season, geerbte und eigene Liga N und den Stand je Staffel", async () => {
  renderTab();
  expect(await screen.findByTestId("season-rewards-items-name-0")).toBeInTheDocument();
  expect(screen.getByTestId("season-rewards-basis-fielded")).toBeChecked();
  expect(screen.getByTestId("season-rewards-inherit-d1")).toHaveTextContent("Wie die Season: Goldmedaille (1. Platz).");
  expect(screen.getByTestId("season-rewards-division-items-d2-empty")).toHaveTextContent("Diese Liga N vergibt keine Belohnungen.");
  expect(screen.getByTestId("rewards-staffel-t1")).toHaveTextContent("5 vergeben · 1 Team · 8 Spieler · Fassung 2");
  expect(screen.getByTestId("rewards-staffel-t2")).toHaveTextContent("Noch nicht abgeschlossen");
  expect(screen.getByTestId("season-rewards-save")).toBeDisabled();
});

test("eine Belohnung für Platz 4–6 an das Team dazu, dann speichern - mit Kader statt Einsatz", async () => {
  renderTab();
  await screen.findByTestId("season-rewards-items-add");
  fireEvent.click(screen.getByTestId("season-rewards-items-add"));
  fireEvent.change(screen.getByTestId("season-rewards-items-kind-1"), { target: { value: "emblem" } });
  expect(screen.getByTestId("season-rewards-items-problem-1")).toHaveTextContent("Name fehlt.");
  expect(screen.getByTestId("season-rewards-save")).toBeDisabled();
  fireEvent.change(screen.getByTestId("season-rewards-items-name-1"), { target: { value: "Verfolger" } });
  fireEvent.change(screen.getByTestId("season-rewards-items-mode-1"), { target: { value: "range" } });
  fireEvent.click(screen.getByTestId("season-rewards-items-to-players-1"));
  fireEvent.click(screen.getByTestId("season-rewards-basis-roster"));
  apiMock.put.mockResolvedValue({ data: body({ reward_players: "roster" }) });
  fireEvent.click(screen.getByTestId("season-rewards-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalled());
  const [url, sent] = apiMock.put.mock.calls[0];
  expect(url).toBe("/admin/leagues/seasons/s1/rewards");
  expect(sent.reward_players).toBe("roster");
  expect(sent.items[1]).toEqual({ kind: "emblem", name: "Verfolger", description: "", places: { mode: "range", from: 4, to: 6 }, recipients: ["team"],
    image_url: null, prize: null });
  expect(sent.divisions).toEqual({ d1: null, d2: [] });
  expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining("nächsten Abschluss"));
});

test("Liga N bekommt eine eigene Zusammenstellung als Kopie - und zurück auf die Season", async () => {
  renderTab();
  fireEvent.click(await screen.findByTestId("season-rewards-own-d1"));
  expect(screen.getByTestId("season-rewards-division-items-d1-name-0")).toHaveValue("Goldmedaille");
  fireEvent.click(screen.getByTestId("season-rewards-own-d2"));
  expect(screen.getByTestId("season-rewards-inherit-d2")).toBeInTheDocument();
});

test("ohne „Season konfigurieren“ nur lesen", async () => {
  renderTab(body({ can_edit: false }));
  expect(await screen.findByTestId("season-rewards-readonly")).toBeInTheDocument();
  expect(screen.queryByTestId("season-rewards-save")).toBeNull();
  expect(screen.queryByTestId("season-rewards-items-add")).toBeNull();
  expect(screen.queryByTestId("season-rewards-own-d1")).toBeNull();
  expect(screen.getByTestId("season-rewards-items-name-0").querySelector("input") || screen.getByTestId("season-rewards-items-name-0")).toBeDisabled();
});

test("Form und Anfrage passen zusammen", () => {
  expect(rewardsPayload(rewardsToForm(body()))).toEqual({ reward_players: "fielded", items: [{ id: "gold", kind: "medal", name: "Goldmedaille", description: "",
    places: { mode: "rank", rank: 1 }, recipients: ["team", "players"], image_url: null, prize: null }], divisions: { d1: null, d2: [] } });
});
