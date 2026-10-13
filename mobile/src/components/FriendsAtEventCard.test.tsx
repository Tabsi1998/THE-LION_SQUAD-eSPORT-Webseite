import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { FriendsAtEventCard } from "./FriendsAtEventCard";

// Freunde beim Event (#1188): Gäste fragen nicht; die Karte zeigt nur, was der Server schickt; der Hinweis erscheint
// einmal und schaltet auf Wunsch sofort aus.

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("./MediaImage", () => ({ MediaImage: ({ fallback }: { fallback?: unknown }) => fallback || null }));

const FINN = { id: "u-finn", display_name: "Finn", avatar_url: null, username: "finn", where: [{ kind: "event" }, { kind: "tournament", id: "t-rl", title: "Rocket League 2v2", team_name: "Lions Rocket" }] };
const LEA = { id: "u-lea", display_name: "Lea Berger", avatar_url: null, username: null, where: [{ kind: "event" }] };

beforeEach(() => jest.clearAllMocks());

test("Gäste: keine Abfrage, keine Karte", async () => {
  await render(<FriendsAtEventCard eventKey="herbst-lan" signedIn={false} />);
  expect(mockGet).not.toHaveBeenCalled();
  expect(screen.queryByTestId("event-friends")).toBeNull();
});

test("Freunde mit Orten und Teamname; Profil nur bei öffentlichem Profil", async () => {
  mockGet.mockResolvedValue({ data: { friends: [FINN, LEA], sharing: true, hint: false } });
  const onOpenProfile = jest.fn();
  await render(<FriendsAtEventCard eventKey="herbst-lan" signedIn onOpenProfile={onOpenProfile} />);
  expect(await screen.findByTestId("event-friends")).toHaveTextContent(/Von deinen Freunden dabei/);
  expect(mockGet).toHaveBeenCalledWith("/events/herbst-lan/friends");
  expect(screen.getByTestId("event-friends-sentence")).toHaveTextContent("Finn und Lea Berger sind dabei.");
  expect(screen.getByTestId("event-friend-u-finn")).toHaveTextContent(/Event · Rocket League 2v2 \(Lions Rocket\)/);
  expect(screen.getByTestId("event-friend-u-lea")).toHaveTextContent(/LB/);
  await fireEvent.press(screen.getByTestId("event-friend-u-finn"));
  expect(onOpenProfile).toHaveBeenCalledWith("finn");
  expect(screen.getByTestId("event-friend-u-lea").props.accessibilityRole).toBeUndefined();
});

test("ohne Freunde und ohne Hinweis keine Karte", async () => {
  mockGet.mockResolvedValue({ data: { friends: [], sharing: true, hint: false } });
  await render(<FriendsAtEventCard eventKey="herbst-lan" signedIn />);
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
  expect(screen.queryByTestId("event-friends")).toBeNull();
});

test("nach dem Event „waren“", async () => {
  mockGet.mockResolvedValue({ data: { friends: [FINN], sharing: true, hint: false } });
  await render(<FriendsAtEventCard eventKey="herbst-lan" signedIn over />);
  expect(await screen.findByTestId("event-friends")).toHaveTextContent(/Deine Freunde waren dabei/);
});

test("Hinweis: „Ausschalten“ schaltet sofort aus und sagt, wo man es wieder einschaltet", async () => {
  mockGet.mockResolvedValue({ data: { friends: [], sharing: true, hint: true } });
  mockPost.mockResolvedValue({ data: { sharing: false } });
  await render(<FriendsAtEventCard eventKey="herbst-lan" signedIn />);
  expect(await screen.findByTestId("event-friends-hint")).toHaveTextContent(/^Deine Freunde sehen, zu welchen Events du angemeldet bist./);
  await fireEvent.press(screen.getByTestId("event-friends-hint-off"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/users/me/friends-hint", { turn_off: true }));
  expect(await screen.findByTestId("event-friends-message")).toHaveTextContent(/Einstellungen → Privatsphäre/);
  expect(screen.queryByTestId("event-friends-hint")).toBeNull();
});

test("Hinweis: „Verstanden“ bestätigt nur", async () => {
  mockGet.mockResolvedValue({ data: { friends: [FINN], sharing: true, hint: true } });
  mockPost.mockResolvedValue({ data: { sharing: true } });
  await render(<FriendsAtEventCard eventKey="herbst-lan" signedIn />);
  await fireEvent.press(await screen.findByTestId("event-friends-hint-ok"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/users/me/friends-hint", { turn_off: false }));
  await waitFor(() => expect(screen.queryByTestId("event-friends-hint")).toBeNull());
  expect(screen.getByTestId("event-friends")).toHaveTextContent(/Finn/);
});
