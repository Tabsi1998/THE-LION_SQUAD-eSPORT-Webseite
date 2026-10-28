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

// ---------------------------------------------------------------- Wann erscheint der Beitrag? (#2122 NW1)
// Neu ist ein Beitrag immer ein Entwurf. Veröffentlicht wird bewusst: „Jetzt“ oder „Geplant“ mit Termin - und vorher
// sagt eine Rückfrage, was hinausgeht (Newsletter an N Personen, Discord, Meldung).

export const PUBLISH_MODES = ["draft", "now", "scheduled"];

/** Der Stand beim Öffnen: Entwurf (auch zurückgezogen), geplant (Termin in der Zukunft) oder veröffentlicht. */
export function initialPublishMode(post, now = Date.now()) {
  if (!post?.id || post.withdrawn_at || !post.published) return "draft";
  return futureDate(post.published_at, now) ? "scheduled" : "now";
}

/**
 * Was gespeichert wird: `published` und `published_at` aus der Wahl. Ein schon veröffentlichter Beitrag behält sein
 * Datum; „Jetzt“ aus Entwurf oder Plan setzt den Zeitpunkt auf jetzt. Ein Termin in der Vergangenheit ist ein Fehler -
 * sonst erschiene der Beitrag sofort, obwohl „Geplant“ gewählt war.
 */
export function publishFields(mode, scheduledAt, initialMode, original = {}, now = Date.now()) {
  if (mode === "draft") return { published: false, published_at: original.published_at || "" };
  if (mode === "now") {
    return initialMode === "now"
      ? { published: true, published_at: original.published_at || "" }
      : { published: true, published_at: new Date(now).toISOString() };
  }
  const date = scheduledAt ? new Date(scheduledAt) : null;
  if (!date || Number.isNaN(date.getTime())) return { error: "Für „Geplant“ fehlt der Termin." };
  if (date.getTime() <= now) return { error: "Der Termin liegt in der Vergangenheit – wähle „Jetzt veröffentlichen“ oder einen späteren Termin." };
  return { published: true, published_at: scheduledAt };
}

/** Braucht das Speichern eine Rückfrage? Nur, wenn der Beitrag dadurch hinausgeht oder geplant wird. */
export function needsPublishQuestion(mode, initialMode) {
  return mode !== "draft" && mode !== initialMode;
}

function persons(count) {
  const value = Number(count) || 0;
  return value === 1 ? "1 Person" : `${value} Personen`;
}

/** Die Rückfrage vor dem Veröffentlichen: was hinausgeht und wann. */
export function publishQuestion({ mode, whenText = "", audience = null, sentAt = "", sentText = "", discord = null }) {
  const scheduled = mode === "scheduled";
  const lines = [];
  if (sentAt) lines.push(`Der Newsletter ging schon${sentText ? ` am ${sentText}` : ""} hinaus – kein zweites Mal.`);
  else if (audience?.internal) lines.push("Kein Newsletter – „Nur intern“ geht nicht per Mail hinaus.");
  else if (audience) lines.push(scheduled
    ? `Zum Termin geht der Newsletter an ${persons(audience.recipients)} mit Newsletter-Zustimmung (Stand jetzt).`
    : `Der Newsletter geht sofort an ${persons(audience.recipients)} mit Newsletter-Zustimmung.`);
  else lines.push(scheduled ? "Zum Termin geht der Newsletter an alle mit Newsletter-Zustimmung." : "Der Newsletter geht sofort an alle mit Newsletter-Zustimmung.");
  if (audience?.announcement && audience.visibility && audience.visibility !== "public" && audience.visibility !== "community") lines.push(audience.announcement);
  if (discord === true) lines.push(scheduled ? "Discord bekommt zum Termin eine Meldung." : "Discord bekommt eine Meldung.");
  if (discord === false) lines.push("Keine Meldung auf Discord.");
  return {
    title: scheduled ? `Beitrag für ${whenText || "den Termin"} planen?` : "Beitrag jetzt veröffentlichen?",
    description: lines.join(" "),
    confirmLabel: scheduled ? "Planen" : "Veröffentlichen",
    tone: "info",
  };
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
