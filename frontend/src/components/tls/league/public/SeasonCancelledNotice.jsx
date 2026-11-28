// „Abgesagt“ einer Season (#2607, Entscheidung Nr. 302): Schild, Datum und Grund - auf der Ligaseite (alle Unterseiten) und oben auf der
// Season-Seite der Verwaltung. Die Season bleibt sichtbar, statt still zu verschwinden. Bis die Zustands-Schilder (#2609) kommen, trägt
// das vorhandene `PhaseBadge` die Art „Abgesagt“ (grau, Rolle `quiet`).
import { PhaseBadge } from "@/components/tls/PhaseBadge";
import { viennaDate } from "@/lib/vienna";

const DAY = { day: "2-digit", month: "2-digit", year: "numeric" };

export function SeasonCancelledNotice({ season, children, className = "", testId = "season-cancelled" }) {
  if (season?.status !== "cancelled") return null;
  return (
    <div role="status" className={`rounded-sm border border-quiet/30 bg-white/5 px-4 py-3 ${className}`} data-testid={testId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <PhaseBadge status="cancelled" size="md" />
        {season.cancelled_at ? (
          <span className="tls-type-small tabular-nums text-white/70" data-testid={`${testId}-date`}>am {viennaDate(season.cancelled_at, DAY)}</span>
        ) : null}
      </div>
      <p className="mt-2 tls-type-body text-white/85 break-words" data-testid={`${testId}-reason`}>
        <span className="font-semibold text-white">Grund:</span> {season.cancel_reason || "ohne Angabe"}
      </p>
      {children}
    </div>
  );
}
