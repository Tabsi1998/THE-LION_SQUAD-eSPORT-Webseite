import { api } from "../../lib/api";
import type { EggPattern } from "../easter/plan";

// Ostereiersuche in der App (#647, S15 - wie frontend/src/seasons/easterHunt/api.js): dieselben Abfragen wie die
// Website, ein kleines Signal „Fortschritt“ (Widget, Korb und Eier zeigen dieselbe Zahl, ohne nachzufragen) und
// „läuft die Suche wirklich“ (die Oster-Deko legt dann keine Eier in ihre Reihe, die man nicht sammeln kann).

export type HuntPlace = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type HuntSpot = { kind?: "card" | "hero" | "header"; index?: number; place?: HuntPlace };
export type HuntEgg = { egg_no: number; token: string; spot: HuntSpot; pattern: EggPattern; found: boolean };
export type EggsResponse = { active: boolean; total?: number; guest?: boolean; eggs: HuntEgg[] };
export type FindResult = { found: number; total: number; already?: boolean; completed_now?: boolean; completed_at?: string | null; rank?: number | null; egg?: { egg_no: number } };
export type Progress = { active: boolean; found: number; total: number; completed_at?: string | null; rank?: number | null };
export type BasketEgg = { egg_no: number; pattern: EggPattern; found_at: string };
/** Hinweise kommen ohne Ei-Nummer (sie verrieten sonst etwas) - nur wo (Website oder App) und was. */
export type HuntHint = { channel?: string; hint: string };
export type HuntMe = Progress & { eggs?: BasketEgg[]; hints_open?: boolean; hints_open_at?: string | null; hints?: HuntHint[]; missing?: number };
export type HuntPrize = { kind: string; label: string; value?: string; title?: string };
export type FastestRow = { rank: number; display_name?: string; username?: string; duration_seconds: number };
export type HuntPage = {
  phase: "none" | "upcoming" | "running" | "ended" | "drawn";
  year?: number; starts_at?: string; ends_at?: string; next_start?: string | null; egg_count?: number; completed?: number;
  prizes?: HuntPrize[]; fastest?: FastestRow[]; terms?: string[]; me?: HuntMe | null;
};

const progressListeners = new Set<(progress: Partial<Progress>) => void>();

export function onHuntProgress(listener: (progress: Partial<Progress>) => void): () => void {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}

export function emitHuntProgress(progress: Partial<Progress>): void {
  progressListeners.forEach((listener) => {
    try {
      listener(progress);
    } catch {
      // ein kaputter Zuhörer hält die anderen nicht auf
    }
  });
}

let huntActive: boolean | null = null;
const activeListeners = new Set<(active: boolean) => void>();

export function reportHuntActive(active: unknown): void {
  huntActive = Boolean(active);
  activeListeners.forEach((listener) => {
    try {
      listener(Boolean(huntActive));
    } catch {
      // ein kaputter Zuhörer hält die anderen nicht auf
    }
  });
}

/** Zuhören (mit dem letzten Stand, wenn es schon einen gibt); gibt eine Funktion zum Abmelden zurück. */
export function onHuntActive(listener: (active: boolean) => void): () => void {
  activeListeners.add(listener);
  if (huntActive !== null) listener(huntActive);
  return () => {
    activeListeners.delete(listener);
  };
}

/** Nur für Tests: wieder „unbekannt“. */
export function resetHuntActive(): void {
  huntActive = null;
}

export async function fetchEggs(route: string): Promise<EggsResponse> {
  const { data } = await api.get("/seasonal/easter/eggs", { params: { route, channel: "app" } });
  return (data as EggsResponse) || { active: false, eggs: [] };
}

export async function findEgg(token: string): Promise<FindResult> {
  const { data } = await api.post("/seasonal/easter/find", { token });
  return data as FindResult;
}

export async function fetchBasket(): Promise<HuntMe | null> {
  const { data } = await api.get("/seasonal/easter/me");
  return (data as HuntMe) || null;
}

export async function fetchHuntPage(): Promise<HuntPage> {
  const { data } = await api.get("/seasonal/easter/page");
  return data as HuntPage;
}
