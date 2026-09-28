import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Die Bühne (#634): ohne aktive Saison wird kein Modul geladen, im Admin bleibt sie leer, mit Saison
// kommen Ecken, Widget, Footer und das Kennzeichen am <html>; „aus“ lädt nichts.

const seasonState = { ready: true, seasons: [], byKey: {}, reducedMotion: false, preference: "on", setPreference: vi.fn(), preview: false };
vi.mock("./SeasonContext", () => ({ useSeason: () => seasonState }));

const loadModule = vi.fn(async () => ({
  season: {
    key: "halloween",
    accent: "rgba(255,140,0,0.45)",
    Corners: () => <span data-testid="fake-corners" />,
    Widget: () => <button type="button" data-testid="fake-widget">Kürbis</button>,
    Footer: () => <span data-testid="fake-footer" />,
    Toast: () => <span data-testid="fake-toast" />,
  },
}));
vi.mock("./registry", () => ({ SEASON_MODULES: { halloween: () => loadModule() }, hasModule: (key) => key === "halloween" }));

const { SeasonStage, isQuietPath, toastShownToday, markToastShown } = await import("./SeasonStage");
const { SeasonWidgetSlot, SeasonFooterSlot } = await import("./SeasonSlots");

function halloween(effective = "normal") {
  return { key: "halloween", phase: "deko", intensity: "normal", effective, channels: ["web"], texts: {}, data: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  seasonState.seasons = [];
  delete document.documentElement.dataset.season;
  document.documentElement.style.removeProperty("--season-accent");
});

test("Pfade ohne Deko und der Gruß-Merker", () => {
  expect(isQuietPath("/admin")).toBe(true);
  expect(isQuietPath("/admin/settings/jahreszeiten")).toBe(true);
  expect(isQuietPath("/display/1")).toBe(true);
  expect(isQuietPath("/administration")).toBe(false);
  expect(isQuietPath("/")).toBe(false);
  const day = new Date("2026-12-24T10:00:00Z");
  expect(toastShownToday("christmas", day)).toBe(false);
  markToastShown("christmas", day);
  expect(toastShownToday("christmas", day)).toBe(true);
  expect(toastShownToday("christmas", new Date("2026-12-25T10:00:00Z"))).toBe(false);
});

test("ohne aktive Saison lädt kein Modul und nichts steht am <html>", async () => {
  render(<MemoryRouter initialEntries={["/"]}><SeasonStage /><SeasonWidgetSlot /></MemoryRouter>);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(loadModule).not.toHaveBeenCalled();
  expect(screen.queryByTestId("season-corners")).toBeNull();
  expect(document.documentElement.dataset.season).toBeUndefined();
});

test("mit Saison: Ecken, Widget, Footer, Toast und Kennzeichen; „aus“ lädt nichts", async () => {
  seasonState.seasons = [halloween("normal")];
  render(<MemoryRouter initialEntries={["/tournaments"]}><SeasonStage /><SeasonWidgetSlot /><SeasonFooterSlot /></MemoryRouter>);
  expect(await screen.findByTestId("fake-corners")).toBeInTheDocument();
  expect(screen.getByTestId("fake-widget")).toBeInTheDocument();
  expect(screen.getByTestId("fake-footer")).toBeInTheDocument();
  expect(screen.getByTestId("fake-toast")).toBeInTheDocument();
  expect(screen.getByTestId("season-corners").parentElement).toBe(document.body);
  await waitFor(() => expect(document.documentElement.dataset.season).toBe("halloween"));
  expect(document.documentElement.style.getPropertyValue("--season-accent")).toContain("rgba");
  expect(loadModule).toHaveBeenCalledTimes(1);
});

test("„aus“ lädt nichts, „dezent“ ohne Farbschein", async () => {
  seasonState.seasons = [halloween("off")];
  const { unmount } = render(<MemoryRouter initialEntries={["/"]}><SeasonStage /></MemoryRouter>);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(loadModule).not.toHaveBeenCalled();
  unmount();
  seasonState.seasons = [halloween("subtle")];
  render(<MemoryRouter initialEntries={["/"]}><SeasonStage /></MemoryRouter>);
  expect(await screen.findByTestId("fake-corners")).toBeInTheDocument();
  await waitFor(() => expect(document.documentElement.dataset.season).toBe("halloween"));
  expect(document.documentElement.style.getPropertyValue("--season-accent")).toBe("");
});

test("im Admin bleibt die Bühne leer", async () => {
  seasonState.seasons = [halloween("full")];
  render(<MemoryRouter initialEntries={["/admin/settings/jahreszeiten"]}><SeasonStage /><SeasonWidgetSlot /></MemoryRouter>);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(loadModule).not.toHaveBeenCalled();
  expect(screen.queryByTestId("fake-widget")).toBeNull();
});

test("mit Vorschau zeichnet die Bühne auch im Admin - sofort sichtbar nach dem Knopf", async () => {
  seasonState.seasons = [halloween("full")];
  seasonState.preview = true;
  render(<MemoryRouter initialEntries={["/admin/settings/jahreszeiten"]}><SeasonStage /><SeasonWidgetSlot /></MemoryRouter>);
  expect(await screen.findByTestId("fake-corners")).toBeInTheDocument();
  expect(screen.getByTestId("fake-widget")).toBeInTheDocument();
  seasonState.preview = false;
});
