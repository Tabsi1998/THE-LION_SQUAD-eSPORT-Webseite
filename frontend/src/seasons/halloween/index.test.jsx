import { render, screen, act, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";

// Halloween (#635, #655, #658, #660–#664): je Seite eine andere, stabile Anordnung; ohne Bewegung ein fertiges
// Netz als SVG ganz im Bild, mit Bewegung das lebende Netz auf dem Canvas; Spinnen, Abseil-Spinne, hängende
// Fledermäuse nur mit Bewegung; Mond mit echter Phase; Laterne mit Gruß, Signal und Pupillen; Friedhof, Katze
// und Kürbisse am Footer; Fledermäuse und Schwaden als Ebenen.

const signals = { recordSignal: vi.fn(() => true) };
vi.mock("../signals", () => signals);

const { Widget, Backdrop, Corners, Footer, StaticWeb, RappelSpider, eyeOffset, pumpkinCounts, pageLayout, skyLayers, season, LOAD_SALT, catTarget } = await import("./index.jsx");

const PATHS = ["/", "/news", "/events", "/tournaments", "/teams", "/about", "/shop", "/faq", "/contact", "/gallery", "/members", "/stream", "/discord", "/sponsors", "/awards", "/rules", "/calendar", "/players"];

function halloween(overrides = {}) {
  return { key: "halloween", effective: "normal", texts: { greeting: "Happy Halloween von THE LION SQUAD" }, data: { night: true }, ...overrides };
}

function mount(node, path = "/") {
  return render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);
}

function fakeContext(calls) {
  return new Proxy({}, {
    get: (_t, name) => {
      if (["fillStyle", "strokeStyle", "lineWidth", "lineCap"].includes(name)) return "";
      if (name === "createRadialGradient") return () => ({ addColorStop: () => calls.push("stop") });
      return () => calls.push(name);
    },
  });
}

let fixture = null;

function mountFixture(html) {
  fixture?.remove();
  fixture = document.createElement("div");
  fixture.innerHTML = html;
  document.body.appendChild(fixture);
  return fixture;
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  fixture?.remove();
  fixture = null;
});

test("Anordnung je Seite: gleich für dieselbe Adresse, anders für eine andere - und nicht nur die Netzgröße", () => {
  const news = pageLayout("/news", "normal");
  expect(pageLayout("/news", "normal")).toEqual(news);
  const events = pageLayout("/events", "normal");
  expect(JSON.stringify(events)).not.toBe(JSON.stringify(news));
  expect(news.web.corner).toMatch(/^t[lr]$/);
  expect(news.web.factor).toBeGreaterThanOrEqual(0.85);
  expect(news.spiders.length).toBe(1);
  expect(news.spiders[0].size).toBeLessThanOrEqual(30);
  expect(news.spiders[0].offset).toBeGreaterThanOrEqual(2);
  expect(news.spiders[0].offset).toBeLessThanOrEqual(9);
  expect(news.hangingBats).toBeGreaterThanOrEqual(1);
  expect(news.flock).toEqual([3, 5]);
  const layouts = PATHS.map((path) => pageLayout(path, "normal"));
  expect(new Set(layouts.map((layout) => layout.web.corner)).size).toBe(2);
  expect(new Set(layouts.map((layout) => layout.spiders[0].offset)).size).toBeGreaterThan(3);
  expect(layouts.every((layout) => layout.rappel)).toBe(true);
  expect(layouts.every((layout) => layout.rappel.first >= 5 && layout.rappel.first <= 12)).toBe(true);
  // Jede Ladung würfelt neu: ein anderes Salz gibt eine andere Anordnung, dasselbe Salz dieselbe.
  expect(JSON.stringify(pageLayout("/news", "normal", "abc"))).not.toBe(JSON.stringify(pageLayout("/news", "normal", "xyz")));
  expect(pageLayout("/news", "normal", "abc")).toEqual(pageLayout("/news", "normal", "abc"));
  expect(layouts.some((layout) => layout.graves.length > 0)).toBe(true);
  expect(layouts.some((layout) => layout.graves.length === 0)).toBe(true);
  expect(layouts.some((layout) => layout.cat)).toBe(true);
  expect(layouts.some((layout) => layout.secondWeb)).toBe(true);
  expect(layouts.some((layout) => layout.web.build)).toBe(true);
  layouts.forEach((layout) => {
    layout.graves.forEach((grave) => {
      expect(grave.x).toBeGreaterThanOrEqual(0.08);
      expect(grave.x).toBeLessThanOrEqual(0.66);
    });
  });
  const subtle = pageLayout("/news", "subtle");
  expect(subtle.spiders).toEqual([]);
  expect(subtle.crawler).toBeNull();
  expect(subtle.rappel).toBeNull();
  expect(subtle.moon).toBeNull();
  expect(subtle.hangingBats).toBe(0);
  expect(subtle.web.build).toBe(false);
  const full = pageLayout("/news", "full");
  expect(full.flock).toEqual([5, 8]);
  expect(full.hangingBats).toBeGreaterThanOrEqual(2);
  expect(full.crawler).not.toBeNull();
  expect(LOAD_SALT.length).toBeGreaterThan(0);
});

test("Signal zählt nur am 31. Oktober ab 18 Uhr", () => {
  expect(pumpkinCounts(new Date(2026, 9, 31, 18, 0))).toBe(true);
  expect(pumpkinCounts(new Date(2026, 9, 31, 17, 59))).toBe(false);
  expect(pumpkinCounts(new Date(2026, 9, 30, 20, 0))).toBe(false);
});

test("Statisches Netz: fertig, ganz im Kasten, links oder rechts", () => {
  const { container } = render(<StaticWeb web={{ corner: "tr", factor: 1, seed: 0.3 }} width={1366} />);
  const svg = container.querySelector("svg");
  expect(svg.getAttribute("class")).toContain("tls-web--tr");
  expect(svg.querySelectorAll("line").length).toBeGreaterThan(150);
  const width = Number(svg.getAttribute("width"));
  svg.querySelectorAll("line").forEach((line) => {
    expect(Number(line.getAttribute("x1"))).toBeLessThanOrEqual(width + 0.5);
    expect(Number(line.getAttribute("x1"))).toBeGreaterThanOrEqual(-0.5);
  });
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

test("Ecken: ohne Bewegung das fertige Netz als SVG, mit Bewegung Spinne am Faden (an der Seite) und Abseil-Spinne; Seitenwechsel wird gemeldet", () => {
  const path = PATHS.find((candidate) => pageLayout(candidate, "normal").secondWeb) || "/news";
  const layout = pageLayout(path, "normal");
  const onPage = vi.fn();
  window.addEventListener("tls:season-page", onPage);
  const subtle = mount(<Corners season={halloween({ effective: "subtle" })} />, path);
  expect(subtle.container.querySelectorAll("[data-testid='halloween-web-static']").length).toBe(pageLayout(path, "normal").secondWeb ? 2 : 1);
  expect(screen.queryByTestId("halloween-spiders")).toBeNull();
  expect(screen.queryByTestId("halloween-rappel")).toBeNull();
  expect(onPage).toHaveBeenCalledTimes(1);
  expect(onPage.mock.calls[0][0].detail.pathname).toBe(path);
  subtle.unmount();
  const normal = mount(<Corners season={halloween({ effective: "normal" })} />, path);
  expect(normal.container.querySelector("[data-testid='halloween-web-static']")).toBeNull();
  const drop = screen.getByTestId(`halloween-spider-${layout.spiders[0].side}`);
  expect(drop.style.getPropertyValue("--spider-offset")).toBe(`${layout.spiders[0].offset}vw`);
  expect(screen.getByTestId("halloween-spiders").parentElement).toBe(document.body);
  // Die Abseil-Spinne wartet erst 10–25 s unsichtbar; ihr Ablauf steht im eigenen Test.
  expect(screen.queryByTestId("halloween-rappel")).toBeNull();
  expect(normal.container.querySelector(".tls-crawler")).toBeNull();
  normal.unmount();
  expect(screen.queryByTestId("halloween-rappel")).toBeNull();
  expect(screen.queryByTestId("halloween-spiders")).toBeNull();
  window.removeEventListener("tls:season-page", onPage);
});

test("Scrollen: der Stand steht als Variable am Dokument (Mond-Parallaxe) und geht beim Abbau wieder weg", () => {
  const root = document.documentElement;
  const view = mount(<Corners season={halloween()} />, "/news");
  expect(root.style.getPropertyValue("--season-scroll")).toBe("0px");
  Object.defineProperty(window, "scrollY", { value: 240, configurable: true });
  fireEvent.scroll(window);
  expect(root.style.getPropertyValue("--season-scroll")).toBe("240px");
  view.unmount();
  expect(root.style.getPropertyValue("--season-scroll")).toBe("");
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
});

test("Abseil-Spinne: seilt sich bis zum Strich ab, lässt los und läuft", async () => {
  mountFixture('<footer><div data-season-line="footer"></div></footer>');
  document.querySelector("[data-season-line]").getBoundingClientRect = () => ({ top: 420, left: 0, width: 800, height: 40, bottom: 460, right: 800 });
  render(<RappelSpider spec={{ side: "left", size: 20, speed: 4000, first: 0, rest: 5 }} active />);
  await act(() => new Promise((resolve) => setTimeout(resolve, 250)));
  const thread = screen.getByTestId("halloween-rappel");
  expect(thread.className).toContain("tls-rappel--left");
  expect(thread.style.height).toBe(`${420 - 80}px`);
  expect(["release", "run"]).toContain(thread.getAttribute("data-phase"));
  await act(() => new Promise((resolve) => setTimeout(resolve, 800)));
  const running = screen.getByTestId("halloween-rappel");
  expect(running.getAttribute("data-phase")).toBe("run");
  // Der Faden schwingt schon, sobald sie losgelassen hat - die Läuferin steht daneben, nicht im schwingenden Faden.
  expect(running.className).toContain("tls-rappel--sway");
  const runner = screen.getByTestId("halloween-rappel-runner");
  expect(running.contains(runner)).toBe(false);
  expect(runner.className).toContain("tls-rappel-runner--left");
  expect(runner.style.top).toBe(running.style.height);
  expect(runner.querySelector(".tls-rappel__runner")).not.toBeNull();
  render(<RappelSpider spec={null} active />);
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

test("Hintergrund: Mond mit echter Phase nur ab normal; Footer mit Kürbissen, Friedhof auf dem Strich und je nach Seite Katze", () => {
  const path = PATHS.find((candidate) => pageLayout(candidate, "normal").moon);
  const subtle = mount(<Backdrop season={halloween({ effective: "subtle" })} />, path);
  expect(subtle.container.querySelector(".tls-moon")).toBeNull();
  subtle.unmount();
  // Der Mond steht am Himmel über Innsbruck: am 26.10.2026 um 23:30 UTC (Vollmond) hoch im Süden, mittags unter dem Horizont.
  const night = mount(<Backdrop season={halloween()} now={() => new Date("2026-10-26T23:30:00Z")} />, path);
  const holder = screen.getByTestId("season-moon");
  expect(holder.getAttribute("data-visible")).toBe("1");
  expect(Number(holder.getAttribute("data-altitude"))).toBeGreaterThan(40);
  const moon = night.container.querySelector(".tls-moon");
  expect(moon).not.toBeNull();
  expect(Number(moon.getAttribute("data-phase"))).toBeGreaterThanOrEqual(0);
  expect(parseFloat(holder.style.top)).toBeLessThan(window.innerHeight * 0.5);
  night.unmount();
  const day = mount(<Backdrop season={halloween()} now={() => new Date("2026-10-26T11:00:00Z")} />, path);
  expect(screen.getByTestId("season-moon").getAttribute("data-visible")).toBe("0");
  expect(day.container.querySelector(".tls-moon")).toBeNull();
  day.unmount();
  const footerPath = PATHS.find((candidate) => pageLayout(candidate, "normal").cat && pageLayout(candidate, "normal").graves.length > 0);
  const layout = pageLayout(footerPath, "normal");
  mountFixture('<footer style="position:relative"><div data-season-line="footer"></div></footer>');
  Object.defineProperty(document.querySelector("[data-season-line]"), "offsetTop", { value: 250, configurable: true });
  const footer = mount(<Footer season={halloween()} />, footerPath);
  const pumpkins = footer.container.querySelectorAll(".tls-footer-pumpkins .tls-pumpkin");
  expect(pumpkins.length).toBeGreaterThanOrEqual(1);
  expect(Number(pumpkins[0].getAttribute("width"))).toBeGreaterThanOrEqual(46);
  // Jeder Kürbis grüßt beim Klick wie die Laterne; heute (nicht der 31.10.) zählt der Klick nicht.
  const pumpkinButtons = screen.getAllByTestId("halloween-footer-pumpkin");
  expect(pumpkinButtons.length).toBe(layout.footerPumpkins.length);
  fireEvent.click(pumpkinButtons[pumpkinButtons.length - 1]);
  expect(screen.getByTestId("halloween-pumpkin-note")).toHaveTextContent("Happy Halloween von THE LION SQUAD");
  expect(pumpkinButtons[pumpkinButtons.length - 1].className).toContain("tls-pumpkin-button--open");
  expect(signals.recordSignal).not.toHaveBeenCalled();
  const cat = screen.getByTestId("halloween-cat");
  expect(cat.style.top).toBe("250px");
  expect(cat.style.left).toBe(`${layout.cat.x}px`);
  expect(footer.container.querySelector(".tls-cat__tail")).not.toBeNull();
  // Klick: die Katze trottet zu einer anderen Stelle des Strichs und sitzt danach wieder - mit vier Beinen samt Pfoten.
  fireEvent.click(cat);
  expect(cat.getAttribute("data-walking")).toBe("1");
  expect(footer.container.querySelector(".tls-cat-walking")).not.toBeNull();
  expect(footer.container.querySelectorAll(".tls-cat-walking__leg").length).toBe(4);
  expect(footer.container.querySelectorAll(".tls-cat-walking__paw").length).toBe(4);
  expect(footer.container.querySelectorAll(".tls-cat-walking__leg--b").length).toBe(2);
  expect(cat.style.left).not.toBe(`${layout.cat.x}px`);
  expect(Math.abs(parseInt(cat.style.left, 10) - layout.cat.x)).toBeGreaterThanOrEqual(120);
  expect(screen.getAllByTestId("halloween-grave").length).toBe(layout.graves.length);
  footer.unmount();
  const quiet = mount(<Footer season={halloween({ effective: "subtle" })} />, footerPath);
  expect(screen.queryByTestId("halloween-graveyard")).toBeNull();
  quiet.unmount();
});

test("Katze: das Ziel liegt mindestens 120 px entfernt und nie über den Kürbissen rechts", () => {
  const target = catTarget(40, 1200, () => 0.5);
  expect(Math.abs(target - 40)).toBeGreaterThanOrEqual(120);
  expect(target).toBeLessThanOrEqual(1200 - 220);
  expect(catTarget(900, 1200, () => 0.99)).toBe(24);
  expect(catTarget(24, 1200, () => 0.01)).toBeGreaterThanOrEqual(144);
});

test("Himmel: lebendes Netz, Fledermäuse und Schwaden als Ebenen; nichts bei Bewegung reduzieren oder dezent", () => {
  expect(skyLayers({ season: halloween(), budget: 60, reducedMotion: true })).toEqual([]);
  expect(skyLayers({ season: halloween({ effective: "subtle" }), budget: 60, reducedMotion: false })).toEqual([]);
  const layers = skyLayers({ season: halloween(), budget: 60, reducedMotion: false });
  const keys = layers.map((layer) => layer.key);
  expect(keys[0]).toMatch(/^halloween-web-t[lr]$/);
  expect(keys.slice(-2)).toEqual(["halloween-bats", "halloween-wisps"]);
  const webCalls = [];
  layers[0].draw(fakeContext(webCalls), 1 / 60, { width: 1000, height: 600 });
  expect(webCalls.filter((name) => name === "stroke").length).toBeGreaterThanOrEqual(1);
  const bats = layers.find((layer) => layer.key === "halloween-bats");
  const calls = [];
  const ctx = fakeContext(calls);
  bats.draw(ctx, 1, { width: 1000, height: 600 });
  expect(calls.length).toBe(0);
  bats.draw(ctx, 5, { width: 1000, height: 600 });
  bats.draw(ctx, 1, { width: 1000, height: 600 });
  expect(calls.filter((name) => name === "fill").length).toBeGreaterThan(0);
  const wisps = layers.find((layer) => layer.key === "halloween-wisps");
  const wispCalls = [];
  wisps.draw(fakeContext(wispCalls), 1, { width: 1000, height: 600 });
  expect(wispCalls.length).toBe(0);
  wisps.draw(fakeContext(wispCalls), 400, { width: 1000, height: 600 });
  expect(wispCalls.filter((name) => name === "fill").length).toBeGreaterThan(0);
  layers.forEach((layer) => layer.dispose?.());
  expect(season.key).toBe("halloween");
});

test("Himmel: ein Seitenwechsel lässt den Schwarm früher starten", () => {
  const layers = skyLayers({ season: halloween(), budget: 60, reducedMotion: false });
  const bats = layers.find((layer) => layer.key === "halloween-bats");
  window.dispatchEvent(new CustomEvent("tls:season-page", { detail: { pathname: "/events" } }));
  const calls = [];
  const ctx = fakeContext(calls);
  bats.draw(ctx, 1.6, { width: 1000, height: 600 });
  bats.draw(ctx, 0.5, { width: 1000, height: 600 });
  expect(calls.filter((name) => name === "fill").length).toBeGreaterThan(0);
  layers.forEach((layer) => layer.dispose?.());
});
