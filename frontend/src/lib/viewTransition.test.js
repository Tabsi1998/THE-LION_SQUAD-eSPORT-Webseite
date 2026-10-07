import { clickTarget, navigateWithTransition, quietPath, routeCommitted, routeKey, takeTransitionShown, transitionPending, transitionsAvailable, waitForRoute } from "./viewTransition";

// Seitenwechsel (#1073): welcher Klick einen Übergang bekommt, wie lange der Browser auf die neue Seite wartet, und
// dass ohne Übergangs-Funktion einfach navigiert wird.

const win = { location: new URL("https://lionsquad.test/news?seite=2") };

function click(href, { attrs = {}, ...init } = {}) {
  const anchor = document.createElement("a");
  anchor.setAttribute("href", href);
  for (const [key, value] of Object.entries(attrs)) anchor.setAttribute(key, value);
  const inner = document.createElement("span");
  anchor.appendChild(inner);
  // Absolut machen wie im Browser auf lionsquad.test.
  Object.defineProperty(anchor, "href", { value: new URL(href, win.location.href).href });
  return { target: inner, button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init };
}

test("clickTarget: nur ein einfacher Klick auf eine andere Seite dieser Website", () => {
  expect(clickTarget(click("/teams"), win)).toBe("/teams");
  expect(clickTarget(click("/news?seite=3"), win)).toBe("/news?seite=3");
  // Neuer Tab, Download, andere Website, Sprungmarke, gleiche Seite, eigene Taste, ausdrücklich ohne.
  expect(clickTarget(click("/teams", { ctrlKey: true }), win)).toBeNull();
  expect(clickTarget(click("/teams", { button: 1 }), win)).toBeNull();
  expect(clickTarget(click("/teams", { attrs: { target: "_blank" } }), win)).toBeNull();
  expect(clickTarget(click("/teams", { attrs: { download: "" } }), win)).toBeNull();
  expect(clickTarget(click("/teams", { attrs: { "data-route-plain": "" } }), win)).toBeNull();
  expect(clickTarget(click("https://example.org/teams"), win)).toBeNull();
  expect(clickTarget(click("/teams#kader"), win)).toBeNull();
  expect(clickTarget(click("/news?seite=2"), win)).toBeNull();
  expect(clickTarget(click("/teams", { defaultPrevented: true }), win)).toBeNull();
  // Nicht in den Admin, nicht auf TV und Einrichtung - und nicht aus dem Admin heraus.
  expect(clickTarget(click("/admin/news"), win)).toBeNull();
  expect(clickTarget(click("/display/bracket/x"), win)).toBeNull();
  expect(clickTarget(click("/news"), { location: new URL("https://lionsquad.test/admin") })).toBeNull();
  expect(quietPath("/administration")).toBe(false);
});

test("routeKey: Pfad und Suche, Sprungmarken zählen nicht", () => {
  expect(routeKey("/teams?x=1", "https://lionsquad.test/")).toBe("/teams?x=1");
  expect(routeKey({ pathname: "/teams", search: "?x=1", hash: "" })).toBe("/teams?x=1");
  expect(routeKey({ pathname: "/teams", hash: "#kader" })).toBeNull();
  expect(routeKey(null)).toBeNull();
});

test("waitForRoute: die neue Seite lässt den Übergang los, sonst nach der Wartezeit", async () => {
  vi.useFakeTimers();
  try {
    const shown = waitForRoute("/teams", 400);
    expect(transitionPending()).toBe(true);
    expect(routeCommitted("/news")).toBe(false);
    expect(routeCommitted("/teams")).toBe(true);
    await expect(shown).resolves.toBe(true);
    expect(transitionPending()).toBe(false);
    // PublicLayout fragt einmal, ob die Seite über den Übergang kam.
    expect(takeTransitionShown("/teams")).toBe(true);
    expect(takeTransitionShown("/teams")).toBe(false);

    const late = waitForRoute("/langsam", 400);
    vi.advanceTimersByTime(400);
    await expect(late).resolves.toBe(false);
    expect(transitionPending()).toBe(false);
    expect(routeCommitted("/langsam")).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test("navigateWithTransition: im Übergang navigieren, Klasse nur solange er läuft; ohne Funktion sofort", async () => {
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const calls = [];
  const fakeWin = {
    document: {
      documentElement: document.createElement("html"),
      startViewTransition(update) {
        calls.push(update());
        return { finished };
      },
    },
  };
  const go = vi.fn();
  navigateWithTransition(fakeWin, "/teams", go);
  expect(go).toHaveBeenCalledTimes(1);
  expect(fakeWin.document.documentElement.classList.contains("tls-vt")).toBe(true);
  expect(routeCommitted("/teams")).toBe(true);
  await expect(calls[0]).resolves.toBe(true);
  finish();
  await finished;
  await Promise.resolve();
  expect(fakeWin.document.documentElement.classList.contains("tls-vt")).toBe(false);

  const broken = { document: { documentElement: document.createElement("html"), startViewTransition() { throw new Error("nein"); } } };
  const plain = vi.fn();
  navigateWithTransition(broken, "/x", plain);
  expect(plain).toHaveBeenCalledTimes(1);
  expect(broken.document.documentElement.classList.contains("tls-vt")).toBe(false);
});

test("transitionsAvailable: nur mit Übergangs-Funktion und ohne „Bewegung reduzieren“", () => {
  const withMotion = { document: { startViewTransition() {} }, matchMedia: () => ({ matches: false }) };
  const reduced = { document: { startViewTransition() {} }, matchMedia: () => ({ matches: true }) };
  expect(transitionsAvailable(withMotion)).toBe(true);
  expect(transitionsAvailable(reduced)).toBe(false);
  expect(transitionsAvailable({ document: {} })).toBe(false);
  expect(transitionsAvailable(null)).toBe(false);
});
