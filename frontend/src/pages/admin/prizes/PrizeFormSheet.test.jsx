import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { fromViennaInput } from "@/lib/vienna";

// Gewinn von Hand (#2112): anlegen mit Turnier, Gewinner und Platz; bearbeiten nur Preis, Wert und Frist.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "") }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/tls/PersonPicker", () => ({
  PersonPicker: ({ onChange, disabled, testId }) => (
    <button type="button" disabled={disabled} data-testid={testId} onClick={() => onChange({ id: "u-7", name: "Erika" })}>Person wählen</button>
  ),
}));

const { PrizeFormSheet } = await import("./PrizeFormSheet");

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.get.mockResolvedValue({ data: [{ id: "t-1", title: "Winter-Cup" }] });
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { id: "p-new" } });
  apiMock.patch.mockReset();
  apiMock.patch.mockResolvedValue({ data: {} });
  toastMock.error.mockReset();
});

test("neu: Turnier, Gewinner, Platz, Preis und Frist bis Tagesende", async () => {
  const onSaved = vi.fn();
  render(<PrizeFormSheet onClose={() => {}} onSaved={onSaved} />);
  await screen.findByRole("option", { name: "Winter-Cup" });
  expect(screen.getByTestId("prize-form-recipient")).toBeDisabled();
  fireEvent.change(screen.getByTestId("prize-form-tournament"), { target: { value: "t-1" } });
  fireEvent.click(screen.getByTestId("prize-form-recipient"));
  fireEvent.change(screen.getByTestId("prize-form-place"), { target: { value: "7" } });
  fireEvent.change(screen.getByTestId("prize-form-label"), { target: { value: " Fair-Play-Preis " } });
  fireEvent.change(screen.getByTestId("prize-form-value"), { target: { value: "Kappe" } });
  fireEvent.change(screen.getByTestId("prize-form-deadline"), { target: { value: "2026-12-31" } });
  fireEvent.click(screen.getByTestId("prize-form-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/prizes", {
    tournament_id: "t-1", user_id: "u-7", place: 7, prize_label: "Fair-Play-Preis", prize_value: "Kappe",
    pickup_deadline: fromViennaInput("2026-12-31T23:59"),
  }));
  expect(onSaved).toHaveBeenCalled();
});

test("neu ohne Gewinner: Hinweis statt Anlegen", async () => {
  render(<PrizeFormSheet onClose={() => {}} onSaved={() => {}} />);
  await screen.findByRole("option", { name: "Winter-Cup" });
  fireEvent.change(screen.getByTestId("prize-form-tournament"), { target: { value: "t-1" } });
  fireEvent.change(screen.getByTestId("prize-form-label"), { target: { value: "Gutschein" } });
  fireEvent.click(screen.getByTestId("prize-form-save"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Bitte suchen und wählen, wer gewonnen hat."));
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("bearbeiten: nur Preis und Wert, die unveränderte Frist geht nicht mit", async () => {
  const prize = { id: "p-1", tournament_title: "Winter-Cup", recipient_label: "Anna", place: 1, prize_label: "Gutschein",
    prize_value: "20 €", status: "ready", pickup_deadline: "2026-12-01T18:30:00+00:00" };
  render(<PrizeFormSheet prize={prize} onClose={() => {}} onSaved={() => {}} />);
  expect(screen.queryByTestId("prize-form-tournament")).not.toBeInTheDocument();
  expect(screen.getByTestId("prize-form-deadline")).toHaveValue("2026-12-01");
  fireEvent.change(screen.getByTestId("prize-form-label"), { target: { value: "Gutschein Gaming-Shop" } });
  fireEvent.click(screen.getByTestId("prize-form-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/prizes/p-1", { prize_label: "Gutschein Gaming-Shop", prize_value: "20 €" }));
  expect(apiMock.get).not.toHaveBeenCalled();

  fireEvent.change(screen.getByTestId("prize-form-deadline"), { target: { value: "2027-01-15" } });
  fireEvent.click(screen.getByTestId("prize-form-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenLastCalledWith("/prizes/p-1", expect.objectContaining({
    pickup_deadline: fromViennaInput("2027-01-15T23:59"),
  })));
});
