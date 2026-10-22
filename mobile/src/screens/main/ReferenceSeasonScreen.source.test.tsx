import React from "react";
import { Linking } from "react-native";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { ReferenceSeasonScreen } from "./ReferenceSeasonScreen";

// „Daten von …“ im Kopf der Saison (#1964), wie im Web: mit Partner zur Partnerseite im Web, sonst zur Plattform im
// Browser (nur https). Ein älterer Server schickt `data_source` nicht - dann kein Hinweis. Erfundene Namen.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
  resolveMediaUrl: (url: string) => url,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const navigation = { navigate: jest.fn(), push: jest.fn(), setOptions: jest.fn() } as never;
const route = { key: "season", name: "ReferenceSeason", params: { lineage: "tft", season: "s1" } } as never;
const PAGE = {
  lineage: { title: "Probe TFT Cup", slug: "tft", kind: "series" },
  series: { season: "S1", title: "Probe TFT Cup S1", season_slug: "s1" },
  rounds: [],
  standings: { rows: [] },
};

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

test("ohne Partner: „Daten von PineApps“ öffnet die Plattform im Browser", async () => {
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
  mockGet.mockResolvedValue({ data: { ...PAGE, data_source: { provider: "PineApps", url: "https://tft.pineapps.at", partner: null } } });
  await render(<ReferenceSeasonScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("series-data-source")).toBeTruthy());
  expect(screen.getByTestId("series-data-source")).toHaveTextContent("Daten von PineApps");
  const link = within(screen.getByTestId("series-data-source")).getByRole("link");
  expect(link.props.accessibilityLabel).toBe("Daten von PineApps, öffnet im Browser");
  await fireEvent.press(link);
  expect(open).toHaveBeenCalledWith("https://tft.pineapps.at");
});

test("mit Partner: sein Name, tippen öffnet die Partnerseite im Web", async () => {
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
  mockGet.mockResolvedValue({ data: { ...PAGE, data_source: { provider: "PineApps", url: "https://tft.pineapps.at", partner: { id: "p-ananas", slug: "probe-ananas", name: "Probe Ananas" } } } });
  await render(<ReferenceSeasonScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("series-data-source")).toBeTruthy());
  expect(screen.getByTestId("series-data-source")).toHaveTextContent("Daten von Probe Ananas");
  await fireEvent.press(screen.getByTestId("series-data-source-link"));
  expect(open).toHaveBeenCalledWith(expect.stringMatching(/\/partners\/probe-ananas$/));
});

test("Adresse ohne https: Name ohne Link; älterer Server ohne Feld: kein Hinweis", async () => {
  mockGet.mockResolvedValue({ data: { ...PAGE, data_source: { provider: "PineApps", url: "http://tft.pineapps.at", partner: null } } });
  const first = await render(<ReferenceSeasonScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("series-data-source")).toBeTruthy());
  expect(screen.queryByTestId("series-data-source-link")).toBeNull();
  await first.unmount();

  mockGet.mockResolvedValue({ data: PAGE });
  await render(<ReferenceSeasonScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Probe TFT Cup S1")).toBeTruthy());
  expect(screen.queryByTestId("series-data-source")).toBeNull();
});
