import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Crop, RotateCcw, RotateCw, Upload, X, Image as ImageIcon } from "lucide-react";
import { api, formatApiError, resolveMediaUrl } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";

const parseUploadMb = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const DEFAULT_IMAGE_UPLOAD_MB = parseUploadMb(process.env.REACT_APP_MAX_IMAGE_UPLOAD_MB, 120);
const PROXY_UPLOAD_LIMIT_MB = parseUploadMb(process.env.REACT_APP_PROXY_UPLOAD_LIMIT_MB, Math.ceil(DEFAULT_IMAGE_UPLOAD_MB * 1.25));
const IMAGE_COMPRESS_TRIGGER_MB = parseUploadMb(process.env.REACT_APP_IMAGE_COMPRESS_TRIGGER_MB, 4);
const IMAGE_COMPRESS_TARGET_MB = parseUploadMb(process.env.REACT_APP_IMAGE_COMPRESS_TARGET_MB, Math.min(10, DEFAULT_IMAGE_UPLOAD_MB));
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

function defaultMediaScope() {
  return typeof window !== "undefined" && window.location.pathname.startsWith("/admin") ? "admin" : "user";
}

function defaultLibraryEndpoint() {
  return defaultMediaScope() === "admin" ? "/admin/media?type=images" : "/media?type=images";
}

function endpointWithMediaScope(endpoint, scope) {
  if (!scope || scope === "user") return endpoint;
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}media_scope=${encodeURIComponent(scope)}`;
}

function fileLooksSupported(file) {
  const type = (file.type || "").toLowerCase();
  return SUPPORTED_IMAGE_TYPES.has(type) || SUPPORTED_IMAGE_EXT_RE.test(file.name || "");
}

function imageFileName(value) {
  if (!value) return "";
  try {
    const url = new URL(resolveMediaUrl(value), window.location.origin);
    return decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || String(value));
  } catch {
    return String(value).split("/").pop() || String(value);
  }
}

function ImagePreviewBox({ value, previewClass, onClear, testId }) {
  const [state, setState] = useState(value ? "loading" : "empty");
  const src = value ? resolveMediaUrl(value) : "";

  useEffect(() => {
    setState(value ? "loading" : "empty");
  }, [value]);

  return (
    <div className={`${previewClass} bg-[#0A0A0A] border ${value ? "border-white/10" : "border-dashed border-white/20"} rounded-sm overflow-hidden shrink-0 relative group`} data-testid={`${testId}-preview`}>
      {value ? (
        <>
          {state !== "error" && (
            <img
              key={src}
              src={src}
              alt=""
              className={`w-full h-full object-contain transition-opacity ${state === "loaded" ? "opacity-100" : "opacity-0"}`}
              onLoad={() => setState("loaded")}
              onError={() => setState("error")}
            />
          )}
          {state === "loading" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/35">
              <ImageIcon className="w-7 h-7 animate-pulse" />
              <span className="text-[10px] uppercase tracking-widest font-bold">Lade Vorschau</span>
            </div>
          )}
          {state === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center bg-[#0A0A0A]">
              <ImageIcon className="w-7 h-7 text-[#FF3B30]/70" />
              <span className="text-[10px] uppercase tracking-widest font-bold text-[#FF3B30]">Bild nicht erreichbar</span>
              <span className="text-[10px] text-white/35 break-all line-clamp-2">{imageFileName(value)}</span>
            </div>
          )}
          <button type="button" onClick={onClear} className="absolute top-1 right-1 p-1 bg-black/70 text-white/80 rounded-sm opacity-0 group-hover:opacity-100 transition" data-testid={`${testId}-clear`}>
            <X className="w-3 h-3" />
          </button>
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white/20">
          <ImageIcon className="w-8 h-8" />
        </div>
      )}
    </div>
  );
}

function LibraryThumb({ item }) {
  const [error, setError] = useState(false);
  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-2 text-center text-[#FF3B30]/80">
        <ImageIcon className="w-6 h-6" />
        <span className="text-[9px] uppercase tracking-widest font-bold">Defekt</span>
      </div>
    );
  }
  return (
    <img
      src={resolveMediaUrl(item.url)}
      alt=""
      className="w-full h-full object-cover"
      onError={() => setError(true)}
    />
  );
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function normalizeRotation(value) {
  const rounded = Math.round(Number(value || 0) / 90) * 90;
  return ((rounded % 360) + 360) % 360;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cropAspectForMode(mode) {
  if (mode === "square") return 1;
  if (mode === "portrait") return 4 / 5;
  if (mode === "wide") return 16 / 9;
  return null;
}

function calculateCropSourceRect(width, height, editOptions = null) {
  const cropMode = editOptions?.cropMode || "original";
  const cropAspect = cropAspectForMode(cropMode);
  const zoom = clamp(Number(editOptions?.zoom || 1), 0.55, 3);
  let sourceW = width;
  let sourceH = height;
  if (cropAspect) {
    const sourceAspect = sourceW / sourceH;
    if (sourceAspect > cropAspect) {
      sourceW = sourceH * cropAspect;
    } else {
      sourceH = sourceW / cropAspect;
    }
    sourceW = Math.max(1, sourceW / zoom);
    sourceH = Math.max(1, sourceH / zoom);
  }

  const baseX = (width - sourceW) / 2;
  const baseY = (height - sourceH) / 2;
  const maxOffsetX = Math.abs(baseX);
  const maxOffsetY = Math.abs(baseY);
  return {
    x: Math.round(baseX + clamp(Number(editOptions?.cropX || 0), -1, 1) * maxOffsetX),
    y: Math.round(baseY + clamp(Number(editOptions?.cropY || 0), -1, 1) * maxOffsetY),
    width: Math.max(1, Math.round(sourceW)),
    height: Math.max(1, Math.round(sourceH)),
  };
}

function drawImageRectWithPadding(ctx, img, source, dest) {
  const sx = clamp(source.x, 0, img.naturalWidth);
  const sy = clamp(source.y, 0, img.naturalHeight);
  const right = clamp(source.x + source.width, 0, img.naturalWidth);
  const bottom = clamp(source.y + source.height, 0, img.naturalHeight);
  const sw = Math.max(0, right - sx);
  const sh = Math.max(0, bottom - sy);
  if (!sw || !sh) return;
  const dx = dest.x + ((sx - source.x) / source.width) * dest.width;
  const dy = dest.y + ((sy - source.y) / source.height) * dest.height;
  const dw = (sw / source.width) * dest.width;
  const dh = (sh / source.height) * dest.height;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function drawTransparencyGrid(ctx, width, height) {
  const cell = 16;
  ctx.save();
  ctx.fillStyle = "#171717";
  ctx.fillRect(0, 0, width, height);
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      ctx.fillStyle = ((x / cell + y / cell) % 2 === 0) ? "#262626" : "#101010";
      ctx.fillRect(x, y, cell, cell);
    }
  }
  ctx.restore();
}

function imageDimensionsFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = reject;
    img.src = url;
    if (img.complete && (img.naturalWidth || img.width)) {
      resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    }
  });
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

export async function prepareImageForUpload(file, maxSizeMb = DEFAULT_IMAGE_UPLOAD_MB, editOptions = null) {
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
    const rotation = normalizeRotation(editOptions?.rotation || 0);
    const cropMode = editOptions?.cropMode || "original";
    const zoom = clamp(Number(editOptions?.zoom || 1), 0.55, 3);
    const source = calculateCropSourceRect(img.naturalWidth, img.naturalHeight, editOptions);
    const needsEdit = rotation !== 0 || cropMode !== "original" || zoom !== 1;
    const needsResize = source.width > IMAGE_MAX_DIMENSION || source.height > IMAGE_MAX_DIMENSION;
    const needsCompression = needsEdit || file.size > triggerBytes || file.size > maxBytes || needsResize;
    if (!needsCompression) return file;

    const scale = Math.min(1, IMAGE_MAX_DIMENSION / source.width, IMAGE_MAX_DIMENSION / source.height);
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const rotated = rotation === 90 || rotation === 270;
    const canvas = document.createElement("canvas");
    canvas.width = rotated ? height : width;
    canvas.height = rotated ? width : height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    if (rotation) ctx.rotate((rotation * Math.PI) / 180);
    drawImageRectWithPadding(ctx, img, source, { x: -width / 2, y: -height / 2, width, height });
    ctx.restore();

    let bestBlob = null;
    for (const quality of [0.9, 0.82, 0.74, 0.66, 0.58]) {
      const blob = await canvasToBlob(canvas, "image/webp", quality);
      if (!blob) continue;
      if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
      if (blob.size <= targetBytes) break;
    }
    if (!bestBlob) return file;
    if (!needsEdit && file.size <= maxBytes && bestBlob.size >= file.size) return file;
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
 *   endpoint: "/uploads/image" (default), "/uploads/logo" or "/uploads/sponsor-logo"
 *   mediaScope: "user" | "admin" | "sponsor" | "branding" | "gallery"; defaults by route
 */
export function ImageUpload({ value, onChange, label, testId = "image-upload", variant = "square", endpoint = "/uploads/image", maxSizeMb = DEFAULT_IMAGE_UPLOAD_MB, allowLibrary = false, mediaScope, libraryEndpoint }) {
  const fileRef = useRef(null);
  const cropBoxRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const previewImageRef = useRef(null);
  const effectiveMediaScope = mediaScope || defaultMediaScope();
  const effectiveLibraryEndpoint = libraryEndpoint || defaultLibraryEndpoint();
  const [uploading, setUploading] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [library, setLibrary] = useState([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [editor, setEditor] = useState(null);
  const [drag, setDrag] = useState(null);
  const [cropBox, setCropBox] = useState({ width: 0, height: 0 });
  const [previewReady, setPreviewReady] = useState(false);

  useEffect(() => {
    if (!editor || !cropBoxRef.current) return undefined;
    const update = () => {
      const rect = cropBoxRef.current?.getBoundingClientRect();
      if (rect) setCropBox({ width: rect.width, height: rect.height });
    };
    update();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    resizeObserver?.observe(cropBoxRef.current);
    window.addEventListener("resize", update);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [editor]);

  const closeEditor = useCallback(() => {
    setEditor((cur) => {
      if (cur?.url) URL.revokeObjectURL(cur.url);
      return null;
    });
    previewImageRef.current = null;
    setPreviewReady(false);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const uploadFile = async (file, editOptions = null) => {
    if (!file) return;
    setUploading(true);
    changeActiveUploads(1);
    try {
      const uploadFile = await prepareImageForUpload(file, maxSizeMb, editOptions);
      if (uploadFile.size > maxSizeMb * 1024 * 1024) {
        toast.error(`Datei zu groß (max ${maxSizeMb} MB). Bitte Bild kleiner exportieren oder Proxy-Limit erhöhen.`);
        return false;
      }
      const fd = new FormData();
      fd.append("file", uploadFile);
      const { data } = await api.post(endpointWithMediaScope(endpoint, effectiveMediaScope), fd);
      onChange(data.url);
      toast.success(uploadFile !== file ? "Bild optimiert und hochgeladen." : "Bild hochgeladen.");
      return true;
    } catch (e) {
      const detail = e.response?.data?.detail;
      const status = e.response?.status;
      const message = status === 413
        ? `Datei zu groß oder Reverse Proxy blockiert den Upload. App-Limit: ${maxSizeMb} MB, externer Proxy bitte auf mindestens ${PROXY_UPLOAD_LIMIT_MB} MB setzen.`
        : detail ? formatApiError(detail) : e.message || "Upload fehlgeschlagen";
      toast.error(status ? `Upload fehlgeschlagen (${status}): ${message}` : `Upload fehlgeschlagen: ${message}`);
      return false;
    } finally {
      if (fileRef.current) fileRef.current.value = "";
      setUploading(false);
      changeActiveUploads(-1);
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    if (!fileLooksSupported(file)) {
      toast.error("Nur PNG, JPG oder WebP erlaubt.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (browserCanOptimizeImages()) {
      const url = URL.createObjectURL(file);
      try {
        const dimensions = await imageDimensionsFromUrl(url);
        if (!dimensions.width || !dimensions.height) throw new Error("Bildgröße konnte nicht gelesen werden.");
        setEditor({
          file,
          url,
          rotation: 0,
          cropMode: variant === "square" ? "square" : "original",
          cropX: 0,
          cropY: 0,
          zoom: 1,
          naturalWidth: dimensions.width,
          naturalHeight: dimensions.height,
        });
      } catch (error) {
        URL.revokeObjectURL(url);
        console.warn("[uploads] Bildvorschau konnte nicht geladen werden:", error);
        await uploadFile(file);
      }
      return;
    }
    await uploadFile(file);
  };

  const openLibrary = useCallback(async () => {
    setLibraryOpen(true);
    setLoadingLibrary(true);
    try {
      const { data } = await api.get(effectiveLibraryEndpoint);
      setLibrary(data || []);
    } catch {
      toast.error("Medienbibliothek konnte nicht geladen werden.");
    } finally {
      setLoadingLibrary(false);
    }
  }, [effectiveLibraryEndpoint]);
  useApiInvalidation(() => {
    if (libraryOpen) return openLibrary();
    return undefined;
  }, ["media", "uploads"]);

  const editorSource = editor?.naturalWidth && editor?.naturalHeight
    ? calculateCropSourceRect(editor.naturalWidth, editor.naturalHeight, editor)
    : null;
  useEffect(() => {
    if (!editor?.url) {
      previewImageRef.current = null;
      setPreviewReady(false);
      return undefined;
    }
    let active = true;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (!active) return;
      previewImageRef.current = img;
      setPreviewReady(true);
    };
    img.onerror = () => {
      if (!active) return;
      previewImageRef.current = null;
      setPreviewReady(false);
      toast.error("Bildvorschau konnte nicht geladen werden. Bitte anderes Bild probieren.");
    };
    setPreviewReady(false);
    img.src = editor.url;
    if (img.complete && (img.naturalWidth || img.width)) {
      previewImageRef.current = img;
      setPreviewReady(true);
    }
    return () => {
      active = false;
    };
  }, [editor?.url]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const img = previewImageRef.current;
    if (!canvas || !img || !editorSource || !cropBox.width || !cropBox.height) return;
    const width = Math.max(1, Math.round(cropBox.width));
    const height = Math.max(1, Math.round(cropBox.height));
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawTransparencyGrid(ctx, width, height);
    ctx.save();
    ctx.translate(width / 2, height / 2);
    const rotation = normalizeRotation(editor.rotation || 0);
    if (rotation) ctx.rotate((rotation * Math.PI) / 180);
    const rotated = rotation === 90 || rotation === 270;
    const sourceAspect = rotated ? editorSource.height / editorSource.width : editorSource.width / editorSource.height;
    const boxAspect = width / height;
    let destW = width;
    let destH = height;
    if (editor.cropMode === "original") {
      if (boxAspect > sourceAspect) destW = destH * sourceAspect;
      else destH = destW / sourceAspect;
      if (rotated) [destW, destH] = [destH, destW];
    } else if (rotated) {
      [destW, destH] = [height, width];
    }
    drawImageRectWithPadding(ctx, img, editorSource, {
      x: -destW / 2,
      y: -destH / 2,
      width: destW,
      height: destH,
    });
    ctx.restore();
  }, [editor, editorSource, cropBox, previewReady]);
  const previewClass = variant === "wide"
    ? "aspect-[16/9] w-full"
    : "w-20 h-20";
  return (
    <div>
      {label && <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>}
      <div className={variant === "wide" ? "" : "flex items-start gap-3"}>
        <ImagePreviewBox value={value} previewClass={previewClass} onClear={() => onChange("")} testId={testId} />
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
                    <LibraryThumb item={item} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {editor && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-4 overflow-y-auto" onClick={closeEditor}>
          <div className="max-w-3xl mx-auto bg-[#121212] border border-white/10 rounded-sm p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-4">
              <h3 className="font-heading text-xl font-black uppercase">Bild bearbeiten</h3>
              <button type="button" onClick={closeEditor} className="text-white/50 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div
              ref={cropBoxRef}
              className={`relative mx-auto bg-[#171717] border border-white/10 rounded-sm overflow-hidden flex items-center justify-center touch-none select-none w-full ${editor.cropMode === "wide" ? "aspect-video max-w-3xl" : editor.cropMode === "portrait" ? "aspect-[4/5] max-w-[48vh]" : editor.cropMode === "square" ? "aspect-square max-w-[60vh]" : "min-h-[280px] max-h-[55vh] max-w-3xl"}`}
              onPointerDown={(e) => {
                if (editor.cropMode === "original") return;
                e.currentTarget.setPointerCapture?.(e.pointerId);
                setDrag({ x: e.clientX, y: e.clientY, cropX: editor.cropX || 0, cropY: editor.cropY || 0 });
              }}
              onPointerMove={(e) => {
                if (!drag || editor.cropMode === "original") return;
                const rect = e.currentTarget.getBoundingClientRect();
                const dx = ((e.clientX - drag.x) / Math.max(160, rect.width)) * 2;
                const dy = ((e.clientY - drag.y) / Math.max(160, rect.height)) * 2;
                setEditor((cur) => ({
                  ...cur,
                  cropX: clamp(drag.cropX - dx, -1, 1),
                  cropY: clamp(drag.cropY - dy, -1, 1),
                }));
              }}
              onPointerUp={() => setDrag(null)}
              onPointerCancel={() => setDrag(null)}
            >
              <canvas
                ref={previewCanvasRef}
                className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
                aria-label="Bildvorschau"
              />
              {(!editorSource || !previewReady) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/45">
                  <ImageIcon className="w-8 h-8 animate-pulse" />
                  <span className="text-[10px] uppercase tracking-widest font-bold">Lade Bildvorschau</span>
                </div>
              )}
            </div>
            {editor.cropMode !== "original" && (
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/40">
                <span>Ziehen zum Verschieben</span>
                <span>·</span>
                <span>Zoom unter 100% erzeugt Rand statt harten Anschnitt</span>
              </div>
            )}
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
              <div className="flex flex-wrap gap-2">
                {[
                  ["original", "Original"],
                  ["square", "1:1"],
                  ["portrait", "4:5"],
                  ["wide", "16:9"],
                ].map(([mode, text]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setEditor((cur) => ({ ...cur, cropMode: mode, cropX: 0, cropY: 0, zoom: 1 }))}
                    className={`inline-flex items-center gap-2 px-3 py-2 border rounded-sm text-xs font-bold uppercase tracking-wider ${editor.cropMode === mode ? "border-[#29B6E8] text-[#29B6E8] bg-[#29B6E8]/10" : "border-white/15 text-white/60 hover:text-white"}`}
                  >
                    <Crop className="w-3.5 h-3.5" /> {text}
                  </button>
                ))}
                <button type="button" onClick={() => setEditor((cur) => ({ ...cur, rotation: normalizeRotation(cur.rotation - 90) }))} className="inline-flex items-center gap-2 px-3 py-2 border border-white/15 text-white/60 hover:text-white rounded-sm text-xs font-bold uppercase tracking-wider">
                  <RotateCcw className="w-3.5 h-3.5" /> Links
                </button>
                <button type="button" onClick={() => setEditor((cur) => ({ ...cur, rotation: normalizeRotation(cur.rotation + 90) }))} className="inline-flex items-center gap-2 px-3 py-2 border border-white/15 text-white/60 hover:text-white rounded-sm text-xs font-bold uppercase tracking-wider">
                  <RotateCw className="w-3.5 h-3.5" /> Rechts
                </button>
                {editor.cropMode !== "original" && (
                  <label className="inline-flex items-center gap-2 px-3 py-2 border border-white/15 rounded-sm text-xs text-white/70">
                    Zoom
                    <input
                      type="range"
                      min="0.55"
                      max="3"
                      step="0.05"
                      value={editor.zoom || 1}
                      onChange={(e) => setEditor((cur) => ({ ...cur, zoom: Number(e.target.value), cropX: clamp(cur.cropX || 0, -1, 1), cropY: clamp(cur.cropY || 0, -1, 1) }))}
                      className="w-28 accent-[#29B6E8]"
                    />
                    <span className="tabular-nums text-white/45">{Math.round((editor.zoom || 1) * 100)}%</span>
                  </label>
                )}
                {editor.cropMode !== "original" && (
                  <>
                    <label className="inline-flex items-center gap-2 px-3 py-2 border border-white/15 rounded-sm text-xs text-white/70">
                      X
                      <input
                        type="range"
                        min="-1"
                        max="1"
                        step="0.01"
                        value={editor.cropX || 0}
                        onChange={(e) => setEditor((cur) => ({ ...cur, cropX: Number(e.target.value) }))}
                        className="w-24 accent-[#29B6E8]"
                      />
                    </label>
                    <label className="inline-flex items-center gap-2 px-3 py-2 border border-white/15 rounded-sm text-xs text-white/70">
                      Y
                      <input
                        type="range"
                        min="-1"
                        max="1"
                        step="0.01"
                        value={editor.cropY || 0}
                        onChange={(e) => setEditor((cur) => ({ ...cur, cropY: Number(e.target.value) }))}
                        className="w-24 accent-[#29B6E8]"
                      />
                    </label>
                    <button type="button" onClick={() => setEditor((cur) => ({ ...cur, cropY: -1 }))} className="inline-flex items-center px-3 py-2 border border-white/15 text-white/60 hover:text-white rounded-sm text-xs font-bold uppercase tracking-wider">
                      Oben
                    </button>
                    <button type="button" onClick={() => setEditor((cur) => ({ ...cur, cropX: 0, cropY: 0 }))} className="inline-flex items-center px-3 py-2 border border-white/15 text-white/60 hover:text-white rounded-sm text-xs font-bold uppercase tracking-wider">
                      Mitte
                    </button>
                    <button type="button" onClick={() => setEditor((cur) => ({ ...cur, zoom: 0.75, cropX: 0, cropY: 0 }))} className="inline-flex items-center px-3 py-2 border border-white/15 text-white/60 hover:text-white rounded-sm text-xs font-bold uppercase tracking-wider">
                      Mehr Rand
                    </button>
                  </>
                )}
              </div>
              <button
                type="button"
                disabled={uploading}
                onClick={async () => {
                  const current = editor;
                  const ok = await uploadFile(current.file, { rotation: current.rotation, cropMode: current.cropMode, cropX: current.cropX, cropY: current.cropY, zoom: current.zoom });
                  if (ok) closeEditor();
                }}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-50"
              >
                <Check className="w-4 h-4" /> Übernehmen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
