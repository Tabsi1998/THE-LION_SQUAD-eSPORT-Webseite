import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Spieler-Suche (#984, #985): nur die Antwort auf den aktuellen Begriff zählt, ein Fehler ist kein „Keine Spieler
// gefunden“. Erfundene Daten.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <main>{children}</main> }));
vi.mock("@/components/tls/Reveal", () => ({ Reveal: ({ children, className }) => <div className={className}>{children}</div> }));
vi.mock("@/components/tls/LevelAvatarFrame", () => ({ LevelAvatarFrame: ({ children }) => <div>{children}</div>, useCrowns: () => ({}) }));
vi.mock("@/pages/user/profile/FriendsPanel", () => ({ FriendsPanel: () => null }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

const { default: PlayersPage } = await import("./PlayersPage");

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

const page = (...names) => ({ data: { items: names.map((username) => ({ id: `u-${username}`, username })), total: names.length } });

function renderPage() {
  return render(<MemoryRouter><PlayersPage /></MemoryRouter>);
}

beforeEach(() => {
  apiMock.get.mockReset();
});

test("Suche A langsam, B schnell: die spätere Antwort für A ändert die Treffer für B nicht", async () => {
  const slowA = deferred();
  apiMock.get.mockImplementation((url, config = {}) => {
    if (url === "/membership/public") return Promise.resolve({ data: [] });
    const q = config.params?.q;
    if (q === "pi") return slowA.promise;
    if (q === "pix") return Promise.resolve(page("pixelpanther"));
    return Promise.resolve(page("neonfalke", "lunabyte"));
  });
  renderPage();
  expect(await screen.findByTestId("player-card-neonfalke")).toBeInTheDocument();
  const input = screen.getByTestId("players-search");
  fireEvent.change(input, { target: { value: "pi" } });
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/users/public-list", expect.objectContaining({ params: expect.objectContaining({ q: "pi" }) })));
  fireEvent.change(input, { target: { value: "pix" } });
  expect(await screen.findByTestId("player-card-pixelpanther")).toBeInTheDocument();
  await act(async () => slowA.resolve(page("pilzkopf")));
  expect(screen.queryByTestId("player-card-pilzkopf")).toBeNull();
  expect(screen.getByTestId("player-card-pixelpanther")).toBeInTheDocument();
});

test("ein Fehler der Spielerliste zeigt den Fehler mit „Nochmal versuchen“ statt „Keine Spieler gefunden“", async () => {
  apiMock.get.mockImplementation((url) => (url === "/membership/public"
    ? Promise.resolve({ data: [] })
    : Promise.reject(Object.assign(new Error("boom"), { response: { status: 500, data: {} } }))));
  renderPage();
  expect(await screen.findByTestId("public-error-state")).toHaveTextContent("Spieler konnten nicht geladen werden");
  expect(screen.queryByText("Keine Spieler gefunden.")).toBeNull();
});

test("erfolgreich ohne Treffer: „Keine Spieler gefunden.“", async () => {
  apiMock.get.mockImplementation((url) => Promise.resolve(url === "/membership/public" ? { data: [] } : page()));
  renderPage();
  expect(await screen.findByText("Keine Spieler gefunden.")).toBeInTheDocument();
});
