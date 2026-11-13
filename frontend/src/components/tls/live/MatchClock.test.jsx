import { render, screen } from "@testing-library/react";

// Spielzeit-Uhr (#1167) in der Stationskachel: nach der Serverzeit (Abstand aus dem Saison-Kontext), Farbe und Zustand
// für Screenreader, „Bewegung reduzieren“ minutenweise, kleine Uhr für Listen. Namen sind erfunden.

const season = { serverOffset: 0 };
vi.mock("@/seasons/SeasonContext", () => ({ useSeason: () => season }));

const { MatchClock } = await import("./MatchClock");
const { StationTile } = await import("./StationTile");

const MINUTE = 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
  season.serverOffset = 0;
  vi.unstubAllGlobals();
});

const running = {
  id: "st3", name: "3", station_text: "Station 3", status: "busy", next: null, after: null,
  running: { match_id: "QF3", match_key: "QF3", label: "Viertelfinale", names: ["NeonFalke", "PixelPanther"], open_slots: 0, ready: true, state: "running", position: 0, started_at: "2026-10-31T16:00:00Z", duration_minutes: 20 },
};

test("Kachel: die Geräteuhr geht 7 Minuten nach - die Uhr zählt trotzdem nach dem Server (16:00 / 20 Min., knapp)", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T16:09:00Z"));
  season.serverOffset = 7 * MINUTE;
  render(<StationTile station={running} canOperate targets={[]} onCall={vi.fn()} onStart={vi.fn()} onRelease={vi.fn()} onBroken={vi.fn()} onMove={vi.fn()} />);
  const clock = screen.getByTestId("live-clock-QF3");
  expect(screen.getByTestId("live-clock-QF3-time")).toHaveTextContent("16:00");
  expect(clock).toHaveTextContent("/ 20 Min.");
  expect(clock).toHaveAttribute("data-tone", "warn");
  expect(clock).toHaveAttribute("role", "timer");
  expect(clock).toHaveAttribute("aria-label", "Spielzeit 16:00 von 20 Min., knapp");
  expect(screen.getByTestId("live-clock-QF3-bar").style.transform).toBe("scaleX(0.8)");
});

test("Zeit überschritten: Farbe, „+N Min.“ und der Satz für Screenreader; über eine Stunde mit Stunden", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T17:05:12Z"));
  render(<MatchClock startedAt="2026-10-31T16:00:00Z" durationMinutes={45} testId="clock" />);
  expect(screen.getByTestId("clock-time")).toHaveTextContent("1:05:12");
  expect(screen.getByTestId("clock")).toHaveAttribute("data-tone", "over");
  expect(screen.getByTestId("clock")).toHaveTextContent("+20 Min.");
  expect(screen.getByTestId("clock")).toHaveAttribute("aria-label", "Spielzeit 1:05:12 von 45 Min., Zeit überschritten");
});

test("ohne Dauer: nur die laufende Zeit, ohne Farbe und ohne Balken", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T16:03:09Z"));
  render(<MatchClock startedAt="2026-10-31T16:00:00Z" durationMinutes={null} testId="clock" />);
  expect(screen.getByTestId("clock")).toHaveAttribute("data-tone", "none");
  expect(screen.getByTestId("clock")).toHaveAttribute("aria-label", "Spielzeit 03:09");
  expect(screen.queryByTestId("clock-bar")).toBeNull();
});

test("„Bewegung reduzieren“: der Balken springt minutenweise", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T16:10:30Z"));
  vi.stubGlobal("matchMedia", (query) => ({ matches: query.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
  render(<MatchClock startedAt="2026-10-31T16:00:00Z" durationMinutes={20} testId="clock" />);
  expect(screen.getByTestId("clock-bar").style.transform).toBe("scaleX(0.5)");
});

test("Pause: mit `pausedAt` steht die Uhr", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T16:30:00Z"));
  render(<MatchClock startedAt="2026-10-31T16:00:00Z" durationMinutes={20} pausedAt="2026-10-31T16:05:00Z" testId="clock" />);
  expect(screen.getByTestId("clock-time")).toHaveTextContent("05:00");
  expect(screen.getByTestId("clock")).toHaveAttribute("aria-label", "Spielzeit 05:00 von 20 Min., angehalten");
});

test("kleine Uhr für Listen: dieselbe Zeit, eigene Größe", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T16:12:06Z"));
  render(<MatchClock startedAt="2026-10-31T16:00:00Z" durationMinutes={20} size="sm" testId="clock" />);
  expect(screen.getByTestId("clock")).toHaveAttribute("data-size", "sm");
  expect(screen.getByTestId("clock")).toHaveTextContent("12:06/ 20 Min.");
});

test("Web-Baum und Spielplan (LiveClock): dieselbe Rechnung - Serverzeit, über eine Stunde mit Stunden", async () => {
  const { LiveClock } = await import("@/components/tls/bracket/BracketCards");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T17:00:12Z"));
  season.serverOffset = 5 * MINUTE;
  render(<LiveClock startedAt="2026-10-31T16:00:00Z" />);
  expect(screen.getByTestId("bracket-live-clock")).toHaveTextContent("1:05:12");
});
