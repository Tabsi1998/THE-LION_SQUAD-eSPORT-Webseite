import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CornerWebs, webYields } from "./CornerWebs";
import { createMotionScheduler, resetMotionScheduler } from "../motion";

// Kleine Netze (H12): sitzen in Kartenecken und Fußzeilenecken, je Fensterhöhe höchstens `count`; unter einem Dialog
// weichen sie aus; die winzige Spinne läuft nur mit Bewegung, eine nach der anderen, und zieht sich vor dem Zeiger zurück.

beforeEach(() => resetMotionScheduler(createMotionScheduler({ unlimited: true })));
afterAll(() => resetMotionScheduler(null));

function rectOf(element, rect) {
  element.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top });
}

let fixture = null;

/** Karten untereinander (je 500 px) und die Fußzeile; die Rechtecke folgen dem Scrollstand wie im Browser. */
function mountCards(count = 3) {
  fixture = document.createElement("div");
  fixture.innerHTML = `<main>${Array.from({ length: count }, (_, i) => `<a id="c${i}" data-season-anchor="card"><div></div></a>`).join("")}</main><footer id="foot"><div></div></footer>`;
  document.body.appendChild(fixture);
  const pageRects = {};
  for (let i = 0; i < count; i += 1) pageRects[`c${i}`] = { left: 40, right: 400, top: 100 + i * 500, bottom: 300 + i * 500 };
  pageRects.foot = { left: 0, right: 1200, top: 100 + count * 500, bottom: 300 + count * 500 };
  Object.entries(pageRects).forEach(([id, rect]) => {
    const element = document.getElementById(id);
    element.getBoundingClientRect = () => {
      const scroll = window.scrollY || 0;
      return { left: rect.left, right: rect.right, top: rect.top - scroll, bottom: rect.bottom - scroll, width: rect.right - rect.left, height: rect.bottom - rect.top };
    };
  });
}

afterEach(() => {
  fixture?.remove();
  fixture = null;
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  vi.useRealTimers();
});



test("höchstens `count` Netze je Fensterhöhe, in Ecken von Karten oder Fußzeile; beim Scrollen kommen weitere dazu", async () => {
  vi.useFakeTimers();
  mountCards(3);
  render(<MemoryRouter><CornerWebs count={2} seed={0.3} salt="x" moving={false} /></MemoryRouter>);
  expect(screen.queryAllByTestId("halloween-corner-web").length).toBe(0);
  await act(async () => {
    vi.advanceTimersByTime(450);
  });
  const webs = screen.getAllByTestId("halloween-corner-web");
  expect(webs.length).toBe(2);
  webs.forEach((web) => {
    expect(["box", "footer"]).toContain(web.getAttribute("data-kind"));
    expect(["tl", "tr"]).toContain(web.getAttribute("data-side"));
    expect(web.querySelector("svg.tls-cweb__net line")).not.toBeNull();
    expect(web.querySelector("[data-testid='halloween-corner-spider']")).toBeNull();
  });
  const transforms = webs.map((web) => web.style.transform);
  expect(new Set(transforms).size).toBe(2);
  // Ein Netz in der linken oberen Ecke von c0 beginnt genau an der Ecke; eines rechts endet dort.
  const tl = webs.find((web) => web.getAttribute("data-side") === "tl");
  if (tl) expect(tl.style.transform).toMatch(/^translate\(41\.0px, 101\.0px\)$/);
  // Weiter unten (Fenster 768 hoch): nach dem Scrollen werden die Ecken dort besetzt - höchstens zwei je Fensterhöhe.
  Object.defineProperty(window, "scrollY", { value: 1400, configurable: true });
  fireEvent.scroll(window);
  await act(async () => {
    vi.advanceTimersByTime(350);
  });
  const later = screen.getAllByTestId("halloween-corner-web");
  expect(later.length).toBeGreaterThan(2);
  expect(later.length).toBeLessThanOrEqual(4);
});

test("Ausweichen: öffnet sich ein Dialog über einem Netz, wird es unsichtbar - und kommt zurück", async () => {
  vi.useFakeTimers();
  mountCards(1);
  render(<MemoryRouter><CornerWebs count={1} seed={0.3} salt="x" moving={false} /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(450);
  });
  const web = screen.getByTestId("halloween-corner-web");
  expect(web.getAttribute("data-yield")).toBeNull();
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  rectOf(dialog, { left: 0, right: 600, top: 50, bottom: 400 });
  document.body.appendChild(dialog);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(screen.getByTestId("halloween-corner-web").getAttribute("data-yield")).toBe("1");
  expect(screen.getByTestId("halloween-corner-web").className).toContain("tls-cweb--yield");
  dialog.remove();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(screen.getByTestId("halloween-corner-web").getAttribute("data-yield")).toBeNull();
  expect(webYields({ side: "tl", x: 41, y: 101, spec: { width: 60, height: 60 } }, [])).toBe(false);
});

test("Spinne: läuft nach der Pause über ihr Netz (Budget), zieht sich vor dem Zeiger zurück, verschwindet wieder; ohne Bewegung nie", async () => {
  vi.useFakeTimers();
  mountCards(1);
  const first = render(<MemoryRouter><CornerWebs count={1} seed={0.3} salt="x" moving walkDelayMs={[1500, 1500]} /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(450);
  });
  expect(screen.getByTestId("halloween-corner-web").getAttribute("data-spider")).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(2100);
  });
  const web = screen.getByTestId("halloween-corner-web");
  expect(web.getAttribute("data-spider")).toBe("walk");
  const spider = screen.getByTestId("halloween-corner-spider");
  expect(spider.className.baseVal || spider.getAttribute("class")).toContain("tls-cweb__spider--walk");
  // Zeiger direkt auf die Nabe: Rückzug.
  const match = web.style.transform.match(/translate\(([\d.]+)px, ([\d.]+)px\)/);
  const left = parseFloat(match[1]);
  const top = parseFloat(match[2]);
  const hubX = parseFloat(spider.style.left) + 4;
  const hubY = parseFloat(spider.style.top) + 26;
  fireEvent.mouseMove(window, { clientX: left + hubX + 10, clientY: top + hubY });
  await act(async () => {
    vi.advanceTimersByTime(50);
  });
  expect(screen.getByTestId("halloween-corner-web").getAttribute("data-spider")).toBe("retreat");
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  expect(screen.getByTestId("halloween-corner-web").getAttribute("data-spider")).toBeNull();
  // Ohne Bewegung: keine Spinne, so lange man wartet.
  first.unmount();
  fixture.remove();
  fixture = null;
  mountCards(1);
  render(<MemoryRouter><CornerWebs count={1} seed={0.7} salt="y" moving={false} walkDelayMs={[100, 100]} /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  expect(screen.queryByTestId("halloween-corner-spider")).toBeNull();
});
