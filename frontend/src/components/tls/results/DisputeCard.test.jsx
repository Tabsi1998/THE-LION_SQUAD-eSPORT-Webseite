import { act, fireEvent, render, screen } from "@testing-library/react";

// Problem melden (#1158): Grund antippen, kurz beschreiben, auf Wunsch ein Foto - und die Karte der Turnierleitung, die
// mit einem Tipp entscheidet. Namen sind erfunden.

const apiMock = { post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API_BASE: "", formatApiError: (value) => value }));

const { ProblemReportForm } = await import("./ProblemReportForm");
const { DisputeCard } = await import("./DisputeCard");

const ITEM = {
  id: "m1", label: "Halbfinale B", stage_name: "K.-o.", has_result: true, result_summary: "Frostbiss gewinnt 2:1.", can_enter: true,
  dispute: {
    by: "TurboTina", at: "2026-10-10T13:12:00+00:00", category: "wrong_result", category_label: "Falsches Ergebnis",
    text: "Es stand 2:1 für mich, nicht 1:2.", photo: { id: "p1", url: "/api/matches/m1/proof-photos/p1" },
    result_by: "Ergebnisdienst", result_at: "2026-10-10T13:06:00+00:00", reports: [],
  },
};

test("Problem melden: Grund, Text und Foto gehen zusammen an den Server", async () => {
  const sent = vi.fn(async () => true);
  render(<ProblemReportForm matchId="m1" onSubmit={sent} />);
  fireEvent.click(screen.getByTestId("match-dispute-btn"));
  expect(screen.getByTestId("match-dispute-error")).toHaveTextContent("Bitte antippen, was nicht stimmt.");
  fireEvent.click(screen.getByTestId("match-dispute-reason-technical"));
  fireEvent.click(screen.getByTestId("match-dispute-btn"));
  expect(screen.getByTestId("match-dispute-error")).toHaveTextContent("Bitte kurz beschreiben, was nicht stimmt.");
  fireEvent.change(screen.getByTestId("match-dispute-input"), { target: { value: "Controller ausgefallen" } });
  await act(async () => { fireEvent.click(screen.getByTestId("match-dispute-btn")); });
  expect(sent).toHaveBeenCalledWith({ reason: "Controller ausgefallen", category: "technical", photo_id: null });
});

test("„Stimmt nicht“ öffnet das Formular mit „Falsches Ergebnis“", () => {
  render(<ProblemReportForm matchId="m1" initialCategory="wrong_result" onSubmit={vi.fn()} />);
  expect(screen.getByTestId("match-dispute-reason-wrong_result")).toHaveAttribute("aria-pressed", "true");
});

test("die Karte der Turnierleitung: Meldung, Foto, Ergebnis - entscheiden mit einem Tipp", () => {
  const keep = vi.fn();
  const change = vi.fn();
  render(<DisputeCard item={ITEM} onKeep={keep} onChange={change} />);
  const card = screen.getByTestId("lead-dispute-m1");
  expect(card).toHaveTextContent("Gemeldet von TurboTina");
  expect(card).toHaveTextContent("Falsches Ergebnis");
  expect(card).toHaveTextContent("„Es stand 2:1 für mich, nicht 1:2.“");
  expect(screen.getByTestId("lead-dispute-result-m1")).toHaveTextContent("Eingetragen: Frostbiss gewinnt 2:1. · von Ergebnisdienst");
  expect(screen.getByAltText("Foto zur Meldung")).toHaveAttribute("src", "/api/matches/m1/proof-photos/p1?w=400");
  fireEvent.change(screen.getByTestId("lead-dispute-note-m1"), { target: { value: "Foto eindeutig" } });
  fireEvent.click(screen.getByTestId("lead-dispute-keep-m1"));
  expect(keep).toHaveBeenCalledWith("Foto eindeutig");
  fireEvent.click(screen.getByTestId("lead-dispute-change-m1"));
  expect(change).toHaveBeenCalled();
});

test("ohne Ergebnis heißt es „Weiter wie bisher“ und „Ergebnis eintragen“", () => {
  render(<DisputeCard item={{ ...ITEM, has_result: false, result_summary: null }} onKeep={vi.fn()} onChange={vi.fn()} />);
  expect(screen.getByTestId("lead-dispute-keep-m1")).toHaveTextContent("Weiter wie bisher");
  expect(screen.getByTestId("lead-dispute-change-m1")).toHaveTextContent("Ergebnis eintragen");
});
