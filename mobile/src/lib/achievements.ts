import { Ionicons } from "@expo/vector-icons";

// Erfolge in der App (#218): ein Symbol je Gruppe, Fortschritt schon in der zugeklappten
// Zeile, und was seit dem letzten Blick neu freigeschaltet wurde. Alles ohne React,
// damit es sich testen lässt.

export type IoniconName = keyof typeof Ionicons.glyphMap;

export type AchievementTier = {
  code: string;
  name: string;
  description?: string;
  level?: number;
  level_name?: string;
  earned?: boolean;
  points?: number;
  current?: number;
  target?: number;
  percent?: number;
  manual_only?: boolean;
  /** Nur für Vereinsmitglieder sichtbar - lässt sich deshalb nicht öffentlich teilen. */
  member_only?: boolean;
  condition_status?: string;
  earned_at?: string;
  /** Vom Admin „ohne Zeremonie“ vergeben – zählt, wird aber nicht gefeiert. */
  silent?: boolean;
  /** Erfolge II (#611): Material (Holz bis Diamant, Legendär, Geheim), Rang 1–9, Motiv. */
  material?: string | null;
  material_name?: string | null;
  rank?: number | null;
  art?: string | null;
  icon?: string | null;
  how_to?: string | null;
  /** Aus der Gruppe (für das Abzeichen außerhalb der Liste, z. B. im Freischalt-Fenster). */
  group_art?: string | null;
  group_icon?: string | null;
  group_name?: string;
  category?: string;
};

export type AchievementGroup = {
  code: string;
  name: string;
  category?: string;
  icon?: string | null;
  description?: string;
  accent_color?: string;
  is_negative?: boolean;
  art?: string | null;
  hidden?: boolean;
  tiers?: AchievementTier[];
  /** Nach einem Filter: alle Stufen der Gruppe – der Fortschritt rechnet immer mit allen. */
  all_tiers?: AchievementTier[];
  earned_count?: number;
  tier_count?: number;
};

export const LEVEL_COLORS: Record<number, string> = { 1: "#CD7F32", 2: "#C0C0C0", 3: "#FFD700", 4: "#29B6E8", 5: "#FF3B30" };
export const LEVEL_NAMES: Record<number, string> = { 1: "Bronze", 2: "Silber", 3: "Gold", 4: "Platin", 5: "Legendär" };

// Das Web zeichnet Lucide-Symbole, die App hat Ionicons. Der Katalog nennt Lucide-Namen;
// hier steht je Name das nächstliegende Ionicon. Der Typ prüft, dass es jedes wirklich gibt.
const ICONS: Record<string, IoniconName> = {
  "alert-octagon": "alert-circle",
  "badge-alert": "warning",
  "badge-plus": "add-circle",
  ban: "ban",
  broadcast: "radio",
  "calendar-check": "calendar",
  "calendar-plus": "calendar-number",
  "check-check": "checkmark-done",
  clapperboard: "videocam",
  cpu: "hardware-chip",
  crown: "diamond",
  dumbbell: "barbell",
  flag: "flag",
  flame: "flame",
  flask: "flask",
  frown: "sad",
  gauge: "speedometer",
  "git-branch": "git-branch",
  "graduation-cap": "school",
  "hand-heart": "heart",
  "hand-helping": "hand-left",
  handshake: "people",
  "heart-handshake": "heart-circle",
  "id-card": "id-card",
  layers: "layers",
  map: "map",
  medal: "medal",
  "message-circle": "chatbubble",
  "messages-square": "chatbubbles",
  moon: "moon",
  radio: "radio",
  rocket: "rocket",
  server: "server",
  shield: "shield",
  sparkles: "sparkles",
  star: "star",
  sun: "sunny",
  swords: "game-controller",
  timer: "timer",
  "trending-up": "trending-up",
  trophy: "trophy",
  tv: "tv",
  "user-check": "person",
  "user-plus": "person-add",
  "user-x": "person-remove",
  users: "people",
  "users-round": "people-circle",
  "users-x": "people",
  zap: "flash",
};

const CATEGORY_ICONS: Record<string, IoniconName> = {
  match: "game-controller",
  tournament: "trophy",
  fastlap: "speedometer",
  season: "calendar",
  team: "people",
  community: "chatbubbles",
  creator: "videocam",
  profile: "person-circle",
  club: "shield",
  special: "star",
  hidden: "eye-off",
  negative: "warning",
};

function normalize(value?: string | null): string {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

/** Symbol einer Gruppe: aus dem Katalog, sonst nach Kategorie, sonst der Pokal. */
export function achievementIcon(group?: { icon?: string | null; category?: string } | null): IoniconName {
  return ICONS[normalize(group?.icon)] || CATEGORY_ICONS[normalize(group?.category)] || "trophy";
}

export function knownIconNames(): string[] {
  return Object.keys(ICONS);
}

export type TierStatus = "earned" | "progress" | "locked" | "secret";
export type StatusFilter = "all" | TierStatus;

/** Dieselben Filter wie im Web-Profil. */
export const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "Alle" },
  { key: "earned", label: "Erreicht" },
  { key: "progress", label: "In Arbeit" },
  { key: "locked", label: "Gesperrt" },
  { key: "secret", label: "Geheim" },
];

/** Status einer Stufe: erreicht, in Arbeit (messbar und angefangen), gesperrt – geheime Gruppen zählen als „geheim“. */
export function tierStatus(tier: AchievementTier, group?: AchievementGroup | null): TierStatus {
  if (group?.hidden) return "secret";
  if (tier.earned) return "earned";
  const measurable = !tier.manual_only && tier.condition_status !== "planned" && Number(tier.target || 0) > 0;
  if (measurable && Number(tier.current || 0) > 0) return "progress";
  return "locked";
}

/** Nur die Stufen mit diesem Status; Gruppen ohne passende Stufe fallen weg. „Alle“ lässt alles, wie es ist. */
export function applyStatusFilter(groups: AchievementGroup[], status: StatusFilter): AchievementGroup[] {
  if (status === "all") return groups;
  return groups
    .map((group) => ({ ...group, all_tiers: group.tiers || [], tiers: (group.tiers || []).filter((tier) => tierStatus(tier, group) === status) }))
    .filter((group) => (group.tiers || []).length > 0);
}

export type GroupProgress = {
  earned: number;
  total: number;
  highestLevel: number;
  /** Die höchste erreichte Stufe (nach Rang) – ihr Abzeichen steht für die Gruppe. */
  top: AchievementTier | null;
  /** Nächste Stufe, die sich zählen lässt – oder null. */
  next: AchievementTier | null;
  percent: number;
  label: string;
  done: boolean;
};

/** Was in der zugeklappten Zeile steht: „3 von 10“ zur nächsten Stufe, sonst der Stand der Stufen. */
export function groupProgress(group: AchievementGroup): GroupProgress {
  const tiers = group.all_tiers || group.tiers || [];
  const earned = tiers.filter((tier) => tier.earned);
  const highestLevel = earned.reduce((max, tier) => Math.max(max, Number(tier.level || 0)), 0);
  const top = earned.reduce<AchievementTier | null>((best, tier) => (!best || Number(tier.rank || tier.level || 0) >= Number(best.rank || best.level || 0) ? tier : best), null);
  const next = tiers.find((tier) => !tier.earned && Number(tier.target || 0) > 0 && tier.condition_status !== "planned") || null;
  const done = tiers.length > 0 && earned.length === tiers.length;
  if (done) return { earned: earned.length, total: tiers.length, highestLevel, top, next: null, percent: 100, label: "Alle Stufen erreicht", done };
  if (next) {
    const target = Number(next.target || 0);
    const current = Math.max(0, Math.min(Number(next.current || 0), target));
    const percent = Math.max(0, Math.min(100, Number(next.percent ?? (target ? (current / target) * 100 : 0))));
    return { earned: earned.length, total: tiers.length, highestLevel, top, next, percent, label: `${formatCount(current)} von ${formatCount(target)}`, done };
  }
  const percent = tiers.length ? (earned.length / tiers.length) * 100 : 0;
  return { earned: earned.length, total: tiers.length, highestLevel, top, next: null, percent, label: `${earned.length} von ${tiers.length} Stufen`, done };
}

function formatCount(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString("de-DE") : value.toLocaleString("de-DE", { maximumFractionDigits: 1 });
}

/** Freigeschaltete Stufen seit `since`, die neuesten zuerst – negative Gruppen und stille Vergaben („ohne Zeremonie“) nie. */
export function freshTiers(groups: AchievementGroup[] | undefined, since: string | null, limit = 8): AchievementTier[] {
  if (!since) return [];
  const threshold = +new Date(since);
  if (Number.isNaN(threshold)) return [];
  const earned: AchievementTier[] = [];
  for (const group of groups || []) {
    if (group.is_negative) continue;
    for (const tier of group.tiers || []) {
      if (tier.earned && tier.earned_at && !tier.silent && +new Date(tier.earned_at) > threshold) {
        earned.push({ ...tier, group_art: group.art, group_icon: group.icon, group_name: group.name, category: group.category });
      }
    }
  }
  return earned.sort((a, b) => +new Date(b.earned_at || 0) - +new Date(a.earned_at || 0)).slice(0, limit);
}

// ---------------------------------------------------------------- Freischalt-Moment, während die App offen ist

type Listener = () => void;
const listeners = new Set<Listener>();

/** Die Benachrichtigungen melden: gerade ist ein Erfolg dazugekommen. */
export function announceAchievementUnlocked(): void {
  listeners.forEach((listener) => listener());
}

export function onAchievementUnlocked(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const levelListeners = new Set<Listener>();

/** Das Level hat sich gerade geändert (Prestige im Profil) - die Level-Erkennung soll gleich nachsehen. */
export function announceLevelChanged(): void {
  levelListeners.forEach((listener) => listener());
}

export function onLevelChanged(listener: Listener): () => void {
  levelListeners.add(listener);
  return () => {
    levelListeners.delete(listener);
  };
}
