import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { NewsScreen } from "./NewsScreen";

// News ohne Bild (#1912, App-Teil von #1343): statt leerer Fläche die Text-Karte - mit einem Satz aus der News oder,
// wenn der Server einen Sieger mitliefert, mit Pokal und „1. Name“. Mit Bild bleibt das Bild.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
  responseFromCache: () => false,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => {
  const { View } = jest.requireActual("react-native");
  return { MediaImage: () => <View testID="media-image" /> };
});
jest.mock("../../seasons/anchors", () => ({ SeasonPerch: () => null }));

const navigation = { navigate: jest.fn() } as never;
const route = { key: "news", name: "NewsList" } as never;

beforeEach(() => jest.clearAllMocks());

test("großer Beitrag ohne Bild: Text-Karte mit dem ersten Satz in der Kategorie-Farbe", async () => {
  mockGet.mockResolvedValue({ data: [{ id: "a", title: "Neue Trikots", excerpt: "Die Trikots sind da. Abholung am Freitag.", category: "club" }] });
  await render(<NewsScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("news-text-card-a-sentence")).toBeTruthy());
  expect(screen.getByText("Die Trikots sind da.")).toBeTruthy();
  const style = Object.assign({}, ...[screen.getByTestId("news-text-card-a").props.style].flat(3).filter(Boolean));
  expect(style.backgroundColor).toBe("#85690A");
  expect(screen.queryByTestId("media-image")).toBeNull();
});

test("Ergebnis-News: Pokal und Sieger, aber nur, wenn der Server ihn liefert", async () => {
  mockGet.mockResolvedValue({
    data: [
      { id: "a", title: "Aufmacher", banner_url: "/a.jpg" },
      { id: "r", title: "Herbst-Cup entschieden", category: "tournaments", result: { winner: "Lion Alpha", tournament: "Herbst-Cup" } },
      { id: "n", title: "Ohne Sieger", category: "tournaments", result: null },
    ],
  });
  await render(<NewsScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("news-text-card-r-winner")).toBeTruthy());
  expect(screen.getByTestId("news-text-card-r-winner")).toHaveTextContent("1. Lion Alpha");
  expect(screen.getByTestId("news-text-card-n")).toBeTruthy();
  expect(screen.queryByTestId("news-text-card-n-sentence")).toBeNull();
  expect(screen.queryByTestId("news-text-card-n-winner")).toBeNull();
  // Der Aufmacher mit Bild zeigt das Bild, keine Text-Karte.
  expect(screen.getByTestId("media-image")).toBeTruthy();
  expect(screen.queryByTestId("news-text-card-a-sentence")).toBeNull();
});
