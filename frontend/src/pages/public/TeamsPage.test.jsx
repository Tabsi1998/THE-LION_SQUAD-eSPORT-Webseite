import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Team-Seite: Termine und letzte Spiele (#1191), „Einladen“ mit Link und QR-Code, Beitreten über den Link.
// Erfundene Daten, keine echten Personen.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback, resolveMediaUrl: (v) => v || "" }));
const authState = { user: null, isAdmin: false };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/BrandedQRCode", () => ({ BrandedQRCode: ({ value }) => <div data-testid="branded-qr-code" data-value={value} /> }));
const confirmMock = vi.fn();
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/hooks/useChats", () => ({ useChatRead: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/hooks/useTilt", () => ({ useTilt: () => null }));
vi.mock("@/pages/user/profile/TeamsPanel", () => ({ TeamsPanel: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: TeamsPage } = await import("./TeamsPage");

const MEMBERS = [
  { id: "u-cap", username: "neonfalke", display_name: "NeonFalke" },
  { id: "u-co", username: "pixelpanther", display_name: "PixelPanther" },
  { id: "u-3", username: "lunabyte", display_name: "LunaByte" },
];
const TEAM = {
  id: "t-1", name: "Lions Rocket", tag: "LRK", leader_id: "u-cap", co_leader_ids: ["u-co"], member_ids: MEMBERS.map((m) => m.id),
  members: MEMBERS, is_member: true, can_manage: true, join_code: "Kx7pQ2", awards: [],
};
const OVERVIEW = {
  upcoming: [{ registration_id: "r-1", status: "approved", status_label: "Angemeldet", tournament: { id: "tt-1", slug: "rl-herbst", title: "Rocket League Herbst-Cup", start_date: "2026-10-17T14:00:00Z" } }],
  recent: [{ match_id: "m-1", kind: "duel", outcome: "win", score: "3:1", opponent: "Pixelpiraten", round_label: "Finale", tournament: { title: "Liga Herbst" } }],
};

function serve(team = TEAM, extra = {}) {
  apiMock.get.mockImplementation(async (url) => {
    if (url in extra) {
      const value = extra[url];
      if (value instanceof Error) throw value;
      return { data: value };
    }
    if (url === "/teams/t-1") return { data: team };
    if (url === "/teams/t-1/overview") return { data: OVERVIEW };
    if (url === "/teams/t-1/invite-link") return { data: { url: "https://lionsquad.at/teams/t-1?einladung=AbC123", token: "AbC123" } };
    if (url === "/teams/t-1/level") throw new Error("kein Level");
    if (url === "/teams/t-1/chat") return { data: [] };
    return { data: {} };
  });
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/teams/:id" element={<TeamsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  confirmMock.mockReset();
  authState.user = { id: "u-cap", username: "neonfalke" };
});

test("Team-Seite: Angemeldet für und Letzte Spiele; Einladen öffnet Link mit QR-Code", async () => {
  serve();
  renderAt("/teams/t-1");
  expect(await screen.findByTestId("team-upcoming")).toHaveTextContent("Rocket League Herbst-Cup");
  expect(screen.getByTestId("team-recent")).toHaveTextContent("3:1 gegen Pixelpiraten");
  fireEvent.click(screen.getByTestId("team-invite-open"));
  await waitFor(() => expect(screen.getByTestId("branded-qr-code")).toHaveAttribute("data-value", "https://lionsquad.at/teams/t-1?einladung=AbC123"));
  expect(screen.getByTestId("team-join-code-box")).toHaveTextContent("Kx7pQ2");
});

test("Einladungs-Link für ein privates Team: nur die Einladung mit „Beitreten“", async () => {
  authState.user = { id: "u-9", username: "kiwikomet" };
  const missing = Object.assign(new Error("404"), { response: { status: 404 } });
  serve(TEAM, {
    "/teams/t-1": missing,
    "/teams/t-1/invite-link/check": { valid: true, already_member: false, team: { name: "Lions Rocket", member_count: 3 } },
  });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  renderAt("/teams/t-1?einladung=AbC123");
  expect(await screen.findByText("Du bist eingeladen: Lions Rocket")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("team-join-invite-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/teams/t-1/join-link", { token: "AbC123" }));
});

// „Löschen“ nicht neben „Bearbeiten“ (#1274): oben nur Einladen und Bearbeiten; „Team auflösen“ ganz unten im
// Bearbeiten-Blatt, mit einem Satz, was passiert, und erst mit dem richtig eingetippten Teamnamen.
test("oben nur Einladen und Bearbeiten - kein roter Lösch-Knopf", async () => {
  serve();
  renderAt("/teams/t-1");
  await screen.findByTestId("team-header-actions");
  expect(screen.getByTestId("team-invite-open")).toHaveTextContent("Einladen");
  expect(screen.getByTestId("team-edit-open")).toHaveTextContent("Bearbeiten");
  expect(screen.queryByTestId("team-delete")).toBeNull();
  expect(screen.getByTestId("team-header-actions").querySelector(".tls-btn--danger")).toBeNull();
});

test("Auflösen im Bearbeiten-Blatt: falscher Name sperrt, richtiger Name löst auf", async () => {
  serve(TEAM, {
    "/teams/t-1/dissolve-preview": { member_count: 3, chat_messages: 4, withdraw: [{ registration_id: "r-1", tournament_id: "tt-1", title: "Rocket League Herbst-Cup" }], blocked: [], can_dissolve: true },
  });
  apiMock.delete.mockResolvedValue({ data: { ok: true, withdrawn: 1 } });
  renderAt("/teams/t-1");
  fireEvent.click(await screen.findByTestId("team-edit-open"));
  const sheet = await screen.findByTestId("team-edit-sheet");
  await waitFor(() => expect(screen.getByTestId("team-dissolve-sentence")).toHaveTextContent("Alle 3 Mitglieder verlieren das Team, der Team-Chat mit 4 Nachrichten wird gelöscht und die Anmeldung für „Rocket League Herbst-Cup“ wird zurückgezogen."));
  // Das Auflösen steht nach dem Formular, ganz unten im Blatt.
  const order = [...sheet.querySelectorAll("[data-testid]")].map((node) => node.getAttribute("data-testid"));
  expect(order.indexOf("team-dissolve")).toBeGreaterThan(order.indexOf("team-color-picker"));
  const submit = screen.getByTestId("team-dissolve-submit");
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByTestId("team-dissolve-name"), { target: { value: "Lions" } });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByTestId("team-dissolve-name"), { target: { value: "lions rocket" } });
  expect(submit).not.toBeDisabled();
  fireEvent.click(submit);
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/teams/t-1", { params: { confirm: "lions rocket" } }));
});

test("läuft ein Turnier, bleibt Auflösen gesperrt und das Turnier steht da; Co-Kapitäne sehen das Auflösen nicht", async () => {
  serve(TEAM, {
    "/teams/t-1/dissolve-preview": { member_count: 3, chat_messages: 0, withdraw: [], blocked: [{ registration_id: "r-9", tournament_id: "tt-9", slug: "liga", title: "Liga live", reason: "Das Turnier läuft gerade – das klärt die Turnierleitung." }], can_dissolve: false },
  });
  const { unmount } = renderAt("/teams/t-1");
  fireEvent.click(await screen.findByTestId("team-edit-open"));
  expect(await screen.findByTestId("team-dissolve-blocked")).toHaveTextContent("Liga live");
  fireEvent.change(screen.getByTestId("team-dissolve-name"), { target: { value: "Lions Rocket" } });
  expect(screen.getByTestId("team-dissolve-submit")).toBeDisabled();
  unmount();

  authState.user = { id: "u-co", username: "pixelpanther" };
  serve();
  renderAt("/teams/t-1");
  fireEvent.click(await screen.findByTestId("team-edit-open"));
  await screen.findByTestId("team-edit-sheet");
  expect(screen.queryByTestId("team-dissolve")).toBeNull();
});
