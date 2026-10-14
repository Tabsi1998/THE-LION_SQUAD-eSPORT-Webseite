import { Platform } from "react-native";
import { API_BASE_URL } from "../config";
import { registerCacheClearer } from "./cache";
import { formatDate } from "./format";
import { sha256Hex } from "./sha256";
import { authorizedUrl } from "./siteUrls";

// Vereinsdokumente in der App (#341). Die Dateien sind nicht öffentlich: Jeder Abruf trägt
// die Anmeldung, die Datei landet nur im privaten Cache der App (kein Downloads-Ordner, keine
// Galerie) und wird gelöscht, sobald jemand sich abmeldet oder das Konto wechselt. Dokumente der
// Vereinsakte (#849) liegen unter ihrer Prüfsumme: vor jedem Öffnen fragt die App nach (das Modul
// prüft die Rechte), unverändert kommt nur ein 304 - und ein abgebrochener Download geht weiter.
//
// Vertrag des Abrufs (#1054): die Anmeldung geht nur an den eigenen Server - eine Adresse anderer Herkunft lädt die
// App gar nicht. Wo sie ein Dokument nicht öffnen kann, lädt sie es auch nicht. Und was beim Abmelden oder Kontowechsel
// noch lädt (#1059), bleibt nicht liegen und wird nicht mehr geöffnet.

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

/** Die Kennung im Dateinamen (#1054): so, wie sie ist, nur aus harmlosen Zeichen - sonst ein Kürzel ihrer Prüfsumme. */
function fileId(id: unknown): string {
  const text = String(id ?? "");
  return /^[A-Za-z0-9_-]{1,64}$/.test(text) ? text : `id_${sha256Hex(text).slice(0, 16)}`;
}

/** Dateiname im Cache: nur harmlose Zeichen, die Endung aus dem Namen oder dem Typ. */
export function documentFileName(doc: MemberDocument): string {
  const original = String(doc.original_filename || "").replace(/\\/g, "/").split("/").pop() || "";
  const extension = documentExtension(doc);
  const base = (original.replace(/\.[^.]+$/, "") || doc.title || "dokument").replace(/[^A-Za-z0-9._ -]+/g, "_").trim().slice(0, 80) || "dokument";
  return `${fileId(doc.id)}-${base}.${extension}`;
}

/** Die Adresse zum Öffnen - immer auf dem eigenen Server; eine Adresse anderer Herkunft gibt es nicht (null). */
export function documentUrl(doc: MemberDocument): string | null {
  return authorizedUrl(doc.view_url || `/api/documents/${encodeURIComponent(String(doc.id ?? ""))}/view`);
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
  cancelAsync?(): Promise<void>;
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

/** Ein Dateiname im eigenen Ordner: harmlose Zeichen, keine Pfadteile. */
function safeFileName(name: string): boolean {
  return /^[A-Za-z0-9_-][A-Za-z0-9._ -]{0,159}$/.test(name) && !name.includes("..");
}

// Sitzung der Dateien (#1059): Abmelden und Kontowechsel zählen weiter. Was danach ankommt, gehört der vorigen Sitzung -
// es wird gelöscht statt abgelegt oder geöffnet. Abmelden bricht laufende Downloads ab und wartet auf jeden Ablauf.
let fileSession = 0;
const runningTasks = new Set<DownloadTask>();
const runningJobs = new Set<Promise<unknown>>();
// Länger wartet das Abmelden nicht - ein Ablauf, der danach noch ankommt, räumt selbst auf.
const JOB_WAIT_MS = 5000;

function sessionEnded(): Error {
  return failure(null, "Du hast dich inzwischen abgemeldet. Die Datei wird nicht geöffnet.");
}

/** Die aktuelle Dateisitzung - für Abläufe, die vor dem Download schon beginnen. */
export function currentFileSession(): number {
  return fileSession;
}

/** Gilt die Dateisitzung von `session` noch (kein Abmelden, kein Kontowechsel seitdem)? */
export function fileSessionActive(session: number): boolean {
  return session === fileSession;
}

/**
 * Ein Ablauf mit Dateien der Sitzung: nach jedem Schritt prüft er, ob die Sitzung noch dieselbe ist. Wenn nicht, löscht
 * er, was er angelegt haben kann, und bricht ab.
 */
class FileJob {
  private readonly leftovers = new Set<string>();

  constructor(readonly fs: FileSystemLike, readonly session: number) {}

  /** Dateien, die der Ablauf anlegen kann - nach dem Abmelden löscht er sie. */
  owns(...uris: string[]): void {
    uris.forEach((uri) => this.leftovers.add(uri));
  }

  get ended(): boolean {
    return !fileSessionActive(this.session);
  }

  async check(): Promise<void> {
    if (!this.ended) return;
    await Promise.all([...this.leftovers].map((uri) => this.fs.deleteAsync(uri, { idempotent: true }).catch(() => {})));
    throw sessionEnded();
  }

  /** Einen Schritt abwarten, danach die Sitzung prüfen - auch wenn der Schritt scheitert. */
  async step<T>(work: Promise<T>): Promise<T> {
    let value: T;
    try {
      value = await work;
    } catch (error) {
      await this.check();
      throw error;
    }
    await this.check();
    return value;
  }

  /** Ein Download, den das Abmelden abbrechen kann. */
  async download<T>(task: DownloadTask, run: () => Promise<T>): Promise<T> {
    runningTasks.add(task);
    try {
      return await this.step(run());
    } finally {
      runningTasks.delete(task);
    }
  }
}

/** Ein Ablauf zählt, bis er fertig ist - das Abmelden wartet auf ihn. */
function track<T>(work: Promise<T>): Promise<T> {
  runningJobs.add(work);
  const done = () => {
    runningJobs.delete(work);
  };
  work.then(done, done);
  return work;
}

async function waitForJobs(): Promise<void> {
  const jobs = [...runningJobs];
  if (!jobs.length) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(jobs),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, JOB_WAIT_MS);
    }),
  ]);
  if (timer) clearTimeout(timer);
}

/** Vor jedem Abruf: nur zum eigenen Server und nur, wo die App das Dokument auch öffnen kann. */
function checkedRequest(url: string): string {
  if (Platform.OS !== "android") throw new Error("Dokumente lassen sich derzeit nur auf Android öffnen.");
  const target = authorizedUrl(url);
  if (!target) throw failure(null);
  return target;
}

/** Öffnet eine Datei aus dem App-Cache mit der passenden App - nur, solange die Sitzung gilt. */
async function openWithApp(job: FileJob, target: string, mime: string): Promise<void> {
  if (Platform.OS !== "android") throw new Error("Dokumente lassen sich derzeit nur auf Android öffnen.");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const IntentLauncher = require("expo-intent-launcher") as typeof import("expo-intent-launcher");
  const contentUri = await job.step(job.fs.getContentUriAsync(target));
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: mime || "application/octet-stream",
  });
}

/** Holt eine private Datei mit Anmeldung in den App-Cache und öffnet sie mit der passenden App. */
export function fetchAndOpen(url: string, fileName: string, mime: string, token: string): Promise<void> {
  return track(runFetchAndOpen(fileSession, url, fileName, mime, token));
}

async function runFetchAndOpen(session: number, url: string, fileName: string, mime: string, token: string): Promise<void> {
  const request = checkedRequest(url);
  if (!safeFileName(fileName)) throw failure(null);
  const FileSystem = await fileSystem();
  const job = new FileJob(FileSystem, session);
  const directory = documentsDirectory(FileSystem.cacheDirectory);
  const target = `${directory}${fileName}`;
  job.owns(target);
  await job.step(FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => {}));
  const task = FileSystem.createDownloadResumable(request, target, { headers: { Authorization: `Bearer ${token}` } });
  const result = await job.download(task, () => task.downloadAsync());
  if (!result || result.status >= 400) {
    await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
    throw failure(result?.status);
  }
  await openWithApp(job, target, mime);
}

/**
 * Eine private Datei (mit Anmeldung, nur vom eigenen Server) in den Ordner der Sitzung laden - etwa das Bild des
 * Jahresrückblicks zum Teilen (#1059). Liefert die Datei und die Sitzung, zu der sie gehört; beim Abmelden geht sie mit.
 */
export function downloadPrivateFile(url: string, fileName: string, token: string): Promise<{ uri: string; session: number }> {
  return track(runDownloadPrivateFile(fileSession, url, fileName, token));
}

async function runDownloadPrivateFile(session: number, url: string, fileName: string, token: string): Promise<{ uri: string; session: number }> {
  const request = authorizedUrl(url);
  if (!request || !safeFileName(fileName)) throw failure(null);
  const FileSystem = await fileSystem();
  const job = new FileJob(FileSystem, session);
  const directory = documentsDirectory(FileSystem.cacheDirectory);
  const target = `${directory}${fileName}`;
  job.owns(target);
  await job.step(FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => {}));
  const task = FileSystem.createDownloadResumable(request, target, { headers: { Authorization: `Bearer ${token}` } });
  const result = await job.download(task, () => task.downloadAsync());
  if (!result || result.status !== 200) {
    await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
    throw failure(result?.status);
  }
  return { uri: result.uri || target, session };
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
export function fetchChecked(url: string, checksum: string, extension: string, mime: string, token: string): Promise<void> {
  return track(runFetchChecked(fileSession, url, checksum, extension, mime, token));
}

async function runFetchChecked(session: number, url: string, checksum: string, extension: string, mime: string, token: string): Promise<void> {
  const request = checkedRequest(url);
  const sum = cleanChecksum(checksum);
  if (!sum || !/^[a-z0-9]{1,5}$/.test(extension)) throw failure(null);
  const FileSystem = await fileSystem();
  const job = new FileJob(FileSystem, session);
  const directory = documentsDirectory(FileSystem.cacheDirectory);
  const target = `${directory}sha-${sum}.${extension}`;
  const probe = `${directory}sha-${sum}.check`;
  const part = `${directory}sha-${sum}.part`;
  job.owns(target, probe, part);
  await job.step(FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => {}));
  const auth = { Authorization: `Bearer ${token}` };
  const cached = FileSystem.getInfoAsync ? await job.step(FileSystem.getInfoAsync(target).catch(() => ({ exists: false }))) : { exists: false };
  if (cached.exists) {
    const check = FileSystem.createDownloadResumable(request, probe, { headers: { ...auth, "If-None-Match": `"${sum}"` } });
    const answer = await job.download(check, () => check.downloadAsync().catch(() => undefined));
    if (answer?.status === 304) {
      await job.step(FileSystem.deleteAsync(probe, { idempotent: true }).catch(() => {}));
      await openWithApp(job, target, mime);
      return;
    }
    if (answer?.status === 200 && FileSystem.moveAsync) {
      // Eine neuere Fassung: sie ersetzt die gespeicherte.
      await job.step(FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {}));
      await job.step(FileSystem.moveAsync({ from: probe, to: target }));
      await openWithApp(job, target, mime);
      return;
    }
    await job.step(FileSystem.deleteAsync(probe, { idempotent: true }).catch(() => {}));
    if (!answer) throw failure(null, "Keine Verbindung. Ohne Nachfrage beim Verein öffnet die App das Dokument nicht – bitte gleich noch einmal.");
    if ([401, 403, 404].includes(answer.status)) await job.step(FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {}));
    throw failure(answer.status);
  }
  const saved = resumes.get(sum);
  const task = FileSystem.createDownloadResumable(request, part, { headers: auth }, undefined, saved);
  let result: DownloadResult | undefined;
  try {
    result = await job.download(task, () => (saved && task.resumeAsync ? task.resumeAsync() : task.downloadAsync()));
  } catch (error) {
    if (job.ended) throw error;
    const paused = task.pauseAsync ? await task.pauseAsync().catch(() => null) : null;
    const resumeData = paused?.resumeData || task.savable?.()?.resumeData || "";
    if (resumeData && !job.ended) resumes.set(sum, resumeData);
    else resumes.delete(sum);
    await job.check();
    throw failure(null, resumeData
      ? "Die Verbindung ist abgerissen. Tippe noch einmal – der Download geht dort weiter, wo er aufgehört hat."
      : "Die Verbindung ist abgerissen. Bitte noch einmal tippen.");
  }
  resumes.delete(sum);
  if (!result || (result.status !== 200 && result.status !== 206) || !FileSystem.moveAsync) {
    await FileSystem.deleteAsync(part, { idempotent: true }).catch(() => {});
    throw failure(result?.status);
  }
  await job.step(FileSystem.moveAsync({ from: part, to: target }));
  await openWithApp(job, target, mime);
}

export type OpenDocument = (doc: MemberDocument, token: string) => Promise<void>;

export const openDocument: OpenDocument = async (doc, token) => {
  const url = documentUrl(doc);
  if (!url) throw failure(null);
  const checksum = cleanChecksum(doc.checksum);
  const mime = doc.mime || "application/octet-stream";
  return checksum ? fetchChecked(url, checksum, documentExtension(doc), mime, token) : fetchAndOpen(url, documentFileName(doc), mime, token);
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

/**
 * Beim Abmelden oder Kontowechsel: alle geladenen Dateien weg (#1059). Laufende Downloads werden abgebrochen, und das
 * Abmelden wartet, bis jeder Ablauf aufgeräumt hat - erst dann wird der Ordner gelöscht.
 */
export async function forgetDocuments(): Promise<void> {
  fileSession += 1;
  resumes.clear();
  await Promise.all([...runningTasks].map((task) => (task.cancelAsync ? task.cancelAsync().catch(() => {}) : undefined)));
  await waitForJobs();
  try {
    const FileSystem = await fileSystem();
    await FileSystem.deleteAsync(documentsDirectory(FileSystem.cacheDirectory), { idempotent: true });
  } catch {
    // ohne Dateisystem (Tests, Web) gibt es nichts zu löschen
  }
}

registerCacheClearer(forgetDocuments);
