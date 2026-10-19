import { Link } from "react-router-dom";
import { Printer } from "lucide-react";

// Knopf „Drucken“ (#1283): öffnet die Druckansicht mit dem passenden Teil vorgewählt. Gedruckt wird erst dort auf
// Knopfdruck - so lässt sich vorher noch Teil und Hoch/Quer wählen, auch am Handy (Druck über das Teilen-Menü).

export function printPath(scope, slug, parts, { from = "", accessToken = "" } = {}) {
  const query = new URLSearchParams();
  if (parts) query.set("teile", parts);
  if (from) query.set("von", from);
  if (accessToken) query.set("access", accessToken);
  return `/print/${scope === "event" ? "events" : "tournaments"}/${encodeURIComponent(slug)}?${query.toString()}`;
}

export function PrintLink({ scope = "tournament", slug, parts, from = "", accessToken = "", className = "", testId = "print-link" }) {
  if (!slug) return null;
  return (
    <Link
      to={printPath(scope, slug, parts, { from, accessToken })}
      data-testid={testId}
      className={`tls-btn tls-btn--quiet inline-flex min-h-11 items-center gap-2 px-4 py-2.5 font-bold uppercase tracking-wider rounded-sm text-sm ${className}`}
    >
      <Printer className="w-4 h-4" aria-hidden="true" /> Drucken
    </Link>
  );
}

export default PrintLink;
