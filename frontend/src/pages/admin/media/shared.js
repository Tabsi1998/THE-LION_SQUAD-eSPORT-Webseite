// Medien (#223): Konstanten und reine Helfer, die Seite, Vorschau und Seitenblatt teilen.
import { API_BASE } from "@/lib/api";
import { VIDEO_EXTENSIONS } from "@/lib/galleryMedia";
import { formatWhen } from "@/lib/datetime";
import { asInstant } from "@/lib/vienna";

export const BACKEND = API_BASE;

export const IMG_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp"]);

export const VIDEO_EXT = VIDEO_EXTENSIONS;

export const MEDIA_SCOPE_LABELS = {
  all: "Alle Bereiche",
  admin: "Redaktion",
  sponsor: "Sponsor",
  branding: "Logos und Marke",
  gallery: "Galerie",
  user: "Mitglieder",
  legacy: "Ohne Zuordnung",
  unused: "Ungenutzt",
  untracked: "Nicht erfasst",
  duplicate: "Duplikate",
};

export const UPLOAD_STATUS_LABELS = {
  success: "OK",
  failed: "Fehler",
  client_failed: "Browser",
};

export const uploadStatusClass = (status) => {
  if (status === "success") return "border-ok/35 bg-ok/10 text-ok";
  if (status === "client_failed") return "border-warn/35 bg-warn/10 text-warn";
  return "border-warn/35 bg-warn/10 text-warn";
};

export const fmtDateTime = (value) => {
  if (!value) return "-";
  const date = asInstant(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return formatWhen(date);
};

export const fmtBytes = (n) => {
  if (n == null) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

// Ein gedrehtes Bild bringt seine Version schon an der Adresse mit (#2122).
export const cacheBustedMediaUrl = (url, item) => {
  if (String(url).includes("?")) return url;
  const stamp = encodeURIComponent(item?.mtime || item?.updated_at || item?.size || "");
  return stamp ? `${url}?v=${stamp}` : url;
};
