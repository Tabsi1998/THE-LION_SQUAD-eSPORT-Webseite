import React from "react";
import { Text } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ChatsProvider, useUnreadChats } from "../../../chats/ChatsContext";
import { chatTarget, markChatRead, withChatRead } from "../../../lib/chats";
import { ChatsSection } from "./ChatsSection";

// Community → Chats (#1148): Direktnachrichten, Team-, Turnier- und Match-Chats in einer Liste, das Neueste oben, mit der
// Zahl der Ungelesenen; die Zahl am Tab „Community“ ist die Summe. Lesen setzt sie überall zurück.

const mockGet = jest.fn();
const mockPost = jest.fn(async () => ({ data: { ok: true } }));
jest.mock("../../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...(args as [])) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock("../../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-neon", username: "neonfalke" } }) }));
jest.mock("../../../live", () => ({ isGuestUser: (user: unknown) => !user }));
jest.mock("../../../notifications/NotificationContext", () => ({ useOptionalNotifications: () => ({ unread: 0 }) }));
jest.mock("../../../realtime/LiveChangesProvider", () => ({ useLiveRefresh: () => undefined }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../../components/MediaImage", () => ({ MediaImage: () => null }));
jest.mock("../../../navigation/rootNavigation", () => ({ openSignIn: jest.fn() }));

const LIST = {
  unread_total: 3,
  items: [
    { key: "team:t-rocket", kind: "team", target_id: "t-rocket", title: "Lions Rocket", tag: "LR", subtitle: "Team-Chat", last_message: { text: "Training heute um 20 Uhr", author: "LunaByte", created_at: "2026-10-07T12:02:00Z" }, unread_count: 2, updated_at: "2026-10-07T12:02:00Z" },
    { key: "tournament:fc26", kind: "tournament", target_id: "fc26", slug: "fc-26-cup", title: "FC 26 Cup", subtitle: "Turnier-Chat", last_message: { text: "Halbfinale ab 15 Uhr", author: "Turnierleitung", created_at: "2026-10-07T11:40:00Z" }, unread_count: 0, updated_at: "2026-10-07T11:40:00Z" },
    { key: "direct:u-schatten", kind: "direct", target_id: "u-schatten", title: "Schattenwolf", subtitle: "Nachricht", last_message: { text: "gg! Revanche am Sonntag?", author: "Schattenwolf", created_at: "2026-10-07T10:15:00Z" }, unread_count: 1, updated_at: "2026-10-07T10:15:00Z" },
    { key: "match:m-1", kind: "match", target_id: "m-1", title: "NeonFalke gegen PixelPanther", subtitle: "Match-Chat", last_message: { text: "PC 3 ist frei", author: "PixelPanther", created_at: "2026-10-07T09:58:00Z" }, unread_count: 0, updated_at: "2026-10-07T09:58:00Z" },
  ],
};

function TabCount() {
  return <Text testID="tab-count">{String(useUnreadChats())}</Text>;
}

const navigate = jest.fn();
const navigation = { navigate } as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ data: LIST });
});

test("alle vier Arten in einer Liste, das Neueste oben, mit Ungelesenen; die Tab-Zahl ist die Summe", async () => {
  await render(
    <ChatsProvider>
      <TabCount />
      <ChatsSection navigation={navigation} guest={false} />
    </ChatsProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("chat-team:t-rocket")).toBeTruthy());
  const rows = screen.getAllByTestId(/^chat-(team|tournament|direct|match):[\w-]+$/).map((node) => node.props.testID).filter((id: string) => !id.endsWith("-unread"));
  expect(rows).toEqual(["chat-team:t-rocket", "chat-tournament:fc26", "chat-direct:u-schatten", "chat-match:m-1"]);
  expect(screen.getByTestId("chat-team:t-rocket-unread")).toHaveTextContent("2");
  expect(screen.getByTestId("chat-direct:u-schatten-unread")).toHaveTextContent("1");
  expect(screen.queryByTestId("chat-tournament:fc26-unread")).toBeNull();
  expect(screen.getByText("Team-Chat · LunaByte: Training heute um 20 Uhr")).toBeTruthy();
  expect(screen.getByText("Nachricht: gg! Revanche am Sonntag?")).toBeTruthy();
  expect(screen.getByTestId("tab-count")).toHaveTextContent("3");

  // Ein Tipp öffnet den Chat selbst - über dem aktuellen Tab.
  await fireEvent.press(screen.getByTestId("chat-team:t-rocket"));
  expect(navigate).toHaveBeenLastCalledWith("TeamChat", { id: "t-rocket", title: "LR Chat" });
  await fireEvent.press(screen.getByTestId("chat-match:m-1"));
  expect(navigate).toHaveBeenLastCalledWith("MatchDetail", { id: "m-1" });

  // Gelesen (in App oder Web): die Zahl geht weg, am Tab sinkt die Summe, der Server bekommt die Marke.
  await act(async () => {
    await markChatRead("team", "t-rocket");
  });
  expect(mockPost).toHaveBeenCalledWith("/chats/team/t-rocket/read");
  expect(screen.queryByTestId("chat-team:t-rocket-unread")).toBeNull();
  expect(screen.getByTestId("tab-count")).toHaveTextContent("1");
});

test("ohne Chats ein Satz, als Gast der Weg zum Konto - ohne Anfrage", async () => {
  mockGet.mockResolvedValue({ data: { items: [], unread_total: 0 } });
  const view = await render(<ChatsProvider><ChatsSection navigation={navigation} guest={false} /></ChatsProvider>);
  await waitFor(() => expect(screen.getByText("Noch keine Chats")).toBeTruthy());
  await view.unmount();
  mockGet.mockClear();
  await render(<ChatsSection navigation={navigation} guest />);
  expect(screen.getByTestId("chats-sign-in")).toBeTruthy();
  expect(mockGet).not.toHaveBeenCalled();
});

test("wohin ein Eintrag führt und wie das Lesen die Summe ändert", () => {
  expect(chatTarget(LIST.items[2] as never)).toEqual({ screen: "DirectThread", params: { userId: "u-schatten", title: "Schattenwolf" } });
  expect(chatTarget(LIST.items[1] as never)).toEqual({ screen: "TournamentChat", params: { id: "fc26", title: "FC 26 Cup Chat" } });
  expect(withChatRead(LIST as never, "direct:u-schatten").unread_total).toBe(2);
  expect(withChatRead(LIST as never, "tournament:fc26")).toBe(LIST);
});
