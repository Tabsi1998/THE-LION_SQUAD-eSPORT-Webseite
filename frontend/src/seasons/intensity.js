// Seitenabhängige Intensität (H17, #705; Seasonal Core C5, #725): jede Seite bleibt saisonal erkennbar, aber die
// Startseite darf mehr als ein Bracket oder ein Formular. Die Seitenklasse kommt aus der Adresse; daraus und aus der
// Stärke (vom Server: full/normal/subtle) folgen Effektklassen - nicht nur wie viel, sondern welche Art Effekt
// erlaubt ist. Eine Saison übersetzt die Klassen in ihre Figuren (Halloween: Fledermäuse, Netze, Nebel, Augen);
// die Regeln bleiben eine Matrix statt vieler if-Abfragen. Ruhezonen (quiet.js) ergänzen das je Element, das
// Bewegungsbudget (motion.js) je Moment. Die App hat dieselbe Matrix in mobile/src/seasons/intensity.ts.

export const PAGE_CLASSES = ["lively", "medium", "calm", "quiet"];

const RULES = [
  { test: (p) => p === "/" || p === "/home", cls: "lively" },
  { test: (p) => /^\/(events|news|gallery|galerie)\/?$/.test(p), cls: "lively" },
  { test: (p) => /^\/(admin|display|setup|consent)(\/|$)/.test(p), cls: "quiet" },
  { test: (p) => /^\/tournaments\/[^/]+\/(bracket|matches|standings)/.test(p), cls: "calm" },
  { test: (p) => /^\/(fastlap|f1)(\/|$)/.test(p), cls: "calm" },
  // Der Adventkalender ist selbst das Bild - die Deko rundherum hält sich zurück.
  { test: (p) => /^\/advent(\/|$)/.test(p), cls: "calm" },
  { test: (p) => /^\/(login|register|contact|kontakt|password-recovery|verify|profile|messages|notifications|privacy-account|membership|members\/membership|my|invoices|checkout|apply)(\/|$)/.test(p), cls: "calm" },
  { test: (p) => /^\/(events|news)\/[^/]+/.test(p), cls: "medium" },
  { test: (p) => /^\/(servers|community|players|teams|u|members|about|verein|partners|sponsors|references|achievements|seasons|tournaments)(\/|$)/.test(p), cls: "medium" },
];

export function pageClass(pathname = "/") {
  const p = String(pathname || "/").replace(/\/+$/, "") || "/";
  for (const rule of RULES) if (rule.test(p)) return rule.cls;
  return "medium";
}

/**
 * Effektklassen, die jede Saison kennt:
 * perch    - Figuren an Ankern (Anzahl)              corner - Deko in Ecken (Anzahl)
 * ambient  - Atmosphäre: none/far/near               watch  - stille Beobachter (Augen, Blicke)
 * motion   - große Bewegungen (Schwarm, Abseilen)    slots  - Plätze im Bewegungsbudget
 * crawl    - Krabbler quer über die Seite             rare   - seltene Ereignisse am Rand
 * scene    - Fußzeilen-Szene: none/small/full         interact - Erschrecken, Sammeln, Klick-Spiele
 */
export const EFFECT_CLASSES = ["perch", "corner", "ambient", "watch", "motion", "slots", "crawl", "rare", "scene", "interact"];

// Effektklassen je Seitenklasse bei normaler Stärke. `full` (Höhepunkt der Saison) hebt an, `subtle` senkt alles auf still.
const MATRIX = {
  lively: { perch: 4, corner: 3, ambient: "near", watch: true, motion: true, slots: 2, crawl: true, rare: true, scene: "full", interact: true },
  medium: { perch: 2, corner: 2, ambient: "far", watch: true, motion: true, slots: 2, crawl: false, rare: false, scene: "full", interact: true },
  calm: { perch: 1, corner: 1, ambient: "far", watch: false, motion: false, slots: 1, crawl: false, rare: false, scene: "small", interact: false },
  quiet: { perch: 0, corner: 0, ambient: "none", watch: false, motion: false, slots: 0, crawl: false, rare: false, scene: "none", interact: false },
};

/** Die Effektklassen einer Seitenklasse bei einer Stärke - saisonneutral. */
export function effectClasses(cls = "medium", intensity = "normal") {
  const base = { cls, ...(MATRIX[cls] || MATRIX.medium) };
  if (intensity === "subtle") {
    return { ...base, perch: 0, corner: Math.min(base.corner, 1), watch: false, motion: false, slots: 0, crawl: false, rare: false, ambient: base.ambient === "none" ? "none" : "far", scene: base.scene === "none" ? "none" : "small", interact: false, subtle: true };
  }
  if (intensity === "full" && cls !== "quiet") {
    return { ...base, perch: base.perch + 1, corner: Math.min(4, base.corner + 1), crawl: base.crawl || cls === "medium", full: true };
  }
  return base;
}

/** Ist eine Effektklasse erlaubt? Zahlen über null, Stufen außer „none“, Schalter an. */
export function allows(caps, effect) {
  const value = caps ? caps[effect] : undefined;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") return value !== "none" && value !== "";
  return Boolean(value);
}

/** Halloween: Schwarmgröße und große Netze je Seitenklasse - der Rest folgt aus den Effektklassen. */
const HALLOWEEN_OWN = {
  lively: { flockRange: [3, 5], webs: 2 },
  medium: { flockRange: [2, 4], webs: 1 },
  calm: { flockRange: [0, 0], webs: 1 },
  quiet: { flockRange: [0, 0], webs: 0 },
};

function halloweenKeys(fx, { narrow = false } = {}) {
  const own = HALLOWEEN_OWN[fx.cls] || HALLOWEEN_OWN.medium;
  let flockRange = fx.motion ? own.flockRange : [0, 0];
  if (fx.full) flockRange = fx.cls === "lively" ? [5, 8] : fx.motion ? [3, 5] : [0, 0];
  if (narrow) flockRange = fx.motion ? [Math.min(flockRange[0], 2), Math.min(flockRange[1], 3)] : [0, 0];
  return {
    hangingBats: fx.perch,
    flock: fx.motion,
    flockRange,
    webs: narrow ? Math.min(own.webs, 1) : own.webs,
    cornerWebs: fx.corner,
    rappel: fx.motion,
    crawler: fx.crawl,
    wisps: fx.motion,
    eyes: fx.watch,
    rareEvents: fx.rare,
    fog: fx.ambient,
    scares: fx.interact,
    slots: fx.slots,
    footerScene: fx.scene,
  };
}

/** Schnee: Anteil der Flocken aus der Atmosphäre, Hauben aus den Ecken (Handy keine), Blauschein wo Atmosphäre erlaubt ist. */
function snowKeys(fx) {
  return {
    flakes: fx.ambient === "none" ? 0 : fx.ambient === "near" ? 1 : 0.6,
    caps: fx.corner > 0,
    capsMax: fx.corner * 6,
    tint: fx.ambient !== "none",
  };
}

/** Weihnachten: Kette an der Kopfzeile außer auf stillen Seiten, Kette in der Fußzeile mit der Szene, Lichtinseln mit der Atmosphäre. */
function christmasKeys(fx) {
  return { chain: fx.cls !== "quiet", footerChain: fx.scene !== "none", glow: fx.ambient !== "none" };
}

/** Je Saison die Übersetzung der Effektklassen in ihre eigenen Schlüssel - eine neue Saison trägt sich hier ein. */
export const SEASON_CAPABILITIES = { halloween: halloweenKeys, snow: snowKeys, christmas: christmasKeys };

export function capabilitiesFor(cls = "medium", intensity = "normal", season = "halloween") {
  const fx = effectClasses(cls, intensity);
  const adapt = SEASON_CAPABILITIES[season];
  return { ...fx, ...(adapt ? adapt(fx, {}) : {}), season };
}

export function capabilities(pathname, intensity = "normal", season = "halloween") {
  const cls = pageClass(pathname);
  return { cls, ...capabilitiesFor(cls, intensity, season) };
}

/** Für die Fensterbreite: schmale Fenster bekommen weniger (H18), Handys keine Ecken und keine Beobachter. */
export function scaleForViewport(caps, width = typeof window === "undefined" ? 1280 : window.innerWidth) {
  if (width >= 900) return caps;
  const mobile = width < 640;
  const fx = {
    ...caps,
    perch: Math.min(caps.perch, mobile ? 1 : 2),
    corner: mobile ? 0 : Math.min(caps.corner, 1),
    scene: mobile && caps.scene !== "none" ? "small" : caps.scene,
    crawl: false,
    watch: mobile ? false : caps.watch,
    rare: false,
    ambient: caps.ambient === "near" ? "far" : caps.ambient,
    slots: Math.min(caps.slots, 1),
    mobile,
    narrow: true,
  };
  const adapt = SEASON_CAPABILITIES[caps.season];
  return { ...fx, ...(adapt ? adapt(fx, { narrow: true, mobile }) : {}) };
}
