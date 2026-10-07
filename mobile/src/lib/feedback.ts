// Rückmeldung (#1196): dieselben Helfer wie im Web (frontend/src/lib/feedback.js).

export const STAR_LABELS: Record<number, string> = { 1: "Gar nicht gut", 2: "Eher nicht", 3: "Ging so", 4: "Gut", 5: "Richtig gut" };

export type FeedbackTarget = { kind: "tournament" | "event"; id: string };

export type FeedbackPrompt = { kind: "tournament" | "event"; target_id: string; slug?: string | null; title: string; question: string; day: string };

export function parseFeedbackTarget(value?: string | null): FeedbackTarget | null {
  const match = /^(tournament|event):(.+)$/.exec(String(value || "").trim());
  return match ? { kind: match[1] as FeedbackTarget["kind"], id: match[2] } : null;
}

export function feedbackTagPrompt(stars: number): string {
  return !stars || stars >= 4 ? "Was war gut?" : "Was hat gestört?";
}
