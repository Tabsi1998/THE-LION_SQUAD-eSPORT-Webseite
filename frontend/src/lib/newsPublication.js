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
