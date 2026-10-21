import { act, render, screen } from "@testing-library/react";
import { Glow, Press, StaggerIn } from "./index";
import { MICRO, MOTION } from "@/lib/motion";

// Bausteine Glow, StaggerIn und Press (#1969): einmal aufleuchten, gestaffelt erscheinen und dann Ruhe, Mikro-Rückmeldung
// beim Drücken - mit „Bewegung reduzieren“ alles sofort.

function reduceMotion() {
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
  return () => {
    if (original) window.matchMedia = original;
    else delete window.matchMedia;
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Glow", () => {
  test("leuchtet nicht beim ersten Zeichnen, aber bei jeder Änderung danach", () => {
    const { rerender } = render(<Glow trigger="1:24,587" data-testid="g">1:24,587</Glow>);
    expect(screen.getByTestId("g")).not.toHaveAttribute("data-glow");
    expect(screen.getByTestId("g")).toHaveClass("tls-glow");
    rerender(<Glow trigger="1:23,412" data-testid="g">1:23,412</Glow>);
    expect(screen.getByTestId("g")).toHaveAttribute("data-glow", "on");
  });

  test("`active` leuchtet sofort, mit Versatz und Farbe der Rolle", () => {
    render(<Glow active tone="pole" delay={900} data-testid="g">Pole</Glow>);
    const node = screen.getByTestId("g");
    expect(node).toHaveAttribute("data-glow", "on");
    expect(node).toHaveAttribute("data-tone", "pole");
    expect(node.style.getPropertyValue("--tls-glow-delay")).toBe("900ms");
  });

  test("unbekannte Farben werden Cyan, „Bewegung reduzieren“ leuchtet nicht", () => {
    const restore = reduceMotion();
    try {
      const { rerender } = render(<Glow active trigger={1} tone="lila" data-testid="g">x</Glow>);
      expect(screen.getByTestId("g")).toHaveAttribute("data-tone", "brand");
      expect(screen.getByTestId("g")).not.toHaveAttribute("data-glow");
      rerender(<Glow active trigger={2} tone="lila" data-testid="g">x</Glow>);
      expect(screen.getByTestId("g")).not.toHaveAttribute("data-glow");
    } finally {
      restore();
    }
  });
});

describe("StaggerIn", () => {
  test("spielt einmal ab und ist danach ruhig - neue Einträge erscheinen ohne Bewegung", () => {
    vi.useFakeTimers();
    const { rerender } = render(<StaggerIn as="ul" data-testid="liste"><li>a</li><li>b</li></StaggerIn>);
    const list = screen.getByTestId("liste");
    expect(list.tagName).toBe("UL");
    expect(list).toHaveClass("tls-stagger");
    expect(list).toHaveAttribute("data-stagger", "run");
    act(() => { vi.advanceTimersByTime(MICRO.stagger * MICRO.staggerMax + MOTION.slow + 100); });
    expect(list).toHaveAttribute("data-stagger", "done");
    rerender(<StaggerIn as="ul" data-testid="liste"><li>a</li><li>b</li><li>neu</li></StaggerIn>);
    expect(screen.getByTestId("liste")).toHaveAttribute("data-stagger", "done");
  });

  test("wartet auf das Sichtbarwerden", () => {
    const observers = [];
    const original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {}
      disconnect() {}
    };
    try {
      render(<StaggerIn data-testid="liste"><div>a</div></StaggerIn>);
      expect(screen.getByTestId("liste")).toHaveAttribute("data-stagger", "wait");
      act(() => { observers[0].callback([{ isIntersecting: true }]); });
      expect(screen.getByTestId("liste")).toHaveAttribute("data-stagger", "run");
    } finally {
      globalThis.IntersectionObserver = original;
    }
  });

  test("ohne `play` und mit „Bewegung reduzieren“ steht alles sofort", () => {
    render(<StaggerIn play={false} data-testid="aus"><div>a</div></StaggerIn>);
    expect(screen.getByTestId("aus")).toHaveAttribute("data-stagger", "done");
    const restore = reduceMotion();
    try {
      render(<StaggerIn data-testid="ruhig"><div>a</div></StaggerIn>);
      expect(screen.getByTestId("ruhig")).toHaveAttribute("data-stagger", "done");
    } finally {
      restore();
    }
  });
});

test("Press: Klasse für Anheben und Nachgeben, flach ohne Anheben, beliebiges Element", () => {
  render(<><Press as="button" type="button" className="p-2" data-testid="karte">Karte</Press><Press lift={false} data-testid="chip">Chip</Press></>);
  expect(screen.getByTestId("karte").tagName).toBe("BUTTON");
  expect(screen.getByTestId("karte")).toHaveClass("tls-press", "p-2");
  expect(screen.getByTestId("karte")).not.toHaveClass("tls-press--flat");
  expect(screen.getByTestId("chip")).toHaveClass("tls-press", "tls-press--flat");
});
