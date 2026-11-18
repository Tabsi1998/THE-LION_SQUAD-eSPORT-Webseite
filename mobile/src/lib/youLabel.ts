// Etikett an der eigenen Stelle (#1316, Web: frontend/src/lib/youLabel.js): „Du“ - hängt die Markierung an deinem Team
// (Anmeldung eines Teams), heißt es „Dein Team“.
export function youLabel(registration?: { team_id?: string | null; team?: { id?: string | null } | null } | null): string {
  return registration?.team_id || registration?.team?.id ? "Dein Team" : "Du";
}

/** Sagt das Etikett der Stelle schon „du“ („Du bist dabei“)? Dann kein zweites „Du“ daneben (wie im Web, EventDetailPage). */
export function saysYou(label?: string | null): boolean {
  return String(label || "").trim().toLowerCase().startsWith("du ");
}

/** Das Etikett für den Vorleser: „du“ klein im Satz, „Dein Team“ wie es steht. */
export function youSpeech(label: string): string {
  return label === "Du" ? "du" : label;
}
