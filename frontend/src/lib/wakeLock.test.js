// Wach halten (#1112): anfordern, verlieren, neu anfordern - mit einer Attrappe des Browsers.
import { keepScreenAwake } from "./wakeLock";

function fakeDocument(state = "visible") {
  const listeners = new Set();
  return {
    visibilityState: state,
    addEventListener(type, listener) {
      if (type === "visibilitychange") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "visibilitychange") listeners.delete(listener);
    },
    setVisibility(next) {
      this.visibilityState = next;
      listeners.forEach((listener) => listener());
    },
    listenerCount: () => listeners.size,
  };
}

/** Eine Sperre wie WakeLockSentinel: gibt sie der Browser frei, meldet sie „release“. */
function fakeSentinel() {
  const listeners = new Set();
  return {
    released: false,
    addEventListener(type, listener) {
      if (type === "release") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "release") listeners.delete(listener);
    },
    async release() {
      this.released = true;
    },
    // Wie der Browser, wenn die Seite verdeckt wird.
    drop() {
      this.released = true;
      listeners.forEach((listener) => listener());
    },
  };
}

function fakeNavigator() {
  const sentinels = [];
  return {
    sentinels,
    wakeLock: {
      request: vi.fn(async (type) => {
        if (type !== "screen") throw new Error("nur screen");
        const sentinel = fakeSentinel();
        sentinels.push(sentinel);
        return sentinel;
      }),
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("fordert beim Start an, nach dem Verdecken wieder, wenn die Seite zurückkommt", async () => {
  const nav = fakeNavigator();
  const doc = fakeDocument();
  const onUnavailable = vi.fn();
  const stop = keepScreenAwake({ nav, doc, onUnavailable });
  await settle();
  expect(nav.wakeLock.request).toHaveBeenCalledTimes(1);
  expect(nav.wakeLock.request).toHaveBeenCalledWith("screen");

  // Verdeckt: der Browser gibt die Sperre frei - solange verdeckt, wird nicht neu angefordert.
  doc.visibilityState = "hidden";
  nav.sentinels[0].drop();
  await settle();
  expect(nav.wakeLock.request).toHaveBeenCalledTimes(1);

  // Zurück: neu anfordern.
  doc.setVisibility("visible");
  await settle();
  expect(nav.wakeLock.request).toHaveBeenCalledTimes(2);

  // Verliert die Seite die Sperre, während sie zu sehen ist (z. B. vom System), fordert sie gleich wieder an.
  nav.sentinels[1].drop();
  await settle();
  expect(nav.wakeLock.request).toHaveBeenCalledTimes(3);
  expect(onUnavailable).not.toHaveBeenCalled();

  stop();
  await settle();
  expect(nav.sentinels[2].released).toBe(true);
  expect(doc.listenerCount()).toBe(0);
  doc.setVisibility("visible");
  await settle();
  expect(nav.wakeLock.request).toHaveBeenCalledTimes(3);
});

test("ohne Wake Lock im Browser: einmal Bescheid, die Seite läuft weiter", async () => {
  const doc = fakeDocument();
  const onUnavailable = vi.fn();
  const stop = keepScreenAwake({ nav: {}, doc, onUnavailable });
  await settle();
  doc.setVisibility("visible");
  await settle();
  expect(onUnavailable).toHaveBeenCalledTimes(1);
  expect(onUnavailable).toHaveBeenCalledWith("unsupported");
  stop();
});

test("abgelehnt: einmal Bescheid, auch wenn die Seite zurückkommt und es noch einmal versucht", async () => {
  const nav = { wakeLock: { request: vi.fn(async () => { throw new Error("NotAllowedError"); }) } };
  const doc = fakeDocument();
  const onUnavailable = vi.fn();
  const stop = keepScreenAwake({ nav, doc, onUnavailable });
  await settle();
  doc.setVisibility("visible");
  await settle();
  expect(nav.wakeLock.request).toHaveBeenCalledTimes(2);
  expect(onUnavailable).toHaveBeenCalledTimes(1);
  expect(onUnavailable).toHaveBeenCalledWith("denied");
  stop();
});

test("verdeckt gestartet: erst anfordern, wenn die Seite zu sehen ist", async () => {
  const nav = fakeNavigator();
  const doc = fakeDocument("hidden");
  const stop = keepScreenAwake({ nav, doc });
  await settle();
  expect(nav.wakeLock.request).not.toHaveBeenCalled();
  doc.setVisibility("visible");
  await settle();
  expect(nav.wakeLock.request).toHaveBeenCalledTimes(1);
  stop();
});
