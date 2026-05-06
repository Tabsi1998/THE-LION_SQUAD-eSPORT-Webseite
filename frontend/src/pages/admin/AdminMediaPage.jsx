/**
 * Phase F.2 — Admin Media Browser.
 * Lists all uploaded files in /api/static/uploads, preview, copy URL, delete.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE, api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { prepareImageForUpload } from "@/components/tls/ImageUpload";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import {
  Image as ImageIcon, FileText, Trash2, Copy, ExternalLink, Search, RefreshCw, Upload,
} from "lucide-react";

const BACKEND = API_BASE;
const IMG_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"]);

const fmtBytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
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
  if (error) return <BrokenImageState compact={compact} />;
  return <img src={src} alt={alt} className={className} loading="lazy" onError={() => setError(true)} />;
}

export default function AdminMediaPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/media");
      setItems(data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Fehler beim Laden");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["admin/media", "media", "uploads"]);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (filter === "images" && !IMG_EXT.has(it.ext)) return false;
      if (filter === "files" && IMG_EXT.has(it.ext)) return false;
      if (q && !it.filename.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [items, filter, q]);

  const totalSize = useMemo(
    () => items.reduce((s, it) => s + (it.size || 0), 0),
    [items],
  );

  const del = async (it) => {
    if (!window.confirm(`Datei "${it.filename}" wirklich endgültig löschen?`)) return;
    const previous = items;
    setItems((rows) => rows.filter((row) => row.filename !== it.filename));
    setSelected(null);
    try {
      const { data } = await api.delete(`/admin/media/${encodeURIComponent(it.filename)}`);
      toast.success(`Datei geloescht${data?.cleared_references ? `, ${data.cleared_references} Verknuepfung(en) bereinigt` : ""}`);
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
        await api.post("/uploads/image", fd);
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
          <Upload className="w-3.5 h-3.5" /> {uploading ? "Lade hoch…" : "Bilder hochladen"}
          <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={uploading} className="hidden" onChange={(e) => uploadFiles(e.target.files)} />
        </label>
        <span className="ml-auto text-xs text-white/45">
          {filtered.length} / {items.length} · {fmtBytes(totalSize)} gesamt
        </span>
      </div>

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
                        src={fullUrl}
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
                    <div className="text-[10px] text-white/40">{fmtBytes(it.size)}</div>
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
          onDelete={() => del(selected)}
        />
      )}
    </AdminLayout>
  );
}

function MediaDetailModal({ item, onClose, onCopy, onDelete }) {
  const isImg = IMG_EXT.has(item.ext);
  const fullUrl = `${BACKEND}${item.url}`;
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
            <MediaImage src={fullUrl} alt={item.filename} className="max-h-[60vh] object-contain" />
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
          <div className="col-span-2">
            <div className="uppercase text-[10px] text-white/40 tracking-widest">URL</div>
            <code className="text-white/80 font-mono text-[11px] break-all">{fullUrl}</code>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-white/10">
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
