// „Abgesagt“ einer Season (#2607, Entscheidung Nr. 302): Schild, Datum und Grund - auf der Ligaseite (alle Unterseiten) und oben auf der
// Season-Seite der Verwaltung. Die Season bleibt sichtbar, statt still zu verschwinden. Das Schild ist das Zustands-Schild (#1306, #2609)
// der Art „Abgesagt“; der Tag steht daneben (`meta`), nie im Schild.
import { StatusChip } from "@/components/tls/StatusChip";
import { viennaDate } from "@/lib/vienna";

const DAY = { day: "2-digit", month: "2-digit", year: "numeric" };

export function SeasonCancelledNotice({ season, children, className = "", testId = "season-cancelled" }) {
  if (season?.status !== "cancelled") return null;
  return (
    <div role="status" className={`rounded-sm border border-quiet/30 bg-white/5 px-4 py-3 ${className}`} data-testid={testId}>
      <StatusChip status="cancelled" testId={`${testId}-chip`} metaTestId={`${testId}-date`}
        meta={season.cancelled_at ? `am ${viennaDate(season.cancelled_at, DAY)}` : null} />
      <p className="mt-2 tls-type-body text-white/85 break-words" data-testid={`${testId}-reason`}>
        <span className="font-semibold text-white">Grund:</span> {season.cancel_reason || "ohne Angabe"}
      </p>
      {children}
    </div>
  );
}
