import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Zeremonie einmal je Konto (#2450): der Stand „gesehen“ kommt vom Server. Jede Art des Schließens meldet ihn sofort
// zurück (fetch mit keepalive), vor dem Anzeigen wird noch einmal gefragt, und der Altbestand des Browsers geht
// einmalig an den Server. Ohne Server-Stand (ältere Fassung) bleibt alles wie bisher im Browser.

const apiMock = { get: vi.fn(), post: vi.fn() };
const keepalive = vi.fn(() => Promise.resolve({ ok: true }));
const authState = { user: { id: "anna", ceremony_mode: "full" } };
vi.mock("@/lib/api", () => ({ api: apiMock, keepaliveRequest: (...args) => keepalive(...args) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/hooks/useLiveChanges", () => ({ useReducedMotion: () => false }));
vi.mock("./sounds", async (importOriginal) => ({ ...(await importOriginal()), playCeremonySound: vi.fn(() => true) }));

const seen = await import("./seen");
const { CeremonyHost } = await import("./CeremonyHost");
const { createCeremonyQueue } = await import("./queue");

const tier = (code) => ({ code, name: code, material: "gold", rank: 5, category: "match", points: 10 });
const serverState = (extra = {}) => ({ since: "2026-11-16T08:00:00+00:00", unseen: [], level: { level: 5, title: "", prestige: 0 }, recount_seen: [], ...extra });

beforeEach(() => {
  localStorage.clear();
  seen.resetCeremonySeen();
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  keepalive.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

function seenCalls() {
  return keepalive.mock.calls.filter(([method, path]) => method === "POST" && path === "/achievements/me/ceremony/seen").map(([, , body]) => body);
}

describe("Stand vom Server", () => {
  it("meldet den Altbestand des Browsers einmal, danach fragt er nur noch", async () => {
    localStorage.setItem(seen.achSeenKey("anna"), "2026-11-01T10:00:00.000Z");
    localStorage.setItem(seen.levelSeenKey("anna"), JSON.stringify({ level: 7, title: "Jäger", prestige: 0 }));
    localStorage.setItem(seen.recountSeenKey("anna", "2340"), "2026-11-02T10:00:00.000Z");
    localStorage.setItem(seen.recountSeenKey("bert", "9"), "2026-11-02T10:00:00.000Z");
    apiMock.post.mockResolvedValue({ data: serverState({ unseen: ["a"] }) });
    apiMock.get.mockResolvedValue({ data: serverState() });

    const first = await seen.ceremonyState("anna");
    expect(first).toEqual({ unseen: ["a"], level: { level: 5, title: "", prestige: 0 }, recountSeen: [] });
    expect(apiMock.post).toHaveBeenCalledTimes(1);
    expect(apiMock.post).toHaveBeenCalledWith("/achievements/me/ceremony/import", {
      seen_until: "2026-11-01T10:00:00.000Z", level: { level: 7, title: "Jäger", prestige: 0 }, recount_markers: ["2340"],
    });
    await seen.ceremonyState("anna");
    expect(apiMock.post).toHaveBeenCalledTimes(1);
    expect(apiMock.get).toHaveBeenCalledWith("/achievements/me/ceremony");
  });

  it("gleichzeitige Abfragen teilen sich eine Anfrage", async () => {
    apiMock.get.mockResolvedValue({ data: serverState() });
    apiMock.post.mockResolvedValue({ data: serverState() });
    const [one, two] = await Promise.all([seen.ceremonyState("anna"), seen.ceremonyState("anna")]);
    expect(one).toEqual(two);
    expect(apiMock.get).toHaveBeenCalledTimes(1);
    expect(apiMock.post).toHaveBeenCalledTimes(1);
  });

  it("älterer Server: null und kein Melden mehr - es bleibt beim Browser", async () => {
    localStorage.setItem(seen.achSeenKey("anna"), "2026-11-01T10:00:00.000Z");
    apiMock.get.mockRejectedValue({ response: { status: 404 } });
    expect(await seen.ceremonyState("anna")).toBeNull();
    expect(await seen.ceremonyState("anna")).toBeNull();
    expect(apiMock.get).toHaveBeenCalledTimes(1);
    // Auch der Altbestand geht nicht an einen Server, der ihn nicht kennt.
    expect(apiMock.post).not.toHaveBeenCalled();
    seen.markSeen("anna", { codes: ["a"] });
    expect(keepalive).not.toHaveBeenCalled();
    expect(await seen.ceremonyState(null)).toBeNull();
  });

  it("gesehen geht per keepalive an den Server und gilt sofort, auch bevor der Server es bestätigt", async () => {
    localStorage.setItem(seen.importedKey("anna"), "x");
    apiMock.get.mockResolvedValue({ data: serverState({ unseen: ["a", "b"] }) });
    seen.markSeen("anna", { codes: ["a"], level: { level: 6, title: "Rudel", prestige: 0 }, recountMarker: "2340" });
    expect(seenCalls()).toEqual([{ codes: ["a"], level: { level: 6, title: "Rudel", prestige: 0 }, recount_marker: "2340" }]);
    expect(await seen.ceremonyState("anna")).toEqual({ unseen: ["b"], level: { level: 6, title: "Rudel", prestige: 0 }, recountSeen: ["2340"] });
  });

  it("die Prüfung vor dem Anzeigen nimmt heraus, was ein anderes Gerät schon geschlossen hat", async () => {
    localStorage.setItem(seen.importedKey("anna"), "x");
    apiMock.get.mockResolvedValue({ data: serverState({ unseen: ["b"], recount_seen: ["2340"], level: { level: 6, title: "", prestige: 0 } }) });
    const check = seen.serverCheck("anna");
    expect(await check({ tiers: [tier("a"), tier("b")], context: {}, levelUp: { level: 6, prestige: 0 } })).toEqual({ tiers: [tier("b")], levelUp: null });
    expect(await check({ tiers: [tier("r")], context: { recount: true, recountMarker: "2340" }, levelUp: { level: 7, prestige: 0 } })).toEqual({ tiers: [], levelUp: { level: 7, prestige: 0 } });
    apiMock.get.mockRejectedValue(new Error("offline"));
    expect(await check({ tiers: [tier("a")] })).toBeNull();
  });
});

function renderHost(queue) {
  return render(<MemoryRouter><CeremonyHost queue={queue} /></MemoryRouter>);
}

// Ein Paket, wie AchievementCatchUp es einreiht: Schließen meldet „gesehen“, vor dem Anzeigen wird geprüft.
function enqueueSeen(queue, codes = ["a"]) {
  act(() => {
    queue.enqueue({ id: "pkg", tiers: codes.map(tier), onDone: () => seen.markSeen("anna", { codes }), check: seen.serverCheck("anna") });
  });
}

describe("jede Art des Schließens zählt als gesehen", () => {
  beforeEach(() => {
    localStorage.setItem(seen.importedKey("anna"), "x");
    apiMock.get.mockResolvedValue({ data: serverState({ unseen: ["a"] }) });
  });

  const ways = {
    "X oben rechts": () => fireEvent.click(screen.getByTestId("achievement-unlock-close")),
    "Tipp daneben": () => fireEvent.click(screen.getByTestId("achievement-unlock-overlay")),
    Escape: () => fireEvent.keyDown(document, { key: "Escape" }),
    "Zurück-Taste": () => window.dispatchEvent(new window.PopStateEvent("popstate")),
  };

  for (const [name, close] of Object.entries(ways)) {
    it(name, async () => {
      const queue = createCeremonyQueue({ now: () => 1 });
      renderHost(queue);
      enqueueSeen(queue);
      await screen.findByTestId("achievement-unlock-overlay");
      act(() => { close(); });
      expect(seenCalls()).toEqual([{ codes: ["a"] }]);
      expect(queue.getCurrent()).toBeNull();
    });
  }

  it("Ablauf zu Ende", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const queue = createCeremonyQueue({ now: () => 1 });
    renderHost(queue);
    enqueueSeen(queue);
    // Die Prüfung vor dem Anzeigen läuft über Promises - ohne Uhr.
    for (let step = 0; step < 5 && !screen.queryByTestId("achievement-unlock-overlay"); step += 1) await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("achievement-unlock-overlay")).toBeInTheDocument();
    expect(seenCalls()).toEqual([]);
    act(() => { vi.advanceTimersByTime(20000); });
    expect(seenCalls()).toEqual([{ codes: ["a"] }]);
    expect(queue.getCurrent()).toBeNull();
  });
});

describe("Prüfung vor dem Anzeigen", () => {
  it("am Server schon gesehen: keine Zeremonie, das nächste Paket kommt", async () => {
    localStorage.setItem(seen.importedKey("anna"), "x");
    apiMock.get.mockResolvedValue({ data: serverState({ unseen: ["b"] }) });
    const queue = createCeremonyQueue({ now: () => 1, bundleMs: 0 });
    renderHost(queue);
    enqueueSeen(queue, ["a"]);
    // Während der Prüfung bleibt die Bühne leer.
    expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull();
    await waitFor(() => expect(queue.getCurrent()).toBeNull());
    expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull();
    act(() => { queue.enqueue({ id: "zwei", tiers: [tier("b")], check: seen.serverCheck("anna") }); });
    expect(await screen.findByTestId("achievement-unlock-overlay")).toBeInTheDocument();
  });

  it("ohne Server-Stand zeigt die Bühne das Paket wie bisher", async () => {
    apiMock.get.mockRejectedValue({ response: { status: 404 } });
    const queue = createCeremonyQueue({ now: () => 1 });
    renderHost(queue);
    enqueueSeen(queue, ["a"]);
    expect(await screen.findByTestId("achievement-unlock-overlay")).toBeInTheDocument();
  });
});

describe("Warteschlange", () => {
  it("zusammengelegte Pakete melden beide „gesehen“", () => {
    const queue = createCeremonyQueue({ now: () => 1 });
    const first = vi.fn();
    const second = vi.fn();
    const level = vi.fn();
    queue.enqueue({ id: "laufend", tiers: [tier("x")] });
    queue.enqueue({ id: "eins", tiers: [tier("a")], onDone: first });
    queue.enqueue({ id: "zwei", tiers: [tier("b")], onDone: second });
    queue.advance();
    queue.enqueue({ tiers: [], levelUp: { level: 3 }, onDone: level });
    queue.advance();
    expect([first, second, level].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1]);
  });
});
