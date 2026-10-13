import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { TeamsSection } from "./TeamsScreen";

// Teamliste: eigene Teams mit Chat-Knopf, weitere Teams darunter, Squads nur
// wenn es welche gibt (#215). Seit #1143 der Bereich „Teams“ im Tab Community.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: jest.fn() },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));

const navigate = jest.fn();
const navigation = { navigate } as never;

beforeEach(() => {
  jest.clearAllMocks();
});

function answer(path: string, mine: unknown[], all: unknown[]) {
  if (path === "/teams/my") return Promise.resolve({ data: mine });
  if (path === "/teams") return Promise.resolve({ data: all });
  return Promise.resolve({ data: [] });
}

test("eigene Teams mit Chat, weitere darunter, keine Squads bei 0", async () => {
  const lions = { id: "t1", name: "Lions", tag: "TLS", member_count: 12, squad_count: 0, description: "Rocket League am Freitag" };
  const other = { id: "t2", name: "Andere", member_count: 3, squad_count: 2 };
  mockGet.mockImplementation((path: string) => answer(path, [lions], [lions, other]));

  await render(<TeamsSection navigation={navigation} />);

  await waitFor(() => expect(screen.getByText("Meine Teams")).toBeTruthy());
  expect(screen.getByText("Weitere Teams")).toBeTruthy();
  expect(screen.getAllByText("Lions")).toHaveLength(1);
  expect(screen.getByText("12 Mitglieder")).toBeTruthy();
  expect(screen.getByText("3 Mitglieder · 2 Squads")).toBeTruthy();
  expect(screen.queryByText("0 Squads")).toBeNull();
  // Eine letzte Chat-Nachricht schickt der Server nicht (#1296) - dort steht die Beschreibung des Teams.
  expect(screen.getByText("Rocket League am Freitag")).toBeTruthy();

  await fireEvent.press(screen.getByLabelText("Lions: Chat öffnen"));
  expect(navigate).toHaveBeenCalledWith("TeamChat", { id: "t1", title: "TLS Chat" });
  expect(screen.queryByLabelText("Andere: Chat öffnen")).toBeNull();

  await fireEvent.press(screen.getByText("Andere"));
  expect(navigate).toHaveBeenCalledWith("TeamDetail", { id: "t2" });
});

test("ohne Teams erklärt die Seite, wie man in ein Team kommt", async () => {
  mockGet.mockImplementation((path: string) => answer(path, [], []));

  await render(<TeamsSection navigation={navigation} />);

  await waitFor(() => expect(screen.getByText("Noch kein Team")).toBeTruthy());
  expect(screen.getByText(/Einladung oder einen Join-Code/)).toBeTruthy();
  expect(screen.queryByText("Mitglieder")).toBeNull();
});

test("Ladefehler ist kein „Noch kein Team“: ohne Netz der Fehler mit „Nochmal versuchen“, danach die Liste (#1001, #1152)", async () => {
  const offline = Object.assign(new Error("Network Error"), { isAxiosError: true, code: "ERR_NETWORK" });
  mockGet.mockImplementation(() => Promise.reject(offline));
  await render(<TeamsSection navigation={navigation} />);
  await waitFor(() => expect(screen.getByTestId("teams-error")).toBeTruthy());
  expect(screen.queryByText("Noch kein Team")).toBeNull();
  const lions = { id: "t1", name: "Lions", tag: "TLS", member_count: 12, squad_count: 0 };
  mockGet.mockImplementation((path: string) => answer(path, [lions], [lions]));
  await fireEvent.press(screen.getByTestId("teams-error-retry"));
  await waitFor(() => expect(screen.getByText("Meine Teams")).toBeTruthy());
  expect(screen.queryByTestId("teams-error")).toBeNull();
});

test("wirklich leer: „Noch kein Team“ mit dem nächsten Schritt", async () => {
  mockGet.mockImplementation((path: string) => answer(path, [], []));
  await render(<TeamsSection navigation={navigation} />);
  await waitFor(() => expect(screen.getByTestId("teams-empty")).toBeTruthy());
  expect(screen.getByTestId("teams-empty-create")).toBeTruthy();
});

test("ein Fehler beim Nachladen nimmt die Teams nicht weg", async () => {
  const lions = { id: "t1", name: "Lions", tag: "TLS", member_count: 12, squad_count: 0 };
  mockGet.mockImplementation((path: string) => answer(path, [lions], [lions]));
  await render(<TeamsSection navigation={navigation} />);
  await waitFor(() => expect(screen.getByText("Meine Teams")).toBeTruthy());
  mockGet.mockClear();
  mockGet.mockImplementation(() => Promise.reject(Object.assign(new Error("boom"), { isAxiosError: true, response: { status: 500, data: {} } })));
  const [list] = screen.container.queryAll((node) => Boolean(node.props.refreshControl));
  await act(async () => {
    await list.props.refreshControl.props.onRefresh();
  });
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/teams"));
  expect(screen.getByText("Meine Teams")).toBeTruthy();
  expect(screen.getByText("Lions")).toBeTruthy();
});

test("Fehler beim Nachladen: die Teams bleiben, ausdrücklich als letzter Stand mit „Nochmal“ (#1001)", async () => {
  const lions = { id: "t1", name: "Lions", tag: "TLS", member_count: 12, squad_count: 0 };
  mockGet.mockImplementation((path: string) => answer(path, [lions], [lions]));
  await render(<TeamsSection navigation={navigation} />);
  await waitFor(() => expect(screen.getByText("Meine Teams")).toBeTruthy());
  expect(screen.queryByTestId("teams-partial-load")).toBeNull();
  mockGet.mockImplementation(() => Promise.reject(Object.assign(new Error("Network Error"), { isAxiosError: true })));
  const [list] = screen.container.queryAll((node) => Boolean(node.props.refreshControl));
  await act(async () => {
    await list.props.refreshControl.props.onRefresh();
  });
  await waitFor(() => expect(screen.getByTestId("teams-partial-load")).toBeTruthy());
  expect(screen.getByText("Lions")).toBeTruthy();
  mockGet.mockImplementation((path: string) => answer(path, [lions], [lions]));
  await fireEvent.press(screen.getByTestId("teams-partial-load-retry"));
  await waitFor(() => expect(screen.queryByTestId("teams-partial-load")).toBeNull());
});

test("403 ist kein „Noch kein Team“, sondern „nicht freigegeben“ (#1001)", async () => {
  mockGet.mockImplementation(() => Promise.reject(Object.assign(new Error("403"), { isAxiosError: true, response: { status: 403, data: {} } })));
  await render(<TeamsSection navigation={navigation} />);
  await waitFor(() => expect(screen.getByTestId("teams-error")).toBeTruthy());
  expect(screen.queryByTestId("teams-empty")).toBeNull();
});
