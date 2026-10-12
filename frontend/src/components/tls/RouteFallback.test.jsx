import { readFileSync } from "node:fs";
import path from "node:path";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { startPageLoading } from "@/lib/pageLoading";
import { mountStartSplash, releaseStartSplash, shouldShowStartSplash } from "@/lib/startSplash";
import { RouteProgress, ROUTE_PROGRESS_DELAY_MS } from "./RouteProgress";

// Laden im Vereinsstil (#1324): beim Seitenwechsel bleiben Kopf und Leiste, darin ein Skelett; die dünne Linie unter
// dem Kopf erscheint erst nach 150 ms und steht mit „Bewegung reduzieren“ still.

vi.mock("./PublicLayout", () => ({
  PublicLayout: ({ children }) => (
    <div data-testid="frame">
      <header data-testid="site-header"><RouteProgress /></header>
      <main>{children}</main>
    </div>
  ),
}));

const { RouteFallback, StartSplashGate } = await import("./RouteFallback");

afterEach(() => {
  vi.useRealTimers();
});

test("öffentliche Seite: Rahmen mit Kopf, Skelett in Seitenform, Linie erst nach 150 ms", () => {
  vi.useFakeTimers();
  const { container } = render(<MemoryRouter initialEntries={["/tournaments"]}><RouteFallback /></MemoryRouter>);
  expect(screen.getByTestId("site-header")).toBeInTheDocument();
  expect(screen.getByTestId("page-loading")).toHaveTextContent("Seite lädt");
  expect(container.querySelector(".animate-spin")).toBeNull();
  expect(screen.queryByTestId("route-progress")).toBeNull();
  act(() => vi.advanceTimersByTime(ROUTE_PROGRESS_DELAY_MS - 10));
  expect(screen.queryByTestId("route-progress")).toBeNull();
  act(() => vi.advanceTimersByTime(20));
  expect(screen.getByTestId("route-progress")).toHaveAttribute("role", "progressbar");
});

test("Verwaltung: nur das ruhige Skelett, kein öffentlicher Kopf", () => {
  render(<MemoryRouter initialEntries={["/admin/events"]}><RouteFallback /></MemoryRouter>);
  expect(screen.getByTestId("route-fallback")).toBeInTheDocument();
  expect(screen.queryByTestId("site-header")).toBeNull();
});

test("schnelles Laden unter 150 ms zeigt keine Linie", () => {
  vi.useFakeTimers();
  render(<RouteProgress />);
  let stop;
  act(() => { stop = startPageLoading(); });
  act(() => vi.advanceTimersByTime(100));
  act(() => stop());
  act(() => vi.advanceTimersByTime(200));
  expect(screen.queryByTestId("route-progress")).toBeNull();
});

test("die Linie läuft - mit „Bewegung reduzieren“ steht sie still", () => {
  const css = readFileSync(path.join(process.cwd(), "src/index.css"), "utf8").replace(/\r\n/g, "\n");
  expect(css).toMatch(/\.tls-route-progress::before \{[^}]*animation: tls-route-progress/);
  const reduced = css.split("@media (prefers-reduced-motion: reduce)").slice(1).join("\n");
  expect(reduced).toMatch(/\.tls-route-progress::before[^{]*\{ animation: none !important; width: 100%/);
  // Skelette schimmern statt zu pulsieren.
  expect(css).toMatch(/\.tls-skeleton \{[^}]*animation: tls-skeleton-shimmer/);
});

test("Start-Löwe: nur in der installierten Website, einmal je Sitzung, weg sobald nichts mehr lädt", () => {
  vi.useFakeTimers();
  const originalMatchMedia = window.matchMedia;
  window.sessionStorage.clear();
  window.matchMedia = vi.fn((query) => ({ matches: query === "(display-mode: standalone)", addEventListener() {}, removeEventListener() {} }));
  expect(shouldShowStartSplash()).toBe(true);
  mountStartSplash();
  expect(document.querySelector("[data-testid='start-splash']")).toHaveTextContent("Das Rudel sammelt sich …");
  expect(shouldShowStartSplash()).toBe(false);
  render(<StartSplashGate />);
  act(() => vi.advanceTimersByTime(500));
  expect(document.querySelector("[data-testid='start-splash']")).toBeNull();
  releaseStartSplash();
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.sessionStorage.clear();
  expect(shouldShowStartSplash()).toBe(false);
  window.matchMedia = originalMatchMedia;
});
