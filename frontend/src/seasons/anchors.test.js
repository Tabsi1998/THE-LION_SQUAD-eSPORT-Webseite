import { ANCHOR_KINDS, POSE, areaFree, chooseSlots, cornerSlot, edgeSlot, elementFraction, freeSlots, makeSlot, measureAnchors, nearestFreeSlot, neighbourRects, pointSlot, roomAt } from "./anchors";

// Saison-Anker (C1, #721): echte Kanten und Ecken der Seite als gemeinsamer Kern - Messen, Plätze, Sonde, Ruhezonen,
// Belegung, Auswahl und Rückfall (weniger Plätze, wenn nichts mehr passt). Halloween nutzt ihn über perches.js und
// webCorners.js; spätere Saisons bringen nur ihren Plan mit.

function box(element, rect) {
  element.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top });
}

function rngOf(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

const win = { scrollX: 0, scrollY: 300, innerWidth: 1280, innerHeight: 800, getComputedStyle: (element) => ({ position: element.style.position }) };

afterEach(() => {
  document.body.innerHTML = "";
});

function mountPage() {
  document.body.innerHTML = `
    <header id="head" style="position: sticky"><nav><a id="n1">News</a><a id="n2">Events</a><a id="tiny">·</a></nav></header>
    <main>
      <h1 id="h1">Ein Rudel. Eine Familie.</h1>
      <a id="c1" data-season-anchor="card">Karte</a>
      <div id="c2" data-season-perch="card">Kachel</div>
      <section id="fr" data-season-perch="frame"><p>Rahmen</p></section>
      <img id="i1" src="/x.png" alt="Bild">
      <a id="c3" data-season-anchor="card"><img id="inner" src="/y.png" alt=""></a>
      <div id="lion" data-season-anchor="lion"></div>
      <div id="far" data-season-anchor="card">Weit unten</div>
    </main>
    <footer id="foot"><span data-season-line id="line"></span></footer>`;
  box(document.getElementById("head"), { left: 0, right: 1200, top: 0, bottom: 64 });
  box(document.getElementById("n1"), { left: 100, right: 160, top: 20, bottom: 44 });
  box(document.getElementById("n2"), { left: 200, right: 280, top: 20, bottom: 44 });
  box(document.getElementById("tiny"), { left: 300, right: 310, top: 20, bottom: 44 });
  box(document.getElementById("h1"), { left: 40, right: 640, top: 200, bottom: 270 });
  box(document.getElementById("c1"), { left: 40, right: 400, top: 700, bottom: 900 });
  box(document.getElementById("c2"), { left: 500, right: 900, top: 700, bottom: 900 });
  box(document.getElementById("fr"), { left: 40, right: 900, top: 1000, bottom: 1300 });
  box(document.getElementById("i1"), { left: 40, right: 500, top: 1400, bottom: 1700 });
  box(document.getElementById("c3"), { left: 40, right: 400, top: 1800, bottom: 2000 });
  box(document.getElementById("inner"), { left: 40, right: 400, top: 1800, bottom: 1950 });
  box(document.getElementById("lion"), { left: 600, right: 900, top: 150, bottom: 450 });
  box(document.getElementById("far"), { left: 40, right: 400, top: 5000, bottom: 5200 });
  box(document.getElementById("foot"), { left: 0, right: 1200, top: 2300, bottom: 2500 });
  box(document.getElementById("line"), { left: 0, right: 1200, top: 2400, bottom: 2401 });
}

test("misst Anker je Art: Menü und Kopfzeile kleben am Fenster, Bilder in Karten zählen nicht, zu kleine Elemente auch nicht; Schlüssel je Element stabil", () => {
  mountPage();
  const anchors = measureAnchors(document, win);
  const byKind = anchors.reduce((acc, a) => ({ ...acc, [a.kind]: [...(acc[a.kind] || []), a.element.id] }), {});
  expect(byKind).toEqual({ nav: ["n1", "n2"], header: ["head"], card: ["c1", "c2", "c3", "far"], frame: ["fr"], image: ["i1"], hero: ["lion"], footer: ["foot"], footerLine: ["line"] });
  expect(ANCHOR_KINDS).toEqual(Object.keys(byKind));
  expect(anchors.find((a) => a.kind === "nav")).toMatchObject({ fixed: true, index: 0, page: { left: 100, top: 320, right: 160, bottom: 344 } });
  expect(anchors.find((a) => a.kind === "header").fixed).toBe(true);
  expect(anchors.find((a) => a.kind === "card").fixed).toBe(false);
  // Schlüssel: je Element gleich, auch beim zweiten Messen; zwei Karten nie gleich.
  const again = measureAnchors(document, win);
  expect(again.map((a) => a.key)).toEqual(anchors.map((a) => a.key));
  expect(new Set(anchors.map((a) => a.key)).size).toBe(anchors.length);
  // Eigene Arten, Größen und Grenzen: Karten und Rahmen als eine Art, nur im Fenster (plus Rand).
  const boxes = measureAnchors(document, win, { kinds: ["box"], selectors: { box: "[data-season-anchor='card'], [data-season-perch='frame']" }, minSize: { box: [300, 100] }, limits: { box: 2 }, inViewMargin: 60 });
  expect(boxes.map((a) => `${a.kind}:${a.element.id}:${a.index}`)).toEqual(["box:c1:0"]);
  // Ohne klebende Kopfzeile hängt das Menü an der Seite (Seitenkoordinaten).
  document.getElementById("head").style.position = "static";
  expect(measureAnchors(document, win, { kinds: ["nav", "header"] }).map((a) => a.fixed)).toEqual([false, false, false]);
  // Nachbarn: alle Karten, Rahmen und Bilder in Seitenkoordinaten - auch jenseits der Grenzen.
  expect(neighbourRects(document, win).map((r) => r.element.id)).toEqual(["c1", "c2", "fr", "i1", "c3", "inner", "far"]);
});

test("Plätze: Kante mit Bruchteil oder Einzug, Punkt im Element, Ecke mit Kasten - Fenster- oder Seitenkoordinaten, Nachmessen, weg wenn das Element weg ist", () => {
  mountPage();
  const anchors = measureAnchors(document, win);
  const nav = anchors.find((a) => a.kind === "nav");
  const card = anchors.find((a) => a.element.id === "c1");
  const lion = anchors.find((a) => a.kind === "hero");
  const hang = edgeSlot(nav, { edge: "bottom", fraction: 0.5, dy: 2, size: 24, win });
  expect(hang).toMatchObject({ kind: "nav", pose: POSE.hang, fixed: true, x: 130, y: 46, px: 130, py: 346, size: 24, key: `nav:${nav.key.split(":")[1]}:0` });
  const left = edgeSlot(card, { edge: "top", inset: 20, index: 0, win });
  const right = edgeSlot(card, { edge: "top", inset: -20, index: 1, win });
  expect(left).toMatchObject({ pose: POSE.sit, fixed: false, x: 60, y: 1000, px: 60, py: 1000 });
  expect(right).toMatchObject({ x: 380, y: 1000 });
  expect(left.key).not.toBe(right.key);
  expect(edgeSlot(card, { edge: "bottom", fraction: 0.5, dy: -1, minWidth: 500, win })).toBeNull();
  expect(edgeSlot(card, { kind: "tile", edge: "bottom", fraction: 0.25, dy: -1, win })).toMatchObject({ kind: "tile", pose: POSE.hang, x: 130, y: 1199 });
  const mane = pointSlot(lion, { kind: "lion", fx: 0.68, fy: 0.16, size: 26, win });
  expect(mane).toMatchObject({ kind: "lion", pose: POSE.hang, x: 600 + 300 * 0.68, y: 150 + 300 * 0.16 + 300 });
  expect(makeSlot(card, { at: () => null, win })).toBeNull();
  // Ecken: tl/tr oben, bl/br unten - die Sonde prüft den Kasten nach innen.
  const seen = [];
  const probe = (x, y) => {
    seen.push([x, y]);
    return card.element;
  };
  expect(cornerSlot(card, { side: "tl", width: 60, height: 60, probe: () => document.body, win })).toBeNull();
  const tl = cornerSlot(card, { side: "tl", width: 60, height: 60, probe, win });
  expect(tl).toMatchObject({ side: "tl", x: 41, y: 1001, px: 41, py: 1001, fixed: false, width: 60, height: 60, key: `card:${card.key.split(":")[1]}:tl` });
  expect(seen.every(([x, y]) => x > 41 && x < 101 && y > 701 && y < 761)).toBe(true);
  seen.length = 0;
  const br = cornerSlot(card, { side: "br", width: 60, height: 60, probe, win });
  expect(br).toMatchObject({ side: "br", x: 399, y: 1199 });
  expect(seen.every(([x, y]) => x < 399 && x > 339 && y < 899 && y > 839)).toBe(true);
  // Nachmessen liefert die frische Stelle; Fenster-Anker bleiben Fensterkoordinaten.
  expect(hang.measure()).toEqual({ x: 130, y: 46 });
  expect(left.measure()).toEqual({ x: 60, y: 1000 });
  expect(tl.measure()).toEqual({ x: 41, y: 1001 });
  box(card.element, { left: 40, right: 400, top: 800, bottom: 1000 });
  expect(left.measure()).toEqual({ x: 60, y: 1100 });
  card.element.remove();
  expect(left.measure()).toBeNull();
  expect(tl.measure()).toBeNull();
});

test("Sonde: Kantenplätze sperrt jeder Text-Behälter, Flächen nur Zeichen, Bild und Bedienung; außerhalb des Fensters gilt frei; ohne Sonde entscheidet die Geometrie", () => {
  document.body.innerHTML = `
    <main>
      <a id="c1" data-season-anchor="card"><div id="pad"></div><p id="t1">Titel</p><img id="pic" src="/a.png" alt=""></a>
      <a id="c2" data-season-anchor="card">Zweite</a>
      <p id="text">Absatz</p>
    </main>`;
  const c1 = document.getElementById("c1");
  const c2 = document.getElementById("c2");
  const pad = document.getElementById("pad");
  const t1 = document.getElementById("t1");
  const pic = document.getElementById("pic");
  const text = document.getElementById("text");
  const plain = { innerWidth: 1280, innerHeight: 800 };
  // Kante: eigenes Element und nackter Behälter frei, eigener Text und fremde Karte gesperrt.
  expect(roomAt(() => c1, 10, 10, c1, plain)).toBe(true);
  expect(roomAt(() => pad, 10, 10, c1, plain)).toBe(true);
  expect(roomAt(() => t1, 10, 10, c1, plain)).toBe(false);
  expect(roomAt(() => c2, 10, 10, c1, plain)).toBe(false);
  expect(roomAt(() => text, 10, 10, c1, plain)).toBe(false);
  expect(roomAt(() => document.body, 10, 10, c1, plain)).toBe(true);
  expect(roomAt(() => t1, -5, 10, c1, plain)).toBe(true);
  expect(roomAt(null, 10, 10, c1, plain)).toBe(true);
  // Fläche: Bild sperrt, Text mit Zeichen sperrt, nackter Behälter frei, alles außerhalb des Elements sperrt.
  expect(areaFree(() => pad, c1, [[1, 1], [2, 2]])).toBe(true);
  expect(areaFree(() => pic, c1, [[1, 1]])).toBe(false);
  expect(areaFree(() => t1, c1, [[1, 1]])).toBe(false);
  expect(areaFree(() => c2, c1, [[1, 1]])).toBe(false);
  expect(areaFree(null, c1, [[1, 1]])).toBe(true);
});

test("Ruhezonen und Belegung: Fenster-Anker gegen Fensterzonen, Seiten-Anker gegen die Seite; belegte Schlüssel fallen weg; leere Plätze auch", () => {
  // Bei Scrollstand 300: eine Zone oben auf der Seite (im Fenster längst weggescrollt) und ein offener Dialog oben im Fenster.
  const zones = [
    { left: 0, top: 0, right: 200, bottom: 100, viewLeft: 0, viewTop: -300, viewRight: 200, viewBottom: -200, overlay: false },
    { left: 0, top: 300, right: 200, bottom: 400, viewLeft: 0, viewTop: 0, viewRight: 200, viewBottom: 100, overlay: true },
  ];
  const slots = [
    { key: "a", fixed: true, x: 50, y: 50, px: 50, py: 350 },
    { key: "b", fixed: false, x: 50, y: 350, px: 50, py: 350 },
    { key: "c", fixed: false, x: 50, y: 50, px: 50, py: 50 },
    { key: "d", fixed: false, x: 900, y: 900, px: 900, py: 900 },
    null,
  ];
  expect(freeSlots(slots, { zones: [zones[0]] }).map((s) => s.key)).toEqual(["a", "b", "d"]);
  expect(freeSlots(slots, { zones: [zones[1]] }).map((s) => s.key)).toEqual(["c", "d"]);
  expect(freeSlots(slots, { zones: [], taken: new Set(["b"]) }).map((s) => s.key)).toEqual(["a", "c", "d"]);
});

test("Auswahl: nach Art gewichtet oder je Kandidat, Mindestabstand auch zu Belegten, eins je Element, seeded - und weniger, wenn nichts mehr passt", () => {
  const el = (id) => ({ id });
  const a = el("a");
  const b = el("b");
  const candidates = [
    { kind: "nav", key: "n1", element: a, px: 0, py: 0, x: 0, y: 0 },
    { kind: "nav", key: "n2", element: a, px: 100, py: 0, x: 100, y: 0 },
    { kind: "card", key: "c1", element: b, px: 500, py: 0, x: 500, y: 0 },
    { kind: "footer", key: "f1", element: el("f"), px: 1000, py: 0, x: 1000, y: 0 },
  ];
  // Nach Art: ein niedriger Wurf trifft die erste Art in der Reihenfolge der Kandidaten.
  const byKind = chooseSlots(candidates, 3, rngOf([0.01, 0, 0.01, 0, 0.01, 0]), [], { weights: { nav: 0.5, card: 0.3, footer: 0.2 }, minDistance: 140 });
  expect(byKind.map((s) => s.key)).toEqual(["n1", "c1", "f1"]);
  expect(chooseSlots(candidates, 3, rngOf([0.01, 0, 0.01, 0, 0.01, 0]), [], { weights: { nav: 0.5, card: 0.3, footer: 0.2 }, minDistance: 140 })).toEqual(byKind);
  // Belegtes sperrt die Nähe: mit einem Platz bei 0 ist kein Menüplatz mehr erlaubt.
  expect(chooseSlots(candidates, 3, rngOf([0.01, 0]), [{ px: 0, py: 0 }], { weights: { nav: 0.5 }, minDistance: 140 }).every((s) => s.kind !== "nav")).toBe(true);
  // Je Kandidat: Gewicht je Kandidat, eins je Element, Mindestabstand.
  const each = chooseSlots(candidates, 4, rngOf([0.99, 0.01, 0.01, 0.01]), [], { weightOf: (s) => (s.kind === "footer" ? 5 : 1), minDistance: 140, onePerElement: true });
  expect(each.map((s) => s.key)).toEqual(["f1", "n1", "c1"]);
  expect(chooseSlots(candidates, 2, rngOf([0.01]), [{ element: a, x: 0, y: 0 }], { minDistance: 140, onePerElement: true }).map((s) => s.key)).toEqual(["c1", "f1"]);
  // Rückfall: nichts passt mehr - weniger als gewünscht, nie ein zu naher Platz.
  expect(chooseSlots(candidates, 4, rngOf([0.5]), [], { minDistance: 2000 })).toHaveLength(1);
  expect(chooseSlots([], 3, rngOf([0.5]))).toEqual([]);
  // Der nächste freie Platz: einer der drei nächsten, nicht derselbe, nicht zu nah an Belegten.
  expect(nearestFreeSlot(candidates, { x: 820, y: 10 }, [], rngOf([0]), { avoidKey: "c1", minDistance: 140 }).key).toBe("f1");
  expect(nearestFreeSlot(candidates, { x: 0, y: 0 }, [{ px: 0, py: 0 }, { px: 500, py: 0 }, { px: 1000, py: 0 }], rngOf([0]), { minDistance: 140 })).toBeNull();
  expect(nearestFreeSlot([], { x: 0, y: 0 })).toBeNull();
});

test("je Element stabile Zahl: gleich beim Nachmessen, anders je Salz und Element", () => {
  document.body.innerHTML = `<main><a id="c1" data-season-anchor="card">Eins</a><a id="c2" data-season-anchor="card">Zwei</a></main>`;
  box(document.getElementById("c1"), { left: 0, right: 300, top: 0, bottom: 200 });
  box(document.getElementById("c2"), { left: 400, right: 700, top: 0, bottom: 200 });
  const [one, two] = measureAnchors(document, win, { kinds: ["card"] });
  expect(elementFraction(one)).toBe(elementFraction(measureAnchors(document, win, { kinds: ["card"] })[0]));
  expect(elementFraction(one)).toBeGreaterThanOrEqual(0);
  expect(elementFraction(one)).toBeLessThan(1);
  expect(elementFraction(one)).not.toBe(elementFraction(two));
  expect(elementFraction(one)).not.toBe(elementFraction(one, "image"));
});
