// Löwen-Rang Teil 3 in der App (#1456): der Aufstiegs-Moment - dieselbe Auswahl wie im Web
// (frontend/src/lib/loewenAufstieg.js). Level im Rang: die neuen Rauten springen auf, dazu ein kleiner Moment der
// Signatur. Rangwechsel: der alte Rahmen blitzt weg, der neue rastet ein, dazu der große Moment und Haptik. Die App
// zeigt eine vereinfachte Fassung (Ring und Teilchen in der Farbe des Rangs statt der Web-Partikel).
import { type RankInfo, SIGNATURE_FX, frameLayout, rankInfo, ringOf } from "./loewenRang";

export type AscentKind = "level" | "rank";
export type AscentMoment = {
  id: string;
  kind: AscentKind;
  level: number;
  previous: number;
  from: RankInfo;
  to: RankInfo;
  fx: (typeof SIGNATURE_FX)[number];
  /** Großer Moment beim Rangwechsel und bei Level 60, sonst der kleine. */
  strong: boolean;
  /** Rauten (Index im Schild), die aufspringen - leer bei reduzierter Bewegung. */
  pops: number[];
  /** Teilchen und Springen - aus bei „Bewegung reduzieren“ und „Zeremonien dezent“. */
  particles: boolean;
  reduced: boolean;
};

/** Zeitplan (ms) wie im Web: kurz stehen, bis die Karte da ist; alten Rahmen wegblitzen; neuen einrasten lassen. */
export const ASCENT_TIMING = { hold: 550, out: 240, in: 600 } as const;

export type LevelUpLike = { level?: number | null; previous?: number | null; prestigeGained?: boolean | null } | null | undefined;

/**
 * Welcher Moment zu einem Level-Aufstieg gehört - oder null (Prestige, kein Aufstieg, fehlende Daten). `reduced`
 * lässt nur Ein- und Ausblenden übrig.
 */
export function ascentMoment(levelUp: LevelUpLike, { reduced = false }: { reduced?: boolean } = {}): AscentMoment | null {
  if (!levelUp || levelUp.prestigeGained) return null;
  const level = Math.floor(Number(levelUp.level) || 0);
  const previous = Math.floor(Number(levelUp.previous ?? level - 1) || 0);
  if (level < 1 || previous < 1 || level <= previous) return null;
  const from = rankInfo(previous);
  const to = rankInfo(level);
  const kind: AscentKind = to.rank > from.rank ? "rank" : "level";
  const firstNew = kind === "rank" ? 0 : from.filled;
  const pops = Array.from({ length: Math.max(0, to.filled - firstNew) }, (_, i) => firstNew + i);
  return {
    id: `${previous}>${level}`,
    kind,
    level: to.level,
    previous: from.level,
    from,
    to,
    fx: SIGNATURE_FX[to.rank - 1],
    strong: kind === "rank" || to.max,
    pops: reduced ? [] : pops,
    particles: !reduced,
    reduced,
  };
}

/** Wann der Moment der Signatur startet (ms ab Beginn): beim Rangwechsel erst, wenn der alte Rahmen weg ist. */
export function burstDelayMs(kind: AscentKind): number {
  return ASCENT_TIMING.hold + (kind === "rank" ? ASCENT_TIMING.out : 100);
}

/** Wann eine aufspringende Raute dran ist (ms ab Beginn): nach dem Einrasten des Rahmens, nacheinander. */
export function popDelayMs(kind: AscentKind, order: number): number {
  return ASCENT_TIMING.hold + (kind === "rank" ? 840 : 200) + order * 120;
}

/**
 * Wo die Grafik eines anderen Levels um dasselbe Foto säße (Punkte in der Fläche) - für den alten Rahmen, der beim
 * Rangwechsel wegblitzt. Sein Ring liegt genau auf dem Foto, wie beim neuen.
 */
export function artAroundPhoto(level: unknown, photo: { size: number; left: number; top: number }): { size: number; left: number; top: number } {
  const ring = ringOf(rankInfo(level).key);
  const { F, ox, oy } = frameLayout(photo.size / 2, ring);
  return { size: F, left: photo.left + photo.size / 2 + ox - F / 2, top: photo.top + photo.size / 2 + oy - F / 2 };
}
