// Ton je öffentlicher Phase - 1:1 wie PhaseBadge im Web (frontend/src/components/tls/PhaseBadge.jsx, PHASE_STYLES;
// #1305, #1869): Rot nur „läuft gerade“, Grün offen, Cyan angekündigt, Violett die Pause zwischen zwei Tagen, Grau
// vorbei. Text und Tönung des Zustands-Abzeichens kommen damit aus derselben Phase. Ein Test liest die Web-Tabelle.

export type PhaseTone = "cyan" | "danger" | "default" | "event" | "gold" | "success";

export const PHASE_TONES: Record<string, PhaseTone> = {
  live: "danger",
  day_break: "event",
  registration_open: "success",
  registration_pending: "cyan",
  registration_closed: "default",
  check_in: "success",
  announced: "cyan",
  draft: "default",
  paused: "default",
  completed: "default",
  results_published: "default",
  archived: "default",
  cancelled: "default",
};

/** Ton einer Phase; Unbekanntes wie im Web wie „angekündigt“. */
export function phaseTone(state?: string | null): PhaseTone {
  return PHASE_TONES[String(state || "")] || PHASE_TONES.announced;
}
