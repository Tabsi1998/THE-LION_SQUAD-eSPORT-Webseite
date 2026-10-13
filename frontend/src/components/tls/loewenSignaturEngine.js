// Löwen-Rang Teil 2 (#1455): die Signatur als Partikel auf zwei Leinwänden - eine hinter Foto und Rahmen (Licht,
// Nebel, Wolken, Strahlen), eine davor (Funken, Flammen, Blitze). Optik aus dem Prototyp (lsw-art/vorlage), hier ohne
// DOM-Zugriffe im Bild: Die Geometrie kommt als Zahlen herein, die Leinwände nur zum Zeichnen.
// Regeln: Partikel starten an der Außenkante des Rahmens; über dem Foto zeichnet die vordere Leinwand nichts (der
// Fotokreis ist ausgespart), damit kein Effekt das Gesicht verdeckt. Höchstens MAX_PARTICLES gleichzeitig.
// Farben: Schwarz, Gold, Cyan und die Materialfarben der Ränge (Stahl, Bronze, Frost hellblau, Feuer orange).
import { MAX_PARTICLES, signatureLayers } from "@/lib/loewenSignatur";

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[(Math.random() * list.length) | 0];

/** Wie viele Ereignisse in `dt` Sekunden bei `rate` je Sekunde - der Rest wird gewürfelt. */
function count(rate, dt) {
  const n = rate * dt;
  return Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
}

/** Ersatz-Kante, solange die gemessenen Kantenpunkte fehlen: ein Kreis knapp außerhalb des Rings. */
export function fallbackEdge(ring, n = 96) {
  const r = Math.min(0.48, ring.r * 1.3);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * TAU;
    return [ring.cx + Math.cos(a) * r, ring.cy + Math.sin(a) * r];
  });
}

/**
 * Wo Foto und Grafik auf der Leinwand liegen (CSS-Pixel). `box` ist die Leinwand in Einheiten der Fläche S
 * (left/top: wie weit sie links/oben über die Fläche ragt), `fit` die Lage des Fotos in der Fläche (frameFit),
 * `scale`/`ox`/`oy` Größe und Versatz der Grafik in Vielfachen des Foto-Durchmessers (levelFrameConfig).
 */
export function signatureGeometry({ width, box, fit, scale, ox, oy }) {
  const S = width / box.width;
  const d = fit.photo * S;
  const ax = (box.left + fit.left) * S + d / 2;
  const ay = (box.top + fit.top) * S + d / 2;
  const F = d * scale;
  return { S, P: d / 2, ax, ay, F, fx: ax + ox * d - F / 2, fy: ay + oy * d - F / 2, sc: d / 2 / 86 };
}

/** Eine weiche Lichtkugel als kleines Bild - einmal gezeichnet statt bei jedem Partikel ein Verlauf. */
function sprite(stops) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext?.("2d");
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  stops.forEach(([at, color]) => gradient.addColorStop(at, color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return canvas;
}

const SPARK_COLORS = {
  cyan: (q) => `rgba(180,240,255,${q})`,
  gold: (q) => `rgba(255,220,110,${q})`,
  bronze: (q) => `rgba(240,170,110,${q})`,
  steel: (q) => `rgba(255,${(200 + 55 * q) | 0},150,${q})`,
};

/**
 * Startet nichts von selbst: `frame(now)` zeichnet ein Bild, `resize()` passt die Leinwände an, `reset()` leert die
 * Partikel. Die Schleife (requestAnimationFrame, Sichtbarkeit) steuert die Komponente.
 */
export function createSignatureEngine({ back, front, fx, k, edge, layout, dpr = 1 }) {
  const layers = new Set(signatureLayers(fx, k));
  const on = (name) => layers.has(name);
  const bctx = back?.getContext?.("2d") || null;
  const fctx = front?.getContext?.("2d") || null;
  const flames = {
    cyan: sprite([[0, "rgba(225,250,255,0.9)"], [0.35, "rgba(41,182,232,0.7)"], [1, "rgba(0,0,0,0)"]]),
    fire: sprite([[0, "rgba(255,240,190,0.95)"], [0.3, "rgba(255,140,20,0.75)"], [1, "rgba(0,0,0,0)"]]),
  };
  const upper = edge.filter(([, v]) => v < 0.62);
  const pawEdge = edge.filter(([u, v]) => v > 0.86 && Math.abs(u - 0.5) < 0.1);
  let w = 1;
  let h = 1;
  let g = null;
  let parts = [];
  let bolts = [];
  let waves = [];
  let flash = 0;
  let last = 0;
  const timers = { spark: 0, crack: 0, bolt: 2, twink: 0, paw: 0, wave: 0, slash: 1 };
  const orbit = Array.from({ length: 220 }, () => ({ a: rnd(0, TAU), r: rnd(0.33, 0.52), w: rnd(0.12, 0.42), s: rnd(0.8, 2.2), p: rnd(0, TAU) }));
  const dust = Array.from({ length: 60 }, () => ({ a: rnd(0, TAU), r: rnd(0.9, 2.6), v: rnd(0.02, 0.08), s: rnd(0.5, 1.6), p: rnd(0, TAU) }));
  const clouds = Array.from({ length: 9 }, (_, i) => ({ a: (i / 9) * TAU + rnd(-0.3, 0.3), r: rnd(1.6, 2.6), s: rnd(1.1, 1.9), v: rnd(0.02, 0.05) }));

  const room = () => parts.length < MAX_PARTICLES;
  const at = (u, v) => ({ x: g.fx + u * g.F, y: g.fy + v * g.F });
  const edgePoint = (list = edge) => {
    const [u, v] = pick(list);
    return at(u, v);
  };

  function resize() {
    for (const canvas of [back, front]) {
      if (!canvas) continue;
      const cw = canvas.clientWidth || 0;
      const ch = canvas.clientHeight || 0;
      canvas.width = Math.max(1, Math.round(cw * dpr));
      canvas.height = Math.max(1, Math.round(ch * dpr));
      canvas.getContext?.("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      w = cw || w;
      h = ch || h;
    }
    g = layout(w, h);
  }

  function emitFlame(color) {
    if (!room()) return;
    const p = edgePoint();
    parts.push({ t: "flame", x: p.x, y: p.y, vx: rnd(-14, 14) * g.sc, vy: rnd(-70, -35) * g.sc, life: rnd(0.45, 0.95), max: 0.95, s: rnd(5, 12) * (g.F / 340), col: color });
  }
  function emitSpark(x, y, n, spread, col) {
    for (let i = 0; i < n && room(); i++) {
      const a = rnd(-Math.PI / 2 - spread, -Math.PI / 2 + spread) + Math.PI;
      const v = rnd(120, 340) * g.sc;
      parts.push({ t: "spark", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60 * g.sc, life: rnd(0.35, 0.8), max: 0.8, col });
    }
  }
  function emitMote(x, y, vx, vy, life, col) {
    if (room()) parts.push({ t: "mote", x, y, vx: vx * g.sc, vy: vy * g.sc, life, max: life, col });
  }
  function emitStar(x, y, s, ice = false, life = 0.5) {
    if (room()) parts.push({ t: "star", x, y, life, max: life, s: s * g.sc, ice });
  }
  // Knistern: kurze Entladung von der Kante nach außen.
  function crackle() {
    const p = edgePoint();
    const ang = Math.atan2(p.y - g.ay, p.x - g.ax) + rnd(-0.6, 0.6);
    const pts = [[p.x, p.y]];
    let { x, y } = p;
    const n = 4 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      x += (Math.cos(ang) * rnd(5, 10) + rnd(-6, 6)) * g.sc;
      y += (Math.sin(ang) * rnd(5, 10) + rnd(-6, 6)) * g.sc;
      pts.push([x, y]);
    }
    bolts.push({ pts, life: 0.12, max: 0.12, w: 1.2 });
  }
  // Blitz: vom oberen Rand der Leinwand in die Oberkante des Rahmens, mit Verästelungen.
  function lightning(strong) {
    const end = edgePoint(upper.length ? upper : edge);
    const sx = end.x + rnd(-80, 80) * g.sc;
    const pts = [[sx, 0]];
    const segs = 14;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      pts.push([sx + (end.x - sx) * t + (i < segs ? rnd(-22, 22) * (1 - t * 0.4) * g.sc : 0), end.y * t]);
    }
    bolts.push({ pts, life: strong ? 0.38 : 0.26, max: strong ? 0.38 : 0.26, w: strong ? 3.6 : 2.4 });
    for (let b = 0; b < (strong ? 3 : 1); b++) {
      const i0 = 3 + ((Math.random() * 8) | 0);
      const branch = [pts[i0]];
      let [x, y] = pts[i0];
      for (let i = 0; i < 4; i++) {
        x += rnd(-26, 26) * g.sc;
        y += rnd(8, 22) * g.sc;
        branch.push([x, y]);
      }
      bolts.push({ pts: branch, life: 0.2, max: 0.2, w: 1.2 });
    }
    flash = Math.max(flash, strong ? 0.55 : 0.25);
    emitSpark(end.x, end.y, strong ? 40 : 14, 1.2, "cyan");
  }
  // Krallenhieb: drei Striche schräg über den Rahmen, seitlich vom Foto - nie über das Gesicht.
  function slash() {
    const side = Math.random() < 0.5 ? -1 : 1;
    const ang = rnd(-0.9, -0.4);
    const len = g.F * 0.3;
    const cx = g.ax + side * (g.P + g.F * 0.1);
    const cy = g.ay + rnd(-0.25, 0.15) * g.F;
    parts.push({ t: "slash", x1: cx - (Math.cos(ang) * len) / 2, y1: cy - (Math.sin(ang) * len) / 2, x2: cx + (Math.cos(ang) * len) / 2, y2: cy + (Math.sin(ang) * len) / 2, life: 0.35, max: 0.35 });
    emitSpark(cx, cy, 10, Math.PI, "bronze");
  }

  // Hintere Leinwand: Licht und Nebel liegen hinter Foto und Rahmen und scheinen nur außen und durch Lücken.
  function drawBack(a, dt, t) {
    if (fx === "spark" && on("dust")) {
      a.globalCompositeOperation = "lighter";
      const nd = Math.round(8 + 40 * Math.min(1, k * 1.5));
      for (let i = 0; i < nd; i++) {
        const d = dust[i];
        d.a += d.v * dt;
        const x = g.ax + Math.cos(d.a) * d.r * g.P;
        const y = g.ay + Math.sin(d.a) * d.r * g.P * 0.8 - Math.sin(t * 0.3 + d.p) * 10 * g.sc;
        a.fillStyle = `rgba(220,228,236,${0.12 + 0.14 * Math.sin(t + d.p) ** 2})`;
        a.beginPath();
        a.arc(x, y, d.s * g.sc, 0, TAU);
        a.fill();
      }
    }
    if (fx === "frost" && on("mist")) {
      a.globalCompositeOperation = "lighter";
      const mist = a.createRadialGradient(g.ax, g.ay, g.P, g.ax, g.ay, g.F * 0.8);
      mist.addColorStop(0, `rgba(160,210,240,${0.06 + 0.14 * k})`);
      mist.addColorStop(1, "rgba(0,0,0,0)");
      a.fillStyle = mist;
      a.fillRect(0, 0, w, h);
    }
    if (fx === "storm" && on("clouds")) {
      const cl = Math.min(1, (k - 0.5) * 2.2);
      for (const c of clouds) {
        c.a += c.v * dt;
        const x = g.ax + Math.cos(c.a) * c.r * g.P;
        const y = g.ay + Math.sin(c.a) * c.r * g.P * 0.6 - g.P * 0.3;
        const rad = c.s * g.P;
        const lit = flash * 1.4;
        const gr = a.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, `rgba(${(30 + lit * 120) | 0},${(55 + lit * 150) | 0},${(70 + lit * 160) | 0},${0.38 * cl})`);
        gr.addColorStop(1, "rgba(10,20,26,0)");
        a.fillStyle = gr;
        a.beginPath();
        a.arc(x, y, rad, 0, TAU);
        a.fill();
      }
    }
    if (fx === "lava") {
      const n = Math.round(2 + 6 * k);
      for (let i = 0; i < n; i++) {
        const c = clouds[i];
        c.a += c.v * dt * 0.6;
        const x = g.ax + Math.cos(c.a) * c.r * g.P * 0.8;
        const y = g.ay - g.P * 1.1 - ((t * 12 + i * 37) % 80) * g.sc;
        const rad = c.s * g.P * 0.6;
        const gr = a.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, `rgba(40,36,34,${0.25 + 0.2 * k})`);
        gr.addColorStop(1, "rgba(20,18,16,0)");
        a.fillStyle = gr;
        a.beginPath();
        a.arc(x, y, rad, 0, TAU);
        a.fill();
      }
      // Glühende Risse: orangefarbenes Leuchten rund um den Rahmen, ab „Risse pulsieren“ mit Puls.
      const pulse = on("pulse") ? 0.6 + 0.4 * Math.sin(t * 2.4) : 0.8;
      a.globalCompositeOperation = "lighter";
      const glow = a.createRadialGradient(g.ax, g.ay, g.P, g.ax, g.ay, g.F * (0.56 + 0.06 * k));
      glow.addColorStop(0, "rgba(255,120,20,0)");
      glow.addColorStop(0.55, `rgba(255,120,20,${((0.18 + 0.3 * k) * pulse).toFixed(3)})`);
      glow.addColorStop(1, "rgba(255,120,20,0)");
      a.fillStyle = glow;
      a.fillRect(0, 0, w, h);
    }
    if (fx === "sun" && on("rays")) {
      a.globalCompositeOperation = "lighter";
      const nr = 18 + Math.round(18 * k);
      const len = g.F * (0.55 + 0.35 * k);
      for (let i = 0; i < nr; i++) {
        const ang = (i / nr) * TAU + t * 0.08;
        const x2 = g.ax + Math.cos(ang) * len;
        const y2 = g.ay + Math.sin(ang) * len;
        const gr = a.createLinearGradient(g.ax, g.ay, x2, y2);
        gr.addColorStop(0.35, "rgba(255,215,0,0)");
        gr.addColorStop(0.6, `rgba(255,220,110,${0.06 + 0.16 * k})`);
        gr.addColorStop(1, "rgba(255,220,110,0)");
        a.strokeStyle = gr;
        a.lineWidth = (6 + 10 * k) * g.sc;
        a.beginPath();
        a.moveTo(g.ax, g.ay);
        a.lineTo(x2, y2);
        a.stroke();
      }
    }
    a.globalCompositeOperation = "source-over";
  }

  // Neue Partikel je Signatur.
  function emit(dt, t) {
    if (!layers.size) return t;
    switch (fx) {
      case "spark":
        if (on("sparks")) {
          timers.spark -= dt;
          if (timers.spark <= 0) {
            timers.spark = rnd(0.6, 1.6) / (k + 0.2);
            const p = edgePoint(pawEdge.length ? pawEdge : edge);
            emitSpark(p.x, p.y, 6 + ((k * 10) | 0), 0.9, "steel");
          }
        }
        break;
      case "paw":
        timers.paw -= dt;
        if (timers.paw <= 0 && room()) {
          timers.paw = rnd(0.5, 1.3) / (k + 0.25);
          const ang = rnd(0, TAU);
          const rr = g.F * rnd(0.5, 0.56);
          parts.push({ t: "paw", x: g.ax + Math.cos(ang) * rr, y: g.ay + Math.sin(ang) * rr * 0.92, rot: ang + Math.PI / 2, life: 1.8, max: 1.8, cyan: on("cyan") });
        }
        break;
      case "ember": {
        // Glut aus dem Wappen unten: fächert seitlich nach außen, weg vom Gesicht.
        for (let n = count(6 + 46 * k, dt); n > 0; n--) {
          const p = at(0.5 + rnd(-0.07, 0.07), 0.9);
          const side = Math.random() < 0.5 ? -1 : 1;
          emitMote(p.x, p.y, side * rnd(20, 60), rnd(-40, -10), rnd(0.9, 1.8), "ember");
        }
        if (on("edge") && Math.random() < 0.3) {
          const p = edgePoint();
          emitMote(p.x, p.y, rnd(-10, 10), rnd(-50, -20), 1, "ember");
        }
        break;
      }
      case "hunt":
        timers.spark -= dt;
        if (timers.spark <= 0) {
          timers.spark = rnd(0.3, 0.9) / (k + 0.2);
          const p = edgePoint();
          emitSpark(p.x, p.y, 3 + ((k * 6) | 0), Math.PI, "bronze");
        }
        if (on("slash")) {
          timers.slash -= dt;
          if (timers.slash <= 0) {
            timers.slash = k >= 1 ? rnd(1.4, 2.4) : rnd(3, 5);
            slash();
          }
        }
        break;
      case "frost":
        if (on("snow")) {
          for (let n = count(10 + 70 * k, dt); n > 0 && room(); n--) {
            parts.push({ t: "snow", x: g.ax + rnd(-1, 1) * g.F * 0.7, y: g.ay - g.F * 0.6, vx: rnd(-10, 10) * g.sc, vy: rnd(20, 45) * g.sc, life: rnd(2, 3.2), max: 3.2, s: rnd(1, 2.6) * g.sc });
          }
        }
        if (on("twinkle")) {
          timers.twink -= dt;
          if (timers.twink <= 0) {
            timers.twink = rnd(0.06, 0.25) / k;
            const p = edgePoint();
            emitStar(p.x, p.y, rnd(4, 9), true, 0.6);
          }
        }
        break;
      case "gold":
        if (on("twinkle")) {
          timers.twink -= dt;
          if (timers.twink <= 0) {
            timers.twink = rnd(0.05, 0.2) / k;
            const p = edgePoint();
            emitStar(p.x, p.y, rnd(5, 10));
          }
        }
        if (on("stream")) {
          for (let i = 0; i < 3; i++) {
            const p = at(0.5 + rnd(-0.04, 0.04), 0.1);
            emitMote(p.x, p.y, rnd(-12, 12), rnd(-90, -50), rnd(0.8, 1.5), "gold");
          }
        }
        break;
      case "fire":
        for (let n = count(30 + 280 * k, dt); n > 0; n--) emitFlame("fire");
        if (on("embers")) {
          timers.spark -= dt;
          if (timers.spark <= 0) {
            timers.spark = rnd(0.15, 0.4);
            const p = edgePoint(upper.length ? upper : edge);
            emitMote(p.x, p.y, rnd(-20, 20), rnd(-110, -60), rnd(0.6, 1.2), "ember");
          }
        }
        break;
      case "roar":
        timers.wave -= dt;
        if (timers.wave <= 0) {
          timers.wave = 2.6 - 1.9 * k;
          const m = at(0.5, 0.27);
          waves.push({ t: 0, d: 1.1, x: m.x, y: m.y, r0: 6 * g.sc, grow: g.F * (on("quake") ? 1.05 : 0.9), col: "255,215,90", w: on("quake") ? 12 : 10 });
        }
        break;
      case "feather":
        timers.paw -= dt;
        if (timers.paw <= 0 && room()) {
          timers.paw = rnd(0.3, 0.9) / (k + 0.1);
          const side = Math.random() < 0.5 ? -1 : 1;
          const p = at(0.5 + side * rnd(0.3, 0.45), rnd(0.2, 0.45));
          parts.push({ t: "feather", x: p.x, y: p.y, vx: side * rnd(5, 25) * g.sc, vy: rnd(18, 40) * g.sc, life: rnd(2.6, 3.8), max: 3.8, rot: rnd(0, TAU), spin: rnd(-2, 2), cyan: on("cyan") && Math.random() < 0.5 });
        }
        break;
      case "lava":
        if (on("embers")) {
          for (let n = count(8 + 50 * k, dt); n > 0; n--) {
            const p = edgePoint();
            emitMote(p.x, p.y, rnd(-14, 14), rnd(-70, -30), rnd(0.7, 1.4), "ember");
          }
        }
        break;
      case "sun":
        if (on("flares")) {
          timers.twink -= dt;
          if (timers.twink <= 0) {
            timers.twink = rnd(0.4, 1.2) / k;
            const p = at(0.5, 0.12);
            emitStar(p.x, p.y, rnd(14, 26), false, 0.7);
            flash = Math.max(flash, 0.08);
          }
        }
        break;
      case "storm":
        for (let n = count(30 + 300 * k, dt); n > 0; n--) emitFlame("cyan");
        if (on("crackle")) {
          timers.crack -= dt;
          if (timers.crack <= 0) {
            timers.crack = rnd(0.04, 0.18) / k;
            crackle();
          }
        }
        if (on("bolts")) {
          timers.bolt -= dt;
          if (timers.bolt <= 0) {
            timers.bolt = on("fury") ? rnd(1.6, 3.2) : rnd(3.5, 6);
            lightning(on("fury") && Math.random() < 0.4);
          }
        }
        break;
      default:
        break;
    }
    return t;
  }

  // Vordere Leinwand: Goldwirbel, Partikel, Blitze, Wellen - der Fotokreis bleibt frei.
  function drawFront(f, dt, now) {
    const t = now / 1000;
    f.save();
    f.beginPath();
    f.rect(0, 0, w, h);
    f.arc(g.ax, g.ay, g.P, 0, TAU);
    f.clip("evenodd");
    f.globalCompositeOperation = "lighter";
    if (fx === "gold" && on("orbit")) {
      const n = Math.round(30 + 190 * k);
      for (let i = 0; i < n; i++) {
        const o = orbit[i];
        o.a += o.w * dt * (1 + k);
        const rr = o.r + 0.02 * Math.sin(t * 1.3 + o.p);
        const x = g.ax + Math.cos(o.a) * rr * g.F * 0.98;
        const y = g.ay + Math.sin(o.a) * rr * g.F * 0.98;
        f.strokeStyle = `rgba(255,${(205 + 40 * Math.sin(o.p)) | 0},90,${0.3 + 0.5 * Math.sin(t * 2 + o.p) ** 2})`;
        f.lineWidth = o.s * 0.9 * g.sc;
        f.beginPath();
        f.moveTo(x, y);
        f.lineTo(x + Math.sin(o.a) * 18 * o.w * g.sc, y - Math.cos(o.a) * 18 * o.w * g.sc);
        f.stroke();
      }
    }
    parts = parts.filter((p) => (p.life -= dt) > 0);
    for (const p of parts) {
      const q = p.life / p.max;
      if (p.t === "flame") {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy -= 30 * dt * g.sc;
        const s = p.s * (0.4 + 0.6 * q);
        const img = flames[p.col];
        if (img) {
          f.globalAlpha = q;
          f.drawImage(img, p.x - s, p.y - s, s * 2, s * 2);
          f.globalAlpha = 1;
        }
      } else if (p.t === "spark") {
        p.vy += 520 * dt * g.sc;
        const x0 = p.x;
        const y0 = p.y;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        f.strokeStyle = (SPARK_COLORS[p.col] || SPARK_COLORS.steel)(q);
        f.lineWidth = 1.6;
        f.beginPath();
        f.moveTo(x0, y0);
        f.lineTo(p.x, p.y);
        f.stroke();
      } else if (p.t === "star") {
        const s = p.s * Math.sin(q * Math.PI);
        f.fillStyle = p.ice ? `rgba(200,240,255,${q})` : `rgba(255,248,210,${q})`;
        f.beginPath();
        f.moveTo(p.x, p.y - s);
        f.lineTo(p.x + s * 0.22, p.y);
        f.lineTo(p.x, p.y + s);
        f.lineTo(p.x - s * 0.22, p.y);
        f.closePath();
        f.moveTo(p.x - s, p.y);
        f.lineTo(p.x, p.y + s * 0.22);
        f.lineTo(p.x + s, p.y);
        f.lineTo(p.x, p.y - s * 0.22);
        f.closePath();
        f.fill();
      } else if (p.t === "paw") {
        const q2 = Math.sin(q * Math.PI);
        f.save();
        f.translate(p.x, p.y);
        f.rotate(p.rot);
        f.scale(g.sc, g.sc);
        f.fillStyle = p.cyan ? `rgba(120,220,255,${0.85 * q2})` : `rgba(230,236,242,${0.7 * q2})`;
        f.beginPath();
        f.ellipse(0, 3, 5, 4, 0, 0, TAU);
        f.fill();
        for (const [x, y] of [[-5, -4], [-2, -7], [2, -7], [5, -4]]) {
          f.beginPath();
          f.arc(x, y, 1.8, 0, TAU);
          f.fill();
        }
        f.restore();
      } else if (p.t === "snow") {
        p.x += p.vx * dt + Math.sin(now / 500 + p.s) * 0.3;
        p.y += p.vy * dt;
        f.fillStyle = `rgba(220,240,255,${0.8 * q})`;
        f.beginPath();
        f.arc(p.x, p.y, p.s, 0, TAU);
        f.fill();
      } else if (p.t === "feather") {
        p.x += p.vx * dt + Math.sin(now / 600 + p.rot) * 0.6;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
        f.save();
        f.translate(p.x, p.y);
        f.rotate(Math.sin(now / 500 + p.rot) * 0.8);
        f.scale(g.sc, g.sc);
        const gr = f.createLinearGradient(0, -9, 0, 9);
        gr.addColorStop(0, p.cyan ? `rgba(160,235,255,${q})` : `rgba(255,240,170,${q})`);
        gr.addColorStop(1, p.cyan ? `rgba(41,182,232,${0.3 * q})` : `rgba(212,165,20,${0.3 * q})`);
        f.fillStyle = gr;
        f.beginPath();
        f.ellipse(0, 0, 2.8, 9, 0, 0, TAU);
        f.fill();
        f.restore();
      } else if (p.t === "slash") {
        f.lineCap = "round";
        f.strokeStyle = `rgba(255,225,190,${q})`;
        f.lineWidth = 3 * q + 0.5;
        for (let j = 0; j < 3; j++) {
          const off = (j - 1) * 9 * g.sc;
          f.beginPath();
          f.moveTo(p.x1 + off, p.y1);
          f.lineTo(p.x2 + off, p.y2);
          f.stroke();
        }
      } else if (p.t === "mote") {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        f.fillStyle = p.col === "ember" ? `rgba(255,${(120 + 80 * q) | 0},40,${q})` : `rgba(255,215,100,${q})`;
        f.beginPath();
        f.arc(p.x, p.y, 1.6 * Math.max(0.75, g.sc), 0, TAU);
        f.fill();
      }
    }
    bolts = bolts.filter((b) => (b.life -= dt) > 0);
    f.lineJoin = "round";
    for (const b of bolts) {
      const q = b.life / b.max;
      for (const [lw, col] of [[b.w * 5, `rgba(41,182,232,${0.25 * q})`], [b.w * 2, `rgba(140,225,255,${0.7 * q})`], [b.w * 0.7, `rgba(255,255,255,${q})`]]) {
        f.strokeStyle = col;
        f.lineWidth = lw;
        f.beginPath();
        b.pts.forEach(([x, y], i) => (i ? f.lineTo(x, y) : f.moveTo(x, y)));
        f.stroke();
      }
    }
    // Schallwellen gehen vom Maul nach oben und außen - weg vom Gesicht.
    waves = waves.filter((wave) => (wave.t += dt) < wave.d);
    for (const wave of waves) {
      const q = wave.t / wave.d;
      f.strokeStyle = `rgba(${wave.col},${((1 - q) * 0.85).toFixed(2)})`;
      f.lineWidth = (wave.w * (1 - q) + 1) * g.sc;
      f.beginPath();
      f.arc(wave.x, wave.y, wave.r0 + q * wave.grow, Math.PI * 1.1, Math.PI * 1.9);
      f.stroke();
    }
    if (flash > 0) {
      f.fillStyle = `rgba(210,245,255,${flash * 0.5})`;
      f.fillRect(0, 0, w, h);
      flash = Math.max(0, flash - dt * 2.2);
    }
    f.restore();
    f.globalCompositeOperation = "source-over";
  }

  /** Ein Bild: Zeit seit dem letzten (höchstens 50 ms), neue Partikel, beide Leinwände. */
  function frame(now) {
    if (!g) resize();
    const dt = last ? Math.min(0.05, Math.max(0, (now - last) / 1000)) : 0.016;
    last = now;
    const t = now / 1000;
    if (bctx) {
      bctx.clearRect(0, 0, w, h);
      drawBack(bctx, dt, t);
    }
    emit(dt, t);
    if (fctx) {
      fctx.clearRect(0, 0, w, h);
      drawFront(fctx, dt, now);
    } else {
      parts = parts.filter((p) => (p.life -= dt) > 0);
    }
  }

  return {
    frame,
    resize,
    /** Nach einer Pause neu ansetzen: keine riesige Zeitspanne nachholen. */
    resume() {
      last = 0;
    },
    reset() {
      parts = [];
      bolts = [];
      waves = [];
      flash = 0;
    },
    get particles() {
      return parts.length;
    },
    get layers() {
      return [...layers];
    },
  };
}
