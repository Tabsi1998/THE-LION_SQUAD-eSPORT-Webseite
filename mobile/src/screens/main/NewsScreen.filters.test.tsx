import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { NewsScreen } from "./NewsScreen";

// News wie im Web (#1946, NewsFilterRow #1249 und withoutRepeatedBanners #1343): Kategorien mit Anzahl - nur genutzte -,
// die Suche als Symbol am Ende derselben Wischzeile, das zum Feld aufklappt, und nie dasselbe Bild zweimal hintereinander.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
  responseFromCache: () => false,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => {
  const { View } = jest.requireActual("react-native");
  return { MediaImage: ({ uri }: { uri: string }) => <View testID={`media-image-${uri}`} /> };
});
jest.mock("../../seasons/anchors", () => ({ SeasonPerch: () => null }));

const navigation = { navigate: jest.fn() } as never;
const route = { key: "news", name: "NewsList" } as never;

const posts = [
  { id: "a", slug: "a", title: "Saisonstart", category: "club", banner_url: "/cover.jpg", published_at: "2030-01-05T10:00:00Z" },
  { id: "b", slug: "b", title: "Cup-Anmeldung offen", category: "tournaments", banner_url: "/cover.jpg", published_at: "2030-01-04T10:00:00Z" },
  { id: "c", slug: "c", title: "Vereinsabend", category: "club", banner_url: "/abend.jpg", published_at: "2030-01-03T10:00:00Z" },
  { id: "d", slug: "d", title: "Ohne Kategorie", category: "", banner_url: null, published_at: "2030-01-02T10:00:00Z" },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ data: posts });
});

test("Kategorien mit Anzahl: nur genutzte, „Alle“ zählt alle - Antippen filtert", async () => {
  await render(<NewsScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("news-filter-all")).toBeTruthy());
  expect(within(screen.getByTestId("news-filter-all")).getByText("4")).toBeTruthy();
  expect(within(screen.getByTestId("news-filter-club")).getByText("Verein")).toBeTruthy();
  expect(within(screen.getByTestId("news-filter-club")).getByText("2")).toBeTruthy();
  expect(within(screen.getByTestId("news-filter-tournaments")).getByText("1")).toBeTruthy();
  // Nur Kategorien mit Beiträgen - keine leere „Events“-Taste.
  expect(screen.queryByTestId("news-filter-events")).toBeNull();
  expect(screen.getByTestId("news-filter-all").props.accessibilityState).toEqual({ selected: true });

  await fireEvent.press(screen.getByTestId("news-filter-club"));
  expect(screen.getByTestId("news-filter-club").props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByText("Vereinsabend")).toBeTruthy();
  expect(screen.queryByText("Cup-Anmeldung offen")).toBeNull();
});

test("die Suche ist ein Symbol in der Zeile und klappt zum Feld auf - „Suche leeren“ klappt sie wieder zu", async () => {
  await render(<NewsScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("news-search-open")).toBeTruthy());
  // Zu Beginn kein dauerhaftes Feld.
  expect(screen.queryByPlaceholderText("News suchen")).toBeNull();
  // Das Symbol steht in derselben Zeile wie die Kategorien.
  expect(within(screen.getByTestId("news-filters")).getByTestId("news-search-open")).toBeTruthy();

  await fireEvent.press(screen.getByTestId("news-search-open"));
  const field = screen.getByPlaceholderText("News suchen");
  await fireEvent.changeText(field, "abend");
  expect(screen.getByText("Vereinsabend")).toBeTruthy();
  expect(screen.queryByText("Saisonstart")).toBeNull();

  await fireEvent.press(screen.getByLabelText("Suche leeren"));
  expect(screen.queryByPlaceholderText("News suchen")).toBeNull();
  expect(screen.getByText("Saisonstart")).toBeTruthy();
  expect(screen.getByTestId("news-search-open")).toBeTruthy();
});

test("dasselbe Bild nie zweimal hintereinander: die Wiederholung bekommt die Text-Karte", async () => {
  await render(<NewsScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Cup-Anmeldung offen")).toBeTruthy());
  expect(screen.getAllByTestId("media-image-/cover.jpg")).toHaveLength(1);
  expect(screen.getByTestId("news-text-card-b")).toBeTruthy();
  expect(screen.getByTestId("media-image-/abend.jpg")).toBeTruthy();
});

test("alter Server ohne Kategorien: keine Filterzeile mit Nullen, die Suche bleibt", async () => {
  mockGet.mockResolvedValue({ data: posts.map(({ category: _category, ...post }) => post) });
  await render(<NewsScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Saisonstart")).toBeTruthy());
  expect(screen.queryByTestId("news-filter-all")).toBeNull();
  expect(screen.getByTestId("news-search-open")).toBeTruthy();
});
