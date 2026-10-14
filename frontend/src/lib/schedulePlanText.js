import { viennaDateTime } from "@/lib/vienna";

// Spielplaner (#1552): der Text im Dialog „Spielplan übernehmen?“. Reine Funktionen, damit Einzahl, Wiener Zeit
// und die Kürzung langer Listen geprüft sind, bevor der Dialog sie zeigt.

const MAX_LINES = 8;
const MAX_WARNINGS = 6;
const MAX_LABEL = 32;

export function countOf(count, singular, plural) {
  const number = Number(count) || 0;
  return `${number} ${number === 1 ? singular : plural}`;
}

function shortLabel(value) {
  const text = String(value || "Spiel");
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
}

function when(value) {
  return viennaDateTime(value, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) || "ohne Zeit";
}

function describeAssignment(item) {
  const station = item.station_name ? `Station ${item.station_name}` : "ohne Station";
  return `${shortLabel(item.label || item.match_key)}: ${when(item.scheduled_at)} · ${station}${item.forecast ? " (voraussichtlich)" : ""}`;
}

export function describeSchedulePlan(plan, changed, warnings) {
  const withStations = plan?.mode === "stations" || plan?.mode === "mixed";
  const errors = (warnings || []).filter((item) => item.severity === "error");
  const hints = (warnings || []).filter((item) => item.severity !== "error");
  const verb = changed.length === 1 ? "bekommt" : "bekommen";
  const head = `${countOf(changed.length, "Spiel", "Spiele")} ${verb} Zeit${withStations ? " und Station" : ""}, `
    + `${countOf(errors.length, "Konflikt", "Konflikte")}, ${countOf(hints.length, "Hinweis", "Hinweise")}.`;
  const lines = changed.slice(0, MAX_LINES).map(describeAssignment);
  if (changed.length > MAX_LINES) lines.push(`… und ${countOf(changed.length - MAX_LINES, "weiteres Spiel", "weitere Spiele")}`);
  const notes = [...errors, ...hints].slice(0, MAX_WARNINGS)
    .map((item) => `${item.severity === "error" ? "Konflikt" : "Hinweis"}: ${item.message}`);
  if (errors.length + hints.length > MAX_WARNINGS) notes.push(`… und ${countOf(errors.length + hints.length - MAX_WARNINGS, "weitere Meldung", "weitere Meldungen")}`);
  return [head, "", ...lines, ...(notes.length ? ["", ...notes] : [])].join("\n");
}
