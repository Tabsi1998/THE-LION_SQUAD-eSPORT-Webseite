import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// TV & Beamer (#1110, #1112): Link vor Grundwert vor Standard, Grundwerte kommen live über den Änderungsstrom,
// „Bewegung reduzieren“ an einer Stelle, der sichere Bereich, wach halten.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));

const { TvScreen, stageInset, useTv } = await import("./TvScreen");
const { emitApiInvalidation } = await import("@/lib/apiInvalidation");

function Probe() {
  const tv = useTv();
  return <div data-testid="probe" data-motion={tv.motionOn ? "on" : "off"} data-text={tv.textSize}>{JSON.stringify(tv.settings)}</div>;
}

function renderAt(path) {
  return render(<MemoryRouter initialEntries={[path]}><TvScreen><Probe /></TvScreen></MemoryRouter>);
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  apiMock.get.mockReset();
  window.matchMedia = originalMatchMedia;
});

afterAll(() => {
  window.matchMedia = originalMatchMedia;
});

test("ohne gespeicherte Werte gilt der Standard", async () => {
  apiMock.get.mockRejectedValue(new Error("offline"));
  renderAt("/display/event/e1");
  const tv = await screen.findByTestId("tv-screen");
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/tv/settings"));
  expect(tv).toHaveAttribute("data-tv-contrast", "0");
  expect(tv).toHaveAttribute("data-tv-text", "normal");
  expect(tv).toHaveAttribute("data-tv-safe", "0");
  expect(tv).toHaveAttribute("data-tv-motion", "on");
  expect(tv).toHaveAttribute("data-tv-season", "1");
  expect(screen.getByTestId("tv-stage")).toHaveAttribute("data-shift", "0,0");
});

test("Link-Werte schlagen Grundwerte - ein Link mit Abweichung gilt nur für diesen Bildschirm", async () => {
  apiMock.get.mockResolvedValue({ data: { settings: { contrast: true, text_size: "large", safe_area: 3 } } });
  const first = renderAt("/display/event/e1?text_size=normal&safe_area=5");
  const tv = await screen.findByTestId("tv-screen");
  await waitFor(() => expect(tv).toHaveAttribute("data-tv-contrast", "1"));
  expect(tv).toHaveAttribute("data-tv-text", "normal");
  expect(tv).toHaveAttribute("data-tv-safe", "5");
  first.unmount();

  // Ein zweiter Bildschirm ohne Abweichung folgt den Grundwerten.
  renderAt("/display/event/e1");
  const other = await screen.findByTestId("tv-screen");
  await waitFor(() => expect(other).toHaveAttribute("data-tv-text", "large"));
  expect(other).toHaveAttribute("data-tv-safe", "3");
});

test("eine Änderung im Admin kommt ohne Neuladen am TV an", async () => {
  apiMock.get
    .mockResolvedValueOnce({ data: { settings: { contrast: false } } })
    .mockResolvedValue({ data: { settings: { contrast: true } } });
  renderAt("/display/f1/f1");
  const tv = await screen.findByTestId("tv-screen");
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(1));
  expect(tv).toHaveAttribute("data-tv-contrast", "0");
  // Der Änderungsstrom meldet öffentlich „tv“, sobald der Admin speichert.
  act(() => {
    emitApiInvalidation({ source: "server", event_id: "tv-change-1", path: "/api/tv", resource: "tv" });
  });
  await waitFor(() => expect(tv).toHaveAttribute("data-tv-contrast", "1"));
  expect(apiMock.get).toHaveBeenCalledTimes(2);
});

test("Bewegung reduzieren: aus den Grundwerten, aus dem Link oder vom Gerät", async () => {
  apiMock.get.mockResolvedValue({ data: { settings: { reduce_motion: true } } });
  const first = renderAt("/display/event/e1");
  await waitFor(() => expect(screen.getByTestId("tv-screen")).toHaveAttribute("data-tv-motion", "off"));
  expect(screen.getByTestId("probe")).toHaveAttribute("data-motion", "off");
  first.unmount();

  apiMock.get.mockResolvedValue({ data: { settings: {} } });
  const second = renderAt("/display/event/e1?reduce_motion=1");
  await waitFor(() => expect(screen.getByTestId("tv-screen")).toHaveAttribute("data-tv-motion", "off"));
  second.unmount();

  window.matchMedia = (query) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} });
  renderAt("/display/event/e1");
  expect(screen.getByTestId("tv-screen")).toHaveAttribute("data-tv-motion", "off");
});

test("Groß und Kontrast setzen die Größen und Farben an einer Stelle", async () => {
  apiMock.get.mockResolvedValue({ data: { settings: {} } });
  renderAt("/display/event/e1?text_size=large&contrast=an");
  const tv = await screen.findByTestId("tv-screen");
  expect(tv).toHaveAttribute("data-tv-text", "large");
  expect(tv).toHaveAttribute("data-tv-contrast", "1");
  expect(tv.style.getPropertyValue("--tv-k-meta")).toBe("2.1");
  expect(tv.style.getPropertyValue("--tv-k-nameMin")).toBe("3");
});

test("sicherer Bereich mit Luft für die Pixel-Verschiebung - ohne sicheren Bereich ragt die Bühne über den Rand", () => {
  expect(stageInset(0, true)).toEqual({ y: "-3px", x: "-3px" });
  expect(stageInset(0, false)).toEqual({ y: "0px", x: "0px" });
  expect(stageInset(5, true)).toEqual({ y: "calc(5vh + 3px)", x: "calc(5vw + 3px)" });
  expect(stageInset(3, false)).toEqual({ y: "calc(3vh + 0px)", x: "calc(3vw + 0px)" });
});

test("wach halten: kann der Browser das nicht, steht ein kleiner Hinweis - die Seite läuft weiter", async () => {
  apiMock.get.mockResolvedValue({ data: { settings: {} } });
  renderAt("/display/event/e1");
  expect(await screen.findByTestId("tv-wake-hint")).toHaveTextContent("Bildschirm nicht wach halten");
  expect(screen.getByTestId("probe")).toBeInTheDocument();
});
