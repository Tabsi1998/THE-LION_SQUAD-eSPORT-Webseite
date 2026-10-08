import fs from "fs";
import path from "path";
import React from "react";
import { Dimensions, PixelRatio } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { auditTree, findingLines, type A11yNode } from "./audit";
import { notifications } from "./fixtures";

// Barrierefreiheit (#1155): jeder registrierte Screen der App wird mit 1,5- und 2-facher Schrift gerendert und geprüft
// (audit.ts): Namen für Knöpfe und Reiter, Tippflächen ab 48 Punkten, Reiter sagen, was gewählt ist, Schrift wächst
// mit, Namen werden nicht auf eine Zeile gekürzt. Die Daten (fixtures.ts) haben lange Namen und Listen mit acht
// Personen. Ausnahmen stünden in a11y-baseline.json (Ratsche, heute leer): neue Funde lassen den Test scheitern,
// behobene müssen aus der Grundlinie (BASELINE_UPDATE=1 schreibt sie neu). Turnier-, Match-, Event-Seite und Home
// bekommen in ihren eigenen Meilensteinen reichere Daten (Durchgänge mit acht Namen), wenn sie neu gebaut werden.

jest.mock("../lib/api", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  api: { get: async (url: string) => ({ data: require("./fixtures").fixtureFor(url) }), post: async () => ({ data: {} }), put: async () => ({ data: {} }), patch: async () => ({ data: {} }), delete: async () => ({ data: {} }) },
  errorMessage: (_error: unknown, fallback = "Fehler") => fallback,
  resolveMediaUrl: (value?: string | null) => value || "",
  responseFromCache: () => false,
  isOfflineError: () => false,
}));
// Gleichbleibende Objekte: neue Funktionen bei jedem Aufruf ließen Screens mit `useEffect(…, [refreshMe])` endlos laden.
const mockUser = { id: "u-1", username: "neonfalke", display_name: "NeonFalke", role: "player", is_club_member: true, areas: [] as string[], membership: { member_status: "active" } };
const mockAuth = { user: mockUser, accessToken: "t", loading: false, refreshMe: async () => undefined, logout: async () => undefined, login: async () => undefined, setUser: () => undefined };
jest.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
const mockNotifications = { items: notifications, unread: 1, load: async () => undefined, markAllRead: async () => undefined, openNotification: () => undefined };
jest.mock("../notifications/NotificationContext", () => ({
  ...jest.requireActual("../notifications/NotificationContext"),
  useNotifications: () => mockNotifications,
}));
jest.mock("react-native-keyboard-controller", () => {
  const { View } = jest.requireActual("react-native");
  return { KeyboardAvoidingView: View };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
const mockParams: Record<string, unknown> = { id: "x1", username: "spieler1", userId: "p2", title: "Chat", slug: "x1", albumId: "x1", index: 0 };
const mockRoute = { key: "r", name: "Screen", params: mockParams };
const mockNavigation = {
  navigate: () => undefined, push: () => undefined, goBack: () => undefined, setOptions: () => undefined, addListener: () => () => undefined,
  isFocused: () => true, getParent: () => undefined, getState: () => undefined, canGoBack: () => true, dispatch: () => undefined,
};
jest.mock("@react-navigation/native", () => {
  const { useEffect } = jest.requireActual("react");
  return {
    ...jest.requireActual("@react-navigation/native"),
    useNavigation: () => mockNavigation,
    useRoute: () => mockRoute,
    useIsFocused: () => true,
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(() => effect(), [effect]),
  };
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const BASELINE_PATH = path.join(__dirname, "a11y-baseline.json");
const baseline: Record<string, string[]> = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
const found: Record<string, string[]> = {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DETAIL_SCREENS, TAB_ROOT_SCREENS } = require("../navigation/screenRegistry");
const SCREENS: Array<[string, React.ComponentType<Record<string, unknown>>]> = Object.entries({ ...TAB_ROOT_SCREENS, ...DETAIL_SCREENS });

async function auditAt(scale: number, Component: React.ComponentType<Record<string, unknown>>, name: string): Promise<string[]> {
  jest.spyOn(PixelRatio, "getFontScale").mockReturnValue(scale);
  Dimensions.set({ window: { ...Dimensions.get("window"), fontScale: scale }, screen: { ...Dimensions.get("screen"), fontScale: scale } });
  try {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <Component navigation={mockNavigation} route={{ ...mockRoute, key: name, name }} />
      </SafeAreaProvider>,
    );
    await act(async () => {
      for (let n = 0; n < 4; n += 1) await Promise.resolve();
    });
    const lines = findingLines(auditTree(screen.root as unknown as A11yNode));
    await screen.unmount();
    return lines;
  } catch (error) {
    return [`render: ${error instanceof Error ? error.message.split("\n")[0].slice(0, 80) : "Fehler"}`];
  }
}

afterAll(() => {
  if (process.env.BASELINE_UPDATE !== "1") return;
  const current = Object.fromEntries(Object.entries(found).filter(([, lines]) => lines.length).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
});

test.each(SCREENS)("%s: mit 1,5- und 2-facher Schrift keine neuen Funde", async (name, Component) => {
  const lines = [...new Set([...(await auditAt(1.5, Component, name)), ...(await auditAt(2, Component, name))])].sort();
  found[name] = lines;
  if (process.env.BASELINE_UPDATE === "1") return;
  const known = baseline[name] || [];
  expect(lines.filter((line) => !known.includes(line))).toEqual([]);
  // Behobenes muss aus der Grundlinie - sonst wächst sie still wieder zu.
  expect(known.filter((line) => !lines.includes(line))).toEqual([]);
}, 30000);
