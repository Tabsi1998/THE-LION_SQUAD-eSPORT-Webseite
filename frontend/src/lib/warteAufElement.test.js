import { bleibAmZiel } from "./warteAufElement";

// Sprung zu einem Anker (#meine-daten) in „Mein Bereich“: Karten darüber laden nach und werden höher. Das Ziel bleibt
// kurz im Blick - wächst etwas darüber, springt die Seite noch einmal hin. Greift die Person selbst ein (Scrollrad,
// Wischen, Taste), hört das sofort auf.

function fakeResizeObserver() {
  const observers = [];
  class Fake {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      observers.push(this);
    }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  return { Fake, fire: () => observers.forEach((observer) => !observer.disconnected && observer.callback([])) };
}

function target(tops) {
  let index = 0;
  return {
    scrolls: 0,
    getBoundingClientRect: () => ({ top: tops[Math.min(index, tops.length - 1)] }),
    scrollIntoView() { this.scrolls += 1; },
    move() { index += 1; },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("wächst etwas darüber, springt die Seite noch einmal zum Ziel", () => {
  const { Fake, fire } = fakeResizeObserver();
  const ziel = target([128, 161]);
  bleibAmZiel(ziel, { ResizeObserver: Fake });
  ziel.move();
  fire();
  expect(ziel.scrolls).toBe(1);
});

test("bleibt das Ziel an seinem Platz, passiert nichts", () => {
  const { Fake, fire } = fakeResizeObserver();
  const ziel = target([128, 129]);
  bleibAmZiel(ziel, { ResizeObserver: Fake });
  ziel.move();
  fire();
  expect(ziel.scrolls).toBe(0);
});

test("nach der Frist und nach eigenem Scrollen nicht mehr", () => {
  const first = fakeResizeObserver();
  const spät = target([128, 300]);
  bleibAmZiel(spät, { ResizeObserver: first.Fake, ms: 1500 });
  vi.advanceTimersByTime(1600);
  spät.move();
  first.fire();
  expect(spät.scrolls).toBe(0);

  const second = fakeResizeObserver();
  const selbst = target([128, 300]);
  bleibAmZiel(selbst, { ResizeObserver: second.Fake });
  window.dispatchEvent(new Event("wheel"));
  selbst.move();
  second.fire();
  expect(selbst.scrolls).toBe(0);
});

test("ohne ResizeObserver: kein Fehler, nichts zu tun", () => {
  const ziel = target([128]);
  expect(() => bleibAmZiel(ziel, { ResizeObserver: undefined })()).not.toThrow();
});
