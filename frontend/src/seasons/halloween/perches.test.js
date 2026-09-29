import { KIND_WEIGHTS, MIN_DISTANCE, POSE, choosePerches, measurePerches, nearestFreePerch } from "./perches";

// Plätze (H7): echte Kanten - Menü, Kopfzeile, Karten-Ecken und -Unterkante, Rahmen, freistehende Bilder, Löwe,
// Fußzeilen-Strich; nichts an Buchstaben, nichts in Ruhezonen, nichts über Text oder Nachbarkarten; belegte Plätze
// werden nicht doppelt angeboten.

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

test("misst Plätze an Kanten und Ecken - nie an Buchstaben, nie in Ruhezonen", () => {
  document.body.innerHTML = `
    <header id="head" style="position: sticky"><nav><a id="n1">News</a><a id="n2">Events</a></nav></header>
    <main>
      <h1 id="h1">Ein Rudel. Eine Familie.</h1>
      <a id="c1" data-season-anchor="card">Karte</a>
      <div id="c2" data-season-perch="card">Kachel</div>
      <section id="fr" data-season-perch="frame"><p>Rahmen</p></section>
      <img id="i1" src="/x.png" alt="Bild">
      <div id="lion" data-season-anchor="lion"></div>
      <form id="f"><a id="c3" data-season-anchor="card">Karte im Formular</a></form>
    </main>
    <footer><span data-season-line id="line"></span></footer>`;
  box(document.getElementById("head"), { left: 0, right: 1200, top: 0, bottom: 64 });
  box(document.getElementById("n1"), { left: 100, right: 160, top: 20, bottom: 44 });
  box(document.getElementById("n2"), { left: 200, right: 280, top: 20, bottom: 44 });
  box(document.getElementById("h1"), { left: 40, right: 640, top: 200, bottom: 270 });
  box(document.getElementById("c1"), { left: 40, right: 400, top: 700, bottom: 900 });
  box(document.getElementById("c2"), { left: 500, right: 900, top: 700, bottom: 900 });
  box(document.getElementById("fr"), { left: 40, right: 900, top: 1000, bottom: 1300 });
  box(document.getElementById("i1"), { left: 40, right: 500, top: 1400, bottom: 1700 });
  box(document.getElementById("lion"), { left: 600, right: 900, top: 150, bottom: 450 });
  box(document.getElementById("f"), { left: 0, right: 1200, top: 1800, bottom: 2100 });
  box(document.getElementById("c3"), { left: 40, right: 400, top: 1850, bottom: 2050 });
  box(document.getElementById("line"), { left: 0, right: 1200, top: 2400, bottom: 2401 });
  const win = { scrollX: 0, scrollY: 300, innerWidth: 1280, innerHeight: 800, getComputedStyle: (element) => ({ position: element.style.position }) };
  const perches = measurePerches(document, win);
  const kinds = perches.reduce((acc, p) => ({ ...acc, [p.kind]: (acc[p.kind] || 0) + 1 }), {});
  expect(kinds).toEqual({ nav: 2, header: 3, card: 6, frame: 3, image: 1, lion: 1, footer: 2 });
  expect(perches.some((p) => p.kind === "glyph" || p.element.id === "h1")).toBe(false);
  const nav = perches.find((p) => p.kind === "nav");
  expect(nav).toMatchObject({ fixed: true, pose: POSE.hang, x: 130, y: 46, px: 130, py: 346 });
  expect(perches.find((p) => p.kind === "header")).toMatchObject({ fixed: true, y: 65 });
  const corners = perches.filter((p) => p.kind === "card" && p.pose === POSE.sit && p.element.id === "c1");
  expect(corners).toHaveLength(2);
  expect(corners[0].y).toBe(700 + 300);
  expect(corners[0].x).toBeGreaterThan(40 + 15);
  expect(corners[1].x).toBeLessThan(400 - 15);
  expect(corners[0].key).not.toBe(corners[1].key);
  expect(perches.filter((p) => p.kind === "card" && p.element.id === "c2")[0].key).not.toBe(corners[0].key);
  const under = perches.find((p) => p.kind === "card" && p.pose === POSE.hang && p.element.id === "c1");
  expect(under).toMatchObject({ x: 220, y: 899 + 300 });
  expect(perches.some((p) => p.element.id === "c3")).toBe(false);
  expect(perches.find((p) => p.kind === "image")).toMatchObject({ pose: POSE.hang, y: 1699 + 300 });
  expect(perches.find((p) => p.kind === "footer")).toMatchObject({ pose: POSE.sit, y: 2700 });
  expect(perches.find((p) => p.kind === "lion")).toMatchObject({ pose: POSE.hang, x: 600 + 300 * 0.68, y: 150 + 300 * 0.16 + 300 });
  // Belegte Plätze fallen weg; Nachmessen liefert dieselbe Stelle und null, wenn das Element weg ist.
  expect(measurePerches(document, win, { taken: new Set([nav.key]) }).filter((p) => p.kind === "nav")).toHaveLength(1);
  expect(under.measure()).toEqual({ x: under.x, y: under.y });
  document.getElementById("c1").remove();
  expect(under.measure()).toBeNull();
});

test("kein Platz über Text oder Nachbarkarten: die Sonde und die Geometrie der anderen Karten entscheiden", () => {
  document.body.innerHTML = `
    <main>
      <a id="c1" data-season-anchor="card"><img id="pic" src="/a.png" alt=""><p id="t1">Titel</p></a>
      <a id="c2" data-season-anchor="card">Zweite</a>
      <a id="c3" data-season-anchor="card">Dritte</a>
      <img id="free" src="/b.png" alt="">
      <p id="text">Absatz</p>
    </main>`;
  box(document.getElementById("c1"), { left: 40, right: 400, top: 100, bottom: 300 });
  box(document.getElementById("pic"), { left: 40, right: 400, top: 100, bottom: 250 });
  box(document.getElementById("c2"), { left: 40, right: 400, top: 320, bottom: 520 });
  box(document.getElementById("c3"), { left: 500, right: 900, top: 320, bottom: 520 });
  box(document.getElementById("free"), { left: 40, right: 400, top: 600, bottom: 800 });
  box(document.getElementById("text"), { left: 40, right: 400, top: 810, bottom: 900 });
  const win = { scrollX: 0, scrollY: 0, innerWidth: 1280, innerHeight: 1000 };
  // Sonde wie im Browser: unter der ersten Karte liegt die zweite, unter dem Bild ein Absatz, sonst Hintergrund.
  const probe = (x, y) => {
    if (y >= 320 && y <= 520 && x <= 400) return document.getElementById("c2");
    if (y >= 810 && x <= 400) return document.getElementById("text");
    return document.body;
  };
  const cards = measurePerches(document, win, { probe }).filter((p) => p.kind === "card" || p.kind === "image");
  const byId = (id) => cards.filter((p) => p.element.id === id);
  // Karte 1: Ecken frei, Unterkante blockiert (Karte 2 direkt darunter). Karte 2: Ecken blockiert (Karte 1 darüber), Unterkante frei.
  expect(byId("c1").map((p) => p.pose)).toEqual([POSE.sit, POSE.sit]);
  expect(byId("c2").map((p) => p.pose)).toEqual([POSE.hang]);
  expect(byId("c3").map((p) => p.pose)).toEqual([POSE.sit, POSE.sit, POSE.hang]);
  // Das Bild in der Karte zählt nicht, das freie Bild hat Text darunter: kein Bildplatz.
  expect(cards.filter((p) => p.kind === "image")).toHaveLength(0);
  // Ohne Sonde (kein Layout) entscheidet nur die Geometrie: das freie Bild bekommt seinen Platz.
  expect(measurePerches(document, win, { probe: null }).filter((p) => p.kind === "image")).toHaveLength(1);
});

test("Auswahl nach Gewicht und Mindestabstand; nächster freier Platz für Landungen", () => {
  const candidates = [
    { kind: "nav", key: "a", px: 0, py: 0, x: 0, y: 0 },
    { kind: "nav", key: "b", px: MIN_DISTANCE - 20, py: 0, x: MIN_DISTANCE - 20, y: 0 },
    { kind: "image", key: "c", px: 500, py: 0, x: 500, y: 0 },
    { kind: "card", key: "d", px: 1000, py: 0, x: 1000, y: 0 },
  ];
  const chosen = choosePerches(candidates, 3, rngOf([0.1, 0.5, 0.9, 0.2, 0.5, 0.8]));
  expect(chosen).toHaveLength(3);
  expect(new Set(chosen.map((p) => p.kind)).size).toBe(3);
  expect(chosen.some((p) => p.px === 0) && chosen.some((p) => p.px === MIN_DISTANCE - 20)).toBe(false);
  expect(choosePerches(candidates, 3, rngOf([0.1, 0.5, 0.9, 0.2, 0.5, 0.8]))).toEqual(chosen);
  expect(choosePerches(candidates, 3, rngOf([0.05, 0.5]), [{ px: 0, py: 0 }]).every((p) => p.kind !== "nav")).toBe(true);
  expect(KIND_WEIGHTS.card).toBeGreaterThan(KIND_WEIGHTS.lion);
  const near = nearestFreePerch(candidates, { x: 820, y: 10 }, [], rngOf([0]), { avoidKey: "c" });
  expect(near.key).toBe("d");
  expect(nearestFreePerch(candidates, { x: 0, y: 0 }, [{ px: 0, py: 0 }, { px: 500, py: 0 }, { px: 1000, py: 0 }], rngOf([0]))).toBeNull();
  expect(nearestFreePerch([], { x: 0, y: 0 })).toBeNull();
});
