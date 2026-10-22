import { render, screen } from "@testing-library/react";
import { weekendPasteHint } from "@/lib/raceWeekend";

// Terminliste einfügen (#2007): die Hilfe nennt den Ablauf der Saison, damit klar ist, was „R1“ anlegt.

vi.mock("@/lib/api", () => ({ api: { post: vi.fn() }, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { PasteSheet } = await import("./RoundSheets");

const WEEKEND = { formats: [{ from_round: 1, sessions: [{ label: "Rennen", offset: 30 }, { label: "Qualifying", offset: 0 }] }] };
const LINEAGE = { title: "Probe Racing", kind: "racing" };

test("Ablauf in Worten: erster Lauf mit Uhrzeit, weitere mit Versatz, ab Runde X", () => {
  expect(weekendPasteHint(WEEKEND, "20:30")).toBe("Je Runde: Qualifying 20:30, Rennen +30 min");
  const two = { formats: [...WEEKEND.formats, { from_round: 5, sessions: [{ label: "Sprint", offset: 0 }, { label: "Hauptrennen", offset: 45 }] }] };
  expect(weekendPasteHint(two, null)).toBe("Je Runde: Qualifying, Rennen +30 min; ab Runde 5: Sprint, Hauptrennen +45 min");
  expect(weekendPasteHint(null, "20:30")).toBe("");
});

test("die Hilfe über dem Eingabefeld zeigt den Ablauf der Saison", () => {
  render(<PasteSheet series={{ id: "s1", default_time: "20:30", weekend: WEEKEND }} lineage={LINEAGE} version={1} onClose={() => {}} onSaved={() => {}} />);
  expect(screen.getByTestId("paste-sheet")).toHaveTextContent("Je Runde: Qualifying 20:30, Rennen +30 min.");
});

test("ohne Ablauf bleibt der bisherige Text", () => {
  render(<PasteSheet series={{ id: "s1", default_time: "20:30" }} lineage={LINEAGE} version={1} onClose={() => {}} onSaved={() => {}} />);
  expect(screen.getByTestId("paste-sheet")).not.toHaveTextContent("Je Runde:");
  expect(screen.getByTestId("paste-sheet")).toHaveTextContent("„R1 Q“ nur diesen Lauf.");
});
