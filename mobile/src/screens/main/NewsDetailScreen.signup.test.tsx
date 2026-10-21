import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { NewsDetailScreen } from "./NewsDetailScreen";

// News führen zur Anmeldung (#1912, App-Teil von #1266): nach dem ersten Absatz je verknüpftem Turnier bzw. Event eine
// Karte mit Stand. „Anmelden“ öffnet das Turnier bzw. Event; ist die Anmeldung zu, steht dort der Stand.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: jest.fn(async () => ({ data: {} })) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("../../live", () => ({ isGuestUser: () => true }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));
jest.mock("../../components/ContentCard", () => ({ ContentCard: () => null }));
jest.mock("../../components/RichText", () => {
  const { Text } = jest.requireActual("react-native");
  return { RichText: ({ text }: { text: string }) => <Text testID="rich-text">{text}</Text> };
});

const navigate = jest.fn();
const navigation = { navigate, setOptions: jest.fn(), getParent: () => ({ navigate: jest.fn() }) } as never;
const route = { key: "n", name: "NewsDetail", params: { id: "herbst-cup" } } as never;
const POST = {
  id: "n1",
  slug: "herbst-cup",
  title: "Herbst-Cup",
  content: "Erster Absatz.\n\nZweiter Absatz.",
  linked_tournaments: [{ id: "t1", slug: "herbst-cup-2026", title: "Herbst-Cup 2026", signup: { state: "open", start_date: "2026-11-07T14:00:00Z", max: 16, spots_left: 5, taken: 11 } }],
  linked_events: [{ id: "e1", slug: "lan", name: "LAN-Party", signup: { state: "full", max: 40, spots_left: 0, taken: 40 } }],
};

beforeEach(() => jest.clearAllMocks());

test("Anmelde-Karten stehen zwischen erstem Absatz und Rest, mit Plätzen und Stand", async () => {
  mockGet.mockResolvedValue({ data: POST });
  await render(<NewsDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("news-signups")).toBeTruthy());
  const texts = screen.getAllByTestId("rich-text").map((node) => node.props.children);
  expect(texts).toEqual(["Erster Absatz.", "Zweiter Absatz."]);
  expect(screen.getByTestId("news-signup-herbst-cup-2026-seats")).toHaveTextContent("Noch 5 von 16 Plätzen frei");
  expect(screen.getByTestId("news-signup-lan-state")).toHaveTextContent("Ausgebucht");
  expect(screen.queryByTestId("news-signup-herbst-cup-2026-state")).toBeNull();
  expect(screen.getByTestId("news-signup-lan-go")).toHaveTextContent("Zum Event");
});

test("„Anmelden“ öffnet das Turnier, die Event-Karte das Event", async () => {
  mockGet.mockResolvedValue({ data: POST });
  await render(<NewsDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("news-signups")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("news-signup-herbst-cup-2026-go"));
  expect(navigate).toHaveBeenLastCalledWith("TournamentDetail", { id: "herbst-cup-2026" });
  await fireEvent.press(screen.getByTestId("news-signup-lan-go"));
  expect(navigate).toHaveBeenLastCalledWith("EventDetail", { id: "lan" });
});

test("ohne Stand vom Server: keine Karten, der Text bleibt am Stück", async () => {
  mockGet.mockResolvedValue({ data: { ...POST, linked_tournaments: [{ id: "t1", title: "Alt" }], linked_events: [] } });
  await render(<NewsDetailScreen navigation={navigation} route={{ ...(route as object), params: { id: "alt" } } as never} />);

  await waitFor(() => expect(screen.getByText("Herbst-Cup")).toBeTruthy());
  expect(screen.queryByTestId("news-signups")).toBeNull();
  expect(screen.getAllByTestId("rich-text").map((node) => node.props.children)).toEqual(["Erster Absatz.\n\nZweiter Absatz."]);
});
