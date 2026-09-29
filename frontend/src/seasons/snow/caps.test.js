import { INSET, MIN_RUN, OVERHANG, SEGMENT, THICKNESS, capLevel, capPath, capThickness, freeRuns, measureCaps } from "./caps";

// Schneehauben (S7, W3): Stufe vom Server, Tauwetter nimmt, Dicke je Stufe und Wachstum, Kontur aus dem Seed,
// nur freie Stücke der Kante (Sonde), echte Kanten der Seite im Fenster, Ruhezonen frei.

function box(element, rect) {
  element.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top });
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("Stufe und Tauwetter, Dicke mit Wachstum", () => {
  expect(capLevel({ stage: 2 })).toBe(2);
  expect(capLevel({ stage: 2, tempC: -4 })).toBe(2);
  expect(capLevel({ stage: 2, tempC: 1.5 })).toBe(1.5);
  expect(capLevel({ stage: 2, tempC: 5 })).toBe(1);
  expect(capLevel({ stage: 1, tempC: 8 })).toBe(0.5);
  expect(capLevel({ stage: 9 })).toBe(3);
  expect(capLevel({})).toBe(1);
  expect(capThickness(1)).toBe(THICKNESS[1]);
  expect(capThickness(3)).toBe(THICKNESS[3]);
  expect(capThickness(1.5)).toBeCloseTo((THICKNESS[1] + THICKNESS[2]) / 2, 1);
  expect(capThickness(2, 1.3)).toBeCloseTo(THICKNESS[2] * 1.3, 1);
  expect(capThickness(0.5)).toBeLessThan(THICKNESS[1]);
});

test("Kontur: aus dem Seed stabil, je Seed anders, an den Enden auslaufend, Zapfen ab Stufe 2", () => {
  const a = capPath({ width: 200, thickness: 6, seed: "a", level: 1 });
  expect(capPath({ width: 200, thickness: 6, seed: "a", level: 1 })).toEqual(a);
  expect(capPath({ width: 200, thickness: 6, seed: "b", level: 1 }).d).not.toBe(a.d);
  expect(a.d.startsWith(`M 0 ${(6 + OVERHANG).toFixed(1)}`)).toBe(true);
  expect(a.d.endsWith("Z")).toBe(true);
  expect(a.d).toContain(" Q ");
  expect(a.base).toBe(6 + OVERHANG);
  expect(a.height).toBeLessThan(a.base + 1);
  const drips = capPath({ width: 200, thickness: 9, seed: "a", level: 3 });
  expect(drips.height).toBeGreaterThan(drips.base + 5);
  expect(drips.d.length).toBeGreaterThan(a.d.length);
  expect(drips.d.split(" Q ").length).toBeGreaterThan(a.d.split(" Q ").length);
  expect(capPath({ width: 4, thickness: 0.2, seed: "x" }).d).toContain("M 0");
});

test("freie Läufe: Abschnitte, unter denen etwas liegt, fallen weg; kurze Reste auch; ohne Sonde alles frei", () => {
  document.body.innerHTML = `<main><a id="c" data-season-anchor="card"><span id="badge">Neu</span><img id="pic" src="/a.png" alt=""><button id="btn">Merken</button><div id="pad"></div></a></main>`;
  const card = document.getElementById("c");
  box(card, { left: 100, right: 100 + INSET * 2 + SEGMENT * 6, top: 200, bottom: 400 });
  const anchor = { element: card, rect: card.getBoundingClientRect(), kind: "card" };
  const win = { innerWidth: 1280, innerHeight: 900 };
  expect(freeRuns(anchor, { probe: null, win })).toEqual([{ from: INSET, to: INSET + SEGMENT * 6 }]);
  // Ein Abzeichen im dritten Abschnitt: zwei Läufe, das Abzeichen bleibt frei.
  const badge = document.getElementById("badge");
  const probe = (x) => (x >= 100 + INSET + SEGMENT * 2 && x < 100 + INSET + SEGMENT * 3 ? badge : card);
  const runs = freeRuns(anchor, { probe, win });
  expect(runs).toEqual([{ from: INSET, to: INSET + SEGMENT * 2 }, { from: INSET + SEGMENT * 3, to: INSET + SEGMENT * 6 }]);
  // Ein Titelbild unter der ganzen Kante sperrt nicht (Schnee liegt auf dem Rahmen), ein nackter Behälter auch nicht.
  expect(freeRuns(anchor, { probe: () => document.getElementById("pic"), win })).toEqual([{ from: INSET, to: INSET + SEGMENT * 6 }]);
  expect(freeRuns(anchor, { probe: () => document.getElementById("pad"), win })).toEqual([{ from: INSET, to: INSET + SEGMENT * 6 }]);
  // Ein Knopf unter der ganzen Kante sperrt; etwas Fremdes über der Kante auch.
  expect(freeRuns(anchor, { probe: () => document.getElementById("btn"), win })).toEqual([]);
  expect(freeRuns(anchor, { probe: () => document.body, win })).toEqual([]);
  // Zu schmal für einen Lauf.
  box(card, { left: 100, right: 100 + INSET * 2 + MIN_RUN - 1, top: 200, bottom: 400 });
  expect(freeRuns({ element: card, rect: card.getBoundingClientRect() }, { probe: null, win })).toEqual([]);
});

test("misst Kanten im Fenster: Karten, Rahmen und Fußzeile ja, Formulare (Ruhezone) und Kanten weit unten nein; je Kante Wachstum und Seed", () => {
  document.body.innerHTML = `
    <main>
      <a id="c1" data-season-anchor="card">Eins</a>
      <div id="c2" data-season-perch="card">Zwei</div>
      <section id="fr" data-season-perch="frame">Rahmen</section>
      <form><a id="c3" data-season-anchor="card">Im Formular</a></form>
      <a id="far" data-season-anchor="card">Weit unten</a>
    </main>
    <footer id="foot">Impressum</footer>`;
  box(document.getElementById("c1"), { left: 40, right: 400, top: 100, bottom: 300 });
  box(document.getElementById("c2"), { left: 500, right: 900, top: 100, bottom: 300 });
  box(document.getElementById("fr"), { left: 40, right: 900, top: 400, bottom: 600 });
  box(document.querySelector("form"), { left: 0, right: 1000, top: 620, bottom: 720 });
  box(document.getElementById("c3"), { left: 40, right: 400, top: 630, bottom: 710 });
  box(document.getElementById("far"), { left: 40, right: 400, top: 3000, bottom: 3200 });
  box(document.getElementById("foot"), { left: 0, right: 1200, top: 760, bottom: 960 });
  const win = { scrollX: 0, scrollY: 200, innerWidth: 1280, innerHeight: 800 };
  const caps = measureCaps(document, win, { probe: null, salt: "2026" });
  expect(caps.map((cap) => `${cap.kind}:${cap.element.id}`)).toEqual(["card:c1", "card:c2", "frame:fr", "footer:foot"]);
  const first = caps[0];
  expect(first).toMatchObject({ x: 40, y: 300, width: 360 });
  expect(first.runs).toEqual([{ from: INSET, to: 360 - INSET }]);
  expect(first.growth).toBeGreaterThanOrEqual(0.7);
  expect(first.growth).toBeLessThanOrEqual(1.3);
  expect(first.seed).toContain("2026");
  expect(measureCaps(document, win, { probe: null, salt: "2027" })[0].growth === first.growth && measureCaps(document, win, { probe: null, salt: "2027" })[0].seed === first.seed).toBe(false);
  expect(first.measure()).toEqual({ x: 40, y: 300 });
  document.getElementById("c1").remove();
  expect(first.measure()).toBeNull();
  expect(measureCaps(document, win, { probe: null, max: 2 })).toHaveLength(2);
});
