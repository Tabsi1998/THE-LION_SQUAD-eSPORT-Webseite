import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Die eigene Turnieranmeldung ändern (#2113, L-A2): der Server sagt, ob es geht; in der Liga sind Name und IDs gesperrt.
// Erfundene Daten.

const apiMock = { get: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (error, fallback) => error?.response?.data?.detail || fallback }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { MyRegistrationEdit } = await import("./MyRegistrationEdit");

const TOURNAMENT = { id: "t1", title: "Herbst-Cup", status: "registration_open" };
const REGISTRATION = { id: "r1", status: "approved" };
const DETAILS = {
  id: "r1", status: "approved", is_team: false, ingame_name: "AlterName", discord: "alt#1", player_ids: { riot: "Alt#EUW" },
  fields: [{ key: "riot", label: "Riot-ID", required: true, help_text: "Name#TAG" }],
  can_edit: true, reason: null, ids_locked: false, ids_locked_reason: null,
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.patch.mockReset();
});

test("geht es nicht mehr, gibt es keinen Link", async () => {
  apiMock.get.mockResolvedValue({ data: { ...DETAILS, can_edit: false, reason: "Du bist schon eingecheckt." } });
  const { container } = render(<MyRegistrationEdit tournament={TOURNAMENT} registration={REGISTRATION} />);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});

test("ändern: Name, ID und Discord gehen an den Server, danach lädt die Seite neu", async () => {
  apiMock.get.mockResolvedValue({ data: DETAILS });
  apiMock.patch.mockResolvedValue({ data: DETAILS });
  const onSaved = vi.fn();
  render(<MyRegistrationEdit tournament={TOURNAMENT} registration={REGISTRATION} onSaved={onSaved} />);
  fireEvent.click(await screen.findByTestId("my-registration-edit"));
  expect(screen.getByTestId("my-registration-name")).toHaveValue("AlterName");
  fireEvent.change(screen.getByTestId("my-registration-id-riot"), { target: { value: " Neu#EUW " } });
  fireEvent.change(screen.getByTestId("my-registration-discord"), { target: { value: "neu#2" } });
  fireEvent.submit(screen.getByTestId("my-registration-name").closest("form"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/tournaments/t1/my-registration", {
    discord: "neu#2", ingame_name: "AlterName", player_ids: { riot: "Neu#EUW" },
  }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId("my-registration-sheet")).toBeNull();
});

test("Liga-Staffel: Name und IDs gesperrt mit Hinweis, nur Discord geht mit", async () => {
  apiMock.get.mockResolvedValue({ data: { ...DETAILS, ids_locked: true, ids_locked_reason: "In der Liga gilt die Spiel-ID für die ganze Season." } });
  apiMock.patch.mockResolvedValue({ data: DETAILS });
  render(<MyRegistrationEdit tournament={TOURNAMENT} registration={REGISTRATION} />);
  fireEvent.click(await screen.findByTestId("my-registration-edit"));
  expect(screen.getByTestId("my-registration-locked")).toHaveTextContent("ganze Season");
  expect(screen.getByTestId("my-registration-name")).toBeDisabled();
  expect(screen.getByTestId("my-registration-id-riot")).toBeDisabled();
  fireEvent.submit(screen.getByTestId("my-registration-name").closest("form"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/tournaments/t1/my-registration", { discord: "alt#1" }));
});

test("ein Fehler bleibt im Blatt stehen", async () => {
  apiMock.get.mockResolvedValue({ data: DETAILS });
  apiMock.patch.mockRejectedValue(Object.assign(new Error("409"), { response: { status: 409, data: { detail: "Der Check-in ist vorbei." } } }));
  render(<MyRegistrationEdit tournament={TOURNAMENT} registration={REGISTRATION} />);
  fireEvent.click(await screen.findByTestId("my-registration-edit"));
  fireEvent.submit(screen.getByTestId("my-registration-name").closest("form"));
  expect(await screen.findByText("Der Check-in ist vorbei.")).toBeInTheDocument();
  expect(screen.getByTestId("my-registration-sheet")).toBeInTheDocument();
});
