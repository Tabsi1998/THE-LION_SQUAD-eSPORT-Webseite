// Wunschnummer je Mitglied (#2034, App #2050): was das Eingabefeld annimmt und wie Prüfung und Anträge in einem Satz
// klingen - dieselben Regeln und Sätze wie im Web (frontend/src/lib/jerseyNumber.js). Die Entscheidung trifft immer der
// Server (Bereich, reserviert, vergeben) - hier nur, was sich ohne ihn sagen lässt.

export type JerseyRange = { min: number; max: number };

export type JerseyRequest = {
  id: string;
  current: number | null;
  wished: number | null;
  reason?: string;
  status: string;
  status_label?: string;
  decision_reason?: string;
  received_at?: string | null;
  decided_at?: string | null;
};

export type JerseySync = { state: string; text: string; at?: string | null };

/** Antwort von GET /membership/me/jersey-number - mit `available: false` nur Grund und Satz. */
export type JerseyView = {
  available: boolean;
  reason?: string;
  text?: string;
  number?: number | null;
  can_choose?: boolean;
  again?: boolean;
  free_count?: number;
  free_numbers?: number[] | null;
  chosen_at?: string | null;
  set_by?: "member" | "board" | "dolibarr" | null;
  range?: JerseyRange;
  reserved?: number[];
  dolibarr?: JerseySync | null;
  open_request?: JerseyRequest | null;
  requests?: JerseyRequest[];
  status_labels?: Record<string, string>;
};

/** Antwort von POST …/check: frei oder vergeben - nie, wer sie hat. */
export type JerseyCheck = { number: number; free: boolean; reason?: string | null; text?: string };

export type CheckTone = "idle" | "ok" | "bad" | "busy";

/** Wie lange die Live-Prüfung nach dem letzten Tippen wartet - wie im Web. */
export const CHECK_DELAY_MS = 350;

/** Was der Abgleich mit Dolibarr sagt und dem Mitglied ruhig dazu gezeigt wird (alles außer „steht drin“ und „aus“). */
export function syncNote(sync?: JerseySync | null): string {
  if (!sync || sync.state === "ok" || sync.state === "off") return "";
  return sync.text || "";
}

export function parseJerseyInput(text: unknown, range?: JerseyRange | null): { value: number | null; error: string | null } {
  const raw = String(text ?? "").trim();
  if (!raw) return { value: null, error: null };
  if (!/^\d{1,4}$/.test(raw)) return { value: null, error: "Nur Ziffern, bitte." };
  const value = Number(raw);
  if (range && (value < range.min || value > range.max)) return { value, error: `Nur Nummern von ${range.min} bis ${range.max}.` };
  return { value, error: null };
}

/** Zustand der Live-Prüfung → Ton und Satz. `result` ist die Antwort von …/check, `local` der Fehler aus parseJerseyInput. */
export function checkState({ input, local, result, busy, failed }: {
  input: string;
  local: string | null;
  result: JerseyCheck | null;
  busy: boolean;
  failed: boolean;
}): { tone: CheckTone; text: string } {
  if (!String(input ?? "").trim()) return { tone: "idle", text: "" };
  if (local) return { tone: "bad", text: local };
  if (busy) return { tone: "busy", text: "Prüfe …" };
  if (failed) return { tone: "bad", text: "Konnte gerade nicht prüfen – versuch es gleich noch einmal." };
  if (!result) return { tone: "busy", text: "Prüfe …" };
  if (result.free) return { tone: "ok", text: "Frei" };
  if (result.reason === "own") return { tone: "ok", text: result.text || "Das ist schon deine Nummer." };
  return { tone: "bad", text: result.text || "Vergeben" };
}

export function jerseyRequestLine(row?: Pick<JerseyRequest, "current" | "wished"> | null): string {
  if (!row) return "";
  const wish = row.wished === null || row.wished === undefined ? "neu wählen" : `Wunsch ${row.wished}`;
  return `Statt ${row.current}: ${wish}`;
}

/** Wer die Nummer eingetragen hat - wie unter der großen Zahl im Web. */
export function setByLine(setBy?: string | null): string {
  if (setBy === "board") return "Vom Vorstand eingetragen";
  if (setBy === "dolibarr") return "Aus der Mitgliederverwaltung";
  return "Von dir gewählt";
}
