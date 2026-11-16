import { act, render, waitFor } from "@testing-library/react";

// Zeremonie einmal je Konto (#2450): Erfolge und Level-Aufstiege richten sich nach dem Stand am Server. Was dort schon
// gesehen ist, kommt nicht noch einmal; der Altbestand des Browsers geht einmal an den Server; nach dem Deploy gibt es
// keine Flut alter Erfolge; jedes Schließen meldet „gesehen“.

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), keepalive: vi.fn(() => Promise.resolve({})), user: { id: "anna" }, ceremonies: [], levels: [] }));
vi.mock("@/lib/api", () => ({ api: { get: (...args) => mocks.get(...args), post: (...args) => mocks.post(...args) }, keepaliveRequest: (...args) => mocks.keepalive(...args) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/components/achievements/ceremony/queue", () => ({
  enqueueCeremony: (tiers, context, options) => { mocks.ceremonies.push({ codes: tiers.map((tier) => tier.code), context, options }); },
  enqueueLevelUp: (levelUp, options) => { mocks.levels.push({ levelUp, options }); },
}));

const { AchievementCatchUp } = await import("./AchievementCatchUp");
const { LevelUpCelebration } = await import("./LevelUpCelebration");
const seen = await import("@/components/achievements/ceremony/seen");

const tier = (code, earnedAt, extra = {}) => ({ code, name: code, material: "bronze", earned: true, earned_at: earnedAt, ...extra });
const groups = (...tiers) => [{ code: "bats", name: "Fledermaus", category: "community", tiers }];
const serverState = (extra = {}) => ({ since: "2026-11-16T08:00:00+00:00", unseen: [], level: { level: 5, title: "", prestige: 0 }, recount_seen: [], ...extra });

function answer({ me = {}, state = serverState(), level = { level: 5, title: "", prestige: 0 } } = {}) {
  mocks.get.mockImplementation(async (url) => {
    if (url === "/achievements/me") return { data: me };
    if (url === "/achievements/me/ceremony") return { data: state };
    if (url === "/users/me/level") return { data: level };
    throw new Error(`unerwartet: ${url}`);
  });
  mocks.post.mockResolvedValue({ data: state });
}

function seenBodies() {
  return mocks.keepalive.mock.calls.filter(([, path]) => path === "/achievements/me/ceremony/seen").map(([, , body]) => body);
}

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

beforeEach(() => {
  localStorage.clear();
  seen.resetCeremonySeen();
  mocks.get.mockReset();
  mocks.post.mockReset();
  mocks.keepalive.mockClear();
  mocks.ceremonies.length = 0;
  mocks.levels.length = 0;
  mocks.user = { id: "anna" };
});

describe("Erfolge", () => {
  it("holt nach, was am Server offen ist - nicht, was der Browser für neu hält", async () => {
    // Der Browser kennt einen alten Merker, am Server ist aber nur bats_3 offen: bats_2 hat ein anderes Gerät gezeigt.
    localStorage.setItem(seen.achSeenKey("anna"), "2026-10-01T00:00:00Z");
    localStorage.setItem(seen.importedKey("anna"), "x");
    answer({ me: { groups: groups(tier("bats_1", "2026-09-01T10:00:00Z"), tier("bats_2", "2026-11-10T10:00:00Z"), tier("bats_3", "2026-11-12T10:00:00Z")) }, state: serverState({ unseen: ["bats_3"] }) });
    render(<AchievementCatchUp />);
    await waitFor(() => expect(mocks.ceremonies).toHaveLength(1));
    expect(mocks.ceremonies[0].codes).toEqual(["bats_3"]);
    expect(mocks.ceremonies[0].context).toMatchObject({ catchUp: true, heading: "Während du weg warst!" });
    expect(typeof mocks.ceremonies[0].options.check).toBe("function");
    // Geschlossen: gesehen geht an den Server.
    expect(seenBodies()).toEqual([]);
    mocks.ceremonies[0].options.onDone();
    expect(seenBodies()).toEqual([{ codes: ["bats_3"] }]);
  });

  it("am Server bereits gesehen: keine Zeremonie - auch wenn der Merker im Browser sie für neu hält", async () => {
    localStorage.setItem(seen.achSeenKey("anna"), "2026-10-01T00:00:00Z");
    localStorage.setItem(seen.importedKey("anna"), "x");
    answer({ me: { groups: groups(tier("bats_1", "2026-11-12T10:00:00Z")) }, state: serverState({ unseen: [] }) });
    render(<AchievementCatchUp />);
    await settle();
    expect(mocks.ceremonies).toEqual([]);
  });

  it("keine Flut nach dem Deploy: ein Browser ohne Merker zeigt keine alten Erfolge, wenn der Server nichts offen hat", async () => {
    const many = Array.from({ length: 30 }, (_, n) => tier(`bats_${n}`, `2026-0${1 + (n % 9)}-01T10:00:00Z`));
    answer({ me: { groups: groups(...many) }, state: serverState({ unseen: [] }) });
    render(<AchievementCatchUp />);
    await settle();
    expect(mocks.post).toHaveBeenCalledWith("/achievements/me/ceremony/import", {});
    expect(mocks.ceremonies).toEqual([]);
  });

  it("der Altbestand des Browsers geht einmal an den Server, danach zählt nur noch er", async () => {
    localStorage.setItem(seen.achSeenKey("anna"), "2026-11-01T00:00:00Z");
    localStorage.setItem(seen.recountSeenKey("anna", "2340"), "2026-11-02T00:00:00Z");
    answer({ me: { groups: groups(tier("bats_1", "2026-11-12T10:00:00Z")) }, state: serverState({ unseen: [] }) });
    const first = render(<AchievementCatchUp />);
    await settle();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0][1]).toEqual({ seen_until: "2026-11-01T00:00:00Z", recount_markers: ["2340"] });
    // Der Browser hielte bats_1 für neu (nach seinem Merker) - der Server sagt nein.
    expect(mocks.ceremonies).toEqual([]);
    first.unmount();
    render(<AchievementCatchUp />);
    await settle();
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it("viele offene: gezeigt werden die neuesten acht, gesehen ist danach alles Offene", async () => {
    localStorage.setItem(seen.importedKey("anna"), "x");
    const open = Array.from({ length: 10 }, (_, n) => tier(`bats_${n}`, `2026-11-${String(10 + n).padStart(2, "0")}T10:00:00Z`));
    answer({ me: { groups: groups(...open) }, state: serverState({ unseen: open.map((t) => t.code) }) });
    render(<AchievementCatchUp />);
    await waitFor(() => expect(mocks.ceremonies).toHaveLength(1));
    expect(mocks.ceremonies[0].codes).toHaveLength(8);
    mocks.ceremonies[0].options.onDone();
    expect(seenBodies()[0].codes).toHaveLength(10);
  });

  it("Neuberechnung: am Server gesehen kommt sie nicht; sonst einmal, und Schließen meldet die Kennung", async () => {
    localStorage.setItem(seen.importedKey("anna"), "x");
    const recounted = groups(tier("bats_2", "2026-11-11T03:00:00Z", { recount: true }));
    answer({ me: { groups: recounted, recount: { marker: "2340", finished: true } }, state: serverState({ recount_seen: ["2340"] }) });
    const first = render(<AchievementCatchUp />);
    await settle();
    expect(mocks.ceremonies).toEqual([]);
    first.unmount();

    mocks.user = { id: "bert" };
    localStorage.setItem(seen.importedKey("bert"), "x");
    answer({ me: { groups: recounted, recount: { marker: "2340", finished: true } }, state: serverState() });
    render(<AchievementCatchUp />);
    await waitFor(() => expect(mocks.ceremonies).toHaveLength(1));
    expect(mocks.ceremonies[0].context).toEqual({ recount: true, recountMarker: "2340" });
    mocks.ceremonies[0].options.onDone();
    expect(seenBodies()).toEqual([{ recount_marker: "2340" }]);
  });
});

describe("Level-Aufstiege", () => {
  it("vergleicht mit dem gesehenen Stand am Server und meldet ihn beim Schließen", async () => {
    localStorage.setItem(seen.importedKey("anna"), "x");
    answer({ state: serverState({ level: { level: 5, title: "", prestige: 0 } }), level: { level: 6, title: "Rudel", prestige: 0 } });
    render(<LevelUpCelebration />);
    await waitFor(() => expect(mocks.levels).toHaveLength(1));
    expect(mocks.levels[0].levelUp).toMatchObject({ level: 6, previous: 5 });
    mocks.levels[0].options.onDone();
    expect(seenBodies()).toEqual([{ level: { level: 6, title: "Rudel", prestige: 0 } }]);
  });

  it("auf einem anderen Gerät schon gesehen: kein Aufstieg - auch wenn der Browser einen älteren Stand kennt", async () => {
    localStorage.setItem(seen.importedKey("anna"), "x");
    localStorage.setItem(seen.levelSeenKey("anna"), JSON.stringify({ level: 3, title: "", prestige: 0 }));
    answer({ state: serverState({ level: { level: 6, title: "", prestige: 0 } }), level: { level: 6, title: "", prestige: 0 } });
    render(<LevelUpCelebration />);
    await settle();
    expect(mocks.levels).toEqual([]);
  });
});
