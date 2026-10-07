// Team am Spieltag (#1192): dieselben Sätze wie im Web (frontend/src/lib/teamDay.js).

export type TeamDayMember = { id: string; username?: string | null; display_name: string; avatar_url?: string | null; role: "captain" | "co_captain" | "player" };

export type TeamDayPresence = {
  enabled: boolean;
  days?: string[];
  present: Record<string, string>;
  counted: string[];
  count: number;
  total: number;
  me_present: boolean;
  can_mark: boolean;
};

export type TeamDay = {
  applicable: boolean;
  registration_id?: string;
  team?: { id: string; name?: string; tag?: string };
  team_size: number;
  substitutes_allowed: boolean;
  members: TeamDayMember[];
  lineup: string[];
  substitutes: string[];
  lineup_set: boolean;
  can_edit: boolean;
  is_lead: boolean;
  editable_until?: string | null;
  presence: TeamDayPresence;
  can_nudge: boolean;
  nudge_available_at?: string | null;
  nudged?: number;
};

const NUMBER_WORDS: Record<number, string> = { 1: "eine Person", 2: "zwei", 3: "drei", 4: "vier", 5: "fünf", 6: "sechs" };

export function starterLabel(member?: { role?: string } | null): string {
  return member?.role === "captain" ? "Kapitän" : "Spielt";
}

export function lineupLabel(data?: Pick<TeamDay, "team_size" | "can_edit" | "lineup_set" | "lineup"> | null, chosenCount: number | null = null): string {
  if (!data) return "";
  const size = Number(data.team_size || 0);
  const count = chosenCount ?? (data.lineup || []).length;
  if (data.can_edit && count !== size) return `Wähle genau ${size} – so viele spielen bei diesem Turnier je Team.`;
  if (!data.lineup_set) return "Noch keine Aufstellung – Aufruf und Spiel-Meldungen gehen an alle im Team.";
  const who = NUMBER_WORDS[size] ? `diese ${NUMBER_WORDS[size]}` : `diese ${size}`;
  return `Die Turnierleitung sieht die Aufstellung beim Check-in. Aufruf und Spiel-Meldungen gehen an ${who}.`;
}

export function presenceLine(presence?: { count?: number; total?: number } | null): string {
  return `${Number(presence?.count || 0)} von ${Number(presence?.total || 0)} da`;
}
