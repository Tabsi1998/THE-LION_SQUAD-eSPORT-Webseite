import { CARD_DISTANCE, boxFree, cardDecoCount, chooseDeco, decoItem, liftingCards, overflows, remeasure, roomAt } from "./cardDeco";
import { mulberry32 } from "./rng";

// Deko an Karten (Jahreszeiten IV, Variante B, #1091-#1094): nur Karten, die sich heben; je Fensterhöhe so viele wie die
// Ecken der Seite erlauben, nie jede Karte; nur wo nichts Lesbares und keine andere Karte liegt; nie über den Rand.

function box(element, rect) {
  element.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top, x: rect.left, y: rect.top });
}

afterEach(() => {
  document.body.innerHTML = "";
  delete document.elementsFromPoint;
});

test("wie viele Karten Deko tragen: nach Seite, Stärke und Fenster - und nie mehr als vier von zehn", () => {
  expect(cardDecoCount("/", "normal", 1440, 20)).toBe(3);
  expect(cardDecoCount("/", "full", 1440, 20)).toBe(4);
  expect(cardDecoCount("/events", "normal", 1440, 4)).toBe(2);
  expect(cardDecoCount("/events", "normal", 1440, 2)).toBe(1);
  expect(cardDecoCount("/teams", "normal", 1440, 20)).toBe(2);
  expect(cardDecoCount("/login", "normal", 1440, 20)).toBe(1);
  expect(cardDecoCount("/admin", "full", 1440, 20)).toBe(0);
  expect(cardDecoCount("/", "subtle", 1440, 20)).toBe(1);
  // Schmale Fenster eine, Handys keine.
  expect(cardDecoCount("/", "full", 800, 20)).toBe(1);
  expect(cardDecoCount("/", "full", 390, 20)).toBe(0);
  expect(cardDecoCount("/", "full", 1440, 0)).toBe(0);
});

test("nur Karten, die sich heben, groß genug; mit Kartenschlüssel", () => {
  document.body.innerHTML = `
    <a id="a" class="tls-card" data-season-anchor="card">A</a>
    <div id="b" data-season-anchor="card">B, hebt sich nicht</div>
    <a id="c" class="tls-card" data-season-perch="card">C</a>
    <a id="d" class="tls-card" data-season-anchor="card">D, zu klein</a>`;
  box(document.getElementById("a"), { left: 0, right: 400, top: 100, bottom: 400 });
  box(document.getElementById("b"), { left: 420, right: 820, top: 100, bottom: 400 });
  box(document.getElementById("c"), { left: 840, right: 1240, top: 100, bottom: 400 });
  box(document.getElementById("d"), { left: 0, right: 100, top: 500, bottom: 560 });
  const cards = liftingCards(document, { innerHeight: 900, innerWidth: 1440, scrollX: 0, scrollY: 0 });
  expect(cards.map((card) => card.element.id)).toEqual(["a", "c"]);
  expect(cards[0].card).toMatch(/^card:\d+$/);
});

test("ein Kasten ist frei, wenn darunter keine Schrift, kein Bild, keine Bedienung und keine andere Karte liegt", () => {
  document.body.innerHTML = `<section id="s"><a id="own" class="tls-card" data-season-anchor="card"><p id="text">Text</p></a><a id="other" class="tls-card" data-season-anchor="card"></a><img id="img" alt=""></section>`;
  const own = document.getElementById("own");
  box(own, { left: 0, right: 300, top: 100, bottom: 300 });
  box(document.getElementById("other"), { left: 0, right: 300, top: 320, bottom: 500 });
  box(document.getElementById("text"), { left: 20, right: 200, top: 120, bottom: 140 });
  const win = { innerWidth: 1440, innerHeight: 900, scrollX: 0, scrollY: 0 };
  const hits = { section: document.getElementById("s"), text: document.getElementById("text"), img: document.getElementById("img") };
  let under = "section";
  document.elementsFromPoint = () => [hits[under]];
  expect(roomAt(document, win, 50, 90)).toBe(true);
  expect(boxFree(document, win, { left: 10, top: 80, right: 120, bottom: 99 }, own)).toBe(true);
  under = "img";
  expect(boxFree(document, win, { left: 10, top: 80, right: 120, bottom: 99 }, own)).toBe(false);
  under = "section";
  // Die Nachbarkarte darunter sperrt, auch ohne Schrift.
  expect(boxFree(document, win, { left: 10, top: 302, right: 120, bottom: 330 }, own)).toBe(false);
  // Außerhalb des Fensters weiß die Sonde nichts - dann entscheidet nur die Geometrie.
  under = "img";
  expect(roomAt(document, win, 50, 2000)).toBe(true);
});

test("nie über den Rand der Seite", () => {
  const doc = { documentElement: { clientWidth: 1425 } };
  const win = { innerWidth: 1440, scrollX: 0 };
  expect(overflows(doc, win, { left: 10, right: 1400 })).toBe(false);
  expect(overflows(doc, win, { left: -4, right: 100 })).toBe(true);
  expect(overflows(doc, win, { left: 1300, right: 1424 })).toBe(true);
});

test("Auswahl: nie zwei an einer Karte, mit Abstand; Einträge in Seitenkoordinaten, nachgemessen", () => {
  const element = (id, left) => {
    const node = document.createElement("a");
    node.id = id;
    node.className = "tls-card";
    document.body.appendChild(node);
    box(node, { left, right: left + 180, top: 100, bottom: 400 });
    return node;
  };
  const win = { innerWidth: 1440, innerHeight: 900, scrollX: 0, scrollY: 50 };
  const anchors = [element("a", 0), element("b", 200), element("c", 400), element("d", 600)].map((node, index) => ({ element: node, rect: node.getBoundingClientRect(), index, key: `card:${index + 1}` }));
  const items = anchors.map((anchor) => decoItem(anchor, "chain", { ax: 150, ay: 300 }, win));
  expect(items[1]).toMatchObject({ key: "chain:card:2", x: 200, y: 150, width: 180, height: 300, px: 350, py: 450 });
  const chosen = chooseDeco(items, 4, mulberry32(7));
  expect(new Set(chosen.map((item) => item.element)).size).toBe(chosen.length);
  chosen.forEach((item, index) => chosen.slice(index + 1).forEach((other) => expect(Math.abs(item.px - other.px)).toBeGreaterThanOrEqual(CARD_DISTANCE)));
  // Vier Karten nebeneinander, 200 px auseinander: höchstens jede zweite.
  expect(chosen.length).toBe(2);
  box(anchors[0].element, { left: 10, right: 190, top: 90, bottom: 390 });
  expect(remeasure(items[0], win)).toMatchObject({ x: 10, y: 140, width: 180, height: 300 });
  anchors[0].element.remove();
  expect(remeasure(items[0], win)).toBeNull();
});
