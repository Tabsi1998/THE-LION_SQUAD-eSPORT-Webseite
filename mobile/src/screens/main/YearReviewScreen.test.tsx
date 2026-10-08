import React from "react";
import { AccessibilityInfo, Animated } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// Jahresrückblick in der App (#1195): Seiten zum Durchtippen (rechts weiter, links zurück, Knöpfe), am Ende das Bild
// mit Anmeldung; mit „Bewegung reduzieren“ stehen die Seiten sofort da; ohne Rückblick ein Hinweis.

const mockGet = jest.fn();
const mockShare = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  resolveMediaUrl: (value?: string | null) => (value ? `https://verein.example${value}` : ""),
}));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ accessToken: "token-1" }) }));
jest.mock("../../lib/yearReview", () => ({ ...jest.requireActual("../../lib/yearReview"), shareYearCard: (...args: unknown[]) => mockShare(...args) }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { YearReviewScreen } = require("./YearReviewScreen");

const REVIEW = {
  year: 2026, club_name: "THE LION SQUAD", image_path: "/api/year-review/me/card.png",
  tournaments: { count: 31, wins: 7, podiums: 12, games: 41, best: { title: "FC 26 Herbst-Cup", rank: 1, participant_count: 16 }, more_than_of_ten: 9 },
  favorite_game: { name: "EA SPORTS FC 26", tournaments: 19, games: 41 },
  events: { count: 0, items: [] },
  fastlap: { count: 0, best: null },
  achievements: { count: 0, top: [] },
  season: { name: "Jahreswertung 2026", rank: 5, points: 210, participants: 48 },
};

async function renderScreen(params?: { preview?: boolean }) {
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const result = await render(<YearReviewScreen navigation={navigation as never} route={{ key: "y", name: "YearReview", params } as never} />);
  return { navigation, ...result };
}

beforeEach(() => {
  mockGet.mockReset();
  mockShare.mockReset();
});

test("blättert vor und zurück bis zum Bild und teilt es", async () => {
  mockGet.mockResolvedValue({ data: REVIEW });
  const { navigation } = await renderScreen();
  expect(await screen.findByTestId("year-review-page-intro")).toBeTruthy();
  expect(mockGet).toHaveBeenCalledWith("/year-review/me", { params: undefined });
  expect(screen.getByTestId("year-review-position")).toHaveTextContent("1 / 5");

  const tap = screen.getByTestId("year-review-tap");
  await fireEvent(tap, "layout", { nativeEvent: { layout: { width: 300, height: 500, x: 0, y: 0 } } });
  await fireEvent.press(tap, { nativeEvent: { locationX: 250 } });
  expect(await screen.findByTestId("year-review-page-tournaments")).toBeTruthy();
  expect(screen.getByTestId("year-review-comparison")).toHaveTextContent("Mehr Turniere als 9 von 10 im Verein.");
  await fireEvent.press(tap, { nativeEvent: { locationX: 20 } });
  expect(await screen.findByTestId("year-review-page-intro")).toBeTruthy();

  for (let i = 0; i < 4; i += 1) await fireEvent.press(screen.getByTestId("year-review-next"));
  expect(await screen.findByTestId("year-review-page-share")).toBeTruthy();
  expect(screen.getByTestId("year-review-card").props.source).toEqual({ uri: "https://verein.example/api/year-review/me/card.png", headers: { Authorization: "Bearer token-1" } });
  mockShare.mockResolvedValue("failed");
  await fireEvent.press(screen.getByTestId("year-review-share"));
  await waitFor(() => expect(mockShare).toHaveBeenCalledWith(REVIEW, "token-1"));
  expect(await screen.findByText("Teilen ging gerade nicht – versuch es gleich noch einmal.")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("year-review-done"));
  expect(navigation.goBack).toHaveBeenCalled();
});

function fades(timing: jest.SpyInstance) {
  return timing.mock.calls.filter(([, config]) => config.duration === 240 && config.toValue === 1).length;
}

test("Seiten blenden ein - mit „Bewegung reduzieren“ stehen sie sofort da; die Vorschau fragt mit vorschau", async () => {
  const timing = jest.spyOn(Animated, "timing");
  const motion = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  mockGet.mockResolvedValue({ data: REVIEW });
  const first = await renderScreen();
  await screen.findByTestId("year-review-page-intro");
  timing.mockClear();
  await fireEvent.press(screen.getByTestId("year-review-next"));
  await screen.findByTestId("year-review-page-tournaments");
  expect(fades(timing)).toBe(1);
  await first.unmount();

  motion.mockResolvedValue(true);
  mockGet.mockResolvedValue({ data: { ...REVIEW, preview: true } });
  await renderScreen({ preview: true });
  expect(await screen.findByText("Dein 2026 · Vorschau")).toBeTruthy();
  expect(mockGet).toHaveBeenLastCalledWith("/year-review/me", { params: { vorschau: true } });
  // Sobald das Handy „Bewegung reduzieren“ meldet, blendet keine Seite mehr ein - sie steht sofort da.
  await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
  timing.mockClear();
  await fireEvent.press(screen.getByTestId("year-review-next"));
  await screen.findByTestId("year-review-page-tournaments");
  expect(fades(timing)).toBe(0);
  timing.mockRestore();
  motion.mockRestore();
});

test("ohne Rückblick ein Hinweis mit Weg zurück", async () => {
  mockGet.mockRejectedValue({ response: { status: 404 } });
  const { navigation } = await renderScreen();
  expect(await screen.findByText("Gerade kein Jahresrückblick")).toBeTruthy();
  await fireEvent.press(screen.getByText("Zurück"));
  expect(navigation.goBack).toHaveBeenCalled();
});
