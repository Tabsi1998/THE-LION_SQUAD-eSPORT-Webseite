// Seitenabhängige Intensität (H17, #705): jede Seite bleibt saisonal erkennbar, aber die Startseite darf mehr als
// ein Bracket oder ein Formular. Die Seitenklasse kommt aus der Adresse, die Fähigkeiten aus Klasse und Stärke
// (vom Server: full/normal/subtle) - eine Matrix statt vieler if-Abfragen. Ruhezonen (quiet.js) ergänzen das je
// Element, das Bewegungsbudget (motion.js) je Moment.

export const PAGE_CLASSES = ["lively", "medium", "calm", "quiet"];

const RULES = [
  { test: (p) => p === "/" || p === "/home", cls: "lively" },
  { test: (p) => /^\/(events|news|gallery|galerie)\/?$/.test(p), cls: "lively" },
  { test: (p) => /^\/(admin|display|setup|consent)(\/|$)/.test(p), cls: "quiet" },
  { test: (p) => /^\/tournaments\/[^/]+\/(bracket|matches|standings)/.test(p), cls: "calm" },
  { test: (p) => /^\/(fastlap|f1)(\/|$)/.test(p), cls: "calm" },
  { test: (p) => /^\/(login|register|contact|kontakt|password-recovery|verify|profile|messages|notifications|privacy-account|membership|members\/membership|my|invoices|checkout|apply)(\/|$)/.test(p), cls: "calm" },
  { test: (p) => /^\/(events|news)\/[^/]+/.test(p), cls: "medium" },
  { test: (p) => /^\/(servers|community|players|teams|u|members|about|verein|partners|sponsors|references|achievements|seasons|tournaments)(\/|$)/.test(p), cls: "medium" },
];

export function pageClass(pathname = "/") {
  const p = String(pathname || "/").replace(/\/+$/, "") || "/";
  for (const rule of RULES) if (rule.test(p)) return rule.cls;
  return "medium";
}

// Fähigkeiten je Klasse bei normaler Stärke. `full` (Höhepunkt der Saison) hebt an, `subtle` senkt alles auf still.
const MATRIX = {
  lively: { hangingBats: 4, flock: true, flockRange: [3, 5], webs: 2, cornerWebs: 3, rappel: true, crawler: true, wisps: true, eyes: true, rareEvents: true, fog: "near", scares: true, slots: 2, footerScene: "full" },
  medium: { hangingBats: 2, flock: true, flockRange: [2, 4], webs: 1, cornerWebs: 2, rappel: true, crawler: false, wisps: true, eyes: true, rareEvents: false, fog: "far", scares: true, slots: 2, footerScene: "full" },
  calm: { hangingBats: 1, flock: false, flockRange: [0, 0], webs: 1, cornerWebs: 1, rappel: false, crawler: false, wisps: false, eyes: false, rareEvents: false, fog: "far", scares: false, slots: 1, footerScene: "small" },
  quiet: { hangingBats: 0, flock: false, flockRange: [0, 0], webs: 0, cornerWebs: 0, rappel: false, crawler: false, wisps: false, eyes: false, rareEvents: false, fog: "none", scares: false, slots: 0, footerScene: "none" },
};

export function capabilitiesFor(cls = "medium", intensity = "normal") {
  const base = { ...(MATRIX[cls] || MATRIX.medium) };
  if (intensity === "subtle") {
    return { ...base, hangingBats: 0, flock: false, flockRange: [0, 0], cornerWebs: Math.min(base.cornerWebs, 1), rappel: false, crawler: false, wisps: false, eyes: false, rareEvents: false, fog: base.fog === "none" ? "none" : "far", scares: false, slots: 0, footerScene: base.footerScene === "none" ? "none" : "small", subtle: true };
  }
  if (intensity === "full" && cls !== "quiet") {
    const lively = cls === "lively";
    return { ...base, hangingBats: base.hangingBats + 1, flockRange: lively ? [5, 8] : base.flock ? [3, 5] : [0, 0], crawler: base.crawler || cls === "medium", webs: Math.min(2, base.webs + (lively ? 0 : 0)), cornerWebs: Math.min(4, base.cornerWebs + 1), full: true };
  }
  return base;
}

export function capabilities(pathname, intensity = "normal") {
  const cls = pageClass(pathname);
  return { cls, ...capabilitiesFor(cls, intensity) };
}

/** Für die Fensterbreite: schmale Fenster bekommen weniger (H18). */
export function scaleForViewport(caps, width = typeof window === "undefined" ? 1280 : window.innerWidth) {
  if (width >= 900) return caps;
  const mobile = width < 640;
  return {
    ...caps,
    hangingBats: Math.min(caps.hangingBats, mobile ? 1 : 2),
    flockRange: caps.flock ? [Math.min(caps.flockRange[0], 2), Math.min(caps.flockRange[1], 3)] : [0, 0],
    webs: Math.min(caps.webs, 1),
    cornerWebs: mobile ? 0 : Math.min(caps.cornerWebs, 1),
    footerScene: mobile && caps.footerScene !== "none" ? "small" : caps.footerScene,
    crawler: false,
    eyes: mobile ? false : caps.eyes,
    rareEvents: false,
    fog: caps.fog === "near" ? "far" : caps.fog,
    slots: Math.min(caps.slots, 1),
    mobile,
  };
}
