import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Plattform je Season (#2270): Feld wählen, Plattformen anhaken, Crossplay und Eingabegerät, Liga N im Überblick, Fehler und Hinweise.

const apiMock = { get: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { SeasonPlatformPanel } = await import("./SeasonPlatformPanel");
const { DivisionPlatformFields } = await import("./DivisionPlatformFields");

const FIELD = { key: "platform", label: "Plattform", options: ["PC", "PlayStation", "Xbox"], retired: [], required: false };
const EMPTY = { platform_field: null, allowed_platforms: [], crossplay: null, input_device: null };

function view(settings = EMPTY, extra = {}) {
  return { settings, fields: [FIELD], field_missing: false, input_devices: [], game: { id: "g1", name: "Probe Shooter" }, divisions: [], ...extra };
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.put.mockReset();
  toastMock.success.mockReset();
});

test("Feld wählen, PC anhaken, Crossplay aus und Controller - gespeichert wird in der Reihenfolge des Felds", async () => {
  apiMock.get.mockResolvedValue({ data: view() });
  const saved = { platform_field: "platform", allowed_platforms: ["PC"], crossplay: false, input_device: "controller" };
  apiMock.put.mockResolvedValue({ data: view(saved) });
  render(<SeasonPlatformPanel seasonId="s1" />);

  expect(await screen.findByTestId("season-platform-field")).toHaveValue("");
  expect(screen.queryByTestId("season-platform-allowed")).toBeNull();
  fireEvent.change(screen.getByTestId("season-platform-field"), { target: { value: "platform" } });
  expect(screen.getByTestId("season-platform-allowed-hint")).toHaveTextContent("Nichts angehakt: alle Plattformen erlaubt");
  expect(screen.getByTestId("season-platform-allowed-hint")).toHaveTextContent("freiwillig");
  fireEvent.click(screen.getByTestId("season-platform-allowed-PC"));
  expect(screen.getByTestId("season-platform-allowed-hint")).toHaveTextContent("nicht spielberechtigt");
  fireEvent.change(screen.getByTestId("season-platform-crossplay"), { target: { value: "off" } });
  fireEvent.change(screen.getByTestId("season-platform-input"), { target: { value: "controller" } });
  fireEvent.click(screen.getByTestId("season-platform-save"));

  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s1/platform", saved));
  expect(toastMock.success).toHaveBeenCalled();
});

test("alle angehakt heißt: jede Plattform, aber Pflicht", async () => {
  apiMock.get.mockResolvedValue({ data: view({ ...EMPTY, platform_field: "platform", allowed_platforms: ["PC", "PlayStation", "Xbox"] }) });
  render(<SeasonPlatformPanel seasonId="s1" />);

  expect(await screen.findByTestId("season-platform-allowed-hint")).toHaveTextContent("Alle angehakt: jede Plattform erlaubt, die Angabe im Profil ist aber Pflicht.");
});

test("ein anderes Feld leert die Auswahl, ein Fehler des Servers steht beim Kasten", async () => {
  const other = { key: "region", label: "Region", options: ["EU", "NA"], retired: [], required: true };
  apiMock.get.mockResolvedValue({ data: view({ ...EMPTY, platform_field: "platform", allowed_platforms: ["PC"] }, { fields: [FIELD, other] }) });
  apiMock.put.mockRejectedValue({ response: { data: { detail: "Liga 2 legt Plattformen fest, die das neue Feld nicht kennt." } } });
  render(<SeasonPlatformPanel seasonId="s1" />);

  fireEvent.change(await screen.findByTestId("season-platform-field"), { target: { value: "region" } });
  expect(screen.getByTestId("season-platform-allowed-EU")).not.toBeChecked();
  expect(screen.getByTestId("season-platform-allowed-hint")).toHaveTextContent("Pflicht: Die Plattform wird mit der Spiel-ID");
  fireEvent.click(screen.getByTestId("season-platform-save"));

  expect(await screen.findByTestId("season-platform-error")).toHaveTextContent("Liga 2 legt Plattformen fest");
  expect(apiMock.put.mock.calls[0][1].allowed_platforms).toEqual([]);
});

test("ohne Feld mit Auswahl steht der Weg zur Spielverwaltung da, ein verschwundenes Feld warnt", async () => {
  apiMock.get.mockResolvedValue({ data: view({ ...EMPTY, platform_field: "alt" }, { fields: [], field_missing: true }) });
  render(<SeasonPlatformPanel seasonId="s1" />);

  expect(await screen.findByTestId("season-platform-no-field")).toHaveTextContent("Probe Shooter hat kein Spiel-ID-Feld mit Auswahl");
  expect(screen.getByTestId("season-platform-field-missing")).toHaveTextContent("prüft diese Season keine Plattform");
  expect(screen.queryByTestId("season-platform-field")).toBeNull();
  expect(screen.getByTestId("season-platform-crossplay")).toBeInTheDocument();
});

test("je Liga N steht, was dort gilt und ob sie abweicht", async () => {
  apiMock.get.mockResolvedValue({ data: view({ ...EMPTY, platform_field: "platform", allowed_platforms: ["PC"] }, { divisions: [
    { id: "d1", label: "Liga 1", overrides: {}, effective: { allowed: ["PC"], crossplay: null, input_device: null } },
    { id: "d2", label: "Liga 2 · Offen", overrides: { allowed_platforms: [] }, effective: { allowed: [], crossplay: true, input_device: "both" } },
  ] }) });
  render(<SeasonPlatformPanel seasonId="s1" />);

  expect(await screen.findByTestId("season-platform-division-d1")).toHaveTextContent("Liga 1nur PCwie Season");
  expect(screen.getByTestId("season-platform-division-d2")).toHaveTextContent("alle Plattformen · Crossplay an · Controller oder Maus und Tastatur");
  expect(screen.getByTestId("season-platform-division-d2")).toHaveTextContent("weicht ab");
});

test("ohne Recht zum Speichern nur lesen", async () => {
  apiMock.get.mockResolvedValue({ data: view({ ...EMPTY, platform_field: "platform", allowed_platforms: ["PC"] }) });
  render(<SeasonPlatformPanel seasonId="s1" canEdit={false} />);

  expect(await screen.findByTestId("season-platform-allowed-PC")).toBeDisabled();
  expect(screen.queryByTestId("season-platform-save")).toBeNull();
});

test("Liga-N-Blatt: eigene Plattformen erst mit Haken, Crossplay und Eingabegerät mit „wie Season“", async () => {
  apiMock.get.mockResolvedValue({ data: view({ platform_field: "platform", allowed_platforms: ["PC"], crossplay: false, input_device: null }) });
  const set = vi.fn();
  const form = { platform_own: false, allowed_platforms: [], crossplay: "", input_device: "" };
  const { rerender } = render(<DivisionPlatformFields form={form} set={set} seasonId="s1" />);

  expect(await screen.findByTestId("division-platform-season")).toHaveTextContent("Season: nur PC · Crossplay aus");
  expect(screen.getByTestId("override-crossplay")).toHaveTextContent("wie Season (aus)");
  expect(screen.getByTestId("override-input")).toHaveTextContent("wie Season (keine Angabe)");
  expect(screen.queryByTestId("override-platforms")).toBeNull();
  fireEvent.click(screen.getByTestId("override-platform-own"));
  expect(set).toHaveBeenCalledWith("platform_own", true);

  rerender(<DivisionPlatformFields form={{ ...form, platform_own: true }} set={set} seasonId="s1" />);
  fireEvent.click(screen.getByTestId("override-platforms-Xbox"));
  expect(set).toHaveBeenCalledWith("allowed_platforms", ["Xbox"]);
});

test("Liga-N-Blatt ohne Feld der Season: nur Crossplay und Eingabegerät", async () => {
  apiMock.get.mockResolvedValue({ data: view(EMPTY) });
  render(<DivisionPlatformFields form={{ platform_own: false, allowed_platforms: [], crossplay: "", input_device: "" }} set={vi.fn()} seasonId="s1" />);

  expect(await screen.findByTestId("division-platform")).toHaveTextContent("erst, wenn die Season");
  expect(screen.queryByTestId("override-platform-own")).toBeNull();
  expect(screen.getByTestId("override-crossplay")).toBeInTheDocument();
});
