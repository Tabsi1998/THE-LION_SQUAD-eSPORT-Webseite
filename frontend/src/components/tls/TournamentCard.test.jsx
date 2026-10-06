import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TournamentCard, cardAction, gameLine } from "./TournamentCard";

// Turniere I (#833): kein leeres Format-Kästchen, kein loser Punkt, nach dem Ende der Stand statt
// „Anmeldung geschlossen“, ein Knopf im Fuß.

const BASE = { id: "t1", slug: "cup", title: "Sommer-Cup", status: "registration_open", max_participants: 16, participant_count: 4, banner_url: "/x.webp" };

function card(tournament) {
  return render(<MemoryRouter><TournamentCard tournament={tournament} /></MemoryRouter>);
}

test("Knopf und Spielzeile in Worten", () => {
  expect(cardAction({ status: "results_published" }, { canRegister: false })).toBe("Ergebnisse");
  expect(cardAction({ status: "registration_open" }, { canRegister: true })).toBe("Mitmachen");
  expect(cardAction({ status: "live" }, { canRegister: false })).toBe("Ansehen");
  expect(gameLine({ platform: "Nintendo Switch" })).toEqual(["Nintendo Switch"]);
  expect(gameLine({ game: { short_name: "MK8DX" }, platform: " " })).toEqual(["MK8DX"]);
  expect(gameLine({})).toEqual([]);
});

test("offen: Anmeldung, „Mitmachen“, Format sichtbar", () => {
  card({ ...BASE, format: "single_elim", game: { short_name: "RL" }, platform: "PC" });
  expect(screen.getByTestId("tournament-card-registration")).toHaveTextContent("Anmeldung offen");
  expect(screen.getByTestId("tournament-card-action")).toHaveTextContent("Mitmachen");
  expect(screen.getByTestId("tournament-card-format")).not.toHaveTextContent("—");
  expect(screen.getByTestId("tournament-card-game")).toHaveTextContent("RL·PC");
});

test("beendet ohne Format und ohne Spiel-Kürzel: kein Strich-Kästchen, kein loser Punkt, keine Anmeldezeile", () => {
  card({ ...BASE, status: "results_published", format: null, platform: "Nintendo Switch" });
  expect(screen.queryByTestId("tournament-card-format")).toBeNull();
  expect(screen.getByTestId("tournament-card-game").textContent).toBe("Nintendo Switch");
  expect(screen.queryByTestId("tournament-card-registration")).toBeNull();
  expect(screen.getByTestId("tournament-card-action")).toHaveTextContent("Ergebnisse");
  expect(screen.queryByText("Turnierdetails")).toBeNull();
});

// Laufender Rahmen (#1076): nur die Karte, die gerade live ist, trägt ihn.
test("live: die Karte trägt den laufenden Rahmen, sonst nicht", () => {
  const { unmount } = card({ ...BASE, status: "live", public_phase: { state: "live", label: "Läuft" } });
  expect(screen.getByTestId("tournament-card-cup")).toHaveClass("tls-card", "tls-live-frame");
  expect(screen.getByTestId("tournament-card-cup")).toHaveAttribute("data-live", "1");
  unmount();
  card({ ...BASE, public_phase: { state: "registration_open", label: "Anmeldung offen" } });
  expect(screen.getByTestId("tournament-card-cup")).toHaveClass("tls-card");
  expect(screen.getByTestId("tournament-card-cup")).not.toHaveClass("tls-live-frame");
  expect(screen.getByTestId("tournament-card-cup")).not.toHaveAttribute("data-live");
});
