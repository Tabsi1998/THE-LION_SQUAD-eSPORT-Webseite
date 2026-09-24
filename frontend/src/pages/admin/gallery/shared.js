// Galerie (#223): reine Helfer für Alben, Abschnitte und Medien.
import { mediaTypeFromItem } from "@/lib/galleryMedia";

export const parseUploadMb = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const MAX_VIDEO_UPLOAD_MB = parseUploadMb(import.meta.env.VITE_MAX_VIDEO_UPLOAD_MB, 1536);

export const PROXY_UPLOAD_LIMIT_MB = parseUploadMb(import.meta.env.VITE_PROXY_UPLOAD_LIMIT_MB, 1700);

export const VIDEO_MAX_BYTES = MAX_VIDEO_UPLOAD_MB * 1024 * 1024;

export const UNSECTIONED_VALUE = "__none";

export function albumMediaCount(album) {
  return album.media_count ?? ((album.photo_count || 0) + (album.video_count || 0));
}

export function sortSections(sections) {
  return [...(sections || [])].sort((a, b) => (a.order_index || 0) - (b.order_index || 0) || String(a.title || "").localeCompare(String(b.title || "")));
}

export function sectionIdFromValue(value) {
  return value && value !== UNSECTIONED_VALUE ? value : null;
}

export function sectionValue(sectionId) {
  return sectionId || UNSECTIONED_VALUE;
}

export function sectionTitle(sections, sectionId) {
  return sections.find((section) => section.id === sectionId)?.title || "Ohne Abschnitt";
}

export function mediaGroupsBySection(media, sections, includeEmpty = false) {
  const orderedSections = sortSections(sections);
  if (!orderedSections.length) {
    return [{ id: "__all", title: "Medien", description: "", items: media || [], section: null }];
  }
  const groups = orderedSections
    .map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description || "",
      section,
      items: (media || []).filter((item) => item.section_id === section.id),
    }))
    .filter((group) => includeEmpty || group.items.length > 0);
  const unsectioned = (media || []).filter((item) => !orderedSections.some((section) => section.id === item.section_id));
  if (unsectioned.length) {
    groups.push({ id: UNSECTIONED_VALUE, title: "Ohne Abschnitt", description: "", section: null, items: unsectioned });
  }
  return groups;
}

export function captionFromFilename(name, fallback = "Medium") {
  return (name || fallback).replace(/\.[^/.]+$/, "");
}

export function galleryPayloadFromMediaItem(item, orderIndex, sectionId = null) {
  const type = mediaTypeFromItem(item);
  const base = {
    caption: captionFromFilename(item.original_filename || item.filename, type === "video" ? "Video" : "Bild"),
    order_index: orderIndex,
    section_id: sectionId || null,
    thumbnail_url: type === "image" ? item.url : "",
    original_url: item.original_url || null,
    original_filename: item.original_filename || null,
    original_mime: item.original_mime || null,
    original_file_size: item.original_file_size || null,
    mime: item.mime || undefined,
    file_size: item.original_file_size || item.size || undefined,
    width: item.width || undefined,
    height: item.height || undefined,
  };
  if (type === "video") {
    return {
      ...base,
      media_type: "video",
      source_type: "upload",
      video_url: item.url,
      thumbnail_url: "",
    };
  }
  return {
    ...base,
    media_type: "image",
    source_type: "upload",
    image_url: item.url,
  };
}
