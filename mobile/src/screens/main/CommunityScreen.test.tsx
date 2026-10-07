import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { CommunityScreen } from "./CommunityScreen";

// Der Tab Community (#1143): Gäste landen bei den Teams, Mitglieder bei den Chats. Die Tabs bleiben beim Anmelden und
// Abmelden geladen (Gast zuerst, #918) - die Geräteprobe vor 1.4.0 fand ein frisch angemeldetes Mitglied mit
// ungelesenen Chats weiter bei den Teams aus der Gast-Zeit. Wechselt der Stand, gilt der Standard neu; eine eigene
// Wahl bleibt, solange der Stand gleich bleibt.

const mockUser = { value: null as { id: string; username: string } | null };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: mockUser.value }) }));
jest.mock("../../live", () => ({ isGuestUser: (user: unknown) => !user }));
jest.mock("../../chats/ChatsContext", () => ({ useChats: () => ({ list: { items: [], unread_total: 2 } }) }));
jest.mock("../../lib/api", () => ({ api: { get: () => Promise.resolve({ data: [] }) } }));
jest.mock("../../components/TabHeader", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { TabHeader: ({ title }: { title: string }) => <MockText>{title}</MockText>, useTabScrollToTop: () => undefined };
});
jest.mock("./community/ChatsSection", () => ({ ChatsSection: () => null }));
jest.mock("./TeamsScreen", () => ({ TeamsSection: () => null }));
jest.mock("../../components/FriendsCard", () => ({ FriendsCard: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const navigation = { navigate: jest.fn() } as never;
const route = { key: "community", name: "CommunityHub" } as never;
const member = { id: "u-1", username: "leon_king" };

beforeEach(() => {
  mockUser.value = null;
});

test("Gast landet bei den Teams; nach dem Anmelden stehen die Chats vorn, nach dem Abmelden wieder die Teams", async () => {
  const view = await render(<CommunityScreen navigation={navigation} route={route} />);
  expect(screen.getByTestId("community-section-teams")).toBeTruthy();

  mockUser.value = member;
  await view.rerender(<CommunityScreen navigation={navigation} route={route} />);
  expect(screen.getByTestId("community-section-chats")).toBeTruthy();
  expect(screen.getByText("Chats 2")).toBeTruthy();

  mockUser.value = null;
  await view.rerender(<CommunityScreen navigation={navigation} route={route} />);
  expect(screen.getByTestId("community-section-teams")).toBeTruthy();
});

test("eine eigene Wahl bleibt, solange sich am Anmeldestand nichts ändert", async () => {
  mockUser.value = member;
  const view = await render(<CommunityScreen navigation={navigation} route={route} />);
  expect(screen.getByTestId("community-section-chats")).toBeTruthy();
  await fireEvent.press(screen.getByText("Teams"));
  expect(screen.getByTestId("community-section-teams")).toBeTruthy();

  // Ein neues Profil-Objekt (etwa nach „refreshMe“) ist kein Wechsel des Stands.
  mockUser.value = { ...member };
  await view.rerender(<CommunityScreen navigation={navigation} route={route} />);
  expect(screen.getByTestId("community-section-teams")).toBeTruthy();
});
