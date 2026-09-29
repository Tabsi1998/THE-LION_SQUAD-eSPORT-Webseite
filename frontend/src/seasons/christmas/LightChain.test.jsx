import { act, render, screen } from "@testing-library/react";
import { LightChain, bandGaps } from "./LightChain";
import { BAND_HEIGHT } from "./lights";

// Lichterkette (X1): unter der klebenden Kopfzeile am Fenster, in der Fußzeile auf der Seite; Logo im Band wird zur
// Lücke ohne Lämpchen; unter 768 px keine Kette; ohne Fußzeilen-Erlaubnis nur die Kopfzeile; beim Verlassen weg.

function box(element, rect) {
  element.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top, x: rect.left, y: rect.top });
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
  fixture?.remove();
  fixture = null;
});

function page() {
  mountFixture(`<header id="head" style="position: sticky"><a id="logo-link" href="/"><img id="logo" src="/l.png" alt="Logo"></a><nav><a id="n1" href="/news">News</a></nav></header><main></main><footer id="foot">Impressum</footer>`);
  box(document.getElementById("head"), { left: 0, right: 1200, top: 0, bottom: 80 });
  box(document.getElementById("logo-link"), { left: 32, right: 232, top: 12, bottom: 70 });
  box(document.getElementById("logo"), { left: 32, right: 232, top: 12, bottom: 70 });
  box(document.getElementById("n1"), { left: 400, right: 460, top: 20, bottom: 60 });
  box(document.getElementById("foot"), { left: 0, right: 1200, top: 1500, bottom: 1800 });
}

test("Ketten an Kopfzeile (Fenster) und Fußzeile (Seite), Logo als Lücke, Lämpchen einzeln; beim Verlassen weg", async () => {
  vi.useFakeTimers();
  page();
  const { unmount } = render(<LightChain salt="2026" footer width={1200} />);
  expect(screen.queryAllByTestId("christmas-lights")).toHaveLength(0);
  await act(async () => {
    vi.advanceTimersByTime(350);
  });
  const chains = screen.getAllByTestId("christmas-lights");
  expect(chains.map((chain) => chain.getAttribute("data-anchor"))).toEqual(["header", "footer"]);
  expect(chains[0].style.position).toBe("fixed");
  expect(chains[0].style.top).toBe(`${80 - BAND_HEIGHT - 1}px`);
  expect(chains[0].getAttribute("data-gaps")).toBe("1");
  expect(chains[1].style.position).toBe("absolute");
  expect(chains[1].style.top).toBe("1510px");
  expect(chains[1].getAttribute("data-gaps")).toBe("0");
  const bulbs = screen.getAllByTestId("christmas-bulb");
  expect(bulbs.length).toBeGreaterThan(20);
  expect(new Set(bulbs.map((bulb) => bulb.style.getPropertyValue("--glow-dur"))).size).toBeGreaterThan(5);
  expect(bulbs.some((bulb) => bulb.className.baseVal.includes("flicker"))).toBe(true);
  // Kein Lämpchen der Kopfzeile im Bereich des Logos (32–232 plus Rand).
  const headerBulbs = Array.from(chains[0].querySelectorAll("[data-testid='christmas-bulb'] .tls-lights__bulbBody")).map((body) => Number(body.getAttribute("cx")));
  expect(headerBulbs.length).toBeGreaterThan(10);
  expect(headerBulbs.every((x) => x < 26 || x > 238)).toBe(true);
  unmount();
  expect(screen.queryAllByTestId("christmas-lights")).toHaveLength(0);
});

test("unter 768 px keine Kette; ohne Fußzeile nur die Kopfzeile; Lücken aus dem Band", async () => {
  vi.useFakeTimers();
  page();
  const narrow = render(<LightChain salt="2026" footer width={600} />);
  await act(async () => {
    vi.advanceTimersByTime(3500);
  });
  expect(screen.queryAllByTestId("christmas-lights")).toHaveLength(0);
  narrow.unmount();
  render(<LightChain salt="2026" footer={false} width={1200} />);
  await act(async () => {
    vi.advanceTimersByTime(350);
  });
  expect(screen.getAllByTestId("christmas-lights").map((chain) => chain.getAttribute("data-anchor"))).toEqual(["header"]);
  const head = document.getElementById("head");
  expect(bandGaps(head, { bandTop: 61, bandBottom: 79, left: 0 })).toEqual([[26, 238]]);
  expect(bandGaps(head, { bandTop: 72, bandBottom: 90, left: 0 })).toEqual([]);
  expect(bandGaps(null, { bandTop: 0, bandBottom: 10, left: 0 })).toEqual([]);
});
