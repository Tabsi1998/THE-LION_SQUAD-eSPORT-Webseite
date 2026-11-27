import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StandingsTable } from "@/components/tls/tournament/StandingsTable";
import { LeagueCurrent } from "./LeagueCurrent";

// Gast-Plakette (#1665) auf den Flächen: unter dem Namen, nur wenn der Server `guest_badge` schickt. Erfundene Namen.
const GUEST = { label: "Gast", org: "Höhere Technische Bundeslehranstalt für Probeberufe am Probeberg Nord" };

test("Tabelle: die Plakette steht unter dem Namen des Gastteams, andere Zeilen bleiben wie vorher", () => {
  render(<StandingsTable rows={[
    { registration_id: "r1", rank: 1, display_name: "Probe Löwen · Rudel A", points: 3, guest_badge: GUEST },
    { registration_id: "r2", rank: 2, display_name: "Probe Falken · Horst", points: 0 },
  ]} />);
  expect(screen.getByTestId("standing-guest-r1")).toHaveTextContent(GUEST.org);
  expect(screen.queryByTestId("standing-guest-r2")).toBeNull();
  // Der Name selbst bleibt unverändert im title.
  expect(screen.getByText("Probe Löwen · Rudel A")).toHaveAttribute("title", "Probe Löwen · Rudel A");
});

test("Aktuelle Ligen (Profil, Teamseite): die Plakette am Co-Team", () => {
  render(<MemoryRouter><LeagueCurrent rows={[{ registration_id: "r1", link: "/liga/x", squad_name: "Rudel A", division_label: "Liga 1", guest_badge: { label: "Gast", org: null } }]} /></MemoryRouter>);
  expect(screen.getByTestId("league-current-r1-guest")).toHaveTextContent(/^GastGastteam$/);
});
