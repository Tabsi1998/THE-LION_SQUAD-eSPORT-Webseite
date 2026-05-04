import { useRef, useState } from "react";
import { Upload, X, Image as ImageIcon } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";

/**
 * Reusable image upload field. Renders preview + upload button.
 * Returns the public URL (e.g. /api/static/uploads/abc.png) via onChange.
 *
 * Props:
 *   value: current url string
 *   onChange: (url) => void
 *   label: optional label
 *   testId: data-testid prefix
 *   variant: "square" | "wide" (visual)
 *   endpoint: "/uploads/image" (default) or "/uploads/sponsor-logo"
 */
export function ImageUpload({ value, onChange, label, testId = "image-upload", variant = "square", endpoint = "/uploads/image", maxSizeMb = 5 }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    if (file.size > maxSizeMb * 1024 * 1024) {
      toast.error(`Datei zu groß (max ${maxSizeMb} MB)`);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(endpoint, fd);
      onChange(data.url);
      toast.success("Bild hochgeladen.");
    } catch (e) {
      const detail = e.response?.data?.detail;
      const status = e.response?.status;
      const message = detail ? formatApiError(detail) : e.message || "Upload fehlgeschlagen";
      toast.error(status ? `Upload fehlgeschlagen (${status}): ${message}` : `Upload fehlgeschlagen: ${message}`);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
      setUploading(false);
    }
  };

  const previewClass = variant === "wide"
    ? "aspect-[16/9] w-full"
    : "w-20 h-20";

  return (
    <div>
      {label && <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>}
      <div className={variant === "wide" ? "" : "flex items-start gap-3"}>
        <div className={`${previewClass} bg-[#0A0A0A] border ${value ? "border-white/10" : "border-dashed border-white/20"} rounded-sm overflow-hidden shrink-0 relative group`}>
          {value ? (
            <>
              <img src={value} alt="" className="w-full h-full object-contain" />
              <button type="button" onClick={() => onChange("")} className="absolute top-1 right-1 p-1 bg-black/70 text-white/80 rounded-sm opacity-0 group-hover:opacity-100 transition" data-testid={`${testId}-clear`}>
                <X className="w-3 h-3" />
              </button>
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/20">
              <ImageIcon className="w-8 h-8" />
            </div>
          )}
        </div>
        <div className={variant === "wide" ? "mt-2" : "flex-1 space-y-2"}>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
            data-testid={`${testId}-file`}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            data-testid={`${testId}-btn`}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 border border-[#29B6E8]/40 text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-[#29B6E8]/10 disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" /> {uploading ? "Lade hoch…" : value ? "Anderes Bild" : "Bild hochladen"}
          </button>
          <p className="text-[10px] text-white/40">PNG/JPG/WebP bis {maxSizeMb} MB.</p>
        </div>
      </div>
    </div>
  );
}
