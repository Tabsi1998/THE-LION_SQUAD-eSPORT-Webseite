// Medien (#223): das Seitenblatt einer Datei (Drehen, Zuschneiden, Kopieren, Löschen).
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FileText, Trash2, Copy, ExternalLink, RotateCcw, RotateCw, Download } from "lucide-react";
import { MediaImage } from "./parts";
import { BACKEND, IMG_EXT, MEDIA_SCOPE_LABELS, VIDEO_EXT, cacheBustedMediaUrl, fmtBytes } from "./shared";

export function MediaDetailSheet({ item, onClose, onCopy, onRotateLeft, onRotateRight, onDelete }) {
  const isImg = IMG_EXT.has(item.ext);
  const isVideo = VIDEO_EXT.has(item.ext);
  const canRotate = ["png", "jpg", "jpeg", "webp"].includes(item.ext);
  const fullUrl = `${BACKEND}${item.url}`;
  const previewUrl = cacheBustedMediaUrl(fullUrl, item);
  const footer = (
    <div className="ml-auto flex flex-wrap justify-end gap-2">
      {isImg && canRotate && (
        <>
          <button type="button" onClick={onRotateLeft} data-testid="media-rotate-left" className="px-4 py-2 border border-white/10 hover:bg-white/5 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2">
            <RotateCcw className="w-3.5 h-3.5" /> Links
          </button>
          <button type="button" onClick={onRotateRight} data-testid="media-rotate-right" className="px-4 py-2 border border-white/10 hover:bg-white/5 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2">
            <RotateCw className="w-3.5 h-3.5" /> Rechts
          </button>
        </>
      )}
      <button type="button" onClick={onCopy} data-testid="media-copy-url" className="px-4 py-2 border border-white/10 hover:bg-white/5 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2">
        <Copy className="w-3.5 h-3.5" /> URL kopieren
      </button>
      <a href={fullUrl} download={item.original_filename || item.filename} className="px-4 py-2 border border-white/10 hover:bg-white/5 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2">
        <Download className="w-3.5 h-3.5" /> Download
      </a>
      <button type="button" onClick={onDelete} data-testid="media-delete" className="px-4 py-2 bg-[#FF3B30]/15 text-[#FF3B30] border border-[#FF3B30]/40 hover:bg-[#FF3B30]/25 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2">
        <Trash2 className="w-3.5 h-3.5" /> Löschen
      </button>
    </div>
  );
  return (
    <AdminSheet title={item.filename} eyebrow={isImg ? "Medien · Bild" : isVideo ? "Medien · Video" : "Medien · Datei"} accent="#FFD700" size="xl" onClose={onClose} footer={footer} testId="media-sheet">
      <div className="bg-[#0A0A0A] rounded-sm p-3 flex items-center justify-center min-h-[240px]" data-testid="media-sheet-preview">
        {isImg ? (
          <MediaImage src={previewUrl} alt={item.filename} className="max-h-[50vh] object-contain" />
        ) : isVideo ? (
          <video src={previewUrl} controls playsInline className="max-h-[50vh] max-w-full bg-black" />
        ) : (
          <div className="flex flex-col items-center gap-3 text-white/50 py-12">
            <FileText className="w-16 h-16" />
            <span className="text-sm font-mono uppercase">.{item.ext || "file"}</span>
            <a href={fullUrl} target="_blank" rel="noreferrer" className="text-[#29B6E8] underline text-xs inline-flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> Datei öffnen
            </a>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 text-xs">
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
        {item.duplicate_count > 1 && (
          <div className="col-span-2">
            <div className="uppercase text-[10px] text-white/40 tracking-widest">Duplikate</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {(item.duplicate_filenames || []).map((name) => (
                <span key={name} className="rounded-sm border border-[#FFD700]/25 bg-[#FFD700]/5 px-2 py-1 font-mono text-[10px] text-[#FFD700]">{name}</span>
              ))}
            </div>
          </div>
        )}
        <div className="col-span-2">
          <div className="uppercase text-[10px] text-white/40 tracking-widest">URL</div>
          <code className="text-white/80 font-mono text-[11px] break-all">{fullUrl}</code>
        </div>
      </div>

      {(item.references || []).length > 0 && (
        <div className="border border-white/10 rounded-sm p-3" data-testid="media-sheet-references">
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
    </AdminSheet>
  );
}
