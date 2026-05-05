import { useEffect, useRef, useState } from "react";
import { Upload, X, Image as ImageIcon } from "lucide-react";
import { api, formatApiError, resolveMediaUrl } from "@/lib/api";
import { toast } from "sonner";

const parseUploadMb = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const DEFAULT_IMAGE_UPLOAD_MB = parseUploadMb(process.env.REACT_APP_MAX_IMAGE_UPLOAD_MB, 50);
const PROXY_UPLOAD_LIMIT_MB = parseUploadMb(process.env.REACT_APP_PROXY_UPLOAD_LIMIT_MB, Math.ceil(DEFAULT_IMAGE_UPLOAD_MB * 1.2));
const IMAGE_COMPRESS_TRIGGER_MB = parseUploadMb(process.env.REACT_APP_IMAGE_COMPRESS_TRIGGER_MB, 8);
const IMAGE_COMPRESS_TARGET_MB = parseUploadMb(process.env.REACT_APP_IMAGE_COMPRESS_TARGET_MB, Math.min(8, DEFAULT_IMAGE_UPLOAD_MB));
const IMAGE_MAX_DIMENSION = Number.parseInt(process.env.REACT_APP_IMAGE_MAX_DIMENSION || "4096", 10) || 4096;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const SUPPORTED_IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i;
let activeImageUploads = 0;
const uploadBusyListeners = new Set();

function emitUploadBusy() {
  const busy = activeImageUploads > 0;
  uploadBusyListeners.forEach((listener) => listener(busy));
}

function changeActiveUploads(delta) {
  activeImageUploads = Math.max(0, activeImageUploads + delta);
  emitUploadBusy();
}

export function useImageUploadBusy() {
  const [busy, setBusy] = useState(activeImageUploads > 0);
  useEffect(() => {
    uploadBusyListeners.add(setBusy);
    setBusy(activeImageUploads > 0);
    return () => uploadBusyListeners.delete(setBusy);
  }, []);
  return busy;
}

function browserCanOptimizeImages() {
  return typeof window !== "undefined" && typeof document !== "undefined" && typeof Image !== "undefined";
}

function fileLooksSupported(file) {
  const type = (file.type || "").toLowerCase();
  return SUPPORTED_IMAGE_TYPES.has(type) || SUPPORTED_IMAGE_EXT_RE.test(file.name || "");
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    if (img.decode) {
      await img.decode();
    } else {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
    }
    return { img, url };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function prepareImageForUpload(file, maxSizeMb = DEFAULT_IMAGE_UPLOAD_MB) {
  if (!file) return file;
  if (!fileLooksSupported(file)) {
    throw new Error("Nur PNG, JPG oder WebP erlaubt.");
  }
  if (!browserCanOptimizeImages()) return file;

  const maxBytes = maxSizeMb * 1024 * 1024;
  const triggerBytes = IMAGE_COMPRESS_TRIGGER_MB * 1024 * 1024;
  const targetBytes = Math.min(maxBytes, IMAGE_COMPRESS_TARGET_MB * 1024 * 1024);
  let imageData = null;
  try {
    imageData = await loadImage(file);
    const { img } = imageData;
    const needsResize = img.naturalWidth > IMAGE_MAX_DIMENSION || img.naturalHeight > IMAGE_MAX_DIMENSION;
    const needsCompression = file.size > triggerBytes || file.size > maxBytes || needsResize;
    if (!needsCompression) return file;

    const scale = Math.min(1, IMAGE_MAX_DIMENSION / img.naturalWidth, IMAGE_MAX_DIMENSION / img.naturalHeight);
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, width, height);

    let bestBlob = null;
    for (const quality of [0.9, 0.82, 0.74, 0.66, 0.58]) {
      const blob = await canvasToBlob(canvas, "image/webp", quality);
      if (!blob) continue;
      if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
      if (blob.size <= targetBytes) break;
    }
    if (!bestBlob) return file;
    if (file.size <= maxBytes && bestBlob.size >= file.size) return file;
    const baseName = (file.name || "bild").replace(/\.[^/.]+$/, "") || "bild";
    return new File([bestBlob], `${baseName}.webp`, { type: "image/webp", lastModified: Date.now() });
  } catch (error) {
    console.warn("[uploads] Bildoptimierung im Browser fehlgeschlagen:", error);
    return file;
  } finally {
    if (imageData?.url) URL.revokeObjectURL(imageData.url);
  }
}

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
export function ImageUpload({ value, onChange, label, testId = "image-upload", variant = "square", endpoint = "/uploads/image", maxSizeMb = DEFAULT_IMAGE_UPLOAD_MB, allowLibrary = false }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [library, setLibrary] = useState([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    changeActiveUploads(1);
    try {
      const uploadFile = await prepareImageForUpload(file, maxSizeMb);
      if (uploadFile.size > maxSizeMb * 1024 * 1024) {
        toast.error(`Datei zu gross (max ${maxSizeMb} MB). Bitte Bild kleiner exportieren oder Proxy-Limit erhoehen.`);
        return;
      }
      const fd = new FormData();
      fd.append("file", uploadFile);
      const { data } = await api.post(endpoint, fd);
      onChange(data.url);
      toast.success(uploadFile !== file ? "Bild optimiert und hochgeladen." : "Bild hochgeladen.");
    } catch (e) {
      const detail = e.response?.data?.detail;
      const status = e.response?.status;
      const message = status === 413
        ? `Datei zu gross oder Reverse Proxy blockiert den Upload. App-Limit: ${maxSizeMb} MB, externer Proxy bitte auf mindestens ${PROXY_UPLOAD_LIMIT_MB} MB setzen.`
        : detail ? formatApiError(detail) : e.message || "Upload fehlgeschlagen";
      toast.error(status ? `Upload fehlgeschlagen (${status}): ${message}` : `Upload fehlgeschlagen: ${message}`);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
      setUploading(false);
      changeActiveUploads(-1);
    }
  };

  const openLibrary = async () => {
    setLibraryOpen(true);
    setLoadingLibrary(true);
    try {
      const { data } = await api.get("/media?type=images");
      setLibrary(data || []);
    } catch {
      toast.error("Medienbibliothek konnte nicht geladen werden.");
    } finally {
      setLoadingLibrary(false);
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
              <img src={resolveMediaUrl(value)} alt="" className="w-full h-full object-contain" />
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
          {allowLibrary && (
            <button
              type="button"
              onClick={openLibrary}
              data-testid={`${testId}-library`}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 border border-white/15 text-white/70 font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-white/5"
            >
              Medien wählen
            </button>
          )}
          <p className="text-[10px] text-white/40">PNG/JPG/WebP bis {maxSizeMb} MB.</p>
        </div>
      </div>
      {libraryOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-4 overflow-y-auto" onClick={() => setLibraryOpen(false)}>
          <div className="max-w-4xl mx-auto bg-[#121212] border border-white/10 rounded-sm p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading text-xl font-black uppercase">Medienbibliothek</h3>
              <button type="button" onClick={() => setLibraryOpen(false)} className="text-white/50 hover:text-white">×</button>
            </div>
            {loadingLibrary ? (
              <div className="text-white/40 py-12 text-center">Lade Medien…</div>
            ) : library.length === 0 ? (
              <div className="text-white/40 py-12 text-center">Keine Bilder vorhanden.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {library.map((item) => (
                  <button
                    key={item.filename}
                    type="button"
                    onClick={() => { onChange(item.url); setLibraryOpen(false); }}
                    className="aspect-square border border-white/10 bg-[#0A0A0A] rounded-sm overflow-hidden hover:border-[#29B6E8]/70 transition"
                    title={item.filename}
                  >
                    <img src={resolveMediaUrl(item.url)} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
