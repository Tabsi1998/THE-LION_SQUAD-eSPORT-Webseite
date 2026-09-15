import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { TeamsScreen } from "./TeamsScreen";

// Teamliste: eigene Teams mit Chat-Knopf, weitere Teams darunter, Squads nur
// wenn es welche gibt (#215).

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: jest.fn() },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));

const navigate = jest.fn();
const navigation = { navigate } as never;
const route = { key: "teams", name: "TeamList" } as never;

beforeEach(() => {
  jest.clearAllMocks();
});

function answer(path: string, mine: unknown[], all: unknown[]) {
  if (path === "/teams/my") return Promise.resolve({ data: mine });
  if (path === "/teams") return Promise.resolve({ data: all });
  return Promise.resolve({ data: [] });
}

test("eigene Teams mit Chat, weitere darunter, keine Squads bei 0", async () => {
  const lions = { id: "t1", name: "Lions", tag: "TLS", member_count: 12, squad_count: 0, chat_preview: [{ author: "bob", message: "gg", time: "" }] };
  const other = { id: "t2", name: "Andere", member_count: 3, squad_count: 2 };
  mockGet.mockImplementation((path: string) => answer(path, [lions], [lions, other]));

  await render(<TeamsScreen navigation={navigation} route={route} />);

  await waitFor(() => expect(screen.getByText("Meine Teams")).toBeTruthy());
  expect(screen.getByText("Weitere Teams")).toBeTruthy();
  expect(screen.getAllByText("Lions")).toHaveLength(1);
  expect(screen.getByText("12 Mitglieder")).toBeTruthy();
  expect(screen.getByText("3 Mitglieder · 2 Squads")).toBeTruthy();
  expect(screen.queryByText("0 Squads")).toBeNull();
  expect(screen.getByText("bob: gg")).toBeTruthy();

  await fireEvent.press(screen.getByLabelText("Lions: Chat öffnen"));
  expect(navigate).toHaveBeenCalledWith("TeamChat", { id: "t1", title: "TLS Chat" });
  expect(screen.queryByLabelText("Andere: Chat öffnen")).toBeNull();

  await fireEvent.press(screen.getByText("Andere"));
  expect(navigate).toHaveBeenCalledWith("TeamDetail", { id: "t2" });
});

test("ohne Teams erklärt die Seite, wie man in ein Team kommt", async () => {
  mockGet.mockImplementation((path: string) => answer(path, [], []));

  await render(<TeamsScreen navigation={navigation} route={route} />);

  await waitFor(() => expect(screen.getByText("Noch kein Team")).toBeTruthy());
  expect(screen.getByText(/Einladung oder einen Join-Code/)).toBeTruthy();
  expect(screen.queryByText("Mitglieder")).toBeNull();
});
