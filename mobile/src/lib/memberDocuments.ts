import { Platform } from "react-native";
import { API_BASE_URL } from "../config";
import { registerCacheClearer } from "./cache";

// Vereinsdokumente in der App (#341). Die Dateien sind nicht öffentlich: Jeder Abruf trägt
// die Anmeldung, die Datei landet nur im privaten Cache der App (kein Downloads-Ordner, keine
// Galerie) und wird gelöscht, sobald jemand sich abmeldet oder das Konto wechselt.

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
};

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

/** Dateiname im Cache: nur harmlose Zeichen, die Endung aus dem Namen oder dem Typ. */
export function documentFileName(doc: MemberDocument): string {
  const original = String(doc.original_filename || "").replace(/\\/g, "/").split("/").pop() || "";
  const fromName = original.includes(".") ? original.split(".").pop()!.toLowerCase() : "";
  const extension = (fromName && /^[a-z0-9]{1,5}$/.test(fromName) ? fromName : EXTENSIONS[String(doc.mime || "")] || "bin");
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

type FileSystemLike = {
  cacheDirectory: string | null;
  makeDirectoryAsync(uri: string, options?: { intermediates?: boolean }): Promise<void>;
  deleteAsync(uri: string, options?: { idempotent?: boolean }): Promise<void>;
  createDownloadResumable(url: string, fileUri: string, options?: { headers?: Record<string, string> }): { downloadAsync(): Promise<{ uri: string; status: number } | undefined> };
  getContentUriAsync(uri: string): Promise<string>;
};

async function fileSystem(): Promise<FileSystemLike> {
  return (await import("expo-file-system/legacy")) as unknown as FileSystemLike;
}

export function documentsDirectory(cacheDirectory: string | null): string {
  return `${cacheDirectory || ""}member-documents/`;
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
    const error = new Error(downloadErrorText(result?.status)) as Error & { status?: number };
    error.status = result?.status;
    throw error;
  }
  if (Platform.OS !== "android") throw new Error("Dokumente lassen sich derzeit nur auf Android öffnen.");
  const IntentLauncher = await import("expo-intent-launcher");
  const contentUri = await FileSystem.getContentUriAsync(target);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: mime || "application/octet-stream",
  });
}

export type OpenDocument = (doc: MemberDocument, token: string) => Promise<void>;

export const openDocument: OpenDocument = (doc, token) => fetchAndOpen(documentUrl(doc), documentFileName(doc), doc.mime || "application/octet-stream", token);

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
  try {
    const FileSystem = await fileSystem();
    await FileSystem.deleteAsync(documentsDirectory(FileSystem.cacheDirectory), { idempotent: true });
  } catch {
    // ohne Dateisystem (Tests, Web) gibt es nichts zu löschen
  }
}

registerCacheClearer(() => { void forgetDocuments(); });
