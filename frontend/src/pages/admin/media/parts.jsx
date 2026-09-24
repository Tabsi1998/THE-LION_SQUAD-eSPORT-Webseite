// Medien (#223): Vorschau-Bausteine und die Liste der Upload-Ereignisse.
import { useEffect, useState } from "react";
import { Image as ImageIcon, RefreshCw, Video, Activity } from "lucide-react";
import { MEDIA_SCOPE_LABELS, UPLOAD_STATUS_LABELS, VIDEO_EXT, fmtBytes, fmtDateTime, uploadStatusClass } from "./shared";

export function BrokenImageState({ compact = false }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-2 text-center text-[#FF3B30]/80">
      <ImageIcon className={compact ? "w-6 h-6" : "w-10 h-10"} />
      <span className="text-[9px] uppercase tracking-widest font-bold">Bild nicht erreichbar</span>
    </div>
  );
}

export function MediaImage({ src, alt, className, compact = false }) {
  const [error, setError] = useState(false);
  useEffect(() => setError(false), [src]);
  if (error) return <BrokenImageState compact={compact} />;
  return <img src={src} alt={alt} className={className} loading="lazy" onError={() => setError(true)} />;
}

export function MediaPreview({ item, src, className, compact = false }) {
  const isVideo = VIDEO_EXT.has(item.ext);
  if (isVideo) {
    return (
      <div className="relative w-full h-full">
        <video src={src} className={className} muted playsInline preload="metadata" />
        <span className="absolute left-1 bottom-1 inline-flex items-center gap-1 bg-black/75 px-1.5 py-1 rounded-sm text-[9px] uppercase tracking-widest font-black text-white">
          <Video className="w-3 h-3" /> Video
        </span>
      </div>
    );
  }
  return <MediaImage src={src} alt={item.filename} className={className} compact={compact} />;
}

export function UploadEventsPanel({ events, loading, onRefresh }) {
  const rows = events.slice(0, 20);
  return (
    <div className="mt-4 border border-white/10 bg-[#0A0A0A] rounded-sm p-4" data-testid="upload-events-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.25em] text-[#29B6E8]">
            <Activity className="h-4 w-4" /> Upload-Protokoll
          </div>
          <p className="mt-1 text-xs text-white/45">Letzte Medien-Uploads inklusive Serverfehler, Proxy-Abbruch und Browserfehler.</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-2 self-start rounded-sm border border-white/10 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-white/70 hover:bg-white/5 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Aktualisieren
        </button>
      </div>
      <div className="mt-3 grid gap-2">
        {loading && !rows.length ? (
          <div className="rounded-sm border border-white/10 bg-[#121212] px-3 py-4 text-sm text-white/45">Lade Upload-Protokoll...</div>
        ) : rows.length === 0 ? (
          <div className="rounded-sm border border-white/10 bg-[#121212] px-3 py-4 text-sm text-white/45">Noch keine Upload-Versuche protokolliert.</div>
        ) : rows.map((event) => (
          <div key={event.id} className="rounded-sm border border-white/10 bg-[#121212] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-sm border px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${uploadStatusClass(event.status)}`}>
                {UPLOAD_STATUS_LABELS[event.status] || event.status || "?"}
              </span>
              <span className="min-w-0 flex-1 break-all font-mono text-xs text-white/75">{event.filename || "upload"}</span>
              <span className="text-[10px] uppercase tracking-wider text-white/35">{fmtDateTime(event.created_at)}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-white/45 sm:grid-cols-5">
              <span>{event.kind || "unknown"} · {MEDIA_SCOPE_LABELS[event.media_scope] || event.media_scope || "Scope"}</span>
              <span>{fmtBytes(event.size)}</span>
              <span className="truncate">{event.mime || "-"}</span>
              <span>HTTP {event.status_code || "-"}</span>
              <span>{event.duration_ms != null ? `${event.duration_ms} ms` : "-"}</span>
            </div>
            {event.detail && (
              <div className="mt-2 rounded-sm border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-white/65 break-words">
                {event.detail}
              </div>
            )}
            {event.result?.url && (
              <code className="mt-2 block break-all text-[10px] text-white/35">{event.result.url}</code>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
