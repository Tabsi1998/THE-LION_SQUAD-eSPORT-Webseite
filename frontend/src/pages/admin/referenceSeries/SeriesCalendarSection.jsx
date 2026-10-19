import { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { STATE_LABELS, STATE_TONES, dayLabel, moveIds, roundLabel, roundWhen, suggestNextDay } from "@/lib/referenceCalendar";
import { PasteSheet, PostponeSheet, RoundSheet } from "./RoundSheets";
import { toast } from "sonner";
import { AlertTriangle, Archive, ArchiveRestore, ArrowDown, ArrowDownUp, ArrowUp, Ban, CalendarClock, ClipboardList, Pencil, Plus, RotateCcw } from "lucide-react";

// Kalender der Saison (#1742): Termine einzeln oder als eingefügte Liste, Standard-Wochentag und -Uhrzeit der Saison als
// Vorgabe, Bearbeiten, Verschieben (der ursprüngliche Termin bleibt stehen), Absagen (zählt nie als „Ergebnis fehlt“),
// Reihenfolge und Archivieren statt Löschen. Den Status je Termin und „heute“ rechnet der Server im Wiener Tag; ein
// Termin ohne Ergebnis, nach dem schon gewertet wurde, steht als Hinweis oben.

const ORDERED_STATES = ["today", "missing", "planned", "postponed", "scored", "cancelled"];
const ICON_BUTTON = "p-1.5 rounded-sm text-white/50 hover:text-white hover:bg-white/5 disabled:opacity-25 disabled:hover:bg-transparent transition";

function StateBadge({ state }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 border rounded-sm text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${STATE_TONES[state] || STATE_TONES.planned}`} data-testid="round-state">
      {STATE_LABELS[state] || state}
    </span>
  );
}

export function SeriesCalendarSection({ series }) {
  const [calendar, setCalendar] = useState(null);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const lineage = series.lineage || {};
  const base = `/reference-series/admin/series/${series.id}/rounds`;

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/reference-series/admin/series/${series.id}/calendar`);
      setCalendar(data);
      setError("");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || "Kalender nicht geladen.");
    }
  }, [series.id]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["reference-series"]);

  const run = async (request, message) => {
    setBusy(true);
    try {
      const { data } = await request();
      if (data?.rounds && data?.counts) setCalendar((current) => ({ ...current, ...data }));
      else await load();
      if (message) toast.success(message);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const saved = () => { setSheet(null); load(); };
  const rounds = calendar?.rounds || [];
  const archived = calendar?.archived || [];
  const hints = calendar?.hints || [];
  const counts = calendar?.counts || {};
  const hintIds = new Set(hints.map((hint) => hint.round_id));

  const cancel = async (round) => {
    if (!await confirm({ title: `${roundLabel(round)} absagen?`, description: "Ein abgesagter Termin zählt nicht als „Ergebnis fehlt“ und nicht zur Rundenzahl. „Wieder ansetzen“ nimmt es zurück.", confirmLabel: "Absagen" })) return;
    run(() => api.post(`${base}/${round.id}/cancel`, {}), "Termin abgesagt.");
  };
  const archive = async (round) => {
    if (!await confirm({ title: `${roundLabel(round)} archivieren?`, description: "Der Termin verschwindet aus dem Kalender. Gelöscht wird nichts – unter „Archiviert“ lässt er sich zurückholen.", confirmLabel: "Archivieren" })) return;
    run(() => api.post(`${base}/${round.id}/archive`), "Termin archiviert.");
  };
  const move = (index, step) => {
    const ids = moveIds(rounds, index, step);
    if (ids) run(() => api.post(`${base}/order`, { ids }));
  };
  const openNew = () => setSheet({
    type: "round",
    suggestion: { day: suggestNextDay(rounds, series.default_weekday, calendar?.today), time: series.default_time || "" },
  });

  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid="series-calendar" aria-labelledby="series-calendar-title">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 id="series-calendar-title" className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Kalender</h2>
          {rounds.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/55" data-testid="series-calendar-counts">
              <span>{rounds.length} Termine</span>
              {ORDERED_STATES.filter((state) => counts[state]).map((state) => (
                <span key={state} className={state === "missing" ? "text-amber-300" : undefined}>{counts[state]} {STATE_LABELS[state].toLowerCase()}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {rounds.length > 1 && (
            <button type="button" onClick={() => run(() => api.post(`${base}/sort-by-date`), "Nach Datum geordnet.")} disabled={busy} data-testid="calendar-sort" className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
              <ArrowDownUp className="w-3.5 h-3.5" /> Nach Datum ordnen
            </button>
          )}
          <button type="button" onClick={() => setSheet({ type: "paste" })} data-testid="calendar-paste" className="tls-btn tls-btn--secondary px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
            <ClipboardList className="w-3.5 h-3.5" /> Liste einfügen
          </button>
          <button type="button" onClick={openNew} disabled={!calendar} data-testid="calendar-new" className="tls-btn tls-btn--secondary px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
            <Plus className="w-3.5 h-3.5" /> Termin
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-300" role="alert">{error}</p>}

      {hints.length > 0 && (
        <div className="mt-3 border border-amber-400/40 bg-amber-400/10 rounded-sm p-3 text-sm text-amber-100" data-testid="calendar-hints" role="status">
          <div className="flex items-center gap-2 font-bold"><AlertTriangle className="w-4 h-4 text-amber-300" /> Lücke im Kalender</div>
          <ul className="mt-1 space-y-0.5">{hints.map((hint) => <li key={hint.round_id}>{hint.text}</li>)}</ul>
        </div>
      )}

      {calendar && rounds.length === 0 && (
        <p className="mt-3 text-sm text-white/55" data-testid="calendar-empty">
          Noch keine Termine. Einzeln mit „Termin“ oder alle auf einmal mit „Liste einfügen“.
        </p>
      )}

      {rounds.length > 0 && (
        <ol className="mt-3 divide-y divide-white/5" data-testid="calendar-rounds">
          {rounds.map((round, index) => (
            <li key={round.id} data-testid="calendar-round" data-state={round.state} className={`py-2.5 flex items-start gap-3 ${hintIds.has(round.id) ? "bg-amber-400/[0.04]" : ""}`}>
              <div className="w-12 shrink-0 pt-0.5 text-sm font-black tabular-nums text-white/80">{roundLabel(round)}</div>
              <div className="min-w-0 flex-1">
                <div className={`text-sm ${round.state === "cancelled" ? "text-white/45" : "text-white"}`}>
                  <span className="tabular-nums">{roundWhen(round)}</span>
                  {(round.venue || round.title) && <span className="text-white/60"> · {[round.title, round.venue].filter(Boolean).join(" · ")}</span>}
                  {round.opponent && <span className="text-white/60"> · gegen {round.opponent}</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/45">
                  {round.kind === "final" && <span className="uppercase tracking-widest font-bold text-[#29B6E8]">Finale</span>}
                  {round.counts === false && <span>zählt nicht zur Wertung</span>}
                  {round.original_club_day && <span data-testid="round-original">ursprünglich {dayLabel(round.original_club_day)}</span>}
                  {round.status_note && <span>– {round.status_note}</span>}
                </div>
              </div>
              <StateBadge state={round.state} />
              <div className="flex items-center shrink-0">
                <button type="button" className={ICON_BUTTON} disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={`${roundLabel(round)} nach oben`} title="Nach oben"><ArrowUp className="w-3.5 h-3.5" /></button>
                <button type="button" className={ICON_BUTTON} disabled={busy || index === rounds.length - 1} onClick={() => move(index, 1)} aria-label={`${roundLabel(round)} nach unten`} title="Nach unten"><ArrowDown className="w-3.5 h-3.5" /></button>
                <button type="button" className={ICON_BUTTON} onClick={() => setSheet({ type: "round", round })} aria-label={`${roundLabel(round)} bearbeiten`} title="Bearbeiten" data-testid="round-edit"><Pencil className="w-3.5 h-3.5" /></button>
                {round.state !== "scored" && round.status !== "cancelled" && (
                  <>
                    <button type="button" className={ICON_BUTTON} onClick={() => setSheet({ type: "postpone", round })} aria-label={`${roundLabel(round)} verschieben`} title="Verschieben" data-testid="round-postpone"><CalendarClock className="w-3.5 h-3.5" /></button>
                    <button type="button" className={ICON_BUTTON} disabled={busy} onClick={() => cancel(round)} aria-label={`${roundLabel(round)} absagen`} title="Absagen" data-testid="round-cancel"><Ban className="w-3.5 h-3.5" /></button>
                  </>
                )}
                {round.status === "cancelled" && (
                  <button type="button" className={ICON_BUTTON} disabled={busy} onClick={() => run(() => api.post(`${base}/${round.id}/reinstate`), "Termin wieder angesetzt.")} aria-label={`${roundLabel(round)} wieder ansetzen`} title="Wieder ansetzen" data-testid="round-reinstate"><RotateCcw className="w-3.5 h-3.5" /></button>
                )}
                {round.state !== "scored" && (
                  <button type="button" className={ICON_BUTTON} disabled={busy} onClick={() => archive(round)} aria-label={`${roundLabel(round)} archivieren`} title="Archivieren" data-testid="round-archive"><Archive className="w-3.5 h-3.5" /></button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {archived.length > 0 && (
        <details className="mt-3 text-sm text-white/55" data-testid="calendar-archived">
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider">Archiviert ({archived.length})</summary>
          <ul className="mt-2 space-y-1">
            {archived.map((round) => (
              <li key={round.id} className="flex items-center gap-3">
                <span className="flex-1 min-w-0">{(round.code || "Termin")} · {roundWhen(round)}{round.venue ? ` · ${round.venue}` : ""}</span>
                <button type="button" disabled={busy} onClick={() => run(() => api.post(`${base}/${round.id}/restore`), "Termin zurückgeholt.")} className="tls-btn tls-btn--quiet px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                  <ArchiveRestore className="w-3.5 h-3.5" /> Zurückholen
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {sheet?.type === "round" && <RoundSheet series={series} lineage={lineage} round={sheet.round} suggestion={sheet.suggestion} onClose={() => setSheet(null)} onSaved={saved} />}
      {sheet?.type === "postpone" && <PostponeSheet series={series} round={sheet.round} onClose={() => setSheet(null)} onSaved={saved} />}
      {sheet?.type === "paste" && <PasteSheet series={series} lineage={lineage} onClose={() => setSheet(null)} onSaved={saved} />}
    </section>
  );
}
