import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";

// Halloween (#635, #655): je Seite eine andere, aber stabile Anordnung; Spinnweben groß, Spinnen und
// hängende Fledermäuse nur mit Bewegung; Ränder, Mond und Friedhof am Breitbild; Nebel ab normal; Laterne
// mit Gruß und Signal; die Fledermaus-Ebene nicht bei „Bewegung reduzieren“.

const signals = { recordSignal: vi.fn(() => true) };
vi.mock("../signals", () => signals);

const { Widget, Backdrop, Corners, Footer, pumpkinCounts, pageLayout, skyLayers, season } = await import("./index.jsx");

function halloween(overrides = {}) {
  return { key: "halloween", effective: "normal", texts: { greeting: "Happy Halloween von THE LION SQUAD" }, data: { night: true }, ...overrides };
}

function mount(node, path = "/") {
  return render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

test("Anordnung je Seite: gleich für dieselbe Adresse, anders für eine andere, mit Stärke passend", () => {
  const news = pageLayout("/news", "normal");
  expect(pageLayout("/news", "normal")).toEqual(news);
  const events = pageLayout("/events", "normal");
  expect(JSON.stringify(events)).not.toBe(JSON.stringify(news));
  expect(news.webs.length).toBeGreaterThanOrEqual(2);
  expect(news.spiders.length).toBeGreaterThanOrEqual(1);
  expect(news.footerPumpkins.length).toBeGreaterThanOrEqual(2);
  expect(news.fog).toBe("light");
  const subtle = pageLayout("/news", "subtle");
  expect(subtle.spiders).toEqual([]);
  expect(subtle.hangingBats).toEqual([]);
  expect(subtle.crawler).toBeNull();
  expect(subtle.fog).toBe("none");
  const full = pageLayout("/news", "full");
  expect(full.fog).toBe("dense");
  expect(full.spiders.length).toBe(2);
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
  mount(<Widget season={halloween()} />);
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

test("Ecken: Spinnweben immer, Spinnen und hängende Fledermäuse nur mit Bewegung, Ränder mit Laternen und Friedhof", () => {
  const subtle = mount(<Corners season={halloween({ effective: "subtle" })} />, "/tournaments");
  expect(subtle.container.querySelectorAll(".tls-cobweb").length).toBeGreaterThanOrEqual(2);
  expect(subtle.container.querySelector(".tls-spider")).toBeNull();
  expect(subtle.container.querySelector(".tls-hanging-bat")).toBeNull();
  expect(screen.queryByTestId("halloween-rail-left")).toBeNull();
  subtle.unmount();
  const normal = mount(<Corners season={halloween({ effective: "normal" })} />, "/tournaments");
  expect(normal.container.querySelectorAll(".tls-spider").length).toBeGreaterThanOrEqual(1);
  expect(normal.container.querySelectorAll(".tls-hanging-bat").length).toBeGreaterThanOrEqual(1);
  expect(screen.getByTestId("halloween-rail-left")).toBeInTheDocument();
  expect(screen.getByTestId("halloween-rail-right")).toBeInTheDocument();
  expect(normal.container.querySelectorAll(".tls-string-lantern").length).toBeGreaterThanOrEqual(6);
  expect(normal.container.querySelector(".tls-crawler")).toBeNull();
});

test("Krabbler kommt nach der Wartezeit quer über den Bildschirm und geht wieder", async () => {
  vi.useFakeTimers();
  const layout = pageLayout("/news", "normal");
  mount(<Corners season={halloween({ effective: "normal" })} />, "/news");
  expect(screen.queryByTestId("halloween-crawler")).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(layout.crawler.first * 1000 + 100);
  });
  expect(screen.getByTestId("halloween-crawler")).toBeInTheDocument();
  await act(async () => {
    vi.advanceTimersByTime((layout.crawler.duration || 16) * 1000 + 100);
  });
  expect(screen.queryByTestId("halloween-crawler")).toBeNull();
});

test("Hintergrund: Nebel ab normal, dichter bei voll oder nachts, Mond nicht bei dezent; Footer mit großen Kürbissen", () => {
  const subtle = mount(<Backdrop season={halloween({ effective: "subtle" })} />, "/");
  expect(screen.queryByTestId("halloween-fog")).toBeNull();
  expect(subtle.container.querySelector(".tls-moon")).toBeNull();
  subtle.unmount();
  const day = mount(<Backdrop season={halloween({ effective: "normal", data: { night: false } })} />, "/");
  expect(screen.getByTestId("halloween-fog").className).not.toContain("tls-fog--dense");
  expect(day.container.querySelector(".tls-vignette")).toBeNull();
  day.unmount();
  const full = mount(<Backdrop season={halloween({ effective: "full", data: { night: false } })} />, "/");
  expect(screen.getByTestId("halloween-fog").className).toContain("tls-fog--dense");
  expect(full.container.querySelector(".tls-vignette")).not.toBeNull();
  full.unmount();
  const footer = mount(<Footer season={halloween()} />, "/");
  const pumpkins = footer.container.querySelectorAll(".tls-footer-pumpkins > .tls-pumpkin");
  expect(pumpkins.length).toBeGreaterThanOrEqual(2);
  expect(Number(pumpkins[0].getAttribute("width"))).toBeGreaterThanOrEqual(60);
});

test("Fledermaus-Ebene: keine bei Bewegung reduzieren oder dezent, sonst eine, die nach drei Sekunden zeichnet", () => {
  expect(skyLayers({ season: halloween(), budget: 60, reducedMotion: true })).toEqual([]);
  expect(skyLayers({ season: halloween({ effective: "subtle" }), budget: 60, reducedMotion: false })).toEqual([]);
  const [layer] = skyLayers({ season: halloween(), budget: 60, reducedMotion: false });
  expect(layer.key).toBe("halloween-bats");
  const calls = [];
  const ctx = new Proxy({}, { get: (_t, name) => (["fillStyle", "strokeStyle", "lineWidth"].includes(name) ? "" : () => calls.push(name)) });
  layer.draw(ctx, 1, { width: 1000, height: 600 });
  expect(calls.length).toBe(0);
  // Nach drei Sekunden startet der Schwarm; spätestens eine Sekunde später ist die erste Fledermaus zu sehen.
  layer.draw(ctx, 2, { width: 1000, height: 600 });
  layer.draw(ctx, 1, { width: 1000, height: 600 });
  expect(calls.filter((name) => name === "fill").length).toBeGreaterThan(0);
  layer.dispose();
  expect(season.key).toBe("halloween");
});
