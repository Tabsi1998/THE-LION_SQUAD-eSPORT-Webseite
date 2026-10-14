import { RotateCcw } from "lucide-react";
import { deniedText } from "@/lib/loadProblem";
import { PublicLoadingState } from "./PublicLoadingState";
import { PublicErrorState } from "./PublicEmptyState";

// Die Anzeige zum Lade-Baustein hooks/useLoad.js (#983, #984): je Zustand genau eine Ansicht - Laden, Fehler mit
// „Nochmal versuchen“, leer (nur nach Erfolg) oder der Inhalt. Ein alter Stand bleibt stehen, darüber ein Hinweis.

/** Ein schmaler Hinweis: etwas kam nicht, der Rest steht. Für einen alten Stand oder einen Teilausfall. */
export function LoadNotice({ message, onRetry, testId = "load-notice", className = "" }) {
  return (
    <div
      role="status"
      data-testid={testId}
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-sm border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-white/80 ${className}`}
    >
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="tls-hit inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-warn hover:underline">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Nochmal versuchen
        </button>
      )}
    </div>
  );
}

/** Der Hinweis zu einem alten Stand (`load.stale`). */
export function LoadStaleNotice({ load, className = "" }) {
  if (!load?.stale) return null;
  const message = load.problem === "offline"
    ? "Ohne Netz. Du siehst den letzten Stand."
    : "Neu laden hat nicht geklappt. Du siehst den letzten Stand.";
  return <LoadNotice message={message} onRetry={load.reload} testId="load-stale" className={className} />;
}

/**
 * @param load        Ergebnis von useLoad
 * @param loading     Platzhalter beim ersten Laden (Skelett in der Form der Seite)
 * @param empty       Ansicht für eine erfolgreiche, leere Antwort
 * @param errorTitle  was nicht geladen werden konnte („Deine Strafen konnten nicht laden“)
 * @param notFound    eigene Ansicht für 404 (sonst gilt der Fehler)
 * @param children    Inhalt - eine Funktion bekommt die Daten
 */
export function LoadState({ load, loading = null, empty = null, errorTitle, errorDescription, notFound = null, children, className = "" }) {
  if (!load || load.status === "idle") return null;
  if (load.status === "loading") return loading ?? <PublicLoadingState variant="inline" />;
  if (load.status === "error") {
    if (load.problem === "notFound" && notFound) return notFound;
    const offline = load.problem === "offline";
    return (
      <PublicErrorState
        kind={load.problem || "error"}
        title={offline ? undefined : errorTitle}
        description={offline ? undefined : deniedText(load.error) || errorDescription}
        onRetry={load.reload}
        className={className}
      />
    );
  }
  const body = load.status === "empty" ? empty : (typeof children === "function" ? children(load.data) : children);
  return (
    <>
      <LoadStaleNotice load={load} className="mb-4" />
      {body}
    </>
  );
}
