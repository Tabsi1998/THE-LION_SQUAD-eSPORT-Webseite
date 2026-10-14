import React from "react";
import { render, screen } from "@testing-library/react-native";
import { TeamChatScreen } from "./TeamChatScreen";
import { TournamentChatScreen } from "./TournamentChatScreen";

// Team- und Turnier-Chat (#1512): die Kennung aus der Adresse geht nur als ein geprüfter Pfadteil in die API. Eine
// Kennung mit Pfadzeichen lädt nichts und zeigt „nicht gefunden“ statt eines Abrufs auf einen anderen Pfad.

const mockThread = jest.fn();
jest.mock("../../components/ChatThreadView", () => ({
  ChatThreadView: (props: Record<string, unknown>) => {
    mockThread(props);
    return null;
  },
}));
jest.mock("../../components/ReportSheet", () => ({ ReportSheet: () => null }));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1" } }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const navigation = { navigate: jest.fn() } as never;
const routeFor = (id: string) => ({ key: "chat", name: "TeamChat", params: { id } }) as never;

beforeEach(() => mockThread.mockClear());

test("Team-Chat: Pfade mit kodierter Kennung", async () => {
  await render(<TeamChatScreen navigation={navigation} route={routeFor("löwen team")} />);
  expect(mockThread).toHaveBeenCalledWith(expect.objectContaining({
    listUrl: "/teams/l%C3%B6wen%20team/chat",
    postUrl: "/teams/l%C3%B6wen%20team/chat",
    mentionSearchUrl: "/teams/l%C3%B6wen%20team/mention-candidates",
  }));
});

test("Turnier-Chat: Pfade mit kodierter Kennung", async () => {
  await render(<TournamentChatScreen navigation={navigation} route={routeFor("löwen cup")} />);
  expect(mockThread).toHaveBeenCalledWith(expect.objectContaining({
    listUrl: "/tournaments/l%C3%B6wen%20cup/chat",
    postUrl: "/tournaments/l%C3%B6wen%20cup/chat",
  }));
});

test.each([
  ["Team-Chat", TeamChatScreen],
  ["Turnier-Chat", TournamentChatScreen],
])("%s: Kennung mit Pfadzeichen lädt nichts und zeigt „nicht gefunden“", async (_name, Component) => {
  await render(<Component navigation={navigation} route={routeFor("../admin/users")} />);
  expect(mockThread).not.toHaveBeenCalled();
  expect(screen.getByTestId("chat-not-found")).toBeTruthy();
});
