import { EGG_HEIGHT, EGG_SIZE, RIBBON, eggBox, eggProbe, placeEgg, placeEggs, sidesFor } from "./placement";

// Ostereier an echten Kanten (#754): Ecke wie gewünscht, sonst die nächste freie, sonst das nächste Element derselben
// Art, zuletzt die Fußzeile; nie über Schrift, Grafiken oder Bedienelementen im Element (Geometrie, nicht das
// Fenster - auch weit unten liegt jedes Ei gleich beim Laden); was die Leiste unten am Handy für immer verdeckt, ist
// belegt; die Kopfzeile wartet, bis man oben ist; zwei Eier nie in derselben Ecke; gesetzte Eier bleiben; die
// eigenen Eier sperren nichts.

function box(element, rect) {
  element.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top });
}

const win = { scrollX: 0, scrollY: 0, innerWidth: 1280, innerHeight: 800, getComputedStyle: (element) => ({ position: element.style.position }) };

function mount() {
  document.body.innerHTML = `
    <header id="head" style="position: sticky"><nav><a id="n1">News</a></nav></header>
    <main>
      <a id="c1" data-season-anchor="card"><button id="t1">Weiterlesen</button></a>
      <a id="c2" data-season-anchor="card">Zweite</a>
      <a id="far" data-season-anchor="card">Weit unten</a>
      <div id="lion" data-season-anchor="lion"></div>
      <img id="pic" alt="" />
    </main>
    <footer id="foot"></footer>`;
  box(document.getElementById("head"), { left: 0, right: 1200, top: 0, bottom: 64 });
  box(document.getElementById("n1"), { left: 100, right: 160, top: 20, bottom: 44 });
  box(document.getElementById("c1"), { left: 40, right: 400, top: 100, bottom: 300 });
  box(document.getElementById("t1"), { left: 300, right: 400, top: 250, bottom: 300 });
  box(document.getElementById("c2"), { left: 500, right: 900, top: 100, bottom: 300 });
  box(document.getElementById("far"), { left: 40, right: 400, top: 2000, bottom: 2200 });
  box(document.getElementById("lion"), { left: 900, right: 1200, top: 320, bottom: 620 });
  box(document.getElementById("foot"), { left: 0, right: 1200, top: 650, bottom: 790 });
  box(document.getElementById("pic"), { left: 1000, right: 1100, top: 66, bottom: 96 });
}

/** Die Sonde (nur für die Stelle unter der Kopfzeile): rechts darunter steht ein Bild. */
function probe(x, y) {
  const pic = document.getElementById("pic").getBoundingClientRect();
  if (x >= pic.left && x <= pic.right && y >= pic.top && y <= pic.bottom) return document.getElementById("pic");
  return document.body;
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("die gewünschte Ecke zuerst, dann die übrigen", () => {
  expect(sidesFor("top-left")).toEqual(["tl", "br", "bl", "tr"]);
  expect(sidesFor("unbekannt")).toEqual(["br", "bl", "tr", "tl"]);
});

test("ein Ei liegt in der Ecke seiner Karte - liegt dort ein Knopf, nimmt es die nächste freie Ecke", () => {
  mount();
  const free = placeEgg({ spot: { kind: "card", index: 1, place: "top-left" } }, { win, probe });
  expect(free).toMatchObject({ kind: "card", side: "tl", fallback: false, fixed: false, x: 500 + 6 + EGG_SIZE / 2 });
  // Der gezeichnete Kasten liegt 6 px innen an beiden Kanten.
  expect(eggBox(free.x, free.y).top).toBeCloseTo(106, 0);
  const dodged = placeEgg({ spot: { kind: "card", index: 0, place: "bottom-right" } }, { win, probe });
  expect(dodged.side).toBe("bl");
  expect(dodged.element.id).toBe("c1");
  expect(eggBox(dodged.x, dodged.y).bottom).toBeCloseTo(294, 0);
});

test("die Nummer zählt reihum, auch wenn eine Seite weniger Karten hat", () => {
  mount();
  const place = placeEgg({ spot: { kind: "card", index: 4, place: "top-right" } }, { win, probe });
  expect(place.element.id).toBe("c2");
});

test("auch weit unten liegt das Ei gleich beim Laden - in Seitenkoordinaten", () => {
  mount();
  const far = placeEgg({ spot: { kind: "card", index: 2, place: "top-left" } }, { win: { ...win, scrollY: 150 }, probe });
  expect(far).toMatchObject({ side: "tl", x: 40 + 6 + EGG_SIZE / 2 });
  expect(far.y).toBe(Math.round(2000 + 6 + EGG_HEIGHT * 0.55 + 150));
});

test("Löwe und Kopfzeile: zu Füßen des Löwen; oben auf der Seite unter der Kopfzeile, wo nichts steht", () => {
  mount();
  const lion = placeEgg({ spot: { kind: "hero", index: 0, place: "bottom-left" } }, { win, probe });
  expect(lion.x).toBeCloseTo(900 + 300 * 0.22);
  expect(lion.y).toBeCloseTo(320 + 300 * 0.92);
  const head = placeEgg({ spot: { kind: "header", index: 0, place: "top-left" } }, { win, probe });
  // Es hängt an einem Bändchen von der Unterkante - ohne Gras.
  expect(head).toMatchObject({ fixed: false, side: "hl", x: Math.round(1200 * 0.14) });
  expect(eggBox(head.x, head.y).top).toBeCloseTo(64 + RIBBON, 0);
  // Rechts unter der Kopfzeile steht ein Bild - das Ei rückt ein Stück nach innen.
  const right = placeEgg({ spot: { kind: "header", index: 0, place: "top-right" } }, { win, probe });
  expect(right.x).toBe(Math.round(1200 * 0.72));
  // Weiter unten auf der Seite wartet es, bis man oben ist (es scrollt mit der Seite, nicht mit der Kopfzeile).
  expect(placeEgg({ spot: { kind: "header", index: 0, place: "top-left" } }, { win: { ...win, scrollY: 300 }, probe })).toEqual({ pending: true });
});

test("ohne passende Kante weicht das Ei in die Fußzeile aus", () => {
  mount();
  const place = placeEgg({ spot: { kind: "image", index: 0, place: "top-left" } }, { win, probe });
  expect(place).toMatchObject({ kind: "footer", fallback: true, side: "tl" });
});

test("was die Leiste unten für immer verdeckt, ist belegt", () => {
  mount();
  const bar = document.createElement("nav");
  bar.style.position = "fixed";
  document.body.appendChild(bar);
  box(bar, { left: 0, right: 1280, top: 736, bottom: 800 });
  document.elementsFromPoint = () => [bar];
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 790 });
  try {
    // Die unteren Ecken der Fußzeile liegen am Seitenende unter der Leiste - das Ei nimmt die nächste obere.
    const place = placeEgg({ spot: { kind: "footer", index: 0, place: "bottom-left" } }, { win, probe });
    expect(place.side).toBe("tr");
  } finally {
    delete document.elementsFromPoint;
    delete document.documentElement.scrollHeight;
  }
});

test("sind alle Ecken der Fußzeile belegt, liegt das Ei in der Ecke eines Blocks darin (#1228)", () => {
  mount();
  const foot = document.getElementById("foot");
  foot.innerHTML = `<button id="cta-l">Dabei sein</button><button id="cta-r">Zur App</button><div id="col"><button id="col-link">Verein</button></div>`;
  // Oben links und rechts steht etwas (wie die lange erste Zeile am Handy), unten verdeckt die Leiste.
  box(document.getElementById("cta-l"), { left: 0, right: 200, top: 650, bottom: 700 });
  box(document.getElementById("cta-r"), { left: 1000, right: 1200, top: 650, bottom: 700 });
  box(document.getElementById("col"), { left: 600, right: 900, top: 655, bottom: 760 });
  box(document.getElementById("col-link"), { left: 600, right: 700, top: 700, bottom: 724 });
  const bar = document.createElement("nav");
  bar.style.position = "fixed";
  document.body.appendChild(bar);
  box(bar, { left: 0, right: 1280, top: 736, bottom: 800 });
  document.elementsFromPoint = () => [bar];
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 790 });
  try {
    const place = placeEgg({ spot: { kind: "footer", index: 0, place: "bottom-left" } }, { win, probe });
    expect(place).toMatchObject({ kind: "footer", fallback: true, side: "tr" });
    expect(place.key).toMatch(/^footer-block:/);
    expect(place.x).toBe(900 - 6 - EGG_SIZE / 2);
  } finally {
    delete document.elementsFromPoint;
    delete document.documentElement.scrollHeight;
  }
});

test("die Sonde schaut durch die eigenen Eier hindurch", () => {
  const card = document.createElement("a");
  const layer = document.createElement("div");
  layer.className = "tls-eggs";
  const egg = document.createElement("button");
  layer.appendChild(egg);
  document.body.append(layer, card);
  expect(eggProbe({ elementsFromPoint: () => [egg, layer, card] })(10, 10)).toBe(card);
});

test("zwei Eier nie in derselben Ecke - gesetzte bleiben, neue werden gesucht", () => {
  mount();
  const eggs = [
    { egg_no: 1, spot: { kind: "card", index: 1, place: "top-left" } },
    { egg_no: 2, spot: { kind: "card", index: 1, place: "top-left" } },
  ];
  const first = placeEggs(eggs, { win, probe });
  expect(first[1].side).toBe("tl");
  expect(first[2].element.id).toBe("c2");
  expect(first[2].side).not.toBe("tl");

  const more = [...eggs, { egg_no: 3, spot: { kind: "card", index: 1, place: "top-left" } }];
  const again = placeEggs(more, { win, probe, placed: first });
  expect(again[1]).toBe(first[1]);
  expect(again[2]).toBe(first[2]);
  expect(new Set([again[1].side, again[2].side, again[3].side]).size).toBe(3);
});
