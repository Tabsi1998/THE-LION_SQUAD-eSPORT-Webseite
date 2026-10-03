import React from "react";
import { Alert, Share } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { onLevelChanged } from "../../lib/achievements";
import { AchievementsTab } from "./AchievementsTab";
import type { AchievementsMe } from "./model";

// Der Erfolge-Reiter im App-Profil (E13, #623) - wie im Web (#619): Kopf mit Level, Titel, Sternen und XP, sichtbar
// oder privat, Zahlen, „Als Nächstes“ mit Link, Angeheftete (lösen, sortieren, über die Stufe anheften, höchstens
// sechs), Vitrinen und Filter, die „?“-Karte, Teilen und Prestige mit Bestätigung.

const mockPut = jest.fn();
const mockPost = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { put: (...args: unknown[]) => mockPut(...args), post: (...args: unknown[]) => mockPost(...args), get: jest.fn() },
  errorMessage: (_err: unknown, fallback: string) => fallback,
}));
jest.mock("../../seasons/SeasonFinds", () => ({ SeasonFindsCard: () => null }));
jest.mock("@expo/vector-icons", () => {
  const { Text } = require("react-native");
  return { Ionicons: ({ name }: { name: string }) => <Text>{`icon:${name}`}</Text> };
});

const tier = (code: string, rank: number, name: string, extra: Record<string, unknown> = {}) => ({
  code, rank, level: Math.min(4, Math.ceil(rank / 2)), name, description: `${name}.`, points: 5 * rank, material: "wood", material_name: "Holz",
  earned: false, current: 0, target: 10, percent: 0, manual_only: false, member_only: false, ...extra,
});

const AWARDS = [
  { code: "matches_played_1", award_id: "aw1", name: "Spielmacher I", group_name: "Spielmacher", material: "wood", material_name: "Holz", points: 5, rank: 1 },
  { code: "matches_played_2", award_id: "aw2", name: "Spielmacher II", group_name: "Spielmacher", material: "iron", material_name: "Eisen", points: 10, rank: 2 },
];

const DATA: AchievementsMe = {
  groups: [
    { code: "matches_played", name: "Spielmacher", category: "match", icon: "swords", accent_color: "#29B6E8", description: "Sammle Matches.", tiers: [
      tier("matches_played_1", 1, "Spielmacher I", { earned: true, earned_at: "2026-09-20T10:00:00Z", current: 10, percent: 100 }),
      tier("matches_played_2", 2, "Spielmacher II", { earned: true, earned_at: "2026-09-25T10:00:00Z", material: "iron", material_name: "Eisen", current: 25, target: 25, percent: 100 }),
      tier("matches_played_3", 3, "Spielmacher III", { material: "bronze", material_name: "Bronze", current: 60, target: 75, percent: 80 }),
    ] },
    { code: "lap_hunter", name: "Rundenjäger", category: "fastlap", icon: "flag", accent_color: "#A855F7", tiers: [tier("lap_hunter_1", 1, "Rundenjäger I")] },
  ],
  awards: AWARDS,
  next_up: [
    { code: "matches_played_3", name: "Spielmacher III", group_name: "Spielmacher", group_accent: "#29B6E8", material: "bronze", material_name: "Bronze", points: 15, percent: 80, current: 60, target: 75, missing: 15, how_to: "Spiel Matches in Turnieren.", link: "/tournaments" },
    { code: "chat_1", name: "Plaudertasche", group_name: "Chat", material: "wood", points: 5, percent: 40, current: 4, target: 10, missing: 6, how_to: "Schreib im Chat.", link: "/community" },
  ],
  hidden: { total: 13, earned: 1 },
  pinned: [AWARDS[1]],
  pinned_codes: ["matches_played_2"],
  privacy_achievements_public: true,
  level: { level: 7, xp: 1234, next_level_xp: 1500, progress: 40, title: "Anwärter", next_title_at: 10, prestige: 1, max_level: 60, prestige_available: false, prestige_undo_until: null },
};

const mockOpen = jest.fn();
const mockPrivacy = jest.fn();

function Harness({ initial, guest = false }: { initial: AchievementsMe; guest?: boolean }) {
  const [data, setData] = React.useState(initial);
  return (
    <AchievementsTab
      data={data}
      onDataChange={(update) => setData(update)}
      guest={guest}
      profileScore={55}
      onEvaluate={() => {}}
      onOpenPrivacy={mockPrivacy}
      canOpenLink={(link) => link === "/tournaments"}
      onOpenLink={mockOpen}
    />
  );
}

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockPut.mockReset();
  mockPost.mockReset();
  mockOpen.mockReset();
  mockPrivacy.mockReset();
  mockPut.mockImplementation(async (_url: string, body: { tier_codes: string[] }) => ({ data: { pinned_codes: body.tier_codes, pinned: AWARDS.filter((a) => body.tier_codes.includes(a.code)) } }));
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => {
  alertSpy.mockRestore();
});

test("Kopf mit Level, Titel, Sternen und XP; Sichtbarkeit, Zahlen und „Als Nächstes“ mit Link", async () => {
  await render(<Harness initial={DATA} />);
  expect(screen.getByTestId("achievement-level-title")).toHaveTextContent("Level 7 · Anwärter", { exact: false });
  expect(screen.getByTestId("achievement-prestige").props.accessibilityLabel).toBe("Prestige 1");
  expect(screen.getByText("Nächster Titel ab Level 10.")).toBeTruthy();
  expect(screen.getByTestId("achievement-level-xp")).toHaveTextContent("Bis Level 8", { exact: false });
  expect(screen.getByTestId("achievement-level-xp")).toHaveTextContent("1.234 / 1.500 XP", { exact: false });
  expect(screen.queryByTestId("achievement-prestige-panel")).toBeNull();

  expect(screen.getByTestId("achievement-visibility-note")).toHaveTextContent("Deine Erfolge sind öffentlich", { exact: false });
  await fireEvent.press(screen.getByTestId("achievement-visibility-change"));
  expect(mockPrivacy).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("achievement-stat-hidden")).toHaveTextContent("1/13", { exact: false });

  const next = screen.getByTestId("next-achievement-matches_played_3");
  expect(next).toHaveTextContent("Spielmacher III", { exact: false });
  expect(next).toHaveTextContent("Spiel Matches in Turnieren. Noch 15.", { exact: false });
  expect(next).toHaveTextContent("60/75", { exact: false });
  await fireEvent.press(screen.getByTestId("next-achievement-link-matches_played_3"));
  expect(mockOpen).toHaveBeenCalledWith("/tournaments");
  // Für die Community hat die App keinen Screen - dann kein Link.
  expect(screen.queryByTestId("next-achievement-link-chat_1")).toBeNull();
});

test("Angeheftete lösen und sortieren, über die Stufe anheften - das siebte lehnt die App ab", async () => {
  await render(<Harness initial={DATA} />);
  expect(screen.getByTestId("achievement-pinned-count")).toHaveTextContent("1 von 6", { exact: false });
  expect(screen.getByTestId("achievement-pinned-hint")).toHaveTextContent("Noch 5 Plätze frei", { exact: false });

  await fireEvent.press(screen.getByTestId("pinned-remove-matches_played_2"));
  await waitFor(() => expect(screen.getByTestId("achievement-pinned-count")).toHaveTextContent("0 von 6", { exact: false }));
  expect(mockPut).toHaveBeenLastCalledWith("/achievements/me/pins", { tier_codes: [] });

  await fireEvent.press(screen.getByTestId("achievement-group-matches_played"));
  expect(screen.queryByTestId("achievement-pin-matches_played_3")).toBeNull();
  await fireEvent.press(screen.getByTestId("achievement-pin-matches_played_1"));
  await waitFor(() => expect(screen.getByTestId("achievement-pinned-count")).toHaveTextContent("1 von 6", { exact: false }));
  await fireEvent.press(screen.getByTestId("achievement-pin-matches_played_2"));
  await waitFor(() => expect(screen.getByTestId("achievement-pinned-count")).toHaveTextContent("2 von 6", { exact: false }));
  expect(mockPut).toHaveBeenLastCalledWith("/achievements/me/pins", { tier_codes: ["matches_played_1", "matches_played_2"] });
  expect(screen.getByTestId("achievement-pin-matches_played_1").props.accessibilityState).toMatchObject({ selected: true });

  await fireEvent.press(screen.getByTestId("pinned-up-matches_played_2"));
  await waitFor(() => expect(mockPut).toHaveBeenLastCalledWith("/achievements/me/pins", { tier_codes: ["matches_played_2", "matches_played_1"] }));
});

test("wächst „Angeheftet“ nach einem Anheften aus der Liste, rückt die Ansicht mit - nach Änderungen im Panel nicht", async () => {
  const onShiftAbove = jest.fn();
  function ShiftHarness() {
    const [data, setData] = React.useState(DATA);
    return <AchievementsTab data={data} onDataChange={(update) => setData(update)} profileScore={55} canOpenLink={() => false} onOpenLink={() => {}} onShiftAbove={onShiftAbove} />;
  }
  await render(<ShiftHarness />);
  const wrap = screen.getByTestId("achievement-pinned-wrap");
  await fireEvent(wrap, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 300 } } });
  await fireEvent.press(screen.getByTestId("achievement-group-matches_played"));
  await fireEvent.press(screen.getByTestId("achievement-pin-matches_played_1"));
  await waitFor(() => expect(screen.getByTestId("achievement-pinned-count")).toHaveTextContent("2 von 6", { exact: false }));
  await fireEvent(wrap, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 390 } } });
  expect(onShiftAbove).toHaveBeenCalledWith(90);

  await fireEvent.press(screen.getByTestId("pinned-remove-matches_played_1"));
  await waitFor(() => expect(screen.getByTestId("achievement-pinned-count")).toHaveTextContent("1 von 6", { exact: false }));
  await fireEvent(wrap, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 300 } } });
  expect(onShiftAbove).toHaveBeenCalledTimes(1);
});

test("bei sechs Angehefteten ist „Anheften“ gesperrt und die App ruft nichts", async () => {
  await render(<Harness initial={{ ...DATA, pinned: [], pinned_codes: ["a", "b", "c", "d", "e", "f"] }} />);
  await fireEvent.press(screen.getByTestId("achievement-group-matches_played"));
  const pin = screen.getByTestId("achievement-pin-matches_played_1");
  expect(pin.props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent.press(pin);
  expect(mockPut).not.toHaveBeenCalled();
});

test("Vitrinen, Status und Material filtern die Gruppen; die „?“-Karte zeigt, wie viele Geheime gefunden sind", async () => {
  await render(<Harness initial={DATA} />);
  expect(screen.getByTestId("achievement-showcase-match")).toHaveTextContent("2 von 3", { exact: false });
  expect(screen.getByTestId("achievement-showcase-fastlap")).toHaveTextContent("0 von 1", { exact: false });
  expect(screen.getByTestId("achievement-hidden-count")).toHaveTextContent("1 von 13 gefunden", { exact: false });
  expect(screen.getByTestId("achievement-filter-count")).toHaveTextContent("2 Gruppen", { exact: false });

  await fireEvent.press(screen.getByTestId("achievement-showcase-fastlap"));
  expect(screen.queryByTestId("achievement-group-matches_played")).toBeNull();
  expect(screen.getByTestId("achievement-group-lap_hunter")).toBeTruthy();
  expect(screen.queryByTestId("achievement-hidden-summary")).toBeNull();
  await fireEvent.press(screen.getByTestId("achievement-showcase-clear"));
  expect(screen.getByTestId("achievement-group-matches_played")).toBeTruthy();

  await fireEvent.press(screen.getByText("Erreicht"));
  expect(screen.getByTestId("achievement-filter-count")).toHaveTextContent("1 Gruppe", { exact: false });
  expect(screen.queryByTestId("achievement-group-lap_hunter")).toBeNull();
  await fireEvent.press(screen.getByTestId("achievement-filter-material-bronze"));
  expect(screen.getByText("Nichts passt zu diesem Filter.")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("achievement-filter-reset"));
  expect(screen.getByTestId("achievement-filter-count")).toHaveTextContent("2 Gruppen", { exact: false });
  expect(screen.queryByTestId("achievement-filter-reset")).toBeNull();
});

test("Teilen öffnet das Teilen-Menü mit dem Text des Webs - private Erfolge lassen sich nicht teilen", async () => {
  const shareSpy = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" } as never);
  const view = await render(<Harness initial={DATA} />);
  await fireEvent.press(screen.getByTestId("achievement-group-matches_played"));
  expect(screen.queryByTestId("achievement-share-matches_played_3")).toBeNull();
  await fireEvent.press(screen.getByTestId("achievement-share-matches_played_1"));
  expect(shareSpy).toHaveBeenCalledTimes(1);
  const [content] = shareSpy.mock.calls[0] as [{ message: string; url: string }];
  expect(content.message).toContain("Ich habe „Spielmacher I“ (Holz) bei THE LION SQUAD freigeschaltet.");
  expect(content.url).toMatch(/\/achievements\/a\/aw1$/);
  await view.unmount();

  await render(<Harness initial={{ ...DATA, privacy_achievements_public: false }} />);
  expect(screen.getByTestId("achievement-visibility-note")).toHaveTextContent("Deine Erfolge sind privat", { exact: false });
  await fireEvent.press(screen.getByTestId("achievement-group-matches_played"));
  await fireEvent.press(screen.getByTestId("achievement-share-matches_played_1"));
  expect(shareSpy).toHaveBeenCalledTimes(1);
  expect(alertSpy).toHaveBeenCalledWith("Deine Erfolge sind privat", expect.stringContaining("Erfolge öffentlich"));
  shareSpy.mockRestore();
});

test("Prestige ab Level 60 nur nach Bestätigung; danach neuer Stand, Level-Erkennung und Rücknahme", async () => {
  const levelChanged = jest.fn();
  const stop = onLevelChanged(levelChanged);
  const top = { ...DATA.level, level: 60, title: "Legende", prestige: 0, prestige_available: true, xp: 99000, next_level_xp: 99000, progress: 100 };
  await render(<Harness initial={{ ...DATA, level: top }} />);
  expect(screen.getByTestId("achievement-prestige-panel")).toHaveTextContent("Level 60 erreicht", { exact: false });
  expect(screen.getByTestId("achievement-level-xp")).toHaveTextContent("Höchstes Level99.000 XP");

  // Abbrechen: nichts passiert.
  alertSpy.mockImplementation((_title, _message, buttons) => buttons?.[0]?.onPress?.());
  await fireEvent.press(screen.getByTestId("achievement-prestige-start"));
  expect(alertSpy).toHaveBeenLastCalledWith("1. Prestige-Stern?", expect.stringContaining("Alle Erfolge und Punkte bleiben"), expect.any(Array), expect.any(Object));
  expect(mockPost).not.toHaveBeenCalled();

  // Bestätigen: der neue Stand ersetzt den alten, die Level-Erkennung sieht nach (Zeremonie für den Stern).
  const after = { level: 1, xp: 0, next_level_xp: 125, progress: 0, title: "Rookie", prestige: 1, max_level: 60, prestige_available: false, prestige_undo_until: "2099-01-01T12:00:00+00:00" };
  mockPost.mockResolvedValueOnce({ data: after });
  alertSpy.mockImplementation((_title, _message, buttons) => buttons?.[1]?.onPress?.());
  await fireEvent.press(screen.getByTestId("achievement-prestige-start"));
  await waitFor(() => expect(screen.getByTestId("achievement-level-title")).toHaveTextContent("Level 1 · Rookie", { exact: false }));
  expect(mockPost).toHaveBeenCalledWith("/users/me/prestige");
  expect(levelChanged).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("achievement-prestige-panel")).toHaveTextContent("1. Prestige-Stern – bis", { exact: false });

  mockPost.mockResolvedValueOnce({ data: top });
  await fireEvent.press(screen.getByTestId("achievement-prestige-undo"));
  await waitFor(() => expect(screen.getByTestId("achievement-level-title")).toHaveTextContent("Level 60 · Legende", { exact: false }));
  expect(mockPost).toHaveBeenLastCalledWith("/users/me/prestige/undo");
  expect(alertSpy).toHaveBeenLastCalledWith("Prestige zurückgenommen", "Level und XP sind wieder da.");
  expect(levelChanged).toHaveBeenCalledTimes(2);
  stop();
});

test("als Gast nur ansehen: kein Anheften, kein Teilen, kein Prestige, keine Sichtbarkeit", async () => {
  await render(<Harness initial={{ ...DATA, level: { ...DATA.level, level: 60, prestige_available: true } }} guest />);
  expect(screen.queryByTestId("achievement-pinned")).toBeNull();
  expect(screen.queryByTestId("achievement-visibility-note")).toBeNull();
  expect(screen.queryByTestId("achievement-prestige-panel")).toBeNull();
  expect(screen.queryByTestId("profile-achievements-evaluate")).toBeNull();
  await fireEvent.press(screen.getByTestId("achievement-group-matches_played"));
  expect(screen.queryByTestId("achievement-pin-matches_played_1")).toBeNull();
  expect(screen.queryByTestId("achievement-share-matches_played_1")).toBeNull();
  await act(async () => {});
});

test("der Weg in den Schaukasten (Bestenliste, Erfolg der Woche, Seltenheit)", async () => {
  const onOpenShowcase = jest.fn();
  await render(<AchievementsTab data={DATA} onDataChange={() => {}} profileScore={55} canOpenLink={() => false} onOpenLink={() => {}} onOpenShowcase={onOpenShowcase} />);
  await fireEvent.press(screen.getByTestId("achievement-open-showcase"));
  expect(onOpenShowcase).toHaveBeenCalledTimes(1);
});
