/**
 * Phase F.2 — Admin Media Browser.
 * Lists all uploaded files in /api/static/uploads, preview, copy URL, delete.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE, api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { prepareImageForUpload } from "@/components/tls/ImageUpload";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import {
  Image as ImageIcon, FileText, Trash2, Copy, ExternalLink, Search, RefreshCw, Upload,
  RotateCcw, RotateCw,
} from "lucide-react";

const BACKEND = API_BASE;
const IMG_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"]);
const MEDIA_SCOPE_LABELS = {
  all: "Alle",
  admin: "Admin/CMS",
  sponsor: "Sponsor",
  branding: "Branding",
  gallery: "Galerie",
  user: "User",
  legacy: "Legacy",
  unused: "Ungenutzt",
  untracked: "Ungetrackt",
};

const fmtBytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

const cacheBustedMediaUrl = (url, item) => {
  const stamp = encodeURIComponent(item?.mtime || item?.updated_at || item?.size || "");
  return stamp ? `${url}?v=${stamp}` : url;
};

function BrokenImageState({ compact = false }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-2 text-center text-[#FF3B30]/80">
      <ImageIcon className={compact ? "w-6 h-6" : "w-10 h-10"} />
      <span className="text-[9px] uppercase tracking-widest font-bold">Bild nicht erreichbar</span>
    </div>
  );
}

function MediaImage({ src, alt, className, compact = false }) {
  const [error, setError] = useState(false);
  useEffect(() => setError(false), [src]);
  if (error) return <BrokenImageState compact={compact} />;
  return <img src={src} alt={alt} className={className} loading="lazy" onError={() => setError(true)} />;
}

export default function AdminMediaPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [includeUserUploads, setIncludeUserUploads] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [mediaAudit, setMediaAudit] = useState(null);
  const [scopeAudit, setScopeAudit] = useState(null);
  const [auditingScopes, setAuditingScopes] = useState(false);
  const [repairingScopes, setRepairingScopes] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mediaRes, auditRes] = await Promise.allSettled([
        api.get(`/admin/media?include_user_uploads=${includeUserUploads ? "true" : "false"}&include_usage=true`),
        api.get("/admin/media/audit"),
      ]);
      if (mediaRes.status === "fulfilled") setItems(mediaRes.value.data);
      else toast.error(formatApiError(mediaRes.reason?.response?.data?.detail) || "Fehler beim Laden");
      if (auditRes.status === "fulfilled") setMediaAudit(auditRes.value.data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Fehler beim Laden");
    }
    setLoading(false);
  }, [includeUserUploads]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["admin/media", "media", "uploads"]);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (filter === "images" && !IMG_EXT.has(it.ext)) return false;
      if (filter === "files" && IMG_EXT.has(it.ext)) return false;
      if (scopeFilter === "unused" && !it.is_unused) return false;
      else if (scopeFilter === "untracked" && it.tracked) return false;
      else if (!["all", "unused", "untracked"].includes(scopeFilter) && it.media_scope !== scopeFilter) return false;
      const search = `${it.filename || ""} ${it.original_filename || ""}`.toLowerCase();
      if (q && !search.includes(q.toLowerCase())) return false;
      return true;
    });
  }, [items, filter, scopeFilter, q]);

  const totalSize = useMemo(
    () => items.reduce((s, it) => s + (it.size || 0), 0),
    [items],
  );

  const del = async (it) => {
    if (!await confirm({ title: "Datei endgültig löschen?", description: `"${it.filename}" wird aus der Medienbibliothek entfernt. Verknüpfte Bildfelder werden bereinigt.`, confirmLabel: "Löschen" })) return;
    const previous = items;
    setItems((rows) => rows.filter((row) => row.filename !== it.filename));
    setSelected(null);
    try {
      const { data } = await api.delete(`/admin/media/${encodeURIComponent(it.filename)}`);
      toast.success(`Datei gelöscht${data?.cleared_references ? `, ${data.cleared_references} Verknüpfung(en) bereinigt` : ""}`);
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
      toast.success("URL in Zwischenablage kopiert");
    } catch {
      toast.error("Kopieren fehlgeschlagen");
    }
  };

  const rotateImage = async (it, degrees) => {
    try {
      const { data } = await api.post(`/admin/media/${encodeURIComponent(it.filename)}/rotate`, { degrees });
      const updated = {
        ...it,
        size: data?.size ?? it.size,
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

  const uploadFiles = async (files) => {
    if (!files?.length) return;
    setUploading(true);
    let ok = 0;
    let failed = 0;
    for (const file of Array.from(files)) {
      try {
        const uploadFile = await prepareImageForUpload(file);
        const fd = new FormData();
        fd.append("file", uploadFile);
        await api.post("/uploads/image?media_scope=admin", fd);
        ok++;
      } catch (e) {
        failed++;
        toast.error(`${file.name}: ${formatApiError(e.response?.data?.detail) || e.message || "Upload fehlgeschlagen"}`);
      }
    }
    setUploading(false);
    toast.success(`${ok} Datei(en) hochgeladen${failed ? `, ${failed} fehlgeschlagen` : ""}.`);
    load();
  };

  const auditScopes = async () => {
    setAuditingScopes(true);
    try {
      const { data } = await api.get("/uploads/audit-media-scopes");
      setScopeAudit(data);
      const s = data.summary || {};
      toast.success(`Medien geprüft: ${s.already_scoped || 0} einsortiert, ${(s.scanned || 0) - (s.already_scoped || 0)} Legacy.`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Medien-Scope-Prüfung fehlgeschlagen.");
    } finally {
      setAuditingScopes(false);
    }
  };

  const repairScopes = async () => {
    if (!await confirm({
      title: "Medien sauber einsortieren?",
      description: "Alte Upload-Metadaten ohne Scope werden anhand der gespeicherten Bildverknüpfungen in Profil-, Admin-, Sponsor-, Branding- oder Galerie-Medien einsortiert.",
      confirmLabel: "Einsortieren",
      tone: "info",
    })) return;
    setRepairingScopes(true);
    try {
      const { data } = await api.post("/uploads/repair-media-scopes");
      setScopeAudit(data);
      toast.success(`${data.summary?.updated || 0} Medien-Einträge einsortiert.`);
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Medien-Scope-Reparatur fehlgeschlagen.");
    } finally {
      setRepairingScopes(false);
    }
  };

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Phase F</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Medien-Browser</h1>
      <p className="mt-2 text-white/55 text-sm max-w-2xl">
        Alle hochgeladenen Bilder und Dateien an einem Ort. Vorschau, URL kopieren oder löschen — keine SFTP nötig.
      </p>

      {/* Toolbar */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 border border-white/10 rounded-sm p-1 bg-[#121212]">
          {[["all", "Alle"], ["images", "Bilder"], ["files", "Dateien"]].map(([k, label]) => (
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
          User-Medien
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
        <button
          onClick={auditScopes}
          disabled={auditingScopes}
          data-testid="media-scope-audit"
          className="px-3 py-2 border border-white/10 hover:border-[#29B6E8]/60 hover:text-[#29B6E8] rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-50"
        >
          {auditingScopes ? "Prüfe…" : "Scopes prüfen"}
        </button>
        <button
          onClick={repairScopes}
          disabled={repairingScopes}
          data-testid="media-scope-repair"
          className="px-3 py-2 border border-[#FFD700]/40 text-[#FFD700] hover:bg-[#FFD700]/10 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-50"
        >
          {repairingScopes ? "Sortiere…" : "Scopes reparieren"}
        </button>
        <label className={`px-3 py-2 bg-[#FFD700] text-black rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 cursor-pointer ${uploading ? "opacity-60" : ""}`} data-testid="media-upload">
          <Upload className="w-3.5 h-3.5" /> {uploading ? "Lade hoch…" : "Bilder hochladen"}
          <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={uploading} className="hidden" onChange={(e) => uploadFiles(e.target.files)} />
        </label>
        <span className="ml-auto text-xs text-white/45">
          {filtered.length} / {items.length} · {fmtBytes(totalSize)} gesamt
        </span>
      </div>

      {mediaAudit && (
        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            ["Dateien", mediaAudit.total || 0, "text-white"],
            ["Ungenutzt", mediaAudit.unused || 0, mediaAudit.unused ? "text-[#FFD700]" : "text-white"],
            ["Ungetrackt", mediaAudit.untracked || 0, mediaAudit.untracked ? "text-[#FFD700]" : "text-white"],
            ["Defekte Metadaten", mediaAudit.metadata_missing_files || 0, mediaAudit.metadata_missing_files ? "text-[#FF3B30]" : "text-white"],
            ["Fehlende Referenzen", mediaAudit.reference_summary?.missing_file || 0, mediaAudit.reference_summary?.missing_file ? "text-[#FF3B30]" : "text-white"],
          ].map(([label, value, color]) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                if (label === "Ungenutzt") setScopeFilter("unused");
                if (label === "Ungetrackt") setScopeFilter("untracked");
              }}
              className="border border-white/10 bg-[#121212] rounded-sm p-3 text-left hover:border-white/25"
            >
              <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold">{label}</div>
              <div className={`font-heading text-2xl font-black mt-1 tabular-nums ${color}`}>{value}</div>
            </button>
          ))}
        </div>
      )}

      {mediaAudit?.by_scope && (
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
      )}

      {scopeAudit?.summary && (
        <div className="mt-4 border border-white/10 bg-[#0A0A0A] rounded-sm p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/50">Medien-Einsortierung</div>
              <p className="mt-1 text-xs text-white/45">Zeigt, wie viele Uploads persönliche Profilbilder, Admin/CMS-Medien oder Spezialmedien sind.</p>
            </div>
            {scopeAudit.repair && <span className="text-[10px] uppercase tracking-widest font-bold text-[#00FF88]">Reparatur ausgeführt</span>}
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-xs">
            {[
              ["Gesamt", scopeAudit.summary.scanned],
              ["Schon sauber", scopeAudit.summary.already_scoped],
              ["Repariert", scopeAudit.summary.updated],
              ["Profil", scopeAudit.summary.user],
              ["Admin", scopeAudit.summary.admin],
              ["Sponsor", scopeAudit.summary.sponsor],
              ["Branding", scopeAudit.summary.branding],
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
        ) : filtered.length === 0 ? (
          <div className="border border-white/10 rounded-sm p-12 bg-[#121212] text-center text-white/40 text-sm">
            Keine Dateien {q || filter !== "all" ? "gefunden" : "vorhanden"}.
          </div>
        ) : (
          <div
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
            data-testid="media-grid"
          >
            {filtered.map((it) => {
              const isImg = IMG_EXT.has(it.ext);
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
                    {isImg ? (
                      <MediaImage
                        src={previewUrl}
                        alt={it.filename}
                        className="w-full h-full object-cover group-hover:scale-105 transition"
                        compact
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-white/40">
                        <FileText className="w-10 h-10" />
                        <span className="text-[10px] font-mono uppercase">{it.ext || "file"}</span>
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <div className="text-[11px] font-mono text-white/70 truncate">{it.filename}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className="text-[9px] uppercase tracking-wider border border-white/10 px-1.5 py-0.5 text-white/45">{MEDIA_SCOPE_LABELS[it.media_scope] || it.media_scope || "Legacy"}</span>
                      {it.is_unused && <span className="text-[9px] uppercase tracking-wider border border-[#FFD700]/30 px-1.5 py-0.5 text-[#FFD700]">ungenutzt</span>}
                      {!it.tracked && <span className="text-[9px] uppercase tracking-wider border border-[#FF3B30]/30 px-1.5 py-0.5 text-[#FF3B30]">ungetrackt</span>}
                    </div>
                    <div className="text-[10px] text-white/40 mt-1">{fmtBytes(it.size)} · {it.usage_count || 0}x genutzt</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <MediaDetailModal
          item={selected}
          onClose={() => setSelected(null)}
          onCopy={() => copyUrl(selected)}
          onRotateLeft={() => rotateImage(selected, -90)}
          onRotateRight={() => rotateImage(selected, 90)}
          onDelete={() => del(selected)}
        />
      )}
    </AdminLayout>
  );
}

function MediaDetailModal({ item, onClose, onCopy, onRotateLeft, onRotateRight, onDelete }) {
  const isImg = IMG_EXT.has(item.ext);
  const canRotate = ["png", "jpg", "jpeg", "webp"].includes(item.ext);
  const fullUrl = `${BACKEND}${item.url}`;
  const previewUrl = cacheBustedMediaUrl(fullUrl, item);
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-[#121212] border border-white/10 rounded-sm w-full max-w-3xl mx-auto my-6 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading text-xl font-black uppercase truncate flex items-center gap-2">
            {isImg ? <ImageIcon className="w-5 h-5 text-[#FFD700]" /> : <FileText className="w-5 h-5 text-[#FFD700]" />}
            {item.filename}
          </h3>
          <button onClick={onClose} className="text-white/50 hover:text-white text-2xl leading-none">×</button>
        </div>

        <div className="bg-[#0A0A0A] rounded-sm p-3 flex items-center justify-center min-h-[300px]">
          {isImg ? (
            <MediaImage src={previewUrl} alt={item.filename} className="max-h-[60vh] object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-3 text-white/50 py-12">
              <FileText className="w-16 h-16" />
              <span className="text-sm font-mono uppercase">.{item.ext || "file"}</span>
              <a
                href={fullUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[#29B6E8] underline text-xs inline-flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" /> Datei öffnen
              </a>
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
          <div>
            <div className="uppercase text-[10px] text-white/40 tracking-widest">Größe</div>
            <div className="text-white/80">{fmtBytes(item.size)}</div>
          </div>
          <div>
            <div className="uppercase text-[10px] text-white/40 tracking-widest">Geändert</div>
            <div className="text-white/80">{new Date(item.mtime).toLocaleString("de-DE")}</div>
          </div>
          <div>
            <div className="uppercase text-[10px] text-white/40 tracking-widest">Scope</div>
            <div className="text-white/80">{MEDIA_SCOPE_LABELS[item.media_scope] || item.media_scope || "Legacy"}</div>
          </div>
          <div>
            <div className="uppercase text-[10px] text-white/40 tracking-widest">Nutzung</div>
            <div className="text-white/80">{item.usage_count || 0} Referenz(en){item.tracked ? "" : " · ungetrackt"}</div>
          </div>
          {item.original_filename && (
            <div className="col-span-2">
              <div className="uppercase text-[10px] text-white/40 tracking-widest">Originalname</div>
              <div className="text-white/80 font-mono break-all">{item.original_filename}</div>
            </div>
          )}
          <div className="col-span-2">
            <div className="uppercase text-[10px] text-white/40 tracking-widest">URL</div>
            <code className="text-white/80 font-mono text-[11px] break-all">{fullUrl}</code>
          </div>
        </div>

        {(item.references || []).length > 0 && (
          <div className="mt-4 border border-white/10 rounded-sm p-3">
            <div className="uppercase text-[10px] text-white/40 tracking-widest font-bold mb-2">Verwendet in</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {item.references.map((ref, idx) => (
                <div key={`${ref.collection}-${ref.id}-${ref.field}-${idx}`} className="border border-white/10 bg-black/20 rounded-sm px-3 py-2">
                  <div className="font-bold text-white/75">{ref.label || ref.id || ref.collection}</div>
                  <div className="text-white/40 font-mono break-all">{ref.collection}.{ref.field}{ref.text_reference ? " · Text" : ""}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-white/10">
          {isImg && canRotate && (
            <>
              <button
                onClick={onRotateLeft}
                data-testid="media-rotate-left"
                className="px-4 py-2 border border-white/10 hover:bg-white/5 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Links
              </button>
              <button
                onClick={onRotateRight}
                data-testid="media-rotate-right"
                className="px-4 py-2 border border-white/10 hover:bg-white/5 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"
              >
                <RotateCw className="w-3.5 h-3.5" /> Rechts
              </button>
            </>
          )}
          <button
            onClick={onCopy}
            data-testid="media-copy-url"
            className="px-4 py-2 border border-white/10 hover:bg-white/5 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"
          >
            <Copy className="w-3.5 h-3.5" /> URL kopieren
          </button>
          <button
            onClick={onDelete}
            data-testid="media-delete"
            className="px-4 py-2 bg-[#FF3B30]/15 text-[#FF3B30] border border-[#FF3B30]/40 hover:bg-[#FF3B30]/25 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"
          >
            <Trash2 className="w-3.5 h-3.5" /> Löschen
          </button>
        </div>
      </div>
    </div>
  );
}
