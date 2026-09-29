import { QUIET_SELECTOR, measureQuietZones, overlayZones, pointInQuiet, rectInQuiet, watchOverlays } from "./quiet";

// Ruhezonen (H10): Formulare, Dialoge, Menüs, Tabellen und markierte Bereiche als Rechtecke in Seitenkoordinaten;
// Punkte und Rechtecke fragen nach; geöffnete Dialoge werden beobachtet.

function box(element, rect) {
  element.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top });
}

afterEach(() => { document.body.innerHTML = ""; });

test("misst markierte Bereiche, Formulare, Dialoge und Tabellen - unsichtbare zählen nicht", () => {
  document.body.innerHTML = `
    <div data-season-quiet id="bracket"></div>
    <form id="login"></form>
    <div role="dialog" id="dialog"></div>
    <table id="board"></table>
    <div id="tiny" data-season-quiet></div>
    <p id="text"></p>`;
  box(document.getElementById("bracket"), { left: 100, top: 200, right: 500, bottom: 600 });
  box(document.getElementById("login"), { left: 600, top: 50, right: 900, bottom: 250 });
  box(document.getElementById("dialog"), { left: 300, top: 300, right: 700, bottom: 500 });
  box(document.getElementById("board"), { left: 0, top: 800, right: 400, bottom: 1000 });
  box(document.getElementById("tiny"), { left: 0, top: 0, right: 4, bottom: 4 });
  box(document.getElementById("text"), { left: 0, top: 0, right: 900, bottom: 100 });
  const win = { scrollX: 0, scrollY: 1000 };
  const zones = measureQuietZones(document, win, { padding: 10 });
  expect(zones).toHaveLength(4);
  expect(zones[0]).toMatchObject({ left: 90, top: 1190, right: 510, bottom: 1610, viewTop: 190, overlay: false });
  expect(overlayZones(zones).map((z) => z.element.id)).toEqual(["dialog"]);
  expect(pointInQuiet({ x: 200, y: 1300 }, zones)).toBe(true);
  expect(pointInQuiet({ x: 200, y: 300 }, zones, { fixed: true })).toBe(true);
  expect(pointInQuiet({ x: 950, y: 1300 }, zones)).toBe(false);
  expect(rectInQuiet({ left: 480, top: 1150, right: 520, bottom: 1195 }, zones)).toBe(true);
  expect(rectInQuiet({ left: 520, top: 1150, right: 560, bottom: 1180 }, zones)).toBe(false);
  expect(rectInQuiet({ left: 320, top: 320, right: 340, bottom: 340 }, zones, { fixed: true, overlayOnly: true })).toBe(true);
  expect(rectInQuiet({ left: 120, top: 220, right: 140, bottom: 240 }, zones, { fixed: true, overlayOnly: true })).toBe(false);
  expect(QUIET_SELECTOR).toContain("[data-season-quiet]");
  expect(measureQuietZones(null)).toEqual([]);
});

test("beobachtet geöffnete Dialoge und Menüs entprellt", async () => {
  vi.useFakeTimers();
  const onChange = vi.fn();
  const stop = watchOverlays(onChange, { debounceMs: 50 });
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.appendChild(dialog);
  const plain = document.createElement("span");
  document.body.appendChild(plain);
  await vi.advanceTimersByTimeAsync(10);
  expect(onChange).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60);
  expect(onChange).toHaveBeenCalledTimes(1);
  dialog.remove();
  await vi.advanceTimersByTimeAsync(80);
  expect(onChange).toHaveBeenCalledTimes(2);
  stop();
  const another = document.createElement("div");
  another.setAttribute("role", "menu");
  document.body.appendChild(another);
  await vi.advanceTimersByTimeAsync(100);
  expect(onChange).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
