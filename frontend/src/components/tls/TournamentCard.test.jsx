import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TournamentCard, cardAction, gameLine, registrationLine } from "./TournamentCard";

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

test("offen: das Schild sagt „Anmeldung offen“ - keine zweite Zeile dazu; „Mitmachen“, Format sichtbar", () => {
  card({ ...BASE, format: "single_elim", game: { short_name: "RL" }, platform: "PC" });
  expect(screen.queryByTestId("tournament-card-registration")).toBeNull();
  expect(screen.getByTestId("phase-chip")).toHaveTextContent("Anmeldung offen");
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

// Die Zeile zur Anmeldung (#1306): ruhiger Text, nur was das Schild nicht schon sagt.
test("registrationLine: Frist als Satz, nichts doppelt zum Schild", () => {
  expect(registrationLine({ state: "open", label: "Anmeldung offen" }, "registration")).toBeNull();
  expect(registrationLine({ state: "open", label: "Anmeldung offen bis Sa, 14.12., 18:00" }, "registration")).toBe("Anmeldung bis Sa, 14.12., 18:00");
  expect(registrationLine({ state: "closed", label: "Anmeldung geschlossen" }, "checkin")).toBeNull();
  expect(registrationLine({ state: "closed", label: "Anmeldung geschlossen" }, "soon")).toBe("Anmeldung geschlossen");
  expect(registrationLine({ state: "scheduled", label: "Anmeldung öffnet am 1.12." }, "soon")).toBe("Anmeldung öffnet am 1.12.");
  expect(registrationLine({ state: "disabled", label: "Anmeldung deaktiviert" }, "soon")).toBe("Anmeldung deaktiviert");
});

test("Check-in offen: keine Zeile „Anmeldung geschlossen“ darunter; sonst ruhiger kleiner Text", () => {
  const { unmount } = card({ ...BASE, status: "check_in", public_phase: { state: "check_in", label: "Check-in offen" } });
  expect(screen.queryByTestId("tournament-card-registration")).toBeNull();
  unmount();
  card({ ...BASE, status: "scheduled", public_phase: { state: "announced", label: "Angekündigt" } });
  const line = screen.getByTestId("tournament-card-registration");
  expect(line).toHaveTextContent("Anmeldung öffnet");
  expect(line).toHaveClass("tls-type-small", "text-muted-text");
  expect(line).not.toHaveClass("tls-type-label");
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

// Liga (docs/LIGA.md, #1622): eine Staffel ist ein Turnier - die Karte kennzeichnet sie statt des Formats.
test("Liga-Staffel: „Liga · Staffel A“ statt des Formats", () => {
  card({ ...BASE, status: "live", format: "league", league_label: "Liga · Staffel A" });
  expect(screen.getByTestId("tournament-card-format")).toHaveTextContent("Liga · Staffel A");
});
