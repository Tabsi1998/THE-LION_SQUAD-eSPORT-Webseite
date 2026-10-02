import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Schnee (S7, W2, W3, W4): Anteil und Hauben je Seitenklasse und Fensterbreite; Flocken nur mit Bewegung und Budget;
// der Winterhimmel nach Sonnenzeiten und Wetter hinter dem Inhalt; Hauben mit Stufe, Tauwetter und Licht; die
// Schneeflocke zählt, platzt und meldet das Signal - fünfzig ergeben den Schneekönig; Jahres-Salz über Silvester.

const mockWeather = { temp_c: -3, wind_factor: 0.8, wind_dir: 270, snow_cm: 0 };
vi.mock("../SeasonContext", () => ({ useSeason: () => ({ weather: mockWeather }) }));
const signals = { recordSignal: vi.fn(() => true) };
vi.mock("../signals", () => signals);

const { Backdrop, Corners, SIGNAL_KEY, SNOW_KING_AT, Widget, season, setYearSalt, skyLayers, snowLayout, yearSaltFor } = await import("./index.jsx");
setYearSalt("test");

function snow(overrides = {}, data = {}) {
  return { key: "snow", effective: "normal", starts_at: "2026-11-29T00:00:00+01:00", ends_at: "2027-01-06T23:59:59+01:00", texts: {}, data: { night: false, snowcap_stage: 2, ...data }, ...overrides };
}

function memory(initial = {}) {
  const store = { ...initial };
  return { getItem: (key) => (key in store ? store[key] : null), setItem: (key, value) => { store[key] = String(value); }, store };
}

function box(element, rect) {
  element.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top });
}

let fixture = null;
const originalWidth = window.innerWidth;

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  fixture?.remove();
  fixture = null;
  Object.defineProperty(window, "innerWidth", { value: originalWidth, configurable: true, writable: true });
});

test("Seitenklasse: Startseite alles, Login weniger und weniger Hauben, Admin nichts, Handy keine Hauben", () => {
  expect(snowLayout("/", "normal", 1440)).toMatchObject({ cls: "lively", share: 1, caps: true, capsMax: 18, tint: true, mobile: false });
  expect(snowLayout("/login", "normal", 1440)).toMatchObject({ cls: "calm", share: 0.6, caps: true, capsMax: 6 });
  expect(snowLayout("/admin/x", "normal", 1440)).toMatchObject({ share: 0, caps: false, capsMax: 0, tint: false });
  expect(snowLayout("/", "normal", 390)).toMatchObject({ share: 0.6, caps: false, capsMax: 0, mobile: true });
  expect(snowLayout("/", "subtle", 1440)).toMatchObject({ share: 0.6, caps: true, capsMax: 6 });
});

test("Flocken: nicht ohne Bewegung, nicht bei „dezent“, nicht ohne Budget - sonst eine Ebene mit dem Wetter", () => {
  expect(skyLayers({ season: snow(), budget: 40, reducedMotion: true })).toEqual([]);
  expect(skyLayers({ season: snow({ effective: "subtle" }), budget: 40 })).toEqual([]);
  expect(skyLayers({ season: snow(), budget: 0 })).toEqual([]);
  const layers = skyLayers({ season: snow(), budget: 40, weather: { snow_cm: 2, wind_factor: 1.1, wind_dir: 90 } });
  expect(layers).toHaveLength(1);
  expect(layers[0].key).toBe("snow-flakes");
  expect(layers[0].state().wind).toEqual({ factor: 1.1, sign: -1 });
  expect(layers[0].state().snowing).toBe(true);
  layers[0].dispose();
});

test("Jahres-Salz: fest in Tests, sonst aus dem Beginn - Schnee im Jänner zählt noch zum Vorjahr", () => {
  expect(yearSaltFor(snow())).toBe("test");
  setYearSalt(null);
  expect(yearSaltFor(snow())).toBe("2026");
  expect(yearSaltFor({ starts_at: "" }, new Date(2027, 0, 3))).toBe("2026");
  expect(yearSaltFor({ starts_at: "" }, new Date(2026, 11, 3))).toBe("2026");
  setYearSalt("test");
});

test("Winterhimmel: tagsüber ohne Blauschein und Sterne, nachts mit; „dezent“ still mit halb so vielen; stille Seiten nichts", () => {
  Object.assign(mockWeather, { sunrise: "2026-12-12T07:45:00+01:00", sunset: "2026-12-12T16:25:00+01:00", code: 0 });
  const noon = () => Date.parse("2026-12-12T12:00:00+01:00");
  const night = () => Date.parse("2026-12-12T21:00:00+01:00");
  const day = render(<MemoryRouter initialEntries={["/"]}><Backdrop season={snow()} now={noon} /></MemoryRouter>);
  expect(screen.getByTestId("winter-sky").className).toContain("tls-season-backdrop");
  expect(screen.queryByTestId("snow-tint")).toBeNull();
  expect(screen.queryByTestId("winter-stars")).toBeNull();
  day.unmount();
  const dark = render(<MemoryRouter initialEntries={["/"]}><Backdrop season={snow()} now={night} /></MemoryRouter>);
  expect(screen.getByTestId("snow-tint").style.opacity).toBe("1");
  expect(screen.getByTestId("winter-stars").querySelectorAll("circle")).toHaveLength(snowLayout("/", "normal").stars);
  expect(screen.getByTestId("winter-stars").getAttribute("class")).toContain("twinkle");
  dark.unmount();
  const still = render(<MemoryRouter initialEntries={["/"]}><Backdrop season={snow({ effective: "subtle" })} now={night} /></MemoryRouter>);
  expect(screen.getByTestId("winter-stars").getAttribute("class")).not.toContain("twinkle");
  expect(screen.getByTestId("winter-stars").querySelectorAll("circle")).toHaveLength(Math.round(snowLayout("/", "subtle").stars / 2));
  still.unmount();
  expect(render(<MemoryRouter initialEntries={["/admin"]}><Backdrop season={snow()} now={night} /></MemoryRouter>).container.innerHTML).toBe("");
  delete mockWeather.sunrise;
  delete mockWeather.sunset;
  delete mockWeather.code;
});

test("Hauben auf der Startseite mit Stufe des Servers und Tauwetter aus dem Wetter; auf dem Handy keine", async () => {
  vi.useFakeTimers();
  fixture = document.createElement("div");
  fixture.innerHTML = `<main><a id="c1" data-season-anchor="card">Eins</a><a id="c2" data-season-anchor="card">Zwei</a></main>`;
  document.body.appendChild(fixture);
  box(document.getElementById("c1"), { left: 40, right: 400, top: 100, bottom: 300 });
  box(document.getElementById("c2"), { left: 500, right: 900, top: 100, bottom: 300 });
  const { unmount } = render(<MemoryRouter initialEntries={["/"]}><Corners season={snow({}, { snowcap_stage: 3 })} /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  expect(screen.getAllByTestId("snow-cap")).toHaveLength(2);
  expect(screen.getByTestId("snow-caps").getAttribute("data-level")).toBe("3");
  unmount();
  mockWeather.temp_c = 4;
  const again = render(<MemoryRouter initialEntries={["/"]}><Corners season={snow({}, { snowcap_stage: 3 })} /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  expect(screen.getByTestId("snow-caps").getAttribute("data-level")).toBe("2");
  again.unmount();
  mockWeather.temp_c = -3;
  Object.defineProperty(window, "innerWidth", { value: 390, configurable: true, writable: true });
  render(<MemoryRouter initialEntries={["/"]}><Corners season={snow()} /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  expect(screen.queryAllByTestId("snow-cap")).toHaveLength(0);
});

test("Schneeflocke: fangen zählt, platzt und meldet das Signal; die fünfzigste macht den Schneekönig; dezent ohne Platzen", async () => {
  vi.useFakeTimers();
  const storage = memory();
  render(<Widget season={snow()} storage={storage} />);
  const button = screen.getByTestId("snow-flake");
  expect(button.getAttribute("aria-label")).toBe(`Schneeflocke fangen – 0 von ${SNOW_KING_AT}`);
  fireEvent.click(button);
  expect(signals.recordSignal).toHaveBeenCalledWith(SIGNAL_KEY, { onceIf: false });
  expect(storage.store.tls_snow_clicks).toBe("1");
  expect(screen.getByTestId("snow-widget").getAttribute("data-clicks")).toBe("1");
  await act(async () => {
    vi.advanceTimersByTime(1);
  });
  expect(button.className).toContain("tls-snowflake--burst");
  await act(async () => {
    vi.advanceTimersByTime(800);
  });
  expect(button.className).not.toContain("tls-snowflake--burst");
  expect(screen.queryByTestId("snow-note")).toBeNull();
  const king = memory({ tls_snow_clicks: String(SNOW_KING_AT - 1) });
  render(<Widget season={snow({ effective: "subtle" })} storage={king} />);
  const second = screen.getAllByTestId("snow-flake")[1];
  fireEvent.click(second);
  await act(async () => {
    vi.advanceTimersByTime(1);
  });
  expect(second.className).not.toContain("tls-snowflake--burst");
  expect(screen.getByTestId("snow-note")).toHaveTextContent("Schneekönig");
  expect(second.getAttribute("aria-label")).toContain("Schneekönig");
  expect(season.Widget).toBe(Widget);
  expect(season.skyLayers).toBe(skyLayers);
  expect(season.key).toBe("snow");
});
