import { act, render, screen } from "@testing-library/react";
import { Reveal, revealAllowed } from "./Reveal";

// Leises Einblenden (#832): ohne IntersectionObserver oder mit „Bewegung reduzieren“ ist alles sofort da;
// sonst ist der Abschnitt bis zum Hereinscrollen „hidden“ und danach einmal „shown“.

let observers = [];
class FakeObserver {
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.disconnected = false;
    observers.push(this);
  }
  observe() {}
  disconnect() { this.disconnected = true; }
}

function media(reduced) {
  return vi.fn((query) => ({ matches: query.includes("reduce") ? reduced : false }));
}

beforeEach(() => {
  observers = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.IntersectionObserver;
});

test("ohne IntersectionObserver oder mit reduzierter Bewegung: sofort sichtbar", () => {
  expect(revealAllowed({ matchMedia: media(false) })).toBe(false);
  expect(revealAllowed({ IntersectionObserver: FakeObserver, matchMedia: media(true) })).toBe(false);
  expect(revealAllowed({ IntersectionObserver: FakeObserver, matchMedia: media(false) })).toBe(true);
  render(<Reveal data-testid="block">Inhalt</Reveal>);
  expect(screen.getByTestId("block")).toHaveAttribute("data-reveal", "shown");
});

test("verborgen bis zum Hereinscrollen, dann einmal sichtbar", () => {
  window.IntersectionObserver = FakeObserver;
  window.matchMedia = media(false);
  render(<Reveal as="section" data-testid="block" className="x">Inhalt</Reveal>);
  const block = screen.getByTestId("block");
  expect(block.tagName).toBe("SECTION");
  expect(block).toHaveAttribute("data-reveal", "hidden");
  const [observer] = observers;
  act(() => observer.callback([{ isIntersecting: false }]));
  expect(block).toHaveAttribute("data-reveal", "hidden");
  act(() => observer.callback([{ isIntersecting: true }]));
  expect(block).toHaveAttribute("data-reveal", "shown");
  expect(observer.disconnected).toBe(true);
});
