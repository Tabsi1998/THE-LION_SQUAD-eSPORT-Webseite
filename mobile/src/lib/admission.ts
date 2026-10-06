import { api, errorMessage } from "./api";
import type { User } from "../types";

// Einlass bei der Generalversammlung (#845, Entscheidung B): der Vorstand scannt am Eingang die Mitgliedskarte mit der
// App - dieselben Server-Wege wie im Web (`/api/admin/admission/*`), also dieselben Regeln, Zahlen und Meldungen.
// Hier die reine Logik: wer den Einlass sieht, die Zahlen zur Beschlussfähigkeit, was nach einem Scan groß steht, und
// die Sperre, damit ein Code nicht bei jedem Bild erneut gesendet wird.

export type AdmissionCounts = { present?: number | null; eligible?: number | null; quorum_from?: number | null; quorum_reached?: boolean | null } | null | undefined;

export type AdmissionRow = {
  member_id: number;
  name: string;
  state?: string | null;
  voting?: boolean;
  reason_text?: string;
  arrived?: string;
  by_name?: string;
  updated_at?: string | null;
  undo_reason?: string;
};

export type AdmissionMeeting = {
  id: number;
  title: string;
  kind?: string | null;
  day?: string | null;
  time?: string;
  place?: string;
  counts?: AdmissionCounts;
  recent?: AdmissionRow[];
};

export type AdmissionView = { ready: boolean; reason?: string | null; text?: string; meetings: AdmissionMeeting[] };

export type ScanAnswer = { ok: boolean; already?: boolean; admission: AdmissionRow; counts?: AdmissionCounts; headline?: string; detail?: string };

export type AdmissionResult = { tone: "ok" | "info" | "error"; headline: string; detail: string };

/** Nur der Vorstand (Bereich „Verein“) sieht den Einlass - der Server prüft es bei jedem Aufruf noch einmal. */
export function canAdmit(user: (User & { areas?: string[] }) | null | undefined): boolean {
  return Array.isArray(user?.areas) && user.areas.includes("club");
}

/** Die Zahlen zur Beschlussfähigkeit - derselbe Satz wie im Web. */
export function quorumText(counts: AdmissionCounts): string {
  if (!counts) return "Noch niemand eingelassen.";
  const state = counts.quorum_reached ? "beschlussfähig" : "noch nicht beschlussfähig";
  return `${counts.present ?? 0} anwesend · ${counts.eligible ?? 0} stimmberechtigt eingeladen · beschlussfähig ab ${counts.quorum_from ?? 0} Stimmen – ${state}`;
}

/** Was nach einem Scan groß steht: grün mit Stimmrecht, gelb ohne, rot abgelehnt - Text vom Server. */
export function resultFromScan(data: ScanAnswer): AdmissionResult {
  return {
    tone: data.admission?.voting ? "ok" : "info",
    headline: data.headline || (data.already ? `Schon da: ${data.admission?.name || ""}` : `Anwesend: ${data.admission?.name || ""}`),
    detail: data.detail || "",
  };
}

export function resultFromError(error: unknown, headline = "Nicht eingelassen"): AdmissionResult {
  return { tone: "error", headline, detail: errorMessage(error, "Dolibarr hat nicht geantwortet.") };
}

/** Ein Einlass (oder eine Rücknahme) in die Versammlung einarbeiten: Zahlen neu, die Zeile nach oben, höchstens 20. */
export function rememberAdmission(meeting: AdmissionMeeting, data: { admission: AdmissionRow; counts?: AdmissionCounts }): AdmissionMeeting {
  const recent = [data.admission, ...(meeting.recent || []).filter((row) => row.member_id !== data.admission.member_id)].slice(0, 20);
  return { ...meeting, counts: data.counts || meeting.counts, recent };
}

/** Die Zeile in der Liste: „ab 18:02 · stimmberechtigt“ oder „zurückgenommen: Grund“. */
export function rowText(row: AdmissionRow): string {
  if (row.state === "present") return `${row.arrived ? `ab ${row.arrived} · ` : ""}${row.reason_text || ""}`.replace(/ · $/, "");
  return `zurückgenommen${row.undo_reason ? `: ${row.undo_reason}` : ""}`;
}

/** Die Kamera liefert denselben Code viele Male je Sekunde: derselbe Code zählt erst nach `repeatMs` wieder, nach jedem Scan ist `pauseMs` Ruhe. */
export class ScanGate {
  private lastCode = "";
  private lastAt = 0;
  private pausedUntil = 0;

  constructor(private readonly pauseMs = 2500, private readonly repeatMs = 6000) {}

  accept(code: string, now = Date.now()): boolean {
    const text = String(code || "").trim();
    if (!text || now < this.pausedUntil) return false;
    if (text === this.lastCode && now - this.lastAt < this.repeatMs) return false;
    this.lastCode = text;
    this.lastAt = now;
    this.pausedUntil = now + this.pauseMs;
    return true;
  }

  reset() {
    this.lastCode = "";
    this.lastAt = 0;
    this.pausedUntil = 0;
  }
}

export async function loadAdmission(): Promise<AdmissionView> {
  const { data } = await api.get<AdmissionView>("/admin/admission");
  return { ready: Boolean(data?.ready), reason: data?.reason ?? null, text: data?.text || "", meetings: Array.isArray(data?.meetings) ? data.meetings : [] };
}

export async function admitMember(meetingId: number, payload: { code?: string; number?: string }): Promise<ScanAnswer> {
  const { data } = await api.post<ScanAnswer>(`/admin/admission/${meetingId}/scan`, payload);
  return data;
}

export async function undoAdmission(meetingId: number, memberId: number, reason: string): Promise<{ ok: boolean; admission: AdmissionRow; counts?: AdmissionCounts }> {
  const { data } = await api.post<{ ok: boolean; admission: AdmissionRow; counts?: AdmissionCounts }>(`/admin/admission/${meetingId}/undo`, { member_id: memberId, reason });
  return data;
}
