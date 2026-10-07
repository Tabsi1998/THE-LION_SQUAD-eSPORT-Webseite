import { render, screen } from "@testing-library/react";

// Die Mitgliedskarte als Bild (#1335): Muster mit „Dein Name“ und Nummer, echte Daten mit Art und „gültig bis“; offline
// statt des Prüfcodes „Prüfcode braucht Netz“ (#1256). Ohne Beobachter (Test) und mit „Bewegung reduzieren“ kein Lichtlauf.

const { MemberCardArt, cardNumberLine, validLine } = await import("./MemberCardArt");

test("Muster und echte Karte", () => {
  const { rerender } = render(<MemberCardArt name="Dein Name" number="0042" since={2026} tilt />);
  expect(screen.getByTestId("member-card-art")).toHaveTextContent("The Lion SquadMitgliedDein NameNr. 0042 · seit 2026");
  expect(screen.getByTestId("member-card-art")).toHaveClass("tls-member-card", "tls-member-card--tilt");
  expect(screen.getByTestId("member-card-art")).toHaveAttribute("data-shine", "0");
  rerender(<MemberCardArt name="LunaByte" number="TLS-031" since="2024-03-01" typeLabel="Ordentliches Mitglied" validUntil="2026-12-31" clubName="THE LION SQUAD" />);
  expect(screen.getByTestId("member-card-art")).toHaveTextContent("LunaByteNr. TLS-031 · seit 2024Ordentliches Mitglied · gültig bis 31.12.2026");
  expect(screen.queryByTestId("member-card-art-offline")).toBeNull();
});

test("offline: statt des Prüfcodes der Hinweis", () => {
  render(<MemberCardArt name="LunaByte" number="TLS-031" offline />);
  expect(screen.getByTestId("member-card-art-offline")).toHaveTextContent("Prüfcode braucht Netz");
});

test("Hilfsfunktionen", () => {
  expect(cardNumberLine("TLS-031", "2024-03-01")).toBe("Nr. TLS-031 · seit 2024");
  expect(cardNumberLine("", "")).toBe("");
  expect(validLine("2026-12-31")).toBe("gültig bis 31.12.2026");
  expect(validLine(null)).toBe("");
});
