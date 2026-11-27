import { isShortCaps } from "@/lib/typography";

// Seitentitel bis 18 Zeichen GROSS (#1303, lib/typography.js): „Turniere“ wirkt groß, ein langer Titel bleibt lesbar.
// GROSS macht der Browser (text-transform) - der Text selbst bleibt, wie er eingetippt wurde, für Vorlesen, Suche und
// Kopieren. Nur für Seitentitel aus festem Text oder dem Namen der Seite, nie für Namen von Personen, Teams oder Spielen.
export function ShortCaps({ children }) {
  const text = typeof children === "string" || typeof children === "number" ? String(children) : null;
  if (text === null || !isShortCaps(text)) return children ?? null;
  return <span className="uppercase">{children}</span>;
}
