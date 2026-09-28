import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Halloween (#635): Laterne klickbar mit Gruß, Signal nur am 31.10. abends, Nebel nur bei „voll“,
// Spinne nicht bei „dezent“, Fledermaus-Ebene nicht bei „Bewegung reduzieren“.

const signals = { recordSignal: vi.fn(() => true) };
vi.mock("../signals", () => signals);

const { Widget, Backdrop, Corners, Footer, pumpkinCounts, skyLayers, season } = await import("./index.jsx");

function halloween(overrides = {}) {
  return { key: "halloween", effective: "normal", texts: { greeting: "Happy Halloween von THE LION SQUAD" }, data: { night: true }, ...overrides };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

test("Signal zählt nur am 31. Oktober ab 18 Uhr", () => {
  expect(pumpkinCounts(new Date(2026, 9, 31, 18, 0))).toBe(true);
  expect(pumpkinCounts(new Date(2026, 9, 31, 17, 59))).toBe(false);
  expect(pumpkinCounts(new Date(2026, 9, 30, 20, 0))).toBe(false);
});

test("Laterne öffnet sich beim Klick, zeigt den Gruß und meldet abends am 31.10. das Signal", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 9, 31, 20, 0));
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<Widget season={halloween()} />);
  const lantern = screen.getByTestId("halloween-lantern");
  expect(lantern).toHaveAttribute("aria-label", "Happy Halloween von THE LION SQUAD");
  await user.click(lantern);
  expect(lantern.className).toContain("tls-lantern--open");
  expect(screen.getByTestId("halloween-note")).toHaveTextContent("Happy Halloween von THE LION SQUAD");
  expect(signals.recordSignal).toHaveBeenCalledWith("halloween_pumpkin");
  await act(async () => {
    vi.advanceTimersByTime(4100);
  });
  expect(screen.queryByTestId("halloween-note")).toBeNull();
});

test("tagsüber vor dem 31. zählt der Klick nicht", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 9, 27, 12, 0));
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<Widget season={halloween()} />);
  await user.click(screen.getByTestId("halloween-lantern"));
  expect(signals.recordSignal).not.toHaveBeenCalled();
});

test("Nebel nur bei voll, dichter in der Nacht; Spinne nicht bei dezent; zwei Kürbisse am Footer", () => {
  const { rerender } = render(<Backdrop season={halloween({ effective: "normal" })} />);
  expect(screen.queryByTestId("halloween-fog")).toBeNull();
  rerender(<Backdrop season={halloween({ effective: "full", data: { night: true } })} />);
  expect(screen.getByTestId("halloween-fog").className).toContain("tls-fog--dense");
  rerender(<Backdrop season={halloween({ effective: "full", data: { night: false } })} />);
  expect(screen.getByTestId("halloween-fog").className).not.toContain("tls-fog--dense");
  const corners = render(<Corners season={halloween({ effective: "subtle" })} />);
  expect(corners.container.querySelectorAll(".tls-cobweb").length).toBe(2);
  expect(corners.container.querySelector(".tls-spider")).toBeNull();
  corners.rerender(<Corners season={halloween({ effective: "normal" })} />);
  expect(corners.container.querySelector(".tls-spider")).not.toBeNull();
  const footer = render(<Footer season={halloween()} />);
  expect(footer.container.querySelectorAll(".tls-pumpkin").length).toBe(2);
});

test("Fledermaus-Ebene: keine bei Bewegung reduzieren, sonst eine, die nach der Wartezeit zeichnet", () => {
  expect(skyLayers({ season: halloween(), budget: 60, reducedMotion: true })).toEqual([]);
  const [layer] = skyLayers({ season: halloween(), budget: 60, reducedMotion: false });
  expect(layer.key).toBe("halloween-bats");
  const calls = [];
  const ctx = new Proxy({}, { get: (_t, name) => (name === "fillStyle" ? "" : () => calls.push(name)) });
  layer.draw(ctx, 1, { width: 1000, height: 600 });
  expect(calls.length).toBe(0);
  layer.draw(ctx, 8, { width: 1000, height: 600 });
  layer.draw(ctx, 1, { width: 1000, height: 600 });
  expect(calls.filter((name) => name === "fill").length).toBeGreaterThan(0);
  layer.dispose();
  expect(season.key).toBe("halloween");
  expect(season.accent).toContain("rgba");
});
