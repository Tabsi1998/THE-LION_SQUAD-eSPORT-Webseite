import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// Toast „Öffnen“ der Glocke (Rest aus #1543, Muster #987): führt sofort ans Ziel und markiert als gelesen. Lehnt der
// Server ab, ist die Benachrichtigung wieder ungelesen und ein Hinweis bietet „Nochmal versuchen“ - nichts wird still
// verschluckt. Erfundene Daten.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
const live = { reload: null };
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: (callback) => { live.reload = callback; } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1", username: "neonfalke" } }) }));
const crownState = vi.hoisted(() => ({ current: {} }));
vi.mock("@/components/tls/LevelAvatarFrame", () => ({ refreshCrowns: () => Promise.resolve(crownState.current) }));
const toastMock = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { NotificationBell } = await import("./NotificationBell");

const OLD = { id: "n-1", kind: "general", title: "Alt", body: "", url: "", meta: {}, read: true, created_at: "2026-10-13T08:00:00Z" };
const FRESH = { id: "n-9", kind: "general", title: "Neue Einladung", body: "Komm ins Team", url: "/teams/t-1", meta: {}, read: false, created_at: "2026-10-14T10:00:00Z" };
const serverError = () => Object.assign(new Error("boom"), { response: { status: 500, data: {} } });

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

async function freshToast() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <NotificationBell />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(1));
  apiMock.get.mockResolvedValue({ data: [FRESH, OLD] });
  await act(async () => { await live.reload(); });
  await waitFor(() => expect(toastMock.info).toHaveBeenCalledTimes(1));
  return toastMock.info.mock.calls[0][1].action;
}

beforeEach(() => {
  vi.clearAllMocks();
  crownState.current = {};
  localStorage.removeItem("tls-crowns-celebrated");
  apiMock.get.mockResolvedValue({ data: [OLD] });
});

const ONYX = { id: "n-7", kind: "crown_onyx", title: "👑 Onyx erreicht!", body: "Du trägst jetzt die Onyx-Krone.", url: "/achievements",
  meta: { variant: "onyx", prev: "gold", category: "achievements" }, read: false, created_at: "2026-10-14T10:00:00Z" };
const GOLD = { id: "n-6", kind: "crown_gained", title: "👑 Krone erobert!", body: "Die Gold-Krone gehört dir!", url: "/achievements",
  meta: { variant: "gold", category: "achievements" }, read: false, created_at: "2026-10-14T09:00:00Z" };

const celebratedIds = () => JSON.parse(localStorage.getItem("tls-crowns-celebrated") || "[]");

/** Die Glocke mit diesen Meldungen öffnen und mitschreiben, welche Feiern sie auslöst. */
async function celebrations(rows, crown) {
  crownState.current = { "u-1": crown };
  apiMock.get.mockResolvedValue({ data: rows });
  const seen = [];
  const listen = (event) => seen.push(event.detail);
  window.addEventListener("tls-crown-celebration", listen);
  try {
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    await waitFor(() => expect(celebratedIds()).toEqual(expect.arrayContaining(rows.map((row) => row.id))));
    return seen;
  } finally {
    window.removeEventListener("tls-crown-celebration", listen);
  }
}

test("„Onyx erreicht“ feiert die Onyx-Krone wie eine eroberte Krone (#2501)", async () => {
  const seen = await celebrations([ONYX], "onyx");
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ id: "n-7", kind: "crown_onyx", variant: "onyx", body: "Du trägst jetzt die Onyx-Krone." });
});

test("Gold erobert, dann Onyx erreicht: gefeiert wird nur die neueste, beide gelten als gesehen (#2501)", async () => {
  const seen = await celebrations([ONYX, GOLD], "onyx");
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ id: "n-7", variant: "onyx" });
  expect(celebratedIds()).toEqual(expect.arrayContaining(["n-6", "n-7"]));
});

test("„Onyx erreicht“, aber heute nur Gold: keine Feier mit falscher Krone (#2501)", async () => {
  expect(await celebrations([ONYX], "gold")).toEqual([]);
});

test("„Krone erobert“, aber heute Onyx oder eine andere Krone: keine Feier (#2501)", async () => {
  expect(await celebrations([GOLD], "onyx")).toEqual([]);
  cleanup();
  localStorage.removeItem("tls-crowns-celebrated");
  expect(await celebrations([GOLD], "silver")).toEqual([]);
});

test("„Krone erobert“ mit passender Krone feiert diese Krone", async () => {
  const seen = await celebrations([GOLD], "gold");
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ id: "n-6", kind: "crown_gained", variant: "gold" });
});

test("„Öffnen“ führt ans Ziel und markiert gelesen", async () => {
  const action = await freshToast();
  expect(action.label).toBe("Öffnen");
  apiMock.post.mockResolvedValueOnce({ data: {} });
  await act(async () => { await action.onClick(); });
  expect(screen.getByTestId("where")).toHaveTextContent("/teams/t-1");
  expect(apiMock.post).toHaveBeenCalledWith("/admin/notifications/n-9/read");
  expect(toastMock.error).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByTestId("notification-unread-badge")).toBeNull());
});

test("verschwindet die Glocke, läuft das Wackeln nicht weiter", async () => {
  const started = vi.spyOn(globalThis, "setTimeout");
  const stopped = vi.spyOn(globalThis, "clearTimeout");
  await freshToast();
  const timer = started.mock.results[started.mock.calls.findIndex(([, delay]) => delay === 1900)].value;
  cleanup();
  expect(stopped).toHaveBeenCalledWith(timer);
  started.mockRestore();
  stopped.mockRestore();
});

test("lehnt der Server „gelesen“ ab, bleibt sie ungelesen und ein Hinweis bietet „Nochmal versuchen“", async () => {
  const action = await freshToast();
  apiMock.post.mockRejectedValueOnce(serverError());
  await act(async () => { await action.onClick(); });
  expect(screen.getByTestId("where")).toHaveTextContent("/teams/t-1");
  expect(screen.getByTestId("notification-unread-badge")).toHaveTextContent("1");
  expect(toastMock.error).toHaveBeenCalledTimes(1);
  const [message, options] = toastMock.error.mock.calls[0];
  expect(message).toBe("Die Benachrichtigung konnte nicht als gelesen markiert werden.");
  expect(options.action.label).toBe("Nochmal versuchen");

  apiMock.post.mockResolvedValueOnce({ data: {} });
  await act(async () => { await options.action.onClick(); });
  expect(apiMock.post).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(screen.queryByTestId("notification-unread-badge")).toBeNull());
});
