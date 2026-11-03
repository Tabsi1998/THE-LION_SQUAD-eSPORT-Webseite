import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

// Plattform je Season (#2270): Abschnitt im Reiter „Anmeldung und Kader“ - Feld wählen, Plattformen anhaken, Crossplay und Eingabegerät,
// Liga N im Überblick, Hinweise. Gespeichert wird mit dem Reiter; hier zählt, was im Formular landet. Dazu das Liga-N-Blatt.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));

const { SeasonPlatformSection } = await import("./SeasonPlatformSection");
const { DivisionPlatformFields } = await import("./DivisionPlatformFields");
const { platformToForm } = await import("@/lib/leaguePlatform");

const FIELD = { key: "platform", label: "Plattform", options: ["PC", "PlayStation", "Xbox"], retired: [], required: false };
const EMPTY = { platform_field: null, allowed_platforms: [], crossplay: null, input_device: null };

function view(settings = EMPTY, extra = {}) {
  return { settings, fields: [FIELD], field_missing: false, input_devices: [], game: { id: "g1", name: "Probe Shooter" }, divisions: [], ...extra };
}

let latest = null;
function Harness({ saved = EMPTY }) {
  const [form, setForm] = useState(() => platformToForm(saved));
  latest = form;
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <SeasonPlatformSection seasonId="s1" form={form} set={set} id="plattform" version="v1" />;
}

beforeEach(() => {
  apiMock.get.mockReset();
  latest = null;
});

test("Feld wählen, PC anhaken, Crossplay aus und Controller - alles landet im Formular des Reiters", async () => {
  apiMock.get.mockResolvedValue({ data: view() });
  render(<Harness />);

  expect(await screen.findByTestId("season-platform-field")).toHaveValue("");
  expect(screen.getByTestId("season-platform")).toHaveAttribute("id", "plattform");
  expect(screen.queryByTestId("season-platform-allowed")).toBeNull();
  fireEvent.change(screen.getByTestId("season-platform-field"), { target: { value: "platform" } });
  expect(screen.getByTestId("season-platform-allowed-hint")).toHaveTextContent("Nichts angehakt: alle Plattformen erlaubt");
  expect(screen.getByTestId("season-platform-allowed-hint")).toHaveTextContent("freiwillig");
  fireEvent.click(screen.getByTestId("season-platform-allowed-Xbox"));
  fireEvent.click(screen.getByTestId("season-platform-allowed-PC"));
  expect(screen.getByTestId("season-platform-allowed-hint")).toHaveTextContent("nicht spielberechtigt");
  fireEvent.change(screen.getByTestId("season-platform-crossplay"), { target: { value: "off" } });
  fireEvent.change(screen.getByTestId("season-platform-input"), { target: { value: "controller" } });

  expect(latest).toEqual({ platform_field: "platform", allowed_platforms: ["PC", "Xbox"], crossplay: "off", input_device: "controller" });
  expect(apiMock.get).toHaveBeenCalledWith("/admin/leagues/seasons/s1/platform");
});

test("alle angehakt heißt: jede Plattform, aber Pflicht; ein anderes Feld leert die Auswahl, zurück holt die gespeicherte", async () => {
  const other = { key: "region", label: "Region", options: ["EU", "NA"], retired: [], required: true };
  const saved = { ...EMPTY, platform_field: "platform", allowed_platforms: ["PC", "PlayStation", "Xbox"] };
  apiMock.get.mockResolvedValue({ data: view(saved, { fields: [FIELD, other] }) });
  render(<Harness saved={saved} />);

  expect(await screen.findByTestId("season-platform-allowed-hint")).toHaveTextContent("Alle angehakt: jede Plattform erlaubt, die Angabe im Profil ist aber Pflicht.");
  fireEvent.change(screen.getByTestId("season-platform-field"), { target: { value: "region" } });
  expect(screen.getByTestId("season-platform-allowed-EU")).not.toBeChecked();
  expect(screen.getByTestId("season-platform-allowed-hint")).toHaveTextContent("Pflicht: Die Plattform wird mit der Spiel-ID");
  expect(latest.allowed_platforms).toEqual([]);
  fireEvent.change(screen.getByTestId("season-platform-field"), { target: { value: "platform" } });
  expect(latest.allowed_platforms).toEqual(["PC", "PlayStation", "Xbox"]);
});

test("ohne Feld mit Auswahl steht der Weg zur Spielverwaltung da, ein verschwundenes Feld warnt", async () => {
  const saved = { ...EMPTY, platform_field: "alt" };
  apiMock.get.mockResolvedValue({ data: view(saved, { fields: [], field_missing: true }) });
  render(<Harness saved={saved} />);

  expect(await screen.findByTestId("season-platform-no-field")).toHaveTextContent("Probe Shooter hat kein Spiel-ID-Feld mit Auswahl");
  expect(screen.getByTestId("season-platform-field-missing")).toHaveTextContent("prüft diese Season keine Plattform");
  expect(screen.queryByTestId("season-platform-field")).toBeNull();
  expect(screen.getByTestId("season-platform-crossplay")).toBeInTheDocument();
});

test("je Liga N steht, was dort gilt und ob sie abweicht", async () => {
  const saved = { ...EMPTY, platform_field: "platform", allowed_platforms: ["PC"] };
  apiMock.get.mockResolvedValue({ data: view(saved, { divisions: [
    { id: "d1", label: "Liga 1", overrides: {}, effective: { allowed: ["PC"], crossplay: null, input_device: null } },
    { id: "d2", label: "Liga 2 · Offen", overrides: { allowed_platforms: [] }, effective: { allowed: [], crossplay: true, input_device: "both" } },
  ] }) });
  render(<Harness saved={saved} />);

  expect(await screen.findByTestId("season-platform-division-d1")).toHaveTextContent("Liga 1nur PCwie Season");
  expect(screen.getByTestId("season-platform-division-d2")).toHaveTextContent("alle Plattformen · Crossplay an · Controller oder Maus und Tastatur");
  expect(screen.getByTestId("season-platform-division-d2")).toHaveTextContent("weicht ab");
});

test("ohne Antwort des Servers bleibt der Abschnitt weg", async () => {
  apiMock.get.mockRejectedValue(new Error("weg"));
  const { container } = render(<Harness />);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(container).toBeEmptyDOMElement();
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

  expect(await screen.findByTestId("division-platform")).toHaveTextContent("erst, wenn die Season das Feld gewählt hat");
  expect(screen.queryByTestId("override-platform-own")).toBeNull();
  expect(screen.getByTestId("override-crossplay")).toBeInTheDocument();
});
