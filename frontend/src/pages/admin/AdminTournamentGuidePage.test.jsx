import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GUIDE_FORMATS, GUIDE_GAME_TYPES, GUIDE_STEPS } from "@/lib/tournamentGuide";

// Turnier-Leitfaden (#228): drei Teile, jede Empfehlung nennt ihre Felder, jede Turnierform ein
// Format, das es hier gibt.

vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));

const AdminTournamentGuidePage = (await import("./AdminTournamentGuidePage")).default;

test("die drei Teile stehen auf der Seite", () => {
  render(<MemoryRouter><AdminTournamentGuidePage /></MemoryRouter>);
  expect(screen.getByTestId("guide-steps").querySelectorAll("li")).toHaveLength(GUIDE_STEPS.length);
  expect(screen.getByTestId("guide-game-types").querySelectorAll("tbody tr")).toHaveLength(GUIDE_GAME_TYPES.length);
  expect(screen.getByTestId("guide-formats").querySelectorAll("[data-testid^='guide-format-']")).toHaveLength(GUIDE_FORMATS.length);
  expect(screen.getByTestId("guide-step-check-in")).toHaveTextContent("30 bis 60 Minuten");
  expect(screen.getByTestId("guide-game-arcade-sport")).toHaveTextContent("3v3");
  expect(screen.getByTestId("guide-new-tournament")).toHaveAttribute("href", "/admin/tournaments/new");
});

test("jede Empfehlung nennt Felder, jede Turnierform ein bekanntes Format", () => {
  const formatKeys = new Set(GUIDE_FORMATS.map((format) => format.key));
  for (const step of GUIDE_STEPS) expect(step.fields.length, step.key).toBeGreaterThan(0);
  for (const kind of GUIDE_GAME_TYPES) expect(formatKeys.has(kind.format), `${kind.key} → ${kind.format}`).toBe(true);
});
