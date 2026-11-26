import React from "react";
import * as Haptics from "expo-haptics";
import * as SecureStore from "expo-secure-store";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { createCeremonyQueue } from "../../achievements/ceremony/queue";
import { MOMENT_MARKS_KEY, replayMoment, requestMoment, type LeagueMoment } from "../../lib/leagueMoments";
import { setModalOpen } from "../../lib/modalGate";
import { LeagueMomentHint } from "./LeagueMomentHint";
import { RewardMomentHost } from "./RewardMomentHost";

// Saisonende-Moment in der App (#2584, docs/LIGA.md F.8, Web: SeasonMoment.jsx, momentPackage.js, LeagueMomentHint.jsx): einmal je
// Season und Person - geholt für dieses Gerät, erst nach dem Schließen fertig, nie über einer anderen Zeremonie; der Meister bringt seine
// Belohnungen als zweite Karte mit. Dazu der Hinweis „Saisonende“ an Profil und Team mit „Moment ansehen“.

const mockGet = jest.fn();
const mockPost = jest.fn();
let mockUser: { id: string } = { id: "u1" };
let mockReduce = false;
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
  resolveMediaUrl: (url: string) => url,
}));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("../../lib/openLink", () => ({ openLink: jest.fn(() => "browser") }));
jest.mock("../../navigation/rootNavigation", () => ({ openDetail: jest.fn(() => true), navigateToUrl: jest.fn(() => true) }));
jest.mock("../MediaImage", () => ({ MediaImage: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../motion/useReduceMotion", () => ({ useReduceMotion: () => mockReduce }));

const texts = (outcome: string) => ({
  up: { label: "Aufstieg", kicker: "Aufstieg", title: "Liga 1", name: "Löwen", meta: "CoD-Liga · Season 2", line: "Löwen steigt von Liga 2 in Liga 1 auf.", next: null,
    summary: "Löwen steigt von Liga 2 in Liga 1 auf.", aria: "Aufstieg: Löwen steigt von Liga 2 in Liga 1 auf.", notice: null },
  down: { label: "Abstieg", kicker: "Abstieg", title: "Nächste Season in Liga 3", name: "Löwen", meta: "CoD-Liga · Season 2", line: "Löwen wechselt von Liga 2 in Liga 3.",
    next: "Die neue Season beginnt für alle bei null.", summary: "Löwen spielt die nächste Season in Liga 3.", aria: "Abstieg: Löwen spielt die nächste Season in Liga 3.", notice: null },
  champion: { label: "Meister", kicker: "Liga 1", title: "Meister", name: "Löwen", meta: "CoD-Liga · Season 2", line: "Platz 1 im Endstand der Season.", next: null,
    summary: "Löwen ist Meister in Liga 1.", aria: "Meister: Löwen ist Meister von CoD-Liga · Season 2 in Liga 1.", notice: null },
}[outcome]);

const moment = (id: string, outcome: "up" | "down" | "champion", extra: Partial<LeagueMoment> = {}): LeagueMoment => {
  const levels = { up: [2, 1], down: [2, 3], champion: [1, 1] }[outcome];
  return {
    id, outcome, season_id: "se2", title: "CoD-Liga · Season 2", url: "/liga/cod/season-2", squad_id: "sq1", team_id: "t1", display_name: "Löwen",
    from: { level: levels[0] }, to: { level: levels[1] }, badge_from: { level: levels[0], champion: false }, badge_to: { level: levels[1], champion: outcome === "champion" },
    texts: texts(outcome) as never, rewards: [], corrected: false, ...extra,
  };
};
const award = (id: string, name: string) => ({ id, kind: "trophy", tournament: { id: "staffel-1" }, updated_at: "2026-11-20",
  reward: { kind: "medal", kind_label: "Medaille", name, art: { league: "CoD-Liga", season: "Season 2", place: "1. Platz", metal: "gold" } } });

function serve({ moments = [] as unknown[], rewards = [] as unknown[], claimed = (ids: string[]) => ids } = {}) {
  mockGet.mockImplementation(async (path: string) => {
    if (path === "/me/league-moments/unseen") return { data: { moments } };
    if (path === "/me/rewards/unseen") return { data: { rewards } };
    return { data: {} };
  });
  mockPost.mockImplementation(async (path: string, body: { ids: string[] }) => {
    if (path === "/me/league-moments/seen") return { data: { ok: true, claimed: claimed(body.ids) } };
    return { data: { ok: true } };
  });
}

// Das Wappen ist Zier und für Screenreader verborgen - die Tests suchen es trotzdem.
const HIDDEN = { includeHiddenElements: true };
/** Was zuletzt als Marken im sicheren Speicher landete - ohne auf den Speicher zu warten. */
const stored = () => String((SecureStore.setItemAsync as jest.Mock).mock.calls.filter(([key]) => key === MOMENT_MARKS_KEY).at(-1)?.[1] ?? "");
const posts = (path: string) => mockPost.mock.calls.filter(([called]) => called === path).map(([, body]) => body);

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: "u1" };
  mockReduce = false;
});

test("Aufstieg: geholt mit dem Geräte-Schlüssel, Texte vom Server, nach „Weiter“ fertig - und kein zweites Mal", async () => {
  serve({ moments: [moment("m1", "up")] });
  await render(<RewardMomentHost queue={createCeremonyQueue()} />);
  await waitFor(() => expect(screen.getByTestId("season-moment")).toBeTruthy());
  const [claim] = posts("/me/league-moments/seen") as Array<{ ids: string[]; token: string }>;
  expect(claim.ids).toEqual(["m1"]);
  expect(claim.token).toMatch(/^[A-Za-z0-9-]{8,80}$/);
  expect(screen.getByTestId("season-moment-title")).toHaveTextContent("Liga 1");
  expect(screen.getByTestId("season-moment-kicker")).toHaveTextContent("Aufstieg");
  expect(screen.getByTestId("season-moment-line")).toHaveTextContent("Löwen steigt von Liga 2 in Liga 1 auf.");
  expect(screen.getByTestId("season-moment-text").props.accessibilityLabel).toBe("Aufstieg: Löwen steigt von Liga 2 in Liga 1 auf.");
  // Liga 1: Die Krone setzt sich; der alte Stand liegt darunter und blendet aus.
  expect(screen.getByTestId("season-moment-crown", HIDDEN)).toBeTruthy();
  expect(screen.getByTestId("season-moment-num-from", HIDDEN)).toBeTruthy();
  expect(posts("/me/league-moments/done")).toEqual([]);
  // Leichte Vibration einmal - beim Zahlenwechsel, nicht schon beim Aufgehen.
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
  await waitFor(() => expect(Haptics.impactAsync).toHaveBeenCalledTimes(1), { timeout: 2000 });
  await fireEvent.press(screen.getByTestId("season-moment-done"));
  await waitFor(() => expect(posts("/me/league-moments/done")).toEqual([{ ids: ["m1"] }]));
  expect(screen.queryByTestId("season-moment")).toBeNull();
});

test("Gegenprobe Einmaligkeit: ein anderes Gerät hat ihn schon - nichts zeigen, nichts als fertig melden", async () => {
  serve({ moments: [moment("m1", "up")], claimed: () => [] });
  await render(<RewardMomentHost queue={createCeremonyQueue()} />);
  await waitFor(() => expect(posts("/me/league-moments/seen")).toHaveLength(1));
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByTestId("season-moment")).toBeNull();
  expect(posts("/me/league-moments/done")).toEqual([]);
});

test("Holen scheitert am Netz: der Moment wartet auf den nächsten Start", async () => {
  serve({ moments: [moment("m1", "down")] });
  mockPost.mockImplementation(async (path: string) => {
    if (path === "/me/league-moments/seen") throw new Error("offline");
    return { data: {} };
  });
  await render(<RewardMomentHost queue={createCeremonyQueue()} />);
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/me/league-moments/seen", expect.anything()));
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByTestId("season-moment")).toBeNull();
  expect(posts("/me/league-moments/done")).toEqual([]);
});

test("„fertig“ ging verloren: beim nächsten Start still nachmelden statt ihn noch einmal zu zeigen - nur für dieses Konto", async () => {
  serve({ moments: [moment("m1", "up")] });
  mockPost.mockImplementation(async (path: string, body: { ids: string[] }) => {
    if (path === "/me/league-moments/seen") return { data: { claimed: body.ids } };
    if (path === "/me/league-moments/done") throw new Error("offline");
    return { data: {} };
  });
  const first = await render(<RewardMomentHost queue={createCeremonyQueue()} />);
  await waitFor(() => expect(screen.getByTestId("season-moment")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("season-moment-done"));
  await waitFor(() => expect(posts("/me/league-moments/done")).toHaveLength(1));
  await waitFor(() => expect(stored()).toContain("m1"));
  await first.unmount();

  // Neustart der App: Der Server führt ihn noch als offen.
  jest.clearAllMocks();
  serve({ moments: [moment("m1", "up")] });
  await render(<RewardMomentHost queue={createCeremonyQueue()} />);
  await waitFor(() => expect(posts("/me/league-moments/done")).toEqual([{ ids: ["m1"] }]));
  expect(posts("/me/league-moments/seen")).toEqual([]);
  expect(screen.queryByTestId("season-moment")).toBeNull();
  await waitFor(() => expect(stored()).toMatch(/"done":\[\]/));
});

test("eine andere Person am selben Handy: die Marke des ersten Kontos gilt für sie nicht", async () => {
  await SecureStore.setItemAsync(MOMENT_MARKS_KEY, JSON.stringify({ accounts: { u1: { token: "geraet-u1-abcdef", done: ["m1"] } } }));
  mockUser = { id: "u2" };
  serve({ moments: [moment("m1", "up")] });
  await render(<RewardMomentHost queue={createCeremonyQueue()} />);
  await waitFor(() => expect(screen.getByTestId("season-moment")).toBeTruthy());
  const [claim] = posts("/me/league-moments/seen") as Array<{ token: string }>;
  expect(claim.token).not.toBe("geraet-u1-abcdef");
});

test("Meister mit Belohnungen: ein Ablauf - „Weiter“ zeigt die Belohnungen in derselben Karte, „Fertig“ meldet beides", async () => {
  serve({ moments: [moment("c1", "champion", { rewards: [award("r1", "Goldmedaille")] as never })], rewards: [award("r2", "Banner")] });
  await render(<RewardMomentHost queue={createCeremonyQueue()} />);
  await waitFor(() => expect(screen.getByTestId("season-moment-trophy", HIDDEN)).toBeTruthy());
  expect(screen.getByTestId("season-moment-title")).toHaveTextContent("Meister");
  await fireEvent.press(screen.getByTestId("season-moment-done"));
  expect(screen.getByTestId("season-moment-rewards")).toBeTruthy();
  expect(screen.getByText("Goldmedaille")).toBeTruthy();
  expect(posts("/me/league-moments/done")).toEqual([]);
  await fireEvent.press(screen.getByTestId("season-moment-finish"));
  await waitFor(() => expect(posts("/me/league-moments/done")).toEqual([{ ids: ["c1"] }]));
  expect(posts("/me/rewards/seen")).toEqual([{ ids: ["r1"] }]);
  // Danach die übrigen Belohnungen als eigene Zeremonie - die des Meisters kommen nicht noch einmal.
  await waitFor(() => expect(screen.getByTestId("reward-moment")).toBeTruthy());
  expect(screen.queryByText("Goldmedaille")).toBeNull();
  expect(screen.getByText("Banner")).toBeTruthy();
});

test("Meister vor der zweiten Karte geschlossen: die Belohnungen bleiben ungesehen und kommen später", async () => {
  serve({ moments: [moment("c1", "champion", { rewards: [award("r1", "Goldmedaille")] as never })] });
  await render(<RewardMomentHost queue={createCeremonyQueue()} />);
  await waitFor(() => expect(screen.getByTestId("season-moment-trophy", HIDDEN)).toBeTruthy());
  await fireEvent.press(screen.getByTestId("season-moment-close"));
  await waitFor(() => expect(posts("/me/league-moments/done")).toEqual([{ ids: ["c1"] }]));
  expect(posts("/me/rewards/seen")).toEqual([]);
});

test("Meister schon auf einem anderen Gerät: dieses Gerät zeigt die Belohnungen allein", async () => {
  serve({ moments: [moment("c1", "champion", { rewards: [award("r1", "Goldmedaille")] as never })], claimed: () => [] });
  await render(<RewardMomentHost queue={createCeremonyQueue()} />);
  await waitFor(() => expect(screen.getByTestId("reward-moment")).toBeTruthy());
  expect(screen.queryByTestId("season-moment")).toBeNull();
  await fireEvent.press(screen.getByTestId("reward-moment-close"));
  expect(posts("/me/rewards/seen")).toEqual([{ ids: ["r1"] }]);
  expect(posts("/me/league-moments/done")).toEqual([]);
});

test("Abstieg ruhig, „Endstand korrigiert“ oben; reduzierte Bewegung zeigt gleich den Endzustand", async () => {
  mockReduce = true;
  serve({ moments: [moment("d1", "down", { corrected: true, texts: { ...texts("down"), notice: "Endstand korrigiert" } as never })] });
  await render(<RewardMomentHost queue={createCeremonyQueue()} />);
  await waitFor(() => expect(screen.getByTestId("season-moment")).toBeTruthy());
  expect(screen.getByTestId("season-moment-notice")).toHaveTextContent("Endstand korrigiert");
  expect(screen.getByTestId("season-moment-next")).toHaveTextContent("Die neue Season beginnt für alle bei null.");
  expect(screen.getByTestId("season-moment-crest", HIDDEN).props["data-metal"]).toBe("calm");
  // Endzustand: nur das Nachher, kein Vorher, kein Glanz.
  expect(screen.queryByTestId("season-moment-num-from", HIDDEN)).toBeNull();
  expect(screen.queryByTestId("season-moment-shine", HIDDEN)).toBeNull();
  expect(screen.getByTestId("season-moment-num-to", HIDDEN)).toBeTruthy();
  // Ohne Bewegung kommt die Vibration gleich.
  await waitFor(() => expect(Haptics.impactAsync).toHaveBeenCalledTimes(1));
});

test("nie über einer Erfolgs-Zeremonie: der Moment wird erst geholt, wenn sie vorbei ist", async () => {
  serve({ moments: [moment("m1", "up")] });
  const queue = createCeremonyQueue();
  queue.enqueue({ tiers: [{ code: "erfolg", rank: 1 }] } as never);
  await render(<RewardMomentHost queue={queue} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/me/league-moments/unseen"));
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByTestId("season-moment")).toBeNull();
  expect(posts("/me/league-moments/seen")).toEqual([]);
  await act(async () => { queue.advance(); });
  await waitFor(() => expect(screen.getByTestId("season-moment")).toBeTruthy());
});

test("„Startrecht zusagen“ führt zur Teamseite, „Endstand ansehen“ zur Ligaseite", async () => {
  const { openDetail } = jest.requireMock("../../navigation/rootNavigation") as { openDetail: jest.Mock };
  const { openLink } = jest.requireMock("../../lib/openLink") as { openLink: jest.Mock };
  serve({ moments: [moment("m1", "up", { next_step: { label: "Startrecht zusagen", url: "/teams" } })] });
  await render(<RewardMomentHost queue={createCeremonyQueue()} />);
  await waitFor(() => expect(screen.getByTestId("season-moment-next-step")).toBeTruthy());
  expect(screen.getByTestId("season-moment-next-step")).toHaveTextContent("Startrecht zusagen");
  await fireEvent.press(screen.getByTestId("season-moment-next-step"));
  expect(openDetail).toHaveBeenCalledWith("TeamDetail", { id: "t1" });
  await waitFor(() => expect(posts("/me/league-moments/done")).toEqual([{ ids: ["m1"] }]));

  serve({ moments: [moment("m2", "down")] });
  await act(async () => { requestMoment("m2"); });
  await waitFor(() => expect(screen.getByTestId("season-moment-final")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("season-moment-final"));
  expect(openLink).toHaveBeenCalledWith("/liga/cod/season-2");
});

test("Push angetippt: gleich nachsehen, auch innerhalb der Drossel", async () => {
  serve({ moments: [] });
  await render(<RewardMomentHost queue={createCeremonyQueue()} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/me/league-moments/unseen"));
  serve({ moments: [moment("m9", "up")] });
  await act(async () => { requestMoment("m9"); });
  await waitFor(() => expect(screen.getByTestId("season-moment")).toBeTruthy());
});

test("Hinweis „Saisonende“: Ausgang, Satz, Endstand - „Moment ansehen“ nur für die Person selbst, einmal in der Schlange, ohne Zählung", async () => {
  serve({ moments: [] });
  const rows = [moment("m1", "up", { corrected: true }), moment("m2", "down"), { id: "leer" } as never];
  await render(<LeagueMomentHint rows={rows} testID="profile-league-moments" />);
  expect(screen.getByTestId("profile-league-moments-m1")).toHaveTextContent(/Aufstieg/);
  expect(screen.getByTestId("profile-league-moments-m1")).toHaveTextContent(/Endstand korrigiert/);
  expect(screen.getByText("Löwen steigt von Liga 2 in Liga 1 auf.")).toBeTruthy();
  expect(screen.getByText("Löwen spielt die nächste Season in Liga 3.")).toBeTruthy();
  expect(screen.queryByTestId("profile-league-moments-leer")).toBeNull();
  expect(screen.queryByTestId("profile-league-moments-m1-replay")).toBeNull();

  await render(<><RewardMomentHost queue={createCeremonyQueue()} /><LeagueMomentHint rows={rows} canReplay testID="profile-league-moments" /></>);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/me/league-moments/unseen"));
  await fireEvent.press(screen.getByTestId("profile-league-moments-m1-replay"));
  await fireEvent.press(screen.getByTestId("profile-league-moments-m1-replay"));
  await waitFor(() => expect(screen.getByTestId("season-moment")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("season-moment-done"));
  await waitFor(() => expect(screen.queryByTestId("season-moment")).toBeNull());
  expect(posts("/me/league-moments/seen")).toEqual([]);
  expect(posts("/me/league-moments/done")).toEqual([]);
  replayMoment({ id: "kaputt" } as never);
  await render(<LeagueMomentHint rows={[]} />);
  expect(screen.queryByTestId("league-moments")).toBeNull();
});

test("break-ui: sehr langer Teamname und Liga 12 - nichts wird abgeschnitten", async () => {
  const name = "Die außerordentlich ausdauernden Löwen vom Wörthersee eSport-Abteilung Süd-Ost";
  serve({ moments: [moment("m1", "down", { from: { level: 11 }, to: { level: 12 }, badge_from: { level: 11 }, badge_to: { level: 12 },
    texts: { ...texts("down"), name, title: "Nächste Season in Liga 12 · Unterhaus der Champions" } as never })] });
  await render(<RewardMomentHost queue={createCeremonyQueue()} />);
  await waitFor(() => expect(screen.getByTestId("season-moment-name")).toHaveTextContent(name));
  expect(screen.getByTestId("season-moment-name").props.numberOfLines).toBeUndefined();
  expect(screen.getByTestId("season-moment-title").props.numberOfLines).toBeUndefined();
  expect(screen.getByTestId("season-moment-num-to", HIDDEN)).toHaveTextContent("12");
});

// Nachbesserung nach der Prüfung (#2584).
test("Kontowechsel: eine späte Antwort für Konto A landet nie in der Schlange von B", async () => {
  let release: (value: unknown) => void = () => {};
  mockGet.mockImplementation((path: string) => {
    if (path === "/me/rewards/unseen" && mockUser.id === "u1") return new Promise((resolve) => { release = resolve; });
    if (path === "/me/league-moments/unseen") return Promise.resolve({ data: { moments: [] } });
    return Promise.resolve({ data: { rewards: [] } });
  });
  const queue = createCeremonyQueue();
  const view = await render(<RewardMomentHost queue={queue} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/me/rewards/unseen"));
  mockUser = { id: "u2" };
  await view.rerender(<RewardMomentHost queue={queue} />);
  await waitFor(() => expect(mockGet.mock.calls.filter(([path]) => path === "/me/rewards/unseen")).toHaveLength(2));
  await act(async () => { release({ data: { rewards: [award("a1", "Gold von Konto A")] } }); });
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByText("Gold von Konto A")).toBeNull();
  expect(screen.queryByTestId("reward-moment")).toBeNull();
});

test("wartet auf andere offene Fenster (Abstimmung, Passkey-Einladung …) - Moment und Belohnung gleich", async () => {
  setModalOpen("ballot-popup", true);
  serve({ moments: [moment("m1", "up")], rewards: [award("r9", "Banner")] });
  await render(<RewardMomentHost queue={createCeremonyQueue()} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/me/league-moments/unseen"));
  await act(async () => { await Promise.resolve(); });
  expect(posts("/me/league-moments/seen")).toEqual([]);
  expect(screen.queryByTestId("season-moment")).toBeNull();
  await act(async () => { setModalOpen("ballot-popup", false); });
  await waitFor(() => expect(screen.getByTestId("season-moment")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("season-moment-done"));
  // Die Belohnung danach wartet ebenso, solange ein anderes Fenster offen ist.
  await act(async () => { setModalOpen("ballot-popup", true); });
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByTestId("reward-moment")).toBeNull();
  await act(async () => { setModalOpen("ballot-popup", false); });
  await waitFor(() => expect(screen.getByTestId("reward-moment")).toBeTruthy());
});

test("nicht geholt (anderes Gerät, Netz): beim nächsten Nachsehen kommt er wieder in Frage, nicht erst nach einem Neustart", async () => {
  let claimable = false;
  serve({ moments: [moment("m1", "up")], claimed: (ids) => (claimable ? ids : []) });
  await render(<RewardMomentHost queue={createCeremonyQueue()} />);
  await waitFor(() => expect(posts("/me/league-moments/seen")).toHaveLength(1));
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByTestId("season-moment")).toBeNull();
  claimable = true;
  await act(async () => { requestMoment("m1"); });
  await waitFor(() => expect(screen.getByTestId("season-moment")).toBeTruthy());
  expect(posts("/me/league-moments/seen")).toHaveLength(2);
});

test("eine alte „fertig“-Marke meldet einen korrigierten Moment nie still als fertig (Nr. 277)", async () => {
  serve({ moments: [moment("m1", "up", { confirmed_at: "2026-11-20T10:00:00Z" })] });
  mockPost.mockImplementation(async (path: string, body: { ids: string[] }) => {
    if (path === "/me/league-moments/seen") return { data: { claimed: body.ids } };
    if (path === "/me/league-moments/done") throw new Error("offline");
    return { data: {} };
  });
  const first = await render(<RewardMomentHost queue={createCeremonyQueue()} />);
  await waitFor(() => expect(screen.getByTestId("season-moment")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("season-moment-done"));
  await waitFor(() => expect(stored()).toContain("m1"));
  await first.unmount();

  // Die Leitung korrigiert den Endstand: derselbe Moment, neuer Stand, „Endstand korrigiert“.
  jest.clearAllMocks();
  serve({ moments: [moment("m1", "down", { corrected: true, confirmed_at: "2026-11-24T18:00:00Z", texts: { ...texts("down"), notice: "Endstand korrigiert" } as never })] });
  await render(<RewardMomentHost queue={createCeremonyQueue()} />);
  await waitFor(() => expect(screen.getByTestId("season-moment-notice")).toHaveTextContent("Endstand korrigiert"));
  expect(posts("/me/league-moments/done")).toEqual([]);
  expect(posts("/me/league-moments/seen")).toHaveLength(1);
});

test("Hinweis „Saisonende“: die Tippfläche „Endstand“ ist mindestens 44 pt hoch", async () => {
  await render(<LeagueMomentHint rows={[moment("m1", "up")]} testID="profile-league-moments" />);
  const link = screen.getByTestId("profile-league-moments-m1-final");
  const style = Object.assign({}, ...[link.props.style].flat(5).filter(Boolean));
  expect(style.minHeight).toBeGreaterThanOrEqual(44);
});
