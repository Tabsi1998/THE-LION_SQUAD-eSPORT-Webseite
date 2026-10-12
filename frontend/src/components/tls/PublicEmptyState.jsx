import { Link } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { LionArt } from "./LionArt";

// Leer, Fehler und offline mit dem Löwen (#1325): Bild 96 px am Handy, 120 px am Tablet, 140 px am PC (dort links,
// Text und Knopf rechts). Ein Satz für Gäste, genau ein Knopf, der weiterhilft; ein zweiter Weg steht leise als Link.
export const LION_ART_SIZE = "h-24 w-24 md:h-[120px] md:w-[120px] lg:h-[140px] lg:w-[140px]";

function ActionLink({ action, primary = false }) {
  if (!action) return null;
  const cls = primary
    ? "tls-btn tls-btn--primary inline-flex min-h-11 items-center justify-center px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider"
    : "tls-hit inline-flex items-center text-sm font-semibold text-[#29B6E8] hover:text-white underline-offset-4 hover:underline";
  if (action.onClick) {
    return <button type="button" onClick={action.onClick} className={cls}>{action.label}</button>;
  }
  if (action.href) {
    return <a href={action.href} target="_blank" rel="noreferrer" className={cls}>{action.label}</a>;
  }
  return <Link to={action.to || "/"} className={cls}>{action.label}</Link>;
}

function Frame({ art, children, className = "", ...rest }) {
  return (
    <div
      className={`flex flex-col items-center gap-5 rounded-sm border border-white/10 bg-[#121212]/70 px-6 py-10 text-center lg:flex-row lg:items-center lg:gap-8 lg:px-10 lg:text-left ${className}`}
      {...rest}
    >
      <LionArt art={art} className={`shrink-0 text-white/90 ${LION_ART_SIZE}`} />
      <div className="min-w-0 max-w-xl">{children}</div>
    </div>
  );
}

/**
 * Nichts da (noch keine Turniere, keine Treffer …). `art`: sleep (Standard - noch nichts da), search (nichts
 * gefunden), offline. `icon` und `eyebrow` von früher werden nicht mehr gezeigt - der Löwe ersetzt das Symbol.
 */
export function PublicEmptyState({
  art = "sleep",
  title,
  description,
  primaryAction,
  secondaryAction,
  className = "",
}) {
  return (
    <Frame art={art} className={className} data-testid="public-empty-state" data-art={art}>
      <h2 className="text-xl font-bold text-white md:text-2xl">{title}</h2>
      {description && <p className="mt-2 text-base leading-relaxed text-white/65">{description}</p>}
      {(primaryAction || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 lg:justify-start">
          <ActionLink action={primaryAction} primary />
          <ActionLink action={secondaryAction} />
        </div>
      )}
    </Frame>
  );
}

/** Welcher Löwe zu welchem Ladefehler (lib/loadProblem.js) passt. */
export function artForProblem(kind) {
  if (kind === "notFound") return "search";
  if (kind === "denied") return "sleep";
  return "offline";
}

/**
 * Ein Ladefehler (#1152) - sieht anders aus als „nichts da“ und hat „Nochmal versuchen“. `kind` aus
 * lib/loadProblem.js: ohne Netz („offline“), nicht gefunden, nicht freigegeben oder ein anderer Fehler.
 */
export function PublicErrorState({ kind = "error", title, description, onRetry, className = "" }) {
  const offline = kind === "offline";
  return (
    <Frame art={artForProblem(kind)} className={className} role="alert" data-testid="public-error-state" data-kind={kind}>
      <h2 className="text-xl font-bold text-white md:text-2xl">{title || (offline ? "Ohne Netz" : "Laden hat nicht geklappt")}</h2>
      <p className="mt-2 text-base leading-relaxed text-white/65">
        {description || (offline ? "Sobald dein Gerät wieder Netz hat, lädt die Seite weiter. Nichts ist verloren." : "Da ist uns ein Kabel rausgerutscht - das liegt an der Verbindung oder am Server, nicht an dir.")}
      </p>
      {onRetry && (
        <button type="button" onClick={onRetry} data-testid="public-error-retry" className="tls-btn tls-btn--primary mt-5 inline-flex min-h-11 items-center gap-2 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Nochmal versuchen
        </button>
      )}
    </Frame>
  );
}
