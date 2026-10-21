import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight } from "lucide-react";
import {
  adjustmentDetail, adjustmentSum, adjustmentText, adjustmentTitle, cancelledText, noScoreText, ruleChangeLines, successorLink, teamDeviationText, teamModeLabel,
  teamSourceLabel,
} from "@/lib/seriesSpecialRules";

// Sonderregeln einer Saison (#1960) auf der Serienseite: Hinweis „Saison abgebrochen“ mit Nachfolger, Regeländerungen
// ab Runde X, die Marke „−5“ an den Punkten (Anpassung mit Grund), die Liste der Anpassungen im Fahrer-Detail, Quelle
// und Modus der Teamwertung samt Prüfhinweis und „Ohne Wertung“ am Termin. Gerechnet wird nichts - alles vom Server.

/** Kleine Marke an den Punkten: „−5“ (Summe der Anpassungen), Grund im Tooltip und für Screenreader. */
export function AdjustmentMark({ row, rounds = [] }) {
  const sum = adjustmentSum(row);
  if (!sum || !(row?.adjustments || []).length) return null;
  const title = adjustmentTitle(row, rounds);
  return (
    <span className={`ml-1.5 text-[11px] font-bold tabular-nums cursor-help underline decoration-dotted underline-offset-[3px] ${sum < 0 ? "text-red-300 decoration-red-300/50" : "text-emerald-300 decoration-emerald-300/50"}`}
      title={title} data-testid="series-adjustment">
      <span aria-hidden="true">{adjustmentText(sum)}</span>
      <span className="sr-only">{` (${title})`}</span>
    </span>
  );
}

/** Die Anpassungen einer Zeile als Liste („−5 · Grund · R4 · Tag“) - im Fahrer-Detail. */
export function AdjustmentList({ row, rounds = [], className = "" }) {
  const items = row?.adjustments || [];
  if (!items.length) return null;
  return (
    <ul className={`space-y-0.5 text-sm text-white/70 ${className}`} aria-label="Anpassungen" data-testid="series-adjustments">
      {items.map((item, index) => (
        <li key={`${item.day}-${index}`} className="flex gap-2 min-w-0">
          <span className={`shrink-0 font-bold tabular-nums ${Number(item.points) < 0 ? "text-red-300" : "text-emerald-300"}`}>{adjustmentText(item.points)}</span>
          <span className="min-w-0 [overflow-wrap:anywhere]">{adjustmentDetail(item, rounds)}</span>
        </li>
      ))}
    </ul>
  );
}

/** „Saison abgebrochen am … – Grund“ mit Link zum Nachfolger; gefahrene Ergebnisse bleiben darunter sichtbar. */
export function SeasonNotice({ series, successor }) {
  const text = cancelledText(series);
  const next = successorLink(successor);
  if (!text && !next) return null;
  return (
    <div className="mt-6 border border-amber-400/30 bg-amber-400/[0.06] rounded-md px-4 py-3 text-sm text-white/80 flex flex-wrap items-center gap-x-4 gap-y-2" role="note" data-testid="series-season-notice">
      {text && (
        <span className="flex items-start gap-2 min-w-0" data-testid="series-cancelled">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
          <span className="[overflow-wrap:anywhere]">{text}. Die gefahrenen Ergebnisse bleiben stehen – ohne Meister.</span>
        </span>
      )}
      {next && (
        <Link to={next.href} className="inline-flex items-center gap-1.5 font-semibold text-[#29B6E8] hover:text-white underline-offset-4 hover:underline" data-testid="series-successor">
          Nachfolger: {next.label} <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

/** Regeländerungen der Saison: ab Runde X (Ablauf je Runde) und Regel-Versionen mit Hinweis. */
export function RuleChanges({ changes }) {
  const lines = ruleChangeLines(changes);
  if (!lines.length) return null;
  return (
    <section className="mt-5 border-l-2 border-[#29B6E8]/50 pl-3" aria-label="Regeländerungen" data-testid="series-rule-changes">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/45">Regeländerungen</h3>
      <ul className="mt-1.5 space-y-1 text-sm">
        {lines.map((line) => (
          <li key={line.key} className="flex flex-col sm:flex-row sm:gap-3 min-w-0" data-testid="series-rule-change">
            <span className="shrink-0 sm:w-44 font-semibold text-white tabular-nums">{line.head}</span>
            <span className="text-white/70 [overflow-wrap:anywhere]">{line.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Quelle und Modus der Teamwertung; weicht die Teamwertung laut Veranstalter von der eigenen Rechnung ab, je Team ein
 * Prüfhinweis. */
export function TeamSource({ teams, scoring, rounds = [] }) {
  if (!teams) return null;
  const deviations = (teams.rows || []).map(teamDeviationText).filter(Boolean);
  return (
    <div className="mt-2 text-sm" data-testid="racing-team-source">
      <p className="text-white/70">
        <span className="text-white/45">Quelle </span>{teamSourceLabel(teams, rounds)}
        <span className="text-white/45"> · Modus </span>{teamModeLabel(scoring)}
      </p>
      {deviations.length > 0 && (
        <details className="mt-1 text-white/55" data-testid="racing-team-deviations">
          <summary className="cursor-pointer text-[12px] hover:text-white">{`Eigene Rechnung weicht bei ${deviations.length === 1 ? "einem Team" : `${deviations.length} Teams`} ab`}</summary>
          <ul className="mt-1 space-y-0.5 text-[12px] tabular-nums">
            {deviations.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

/** „Ohne Wertung · Zu wenig Fahrer – …“ am Termin (unterschieden von „abgesagt“); `label` nennt bei mehreren Läufen
 * den Lauf („Sprint: Ohne Wertung …“). */
export function NoScoreNote({ round, label = "", className = "" }) {
  const text = noScoreText(round);
  if (!text) return null;
  return <span className={`block text-[11px] text-amber-200/80 [overflow-wrap:anywhere] ${className}`} data-testid="series-no-score">{label ? `${label}: ${text}` : text}</span>;
}
