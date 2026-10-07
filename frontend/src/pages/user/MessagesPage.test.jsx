import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ConfirmDialogProvider } from "@/components/tls/ConfirmDialog";

// /messages heißt jetzt „Chats“ (#1148): alle vier Arten in einer Liste, das Neueste oben, mit der Zahl der Ungelesenen.
// Direktnachrichten öffnen rechts (am Handy als eigene Ansicht), Gruppen-Chats führen auf ihre Seite zum Chat.

const apiMock = { get: vi.fn(), post: vi.fn(async () => ({ data: { ok: true } })), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (e, f) => f, resolveMediaUrl: (v) => v || "" }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-neon", username: "neonfalke" } }) }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));

const { default: MessagesPage } = await import("./MessagesPage");

const CHATS = {
  items: [
    { key: "team:t-rocket", kind: "team", target_id: "t-rocket", title: "Lions Rocket", subtitle: "Team-Chat", last_message: { text: "Training heute um 20 Uhr", author: "LunaByte", created_at: "2026-10-07T12:02:00Z" }, unread_count: 2, updated_at: "2026-10-07T12:02:00Z" },
    { key: "tournament:fc26", kind: "tournament", target_id: "fc26", slug: "fc-26-cup", title: "FC 26 Cup", subtitle: "Turnier-Chat", last_message: { text: "Halbfinale ab 15 Uhr", author: "Turnierleitung", created_at: "2026-10-07T11:40:00Z" }, unread_count: 0, updated_at: "2026-10-07T11:40:00Z" },
    { key: "direct:u-schatten", kind: "direct", target_id: "u-schatten", title: "Schattenwolf", subtitle: "Nachricht", last_message: { text: "gg! Revanche?", author: "Schattenwolf", created_at: "2026-10-07T10:15:00Z" }, unread_count: 1, updated_at: "2026-10-07T10:15:00Z" },
    { key: "match:m-1", kind: "match", target_id: "m-1", title: "NeonFalke gegen PixelPanther", subtitle: "Match-Chat", last_message: { text: "PC 3 ist frei", author: "PixelPanther", created_at: "2026-10-07T09:58:00Z" }, unread_count: 0, updated_at: "2026-10-07T09:58:00Z" },
  ],
};

function renderAt(path) {
  return render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/messages/:userId" element={<MessagesPage />} />
        </Routes>
      </MemoryRouter>
    </ConfirmDialogProvider>
  );
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockClear();
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/chats") return { data: CHATS };
    if (String(url).startsWith("/messages/direct/u-schatten")) return { data: { user: { id: "u-schatten", username: "schattenwolf", display_name: "Schattenwolf" }, can_send: true, messages: [], has_more: false } };
    return { data: [] };
  });
});

test("alle vier Arten in einer Liste, das Neueste oben; Gruppen-Chats führen auf ihre Seite", async () => {
  renderAt("/messages");
  expect(await screen.findByRole("heading", { name: "Chats" })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId("chat-item-team:t-rocket")).toBeInTheDocument());
  const order = [...document.querySelectorAll('[data-testid^="chat-item-"], [data-testid^="conversation-item-"]')].map((node) => node.getAttribute("data-testid"));
  expect(order).toEqual(["chat-item-team:t-rocket", "chat-item-tournament:fc26", "conversation-item-u-schatten", "chat-item-match:m-1"]);
  expect(screen.getByTestId("chat-item-team:t-rocket")).toHaveAttribute("href", "/teams/t-rocket#chat");
  expect(screen.getByTestId("chat-item-tournament:fc26")).toHaveAttribute("href", "/tournaments/fc-26-cup#chat");
  expect(screen.getByTestId("chat-item-match:m-1")).toHaveAttribute("href", "/matches/m-1#chat");
  expect(screen.getByTestId("chat-unread-team:t-rocket")).toHaveTextContent("2");
  expect(within(screen.getByTestId("chat-item-team:t-rocket")).getByText("Team-Chat · LunaByte: Training heute um 20 Uhr")).toBeInTheDocument();
});

test("eine Direktnachricht öffnet rechts und gilt als gelesen", async () => {
  renderAt("/messages/u-schatten");
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/chats/direct/u-schatten/read"));
  expect(await screen.findByTestId("conversation-item-u-schatten")).toHaveAttribute("aria-current", "true");
});
