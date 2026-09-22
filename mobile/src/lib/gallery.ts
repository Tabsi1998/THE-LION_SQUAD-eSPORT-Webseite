// Galerie in der App (#236): dieselben Alben wie im Web. Kacheln laden die 400-px-Fassung, die
// Großansicht 1600 px - nur für eigene Uploads, fremde Adressen bleiben, wie sie sind.

export type GalleryMediaType = "image" | "video" | "embed";

export type GalleryItem = {
  id: string;
  media_type?: GalleryMediaType | null;
  image_url?: string | null;
  video_url?: string | null;
  embed_url?: string | null;
  external_url?: string | null;
  thumbnail_url?: string | null;
  caption?: string | null;
  section_id?: string | null;
  order_index?: number;
};

export type GallerySection = { id: string; title: string; count?: number };

export type GalleryAlbum = {
  id: string;
  slug?: string;
  title: string;
  description?: string | null;
  cover_url?: string | null;
  taken_at?: string | null;
  visibility?: string | null;
  photo_count?: number;
  video_count?: number;
  media_count?: number;
  sections?: GallerySection[];
  photos?: GalleryItem[];
  event?: { id: string; slug?: string; name?: string } | null;
};

const LOCAL_UPLOAD = /\/(api\/static\/uploads|static\/uploads|uploads)\//;

export function mediaType(item: GalleryItem | null | undefined): GalleryMediaType {
  const type = item?.media_type;
  if (type === "video" || type === "embed" || type === "image") return type;
  if (item?.video_url) return "video";
  if (item?.embed_url) return "embed";
  return "image";
}

export function mediaUrl(item: GalleryItem | null | undefined): string {
  const type = mediaType(item);
  if (type === "image") return item?.image_url || "";
  if (type === "video") return item?.video_url || item?.external_url || "";
  return item?.embed_url || item?.external_url || "";
}

export function posterUrl(item: GalleryItem | null | undefined): string {
  return item?.thumbnail_url || (mediaType(item) === "image" ? item?.image_url || "" : "");
}

/** Eigene Uploads in einer vorgehaltenen Breite (400, 800, 1600) - andere Adressen unverändert. */
export function sizedUpload(url: string | null | undefined, width: 400 | 800 | 1600): string {
  const value = String(url || "");
  if (!value || !LOCAL_UPLOAD.test(value) || !/\.(webp|jpe?g|png)(\?|#|$)/i.test(value)) return value;
  const [base, hash = ""] = value.split("#");
  const joiner = base.includes("?") ? "&" : "?";
  return `${base}${joiner}w=${width}${hash ? `#${hash}` : ""}`;
}

export function albumCover(album: GalleryAlbum): string {
  if (album.cover_url) return album.cover_url;
  const first = (album.photos || []).find((item) => posterUrl(item));
  return posterUrl(first);
}

export function albumCountLabel(album: GalleryAlbum): string {
  const photos = Number(album.photo_count || 0);
  const videos = Number(album.video_count || 0);
  const parts = [];
  if (photos) parts.push(`${photos} ${photos === 1 ? "Bild" : "Bilder"}`);
  if (videos) parts.push(`${videos} ${videos === 1 ? "Video" : "Videos"}`);
  return parts.join(" · ") || "leer";
}

/** Bilder und Videos je Abschnitt, in Albumreihenfolge; ohne Abschnitte ein Block. */
export function groupBySection(album: GalleryAlbum): Array<{ id: string | null; title: string; items: GalleryItem[] }> {
  const items = [...(album.photos || [])].sort((a, b) => Number(a.order_index || 0) - Number(b.order_index || 0));
  const sections = album.sections || [];
  if (!sections.length) return items.length ? [{ id: null, title: "", items }] : [];
  const groups: Array<{ id: string | null; title: string; items: GalleryItem[] }> = sections.map((section) => ({ id: section.id, title: section.title, items: items.filter((item) => item.section_id === section.id) }));
  const loose = items.filter((item) => !item.section_id || !sections.some((section) => section.id === item.section_id));
  if (loose.length) groups.unshift({ id: null, title: "", items: loose });
  return groups.filter((group) => group.items.length);
}
