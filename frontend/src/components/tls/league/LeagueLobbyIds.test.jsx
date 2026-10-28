import { render, screen } from "@testing-library/react";
import { LeagueLobbyIds } from "./LeagueGamesView";

// Spiel-IDs für die Lobby (#2108): je Seite die ID, die in der Season gilt; wem sie fehlt, steht mit Grund da. Der
// Server schickt `lobby_ids` nur an Beteiligte und Turnierleitung - ohne sie zeigt die Matchseite nichts. Erfundene IDs.

const LEAGUE = {
  id_label: "Activision-ID",
  lobby_ids: [
    { registration_id: "r1", name: "Loewen · Rudel A", players: [{ id: "u1", name: "Mila", text: "Testloewe#1234567", ok: true }] },
    { registration_id: "r2", name: "Falken · Horst", players: [{ id: "u2", name: "Falke1", text: null, ok: false, reason: "Activision-ID fehlt im Profil." }] },
  ],
};

test("beide Seiten mit ihren IDs, fehlende mit Grund", () => {
  render(<LeagueLobbyIds league={LEAGUE} />);

  expect(screen.getByText("Activision-ID für die Lobby")).toBeInTheDocument();
  expect(screen.getByTestId("league-lobby-ids-r1")).toHaveTextContent("MilaTestloewe#1234567");
  expect(screen.getByTestId("league-lobby-ids-r2")).toHaveTextContent("Falke1Activision-ID fehlt im Profil.");
});

test("ohne IDs vom Server (Gäste, Spiele ohne Pflicht-ID) kein Block", () => {
  const { container } = render(<LeagueLobbyIds league={{ lobby_ids: [] }} />);
  expect(container).toBeEmptyDOMElement();
});
