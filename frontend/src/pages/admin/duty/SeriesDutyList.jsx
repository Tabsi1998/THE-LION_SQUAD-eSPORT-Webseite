// „Meine Serien“ (#1749): die Serien, in denen die Person heute Captain ist - aufgebaut wie die Einsätze in „Mein
// Dienst“ (DutyList): am Handy Karten, ab Tablet Zeilen, je mit einem Knopf zur Saison. Ohne Zwei-Faktor steht ein
// Hinweis davor - die Saison geht erst mit bestätigter Zwei-Faktor-Anmeldung auf.
import { Link } from "react-router-dom";
import { ArrowRight, ListOrdered } from "lucide-react";
import { KIND_OPTIONS, STATUS_LABELS } from "@/lib/referenceSeries";
import { dayLabel, publishText } from "@/lib/referenceSeriesStaff";

const KIND_LABELS = Object.fromEntries(KIND_OPTIONS);

function seasonText(row) {
  return [row.season, row.tier].filter(Boolean).join(" · ");
}

export function SeriesDutyList({ rows, testId = "duty-series" }) {
  return (
    <ul className="space-y-2" data-testid={testId}>
      {rows.map((row) => (
        <li key={row.id} data-testid={`duty-series-row-${row.id}`} className="rounded-sm border border-white/10 bg-[#121212] p-4 md:flex md:items-center md:gap-4">
          <div className="text-xs font-bold uppercase tracking-wider tabular-nums text-white/55 md:w-40 md:shrink-0" data-testid={`duty-series-until-${row.id}`}>
            {dayLabel(row.valid_until) ? `bis ${dayLabel(row.valid_until)}` : ""}
          </div>
          <div className="mt-1 min-w-0 flex-1 md:mt-0">
            <div className="flex items-center gap-2 min-w-0">
              <ListOrdered className="w-4 h-4 shrink-0 text-white/45" aria-hidden="true" />
              <span className="font-heading font-bold text-white truncate">{row.title || row.lineage_title}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-widest text-white/40">{KIND_LABELS[row.lineage_kind] || "Serie"}</span>
            </div>
            <div className="mt-1 text-sm text-white/60">
              {seasonText(row)}{row.status ? ` · ${STATUS_LABELS[row.status] || row.status}` : ""} · Captain, {publishText(row.can_publish)}
            </div>
          </div>
          <div className="mt-3 md:mt-0 md:shrink-0">
            <Link to={row.url} data-testid={`duty-series-open-${row.id}`} className="tls-btn tls-btn--primary inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider md:w-auto">
              Saison öffnen <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
