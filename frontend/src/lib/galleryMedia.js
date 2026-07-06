import { API_BASE } from "@/lib/api";

export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
export const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "webm", "mov"]);
export const RAW_PHOTO_EXTENSIONS = new Set(["nef", "nrw", "cr2", "cr3", "arw", "dng", "raf", "orf", "rw2"]);
export const VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime,video/x-m4v,.mp4,.m4v,.webm,.mov";
export const MEDIA_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  VIDEO_ACCEPT,
  ".nef",
  ".nrw",
  ".cr2",
  ".cr3",
  ".arw",
  ".dng",
  ".raf",
  ".orf",
  ".rw2",
].join(",");

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const KICK_HOSTS = new Set(["kick.com", "www.kick.com"]);

function parseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^(\/|data:|blob:)/i.test(raw)) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(withProtocol);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function extensionFromUrl(value) {
  const parsed = parseUrl(value);
  const pathname = parsed ? parsed.pathname : String(value || "").split(/[?#]/)[0];
  const ext = pathname.split(".").pop()?.toLowerCase() || "";
  return ext.length <= 5 ? ext : "";
}

export function extensionFromName(value) {
  const ext = String(value || "").split(/[?#]/)[0].split(".").pop()?.toLowerCase() || "";
  return ext.length <= 5 ? ext : "";
}

export function mediaTypeFromFile(file) {
  const type = String(file?.type || "").toLowerCase();
  const ext = extensionFromName(file?.name || "");
  if (RAW_PHOTO_EXTENSIONS.has(ext)) return "file";
  if (type.startsWith("video/") || VIDEO_EXTENSIONS.has(ext)) return "video";
  if (type.startsWith("image/") || IMAGE_EXTENSIONS.has(ext)) return "image";
  return "unknown";
}

export function mediaTypeFromItem(item) {
  const explicit = String(item?.media_type || item?.kind || "").toLowerCase();
  if (["image", "video", "embed"].includes(explicit)) return explicit;
  if (item?.video_url) return "video";
  if (item?.embed_url || item?.external_url) return "embed";
  const ext = String(item?.ext || extensionFromUrl(item?.url || item?.image_url || "")).toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (RAW_PHOTO_EXTENSIONS.has(ext)) return "file";
  return "image";
}

export function isVideoLike(item) {
  const type = mediaTypeFromItem(item);
  return type === "video" || type === "embed";
}

export function galleryMediaUrl(item) {
  const type = mediaTypeFromItem(item);
  if (type === "image") return item?.image_url || item?.url || "";
  if (type === "video") return item?.video_url || item?.external_url || item?.url || "";
  if (type === "file") return item?.file_url || item?.url || "";
  return item?.embed_url || item?.external_url || item?.url || "";
}

export function galleryPosterUrl(item) {
  return item?.thumbnail_url || (mediaTypeFromItem(item) === "image" ? item?.image_url || item?.url : "") || "";
}

function youtubeVideoId(value) {
  const parsed = parseUrl(value);
  if (!parsed || !YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) return "";
  const path = parsed.pathname.split("/").filter(Boolean);
  const id = parsed.hostname.toLowerCase() === "youtu.be"
    ? path[0]
    : parsed.searchParams.get("v") || (path[0] === "embed" || path[0] === "shorts" ? path[1] : "");
  return /^[\w-]{11}$/.test(id || "") ? id : "";
}

function vimeoVideoId(value) {
  const parsed = parseUrl(value);
  if (!parsed || !/(^|\.)vimeo\.com$/i.test(parsed.hostname)) return "";
  const id = parsed.pathname.split("/").filter(Boolean).find((part) => /^\d{6,12}$/.test(part));
  return id || "";
}

function twitchChannel(value) {
  const parsed = parseUrl(value);
  if (!parsed || !/(^|\.)twitch\.tv$/i.test(parsed.hostname)) return "";
  const channel = parsed.pathname.split("/").filter(Boolean)[0] || "";
  return /^[a-zA-Z0-9_]{2,64}$/.test(channel) ? channel : "";
}

function kickChannel(value) {
  const parsed = parseUrl(value);
  if (!parsed || !KICK_HOSTS.has(parsed.hostname.toLowerCase())) return "";
  const channel = parsed.pathname.split("/").filter(Boolean)[0] || "";
  return /^[a-zA-Z0-9_.-]{2,64}$/.test(channel) ? channel : "";
}

export function detectVideoProvider(value) {
  const parsed = parseUrl(value);
  if (!parsed) return { provider: "", videoId: "", thumbnail_url: "" };
  const youtubeId = youtubeVideoId(value);
  if (youtubeId) {
    return {
      provider: "youtube",
      videoId: youtubeId,
      thumbnail_url: `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`,
    };
  }
  const vimeoId = vimeoVideoId(value);
  if (vimeoId) return { provider: "vimeo", videoId: vimeoId, thumbnail_url: "" };
  const twitch = twitchChannel(value);
  if (twitch) return { provider: "twitch", videoId: twitch, thumbnail_url: "" };
  const kick = kickChannel(value);
  if (kick) return { provider: "kick", videoId: kick, thumbnail_url: "" };
  return { provider: "", videoId: "", thumbnail_url: "" };
}

export function buildExternalGalleryPayload(url, caption = "", thumbnailUrl = "") {
  const normalized = parseUrl(url)?.toString() || String(url || "").trim();
  const ext = extensionFromUrl(normalized);
  const detected = detectVideoProvider(normalized);
  if (detected.provider) {
    return {
      media_type: "embed",
      source_type: "external",
      external_url: normalized,
      embed_url: normalized,
      embed_provider: detected.provider,
      thumbnail_url: thumbnailUrl || detected.thumbnail_url || null,
      caption: caption || `${providerLabel(detected.provider)} Video`,
    };
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return {
      media_type: "video",
      source_type: "external",
      external_url: normalized,
      video_url: normalized,
      thumbnail_url: thumbnailUrl || null,
      caption: caption || "Video",
    };
  }
  return {
    media_type: "embed",
    source_type: "external",
    external_url: normalized,
    embed_url: normalized,
    embed_provider: "generic",
    thumbnail_url: thumbnailUrl || null,
    caption: caption || "Video-Link",
  };
}

export function galleryEmbedSrc(item) {
  const url = galleryMediaUrl(item);
  const provider = String(item?.embed_provider || detectVideoProvider(url).provider || "").toLowerCase();
  if (provider === "youtube") {
    const id = youtubeVideoId(url);
    return id ? `https://www.youtube.com/embed/${id}?autoplay=0&rel=0` : "";
  }
  if (provider === "vimeo") {
    const id = vimeoVideoId(url);
    return id ? `https://player.vimeo.com/video/${id}` : "";
  }
  if (provider === "twitch") {
    const channel = twitchChannel(url);
    const parent = typeof window !== "undefined" ? window.location.hostname : "";
    return channel && parent ? `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(parent)}&autoplay=false&muted=true` : "";
  }
  if (provider === "kick") {
    const channel = kickChannel(url);
    return channel ? `https://player.kick.com/${encodeURIComponent(channel)}` : "";
  }
  return "";
}

export function providerLabel(provider) {
  const value = String(provider || "").toLowerCase();
  if (value === "youtube") return "YouTube";
  if (value === "vimeo") return "Vimeo";
  if (value === "twitch") return "Twitch";
  if (value === "kick") return "Kick";
  return "Externer";
}

export function isExternalGalleryMedia(item) {
  if (item?.source_type === "external") return true;
  const url = galleryMediaUrl(item);
  const parsed = parseUrl(url);
  if (!parsed) return false;
  try {
    const apiHost = API_BASE ? new URL(API_BASE).host : window.location.host;
    return parsed.host !== apiHost && parsed.host !== window.location.host;
  } catch {
    return true;
  }
}
