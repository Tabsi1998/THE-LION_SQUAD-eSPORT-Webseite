import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RegistrationSheet } from "./RegistrationSheet";

// Bestätigungs-Blatt bei vollem Cup (#1941, F4): Kopfzeile und Knopf sagen „Warteliste“ - wie die schlanke Vor-Ort-
// Ansicht davor („Alle Plätze belegt – Warteliste“). Nur erfundene Daten.

const USER = { id: "u1", username: "probe", display_name: "Probe Spieler" };
const CUP = { id: "t1", title: "Probe-Cup", team_mode: "solo", max_participants: 16, game: { slug: "probe", name: "Probespiel", player_id_fields: [] } };

function renderSheet(tournament) {
  return render(<MemoryRouter><RegistrationSheet tournament={{ ...CUP, ...tournament }} user={USER} onClose={() => {}} onSubmit={() => {}} /></MemoryRouter>);
}

test("voller Cup: „Der Cup ist voll – du kommst auf die Warteliste (Platz N)“ und „Auf die Warteliste“", () => {
  renderSheet({ participant_count: 16, waitlist_count: 2 });
  expect(screen.getByRole("dialog")).toHaveTextContent("Der Cup ist voll – du kommst auf die Warteliste (Platz 3).");
  expect(screen.getByTestId("tournament-register-submit")).toHaveTextContent(/^Auf die Warteliste$/);
});

test("mit Startgeld: auch auf der Warteliste ohne Betrag am Knopf - bezahlt wird erst mit dem Nachrücken", () => {
  const offer = { enabled: true, currency: "EUR", positions: [{ key: "fee", label: "Startgeld", amount_cents: 500, basis: "per_person", optional: false }] };
  renderSheet({ participant_count: 16, waitlist_count: 0, offer });
  expect(screen.getByTestId("tournament-register-submit")).toHaveTextContent(/^Auf die Warteliste$/);
});

test("freie Plätze: wie bisher „Du meldest dich als … an.“ und „Verbindlich anmelden“", () => {
  renderSheet({ participant_count: 15, waitlist_count: 0 });
  expect(screen.getByRole("dialog")).toHaveTextContent("Du meldest dich als Probe Spieler an.");
  expect(screen.queryByText(/Warteliste/)).toBeNull();
  expect(screen.getByTestId("tournament-register-submit")).toHaveTextContent("Verbindlich anmelden");
});
