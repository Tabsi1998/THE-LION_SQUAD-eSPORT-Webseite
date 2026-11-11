// Automatische Hinweisbanner (#2352): Beschriftung für die Verwaltung - Art, Vorlage und Zeitraum.
import { formatAgo, formatWhen } from "@/lib/datetime";

const KIND_LABELS = { tournament: "Turnier", fastlap: "Fast Lap", server: "Server-Wartung" };

const TEMPLATE_LABELS = {
  tournament: { registration: "Anmeldung / Check-in", event: "Startet bald" },
  fastlap: { registration: "Einreichung offen", event: "Startet bald" },
  server: { maintenance: "Wartung" },
};

export function autoBannerKindLabel(kind) {
  return KIND_LABELS[kind] || "Automatisch";
}

export function autoBannerTemplateLabel(kind, template) {
  return TEMPLATE_LABELS[kind]?.[template] || template || "";
}

// Ein Zeitpunkt aus dem Server: ISO-Zeit wird lesbar, freier Text (z. B. „bis morgen Abend“ an der Wartung) bleibt.
function when(value, now) {
  return formatWhen(value, { now, fallback: String(value || "") });
}

export function autoBannerPeriod(item, { now = new Date() } = {}) {
  const start = item?.period_start ? when(item.period_start, now) : "";
  const end = item?.period_end ? when(item.period_end, now) : "";
  if (start && end) return `${start} – ${end}`;
  if (end) return `bis ${end}`;
  if (start) return `ab ${start}`;
  return item?.kind === "server" ? "bis die Wartung endet" : "solange der Status passt";
}

export function autoBannerNumbers(stats, { now = new Date() } = {}) {
  const parts = [`Views ${stats?.impressions || 0}`, `Klicks ${stats?.clicks || 0}`];
  if (stats?.last_impression_at) parts.push(`zuletzt angezeigt ${formatAgo(stats.last_impression_at, { now })}`);
  return parts.join(" · ");
}
