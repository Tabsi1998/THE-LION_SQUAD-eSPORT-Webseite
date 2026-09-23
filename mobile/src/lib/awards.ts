// Auszeichnungen (#230): Banner und Trophäen aus veröffentlichten Turnieren. Der Server liefert
// die Daten (Platz, Bilanz, Turnier, Spiel, Saison, Team, optional ein Bild für Platz 1-3); die
// Karte entsteht daraus - dieselben Zeilen wie im Web (AwardBanner.jsx).

export type Award = {
  id: string;
  kind: "trophy" | "banner";
  rank?: number | null;
  rank_label: string;
  participants?: number;
  record?: string;
  tournament?: { id?: string | null; slug?: string | null; title?: string | null; start_date?: string | null } | null;
  game?: { id?: string; name?: string | null; logo_url?: string | null } | null;
  season?: { id?: string; name?: string | null } | null;
  team?: { id?: string; name?: string | null; tag?: string | null } | null;
  image_url?: string | null;
  date?: string | null;
};

export type AwardTone = { color: string; label: string };

const TONES: Record<number, AwardTone> = {
  1: { color: "#FFD700", label: "Gold" },
  2: { color: "#E6E6E6", label: "Silber" },
  3: { color: "#E0A06A", label: "Bronze" },
};

export function awardTone(award: Pick<Award, "rank"> | null | undefined, fallback = "#29B6E8"): AwardTone {
  return TONES[Number(award?.rank)] || { color: fallback, label: "" };
}

/** Nur der Tag im Vereins-Kalender - die Uhrzeit des Turnierstarts gehört nicht aufs Banner. */
export function awardDay(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("de-AT", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Europe/Vienna" });
}

export function awardLines(award: Award | null | undefined): string[] {
  const parts: string[] = [];
  if (award?.game?.name) parts.push(award.game.name);
  if (award?.date) parts.push(awardDay(award.date));
  if (award?.participants) parts.push(`${award.participants} Teilnehmer`);
  if (award?.season?.name) parts.push(award.season.name);
  return parts;
}

/** Trophäen zuerst, dann nach Datum - die Reihenfolge der Karten im Profil. */
export function sortAwards(rows: Award[] | null | undefined): Award[] {
  return [...(rows || [])].sort((a, b) => {
    const trophy = Number(b.kind === "trophy") - Number(a.kind === "trophy");
    if (trophy) return trophy;
    return String(b.date || "").localeCompare(String(a.date || ""));
  });
}
