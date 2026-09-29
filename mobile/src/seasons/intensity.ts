// Screen-Intensität in der App (A3, #717 - wie H17 im Web, frontend/src/seasons/intensity.js): nicht jeder Screen
// bekommt dieselbe Deko. Der Name des Screens (React Navigation) ergibt eine Klasse, die Klasse mit der
// Saisonstärke die Fähigkeiten; kleine Bildschirme bekommen weniger. Alles reine Logik, ohne React.

export type ScreenClass = "lively" | "medium" | "calm" | "quiet";
export type Intensity = "subtle" | "normal" | "full";
export type Capabilities = {
  cls: ScreenClass;
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
  fog: "none" | "far" | "near";
  slots: number;
  subtle?: boolean;
  full?: boolean;
  small?: boolean;
};

const LIVELY = new Set(["Dashboard", "NewsList", "Gallery", "GalleryAlbum", "SeasonPass"]);
const CALM = new Set([
  "TournamentList", "Tournaments", "TournamentDetail", "TournamentChat", "MatchDetail", "FastLapList", "FastLapDetail",
  "TeamChat", "DirectMessages", "DirectThread", "Notifications", "Profile", "MemberArea", "MyMembership", "MyInvoices",
  "MemberCard", "MemberDocuments", "MemberHelperShifts", "MemberMeetings", "Login", "Register", "GalleryViewer",
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

const MATRIX: Record<ScreenClass, Omit<Capabilities, "cls">> = {
  lively: { hangingBats: 2, flock: true, flockRange: [3, 5], webs: 2, cornerWebs: 2, rappel: true, crawler: true, dropSpider: true, graves: true, cat: true, fog: "near", slots: 2 },
  medium: { hangingBats: 2, flock: true, flockRange: [2, 4], webs: 1, cornerWebs: 1, rappel: true, crawler: false, dropSpider: true, graves: true, cat: false, fog: "far", slots: 2 },
  calm: { hangingBats: 1, flock: false, flockRange: [0, 0], webs: 1, cornerWebs: 0, rappel: false, crawler: false, dropSpider: false, graves: false, cat: false, fog: "far", slots: 1 },
  quiet: { hangingBats: 0, flock: false, flockRange: [0, 0], webs: 0, cornerWebs: 0, rappel: false, crawler: false, dropSpider: false, graves: false, cat: false, fog: "none", slots: 0 },
};

export function capabilitiesFor(cls: ScreenClass = "medium", intensity: Intensity | string = "normal"): Capabilities {
  const base: Capabilities = { cls, ...(MATRIX[cls] || MATRIX.medium) };
  if (intensity === "subtle") {
    return { ...base, hangingBats: 0, flock: false, flockRange: [0, 0], cornerWebs: Math.min(base.cornerWebs, 1), rappel: false, crawler: false, dropSpider: false, graves: false, cat: false, fog: base.fog === "none" ? "none" : "far", slots: 0, subtle: true };
  }
  if (intensity === "full" && cls !== "quiet") {
    return { ...base, hangingBats: base.hangingBats + 1, flockRange: cls === "lively" ? [4, 6] : base.flock ? [3, 5] : [0, 0], crawler: base.crawler || cls === "medium", full: true };
  }
  return base;
}

export function capabilities(screen: string, intensity: Intensity | string = "normal"): Capabilities {
  return capabilitiesFor(screenClass(screen), intensity);
}

/** Kleine Bildschirme (schmaler als 360 oder niedriger als 640 Punkte) bekommen weniger. */
export function scaleForScreen(caps: Capabilities, width: number, height: number): Capabilities {
  if (width >= 360 && height >= 640) return caps;
  return {
    ...caps,
    hangingBats: Math.min(caps.hangingBats, 1),
    flockRange: caps.flock ? [Math.min(caps.flockRange[0], 2), Math.min(caps.flockRange[1], 3)] : [0, 0],
    webs: Math.min(caps.webs, 1),
    cornerWebs: 0,
    crawler: false,
    fog: caps.fog === "near" ? "far" : caps.fog,
    slots: Math.min(caps.slots, 1),
    small: true,
  };
}
