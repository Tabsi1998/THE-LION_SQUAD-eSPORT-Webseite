import { blocksPoint, ownTextNodes, pointOnText, textRects } from "./glyphs";

// Schrift genau messen: nur die Zeichenkästen sperren, nicht der ganze (oft kartenbreite) Kasten des Behälters.

function fakeRanges(table) {
  const original = document.createRange;
  document.createRange = () => {
    let node = null;
    return {
      selectNodeContents(target) {
        node = target;
      },
      getClientRects() {
        return table.get(node) || [];
      },
    };
  };
  return () => {
    document.createRange = original;
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("eigene Textknoten, Zeichenkästen und Punktprüfung mit Rand", () => {
  document.body.innerHTML = '<div id="row">Neueste News<span id="chip">Pin</span></div><div id="empty"><span>x</span></div>';
  const row = document.getElementById("row");
  expect(ownTextNodes(row).length).toBe(1);
  expect(ownTextNodes(document.getElementById("empty")).length).toBe(0);
  expect(textRects(document.getElementById("empty"))).toEqual([]);
  const restore = fakeRanges(new Map([[row.firstChild, [{ left: 790, right: 900, top: 738, bottom: 750, width: 110, height: 12 }]]]));
  expect(pointOnText(row, 850, 744)).toBe(true);
  expect(pointOnText(row, 903, 744)).toBe(true);
  expect(pointOnText(row, 1360, 744)).toBe(false);
  expect(blocksPoint(row, 1360, 744)).toBe(false);
  expect(blocksPoint(row, 800, 744)).toBe(true);
  restore();
});

test("Bilder und Bedienelemente sperren mit dem Kasten, Links nur mit ihrer Schrift, Behälter ohne Text nie; ohne Layout vorsichtig", () => {
  document.body.innerHTML = '<img id="pic"><button id="btn"></button><a id="link" href="/x">Lesen</a><div id="box"><p>Kind</p></div><div id="text">Hallo</div>';
  expect(blocksPoint(document.getElementById("pic"), 0, 0)).toBe(true);
  expect(blocksPoint(document.getElementById("btn"), 0, 0)).toBe(true);
  expect(blocksPoint(document.getElementById("box"), 0, 0)).toBe(false);
  // jsdom kennt keine Zeichenkästen: eigener Text zählt dann als belegt.
  expect(textRects(document.getElementById("text"))).toBeNull();
  expect(blocksPoint(document.getElementById("text"), 0, 0)).toBe(true);
  expect(blocksPoint(document.getElementById("link"), 0, 0)).toBe(true);
  expect(blocksPoint(null, 0, 0)).toBe(false);
});
