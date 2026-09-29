import { act, render, screen } from "@testing-library/react";
import { DEFAULT_LOCATION, MoonInSky } from "./MoonInSky";

// Der Mond am Seitenhimmel (#681): Stand aus Ort und Zeit, sichtbar nur über dem Horizont, jede Minute neu, nach dem
// ersten Bild mit weichem Übergang; ohne Ort rechnet er mit Innsbruck.

const NIGHT = new Date("2026-10-26T23:30:00Z");
const NOON = new Date("2026-10-26T11:00:00Z");

afterEach(() => {
  vi.useRealTimers();
});

test("über dem Horizont wird gezeichnet, darunter nur der leere Halter - mit Stand und Lage", () => {
  const { unmount } = render(<MoonInSky location={{ lat: 47.27, lon: 11.4 }} now={() => NIGHT} viewport={{ width: 1000, height: 800 }} render={() => <svg data-testid="drawn-moon" />} />);
  const holder = screen.getByTestId("season-moon");
  expect(holder.getAttribute("data-visible")).toBe("1");
  expect(screen.getByTestId("drawn-moon")).toBeInTheDocument();
  expect(Number(holder.getAttribute("data-altitude"))).toBeGreaterThan(40);
  expect(Number(holder.getAttribute("data-azimuth"))).toBeGreaterThan(150);
  expect(parseFloat(holder.style.top)).toBeLessThan(400);
  expect(parseFloat(holder.style.left)).toBeGreaterThan(300);
  expect(parseFloat(holder.style.left)).toBeLessThan(700);
  expect(holder.style.getPropertyValue("--moon-scale")).toBe("1.000");
  unmount();
  render(<MoonInSky location={{ lat: 47.27, lon: 11.4 }} now={() => NOON} viewport={{ width: 1000, height: 800 }} render={() => <svg data-testid="drawn-moon" />} />);
  expect(screen.getByTestId("season-moon").getAttribute("data-visible")).toBe("0");
  expect(screen.queryByTestId("drawn-moon")).toBeNull();
});

test("ohne Ort gilt Innsbruck; ein kaputter Ort ebenso", () => {
  expect(DEFAULT_LOCATION.name).toBe("Innsbruck");
  const { unmount } = render(<MoonInSky location={null} now={() => NIGHT} viewport={{ width: 1000, height: 800 }} render={() => <b>m</b>} />);
  const withDefault = screen.getByTestId("season-moon").getAttribute("data-altitude");
  unmount();
  render(<MoonInSky location={{ lat: "kaputt", lon: null }} now={() => NIGHT} viewport={{ width: 1000, height: 800 }} render={() => <b>m</b>} />);
  expect(screen.getByTestId("season-moon").getAttribute("data-altitude")).toBe(withDefault);
});

test("jede Minute neu: nach dem Takt steht der Mond woanders; der Übergang kommt erst nach dem ersten Bild", async () => {
  vi.useFakeTimers();
  let at = new Date("2026-10-26T19:00:00Z");
  render(<MoonInSky location={{ lat: 47.27, lon: 11.4 }} now={() => at} viewport={{ width: 1000, height: 800 }} tick={1000} render={() => <b>m</b>} />);
  const holder = screen.getByTestId("season-moon");
  expect(holder.className).not.toContain("settled");
  const before = { left: holder.style.left, azimuth: holder.getAttribute("data-azimuth") };
  await act(async () => {
    vi.advanceTimersByTime(150);
  });
  expect(holder.className).toContain("tls-moon-sky--settled");
  at = new Date("2026-10-26T21:00:00Z");
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  expect(Number(holder.getAttribute("data-azimuth"))).toBeGreaterThan(Number(before.azimuth));
  expect(holder.style.left).not.toBe(before.left);
});
