import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Gast mit Konto verknüpfen (#1585): Konto über die Personensuche wählen, Vorschau „X Zeiten von Gast … gehen an Konto …“,
// Hinweis bei überschrittener Versuchsgrenze, nach der Veröffentlichung mit Begründung.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
const promptMock = vi.fn();
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback, resolveMediaUrl: (v) => v || "" }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => vi.fn(), usePrompt: () => promptMock }));
vi.mock("sonner", () => ({ toast: toastMock }));
const pickerProps = [];
vi.mock("@/components/tls/PersonPicker", () => ({
  PersonPicker: ({ value, onChange, testId, ...rest }) => (pickerProps.push(rest), value
    ? <div data-testid={`${testId}-selected`}>{value.name}</div>
    : <button type="button" data-testid={`${testId}-pick`} onClick={() => onChange({ id: "u-9", name: "Anna Konto" })}>wählen</button>),
}));

const { FastLapGuestLinkDialog } = await import("./FastLapGuestLinkDialog");

const GUEST = { id: "g-1", name: "Anna" };

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  promptMock.mockReset();
  toastMock.warning.mockReset();
  apiMock.get.mockResolvedValue({ data: { laps: 3, account_laps: 2, guest_name: "Anna", account_name: "Anna Konto", over_limit: [{ track_id: "t-1", track_name: "Monza", attempts: 5, max_attempts: 3 }], needs_reason: false } });
  apiMock.post.mockResolvedValue({ data: { ok: true, laps_moved: 3, over_limit: [] } });
});

test("Vorschau mit Zahl, Namen und Hinweis zur Versuchsgrenze, dann verknüpfen", async () => {
  const onLinked = vi.fn();
  render(<FastLapGuestLinkDialog challengeId="c-1" guest={GUEST} onClose={vi.fn()} onLinked={onLinked} />);
  expect(screen.getByTestId("fl-link-confirm")).toBeDisabled();
  // Die Personensuche braucht die Challenge - ohne sie sagt der Server „Dafür fehlt dir das Recht“ (Abnahme).
  expect(pickerProps.at(-1)).toMatchObject({ purpose: "fastlap", contextId: "c-1" });
  fireEvent.click(screen.getByTestId("fl-link-person-pick"));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/f1/guests/g-1/link-preview", { params: { user_id: "u-9" } }));
  expect(await screen.findByTestId("fl-link-preview")).toHaveTextContent("3 Zeiten von Gast „Anna“ gehen an Konto „Anna Konto“");
  expect(screen.getByTestId("fl-link-preview")).toHaveTextContent("Monza: 5 von 3 Versuchen");
  fireEvent.click(screen.getByTestId("fl-link-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/f1/guests/g-1/link", { user_id: "u-9" }));
  expect(onLinked).toHaveBeenCalled();
  expect(promptMock).not.toHaveBeenCalled();
});

test("nach der Veröffentlichung nur mit Begründung - im Dialog selbst, ohne zweites Fenster darüber (Abnahme)", async () => {
  apiMock.get.mockResolvedValue({ data: { laps: 1, account_laps: 0, guest_name: "Anna", account_name: "Anna Konto", over_limit: [], needs_reason: true } });
  render(<FastLapGuestLinkDialog challengeId="c-1" guest={GUEST} onClose={vi.fn()} onLinked={vi.fn()} />);
  fireEvent.click(screen.getByTestId("fl-link-person-pick"));
  await screen.findByTestId("fl-link-preview");
  expect(screen.getByTestId("fl-link-preview")).toHaveTextContent("1 Zeit von Gast");
  const confirm = screen.getByTestId("fl-link-confirm");
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByTestId("fl-link-reason"), { target: { value: "zu kurz" } });
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByTestId("fl-link-reason"), { target: { value: "Gast hat jetzt ein Konto" } });
  expect(confirm).not.toBeDisabled();
  fireEvent.click(confirm);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/f1/guests/g-1/link", { user_id: "u-9", change_reason: "Gast hat jetzt ein Konto" }));
  expect(promptMock).not.toHaveBeenCalled();
});
