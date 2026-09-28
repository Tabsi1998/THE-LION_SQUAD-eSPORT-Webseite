import { render, screen, act, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { webSegments } from "./art";

// Halloween (#635, #655, #658): je Seite eine andere, aber stabile Anordnung; das Netz wird sichtbar gesponnen;
// Spinnen nur mit Bewegung, eine seilt sich in der Seite ab; Scrollen schwingt das Netz, der Seitenwechsel
// startet die Fledermäuse; Mond mit echter Phase; Laterne mit Gruß, Signal und Pupillen, die dem Zeiger
// folgen; Blätter und Fledermäuse als Ebenen, nichts davon bei „Bewegung reduzieren“.

const signals = { recordSignal: vi.fn(() => true) };
vi.mock("../signals", () => signals);

const { Widget, Backdrop, Corners, Footer, BuildingWeb, RappellingSpider, eyeOffset, pumpkinCounts, pageLayout, skyLayers, season } = await import("./index.jsx");

const PATHS = ["/", "/news", "/events", "/tournaments", "/teams", "/about", "/shop", "/faq", "/contact", "/gallery", "/members", "/stream", "/discord", "/sponsors", "/awards", "/rules"];

function halloween(overrides = {}) {
  return { key: "halloween", effective: "normal", texts: { greeting: "Happy Halloween von THE LION SQUAD" }, data: { night: true }, ...overrides };
}

function mount(node, path = "/") {
  return render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);
}

function fakeContext(calls) {
  return new Proxy({}, { get: (_t, name) => (["fillStyle", "strokeStyle", "lineWidth"].includes(name) ? "" : () => calls.push(name)) });
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

test("Anordnung je Seite: gleich für dieselbe Adresse, anders für eine andere, Stärke passend", () => {
  const news = pageLayout("/news", "normal");
  expect(pageLayout("/news", "normal")).toEqual(news);
  expect(JSON.stringify(pageLayout("/events", "normal"))).not.toBe(JSON.stringify(news));
  expect(news.webs.length).toBeGreaterThanOrEqual(1);
  expect(news.spiders.length).toBe(1);
  expect(news.spiders[0].size).toBeLessThanOrEqual(30);
  expect(news.footerPumpkins.length).toBeGreaterThanOrEqual(1);
  expect(news.leaves).toBeGreaterThanOrEqual(3);
  expect(news.flock).toEqual([3, 5]);
  const subtle = pageLayout("/news", "subtle");
  expect(subtle.spiders).toEqual([]);
  expect(subtle.crawler).toBeNull();
  expect(subtle.rappel).toBeNull();
  expect(subtle.moon).toBeNull();
  expect(subtle.leaves).toBe(0);
  expect(subtle.webs.every((web) => !web.build)).toBe(true);
  const full = pageLayout("/news", "full");
  expect(full.flock).toEqual([5, 8]);
  expect(full.leaves).toBeGreaterThanOrEqual(6);
  expect(full.crawler).not.toBeNull();
  expect(PATHS.some((path) => pageLayout(path, "normal").rappel)).toBe(true);
  expect(PATHS.some((path) => pageLayout(path, "normal").cat)).toBe(true);
});

test("Signal zählt nur am 31. Oktober ab 18 Uhr", () => {
  expect(pumpkinCounts(new Date(2026, 9, 31, 18, 0))).toBe(true);
  expect(pumpkinCounts(new Date(2026, 9, 31, 17, 59))).toBe(false);
  expect(pumpkinCounts(new Date(2026, 9, 30, 20, 0))).toBe(false);
});

test("Netzbau: die Spinne sitzt am Fadenende und spinnt Schritt für Schritt, bis das Netz fertig ist", async () => {
  vi.useFakeTimers();
  const web = { corner: "tl", scale: 1, seed: 0.3, build: true, stepMs: 100 };
  const { container } = render(<BuildingWeb web={web} corner="tl" reducedMotion={false} />);
  expect(screen.getByTestId("halloween-web-building")).toBeInTheDocument();
  const spinner = container.querySelector(".tls-web__spinner");
  expect(spinner).not.toBeNull();
  const start = spinner.style.left;
  await act(async () => {
    vi.advanceTimersByTime(450);
  });
  expect(container.querySelector(".tls-web__spinner").style.left).not.toBe(start);
  const steps = webSegments(0.3).length;
  await act(async () => {
    vi.advanceTimersByTime(steps * 100 + 100);
  });
  expect(screen.getByTestId("halloween-web")).toBeInTheDocument();
  expect(container.querySelector(".tls-spider--spinning")).toBeNull();
  expect(container.querySelectorAll(".tls-dew").length).toBeGreaterThan(0);
});

test("Netzbau bei Bewegung reduzieren: das Netz steht sofort fertig da", () => {
  const web = { corner: "tr", scale: 0.7, seed: 0.5, build: true, stepMs: 100 };
  render(<BuildingWeb web={web} corner="tr" reducedMotion />);
  expect(screen.getByTestId("halloween-web")).toBeInTheDocument();
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

test("Pupillen: folgen dem Zeiger um höchstens gut zwei Pixel, nicht bei dezent", async () => {
  expect(eyeOffset({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  const right = eyeOffset({ x: 600, y: 0 }, { x: 0, y: 0 });
  expect(right.x).toBeCloseTo(2.2, 1);
  expect(right.y).toBeCloseTo(0);
  const near = eyeOffset({ x: 110, y: 0 }, { x: 0, y: 0 });
  expect(near.x).toBeCloseTo(1.1, 1);
  const normal = mount(<Widget season={halloween()} />);
  fireEvent.mouseMove(window, { clientX: 500, clientY: 10 });
  await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
  expect(screen.getByTestId("halloween-lantern").style.getPropertyValue("--eye-x")).toBe("2.20px");
  normal.unmount();
  mount(<Widget season={halloween({ effective: "subtle" })} />);
  fireEvent.mouseMove(window, { clientX: 500, clientY: 10 });
  await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
  expect(screen.getByTestId("halloween-lantern").style.getPropertyValue("--eye-x")).toBe("");
});

test("Ecken: Netz immer, Spinnen und Abseil-Spinne nur mit Bewegung; Seitenwechsel wird gemeldet", () => {
  const path = PATHS.find((candidate) => pageLayout(candidate, "normal").rappel);
  const onPage = vi.fn();
  window.addEventListener("tls:season-page", onPage);
  const subtle = mount(<Corners season={halloween({ effective: "subtle" })} />, path);
  expect(subtle.container.querySelectorAll(".tls-cobweb").length).toBeGreaterThanOrEqual(1);
  expect(subtle.container.querySelector(".tls-spider")).toBeNull();
  expect(screen.queryByTestId("halloween-rappel")).toBeNull();
  expect(onPage).toHaveBeenCalledTimes(1);
  expect(onPage.mock.calls[0][0].detail.pathname).toBe(path);
  subtle.unmount();
  const normal = mount(<Corners season={halloween({ effective: "normal" })} />, path);
  expect(normal.container.querySelectorAll(".tls-spider--drop").length).toBe(1);
  expect(screen.getByTestId("halloween-rappel").style.height).toBe("90px");
  expect(normal.container.querySelector(".tls-crawler")).toBeNull();
  normal.unmount();
  expect(screen.queryByTestId("halloween-rappel")).toBeNull();
  window.removeEventListener("tls:season-page", onPage);
});

test("Scrollen: die Seite merkt sich den Stand und schwingt das Netz kurz nach", async () => {
  const root = document.documentElement;
  const view = mount(<Corners season={halloween()} />, "/news");
  expect(root.style.getPropertyValue("--season-scroll")).toBe("0px");
  Object.defineProperty(window, "scrollY", { value: 240, configurable: true });
  fireEvent.scroll(window);
  expect(root.style.getPropertyValue("--season-scroll")).toBe("240px");
  await act(() => new Promise((resolve) => setTimeout(resolve, 40)));
  expect(root.style.getPropertyValue("--season-sway")).not.toBe("");
  view.unmount();
  expect(root.style.getPropertyValue("--season-scroll")).toBe("");
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
});

test("Abseil-Spinne: seilt sich in der Seite ab, rastet unten und wartet dann", async () => {
  render(<RappellingSpider spec={{ side: "left", size: 20, speed: 4000, first: 0, rest: 5 }} active />);
  const thread = screen.getByTestId("halloween-rappel");
  expect(thread.className).toContain("tls-rappel--left");
  await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
  expect(thread.style.height).toBe("300px");
  render(<RappellingSpider spec={null} active />);
  expect(screen.getAllByTestId("halloween-rappel").length).toBe(1);
});

test("Krabbler kommt nach der Wartezeit quer über den Bildschirm und geht wieder", async () => {
  vi.useFakeTimers();
  const path = PATHS.find((candidate) => pageLayout(candidate, "normal").crawler);
  const layout = pageLayout(path, "normal");
  mount(<Corners season={halloween({ effective: "normal" })} />, path);
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

test("Hintergrund: Mond mit echter Phase nur ab normal; Footer mit Kürbissen und je nach Seite einer Katze", () => {
  const path = PATHS.find((candidate) => pageLayout(candidate, "normal").moon);
  const subtle = mount(<Backdrop season={halloween({ effective: "subtle" })} />, path);
  expect(subtle.container.querySelector(".tls-moon")).toBeNull();
  subtle.unmount();
  const normal = mount(<Backdrop season={halloween()} />, path);
  const moon = normal.container.querySelector(".tls-moon");
  expect(moon).not.toBeNull();
  expect(Number(moon.getAttribute("data-phase"))).toBeGreaterThanOrEqual(0);
  normal.unmount();
  const catPath = PATHS.find((candidate) => pageLayout(candidate, "normal").cat);
  const footer = mount(<Footer season={halloween()} />, catPath);
  const pumpkins = footer.container.querySelectorAll(".tls-footer-pumpkins > .tls-pumpkin");
  expect(pumpkins.length).toBeGreaterThanOrEqual(1);
  expect(Number(pumpkins[0].getAttribute("width"))).toBeGreaterThanOrEqual(46);
  expect(screen.getByTestId("halloween-cat")).toBeInTheDocument();
});

test("Himmel: Blätter und Fledermäuse als Ebenen, nichts bei Bewegung reduzieren oder dezent", () => {
  expect(skyLayers({ season: halloween(), budget: 60, reducedMotion: true })).toEqual([]);
  expect(skyLayers({ season: halloween({ effective: "subtle" }), budget: 60, reducedMotion: false })).toEqual([]);
  const layers = skyLayers({ season: halloween(), budget: 60, reducedMotion: false });
  expect(layers.map((layer) => layer.key)).toEqual(["halloween-leaves", "halloween-bats"]);
  const leafCalls = [];
  layers[0].draw(fakeContext(leafCalls), 0.5, { width: 1000, height: 600 });
  expect(leafCalls.filter((name) => name === "fill").length).toBe(pageLayout("/", "normal").leaves);
  const calls = [];
  const ctx = fakeContext(calls);
  layers[1].draw(ctx, 1, { width: 1000, height: 600 });
  expect(calls.length).toBe(0);
  // Nach sechs Sekunden startet der Schwarm; spätestens eine Sekunde später ist die erste Fledermaus zu sehen.
  layers[1].draw(ctx, 5, { width: 1000, height: 600 });
  layers[1].draw(ctx, 1, { width: 1000, height: 600 });
  expect(calls.filter((name) => name === "fill").length).toBeGreaterThan(0);
  layers[1].dispose();
  expect(season.key).toBe("halloween");
});

test("Himmel: ein Seitenwechsel lässt den Schwarm früher starten, aber nur einmal je Minute", () => {
  const [, bats] = skyLayers({ season: halloween(), budget: 60, reducedMotion: false });
  window.dispatchEvent(new CustomEvent("tls:season-page", { detail: { pathname: "/events" } }));
  const calls = [];
  const ctx = fakeContext(calls);
  bats.draw(ctx, 1.6, { width: 1000, height: 600 });
  bats.draw(ctx, 0.5, { width: 1000, height: 600 });
  expect(calls.filter((name) => name === "fill").length).toBeGreaterThan(0);
  bats.dispose();
});
