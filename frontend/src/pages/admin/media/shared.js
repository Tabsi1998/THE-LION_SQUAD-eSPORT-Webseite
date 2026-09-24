// Medien (#223): Konstanten und reine Helfer, die Seite, Vorschau und Seitenblatt teilen.
import { API_BASE } from "@/lib/api";
import { VIDEO_EXTENSIONS } from "@/lib/galleryMedia";

export const BACKEND = API_BASE;

export const IMG_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp"]);

export const VIDEO_EXT = VIDEO_EXTENSIONS;

export const MEDIA_SCOPE_LABELS = {
  all: "Alle",
  admin: "Admin/CMS",
  sponsor: "Sponsor",
  branding: "Branding",
  gallery: "Galerie",
  user: "User",
  legacy: "Legacy",
  unused: "Ungenutzt",
  untracked: "Ungetrackt",
  duplicate: "Duplikate",
};

export const UPLOAD_STATUS_LABELS = {
  success: "OK",
  failed: "Fehler",
  client_failed: "Browser",
};

export const uploadStatusClass = (status) => {
  if (status === "success") return "border-[#00FF88]/35 bg-[#00FF88]/10 text-[#00FF88]";
  if (status === "client_failed") return "border-[#FFD700]/35 bg-[#FFD700]/10 text-[#FFD700]";
  return "border-[#FF3B30]/35 bg-[#FF3B30]/10 text-[#FF3B30]";
};

export const fmtDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("de-DE");
};

export const fmtBytes = (n) => {
  if (n == null) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

export const cacheBustedMediaUrl = (url, item) => {
  const stamp = encodeURIComponent(item?.mtime || item?.updated_at || item?.size || "");
  return stamp ? `${url}?v=${stamp}` : url;
};
