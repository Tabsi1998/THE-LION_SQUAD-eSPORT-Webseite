import { readFileSync } from "node:fs";
import path from "node:path";
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
  // Fabians Auswahl (07.10.): überschritten = orange gefüllt mit Warn-Symbol, Rot bleibt „läuft“.
  expect(screen.getByTestId("clock-warn")).toBeInTheDocument();
  expect(screen.getByTestId("clock")).toHaveTextContent("+20 Min.");
  expect(screen.getByTestId("clock").querySelector(".text-live")).toBeNull();
});

test("knapp: orange ohne Warn-Symbol; ruhig ohne beides", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T16:17:00Z"));
  const { rerender } = render(<MatchClock startedAt="2026-10-31T16:00:00Z" durationMinutes={20} testId="clock" />);
  expect(screen.getByTestId("clock")).toHaveAttribute("data-tone", "warn");
  expect(screen.queryByTestId("clock-warn")).toBeNull();
  rerender(<MatchClock startedAt="2026-10-31T16:10:00Z" durationMinutes={20} testId="clock" />);
  expect(screen.getByTestId("clock")).toHaveAttribute("data-tone", "run");
  expect(screen.queryByTestId("clock-warn")).toBeNull();
});

test("Farben (Fabians Auswahl 07.10.): „knapp“ und „überschritten“ sind Orange - Rot (`live`) nur für „läuft“", () => {
  const css = ["src/components/tls/live/live.css", "src/components/tv/tv.css"]
    .map((file) => readFileSync(path.join(process.cwd(), file), "utf8")).join(" ");
  const toneRules = css.split("}").filter((rule) => /data-tone="(warn|over)"/.test(rule));
  expect(toneRules.length).toBeGreaterThan(6);
  expect(toneRules.filter((rule) => /tls-live\b|tv-live\b|live-rgb/.test(rule.split("{")[1] || ""))).toEqual([]);
  expect(toneRules.filter((rule) => /data-tone="over"/.test(rule) && /tls-warn/.test(rule)).length).toBeGreaterThan(3);
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
  expect(screen.getByTestId("bracket-live-clock")).toHaveAttribute("data-tone", "none");
});

test("Web-Baum mit Dauer: dieselben Farben - knapp orange, überschritten orange gefüllt mit Warn-Symbol", async () => {
  const { LiveClock } = await import("@/components/tls/bracket/BracketCards");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T16:17:00Z"));
  const { rerender } = render(<LiveClock startedAt="2026-10-31T16:00:00Z" durationMinutes={20} />);
  const clock = screen.getByTestId("bracket-live-clock");
  expect(clock).toHaveAttribute("data-tone", "warn");
  expect(clock).toHaveAttribute("aria-label", "Spielzeit 17:00 von 20 Min., knapp");
  expect(clock.querySelector(".tls-live-clock-icon")).toBeNull();
  rerender(<LiveClock startedAt="2026-10-31T15:50:00Z" durationMinutes={20} />);
  expect(screen.getByTestId("bracket-live-clock")).toHaveAttribute("data-tone", "over");
  expect(screen.getByTestId("bracket-live-clock").querySelector(".tls-live-clock-icon")).not.toBeNull();
  expect(screen.getByTestId("bracket-live-clock")).toHaveTextContent("27:00");
});

test("Pause vom Server: in der Pause steht die Uhr mit „Pause“, danach läuft sie ohne die 5 Minuten weiter", async () => {
  const { act } = await import("@testing-library/react");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T16:17:00Z"));
  // Gestartet 16:00, Pause seit 16:12 (5 Minuten): die Uhr steht bei 12:00, auch wenn Zeit vergeht.
  const { rerender } = render(<MatchClock startedAt="2026-10-31T16:00:00Z" durationMinutes={20} pausedAt="2026-10-31T16:12:00Z" testId="clock" />);
  expect(screen.getByTestId("clock-time")).toHaveTextContent("12:00");
  expect(screen.getByTestId("clock-paused")).toHaveTextContent("Pause");
  expect(screen.getByTestId("clock")).toHaveAttribute("data-paused", "1");
  act(() => { vi.advanceTimersByTime(5000); });
  expect(screen.getByTestId("clock-time")).toHaveTextContent("12:00");
  // Weiter um 16:17: der Server hat 300 Sekunden Pause auf das Spiel gebucht - die Uhr zählt ab 12:00 weiter.
  rerender(<MatchClock startedAt="2026-10-31T16:00:00Z" durationMinutes={20} pausedSeconds={300} testId="clock" />);
  act(() => { vi.advanceTimersByTime(1000); });
  expect(screen.getByTestId("clock-time")).toHaveTextContent(/^12:0\d$/);
  expect(screen.queryByTestId("clock-paused")).toBeNull();
  expect(screen.getByTestId("clock")).toHaveAttribute("data-tone", "run");
  // Eine zweite Pause (3 Minuten, gebucht) summiert sich: 16:30 - 16:00 - 8 Min. = 22:00, überschritten.
  vi.setSystemTime(new Date("2026-10-31T16:30:00Z"));
  rerender(<MatchClock startedAt="2026-10-31T16:00:00Z" durationMinutes={20} pausedSeconds={480} testId="clock" />);
  act(() => { vi.advanceTimersByTime(1000); });
  expect(screen.getByTestId("clock-time")).toHaveTextContent(/^22:0\d$/);
});

test("Pause im Web-Baum (LiveClock): die Zeit steht", async () => {
  const { LiveClock } = await import("@/components/tls/bracket/BracketCards");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T16:40:00Z"));
  render(<LiveClock startedAt="2026-10-31T16:00:00Z" durationMinutes={20} pausedAt="2026-10-31T16:10:00Z" pausedSeconds={60} />);
  expect(screen.getByTestId("bracket-live-clock")).toHaveTextContent("09:00");
  expect(screen.getByTestId("bracket-live-clock")).toHaveAttribute("aria-label", "Spielzeit 09:00 von 20 Min., angehalten");
});
