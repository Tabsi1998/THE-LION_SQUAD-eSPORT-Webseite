import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ConfirmDialogProvider } from "@/components/tls/ConfirmDialog";

// /messages heißt jetzt „Chats“ (#1148): alle vier Arten in einer Liste, das Neueste oben, mit der Zahl der Ungelesenen.
// Direktnachrichten öffnen rechts (am Handy als eigene Ansicht), Gruppen-Chats führen auf ihre Seite zum Chat.

const apiMock = { get: vi.fn(), post: vi.fn(async () => ({ data: { ok: true } })), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (e, f) => f, resolveMediaUrl: (v) => v || "" }));
const auth = { user: { id: "u-neon", username: "neonfalke" } };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
const toastMock = { error: vi.fn(), success: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));
// Die Live-Aktualisierung merkt sich jeden Rückruf, den die Seite übergibt - so lässt sich ein Nachladen auslösen,
// das noch zum vorigen Gespräch gehört.
const liveCallbacks = [];
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: (callback, resources, options = {}) => { if (options.enabled !== false) liveCallbacks.push(callback); } }));

const { default: MessagesPage } = await import("./MessagesPage");

const CHATS = {
  items: [
    { key: "team:t-rocket", kind: "team", target_id: "t-rocket", title: "Lions Rocket", subtitle: "Team-Chat", last_message: { text: "Training heute um 20 Uhr", author: "LunaByte", created_at: "2026-10-07T12:02:00Z" }, unread_count: 2, updated_at: "2026-10-07T12:02:00Z" },
    { key: "tournament:fc26", kind: "tournament", target_id: "fc26", slug: "fc-26-cup", title: "FC 26 Cup", subtitle: "Turnier-Chat", last_message: { text: "Halbfinale ab 15 Uhr", author: "Turnierleitung", created_at: "2026-10-07T11:40:00Z" }, unread_count: 0, updated_at: "2026-10-07T11:40:00Z" },
    { key: "direct:u-schatten", kind: "direct", target_id: "u-schatten", title: "Schattenwolf", subtitle: "Nachricht", last_message: { text: "gg! Revanche?", author: "Schattenwolf", created_at: "2026-10-07T10:15:00Z" }, unread_count: 1, updated_at: "2026-10-07T10:15:00Z" },
    { key: "match:m-1", kind: "match", target_id: "m-1", title: "NeonFalke gegen PixelPanther", subtitle: "Match-Chat", last_message: { text: "PC 3 ist frei", author: "PixelPanther", created_at: "2026-10-07T09:58:00Z" }, unread_count: 0, updated_at: "2026-10-07T09:58:00Z" },
  ],
};

function tree(path) {
  return (
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

function renderAt(path) {
  return render(tree(path));
}

beforeEach(() => {
  auth.user = { id: "u-neon", username: "neonfalke" };
  liveCallbacks.length = 0;
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.post.mockImplementation(async () => ({ data: { ok: true } }));
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

// Gesprächswechsel (#1047): Entwürfe, Antworten und Gelesen-Marken gehören zu genau einem Gespräch.

const PEERS = {
  "u-schatten": { id: "u-schatten", username: "schattenwolf", display_name: "Schattenwolf" },
  "u-pixel": { id: "u-pixel", username: "pixelpanther", display_name: "PixelPanther" },
};
const TWO_CHATS = {
  items: [
    { key: "direct:u-schatten", kind: "direct", target_id: "u-schatten", title: "Schattenwolf", subtitle: "Nachricht", last_message: null, unread_count: 0, updated_at: "2026-10-07T10:15:00Z" },
    { key: "direct:u-pixel", kind: "direct", target_id: "u-pixel", title: "PixelPanther", subtitle: "Nachricht", last_message: null, unread_count: 0, updated_at: "2026-10-07T09:15:00Z" },
  ],
};

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function conversation(peerId, messages = [], hasMore = false) {
  return { data: { user: PEERS[peerId], can_send: true, messages, has_more: hasMore } };
}

function message(id, senderId, text) {
  return { id, sender_id: senderId, recipient_id: senderId === "u-neon" ? "u-x" : "u-neon", message: text, created_at: "2026-10-07T10:00:00Z" };
}

function stubTwoChats(overrides = {}) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/chats") return { data: TWO_CHATS };
    for (const [prefix, handler] of Object.entries(overrides)) {
      if (String(url).startsWith(prefix)) return handler(url);
    }
    const peer = String(url).match(/^\/messages\/direct\/([^?]+)/)?.[1];
    if (peer) return conversation(peer);
    return { data: [] };
  });
}

let urlSpies = [];
beforeEach(() => {
  urlSpies = [
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:vorschau"),
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {}),
  ];
});
afterEach(() => {
  urlSpies.forEach((spy) => spy.mockRestore());
});

const heading = (name) => screen.findByText(name, { selector: ".font-heading" });

async function openPeer(peerId, name) {
  fireEvent.click(await screen.findByTestId(`conversation-item-${peerId}`));
  await heading(name);
}

function attachImage(name = "bild.png") {
  const file = new File(["x"], name, { type: "image/png" });
  fireEvent.change(screen.getByTestId("direct-chat-attach-input"), { target: { files: [file] } });
}

async function draftReady() {
  await waitFor(() => expect(screen.getByTestId("chat-attachment-drafts").querySelector('[data-status="ready"]')).not.toBeNull());
}

test("Entwurf in A, Wechsel zu B: das Feld ist leer und es hängt nichts an", async () => {
  stubTwoChats();
  apiMock.post.mockImplementation(async (url) => (url === "/chat-attachments" ? { data: { id: "att-a", kind: "image" } } : { data: { ok: true } }));
  const user = userEvent.setup();
  renderAt("/messages/u-schatten");
  await heading("Schattenwolf");
  await user.type(screen.getByTestId("direct-chat-input"), "nur für Schattenwolf");
  attachImage();
  await draftReady();

  await openPeer("u-pixel", "PixelPanther");

  expect(screen.getByTestId("direct-chat-input")).toHaveValue("");
  expect(screen.queryByTestId("chat-attachment-drafts")).not.toBeInTheDocument();
});

test("Senden in B schickt nur den Entwurf von B", async () => {
  stubTwoChats();
  apiMock.post.mockImplementation(async (url) => {
    if (url === "/chat-attachments") return { data: { id: "att-a", kind: "image" } };
    if (url === "/messages/direct/u-pixel") return { data: message("m-b", "u-neon", "hallo Pixel") };
    return { data: { ok: true } };
  });
  const user = userEvent.setup();
  renderAt("/messages/u-schatten");
  await heading("Schattenwolf");
  await user.type(screen.getByTestId("direct-chat-input"), "nur für Schattenwolf");
  attachImage();
  await draftReady();

  await openPeer("u-pixel", "PixelPanther");
  await user.type(screen.getByTestId("direct-chat-input"), "hallo Pixel");
  await user.click(screen.getByTestId("direct-chat-send"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/messages/direct/u-pixel", { message: "hallo Pixel", attachment_ids: [] }));
  expect(apiMock.post).not.toHaveBeenCalledWith("/messages/direct/u-schatten", expect.anything());
});

test("ein Anhang, der erst nach dem Wechsel fertig hochgeladen ist, landet nicht in B", async () => {
  stubTwoChats();
  const upload = deferred();
  apiMock.post.mockImplementation(async (url) => {
    if (url === "/chat-attachments") return upload.promise;
    if (url === "/messages/direct/u-pixel") return { data: message("m-b", "u-neon", "hallo Pixel") };
    return { data: { ok: true } };
  });
  const user = userEvent.setup();
  renderAt("/messages/u-schatten");
  await heading("Schattenwolf");
  attachImage();
  expect(await screen.findByTestId("chat-attachment-drafts")).toBeInTheDocument();

  await openPeer("u-pixel", "PixelPanther");
  await act(async () => upload.resolve({ data: { id: "att-a", kind: "image" } }));

  expect(screen.queryByTestId("chat-attachment-drafts")).not.toBeInTheDocument();
  await user.type(screen.getByTestId("direct-chat-input"), "hallo Pixel");
  await user.click(screen.getByTestId("direct-chat-send"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/messages/direct/u-pixel", { message: "hallo Pixel", attachment_ids: [] }));
});

test("eine verspätete Antwort für A ändert B nicht und markiert A nicht als gelesen", async () => {
  const late = deferred();
  stubTwoChats({ "/messages/direct/u-schatten": () => late.promise });
  renderAt("/messages/u-schatten");
  await openPeer("u-pixel", "PixelPanther");
  apiMock.post.mockClear();

  await act(async () => late.resolve(conversation("u-schatten", [message("m-a", "u-schatten", "Nachricht aus Chat A")])));

  expect(screen.getByText("PixelPanther", { selector: ".font-heading" })).toBeInTheDocument();
  expect(screen.queryByTestId("conversation-message-m-a")).not.toBeInTheDocument();
  expect(apiMock.post).not.toHaveBeenCalledWith("/chats/direct/u-schatten/read");
});

test("ein Nachladen, das noch zu A gehört, ändert B nicht", async () => {
  stubTwoChats();
  renderAt("/messages/u-schatten");
  await heading("Schattenwolf");
  const pollForA = liveCallbacks[liveCallbacks.length - 1];
  await openPeer("u-pixel", "PixelPanther");
  stubTwoChats({ "/messages/direct/u-schatten": async () => conversation("u-schatten", [message("m-a", "u-schatten", "Nachricht aus Chat A")]) });
  apiMock.post.mockClear();

  await act(async () => { await pollForA(); });

  expect(screen.getByText("PixelPanther", { selector: ".font-heading" })).toBeInTheDocument();
  expect(screen.queryByTestId("conversation-message-m-a")).not.toBeInTheDocument();
  expect(apiMock.post).not.toHaveBeenCalledWith("/chats/direct/u-schatten/read");
});

test("ältere Nachrichten von A landen nach dem Wechsel nicht in B", async () => {
  const older = deferred();
  stubTwoChats({
    "/messages/direct/u-schatten?before=": () => older.promise,
    "/messages/direct/u-schatten": async () => conversation("u-schatten", [message("m-a2", "u-schatten", "neu in A")], true),
  });
  renderAt("/messages/u-schatten");
  await screen.findByTestId("conversation-message-m-a2");
  fireEvent.click(screen.getByTestId("conversation-load-older"));
  await openPeer("u-pixel", "PixelPanther");

  await act(async () => older.resolve({ data: { messages: [message("m-a1", "u-schatten", "alt in A")], has_more: false } }));

  expect(screen.queryByTestId("conversation-message-m-a1")).not.toBeInTheDocument();
  expect(screen.queryByTestId("conversation-message-m-a2")).not.toBeInTheDocument();
});

test("eine verspätete Sende-Antwort aus A lässt den Entwurf in B stehen", async () => {
  stubTwoChats();
  const sent = deferred();
  apiMock.post.mockImplementation(async (url) => (url === "/messages/direct/u-schatten" ? sent.promise : { data: { ok: true } }));
  const user = userEvent.setup();
  renderAt("/messages/u-schatten");
  await heading("Schattenwolf");
  await user.type(screen.getByTestId("direct-chat-input"), "an A");
  await user.click(screen.getByTestId("direct-chat-send"));
  await openPeer("u-pixel", "PixelPanther");
  await user.type(screen.getByTestId("direct-chat-input"), "Entwurf für B");

  await act(async () => sent.resolve({ data: message("m-a", "u-neon", "an A") }));

  expect(screen.getByTestId("direct-chat-input")).toHaveValue("Entwurf für B");
  expect(screen.queryByTestId("conversation-message-m-a")).not.toBeInTheDocument();
});

test("ein Kontowechsel leert Entwurf, Anhänge und Chatliste", async () => {
  stubTwoChats();
  apiMock.post.mockImplementation(async (url) => (url === "/chat-attachments" ? { data: { id: "att-a", kind: "image" } } : { data: { ok: true } }));
  const user = userEvent.setup();
  const view = renderAt("/messages/u-schatten");
  await heading("Schattenwolf");
  await screen.findByTestId("conversation-item-u-pixel");
  await user.type(screen.getByTestId("direct-chat-input"), "privat");
  attachImage();
  await draftReady();

  const chatsForOther = deferred();
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/chats") return chatsForOther.promise;
    const peer = String(url).match(/^\/messages\/direct\/([^?]+)/)?.[1];
    return peer ? conversation(peer) : { data: [] };
  });
  auth.user = { id: "u-other", username: "anderes-konto" };
  view.rerender(tree("/messages/u-schatten"));

  await waitFor(() => expect(screen.getByTestId("direct-chat-input")).toHaveValue(""));
  expect(screen.queryByTestId("chat-attachment-drafts")).not.toBeInTheDocument();
  expect(screen.queryByTestId("conversation-item-u-pixel")).not.toBeInTheDocument();
  await act(async () => chatsForOther.resolve({ data: { items: [] } }));
});

test("ein Kontowechsel leert die Namenssuche, und eine überholte Suchantwort verfällt", async () => {
  stubTwoChats();
  const lateSearch = deferred();
  const searchFor = vi.fn(() => lateSearch.promise);
  stubTwoChats({ "/messages/users": searchFor });
  const user = userEvent.setup();
  const view = renderAt("/messages");
  await screen.findByTestId("conversation-item-u-pixel");
  await user.type(screen.getByTestId("messages-search"), "pix");
  await waitFor(() => expect(searchFor).toHaveBeenCalled());

  auth.user = { id: "u-other", username: "anderes-konto" };
  view.rerender(tree("/messages"));
  await act(async () => lateSearch.resolve({ data: [{ id: "u-pixel", username: "pixelpanther", display_name: "PixelPanther", can_message: true }] }));

  expect(screen.getByTestId("messages-search")).toHaveValue("");
  expect(screen.queryByTestId("messages-candidate-u-pixel")).not.toBeInTheDocument();
});

test("ein Fehler beim Senden aus A meldet sich nicht mehr, wenn B offen ist", async () => {
  stubTwoChats();
  let failA;
  const sentA = new Promise((_, reject) => { failA = reject; });
  apiMock.post.mockImplementation(async (url) => (url === "/messages/direct/u-schatten" ? sentA : { data: { ok: true } }));
  toastMock.error.mockClear();
  const user = userEvent.setup();
  renderAt("/messages/u-schatten");
  await heading("Schattenwolf");
  await user.type(screen.getByTestId("direct-chat-input"), "an A");
  await user.click(screen.getByTestId("direct-chat-send"));
  await openPeer("u-pixel", "PixelPanther");

  await act(async () => failA(new Error("offline")));

  expect(toastMock.error).not.toHaveBeenCalled();
});

test("die Anmeldung lädt erst nach der Seite: Entwurf und erster Stand bleiben", async () => {
  auth.user = undefined;
  stubTwoChats();
  const user = userEvent.setup();
  const view = renderAt("/messages/u-schatten");
  await heading("Schattenwolf");
  await user.type(screen.getByTestId("direct-chat-input"), "schon getippt");
  const loads = apiMock.get.mock.calls.filter(([url]) => String(url).startsWith("/messages/direct/u-schatten")).length;

  auth.user = { id: "u-neon", username: "neonfalke" };
  view.rerender(tree("/messages/u-schatten"));
  await screen.findByTestId("conversation-item-u-pixel");

  expect(screen.getByTestId("direct-chat-input")).toHaveValue("schon getippt");
  expect(apiMock.get.mock.calls.filter(([url]) => String(url).startsWith("/messages/direct/u-schatten"))).toHaveLength(loads);
});
