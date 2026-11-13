import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Spielzeit-Uhr am TV (#1167): Warteschlange und Live-Spotlight rechnen wie Station und Leitung (lib/matchClock) und
// zählen nach der Serverzeit - geht die Uhr des TV daneben, steht trotzdem dieselbe Sekunde da. Namen sind erfunden.

const season = { serverOffset: 0 };
vi.mock("@/seasons/SeasonContext", () => ({ useSeason: () => season }));
const apiMock = { get: vi.fn(async () => ({ data: { settings: {} } })) };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value }));

const { TvScreen } = await import("./TvScreen");
const { TvQueueClock } = await import("./TvQueueBoard");
const { TvSpotlight } = await import("./TvTreeNode");

const MINUTE = 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
  season.serverOffset = 0;
});

function onTv(child) {
  return render(<MemoryRouter initialEntries={["/display/bracket/t1"]}><TvScreen>{child}</TvScreen></MemoryRouter>);
}

test("Warteschlange: die TV-Uhr geht 3 Minuten vor - es zählt der Server (16:00 / 20 Min., knapp)", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T16:19:00Z"));
  season.serverOffset = -3 * MINUTE;
  onTv(<TvQueueClock entry={{ started_at: "2026-10-31T16:00:00Z", duration_minutes: 20 }} testId="tv-clock" />);
  const clock = screen.getByTestId("tv-clock");
  expect(clock).toHaveTextContent("16:00");
  expect(clock).toHaveTextContent("/ 20 Min.");
  expect(clock).toHaveAttribute("data-tone", "warn");
  expect(clock).toHaveAttribute("aria-label", "Spielzeit 16:00 von 20 Min., knapp");
});

test("Live-Spotlight: „PC 3 · 21:00 / 20 Min.“ - überschritten, nach der Serverzeit", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T16:20:00Z"));
  season.serverOffset = MINUTE;
  onTv(<TvSpotlight match={{ id: "m1", station_name: "PC 3", started_at: "2026-10-31T16:00:00Z", duration_minutes: 20 }} />);
  expect(screen.getByTestId("tv-spot-m1")).toHaveAttribute("data-tone", "over");
  expect(screen.getByTestId("tv-spot-clock-m1")).toHaveTextContent("21:00");
  expect(screen.getByTestId("tv-spot-clock-m1")).toHaveAttribute("aria-label", "Spielzeit 21:00 von 20 Min., Zeit überschritten");
  expect(screen.getByTestId("tv-spot-m1")).toHaveTextContent("/ 20 Min.");
});

test("Live-Spotlight ohne Dauer: nur die Zeit, ohne Farbe; ohne Start „Live“", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T17:05:12Z"));
  onTv(<>
    <TvSpotlight match={{ id: "m2", station_name: "PC 4", started_at: "2026-10-31T16:00:00Z" }} />
    <TvSpotlight match={{ id: "m3", station_name: "PC 5" }} />
  </>);
  expect(screen.getByTestId("tv-spot-m2")).toHaveAttribute("data-tone", "none");
  expect(screen.getByTestId("tv-spot-clock-m2")).toHaveTextContent("1:05:12");
  expect(screen.getByTestId("tv-spot-m2")).not.toHaveTextContent("Min.");
  expect(screen.getByTestId("tv-spot-clock-m3")).toHaveTextContent("Live");
});
