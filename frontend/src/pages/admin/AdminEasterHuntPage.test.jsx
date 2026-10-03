import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Ostereiersuche pflegen (#646, #757): Vorschlag für das Jahr, prüfen, speichern; Preise und Freigabe; Verstecke
// fest nach dem ersten Fund; Auswertung erst nach Ostermontag und nur nach Rückfrage.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API: "/api", formatApiError: (value) => value }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));

const { default: AdminEasterHuntPage, easterYear } = await import("./AdminEasterHuntPage");
const { ConfirmDialogProvider } = await import("@/components/tls/ConfirmDialog");

const BASE = {
  year: 2027, exists: true, phase: "draft", status: "draft", starts_at: "2027-03-26T00:00:00+01:00", ends_at: "2027-03-29T23:59:59+02:00",
  hints_open_at: "2027-03-27T00:00:00+01:00", hint_unlock_hours: 24, prizes: [], eggs: [], started: 0, completed: 0,
  routes: { web: { "/": "Startseite", "/news": "News" }, app: { "app:Dashboard": "Home" } },
  spot_kinds: { web: ["card", "image", "hero", "header", "footer"], app: ["card", "hero", "header"] },
  places: ["top-left", "top-right", "bottom-left", "bottom-right"], patterns: ["stripes", "dots", "lion"],
  prize_kinds: { raffle_all: "Verlosung unter allen mit vollem Korb", fastest_1: "Schnellste:r", fastest_2: "Zweitschnellste:r", fastest_3: "Drittschnellste:r" },
  raffle: null, fastest_awarded: [], can_draw: false,
};
const PROPOSAL = [
  { egg_no: 1, channel: "web", route: "/news", spot: { kind: "card", index: 1, place: "top-left" }, pattern: "dots", hint: "Schau auf „News“ an einer Karte." },
  { egg_no: 2, channel: "app", route: "app:Dashboard", spot: { kind: "card", index: 0, place: "bottom-right" }, pattern: "lion", hint: "Schau in der App auf „Home“ an einer Karte." },
];

function renderPage() {
  return render(<MemoryRouter><ConfirmDialogProvider><AdminEasterHuntPage /></ConfirmDialogProvider></MemoryRouter>);
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.put.mockReset();
  apiMock.post.mockReset();
});

test("Ostern liegt im Frühling - ab Mai geht es um das nächste Jahr", () => {
  expect(easterYear(new Date(2026, 9, 3))).toBe(2027);
  expect(easterYear(new Date(2027, 1, 10))).toBe(2027);
});

test("Vorschlag holen, Hinweis ändern, Verstecke speichern - dann freigeben mit Preisen", async () => {
  apiMock.get.mockResolvedValue({ data: BASE });
  apiMock.post.mockResolvedValue({ data: { eggs: PROPOSAL } });
  apiMock.put.mockImplementation(async (url, body) => ({ data: { ...BASE, eggs: (body.eggs || PROPOSAL).map((egg) => ({ ...egg, found: 0 })), status: body.status || "draft", prizes: body.prizes || [] } }));
  renderPage();
  await waitFor(() => expect(screen.getByTestId("easter-admin-phase")).toHaveTextContent("Entwurf"));
  fireEvent.click(screen.getByTestId("easter-admin-propose"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(expect.stringMatching(/\/seasonal\/easter\/admin\/\d{4}\/propose$/), { web: 8, app: 4 }));
  const row = await screen.findByTestId("easter-admin-egg-1");
  fireEvent.change(within(row).getByLabelText("Hinweis"), { target: { value: "Bei den News, ganz oben links." } });
  fireEvent.click(screen.getByTestId("easter-admin-save-eggs"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith(expect.stringMatching(/\/eggs$/), { eggs: [{ ...PROPOSAL[0], hint: "Bei den News, ganz oben links." }, PROPOSAL[1]] }));

  fireEvent.change(screen.getByTestId("easter-admin-prize-raffle_all"), { target: { value: "TLS-Hoodie" } });
  fireEvent.click(await screen.findByTestId("easter-admin-release"));
  await waitFor(() => expect(apiMock.put).toHaveBeenLastCalledWith(expect.stringMatching(/\/admin\/\d{4}$/), { prizes: [{ kind: "raffle_all", label: "TLS-Hoodie", value: "", winners: 1 }], status: "live" }));
});

test("nach dem ersten Fund bleiben die Verstecke", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BASE, status: "live", phase: "running", eggs: PROPOSAL.map((egg, i) => ({ ...egg, found: i === 0 ? 3 : 0 })), started: 3 } });
  renderPage();
  expect(await screen.findByTestId("easter-admin-locked")).toBeInTheDocument();
  expect(screen.queryByTestId("easter-admin-propose")).toBeNull();
  expect(within(screen.getByTestId("easter-admin-egg-1")).getByLabelText("Hinweis")).toBeDisabled();
  expect(screen.queryByTestId("easter-admin-draft")).toBeNull();
});

test("Auswertung nur nach Rückfrage; danach stehen die Gewinner da", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BASE, status: "live", phase: "ended", can_draw: true, eggs: PROPOSAL.map((egg) => ({ ...egg, found: 2 })), completed: 2 } });
  apiMock.post.mockResolvedValue({ data: { ...BASE, status: "drawn", phase: "drawn", fastest_awarded: [{ user_id: "u1", name: "Paula", kind: "fastest_1", title: "Schnellste:r" }], raffle: { protocol: [{ id: "d1", winners: [{ name: "Kai" }], eligible: 2, entries: 2 }] } } });
  renderPage();
  fireEvent.click(await screen.findByTestId("easter-admin-run-draw"));
  fireEvent.click(await screen.findByTestId("confirm-dialog-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(expect.stringMatching(/\/draw$/)));
  expect(await screen.findByTestId("easter-admin-draw")).toHaveTextContent("Schnellste:r: Paula");
  expect(screen.getByTestId("easter-admin-draw")).toHaveTextContent("Verlosung: Kai (2 von 2 Losen)");
});
