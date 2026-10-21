import { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { STATE_LABELS, STATE_TONES, roundLabel, roundWhen } from "@/lib/referenceCalendar";
import { ResultEntrySheet } from "./ResultEntrySheet";
import { VenueWithFlag } from "@/components/tls/CountryFlag";
import { UnknownNamesSheet } from "./UnknownNamesSheet";
import { ListOrdered, PenLine } from "lucide-react";

// Ergebnisse eintragen (#1744, Paket P5b): je Termin der Saison „Ergebnis eintragen“ – das Blatt mit der dynamischen
// Liste, dem Einfügen aus der Zwischenablage und der Vorschau des Servers liegt in `ResultEntrySheet`. Abgesagte Termine
// fehlen hier, sie bekommen kein Ergebnis. Vorstand und Captains der Saison sehen den Abschnitt; was beim Übernehmen
// passiert (Entwurf, veröffentlichen, Entwurf daneben), sagt der Server je Termin.

export function SeriesResultsSection({ series, onChanged }) {
  const [calendar, setCalendar] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null);
  const [unknownOpen, setUnknownOpen] = useState(false);
  const board = (series.access?.role || "board") === "board";

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/reference-series/admin/series/${series.id}/calendar`);
      setCalendar(data);
      setError("");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || "Termine nicht geladen.");
    }
  }, [series.id]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["reference-series"]);

  const close = useCallback(() => setOpen(null), []);
  const saved = useCallback(({ openUnknown } = {}) => {
    setOpen(null);
    if (openUnknown) setUnknownOpen(true);
    load();
    onChanged?.();
  }, [load, onChanged]);

  const rounds = (calendar?.rounds || []).filter((round) => round.status !== "cancelled");
  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid="series-results" aria-labelledby="series-results-title">
      <h2 id="series-results-title" className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Ergebnisse</h2>
      {error && <p className="mt-3 text-sm text-red-300" role="alert">{error}</p>}
      {calendar && rounds.length === 0 && (
        <p className="mt-3 text-sm text-white/55" data-testid="results-empty">Noch keine Termine – Ergebnisse gibt es je Termin im Kalender.</p>
      )}
      {rounds.length > 0 && (
        <ol className="mt-3 divide-y divide-white/5" data-testid="results-rounds">
          {rounds.map((round) => {
            const scored = round.state === "scored";
            return (
              <li key={round.id} className="py-2.5 flex items-center gap-3 flex-wrap sm:flex-nowrap" data-testid="results-round" data-state={round.state}>
                <div className="w-12 shrink-0 text-sm font-black tabular-nums text-white/80">{roundLabel(round)}</div>
                <div className="min-w-0 flex-1 text-sm">
                  <span className="tabular-nums text-white">{roundWhen(round)}</span>
                  {(round.title || round.venue || round.country_code) && <span className="text-white/60"> · <VenueWithFlag round={round} /></span>}
                  {round.opponent && <span className="text-white/60"> · gegen {round.opponent}</span>}
                </div>
                <span className={`inline-flex items-center px-2 py-0.5 border rounded-sm text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${STATE_TONES[round.state] || STATE_TONES.planned}`}>
                  {STATE_LABELS[round.state] || round.state}
                </span>
                <button type="button" onClick={() => setOpen(round)} data-testid="results-open"
                  className={`tls-btn ${scored ? "tls-btn--quiet" : "tls-btn--secondary"} px-3 py-2 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 ml-auto sm:ml-0`}>
                  {scored ? <PenLine className="w-3.5 h-3.5" /> : <ListOrdered className="w-3.5 h-3.5" />}
                  {scored ? "Ergebnis ändern" : "Ergebnis eintragen"}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {open && <ResultEntrySheet series={series} round={open} onClose={close} onSaved={saved} />}
      {board && unknownOpen && <UnknownNamesSheet series={series} onClose={() => setUnknownOpen(false)} onChanged={onChanged} />}
    </section>
  );
}
