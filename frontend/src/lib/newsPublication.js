// „in 3 Tagen“ für geplante Beiträge - gebraucht in der News-Liste und im Beitrags-Editor (#434).
export function formatTimeUntil(date) {
  const ms = Math.max(0, date.getTime() - Date.now());
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `in ${minutes} Minute${minutes === 1 ? "" : "n"}`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `in ${hours} Stunde${hours === 1 ? "" : "n"}`;
  const days = Math.ceil(hours / 24);
  return `in ${days} Tag${days === 1 ? "" : "en"}`;
}

function futureDate(value, now) {
  if (!value) return null;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() > now ? date : null;
}

/**
 * Wo ein Beitrag steht (#434, #2122): zurückgezogen, Entwurf, geplant oder veröffentlicht - für Liste und Editor.
 * `key` ist zugleich der Filterwert der Liste.
 */
export function newsPublicationState(post, now = Date.now()) {
  if (post?.withdrawn_at) return { key: "withdrawn", label: "Zurückgezogen", detail: "Besucher sehen nur einen Hinweis", className: "text-[#FF6B6B]" };
  if (!post?.published) return { key: "draft", label: "Entwurf", detail: "", className: "text-white/40" };
  const date = futureDate(post.published_at, now);
  if (date) return { key: "scheduled", label: "Geplant", detail: `Wird ${formatTimeUntil(date)} veröffentlicht`, className: "text-[#29B6E8]" };
  return { key: "published", label: "Veröffentlicht", detail: "", className: "text-[#10B981]" };
}
