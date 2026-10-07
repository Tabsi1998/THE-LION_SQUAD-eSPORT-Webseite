// Die Konfetti-Ebene für den gemeinsamen Canvas-Loop (Fasching F1 #745): der Regen beim ersten Aufruf des Tages und
// kleine Explosionen auf Zuruf (Partyhut). Die Stücke gehören zur Seite - beim Scrollen ziehen sie mit wie der Schnee.
// Einige landen kurz auf den Oberkanten von Karten, liegen ein paar Sekunden und verblassen. Danach ist Ruhe: kein
// Dauerregen, der Loop schläft.
import { mulberry32 } from "../rng";
import { wakeSky } from "../sky";
import { rectOf } from "../anchors";
import { REST_MS as CARD_REST_MS, cardKey, createLiftOffsets, createRest, defaultSignal } from "../cardLift";
import { COLORS, burstPieces, pieceAt, rainPieces } from "./confetti";

/** Stücke je Gerät: der Himmel gibt sein Budget (40/60/120/240), Fasching nimmt davon - höchstens 150 bzw. 300. */
export function confettiCap(budget, effective = "normal") {
  const base = Math.max(0, Number(budget) || 0) * 1.25;
  return Math.round(Math.min(effective === "full" ? 300 : 150, base));
}
export const BURST_COUNT = 40;
export const MAX_SECONDS = 14;
export const REST_SHARE = 0.3;
export const REST_MS = [2200, 4200];
const FADE_MS = 600;

const listeners = new Set();

/** Eine Explosion anfordern (Fensterkoordinaten) - jede Konfetti-Ebene, die gerade lebt, nimmt sie auf. */
export function requestBurst(point) {
  listeners.forEach((listener) => listener(point));
  wakeSky();
}

/**
 * Oberkanten, auf denen Konfetti kurz liegen darf: Karten im Fenster (Seitenkoordinaten), am Ruheplatz gemessen (eine
 * gehobene Karte rechnet die Ebene selbst dazu), mit dem Schlüssel der Karte (#1093).
 */
export function landingEdges(doc = typeof document === "undefined" ? null : document, win = typeof window === "undefined" ? null : window) {
  if (!doc || !win || typeof doc.querySelectorAll !== "function") return [];
  const scrollY = Number(win.scrollY) || 0;
  return [...doc.querySelectorAll("[data-season-anchor='card'], [data-season-perch='card']")]
    .map((node) => ({ node, rect: rectOf(node) }))
    .filter(({ rect }) => rect && rect.width >= 80 && rect.bottom > 0 && rect.top < win.innerHeight)
    .slice(0, 24)
    .map(({ node, rect }) => ({ left: rect.left + 6, right: rect.right - 6, top: rect.top + scrollY, key: cardKey(node) }));
}

/** Liegend sieht man ein Stück schräg von vorn: flach, die lange Seite waagrecht, etwas schief. */
const LYING_FLIP = 0.42;
export function lying(piece, rng) {
  const long = Math.max(piece.w, piece.h);
  const short = Math.min(piece.w, piece.h);
  const flat = { ...piece, w: long, h: short };
  return { piece: flat, angle: (rng() - 0.5) * 0.36, lift: (short * LYING_FLIP) / 2 };
}

function drawPiece(ctx, piece, at, alpha) {
  const [front, back] = COLORS[piece.color] || COLORS[0];
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(at.angle);
  // Kippen: nahe 0 sieht man das Stück von der Kante; die Rückseite ist etwas dunkler.
  ctx.scale(1, Math.max(0.08, Math.abs(at.flip)));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = at.flip >= 0 ? front : back;
  const w = piece.w;
  const h = piece.h;
  if (piece.shape === "dot") {
    ctx.beginPath();
    ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (piece.shape === "scrap" && piece.corners) {
    ctx.beginPath();
    piece.corners.forEach((reach, index) => {
      const angle = (index / piece.corners.length) * Math.PI * 2;
      const px = Math.cos(angle) * (w / 2) * reach;
      const py = Math.sin(angle) * (h / 2) * reach;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }
  ctx.restore();
}

/** Eine Uhr, die nicht springt (Zeitumstellung, gestellte Uhr): Millisekunden seit dem Laden der Seite. */
const monotonic = () => (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now());

/**
 * Die Ebene. `rain` lässt beim Start einmal Konfetti regnen, `seed` macht es je Seite und Tag anders, `wind()` liefert
 * die Seitwärts-Geschwindigkeit, `edges()` die Kanten zum Liegenbleiben, `palette` beschränkt die Farben (Indizes in
 * COLORS), `burst` ist die Größe einer Explosion. `clock()` in ms - dieselbe Uhr für Start
 * und Zeichnen; den Zeitstempel des Loops nimmt die Ebene nicht, damit eine Explosion zwischen zwei Bildern nicht
 * aus einer anderen Zeitrechnung kommt.
 */
export function createConfettiLayer({ budget = 120, effective = "normal", seed = 1, rain = false, wind = () => 0, edges = landingEdges, clock = monotonic, win = typeof window === "undefined" ? null : window, palette = null, burst = BURST_COUNT, signal = defaultSignal(win) } = {}) {
  const cap = confettiCap(budget, effective);
  const rng = mulberry32(seed);
  const state = { flying: [], resting: [], ledges: [] };
  // Konfetti wirbelt auf (#1093): hebt sich eine Karte, auf der Stücke liegen, wirbeln sie auf, segeln mit eigener
  // Physik ab und landen tiefer wieder (nie auf derselben Karte). Liegende Stücke fahren beim Anheben mit. Dieselben
  // Stücke - das Budget bleibt, wie es ist.
  const lifts = createLiftOffsets(clock);
  const whirlRest = createRest(CARD_REST_MS.small, clock);
  const onCard = (detail) => {
    lifts.onSignal(detail);
    if (detail.type !== "lift") return;
    const now = clock();
    const lying = state.resting.filter((item) => item.ledgeKey === detail.key && now < item.until);
    if (!lying.length || !whirlRest.take(detail.key)) return;
    state.resting = state.resting.filter((item) => !lying.includes(item));
    const scrollY = scroll();
    const offset = lifts.offset(detail.key);
    lying.forEach((item) => {
      const piece = { ...item.piece, x: item.x, y: item.top - item.lift + offset - scrollY, vx: (rng() - 0.5) * 90, vy: -(110 + rng() * 120), at: 0, angle: item.angle };
      state.flying.push({ piece, start: now, top: scrollY, rests: true, lastY: null, skip: detail.key });
    });
    wakeSky();
  };
  const unsubscribe = signal && typeof signal.subscribe === "function" ? signal.subscribe(onCard) : null;
  const scroll = () => (win ? Number(win.scrollY) || 0 : 0);
  const size = () => (win ? { width: win.innerWidth || 1280, height: win.innerHeight || 800 } : { width: 1280, height: 800 });
  const add = (pieces, origin) => {
    const now = clock();
    const room = Math.max(0, cap - state.flying.length - state.resting.length);
    pieces.slice(0, room).forEach((piece) => state.flying.push({ piece, start: now, top: origin, rests: rng() < REST_SHARE, lastY: null }));
    state.ledges = edges();
  };
  if (rain && cap > 0) add(rainPieces(rng, size(), cap, 2500, palette), scroll());
  const onBurst = (point) => add(burstPieces(rng, point, Math.min(burst, cap), palette), scroll());
  listeners.add(onBurst);

  const draw = (ctx, _dt, view) => {
    const now = clock();
    const scrollY = scroll();
    const drift = wind();
    const stillFlying = [];
    for (const item of state.flying) {
      const t = (now - item.start - item.piece.at) / 1000;
      if (t < 0) {
        stillFlying.push(item);
        continue;
      }
      if (t > MAX_SECONDS) continue;
      const at = pieceAt(item.piece, t, drift);
      const pageY = at.y + item.top;
      // Liegenbleiben: fällt ein Stück durch die Oberkante einer Karte, bleibt es dort kurz liegen.
      if (item.rests && item.lastY !== null && at.flip !== undefined) {
        const ledge = state.ledges.find((edge) => {
          if (edge.key && edge.key === item.skip) return false;
          const top = edge.top + lifts.offset(edge.key);
          return at.x >= edge.left && at.x <= edge.right && item.lastY < top && pageY >= top;
        });
        if (ledge) {
          const hold = REST_MS[0] + rng() * (REST_MS[1] - REST_MS[0]);
          state.resting.push({ ...lying(item.piece, rng), x: at.x, top: ledge.top, until: now + hold, ledgeKey: ledge.key || null });
          continue;
        }
      }
      item.lastY = pageY;
      const screenY = pageY - scrollY;
      if (screenY > view.height + 40) continue;
      if (screenY > -40) drawPiece(ctx, item.piece, { ...at, y: screenY }, 1);
      stillFlying.push(item);
    }
    state.flying = stillFlying;
    state.resting = state.resting.filter((rest) => now < rest.until + FADE_MS);
    for (const rest of state.resting) {
      const alpha = now < rest.until ? 1 : 1 - (now - rest.until) / FADE_MS;
      const screenY = rest.top - rest.lift - scrollY + lifts.offset(rest.ledgeKey);
      if (screenY > -20 && screenY < view.height + 20) drawPiece(ctx, rest.piece, { x: rest.x, y: screenY, angle: rest.angle, flip: LYING_FLIP }, alpha);
    }
  };

  return {
    kind: "confetti",
    draw,
    idle: () => state.flying.length === 0 && state.resting.length === 0,
    snapshot: () => ({ flying: state.flying.length, resting: state.resting.length, cap }),
    /** Nur für Tests: auf welchen Karten gerade Stücke liegen (ohne die, die schon verblassen). */
    restingOn: () => state.resting.filter((item) => clock() < item.until).map((item) => item.ledgeKey),
    dispose: () => {
      listeners.delete(onBurst);
      if (unsubscribe) unsubscribe();
      state.flying = [];
      state.resting = [];
    },
    /** Nur für Tests: das Signal von außen geben. */
    card: onCard,
  };
}
