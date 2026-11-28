import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// „Spieler zuteilen“ (#1629, P1): In einer Solo-Staffel sucht die Leitung ein Konto und teilt die Person zu. Wer nicht geht, steht mit
// dem Grund da und ist nicht wählbar; ein Fehler des Servers steht im Dialog. Erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({
  api: apiMock,
  formatRequestError: (err, fallback) => err?.response?.data?.detail || fallback,
}));
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));
const { PersonAssignDialog } = await import("./PersonAssignDialog");

const TOURNAMENT = { id: "duell-a", team_mode: "solo", format: "league", league_context: { staffel: "A" } };
const PEOPLE = {
  kind: "solo",
  max_participants: 8,
  seats_taken: 1,
  id_label: "Activision-ID",
  people: [
    { id: "u1", display_name: "Duellant Eins", username: "duellant1", problems: ["Duellant Eins steht schon in dieser Staffel."], notes: [], players: [] },
    { id: "u2", display_name: "Duellant Zwei", username: "duellant2", problems: [], notes: ["Duellant Zwei: Geburtsdatum fehlt im Profil."],
      players: [{ id: "u2", name: "Duellant Zwei", state: "missing", ok: false, text: null }] },
  ],
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  toastMock.success.mockReset();
  toastMock.warning.mockReset();
  apiMock.get.mockResolvedValue({ data: PEOPLE });
});

async function openAndSearch(text = "Duel") {
  fireEvent.click(screen.getByTestId("person-assign-open"));
  expect(screen.getByTestId("person-assign-hint")).toHaveTextContent("Mindestens zwei Zeichen");
  fireEvent.change(screen.getByTestId("person-assign-search"), { target: { value: text } });
  await waitFor(() => expect(screen.getByTestId("person-assign-person-u2")).toBeInTheDocument());
}

test("sucht nach Name, zeigt Gründe und Hinweise, teilt die gewählte Person zu", async () => {
  const onAssigned = vi.fn();
  apiMock.post.mockResolvedValue({ data: { registration: { id: "r1" }, ids_missing: ["Duellant Zwei"] } });
  render(<PersonAssignDialog tournament={TOURNAMENT} onAssigned={onAssigned} />);

  await openAndSearch();

  expect(apiMock.get).toHaveBeenCalledWith("/tournaments/duell-a/squad-candidates", { params: { q: "Duel" } });
  expect(screen.getByTestId("person-assign-seats")).toHaveTextContent("1 von 8 Plätzen belegt");
  expect(screen.getByTestId("person-assign-person-u1")).toBeDisabled();
  expect(screen.getByText("Duellant Eins steht schon in dieser Staffel.")).toBeInTheDocument();
  expect(screen.getByTestId("person-assign-notes-u2")).toHaveTextContent("Geburtsdatum fehlt");
  expect(screen.getByTestId("person-assign-ids-u2")).toHaveTextContent("keine Activision-ID");
  expect(screen.getByTestId("person-assign-confirm")).toBeDisabled();

  fireEvent.click(screen.getByTestId("person-assign-person-u2"));
  fireEvent.click(screen.getByTestId("person-assign-confirm"));

  await waitFor(() => expect(onAssigned).toHaveBeenCalled());
  expect(apiMock.post).toHaveBeenCalledWith("/tournaments/duell-a/squad-registrations", { user_id: "u2" });
  expect(toastMock.success).toHaveBeenCalledWith("Duellant Zwei ist in der Staffel.");
  expect(toastMock.warning).toHaveBeenCalled();
  expect(screen.queryByTestId("person-assign-dialog")).not.toBeInTheDocument();
});

test("ein Fehler des Servers steht im Dialog, die Suche läuft neu", async () => {
  apiMock.post.mockRejectedValue({ response: { data: { detail: "Die Staffel ist voll (8 von 8 Plätzen)." } } });
  render(<PersonAssignDialog tournament={TOURNAMENT} />);

  await openAndSearch();
  fireEvent.click(screen.getByTestId("person-assign-person-u2"));
  fireEvent.click(screen.getByTestId("person-assign-confirm"));

  expect(await screen.findByTestId("person-assign-error")).toHaveTextContent("Die Staffel ist voll (8 von 8 Plätzen).");
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId("person-assign-dialog")).toBeInTheDocument();
});

test("das eigene Konto der Leitung ist vorab gesperrt und sagt warum - kein 403 erst nach dem Klick", async () => {
  const own = "Dich selbst teilt nur der Superadmin mit Grund zu – über den Weg für Notausnahmen.";
  apiMock.get.mockResolvedValue({ data: { ...PEOPLE, people: [
    { id: "lead", display_name: "Ligaleitung", username: "leitung", problems: [own], notes: [], players: [] },
  ] } });
  render(<PersonAssignDialog tournament={TOURNAMENT} />);

  fireEvent.click(screen.getByTestId("person-assign-open"));
  fireEvent.change(screen.getByTestId("person-assign-search"), { target: { value: "Ligaleitung" } });

  expect(await screen.findByTestId("person-assign-person-lead")).toBeDisabled();
  expect(screen.getByText(own)).toBeInTheDocument();
  expect(screen.getByTestId("person-assign-confirm")).toBeDisabled();
});

test("ohne Treffer ein klarer Satz", async () => {
  apiMock.get.mockResolvedValue({ data: { ...PEOPLE, people: [] } });
  render(<PersonAssignDialog tournament={TOURNAMENT} />);

  fireEvent.click(screen.getByTestId("person-assign-open"));
  fireEvent.change(screen.getByTestId("person-assign-search"), { target: { value: "Niemand" } });

  expect(await screen.findByTestId("person-assign-empty")).toHaveTextContent("Kein Konto passt zur Suche.");
});

test("eine ältere, langsamere Suchantwort überschreibt die neuere nicht", async () => {
  let answerOld;
  apiMock.get.mockImplementation((_url, { params }) => (params.q === "Duel"
    ? new Promise((resolve) => { answerOld = () => resolve({ data: PEOPLE }); })
    : Promise.resolve({ data: { ...PEOPLE, people: [{ id: "u9", display_name: "Duellant Neun", username: "d9", problems: [], notes: [], players: [] }] } })));
  render(<PersonAssignDialog tournament={TOURNAMENT} />);

  fireEvent.click(screen.getByTestId("person-assign-open"));
  fireEvent.change(screen.getByTestId("person-assign-search"), { target: { value: "Duel" } });
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByTestId("person-assign-search"), { target: { value: "Duellant N" } });
  expect(await screen.findByTestId("person-assign-person-u9")).toBeInTheDocument();
  answerOld();
  await new Promise((resolve) => { setTimeout(resolve, 20); });

  expect(screen.getByTestId("person-assign-person-u9")).toBeInTheDocument();
  expect(screen.queryByTestId("person-assign-person-u2")).toBeNull();
});

test("eine gesperrte Zeile ist ruhig, aber ohne zusätzliche Deckkraft lesbar", async () => {
  render(<PersonAssignDialog tournament={TOURNAMENT} />);
  await openAndSearch();
  const row = screen.getByTestId("person-assign-person-u1").closest("label");
  expect(row.className).not.toMatch(/opacity-/);
  expect(row.className).toMatch(/text-quiet/);
});
