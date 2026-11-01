import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, formatApiError, formatUploadError, uploadApi } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { prepareImageForUpload } from "@/components/tls/ImageUpload";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { UploadProgressPanel } from "@/components/tls/UploadProgressPanel";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { mediaPageFrom } from "@/hooks/useMediaLibrary";
import { useUploadProgress } from "@/hooks/useUploadProgress";
import { MEDIA_ACCEPT, ORIGINAL_MEDIA_EXTENSIONS, mediaTypeFromFile } from "@/lib/galleryMedia";
import { logUploadClientFailure } from "@/lib/uploadDiagnostics";
import { loadUploadLimits, tooLargeMessage } from "@/lib/uploadLimits";
import { toast } from "sonner";
import { FileText, Search, RefreshCw, Upload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { MediaDetailSheet } from "./media/MediaDetailSheet";
import { MediaPreview, UploadEventsPanel } from "./media/parts";
import { BACKEND, IMG_EXT, MEDIA_SCOPE_LABELS, VIDEO_EXT, cacheBustedMediaUrl, fmtBytes } from "./media/shared";

const ORIGINAL_EXT = ORIGINAL_MEDIA_EXTENSIONS;

const parseUploadMb = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const PROXY_UPLOAD_LIMIT_MB = parseUploadMb(import.meta.env.VITE_PROXY_UPLOAD_LIMIT_MB, 1700);

const PAGE_SIZE = 60;
const TYPE_PARAM = { images: "images", videos: "videos", files: "files" };
const SEARCH_DELAY_MS = 300;

export default function AdminMediaPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
  const [page, setPage] = useState(0);
  const [needle, setNeedle] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [includeUserUploads, setIncludeUserUploads] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [mediaAudit, setMediaAudit] = useState(null);
  const [scopeAudit, setScopeAudit] = useState(null);
  const [uploadEvents, setUploadEvents] = useState([]);
  const [loadingUploadEvents, setLoadingUploadEvents] = useState(false);
  const [auditingScopes, setAuditingScopes] = useState(false);
  const [repairingScopes, setRepairingScopes] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const confirm = useConfirm();
  const uploadProgress = useUploadProgress();

  // Suche und Filter rechnet der Server (#2122): auch die ältesten Dateien sind so erreichbar.
  useEffect(() => {
    const timer = setTimeout(() => setNeedle(q.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => { setPage(0); }, [needle, filter, scopeFilter, includeUserUploads]);

  // Die Prüfung liest alle Dateien und Verweise: Sie läuft beim Öffnen und nach Änderungen, nicht bei jedem Blättern.
  const loadAudit = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/media/audit");
      setMediaAudit(data);
    } catch {
      setMediaAudit(null);
    }
  }, []);

  const requestRef = useRef(0);
  const loadPage = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    const params = new URLSearchParams({
      paged: "true", limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE),
      include_user_uploads: includeUserUploads ? "true" : "false", include_usage: "true",
    });
    if (TYPE_PARAM[filter]) params.set("type", TYPE_PARAM[filter]);
    if (scopeFilter !== "all") params.set("scope", scopeFilter);
    if (needle) params.set("q", needle);
    try {
      const { data } = await api.get(`/admin/media?${params.toString()}`);
      if (request !== requestRef.current) return;
      const result = mediaPageFrom(data);
      setItems(result.items);
      setTotal(result.total);
      setTotalSize(result.totalSize ?? result.items.reduce((sum, it) => sum + (it.size || 0), 0));
      // Die letzte Datei einer Seite gelöscht: zurück auf die letzte Seite, die es noch gibt.
      if (!result.items.length && page > 0) setPage(Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1));
    } catch (e) {
      if (request !== requestRef.current) return;
      toast.error(formatApiError(e.response?.data?.detail) || "Fehler beim Laden");
    }
    setLoading(false);
  }, [includeUserUploads, filter, scopeFilter, needle, page]);

  const load = useCallback(() => Promise.all([loadPage(), loadAudit()]), [loadPage, loadAudit]);

  const loadUploadEvents = useCallback(async () => {
    setLoadingUploadEvents(true);
    try {
      const { data } = await api.get("/uploads/events?limit=80");
      setUploadEvents(data || []);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Upload-Protokoll konnte nicht geladen werden.");
    } finally {
      setLoadingUploadEvents(false);
    }
  }, []);

  useEffect(() => { loadPage(); }, [loadPage]);
  useEffect(() => { loadAudit(); }, [loadAudit]);
  useEffect(() => { loadUploadEvents(); }, [loadUploadEvents]);
  useApiInvalidation(load, ["admin/media", "media", "uploads"]);
  useApiInvalidation(loadUploadEvents, ["uploads"]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const qualityChecks = useMemo(() => {
    if (!mediaAudit) return [];
    return [
      {
        key: "missing",
        label: "Verweise ins Leere",
        value: mediaAudit.reference_summary?.missing_file || 0,
        detail: "Bildfelder zeigen auf Dateien, die es nicht mehr gibt.",
        tone: "danger",
      },
      {
        key: "metadata",
        label: "Einträge ohne Datei",
        value: mediaAudit.metadata_missing_files || 0,
        detail: "Der Upload ist eingetragen, aber die Datei fehlt.",
        tone: "danger",
      },
      {
        key: "duplicate",
        label: "Duplikate",
        value: mediaAudit.duplicate_files || 0,
        detail: "Mehrere Dateien haben identische Inhalte.",
        tone: "warn",
        filter: "duplicate",
      },
      {
        key: "unused",
        label: "Ungenutzt",
        value: mediaAudit.unused || 0,
        detail: "Dateien, die nirgends verwendet werden.",
        tone: "warn",
        filter: "unused",
      },
      {
        key: "untracked",
        label: "Nicht erfasst",
        value: mediaAudit.untracked || 0,
        detail: "Dateien ohne Upload-Eintrag – woher sie kommen, ist unbekannt.",
        tone: "warn",
        filter: "untracked",
      },
      {
        key: "legacy",
        label: "Ohne Zuordnung",
        value: mediaAudit.by_scope?.legacy || 0,
        detail: "Alte Uploads, die noch keinem Bereich zugeordnet sind.",
        tone: "info",
        filter: "legacy",
      },
    ];
  }, [mediaAudit]);

  // Eine verwendete Datei löscht die Mediathek nur nach Warnung (#1471): Die Verwendungen kennt sie aus derselben
  // Liste wie die Kontolöschung, auch verschachtelte Felder wie Gewinnerbilder oder die Chronik auf „Über uns“.
  const del = async (it) => {
    const used = (it.usage_count || 0) > 0;
    const places = [...new Set((it.references || []).map((ref) => ref.place || `${ref.collection}.${ref.field}`))].join(", ");
    const description = used
      ? `"${it.filename}" wird noch verwendet (${it.usage_count}x${places ? `: ${places}` : ""}). Diese Bildfelder werden geleert; Bilder in Texten bleiben als toter Verweis stehen.`
      : `"${it.filename}" wird nirgends verwendet und wird aus der Medienbibliothek entfernt.`;
    if (!await confirm({ title: used ? "Verwendete Datei löschen?" : "Datei endgültig löschen?", description, confirmLabel: used ? "Trotzdem löschen" : "Löschen" })) return;
    const previous = items;
    setItems((rows) => rows.filter((row) => row.filename !== it.filename));
    setSelected(null);
    try {
      const { data } = await api.delete(`/admin/media/${encodeURIComponent(it.filename)}${used ? "?force=true" : ""}`);
      const cleared = data?.cleared_references ? `, ${data.cleared_references} Verknüpfung(en) bereinigt` : "";
      const inText = data?.text_references ? `, ${data.text_references} Verweis(e) in Texten bitte von Hand anpassen` : "";
      const later = data?.file_pending ? " (die Datei selbst wird beim nächsten Aufräumen entfernt)" : "";
      toast.success(`Datei gelöscht${later}${cleared}${inText}`);
      load();
    } catch (e) {
      setItems(previous);
      toast.error(formatApiError(e.response?.data?.detail) || "Löschen fehlgeschlagen");
      load();
    }
  };

  const copyUrl = async (it) => {
    const fullUrl = `${BACKEND}${it.url}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      toast.success("Adresse kopiert.");
    } catch {
      toast.error("Kopieren fehlgeschlagen");
    }
  };

  // Drehen (#2122) ändert das Bild überall, wo es steht - darum die Rückfrage mit der Zahl der Stellen.
  const rotateImage = async (it, degrees) => {
    const used = it.usage_count || 0;
    if (!await confirm({
      title: `Bild nach ${degrees < 0 ? "links" : "rechts"} drehen?`,
      description: used
        ? `Das Bild erscheint danach überall gedreht – es wird an ${used} ${used === 1 ? "Stelle" : "Stellen"} verwendet.`
        : "Das Bild wird in der Datei selbst gedreht. Es wird derzeit nirgends verwendet.",
      confirmLabel: "Drehen",
      tone: "info",
    })) return;
    try {
      const { data } = await api.post(`/admin/media/${encodeURIComponent(it.filename)}/rotate`, { degrees });
      const updated = {
        ...it,
        url: data?.url || it.url,
        size: data?.size ?? it.size,
        width: data?.width ?? it.width,
        height: data?.height ?? it.height,
        mtime: data?.updated_at || new Date().toISOString(),
      };
      setSelected(updated);
      setItems((rows) => rows.map((row) => (row.filename === it.filename ? { ...row, ...updated } : row)));
      toast.success("Bild gedreht.");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Bild konnte nicht gedreht werden.");
    }
  };

  const uploadMediaFiles = async (files) => {
    if (!files?.length) return;
    const picked = Array.from(files);
    uploadProgress.start(picked);
    setUploading(true);
    const { video_mb: videoMb } = await loadUploadLimits();
    let ok = 0;
    let failed = 0;
    let originals = 0;
    for (const [index, file] of picked.entries()) {
      let kind = mediaTypeFromFile(file);
      try {
        uploadProgress.startFile(file, index, kind === "image" ? "Bild wird vorbereitet" : "Upload startet");
        if (kind === "video" && file.size > videoMb * 1024 * 1024) {
          throw new Error(tooLargeMessage(videoMb));
        }
        const uploadFile = kind === "image" ? await prepareImageForUpload(file) : file;
        const fd = new FormData();
        fd.append("file", uploadFile);
        uploadProgress.beginTransfer(uploadFile.size);
        const { data } = await uploadApi.post("/uploads/media?media_scope=admin", fd, {
          onUploadProgress: uploadProgress.updateUpload,
        });
        if (data?.media_type === "file") originals++;
        uploadProgress.finishFile({ original: data?.media_type === "file" });
        ok++;
      } catch (e) {
        failed++;
        uploadProgress.failFile();
        const message = formatUploadError(e, "Upload fehlgeschlagen.", { appLimitMb: kind === "video" ? videoMb : undefined });
        await logUploadClientFailure(e, file, {
          endpoint: "/uploads/media",
          mediaScope: "admin",
          kind,
          message,
          phase: uploadProgress.progress?.phase,
          appLimitMb: videoMb,
          proxyLimitMb: PROXY_UPLOAD_LIMIT_MB,
        });
        toast.error(`${file.name}: ${message}`);
      }
    }
    setUploading(false);
    uploadProgress.finish();
    toast.success(`${ok} Medium/Medien hochgeladen${originals ? `, ${originals} Originaldatei(en)` : ""}${failed ? `, ${failed} fehlgeschlagen` : ""}.`);
    load();
    loadUploadEvents();
  };

  // „Ungenutzte löschen“ (#2122): Der Server nennt, was gelöscht würde, und prüft beim Löschen jede Datei erneut.
  const cleanupUnused = async () => {
    setCleaning(true);
    try {
      const { data: preview } = await api.get("/admin/media/unused");
      if (!preview?.count) {
        toast.success("Es gibt nichts zu löschen.");
        return;
      }
      const shown = preview.filenames?.length || 0;
      const more = preview.count > shown ? ` Es sind mehr als ${shown} – die übrigen löschst du danach mit einem zweiten Klick.` : "";
      if (!await confirm({
        title: `${shown} ungenutzte ${shown === 1 ? "Datei" : "Dateien"} löschen?`,
        description: `Das sind ${fmtBytes(preview.total_size)} und lässt sich nicht rückgängig machen. Der Server prüft vorher noch einmal jede Datei. Es bleiben: Uploads der letzten ${preview.min_age_hours} Stunden, Uploads von Mitgliedern, Dateien ohne Upload-Eintrag und Kamera-Originale.${more}`,
        confirmLabel: "Endgültig löschen",
      })) return;
      const { data } = await api.post("/admin/media/cleanup-unused", { filenames: preview.filenames });
      const skipped = data?.skipped ? `, ${data.skipped} inzwischen verwendet und behalten` : "";
      const later = data?.file_pending ? ` (${data.file_pending} beim nächsten Aufräumen)` : "";
      toast.success(`${data?.deleted || 0} ${data?.deleted === 1 ? "Datei" : "Dateien"} gelöscht${later}${skipped}.`);
      setSelected(null);
      await load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Löschen fehlgeschlagen");
    } finally {
      setCleaning(false);
    }
  };

  // Duplikat ersetzen (#2122): Diese Datei bleibt, jede Stelle mit einer Kopie zeigt danach auf sie.
  const keepDuplicate = async (it) => {
    const copies = (it.duplicate_filenames || []).filter((name) => name !== it.filename);
    if (!await confirm({
      title: `${copies.length === 1 ? "Kopie" : `${copies.length} Kopien`} ersetzen?`,
      description: `„${it.filename}“ bleibt. Jede Stelle, die eine Kopie zeigt, zeigt danach diese Datei, die Kopien werden gelöscht. Das lässt sich nicht rückgängig machen. Kopien aus Uploads von Mitgliedern bleiben.`,
      confirmLabel: "Ersetzen",
    })) return;
    try {
      const { data } = await api.post("/admin/media/duplicates/replace", { keep: it.filename });
      toast.success(`${data?.removed || 0} ${data?.removed === 1 ? "Kopie" : "Kopien"} ersetzt, ${data?.references || 0} ${data?.references === 1 ? "Stelle" : "Stellen"} umgestellt.`);
      setSelected(null);
      await load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Das Ersetzen ist fehlgeschlagen.");
    }
  };

  const auditScopes = async () => {
    setAuditingScopes(true);
    try {
      const { data } = await api.get("/uploads/audit-media-scopes");
      setScopeAudit(data);
      const s = data.summary || {};
      toast.success(`Medien geprüft: ${s.already_scoped || 0} zugeordnet, ${(s.scanned || 0) - (s.already_scoped || 0)} ohne Zuordnung.`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Die Prüfung ist fehlgeschlagen.");
    } finally {
      setAuditingScopes(false);
    }
  };

  const repairScopes = async () => {
    if (!await confirm({
      title: "Alte Uploads einsortieren?",
      description: "Uploads ohne Bereich werden danach einsortiert, wo sie verwendet werden: Profil, Redaktion, Sponsor, Logos und Marke oder Galerie. An den Dateien ändert sich nichts.",
      confirmLabel: "Einsortieren",
      tone: "info",
    })) return;
    setRepairingScopes(true);
    try {
      const { data } = await api.post("/uploads/repair-media-scopes");
      setScopeAudit(data);
      toast.success(`${data.summary?.updated || 0} Uploads einsortiert.`);
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Das Einsortieren ist fehlgeschlagen.");
    } finally {
      setRepairingScopes(false);
    }
  };

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Content</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Medien</h1>
      <p className="mt-2 text-white/55 text-sm max-w-2xl">
        Alle hochgeladenen Bilder und Dateien an einem Ort: ansehen, Adresse kopieren, drehen oder löschen.
      </p>

      {/* Toolbar */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 border border-white/10 rounded-sm p-1 bg-[#121212]">
          {[["all", "Alle"], ["images", "Bilder"], ["videos", "Videos"], ["files", "Dateien"]].map(([k, label]) => (
            <button
              key={k}
              data-testid={`media-filter-${k}`}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm ${
                filter === k ? "bg-[#FFD700] text-black" : "text-white/60 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value)}
          data-testid="media-scope-filter"
          className="bg-[#121212] border border-white/10 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider text-white"
        >
          {Object.entries(MEDIA_SCOPE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <label className="h-[34px] inline-flex items-center gap-2 border border-white/10 bg-[#121212] rounded-sm px-3 text-xs font-bold uppercase tracking-wider text-white/70">
          <input
            type="checkbox"
            checked={includeUserUploads}
            onChange={(e) => setIncludeUserUploads(e.target.checked)}
            data-testid="media-include-users"
            className="accent-[#29B6E8]"
          />
          Uploads von Mitgliedern
        </label>
        <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-md">
          <Search className="w-4 h-4 text-white/40" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Dateinamen suchen…"
            data-testid="media-search"
            className="w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-1.5 text-sm text-white"
          />
        </div>
        <button
          onClick={load}
          data-testid="media-refresh"
          className="px-3 py-2 border border-white/10 hover:bg-white/5 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Neu laden
        </button>
        <label className={`px-3 py-2 bg-[#FFD700] text-black rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 cursor-pointer ${uploading ? "opacity-60" : ""}`} data-testid="media-upload">
          <Upload className="w-3.5 h-3.5" /> {uploading ? "Lade hoch…" : "Medien hochladen"}
          <input type="file" accept={MEDIA_ACCEPT} multiple disabled={uploading} className="hidden" onChange={(e) => { uploadMediaFiles(e.target.files); e.target.value = ""; }} />
        </label>
        <span className="ml-auto text-xs text-white/45">
          {total} {total === 1 ? "Datei" : "Dateien"} · {fmtBytes(totalSize)}
        </span>
      </div>
      <UploadProgressPanel progress={uploadProgress.progress} className="mt-4" />
      <UploadEventsPanel events={uploadEvents} loading={loadingUploadEvents} onRefresh={loadUploadEvents} />

      {mediaAudit && (
        <div className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {[
            ["Dateien", mediaAudit.total || 0, "text-white"],
            ["Ungenutzt", mediaAudit.unused || 0, mediaAudit.unused ? "text-[#FFD700]" : "text-white"],
            ["Nicht erfasst", mediaAudit.untracked || 0, mediaAudit.untracked ? "text-[#FFD700]" : "text-white"],
            ["Duplikate", mediaAudit.duplicate_files || 0, mediaAudit.duplicate_files ? "text-[#FFD700]" : "text-white"],
            ["Einträge ohne Datei", mediaAudit.metadata_missing_files || 0, mediaAudit.metadata_missing_files ? "text-[#FF3B30]" : "text-white"],
            ["Verweise ins Leere", mediaAudit.reference_summary?.missing_file || 0, mediaAudit.reference_summary?.missing_file ? "text-[#FF3B30]" : "text-white"],
          ].map(([label, value, color]) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                if (label === "Ungenutzt") setScopeFilter("unused");
                if (label === "Nicht erfasst") setScopeFilter("untracked");
                if (label === "Duplikate") setScopeFilter("duplicate");
              }}
              className="border border-white/10 bg-[#121212] rounded-sm p-3 text-left hover:border-white/25"
            >
              <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold">{label}</div>
              <div className={`font-heading text-2xl font-black mt-1 tabular-nums ${color}`}>{value}</div>
            </button>
          ))}
        </div>
      )}
      {mediaAudit?.unused > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={cleanupUnused} disabled={cleaning} data-testid="media-cleanup-unused" className="tls-btn tls-btn--danger min-h-11 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
            {cleaning ? "Prüfe …" : "Ungenutzte löschen"}
          </button>
          <span className="text-xs text-white/45">Vor dem Löschen siehst du, wie viele es sind.</span>
        </div>
      )}
      {/* Original-Bilder der Serien (#1933): privat abgelegt, gepflegt im Ergebnisblatt des Termins - hier nur gezählt. */}
      {mediaAudit?.reference_originals?.count > 0 && (
        <p className="mt-2 text-xs text-white/50 tabular-nums" data-testid="media-reference-originals">
          Dazu privat: {mediaAudit.reference_originals.count} Original-Bilder der Serien · {fmtBytes(mediaAudit.reference_originals.bytes)} – sie stehen im Ergebnisblatt ihres Termins, nicht in dieser Liste.
        </p>
      )}

      {mediaAudit?.by_scope && (
        <details className="mt-4 border border-white/10 bg-[#0A0A0A] rounded-sm p-4 group">
          <summary className="cursor-pointer list-none flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#29B6E8]">Medienpflege</div>
              <p className="mt-1 text-xs text-white/45">Bereiche und das Einsortieren alter Uploads – nur bei Bedarf einblenden.</p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/45 group-open:text-white">Einblenden</span>
          </summary>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={auditScopes}
              disabled={auditingScopes}
              data-testid="media-scope-audit"
              className="px-3 py-2 border border-white/10 hover:border-[#29B6E8]/60 hover:text-[#29B6E8] rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-50"
            >
              {auditingScopes ? "Prüfe..." : "Zuordnung prüfen"}
            </button>
            <button
              onClick={repairScopes}
              disabled={repairingScopes}
              data-testid="media-scope-repair"
              className="px-3 py-2 border border-[#FFD700]/40 text-[#FFD700] hover:bg-[#FFD700]/10 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-50"
            >
              {repairingScopes ? "Sortiere..." : "Alte Uploads einsortieren"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-widest font-bold text-white/50">
            {Object.entries(mediaAudit.by_scope).map(([scope, count]) => (
              <button
                key={scope}
                type="button"
                onClick={() => setScopeFilter(scope)}
                className={`border rounded-sm px-2.5 py-1.5 ${scopeFilter === scope ? "border-[#29B6E8] text-[#29B6E8] bg-[#29B6E8]/10" : "border-white/10 hover:border-white/25"}`}
              >
                {MEDIA_SCOPE_LABELS[scope] || scope}: {count}
              </button>
            ))}
          </div>
        </details>
      )}

      {mediaAudit && (
        <details className="mt-4 border border-white/10 bg-[#121212] rounded-sm p-4 group" data-testid="media-quality-checklist">
          <summary className="cursor-pointer list-none flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#29B6E8]">Medien-Prüfung</div>
              <p className="mt-1 max-w-3xl text-xs text-white/50">
                Zeigt, wo bei den Medien etwas nicht stimmt. Bildbeschreibungen pflegt ihr dort, wo das Bild steht – es kann in News, Event, Galerie oder beim Sponsor etwas anderes bedeuten.
              </p>
            </div>
            <span className="inline-flex items-center justify-center gap-2 rounded-sm border border-white/10 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white/60 group-open:text-white">
              Details einblenden
            </span>
          </summary>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {qualityChecks.map((check) => {
              const ok = Number(check.value || 0) === 0;
              const color = ok ? "#00FF88" : check.tone === "danger" ? "#FF3B30" : "#FFD700";
              const clickable = !!check.filter && !ok;
              return (
                <button
                  key={check.key}
                  type="button"
                  disabled={!clickable}
                  onClick={() => check.filter && setScopeFilter(check.filter)}
                  className={`rounded-sm border bg-[#0A0A0A] p-3 text-left transition ${clickable ? "hover:border-[#29B6E8]/60" : ""}`}
                  style={{ borderColor: ok ? "rgba(255,255,255,0.1)" : `${color}66` }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">{check.label}</span>
                    {ok ? <CheckCircle2 className="h-4 w-4 text-[#00FF88]" /> : <AlertTriangle className="h-4 w-4" style={{ color }} />}
                  </div>
                  <div className="mt-2 font-heading text-2xl font-black tabular-nums" style={{ color }}>{check.value || 0}</div>
                  <div className="mt-1 text-xs text-white/45">{ok ? "Sauber." : check.detail}</div>
                </button>
              );
            })}
          </div>
        </details>
      )}

      {scopeAudit?.summary && (
        <div className="mt-4 border border-white/10 bg-[#0A0A0A] rounded-sm p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/50">Medien-Einsortierung</div>
              <p className="mt-1 text-xs text-white/45">Zeigt, wie viele Uploads persönliche Profilbilder, Medien der Redaktion oder aus anderen Bereichen sind.</p>
            </div>
            {scopeAudit.repair && <span className="text-[10px] uppercase tracking-widest font-bold text-[#00FF88]">Einsortiert</span>}
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-xs">
            {[
              ["Gesamt", scopeAudit.summary.scanned],
              ["Schon sauber", scopeAudit.summary.already_scoped],
              ["Neu einsortiert", scopeAudit.summary.updated],
              ["Profil", scopeAudit.summary.user],
              ["Redaktion", scopeAudit.summary.admin],
              ["Sponsor", scopeAudit.summary.sponsor],
              ["Logos und Marke", scopeAudit.summary.branding],
              ["Galerie", scopeAudit.summary.gallery],
            ].map(([label, value]) => (
              <div key={label} className="border border-white/10 rounded-sm px-3 py-2">
                <div className="text-white/45 uppercase tracking-wider font-bold">{label}</div>
                <div className="font-display text-lg text-white mt-1">{value || 0}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="mt-6">
        {loading ? (
          <div className="text-white/50 text-sm">Lade Medien…</div>
        ) : items.length === 0 ? (
          <div className="border border-white/10 rounded-sm p-12 bg-[#121212] text-center text-white/40 text-sm">
            Keine Dateien {q || filter !== "all" || scopeFilter !== "all" ? "gefunden" : "vorhanden"}.
          </div>
        ) : (
          <div
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
            data-testid="media-grid"
          >
            {items.map((it) => {
              const isImg = IMG_EXT.has(it.ext);
              const isVideo = VIDEO_EXT.has(it.ext);
              const isOriginal = ORIGINAL_EXT.has(it.ext);
              const fullUrl = `${BACKEND}${it.url}`;
              const previewUrl = cacheBustedMediaUrl(fullUrl, it);
              return (
                <div
                  key={it.filename}
                  data-testid={`media-tile-${it.filename}`}
                  className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden hover:border-[#FFD700]/60 transition group cursor-pointer"
                  onClick={() => setSelected(it)}
                >
                  <div className="aspect-square bg-[#0A0A0A] flex items-center justify-center overflow-hidden">
                    {isImg || isVideo ? (
                      <MediaPreview
                        item={it}
                        src={previewUrl}
                        className="w-full h-full object-cover group-hover:scale-105 transition"
                        compact
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-white/40">
                        <FileText className="w-10 h-10" />
                        <span className="text-[10px] font-mono uppercase">{isOriginal ? it.ext || "orig" : it.ext || "file"}</span>
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <div className="text-[11px] font-mono text-white/70 truncate">{it.filename}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className="text-[9px] uppercase tracking-wider border border-white/10 px-1.5 py-0.5 text-white/45">{MEDIA_SCOPE_LABELS[it.media_scope] || MEDIA_SCOPE_LABELS.legacy}</span>
                      {it.is_unused && <span className="text-[9px] uppercase tracking-wider border border-[#FFD700]/30 px-1.5 py-0.5 text-[#FFD700]">ungenutzt</span>}
                      {!it.tracked && <span className="text-[9px] uppercase tracking-wider border border-[#FF3B30]/30 px-1.5 py-0.5 text-[#FF3B30]">nicht erfasst</span>}
                      {it.duplicate_count > 1 && <span className="text-[9px] uppercase tracking-wider border border-[#FFD700]/30 px-1.5 py-0.5 text-[#FFD700]">duplikat</span>}
                    </div>
                    <div className="text-[10px] text-white/40 mt-1">{fmtBytes(it.size)} · {it.usage_count || 0}x genutzt</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {pageCount > 1 && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3" data-testid="media-pager">
            <button type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0 || loading} data-testid="media-page-prev" className="min-h-11 px-4 py-2 border border-white/10 hover:bg-white/5 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-40">Zurück</button>
            <span className="text-xs tabular-nums text-white/60" data-testid="media-page-label">Seite {page + 1} von {pageCount}</span>
            <button type="button" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={page >= pageCount - 1 || loading} data-testid="media-page-next" className="min-h-11 px-4 py-2 border border-white/10 hover:bg-white/5 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-40">Weiter</button>
          </div>
        )}
      </div>

      {selected && (
        <MediaDetailSheet
          item={selected}
          onClose={() => setSelected(null)}
          onCopy={() => copyUrl(selected)}
          onRotateLeft={() => rotateImage(selected, -90)}
          onRotateRight={() => rotateImage(selected, 90)}
          onDelete={() => del(selected)}
          onKeepDuplicate={selected.duplicate_count > 1 ? () => keepDuplicate(selected) : undefined}
        />
      )}
    </AdminLayout>
  );
}

// Seitenblatt statt Fenster (#435, letzter Rest): Vorschau, Angaben und „Verwendet in“ im Blatt, die
// Aktionen in der Leiste unten; die Kacheln bleiben daneben sichtbar.
