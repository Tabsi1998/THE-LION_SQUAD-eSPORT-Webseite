import { MIN_DISTANCE, chooseWebCorners, hubOf, measureWebCorners, webSpec } from "./webCorners";

// Kleine Netze (H12): Ecken von Karten und Fußzeile im Fenster, nie über Text oder Bild (Sonde), nie in Ruhezonen;
// je Element höchstens eines, mit Abstand; Größe und Blässe je Ecke stabil.

function box(element, rect) {
  element.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top });
}

function rngOf(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("Größe und Blässe aus dem Seed, kleiner als das große Netz; Nabe je Ecke gespiegelt", () => {
  const spec = webSpec("a");
  expect(spec).toEqual(webSpec("a"));
  expect(spec.radius).toBeGreaterThanOrEqual(22);
  expect(spec.radius).toBeLessThanOrEqual(34);
  expect(spec.opacity).toBeLessThan(0.7);
  expect(webSpec("b")).not.toEqual(spec);
  expect(hubOf(spec, "tr").x).toBeCloseTo(spec.width - hubOf(spec, "tl").x, 5);
  expect(hubOf(spec, "tl").y).toBe(hubOf(spec, "tr").y);
});

test("misst Ecken im Fenster: Karte und Fußzeile ja, Bildecke und Textecke nein, Ruhezone nein, außerhalb des Fensters nein", () => {
  document.body.innerHTML = `
    <main>
      <a id="c1" data-season-anchor="card"><div id="pad"></div></a>
      <a id="c2" data-season-perch="card"><img id="pic" src="/a.png" alt=""></a>
      <a id="c3" data-season-anchor="card"><h3 id="title">Titel oben links</h3></a>
      <a id="c5" data-season-anchor="card"><div id="label2">Dabei sein</div></a>
      <div id="far" data-season-anchor="card"></div>
      <form><a id="c4" data-season-anchor="card">Im Formular</a></form>
    </main>
    <footer id="foot"><div id="cta">Dabei sein</div></footer>`;
  box(document.getElementById("c1"), { left: 40, right: 400, top: 100, bottom: 300 });
  box(document.getElementById("c2"), { left: 500, right: 900, top: 100, bottom: 300 });
  box(document.getElementById("c3"), { left: 40, right: 400, top: 400, bottom: 600 });
  box(document.getElementById("c5"), { left: 500, right: 900, top: 400, bottom: 600 });
  box(document.getElementById("far"), { left: 40, right: 400, top: 3000, bottom: 3200 });
  box(document.querySelector("form"), { left: 0, right: 1000, top: 600, bottom: 700 });
  box(document.getElementById("c4"), { left: 40, right: 400, top: 605, bottom: 695 });
  box(document.getElementById("foot"), { left: 0, right: 1200, top: 760, bottom: 960 });
  const win = { scrollX: 0, scrollY: 200, innerWidth: 1280, innerHeight: 800 };
  const probe = (x, y) => {
    if (x >= 500 && x <= 900 && y >= 100 && y <= 300) return document.getElementById("pic");
    if (x >= 40 && x <= 400 && y >= 400 && y <= 600) return x < 250 ? document.getElementById("title") : document.getElementById("c3");
    if (x >= 500 && x <= 900 && y >= 400 && y <= 600) return document.getElementById("label2");
    if (y >= 760 && y <= 960) return document.getElementById("foot");
    if (x >= 40 && x <= 400 && y >= 100 && y <= 300) return document.getElementById("pad");
    return document.body;
  };
  const corners = measureWebCorners(document, win, { probe, seed: "s" });
  const keys = corners.map((corner) => `${corner.element.id}:${corner.side}`);
  expect(keys).toEqual(["c1:tl", "c1:tr", "c3:tr", "foot:tl", "foot:tr"]);
  const first = corners[0];
  expect(first).toMatchObject({ kind: "box", side: "tl", x: 41, y: 301 });
  expect(corners[1]).toMatchObject({ side: "tr", x: 399, y: 301 });
  expect(first.spec.radius).toBeGreaterThan(0);
  expect(first.measure()).toEqual({ x: 41, y: 301 });
  document.getElementById("c1").remove();
  expect(first.measure()).toBeNull();
  // Ohne Sonde (kein Layout) zählt nur Ruhezone und Fenster.
  const again = measureWebCorners(document, win, { probe: null, seed: "s" });
  expect(again.map((corner) => corner.element.id)).toEqual(["c2", "c2", "c3", "c3", "c5", "c5", "foot", "foot"]);
  expect(measureWebCorners(document, win, { probe: null, seed: "s", taken: new Set([again[0].key]) }).map((corner) => corner.key)).not.toContain(again[0].key);
});

test("Auswahl: nie zwei am selben Element, Mindestabstand auch zu Belegten, die Fußzeile etwas lieber; seeded", () => {
  const el = (id) => ({ id });
  const a = el("a");
  const b = el("b");
  const f = el("f");
  const candidates = [
    { kind: "box", element: a, side: "tl", x: 0, y: 0, key: "a:tl" },
    { kind: "box", element: a, side: "tr", x: 800, y: 0, key: "a:tr" },
    { kind: "box", element: b, side: "tl", x: MIN_DISTANCE - 40, y: 0, key: "b:tl" },
    { kind: "footer", element: f, side: "tl", x: 0, y: 2000, key: "f:tl" },
  ];
  const chosen = chooseWebCorners(candidates, 4, rngOf([0.05, 0.05, 0.05, 0.05]));
  expect(chosen.map((corner) => corner.key)).toEqual(["a:tl", "f:tl"]);
  expect(chooseWebCorners(candidates, 4, rngOf([0.05, 0.05]))).toEqual(chosen);
  expect(chooseWebCorners(candidates, 2, rngOf([0.99, 0.99])).map((corner) => corner.key)).toEqual(["f:tl", "b:tl"]);
  expect(chooseWebCorners(candidates, 2, rngOf([0.05]), [{ element: a, x: 0, y: 0 }]).map((corner) => corner.key)).toEqual(["f:tl"]);
});
