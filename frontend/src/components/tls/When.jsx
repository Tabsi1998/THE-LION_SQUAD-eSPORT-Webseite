import { formatAgo, formatWhen } from "@/lib/datetime";
import { asInstant } from "@/lib/vienna";

const PURE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Ein Zeitpunkt als <time> (#1307): sichtbar „Sa 23. Mai · 18:00“ (mit `ago` „vor 12 Min.“), dazu der ISO-Wert in
 * `dateTime` für Browser, Suchmaschinen und Vorlesehilfen. Der Mittelpunkt ist nur Gestaltung: Er steht `aria-hidden`
 * da, die Vorlesehilfe liest „Sa 23. Mai 18:00“ ohne „Mittelpunkt“ dazwischen. Der Text (textContent) bleibt die eine
 * Form - Tests und Kopieren sehen genau, was dasteht. Ohne gültigen Wert kommt `fallback` als reiner Text.
 */
export function When({ value, ago = false, time = true, relative = true, fallback = "", now, ...rest }) {
  const text = ago ? formatAgo(value, { now, fallback }) : formatWhen(value, { now, time, relative, fallback });
  const date = value == null || value === "" ? null : asInstant(value);
  if (!date || Number.isNaN(date.getTime())) return text || null;
  const raw = typeof value === "string" ? value.trim() : "";
  const [day, clock] = text.split(" · ");
  return (
    <time dateTime={PURE_DAY.test(raw) ? raw : date.toISOString()} {...rest}>
      {clock ? <>{day} <span aria-hidden="true">·</span> {clock}</> : text}
    </time>
  );
}
