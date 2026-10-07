// Wohin es nach Login und Registrieren geht (#1225). Eine Prüfregel für Login, Registrieren, Google-Anmeldung und den
// Link in der Bestätigungs-Mail - dieselbe Regel prüft der Server (backend/services/return_path.py): erlaubt ist nur
// ein Pfad auf dieser Website, der mit genau einem „/“ beginnt. Kein „//“, keine Adresse mit „https:“ oder
// „javascript:“, kein Backslash, keine Steuerzeichen - alles andere führt zum Dashboard.

export const DEFAULT_RETURN_PATH = "/dashboard";
const MAX_LENGTH = 512;
// Backslash und Steuerzeichen: Browser lesen „/\fremd.at“ wie „//fremd.at“.
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\\\u0000-\u001f\u007f]/;

/** Das Ziel, wenn es ein Pfad auf dieser Website ist - sonst `fallback` (Standard: das Dashboard). */
export function safeNextPath(value, fallback = DEFAULT_RETURN_PATH) {
  if (typeof value !== "string" || !value || value.length > MAX_LENGTH) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || FORBIDDEN.test(value)) return fallback;
  return value;
}

/** „?next=…“ für die Links zwischen Login, Registrieren und Mail-Bestätigung - ohne eigenes Ziel leer. */
export function nextQuery(next) {
  const safe = safeNextPath(next, "");
  return safe && safe !== DEFAULT_RETURN_PATH ? `?next=${encodeURIComponent(safe)}` : "";
}

/** Wofür man sich anmeldet: ein Turnier, ein Event oder der Mitgliedsantrag - sonst nichts. */
export function nextTarget(next) {
  const safe = safeNextPath(next, "");
  if (!safe) return null;
  const url = new URL(safe, "https://lionsquad.invalid");
  const [section, slug, extra] = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  const access = url.searchParams.get("access") || "";
  if (section === "tournaments" && slug && !extra) return { kind: "tournament", slug, access };
  if (section === "events" && slug && !extra) return { kind: "event", slug, access };
  if (section === "membership" && ["apply", "join"].includes(slug)) return { kind: "membership" };
  return null;
}

/**
 * Der Satz oben auf Login und Registrieren: „Melde dich an, um dich für „Mario Kart Cup“ anzumelden.“ - ohne Ziel
 * kein Satz. Ist der Titel nicht bekannt (nicht sichtbar, Fehler), steht „das Turnier“ bzw. „das Event“ da.
 */
export function purposeSentence(target, title = "", mode = "login") {
  if (!target) return "";
  const start = mode === "register" ? "Erstelle ein Konto" : "Melde dich an";
  if (target.kind === "membership") return `${start}, um deinen Mitgliedsantrag zu stellen.`;
  const what = title ? `„${title}“` : target.kind === "event" ? "das Event" : "das Turnier";
  return `${start}, um dich für ${what} anzumelden.`;
}
