import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Teamseite (#2110, L-D13): Co-Teams mit Captain und Vertreter für Mitglieder, „Co-Teams verwalten“ für Teamleitung
// und Rollen-Inhaber. Erfundene Namen.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
const { TeamSquads } = await import("./TeamSquads");

const MEMBERS = [{ id: "u1", display_name: "Mila" }, { id: "u2", display_name: "Tom" }, { id: "u3", display_name: "Ida" }];
const SQUADS = [
  { id: "s-a", name: "Rudel A", status: "active", captain_id: "u1", vice_captain_id: "u2", members: MEMBERS },
  { id: "s-b", name: "Rudel B", status: "active", members: MEMBERS.slice(2) },
  { id: "s-x", name: "Alt", status: "archived", members: [] },
];

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.get.mockResolvedValue({ data: SQUADS });
});

function renderSquads(props) {
  return render(<MemoryRouter><TeamSquads team={{ id: "t1" }} {...props} /></MemoryRouter>);
}

test("Mitglieder sehen die Co-Teams mit Rollen, der Captain dazu „Co-Teams verwalten“", async () => {
  renderSquads({ userId: "u1", enabled: true });
  expect(await screen.findByTestId("team-squad-roles-line-s-a")).toHaveTextContent("Captain: Mila · Vertreter: Tom");
  expect(screen.getByTestId("team-squad-roles-line-s-b")).toHaveTextContent("Ohne Captain");
  expect(screen.getByTestId("team-squad-s-a")).toHaveTextContent("Du: Captain");
  expect(screen.queryByTestId("team-squad-s-x")).toBeNull();
  expect(screen.getByTestId("team-squads-manage")).toHaveAttribute("href", "/teams?team=t1");
  expect(apiMock.get).toHaveBeenCalledWith("/teams/t1/squads");
});

test("ein Mitglied ohne Rolle sieht die Co-Teams, aber keinen Verwaltungs-Link", async () => {
  renderSquads({ userId: "u3", enabled: true });
  await screen.findByTestId("team-squad-s-a");
  expect(screen.queryByTestId("team-squads-manage")).toBeNull();
});

test("Außenstehende: kein Abruf, nichts zu sehen", async () => {
  renderSquads({ userId: "fremd", enabled: false });
  await waitFor(() => expect(apiMock.get).not.toHaveBeenCalled());
  expect(screen.queryByTestId("team-squads")).toBeNull();
});
