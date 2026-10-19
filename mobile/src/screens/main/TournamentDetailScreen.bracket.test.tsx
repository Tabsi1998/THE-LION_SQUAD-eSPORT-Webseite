import fs from "fs";
import path from "path";
import React from "react";
import * as Haptics from "expo-haptics";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { TournamentDetailScreen } from "./TournamentDetailScreen";

// Turnierbaum, Tabellen und Spielplan in der App (#1563) - auf echten Bäumen aus dem Generator (docs/bracket-trees.json,
// scripts/make_app_bracket_fixture.py): Linien, „Du“ und dein Weg per Tipp, Live mit Station und Uhr, Lauf-Karte,
// Pokal, neue Zustände (entfällt, zusammengelegt, kampflos, Freilos, ausgetreten/disqualifiziert), Check-in vorbei.

const TREES = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../../docs/bracket-trees.json"), "utf8"));
// Vier Modi (#1590, App #1633): Bäume aus dem echten Generator mit Show-Auslosung und „sofort zufällig“.
const FFA = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../../frontend/e2e/fixtures/ffaGenerated.json"), "utf8"));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args), delete: jest.fn() },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
const mockAuth: { user: { id: string; username: string } } = { user: { id: "u-1", username: "paula" } };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../../live", () => ({ isGuestUser: () => false }));
jest.mock("../../navigation/rootNavigation", () => ({ openSignIn: jest.fn() }));
const mockLive: { reload: null | (() => unknown); enabled: boolean | undefined } = { reload: null, enabled: undefined };
jest.mock("../../realtime/LiveChangesProvider", () => ({
  useLiveRefresh: (load: () => unknown, _resources: unknown, options?: { enabled?: boolean }) => { mockLive.reload = load; mockLive.enabled = options?.enabled ?? true; },
}));
jest.mock("../../seasons/anchors", () => ({ useSeasonOverlay: () => null, SeasonAnchor: ({ children }: { children?: React.ReactNode }) => children ?? null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/AddToCalendarButton", () => ({ AddToCalendarButton: () => null }));

const navigate = jest.fn();
const mockListeners: Record<string, Array<() => void>> = {};
const navigation = {
  navigate, setOptions: jest.fn(), getParent: () => ({ navigate }),
  addListener: jest.fn((event: string, listener: () => void) => {
    (mockListeners[event] = mockListeners[event] || []).push(listener);
    return () => { mockListeners[event] = (mockListeners[event] || []).filter((row) => row !== listener); };
  }),
} as never;
const route = { key: "t", name: "TournamentDetail", params: { id: "cup" } } as never;

function serve(state: string, tournament: Record<string, unknown> = {}, mineName?: string, source: Record<string, any> = TREES) {
  const tree = source[state];
  const mine = mineName ? tree.registrations.find((reg: any) => reg.display_name === mineName) : null;
  const registrations = tree.registrations.map((reg: any) => (mine && reg.id === mine.id ? { ...reg, user_id: "u-1", is_mine: true } : reg));
  const data = {
    id: "t1", slug: "cup", title: "Lions Cup", status: "live", format: tree.format, team_mode: "solo", event_mode: "local",
    public_phase: { state: "live", label: "Läuft" }, ...(mine ? { my_registration: { id: mine.id, status: mine.status, user_id: "u-1" } } : {}), ...tournament,
  };
  mockGet.mockImplementation((url: string) => {
    if (url === "/tournaments/cup") return Promise.resolve({ data });
    if (url.endsWith("/bracket")) return Promise.resolve({ data: { tournament: data, matches_v2: tree.matches_v2, stages: tree.stages, registrations } });
    if (url.endsWith("/registrations")) return Promise.resolve({ data: registrations });
    if (url.endsWith("/standings")) return Promise.resolve({ data: tree.standings || [] });
    return Promise.resolve({ data: [] });
  });
  return { tree, mine };
}

async function open(tab: "Baum" | "Matches" | "Tabelle" | "Spieler") {
  await render(<TournamentDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Lions Cup")).toBeTruthy());
  // Die Reiter stehen vor den Kennzahlen („Matches“, „Spieler“) - der erste Treffer ist der Reiter.
  await fireEvent.press(screen.getAllByText(tab)[0]);
}

const keyId = (state: string, key: string) => TREES[state].matches_v2.find((match: any) => match.match_key === key).id;

beforeEach(() => {
  jest.clearAllMocks();
  mockLive.reload = null;
});

describe("Baum mit Linien", () => {
  test("K.-o.: Linien aus den Quellen, Rundennamen, Freilos und kampflos als eine Zeile, Pokal noch offen", async () => {
    serve("se6_live");
    await open("Baum");
    expect(await screen.findByTestId("bracket-canvas")).toBeTruthy();
    expect(screen.getAllByTestId(/^bracket-line-/).length).toBe(7);
    expect(screen.getByText("Viertelfinale")).toBeTruthy();
    expect(screen.getAllByText("Halbfinale").length).toBeGreaterThan(0);
    expect(screen.getByText("Finale")).toBeTruthy();
    expect(screen.queryByText("Runde 1")).toBeNull();
    expect(screen.getByTestId(`bracket-card-${keyId("se6_live", "A")}`)).toHaveTextContent(/Freilos.*NeonFalke kommt weiter/);
    expect(screen.getByTestId(`bracket-card-${keyId("se6_live", "D")}`)).toHaveTextContent(/kampflos.*BoostBerta kommt weiter/);
    expect(screen.getByTestId(`bracket-card-${keyId("se6_live", "G")}`)).toHaveTextContent(/Sieger aus E/);
    expect(screen.getByTestId("bracket-trophy")).toHaveTextContent(/noch offen/);
  });

  test("Live: Station und Uhr im Kopf, oben angepinnt", async () => {
    jest.useFakeTimers({ now: new Date("2026-10-31T13:07:41Z"), doNotFake: ["nextTick", "setImmediate"] });
    try {
      serve("se6_live");
      await open("Baum");
      const live = await screen.findByTestId(`bracket-card-${keyId("se6_live", "E")}`);
      expect(live).toHaveTextContent(/PC 3/);
      expect(live).toHaveTextContent(/07:41/);
      expect(screen.getByTestId("bracket-live-now")).toHaveTextContent(/Läuft gerade/);
      expect(screen.getByTestId("bracket-live-now")).toHaveTextContent(/NeonFalke gegen PixelPaula/);
      await act(async () => { jest.advanceTimersByTime(2000); });
      expect(live).toHaveTextContent(/07:43/);
    } finally {
      jest.useRealTimers();
    }
  });

  test("„Du“ und dein Weg per Tipp - nochmal tippen hebt ihn auf", async () => {
    const { mine } = serve("ffa16_round1", {}, "NeonFalke");
    await open("Baum");
    const card = await screen.findByTestId(`bracket-card-${keyId("ffa16_round1", "E")}`);
    expect(within(card).getAllByText("Du").length).toBe(1);
    await fireEvent.press(screen.getByTestId("bracket-my-path"));
    expect(screen.getByTestId(`bracket-card-${keyId("ffa16_round1", "B")}`)).toHaveStyle({ opacity: 0.35 });
    expect(screen.getByTestId(`bracket-card-${keyId("ffa16_round1", "A")}`)).toHaveStyle({ opacity: 1 });
    expect(screen.getByTestId(`bracket-card-${keyId("ffa16_round1", "G")}`)).toHaveStyle({ opacity: 1 });
    // Die Linien deines Wegs sind gold (testID „bracket-line-weg-…“), die anderen treten zurück.
    expect(screen.getAllByTestId(/^bracket-line-weg-/).length).toBe(3);
    // Ein anderer Name zeigt dessen Weg.
    await fireEvent.press(within(screen.getByTestId(`bracket-card-${keyId("ffa16_round1", "B")}`)).getByText("KartKönigin"));
    expect(screen.getByTestId("bracket-path-bar")).toHaveTextContent(/Weg von KartKönigin/);
    expect(screen.getByTestId(`bracket-card-${keyId("ffa16_round1", "A")}`)).toHaveStyle({ opacity: 0.35 });
    await fireEvent.press(within(screen.getByTestId(`bracket-card-${keyId("ffa16_round1", "B")}`)).getByText("KartKönigin"));
    expect(screen.queryByTestId("bracket-path-bar")).toBeNull();
    expect(mine).toBeTruthy();
  });

  test("Lauf-Karte: „2 kommen weiter → E“, die anderen scheiden aus, Finale „Platz 1 gewinnt“", async () => {
    serve("ffa16_round1");
    await open("Baum");
    const heat = await screen.findByTestId(`bracket-card-${keyId("ffa16_round1", "A")}`);
    expect(heat).toHaveTextContent(/Lauf A/);
    expect(heat).toHaveTextContent(/2 kommen weiter → E/);
    expect(heat).toHaveTextContent(/Die anderen scheiden aus/);
    expect(screen.getByTestId(`bracket-card-${keyId("ffa16_round1", "G")}`)).toHaveTextContent(/Platz 1 gewinnt/);
  });

  test("zusammengelegt, entfällt, freie Plätze", async () => {
    serve("ffa8_after_merge");
    await open("Baum");
    expect(await screen.findByTestId(`bracket-card-${keyId("ffa8_after_merge", "C")}`)).toHaveTextContent(/Lauf C.*zusammengelegt in B/);
    expect(screen.getByTestId(`bracket-card-${keyId("ffa8_after_merge", "G")}`)).toHaveTextContent(/entfällt/);
    expect(screen.getByTestId(`bracket-card-${keyId("ffa8_after_merge", "E")}`)).toHaveTextContent(/Platz 1 gewinnt/);
  });

  test("Doppel-K.-o.: Reset entfällt, Pokal für den Sieger", async () => {
    serve("de4_reset_cancelled", { status: "completed" });
    await open("Baum");
    expect(await screen.findByTestId(`bracket-card-${keyId("de4_reset_cancelled", "GFR")}`)).toHaveTextContent(/entfällt · nicht nötig/);
    expect(screen.getByText("Loser Bracket")).toBeTruthy();
    expect(screen.getByText("Winner Final")).toBeTruthy();
    expect(screen.getByTestId("bracket-trophy")).toHaveTextContent(/NeonFalke/);
  });

  test("40 Fahrer mit langen, Emoji- und E-Mail-Namen: alles da", async () => {
    serve("ffa40");
    await open("Baum");
    await screen.findByTestId("bracket-canvas");
    expect(screen.getAllByTestId(/^bracket-card-/).length).toBe(21);
    expect(screen.getByText("Der unglaublich lange Spielername Nummer Eins mit noch mehr Text dahinter")).toBeTruthy();
    expect(screen.getByText("🦁 Löwenherz")).toBeTruthy();
  });

  test("frisches Ergebnis: Vibration „Turniersieg“ nur für den Sieger, der Pokal glänzt", async () => {
    serve("se6_live", {}, "NeonFalke");
    await open("Baum");
    await screen.findByTestId("bracket-canvas");
    serve("se6_done", {}, "NeonFalke");
    await act(async () => { await mockLive.reload?.(); });
    await waitFor(() => expect(screen.getByTestId("bracket-trophy")).toHaveTextContent(/NeonFalke/));
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
    expect(screen.getByTestId("bracket-trophy-crowned")).toBeTruthy();
  });
});

test("dein Weiterkommen im offenen Baum: einmal kurz - fremdes Weiterkommen still", async () => {
  serve("ffa16", {}, "NeonFalke");
  await open("Baum");
  await screen.findByTestId("bracket-canvas");
  serve("ffa16_round1", {}, "NeonFalke");
  await act(async () => { await mockLive.reload?.(); });
  await waitFor(() => expect(screen.getByTestId(`bracket-card-${keyId("ffa16_round1", "E")}`)).toHaveTextContent(/NeonFalke/));
  expect((Haptics.impactAsync as jest.Mock).mock.calls.filter(([style]) => style === "medium").length).toBe(1);
  jest.clearAllMocks();
  serve("ffa16", {}, "ZickZackZoe");
  await act(async () => { await mockLive.reload?.(); });
  serve("ffa16_round1", {}, "ZickZackZoe");
  await act(async () => { await mockLive.reload?.(); });
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
});

describe("gemischte Runden (#1548)", () => {
  test("vor der Auslosung: Sammelschiene statt Einzel-Linien, „wartet auf Auslosung“, wer kommt, dein Weg bis zur Schiene", async () => {
    serve("se8_mixed_open", {}, "NeonFalke");
    await open("Baum");
    const railKey = `${TREES.se8_mixed_open.matches_v2[0].stage_id}/WB:2`;
    expect(await screen.findByTestId(`bracket-rail-${railKey}`)).toBeTruthy();
    const target = screen.getByTestId(`bracket-card-${keyId("se8_mixed_open", "E")}`);
    // Wie im Web-Baum (#1591, #1590): der Zustand im Kopf, der Platz sagt, wer kommt.
    expect(target).toHaveTextContent(/wartet auf Auslosung/);
    expect(target).toHaveTextContent(/Sieger aus Viertelfinale/);
    expect(screen.getByTestId("bracket-mode")).toHaveTextContent(/Weiterkommen.*Auslosung nach der Runde/);
    expect(screen.getByTestId("bracket-draw-status")).toHaveTextContent("Halbfinale · wartet auf Auslosung");
    expect(screen.queryByTestId(/^bracket-line-.*>.*E/)).toBeNull();
    await fireEvent.press(screen.getByTestId("bracket-my-path"));
    expect(screen.getByTestId(`bracket-rail-weg-${railKey}-${keyId("se8_mixed_open", "A")}`)).toBeTruthy();
  });

  test("nach der Auslosung: die Schiene bleibt, dein Weg folgt der echten Herkunft", async () => {
    const tree = TREES.se8_mixed_drawn;
    const target = tree.matches_v2.find((match: any) => match.match_key === "E");
    const seat = target.slots[0];
    const name = tree.registrations.find((reg: any) => reg.id === seat.registration_id).display_name;
    serve("se8_mixed_drawn", {}, name);
    await open("Baum");
    expect(await screen.findByTestId(`bracket-rail-${target.stage_id}/WB:2`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("bracket-my-path"));
    const from = tree.matches_v2.find((match: any) => match.match_key === seat.source_result.from_match_key).id;
    expect(screen.getByTestId(`bracket-line-weg-${from}>${target.id}:1`)).toBeTruthy();
  });
});

describe("Tabellen statt Baum-Spalten", () => {
  test("Gruppen: Tabelle je Gruppe im Baum und unter „Tabelle“", async () => {
    serve("groups8", {}, "NeonFalke");
    await open("Baum");
    expect(await screen.findByText("Gruppe A")).toBeTruthy();
    expect(screen.getByText("Gruppe B")).toBeTruthy();
    expect(screen.queryByTestId("bracket-canvas")).toBeNull();
    expect(screen.getByTestId("standings-row-Gruppe A-1")).toHaveTextContent(/NeonFalke/);
    await fireEvent.press(screen.getAllByText("Tabelle")[0]);
    expect(screen.getAllByText("Gruppe A").length).toBe(1);
    expect(screen.queryByText("Teilnehmer")).toBeNull();
  });

  test("Swiss mit Buchholz", async () => {
    serve("swiss6");
    await open("Tabelle");
    expect(await screen.findByText("BH")).toBeTruthy();
  });
});

describe("Spielplan", () => {
  test("nach Spieltag gruppiert, „Nur meine“, nach Station", async () => {
    serve("league6", {}, "NeonFalke");
    await open("Matches");
    expect(await screen.findByText("Spieltag 1")).toBeTruthy();
    expect(screen.getAllByTestId(/^schedule-row-/).length).toBe(15);
    await fireEvent.press(screen.getByTestId("schedule-only-mine"));
    expect(screen.getAllByTestId(/^schedule-row-/).length).toBe(5);
    await fireEvent.press(screen.getByText("Station"));
    expect(screen.getByText("Ohne Station")).toBeTruthy();
  });

  test("Live-Spiel an seiner Station zuerst", async () => {
    serve("ffa16_round1");
    await open("Matches");
    await fireEvent.press(await screen.findByText("Station"));
    const rows = screen.getAllByTestId(/^schedule-section-/);
    expect(rows[0]).toHaveTextContent(/Switch 2/);
  });
});

describe("neue Zustände", () => {
  test("ausgetreten und disqualifiziert auf Deutsch", async () => {
    serve("se6_live");
    await open("Spieler");
    expect(await screen.findByText("Disqualifiziert")).toBeTruthy();
    expect(screen.queryByText("disqualified")).toBeNull();
  });

  test("eigene Anmeldung ausgeschieden: klarer Satz statt „angemeldet“", async () => {
    serve("se6_live", {}, "LuckyLion");
    await render(<TournamentDetailScreen navigation={navigation} route={route} />);
    expect(await screen.findByTestId("tournament-own-out")).toHaveTextContent("Du bist ausgeschieden: Disqualifiziert");
  });
});

// Codex-Befund (#1586): der Detail-Screen bleibt im Stack gemountet - verdeckt kein Live-Abo und kein 10-s-Nachladen,
// beim Zurückkommen einmal sofort frisch laden und das Abo wieder an.
test("Live nur, solange die Turnierseite sichtbar ist", async () => {
  serve("se6_live");
  await render(<TournamentDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Lions Cup")).toBeTruthy());
  expect(mockLive.enabled).toBe(true);
  await act(async () => { (mockListeners.blur || []).forEach((listener) => listener()); });
  expect(mockLive.enabled).toBe(false);
  const loads = () => mockGet.mock.calls.filter(([url]) => url === "/tournaments/cup").length;
  const before = loads();
  await act(async () => { (mockListeners.focus || []).forEach((listener) => listener()); });
  expect(mockLive.enabled).toBe(true);
  await waitFor(() => expect(loads()).toBe(before + 1));
});

describe("Check-in", () => {
  const checkIn = {
    status: "check_in", event_mode: "online", public_phase: { state: "check_in", label: "Check-in offen" },
    my_registration: { id: "reg-1", status: "approved", user_id: "u-1" },
  };

  test("Check-in vorbei: kein Knopf, der Server würde ablehnen", async () => {
    serve("ffa16", { ...checkIn, check_in_closed_at: "2026-10-31T12:00:00Z" });
    await render(<TournamentDetailScreen navigation={navigation} route={route} />);
    expect(await screen.findByTestId("tournament-checkin-over")).toHaveTextContent(/Check-in vorbei/);
    expect(screen.queryByTestId("tournament-checkin")).toBeNull();
  });

  test("eingecheckt: einmal Vibration", async () => {
    serve("ffa16", { ...checkIn, check_in_until: "2099-01-01T00:00:00Z" });
    mockPost.mockResolvedValue({ data: { ok: true } });
    await render(<TournamentDetailScreen navigation={navigation} route={route} />);
    await fireEvent.press(await screen.findByTestId("tournament-checkin"));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/tournaments/t1/checkin"));
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  });
});

// Vier Modi in der App (#1633): Modus und Zustand wie im Web, die Auslosung als Moment wie am TV - genau einmal, mit
// einer leichten Vibration im offenen Baum.
describe("Weiterkommen in vier Modi (#1633)", () => {
  const ffaKey = (state: string, key: string) => FFA[state].matches_v2.find((match: any) => match.match_key === key).id;
  const light = () => (Haptics.impactAsync as jest.Mock).mock.calls.filter(([style]) => style === "light").length;
  /** Dieselbe Show-Runde kurz bevor der Topf steht. */
  const FFA_PLUS = { ...FFA, se8_show_waiting: { ...FFA.se8_show_ready, matches_v2: FFA.se8_show_ready.matches_v2.map((match: any) => ({ ...match, draw_ready: null })) } };

  test("fester Baum: der Modus steht über dem Baum, Antippen erklärt ihn", async () => {
    serve("se6_live", { advancement_mode: "fixed" });
    await open("Baum");
    const mode = await screen.findByTestId("bracket-mode");
    expect(mode).toHaveTextContent(/Fester Baum/);
    expect(screen.queryByTestId("bracket-mode-text")).toBeNull();
    await fireEvent.press(mode);
    expect(screen.getByTestId("bracket-mode-text")).toHaveTextContent("Die Zuordnung steht im Turnierbaum: Sieger aus A trifft Sieger aus B.");
    expect(screen.queryByTestId("bracket-draw-status")).toBeNull();
  });

  test("Show-Auslosung bereit: Hinweis in Gold aus den Daten, die Plätze sagen „Auslosung bereit“", async () => {
    serve("se8_show_ready", {}, undefined, FFA);
    await open("Baum");
    expect(await screen.findByTestId("bracket-draw-ready")).toHaveTextContent(/Auslosung bereit · 4 Namen/);
    expect(screen.getByTestId("bracket-mode")).toHaveTextContent(/Show-Auslosung/);
    const target = screen.getByTestId(`bracket-card-${ffaKey("se8_show_ready", "E")}`);
    expect(within(target).getAllByText("Auslosung bereit").length).toBe(3);
    // Der erste Stand ist kein Moment: nichts hebt sich, nichts vibriert.
    expect(screen.queryByTestId(/^bracket-lift-/)).toBeNull();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  test("der Topf wird bereit: die Zielspiele heben sich, einmal leicht vibrieren - genau einmal", async () => {
    serve("se8_show_waiting", {}, undefined, FFA_PLUS);
    await open("Baum");
    await screen.findByTestId("bracket-canvas");
    expect(screen.queryByTestId("bracket-draw-ready")).toBeNull();
    serve("se8_show_ready", {}, undefined, FFA_PLUS);
    await act(async () => { await mockLive.reload?.(); });
    expect(await screen.findByTestId("bracket-draw-ready")).toHaveTextContent(/Auslosung bereit · 4 Namen/);
    expect(screen.getByTestId(`bracket-lift-${ffaKey("se8_show_ready", "E")}`)).toBeTruthy();
    expect(screen.getByTestId(`bracket-lift-${ffaKey("se8_show_ready", "F")}`)).toBeTruthy();
    expect(light()).toBe(1);
    // Derselbe Wechsel noch einmal (Nachladen nach kurzem Aussetzer): kein zweiter Moment.
    serve("se8_show_waiting", {}, undefined, FFA_PLUS);
    await act(async () => { await mockLive.reload?.(); });
    serve("se8_show_ready", {}, undefined, FFA_PLUS);
    await act(async () => { await mockLive.reload?.(); });
    await screen.findByTestId("bracket-draw-ready");
    expect(light()).toBe(1);
  });

  test("zurück in den Baum: der Moment läuft nicht noch einmal", async () => {
    serve("se8_show_waiting", {}, undefined, FFA_PLUS);
    await open("Baum");
    await screen.findByTestId("bracket-canvas");
    serve("se8_show_ready", {}, undefined, FFA_PLUS);
    await act(async () => { await mockLive.reload?.(); });
    expect(await screen.findByTestId(`bracket-lift-${ffaKey("se8_show_ready", "E")}`)).toBeTruthy();
    await fireEvent.press(screen.getAllByText("Matches")[0]);
    await fireEvent.press(screen.getAllByText("Baum")[0]);
    expect(await screen.findByTestId("bracket-draw-ready")).toBeTruthy();
    expect(screen.queryByTestId(/^bracket-lift-/)).toBeNull();
  });

  test("ausgelost: die Namen kommen herein, der Hinweis geht", async () => {
    serve("se8_show_ready", {}, undefined, FFA);
    await open("Baum");
    await screen.findByTestId("bracket-draw-ready");
    serve("se8_show_drawn", {}, undefined, FFA);
    await act(async () => { await mockLive.reload?.(); });
    await waitFor(() => expect(screen.queryByTestId("bracket-draw-ready")).toBeNull());
    expect(screen.getByTestId(`bracket-lift-${ffaKey("se8_show_drawn", "E")}`)).toBeTruthy();
    expect(light()).toBe(1);
  });

  test("sofort zufällig: „das Los entscheidet“, ein gezogener Platz sagt kurz, wer wohin kam", async () => {
    serve("se8_instant_0", {}, undefined, FFA);
    await open("Baum");
    expect(await screen.findByTestId("bracket-draw-status")).toHaveTextContent("Halbfinale · das Los entscheidet");
    expect(screen.getByTestId(`bracket-card-${ffaKey("se8_instant_0", "E")}`)).toHaveTextContent(/das Los entscheidet/);
    serve("se8_instant_1", {}, undefined, FFA);
    await act(async () => { await mockLive.reload?.(); });
    expect(await screen.findByTestId("bracket-draw-assigned")).toHaveTextContent(/Zufällig gezogen · .+ → [EF]/);
    expect(screen.getByTestId("bracket-draw-status")).toHaveTextContent("Halbfinale · 1 von 4 zufällig gezogen");
    expect(light()).toBe(1);
  });

  test("ohne offenen Baum: kein Moment, keine Vibration", async () => {
    serve("se8_show_waiting", {}, undefined, FFA_PLUS);
    await open("Matches");
    serve("se8_show_ready", {}, undefined, FFA_PLUS);
    await act(async () => { await mockLive.reload?.(); });
    await waitFor(() => expect(mockGet.mock.calls.filter(([url]) => url === "/tournaments/cup").length).toBeGreaterThan(1));
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });
});

// Namen wie im Web (#1591, App #1633): das Loser Bracket beginnt mit „Loser Runde 1“, „[FINAL]“ ist das Grand Final, vorgeplante
// Zeiten heißen „voraussichtlich“ (#1613).
describe("neue Namen im Baum (#1633)", () => {
  const LINES = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../../frontend/e2e/fixtures/bracketLines.json"), "utf8"));

  test("Loser Runde 1 und Grand Final", async () => {
    serve("ffa16de_start", {}, undefined, LINES);
    await open("Baum");
    await screen.findByTestId("bracket-canvas");
    expect(screen.getAllByText(/^Loser Runde 1/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Loser Runde 5/)).toBeNull();
    const final = LINES.ffa16de_start.matches_v2.find((match: any) => match.match_key === "FINAL");
    expect(screen.getByTestId(`bracket-card-${final.id}`)).toHaveTextContent(/^Grand Final/);
    expect(screen.queryByText("Lauf FINAL")).toBeNull();
  });

  test("Abschnitt „FINAL“ steht als Grand Final - mit Pokal, nicht als eigener Hauptbaum", async () => {
    const tree = { ...TREES.de4_reset_cancelled, matches_v2: TREES.de4_reset_cancelled.matches_v2.map((match: any) => (["GF", "grand_final"].includes(String(match.section)) ? { ...match, section: "FINAL" } : match)) };
    serve("de4_final", { status: "completed" }, undefined, { de4_final: tree });
    await open("Baum");
    expect(await screen.findByTestId("bracket-trophy")).toHaveTextContent(/NeonFalke/);
    expect(screen.getAllByText(/^Grand Final/).length).toBeGreaterThan(0);
  });

  test("Vorschau-Baum vorgeplant: Runden-Kopf und Spielplan sagen „voraussichtlich“", async () => {
    const preview = { ...TREES.se6_live, matches_v2: TREES.se6_live.matches_v2.map((match: any) => ({ ...match, is_preview: true, scheduled_at: "2026-10-31T16:30:00Z" })) };
    serve("preview", {}, undefined, { preview });
    await open("Baum");
    await screen.findByTestId("bracket-canvas");
    expect(screen.getAllByText(/voraussichtlich 17:30/).length).toBeGreaterThan(0);
    // Große Schrift (#1633, Codex): der Runden-Kopf darf zwei Zeilen haben und wird kleiner - nie „Viertelfin…“.
    for (const head of screen.getAllByTestId(/^bracket-round-/)) {
      expect(head.props.numberOfLines).toBe(2);
      expect(head.props.adjustsFontSizeToFit).toBe(true);
    }
  });
});
