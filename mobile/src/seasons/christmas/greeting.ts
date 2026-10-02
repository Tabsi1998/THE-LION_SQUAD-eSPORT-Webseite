import * as SecureStore from "expo-secure-store";
import { seasonRng, seasonYear } from "../rng";
import type { BulbColor } from "./lights";

// Der Weihnachtsgruß (S8, X4; App S11, #642): einmal je Tag eine Karte des Vereins - Logo, Sternenlicht, eine
// Lichterfolge und der Text des Tages aus dem Admin, wie im Web (frontend/src/seasons/christmas/index.jsx). Am
// 6. Jänner ein letzter Gruß zum Abschied. Reine Rechnung plus der Merker „heute schon gezeigt“ im Gerät.

export const TOAST_DELAY_MS = 1500;
export const TOAST_MS = 14000;
export const DAY_LABELS: Record<number, string> = { 24: "Heiligabend", 25: "Erster Weihnachtstag", 26: "Zweiter Weihnachtstag" };
/** Der Abschied am 6. Jänner trägt den Namen des Tages - der Text sagt schon „Danke fürs Mitfeiern“. */
export const FAREWELL_LABEL = "Heilige Drei Könige";
/** Die Lichterfolge oben auf der Karte - dieselbe Reihe wie im Web. */
export const CARD_LIGHTS: BulbColor[] = ["blue", "warm", "gold", "warm", "blue", "red", "warm", "blue"];
const STORE_PREFIX = "season_greeting_";

type GreetingSeason = { phase?: string; texts?: Record<string, string>; starts_at?: string } | null | undefined;
export type Greeting = { title: string; text: string; link: string; day: number };
export type Star = { index: number; x: number; y: number; size: number; delay: number };

/** Das Jahres-Salz: aus dem Beginn (Server), sonst aus der Uhr - der Abschied am 6. Jänner zählt zum alten Jahr. */
export function yearSaltFor(season: GreetingSeason, now: Date = new Date()): string {
  return String(seasonYear({ key: "christmas", starts_at: season?.starts_at || "" }, now));
}

/** Der Text des Grußes: je Tag ein eigener aus dem Admin (`greeting_25`, `greeting_26`), sonst der eine Gruß. */
export function greetingFor(season: GreetingSeason, now: Date = new Date()): Greeting {
  const texts = season?.texts || {};
  if (season?.phase === "abschied") return { title: FAREWELL_LABEL, text: texts.farewell || "Danke fürs Mitfeiern – bis zum nächsten Jahr!", link: texts.farewell_link || "", day: 6 };
  const day = now.getMonth() === 11 && DAY_LABELS[now.getDate()] ? now.getDate() : 24;
  return { title: DAY_LABELS[day], text: texts[`greeting_${day}`] || texts.greeting || "Frohe Weihnachten wünscht THE LION SQUAD", link: "", day };
}

/** Sterne der Grußkarte: je Jahr anders, innerhalb des Jahres gleich - dieselben wie im Web. */
export function starField(year: number | string, count = 14): Star[] {
  const rng = seasonRng({ season: "christmas", year, screen: "toast" }, "stars");
  return Array.from({ length: count }, (_, index) => ({ index, x: Math.round(rng() * 100), y: Math.round(rng() * 100), size: Math.round((1 + rng() * 1.6) * 10) / 10, delay: Math.round(rng() * 4 * 10) / 10 }));
}

/** Der Kalendertag am Gerät (JJJJ-MM-TT) - nach der Uhr der Person, nicht nach UTC. */
export function localDay(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Ein Link aus dem Admin: eine Adresse der Website (`/news/...`) bekommt deren Anfang, eine volle Adresse bleibt. */
export function linkTarget(link: string, base: string): string {
  if (!link) return "";
  if (/^https?:\/\//i.test(link)) return link;
  return link.startsWith("/") ? `${base.replace(/\/+$/, "")}${link}` : "";
}

/** Kam der Gruß dieser Phase heute schon? Ohne Speicher: nein - dann kommt er eben noch einmal. */
export async function greetingShownToday(key: string, now: Date = new Date()): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(`${STORE_PREFIX}${key}`)) === localDay(now);
  } catch {
    return false;
  }
}

export async function markGreetingShown(key: string, now: Date = new Date()): Promise<void> {
  try {
    await SecureStore.setItemAsync(`${STORE_PREFIX}${key}`, localDay(now));
  } catch {
    // Ohne Speicher kommt der Gruß beim nächsten Start noch einmal - das ist verschmerzbar.
  }
}
