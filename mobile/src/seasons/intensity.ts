// Screen-Intensität in der App (A3, #717 - wie H17 im Web; Seasonal Core C5, #725 - wie frontend/src/seasons/intensity.js):
// nicht jeder Screen bekommt dieselbe Deko. Der Name des Screens (React Navigation) ergibt eine Klasse, die Klasse
// mit der Saisonstärke die Effektklassen - nicht nur wie viel, sondern welche Art Effekt erlaubt ist. Eine Saison
// übersetzt die Klassen in ihre Figuren (Halloween: Fledermäuse, Netze, Spinnen, Gräber, Katze, Nebel); kleine
// Bildschirme bekommen weniger. Alles reine Logik, ohne React.

export type ScreenClass = "lively" | "medium" | "calm" | "quiet";
export type Intensity = "subtle" | "normal" | "full";
export type Level = "none" | "far" | "near";
export type SceneLevel = "none" | "small" | "full";

/**
 * Effektklassen, die jede Saison kennt:
 * perch    - Figuren an Ankern (Anzahl)              corner - Deko in Ecken (Anzahl)
 * ambient  - Atmosphäre: none/far/near               watch  - stille Beobachter
 * motion   - große Bewegungen (Schwarm, Abseilen)    slots  - Plätze im Bewegungsbudget
 * crawl    - Krabbler quer über den Screen            rare   - seltene Ereignisse am Rand
 * scene    - Szene an der Tab-Leiste: none/small/full interact - Erschrecken, Sammeln, Klick-Spiele
 */
export type EffectClasses = {
  cls: ScreenClass;
  perch: number;
  corner: number;
  ambient: Level;
  watch: boolean;
  motion: boolean;
  slots: number;
  crawl: boolean;
  rare: boolean;
  scene: SceneLevel;
  interact: boolean;
  subtle?: boolean;
  full?: boolean;
  small?: boolean;
};
export const EFFECT_CLASSES = ["perch", "corner", "ambient", "watch", "motion", "slots", "crawl", "rare", "scene", "interact"] as const;
export type EffectClass = (typeof EFFECT_CLASSES)[number];

/** Die Schlüssel von Halloween - aus den Effektklassen übersetzt. */
export type HalloweenCapabilities = {
  hangingBats: number;
  flock: boolean;
  flockRange: [number, number];
  webs: number;
  cornerWebs: number;
  rappel: boolean;
  crawler: boolean;
  dropSpider: boolean;
  graves: boolean;
  cat: boolean;
  fog: Level;
  slots: number;
};
export type Capabilities = EffectClasses & HalloweenCapabilities & { season: string };

const LIVELY = new Set(["Dashboard", "NewsList", "Gallery", "GalleryAlbum", "SeasonPass"]);
const CALM = new Set([
  "TournamentList", "Tournaments", "TournamentDetail", "TournamentChat", "MatchDetail", "FastLapList", "FastLapDetail",
  "TeamChat", "DirectMessages", "DirectThread", "Notifications", "Profile", "MemberArea", "MyMembership", "MyInvoices",
  "MemberCard", "MemberDocuments", "MemberHelperShifts", "MemberMeetings", "Login", "Register", "GalleryViewer",
  // Der Adventkalender ist selbst das Bild - die Deko rundherum hält sich zurück.
  "AdventCalendar",
]);
const QUIET = new Set(["Consent", "Lock", "Boot", "Settings", "Admin"]);

/** Klasse eines Screens: lebendig (Dashboard, News, Galerie), mittel (Details, Teams, Mehr), ruhig (Turniere, Chats, Formulare, Konto), still (Sperre, Einwilligung, Einstellungen). */
export function screenClass(screen = "Dashboard"): ScreenClass {
  const name = String(screen || "Dashboard");
  if (QUIET.has(name) || /Settings|Admin|Consent|Lock/i.test(name)) return "quiet";
  if (LIVELY.has(name)) return "lively";
  if (CALM.has(name)) return "calm";
  return "medium";
}

// Effektklassen je Screen-Klasse bei normaler Stärke. `full` (Höhepunkt der Saison) hebt an, `subtle` senkt alles auf still.
const MATRIX: Record<ScreenClass, Omit<EffectClasses, "cls">> = {
  lively: { perch: 2, corner: 2, ambient: "near", watch: true, motion: true, slots: 2, crawl: true, rare: true, scene: "full", interact: true },
  medium: { perch: 2, corner: 1, ambient: "far", watch: true, motion: true, slots: 2, crawl: false, rare: false, scene: "small", interact: true },
  calm: { perch: 1, corner: 0, ambient: "far", watch: false, motion: false, slots: 1, crawl: false, rare: false, scene: "none", interact: false },
  quiet: { perch: 0, corner: 0, ambient: "none", watch: false, motion: false, slots: 0, crawl: false, rare: false, scene: "none", interact: false },
};

/** Die Effektklassen einer Screen-Klasse bei einer Stärke - saisonneutral. */
export function effectClasses(cls: ScreenClass = "medium", intensity: Intensity | string = "normal"): EffectClasses {
  const base: EffectClasses = { cls, ...(MATRIX[cls] || MATRIX.medium) };
  if (intensity === "subtle") {
    return { ...base, perch: 0, corner: Math.min(base.corner, 1), watch: false, motion: false, slots: 0, crawl: false, rare: false, ambient: base.ambient === "none" ? "none" : "far", scene: "none", interact: false, subtle: true };
  }
  if (intensity === "full" && cls !== "quiet") {
    return { ...base, perch: base.perch + 1, crawl: base.crawl || cls === "medium", full: true };
  }
  return base;
}

/** Ist eine Effektklasse erlaubt? Zahlen über null, Stufen außer „none“, Schalter an. */
export function allows(caps: Partial<EffectClasses> | null | undefined, effect: EffectClass): boolean {
  const value = caps ? caps[effect] : undefined;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") return value !== "none";
  return Boolean(value);
}

/** Halloween: Schwarmgröße und große Netze je Screen-Klasse - der Rest folgt aus den Effektklassen. */
const HALLOWEEN_OWN: Record<ScreenClass, { flockRange: [number, number]; webs: number }> = {
  lively: { flockRange: [3, 5], webs: 2 },
  medium: { flockRange: [2, 4], webs: 1 },
  calm: { flockRange: [0, 0], webs: 1 },
  quiet: { flockRange: [0, 0], webs: 0 },
};

function halloweenKeys(fx: EffectClasses, { small = false }: { small?: boolean } = {}): HalloweenCapabilities {
  const own = HALLOWEEN_OWN[fx.cls] || HALLOWEEN_OWN.medium;
  let flockRange: [number, number] = fx.motion ? own.flockRange : [0, 0];
  if (fx.full) flockRange = fx.cls === "lively" ? [4, 6] : fx.motion ? [3, 5] : [0, 0];
  if (small) flockRange = fx.motion ? [Math.min(flockRange[0], 2), Math.min(flockRange[1], 3)] : [0, 0];
  return {
    hangingBats: fx.perch,
    flock: fx.motion,
    flockRange,
    webs: small ? Math.min(own.webs, 1) : own.webs,
    cornerWebs: fx.corner,
    rappel: fx.motion,
    crawler: fx.crawl,
    dropSpider: fx.motion,
    graves: fx.scene !== "none",
    cat: fx.scene === "full",
    fog: fx.ambient,
    slots: fx.slots,
  };
}

/** Schnee (#642) wie `snowKeys` im Web: Anteil der Flocken aus der Atmosphäre - in der App ohne Hauben. */
function snowKeys(fx: EffectClasses): Record<string, unknown> {
  return { flakes: fx.ambient === "none" ? 0 : fx.ambient === "near" ? 1 : 0.6 };
}

/** Weihnachten (#642) wie `christmasKeys` im Web: Kette außer auf stillen Screens, Lichtinseln mit der Atmosphäre - ohne Fußzeile. */
function christmasKeys(fx: EffectClasses): Record<string, unknown> {
  return { chain: fx.cls !== "quiet", glow: fx.ambient !== "none" };
}

/** Je Saison die Übersetzung der Effektklassen in ihre eigenen Schlüssel - eine neue Saison trägt sich hier ein. */
export const SEASON_CAPABILITIES: Record<string, (fx: EffectClasses, ctx: { small?: boolean }) => Record<string, unknown>> = { halloween: halloweenKeys, snow: snowKeys, christmas: christmasKeys };

/** Effektklassen plus die Schlüssel einer beliebigen Saison (ohne Übersetzung nur die Klassen). */
export function seasonCapabilities(season: string, screen: string, intensity: Intensity | string = "normal"): EffectClasses & Record<string, unknown> {
  const fx = effectClasses(screenClass(screen), intensity);
  const adapt = SEASON_CAPABILITIES[season];
  return { ...fx, ...(adapt ? adapt(fx, {}) : {}), season };
}

export function capabilitiesFor(cls: ScreenClass = "medium", intensity: Intensity | string = "normal"): Capabilities {
  const fx = effectClasses(cls, intensity);
  return { ...fx, ...halloweenKeys(fx), season: "halloween" };
}

export function capabilities(screen: string, intensity: Intensity | string = "normal"): Capabilities {
  return capabilitiesFor(screenClass(screen), intensity);
}

/** Kleine Bildschirme (schmaler als 360 oder niedriger als 640 Punkte) bekommen weniger: eine Figur, keine Ecken, kein Krabbler, ferne Atmosphäre. */
export function scaleForScreen(caps: Capabilities, width: number, height: number): Capabilities {
  if (width >= 360 && height >= 640) return caps;
  const fx: EffectClasses = {
    ...caps,
    perch: Math.min(caps.perch, 1),
    corner: 0,
    crawl: false,
    ambient: caps.ambient === "near" ? "far" : caps.ambient,
    slots: Math.min(caps.slots, 1),
    small: true,
  };
  return { ...caps, ...fx, ...halloweenKeys(fx, { small: true }), small: true };
}
