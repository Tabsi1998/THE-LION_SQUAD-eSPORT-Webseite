import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Disqualifikation und Austritt (#1553): zwei Knöpfe in der Teilnehmerliste, die den Umbauplan vom Server holen und
// ihn vor dem Bestätigen in Worten zeigen („3 offene Spiele werden kampflos gewertet …“).

const apiMock = { post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), message: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_error, fallback) => fallback }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { ParticipantRemovalActions } = await import("./ParticipantRemovalActions");

const TOURNAMENT = { id: "t1", status: "live", can_manage_structure: true };
const REGISTRATION = { id: "r1", status: "approved", display_name: "Max Muster" };
const PLAN = {
  id: "plan-1",
  kind: "disqualified",
  mode: "bracket",
  summary: "Disqualifikation: 2 Spiele betroffen, 1 werden kampflos gewertet. E: Lena kommt kampflos weiter. G: der Platz wird frei.",
  ops: [
    { kind: "slot_cleared", match_key: "G", text: "G: der Platz wird frei, das Spiel wartet auf den Gegner." },
    { kind: "walkover", match_key: "E", text: "E: Lena kommt kampflos weiter." },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.post.mockImplementation(async (url, body) => {
    if (body?.plan_id) return { data: { ok: true, idempotent_replay: false, applied: PLAN.ops } };
    if (url.endsWith("/reject")) return { data: { ok: true } };
    return { data: { ok: true, requires_confirmation: true, idempotent_replay: false, plan: { ...PLAN, kind: body.kind } } };
  });
});

test("ohne Struktur-Recht, bei Entwurf oder bei schon Ausgeschiedenen steht nichts da", () => {
  const { rerender } = render(<ParticipantRemovalActions tournament={{ ...TOURNAMENT, can_manage_structure: false }} registration={REGISTRATION} />);
  expect(screen.queryByTestId("admin-reg-disqualify-r1")).not.toBeInTheDocument();
  rerender(<ParticipantRemovalActions tournament={{ ...TOURNAMENT, status: "draft" }} registration={REGISTRATION} />);
  expect(screen.queryByTestId("admin-reg-disqualify-r1")).not.toBeInTheDocument();
  rerender(<ParticipantRemovalActions tournament={TOURNAMENT} registration={{ ...REGISTRATION, status: "disqualified" }} />);
  expect(screen.queryByTestId("admin-reg-disqualify-r1")).not.toBeInTheDocument();
  rerender(<ParticipantRemovalActions tournament={TOURNAMENT} registration={REGISTRATION} />);
  expect(screen.getByTestId("admin-reg-disqualify-r1")).toHaveTextContent("Disqualifizieren");
  expect(screen.getByTestId("admin-reg-withdraw-r1")).toHaveTextContent("Austritt");
});

test("Disqualifizieren holt den Plan, zeigt ihn in Worten und bestätigt mit Kennung und Grund", async () => {
  const user = userEvent.setup();
  const onDone = vi.fn();
  render(<ParticipantRemovalActions tournament={TOURNAMENT} registration={REGISTRATION} onDone={onDone} />);
  await user.click(screen.getByTestId("admin-reg-disqualify-r1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t1/registrations/r1/removal", { kind: "disqualified", reason: null }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("Max Muster disqualifizieren?");
  expect(within(dialog).getAllByTestId("admin-reg-removal-op")).toHaveLength(2);
  expect(dialog).toHaveTextContent("E: Lena kommt kampflos weiter.");
  await user.type(within(dialog).getByLabelText("Grund"), "Unsportliches Verhalten");
  await user.click(within(dialog).getByTestId("admin-reg-removal-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t1/registrations/r1/removal",
    { kind: "disqualified", plan_id: "plan-1", reason: "Unsportliches Verhalten" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(toastMock.success).toHaveBeenCalled();
  expect(onDone).toHaveBeenCalled();
});

test("Abbrechen lehnt den Vorschlag ab und schickt nichts weiter", async () => {
  const user = userEvent.setup();
  const onDone = vi.fn();
  render(<ParticipantRemovalActions tournament={TOURNAMENT} registration={REGISTRATION} onDone={onDone} />);
  await user.click(screen.getByTestId("admin-reg-withdraw-r1"));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("Austritt von Max Muster eintragen?");
  await user.click(within(dialog).getByTestId("admin-reg-removal-cancel"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t1/registrations/r1/removal/reject", { plan_id: "plan-1" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(apiMock.post).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ plan_id: "plan-1", kind: "withdrawn" }));
  expect(onDone).not.toHaveBeenCalled();
});

test("ein veralteter Vorschlag (409) wird als Hinweis gezeigt, der Dialog schließt und die Seite lädt neu", async () => {
  const user = userEvent.setup();
  const onDone = vi.fn();
  render(<ParticipantRemovalActions tournament={TOURNAMENT} registration={REGISTRATION} onDone={onDone} />);
  await user.click(screen.getByTestId("admin-reg-disqualify-r1"));
  const dialog = await screen.findByRole("dialog");
  apiMock.post.mockRejectedValueOnce({ response: { status: 409, data: { detail: "Der Vorschlag ist nicht mehr aktuell." } } });
  await user.click(within(dialog).getByTestId("admin-reg-removal-confirm"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(onDone).toHaveBeenCalled();
});

test("schon eingetragen (idempotent): kein Dialog, nur ein Hinweis", async () => {
  const user = userEvent.setup();
  apiMock.post.mockResolvedValueOnce({ data: { ok: true, idempotent_replay: true, plan: null } });
  render(<ParticipantRemovalActions tournament={TOURNAMENT} registration={REGISTRATION} />);
  await user.click(screen.getByTestId("admin-reg-withdraw-r1"));
  await waitFor(() => expect(toastMock.message).toHaveBeenCalled());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("schlimmster Fall: langer Name mit Emoji, 40 Umbauten mit sehr langen Sätzen, Umbau ohne Satz - alles bleibt lesbar und bedienbar", async () => {
  const user = userEvent.setup();
  const longName = "Aleksandra Wiśniewska-Kowalczyk 🦁 vom Team THE LION SQUAD Nachwuchs Akademie Wien Nord-Ost Süd-West";
  const longText = "Halbfinale Lauf Mario-Kart-Grand-Prix-Sonntag-Nachmittag-Rennen-der-Champions: " + Array.from({ length: 26 }, (_, index) => `Fahrerin-${String.fromCharCode(65 + index)}-mit-langem-Namen`).join(", ") + " kommen kampflos weiter.";
  const plan = {
    id: "plan-2",
    kind: "withdrawn",
    mode: "annulled",
    played: 2,
    total: 5,
    summary: "",
    ops: [
      ...Array.from({ length: 38 }, (_, index) => ({ kind: "annulled", match_key: `Spiel-${index + 1}`, text: `Spiel-${index + 1}: wird annulliert.` })),
      { kind: "walkover", match_key: "F", text: longText },
      { kind: "slot_cleared" },
    ],
  };
  apiMock.post.mockResolvedValueOnce({ data: { ok: true, requires_confirmation: true, plan } });
  render(<ParticipantRemovalActions tournament={TOURNAMENT} registration={{ ...REGISTRATION, display_name: longName }} />);
  await user.click(screen.getByTestId("admin-reg-withdraw-r1"));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent(longName);
  expect(within(dialog).getAllByTestId("admin-reg-removal-op")).toHaveLength(40);
  expect(dialog).toHaveTextContent(longText);
  expect(dialog).toHaveTextContent("Der Platz wird frei");
  // Die Liste scrollt, der Kopf und die Knöpfe bleiben erreichbar.
  expect(within(dialog).getByTestId("admin-reg-removal-ops")).toHaveClass("overflow-y-auto");
  expect(within(dialog).getByTestId("admin-reg-removal-confirm")).not.toBeDisabled();
  expect(within(dialog).getByTestId("admin-reg-removal-confirm")).toHaveTextContent("Austritt eintragen");
});
