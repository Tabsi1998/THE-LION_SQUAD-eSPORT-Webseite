import { Platform } from "react-native";
import { API_BASE_URL } from "../config";
import { registerCacheClearer } from "./cache";
import { formatDate } from "./format";

// Vereinsdokumente in der App (#341). Die Dateien sind nicht öffentlich: Jeder Abruf trägt
// die Anmeldung, die Datei landet nur im privaten Cache der App (kein Downloads-Ordner, keine
// Galerie) und wird gelöscht, sobald jemand sich abmeldet oder das Konto wechselt. Dokumente der
// Vereinsakte (#849) liegen unter ihrer Prüfsumme: vor jedem Öffnen fragt die App nach (das Modul
// prüft die Rechte), unverändert kommt nur ein 304 - und ein abgebrochener Download geht weiter.

export type MemberDocument = {
  id: string;
  title?: string | null;
  description?: string | null;
  category?: string | null;
  visibility?: string | null;
  original_filename?: string | null;
  mime?: string | null;
  file_size?: number | null;
  pinned?: boolean;
  allow_download?: boolean;
  view_url?: string | null;
  download_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  // Unterlagen aus der Vereinsakte (#324 Teil 1): Herkunft und „nur für dich“.
  source?: string | null;
  personal?: boolean;
  // Prüfsumme der Fassung (#849) - Name im Cache und „If-None-Match“.
  checksum?: string | null;
};

/** Die eigenen Unterlagen aus der Vereinsakte (#1255, /account/documents) - mit Grund, wenn es keine gibt. */
export type OwnDocuments = { available: boolean; reason?: string | null; text?: string; documents: MemberDocument[] };

/** „2 Dokumente · neuestes vom 01.09.2026“ - für die Zeile „Deine Unterlagen“ im Profil, wie im Web. */
export function documentsLine(documents: MemberDocument[] | null | undefined): string {
  const list = Array.isArray(documents) ? documents : [];
  if (!list.length) return "";
  const newest = list.map((doc) => doc.created_at || doc.updated_at || "").filter(Boolean).sort().pop();
  const count = list.length === 1 ? "1 Dokument" : `${list.length} Dokumente`;
  return newest ? `${count} · neuestes vom ${formatDate(newest)}` : count;
}

export const CATEGORY_LABELS: Record<string, string> = {
  statutes: "Statuten", minutes: "Protokolle", form: "Formular", regulations: "Regelwerk", guideline: "Leitlinie",
  download: "Download", media_kit: "Media Kit", presentation: "Präsentation", template: "Vorlage", other: "Sonstiges",
  // Dokumentarten der Vereinsakte (#324 Teil 1)
  resolution: "Beschluss", audit_report: "Prüfbericht", account: "Rechnungsabschluss", payout: "Auszahlung", letter: "Schreiben", ballot: "Abstimmung",
};

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "text/plain": "txt",
  "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt", "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/zip": "zip",
};

export function categoryLabel(value?: string | null): string {
  return CATEGORY_LABELS[String(value || "")] || "Dokument";
}

export function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** Die Endung einer Datei: aus dem Namen, sonst aus dem Typ. */
export function documentExtension(doc: MemberDocument): string {
  const original = String(doc.original_filename || "").replace(/\\/g, "/").split("/").pop() || "";
  const fromName = original.includes(".") ? original.split(".").pop()!.toLowerCase() : "";
  return fromName && /^[a-z0-9]{1,5}$/.test(fromName) ? fromName : EXTENSIONS[String(doc.mime || "")] || "bin";
}

/** Dateiname im Cache: nur harmlose Zeichen, die Endung aus dem Namen oder dem Typ. */
export function documentFileName(doc: MemberDocument): string {
  const original = String(doc.original_filename || "").replace(/\\/g, "/").split("/").pop() || "";
  const extension = documentExtension(doc);
  const base = (original.replace(/\.[^.]+$/, "") || doc.title || "dokument").replace(/[^A-Za-z0-9._ -]+/g, "_").trim().slice(0, 80) || "dokument";
  return `${doc.id}-${base}.${extension}`;
}

export function documentUrl(doc: MemberDocument): string {
  const path = doc.view_url || `/api/documents/${doc.id}/view`;
  return /^https?:/i.test(path) ? path : `${API_BASE_URL}/${path.replace(/^\/+/, "")}`;
}

/** Was die Person liest, wenn es nicht klappt - der Grund steht im Statuscode. */
export function downloadErrorText(status: number | null | undefined): string {
  if (status === 401) return "Bitte melde dich neu an.";
  if (status === 403) return "Kein Zugriff: Dieses Dokument ist nur für Mitglieder bzw. den Vorstand.";
  if (status === 404) return "Die Datei fehlt auf dem Server. Bitte sag der Vereinsverwaltung Bescheid.";
  if (status === 429) return "Zu viele Abrufe hintereinander. Bitte kurz warten.";
  if (status && status >= 500) return "Der Server antwortet gerade nicht. Bitte später noch einmal.";
  return "Das Dokument konnte nicht geladen werden.";
}

type DownloadResult = { uri: string; status: number };
type DownloadTask = {
  downloadAsync(): Promise<DownloadResult | undefined>;
  resumeAsync?(): Promise<DownloadResult | undefined>;
  pauseAsync?(): Promise<{ resumeData?: string | null }>;
  savable?(): { resumeData?: string | null };
};

type FileSystemLike = {
  cacheDirectory: string | null;
  makeDirectoryAsync(uri: string, options?: { intermediates?: boolean }): Promise<void>;
  deleteAsync(uri: string, options?: { idempotent?: boolean }): Promise<void>;
  createDownloadResumable(url: string, fileUri: string, options?: { headers?: Record<string, string> }, callback?: unknown, resumeData?: string): DownloadTask;
  getContentUriAsync(uri: string): Promise<string>;
  getInfoAsync?(uri: string): Promise<{ exists: boolean }>;
  moveAsync?(options: { from: string; to: string }): Promise<void>;
};

async function fileSystem(): Promise<FileSystemLike> {
  // require statt import(): Metro bündelt es ohnehin, und Jest lädt es ohne VM-Module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("expo-file-system/legacy") as FileSystemLike;
}

export function documentsDirectory(cacheDirectory: string | null): string {
  return `${cacheDirectory || ""}member-documents/`;
}

function failure(status: number | null | undefined, text = downloadErrorText(status)): Error & { status?: number } {
  const error = new Error(text) as Error & { status?: number };
  error.status = status ?? undefined;
  return error;
}

/** Öffnet eine Datei aus dem App-Cache mit der passenden App. */
async function openWithApp(FileSystem: FileSystemLike, target: string, mime: string): Promise<void> {
  if (Platform.OS !== "android") throw new Error("Dokumente lassen sich derzeit nur auf Android öffnen.");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const IntentLauncher = require("expo-intent-launcher") as typeof import("expo-intent-launcher");
  const contentUri = await FileSystem.getContentUriAsync(target);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: mime || "application/octet-stream",
  });
}

/** Holt eine private Datei mit Anmeldung in den App-Cache und öffnet sie mit der passenden App. */
export async function fetchAndOpen(url: string, fileName: string, mime: string, token: string): Promise<void> {
  const FileSystem = await fileSystem();
  const directory = documentsDirectory(FileSystem.cacheDirectory);
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => {});
  const target = `${directory}${fileName}`;
  const task = FileSystem.createDownloadResumable(url, target, { headers: { Authorization: `Bearer ${token}` } });
  const result = await task.downloadAsync();
  if (!result || result.status >= 400) {
    await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
    throw failure(result?.status);
  }
  await openWithApp(FileSystem, target, mime);
}

/** Die Prüfsumme der Vereinsakte (#849): 64 Hex-Zeichen, sonst keine. */
export function cleanChecksum(value?: string | null): string {
  const text = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(text) ? text : "";
}

// Angefangene Downloads (#849): je Prüfsumme der Stand von Expo, damit der nächste Tipp dort weitermacht.
const resumes = new Map<string, string>();

/** Nur für Tests. */
export function resetDocumentDownloads(): void {
  resumes.clear();
}

/**
 * Ein Dokument der Vereinsakte (#849): im Cache unter seiner Prüfsumme. Liegt es schon dort, fragt die App trotzdem
 * jedes Mal nach - das Modul prüft die Rechte -, und unverändert kommt nur ein 304 statt der Datei. Eine neue Fassung
 * ersetzt die alte, ein entzogenes Dokument verschwindet aus dem Cache. Reißt ein Download ab, geht er beim nächsten
 * Tipp dort weiter, wo er aufgehört hat (Teilabruf über den Server).
 */
export async function fetchChecked(url: string, checksum: string, extension: string, mime: string, token: string): Promise<void> {
  const FileSystem = await fileSystem();
  const directory = documentsDirectory(FileSystem.cacheDirectory);
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => {});
  const target = `${directory}sha-${checksum}.${extension}`;
  const auth = { Authorization: `Bearer ${token}` };
  const cached = FileSystem.getInfoAsync ? await FileSystem.getInfoAsync(target).catch(() => ({ exists: false })) : { exists: false };
  if (cached.exists) {
    const probe = `${directory}sha-${checksum}.check`;
    const check = FileSystem.createDownloadResumable(url, probe, { headers: { ...auth, "If-None-Match": `"${checksum}"` } });
    const answer = await check.downloadAsync().catch(() => undefined);
    if (answer?.status === 304) {
      await FileSystem.deleteAsync(probe, { idempotent: true }).catch(() => {});
      await openWithApp(FileSystem, target, mime);
      return;
    }
    if (answer?.status === 200 && FileSystem.moveAsync) {
      // Eine neuere Fassung: sie ersetzt die gespeicherte.
      await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
      await FileSystem.moveAsync({ from: probe, to: target });
      await openWithApp(FileSystem, target, mime);
      return;
    }
    await FileSystem.deleteAsync(probe, { idempotent: true }).catch(() => {});
    if (!answer) throw failure(null, "Keine Verbindung. Ohne Nachfrage beim Verein öffnet die App das Dokument nicht – bitte gleich noch einmal.");
    if ([401, 403, 404].includes(answer.status)) await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
    throw failure(answer.status);
  }
  const part = `${directory}sha-${checksum}.part`;
  const saved = resumes.get(checksum);
  const task = FileSystem.createDownloadResumable(url, part, { headers: auth }, undefined, saved);
  let result: DownloadResult | undefined;
  try {
    result = saved && task.resumeAsync ? await task.resumeAsync() : await task.downloadAsync();
  } catch {
    const paused = task.pauseAsync ? await task.pauseAsync().catch(() => null) : null;
    const resumeData = paused?.resumeData || task.savable?.()?.resumeData || "";
    if (resumeData) resumes.set(checksum, resumeData);
    else resumes.delete(checksum);
    throw failure(null, resumeData
      ? "Die Verbindung ist abgerissen. Tippe noch einmal – der Download geht dort weiter, wo er aufgehört hat."
      : "Die Verbindung ist abgerissen. Bitte noch einmal tippen.");
  }
  resumes.delete(checksum);
  if (!result || (result.status !== 200 && result.status !== 206) || !FileSystem.moveAsync) {
    await FileSystem.deleteAsync(part, { idempotent: true }).catch(() => {});
    throw failure(result?.status);
  }
  await FileSystem.moveAsync({ from: part, to: target });
  await openWithApp(FileSystem, target, mime);
}

export type OpenDocument = (doc: MemberDocument, token: string) => Promise<void>;

export const openDocument: OpenDocument = (doc, token) => {
  const checksum = cleanChecksum(doc.checksum);
  const mime = doc.mime || "application/octet-stream";
  return checksum ? fetchChecked(documentUrl(doc), checksum, documentExtension(doc), mime, token) : fetchAndOpen(documentUrl(doc), documentFileName(doc), mime, token);
};

// ---------------------------------------------------------------- Eigene Belege (#339)

export type Invoice = {
  key: string;
  ref: string;
  type: string;
  type_label: string;
  date?: string | null;
  due_date?: string | null;
  total?: number | null;
  remaining?: number | null;
  status: string;
  status_label: string;
  overdue?: boolean;
  is_fee?: boolean;
  can_pay?: boolean;
  // Quelle (#320): Beitrag, Event oder Turnier - mit dem Vorgang dahinter.
  source?: "club" | "event" | "tournament" | "other";
  source_label?: string;
  booking?: { name: string; date: string; seats: number; companions: number; team: string; players: number } | null;
  registration_id?: string;
};

export type InvoiceList = {
  connected: boolean;
  available: boolean;
  reason?: string;
  reason_text?: string;
  as_of?: string | null;
  invoices: Invoice[];
  summary?: { count: number; open_count: number; open_total: number; overdue_count: number };
  currency?: string;
  member?: boolean;
  sources?: Record<string, number>;
};

export function invoiceFileName(invoice: Invoice): string {
  const ref = String(invoice.ref || invoice.key).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60) || invoice.key;
  return `beleg-${ref}.pdf`;
}

export const openInvoice = (invoice: Invoice, token: string) =>
  fetchAndOpen(`${API_BASE_URL}/api/account/invoices/${encodeURIComponent(invoice.key)}/pdf`, invoiceFileName(invoice), "application/pdf", token);

/** Beim Abmelden oder Kontowechsel: alle geladenen Dokumente weg. */
export async function forgetDocuments(): Promise<void> {
  resumes.clear();
  try {
    const FileSystem = await fileSystem();
    await FileSystem.deleteAsync(documentsDirectory(FileSystem.cacheDirectory), { idempotent: true });
  } catch {
    // ohne Dateisystem (Tests, Web) gibt es nichts zu löschen
  }
}

registerCacheClearer(() => { void forgetDocuments(); });
