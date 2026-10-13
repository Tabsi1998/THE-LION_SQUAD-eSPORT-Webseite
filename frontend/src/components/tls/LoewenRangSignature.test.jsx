import { act, render, screen, waitFor } from "@testing-library/react";
import RING from "@/lib/loewenRangRing.json";
import { frameLayout } from "@/lib/loewenRang";
import { MAX_PARTICLES, SIGNATURE_FX } from "@/lib/loewenSignatur";
import { levelFrameConfig } from "./LevelAvatarFrame";
import LoewenRangSignature, { SIGNATURE_BOX } from "./LoewenRangSignature";
import { createSignatureEngine, fallbackEdge, signatureGeometry } from "./loewenSignaturEngine";

// Löwen-Rang Teil 2 (#1455): Canvas über dem Rahmen, nur mit Bewegung, Partikel an der Außenkante, Gesicht bleibt frei.

vi.mock("@/lib/api", () => ({ api: { get: vi.fn(() => Promise.resolve({ data: { crowns: {} } })) } }));

/** Ein 2D-Kontext, der nur mitschreibt - jsdom kann nicht zeichnen. */
function fakeContext(calls = []) {
  const gradient = { addColorStop() {} };
  return new Proxy({ calls }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "createRadialGradient" || prop === "createLinearGradient") return () => gradient;
      return (...args) => { calls.push([prop, ...args]); };
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

function fakeCanvas(width = 456, height = 513) {
  const ctx = fakeContext();
  return { clientWidth: width, clientHeight: height, width: 0, height: 0, ctx, getContext: () => ctx };
}

function setReducedMotion(matches) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({ matches: matches && query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
}

function props(level) {
  const cfg = levelFrameConfig(level);
  return { level, fit: cfg.fit, scale: cfg.scale, ox: cfg.ox, oy: cfg.oy, ring: cfg.ring };
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => fakeContext());
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ 12: { edge: [[0.5, 0.05], [0.9, 0.5], [0.1, 0.5]] } }) })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.matchMedia;
});

test("Profil Level 58: zwei Leinwände ohne Klicks und für Vorleser verborgen, Signatur Sturmfeuer", async () => {
  const { container } = render(<LoewenRangSignature {...props(58)} />);
  const front = await screen.findByTestId("loewen-signature");
  expect(front.dataset.signature).toBe("storm");
  expect(front.dataset.intensity).toBe("0.60");
  expect(front.dataset.layers).toBe("flames crackle clouds");
  const canvases = container.querySelectorAll("canvas.tls-lvf-sig");
  expect(canvases).toHaveLength(2);
  canvases.forEach((canvas) => expect(canvas).toHaveAttribute("aria-hidden", "true"));
  expect(container.querySelector(".tls-lvf-sig--back")).toBeTruthy();
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(String(fetch.mock.calls[0][0])).toMatch(/^\/assets\/loewen-rang\/geometry\.json\?v=/);
});

test("Bewegung reduzieren: kein Canvas", () => {
  setReducedMotion(true);
  const { container } = render(<LoewenRangSignature {...props(60)} />);
  expect(container.querySelector("canvas")).toBeNull();
});

test("erstes Level im Rang: nur Glanz, kein Canvas", () => {
  const { container } = render(<LoewenRangSignature {...props(55)} />);
  expect(container.querySelector("canvas")).toBeNull();
});

test("Geometrie: Foto und Grafik liegen auf der Leinwand wie im Rahmen", () => {
  const cfg = levelFrameConfig(57);
  const S = 285;
  const g = signatureGeometry({ width: S * SIGNATURE_BOX.width, box: SIGNATURE_BOX, fit: cfg.fit, scale: cfg.scale, ox: cfg.ox, oy: cfg.oy });
  const d = cfg.fit.photo * S;
  expect(g.S).toBeCloseTo(S, 6);
  expect(g.P).toBeCloseTo(d / 2, 6);
  expect(g.ax).toBeCloseTo((SIGNATURE_BOX.left + cfg.fit.left) * S + d / 2, 6);
  // Ringmitte der Grafik (cx, cy) liegt genau auf der Fotomitte, Ring so groß wie das Foto.
  const ring = RING[cfg.key];
  const { F } = frameLayout(d / 2, ring);
  expect(g.F).toBeCloseTo(F, 6);
  expect(g.fx + ring.cx * g.F).toBeCloseTo(g.ax, 6);
  expect(g.fy + ring.cy * g.F).toBeCloseTo(g.ay, 6);
});

test("Gesicht frei: die vordere Leinwand spart den Fotokreis aus", () => {
  const cfg = levelFrameConfig(60);
  const back = fakeCanvas();
  const front = fakeCanvas();
  const layout = (width) => signatureGeometry({ width, box: SIGNATURE_BOX, fit: cfg.fit, scale: cfg.scale, ox: cfg.ox, oy: cfg.oy });
  const engine = createSignatureEngine({ back, front, fx: "storm", k: 1, edge: fallbackEdge(cfg.ring), layout });
  engine.frame(16);
  const g = layout(front.clientWidth);
  const clip = front.ctx.calls.findIndex(([name, rule]) => name === "clip" && rule === "evenodd");
  expect(clip).toBeGreaterThan(-1);
  const hole = front.ctx.calls.slice(0, clip).find(([name]) => name === "arc");
  expect(hole.slice(1, 4)).toEqual([g.ax, g.ay, g.P]);
});

test("Obergrenze: auch volles Sturmfeuer bleibt unter MAX_PARTICLES", () => {
  const cfg = levelFrameConfig(60);
  const engine = createSignatureEngine({
    back: fakeCanvas(), front: fakeCanvas(), fx: "storm", k: 1, edge: fallbackEdge(cfg.ring),
    layout: (width) => signatureGeometry({ width, box: SIGNATURE_BOX, fit: cfg.fit, scale: cfg.scale, ox: cfg.ox, oy: cfg.oy }),
  });
  let max = 0;
  for (let i = 1; i <= 240; i++) {
    engine.frame(i * 50);
    max = Math.max(max, engine.particles);
  }
  expect(max).toBeGreaterThan(50);
  expect(max).toBeLessThanOrEqual(MAX_PARTICLES);
});

function engineFor(level, fx, k) {
  const cfg = levelFrameConfig(level);
  return createSignatureEngine({
    back: fakeCanvas(), front: fakeCanvas(), fx, k, edge: fallbackEdge(cfg.ring),
    layout: (width) => signatureGeometry({ width, box: SIGNATURE_BOX, fit: cfg.fit, scale: cfg.scale, ox: cfg.ox, oy: cfg.oy }),
  });
}

test("Obergrenze Goldmähne: Goldwirbel, Funkeln und Goldströme zusammen höchstens MAX_PARTICLES", () => {
  const engine = engineFor(29, "gold", 1);
  let max = 0;
  // 60 Bilder je Sekunde, 8 Sekunden: die Goldströme laufen voll
  for (let i = 1; i <= 480; i++) {
    engine.frame(i * 16);
    max = Math.max(max, engine.drawn);
  }
  expect(max).toBeGreaterThan(150);
  expect(max).toBeLessThanOrEqual(MAX_PARTICLES);
});

test("Obergrenze für alle Ränge: alles Gezeichnete zusammen bleibt unter MAX_PARTICLES", () => {
  for (const fx of SIGNATURE_FX) {
    for (const step of [16, 50]) {
      const engine = engineFor(60, fx, 1);
      let max = 0;
      for (let i = 1; i <= 300; i++) {
        engine.frame(i * step);
        max = Math.max(max, engine.drawn);
      }
      expect(max, `${fx} bei ${step} ms je Bild`).toBeLessThanOrEqual(MAX_PARTICLES);
      expect(max, `${fx} zeichnet etwas`).toBeGreaterThan(0);
    }
  }
});

test("außerhalb des Bildes: keine Schleife, bis der Beobachter „im Bild“ meldet", async () => {
  const observers = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() {}
  });
  const raf = vi.fn(() => 7);
  const cancel = vi.fn();
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  render(<LoewenRangSignature {...props(58)} />);
  await waitFor(() => expect(observers).toHaveLength(1));
  expect(raf).not.toHaveBeenCalled();
  act(() => observers[0].callback([{ isIntersecting: true }]));
  expect(raf).toHaveBeenCalledTimes(1);
  act(() => observers[0].callback([{ isIntersecting: false }]));
  expect(cancel).toHaveBeenCalledWith(7);
});

test("Stärke 0: die Signatur zeichnet nichts", () => {
  const cfg = levelFrameConfig(30);
  const engine = createSignatureEngine({
    back: fakeCanvas(), front: fakeCanvas(), fx: "fire", k: 0, edge: fallbackEdge(cfg.ring),
    layout: (width) => signatureGeometry({ width, box: SIGNATURE_BOX, fit: cfg.fit, scale: cfg.scale, ox: cfg.ox, oy: cfg.oy }),
  });
  for (let i = 1; i <= 40; i++) engine.frame(i * 50);
  expect(engine.particles).toBe(0);
  expect(engine.layers).toEqual([]);
});

test("Ersatz-Kante: Punkte knapp außerhalb des Rings, solange die Kantenpunkte fehlen", () => {
  const ring = RING["07"];
  const edge = fallbackEdge(ring, 12);
  expect(edge).toHaveLength(12);
  for (const [u, v] of edge) expect(Math.hypot(u - ring.cx, v - ring.cy)).toBeGreaterThan(ring.r);
});
