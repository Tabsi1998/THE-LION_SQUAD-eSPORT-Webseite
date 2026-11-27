import { bleibAmZiel } from "./warteAufElement";

// Sprung zu einem Anker (#meine-daten) in „Mein Bereich“: Karten darüber laden nach und werden höher. Das Ziel bleibt
// kurz im Blick - wird die Seite nach dem Sprung höher und hat sich das Ziel verschoben, rückt die Seite nach (gleitend,
// wenn Bewegung erlaubt ist). Greift die Person selbst ein (Scrollrad, Wischen, Taste), hört das sofort auf.

function fakeResizeObserver() {
  const observers = [];
  class Fake {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      observers.push(this);
    }
    // Wie im Browser: Beim Beobachten meldet sich der Beobachter einmal sofort.
    observe() { this.callback([]); }
    disconnect() { this.disconnected = true; }
  }
  return { Fake, fire: () => observers.forEach((observer) => !observer.disconnected && observer.callback([])) };
}

function scene(tops) {
  let index = 0;
  const root = { scrollHeight: 2000 };
  const ziel = {
    calls: [],
    getBoundingClientRect: () => ({ top: tops[Math.min(index, tops.length - 1)] }),
    scrollIntoView(options) { this.calls.push(options); },
  };
  const grow = () => {
    index += 1;
    root.scrollHeight += 40;
  };
  return { root, ziel, grow };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("die erste Meldung beim Beobachten löst nichts aus - der erste Sprung gleitet in Ruhe", () => {
  const { Fake } = fakeResizeObserver();
  const { root, ziel } = scene([600]);
  bleibAmZiel(ziel, { ResizeObserver: Fake, root, motion: true });
  expect(ziel.calls).toEqual([]);
});

test("wird die Seite höher und verschiebt sich das Ziel, rückt sie nach - gleitend mit Bewegung, sonst sofort", () => {
  for (const [motion, behavior] of [[true, "smooth"], [false, "auto"]]) {
    const { Fake, fire } = fakeResizeObserver();
    const { root, ziel, grow } = scene([128, 161]);
    bleibAmZiel(ziel, { ResizeObserver: Fake, root, motion });
    grow();
    fire();
    expect(ziel.calls).toEqual([{ block: "start", inline: "nearest", behavior }]);
  }
});

test("bleibt das Ziel an seinem Platz oder wächst die Seite nicht, passiert nichts", () => {
  const first = fakeResizeObserver();
  const still = scene([128, 129]);
  bleibAmZiel(still.ziel, { ResizeObserver: first.Fake, root: still.root });
  still.grow();
  first.fire();
  expect(still.ziel.calls).toEqual([]);

  const second = fakeResizeObserver();
  const gleich = scene([128, 300]);
  bleibAmZiel(gleich.ziel, { ResizeObserver: second.Fake, root: gleich.root });
  second.fire();
  expect(gleich.ziel.calls).toEqual([]);
});

test("nach der Frist und nach eigenem Scrollen nicht mehr", () => {
  const first = fakeResizeObserver();
  const spät = scene([128, 300]);
  bleibAmZiel(spät.ziel, { ResizeObserver: first.Fake, root: spät.root, ms: 1500 });
  vi.advanceTimersByTime(1600);
  spät.grow();
  first.fire();
  expect(spät.ziel.calls).toEqual([]);

  const second = fakeResizeObserver();
  const selbst = scene([128, 300]);
  bleibAmZiel(selbst.ziel, { ResizeObserver: second.Fake, root: selbst.root });
  window.dispatchEvent(new Event("wheel"));
  selbst.grow();
  second.fire();
  expect(selbst.ziel.calls).toEqual([]);
});

test("ohne ResizeObserver: kein Fehler, nichts zu tun", () => {
  const { ziel } = scene([128]);
  expect(() => bleibAmZiel(ziel, { ResizeObserver: undefined })()).not.toThrow();
});
