export function plainTextPreview(value) {
  if (!value) return "";
  return String(value)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/^[\s#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function seoTextPreview(value, fallback = "", maxLength = 180) {
  const text = plainTextPreview(value) || fallback;
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}
