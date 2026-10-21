import { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { STATE_LABELS, STATE_TONES, dayLabel, moveIds, roundLabel, roundWhen, suggestNextDay } from "@/lib/referenceCalendar";
import { groupWeekends, hasSessions, sessionLabel } from "@/lib/raceWeekend";
import { PasteSheet, PostponeSheet, RoundSheet } from "./RoundSheets";
import { VenueWithFlag } from "@/components/tls/CountryFlag";
import { toast } from "sonner";
import { AlertTriangle, Archive, ArchiveRestore, ArrowDown, ArrowDownUp, ArrowUp, Ban, CalendarClock, ClipboardList, Pencil, Plus, RotateCcw } from "lucide-react";

// Kalender der Saison (#1742): Termine einzeln oder als eingefügte Liste, Standard-Wochentag und -Uhrzeit der Saison als
// Vorgabe, Bearbeiten, Verschieben (der ursprüngliche Termin bleibt stehen), Absagen (zählt nie als „Ergebnis fehlt“),
// Reihenfolge und Archivieren statt Löschen. Den Status je Termin und „heute“ rechnet der Server im Wiener Tag; ein
// Termin ohne Ergebnis, nach dem schon gewertet wurde, steht als Hinweis oben. Rennliga mit Läufen (#1930): je Runde ein
// Kopf, darunter ihre Läufe - jeder mit eigenem Status und eigenen Knöpfen.

const ORDERED_STATES = ["today", "missing", "planned", "postponed", "scored", "cancelled"];
const ICON_BUTTON = "p-1.5 rounded-sm text-white/50 hover:text-white hover:bg-white/5 disabled:opacity-25 disabled:hover:bg-transparent transition";

function RoundNotes({ round }) {
  if (round.kind !== "final" && round.counts !== false && !round.original_club_day && !round.status_note) return null;
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/45">
      {round.kind === "final" && <span className="uppercase tracking-widest font-bold text-[#29B6E8]">Finale</span>}
      {round.counts === false && <span>zählt nicht zur Wertung</span>}
      {round.original_club_day && <span data-testid="round-original">ursprünglich {dayLabel(round.original_club_day)}</span>}
      {round.status_note && <span>– {round.status_note}</span>}
    </div>
  );
}

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
  // Captains (#1749) lesen den Kalender ihrer Saison; ändern darf ihn nur der Vorstand.
  const board = (series.access?.role || "board") === "board";
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
      // 409: jemand anderes hat den Kalender inzwischen geändert - den aktuellen Stand zeigen.
      if (err.response?.status === 409) load();
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
  const weekends = lineage.kind === "racing" && hasSessions(rounds) ? groupWeekends(rounds) : null;
  const nameOf = (round) => (round.session ? sessionLabel(round) : roundLabel(round));

  const cancel = async (round) => {
    if (!await confirm({ title: `${nameOf(round)} absagen?`, description: "Ein abgesagter Termin zählt nicht als „Ergebnis fehlt“ und nicht zur Rundenzahl. „Wieder ansetzen“ nimmt es zurück.", confirmLabel: "Absagen" })) return;
    run(() => api.post(`${base}/${round.id}/cancel`, { expected_version: calendar?.version }), "Termin abgesagt.");
  };
  const archive = async (round) => {
    if (!await confirm({ title: `${nameOf(round)} archivieren?`, description: "Der Termin verschwindet aus dem Kalender. Gelöscht wird nichts – unter „Archiviert“ lässt er sich zurückholen.", confirmLabel: "Archivieren" })) return;
    run(() => api.post(`${base}/${round.id}/archive`, { expected_version: calendar?.version }), "Termin archiviert.");
  };
  const move = (index, step) => {
    const ids = moveIds(rounds, index, step);
    if (ids) run(() => api.post(`${base}/order`, { ids, expected_version: calendar?.version }));
  };
  const actions = (round, index) => (
    <div className="flex items-center shrink-0">
      <button type="button" className={ICON_BUTTON} disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={`${nameOf(round)} nach oben`} title="Nach oben"><ArrowUp className="w-3.5 h-3.5" /></button>
      <button type="button" className={ICON_BUTTON} disabled={busy || index === rounds.length - 1} onClick={() => move(index, 1)} aria-label={`${nameOf(round)} nach unten`} title="Nach unten"><ArrowDown className="w-3.5 h-3.5" /></button>
      <button type="button" className={ICON_BUTTON} onClick={() => setSheet({ type: "round", round })} aria-label={`${nameOf(round)} bearbeiten`} title="Bearbeiten" data-testid="round-edit"><Pencil className="w-3.5 h-3.5" /></button>
      {round.state !== "scored" && round.status !== "cancelled" && (
        <>
          <button type="button" className={ICON_BUTTON} onClick={() => setSheet({ type: "postpone", round })} aria-label={`${nameOf(round)} verschieben`} title="Verschieben" data-testid="round-postpone"><CalendarClock className="w-3.5 h-3.5" /></button>
          <button type="button" className={ICON_BUTTON} disabled={busy} onClick={() => cancel(round)} aria-label={`${nameOf(round)} absagen`} title="Absagen" data-testid="round-cancel"><Ban className="w-3.5 h-3.5" /></button>
        </>
      )}
      {round.status === "cancelled" && (
        <button type="button" className={ICON_BUTTON} disabled={busy} onClick={() => run(() => api.post(`${base}/${round.id}/reinstate`, { expected_version: calendar?.version }), "Termin wieder angesetzt.")} aria-label={`${nameOf(round)} wieder ansetzen`} title="Wieder ansetzen" data-testid="round-reinstate"><RotateCcw className="w-3.5 h-3.5" /></button>
      )}
      {round.state !== "scored" && (
        <button type="button" className={ICON_BUTTON} disabled={busy} onClick={() => archive(round)} aria-label={`${nameOf(round)} archivieren`} title="Archivieren" data-testid="round-archive"><Archive className="w-3.5 h-3.5" /></button>
      )}
    </div>
  );
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
        {board && <div className="flex items-center gap-2 flex-wrap">
          {rounds.length > 1 && (
            <button type="button" onClick={() => run(() => api.post(`${base}/sort-by-date`, { expected_version: calendar?.version }), "Nach Datum geordnet.")} disabled={busy} data-testid="calendar-sort" className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
              <ArrowDownUp className="w-3.5 h-3.5" /> Nach Datum ordnen
            </button>
          )}
          <button type="button" onClick={() => setSheet({ type: "paste" })} data-testid="calendar-paste" className="tls-btn tls-btn--secondary px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
            <ClipboardList className="w-3.5 h-3.5" /> Liste einfügen
          </button>
          <button type="button" onClick={openNew} disabled={!calendar} data-testid="calendar-new" className="tls-btn tls-btn--secondary px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
            <Plus className="w-3.5 h-3.5" /> Termin
          </button>
        </div>}
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
          {board ? "Noch keine Termine. Einzeln mit „Termin“ oder alle auf einmal mit „Liste einfügen“." : "Noch keine Termine."}
        </p>
      )}

      {rounds.length > 0 && !weekends && (
        <ol className="mt-3 divide-y divide-white/5" data-testid="calendar-rounds">
          {rounds.map((round, index) => (
            <li key={round.id} data-testid="calendar-round" data-state={round.state} className={`py-2.5 flex items-start gap-3 ${hintIds.has(round.id) ? "bg-amber-400/[0.04]" : ""}`}>
              <div className="w-12 shrink-0 pt-0.5 text-sm font-black tabular-nums text-white/80">{roundLabel(round)}</div>
              <div className="min-w-0 flex-1">
                <div className={`text-sm ${round.state === "cancelled" ? "text-white/45" : "text-white"}`}>
                  <span className="tabular-nums">{roundWhen(round)}</span>
                  {(round.venue || round.title || round.country_code) && <span className="text-white/60"> · <VenueWithFlag round={round} /></span>}
                  {round.opponent && <span className="text-white/60"> · gegen {round.opponent}</span>}
                </div>
                <RoundNotes round={round} />
              </div>
              <StateBadge state={round.state} />
              {board && actions(round, index)}
            </li>
          ))}
        </ol>
      )}

      {/* Rennliga mit Läufen (#1930): je Runde ein Kopf mit Tag, Ort und Flagge, darunter jeder Lauf mit Uhrzeit, Status
          und seinen eigenen Knöpfen - ein Lauf lässt sich einzeln verschieben, absagen oder archivieren. */}
      {weekends && (
        <ol className="mt-3 divide-y divide-white/5" data-testid="calendar-weekends">
          {weekends.map((weekend) => (
            <li key={weekend.key} className="py-2.5" data-testid="calendar-weekend" data-state={weekend.state}>
              <div className="flex items-start gap-3">
                <div className="w-12 shrink-0 pt-0.5 text-sm font-black tabular-nums text-white/80">{roundLabel(weekend.lead)}</div>
                <div className={`min-w-0 flex-1 text-sm ${weekend.state === "cancelled" ? "text-white/45" : "text-white"}`}>
                  <span className="tabular-nums">{dayLabel(weekend.lead.club_day) || "Termin offen"}</span>
                  {(weekend.venue || weekend.title || weekend.country_code) && <span className="text-white/60"> · <VenueWithFlag round={weekend} /></span>}
                </div>
                <StateBadge state={weekend.state} />
              </div>
              <ol className="mt-1.5 sm:ml-[3.75rem] border-l border-white/10 pl-3 space-y-1.5">
                {weekend.rounds.map((round) => {
                  const index = rounds.indexOf(round);
                  // Handy: Lauf, Zeit und Status in einer Zeile, die Knöpfe darunter; ab sm alles in einer Zeile.
                  return (
                    <li key={round.id} data-testid="calendar-round" data-state={round.state} className={`grid grid-cols-[6.5rem_minmax(0,1fr)_auto] sm:grid-cols-[7rem_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1 ${hintIds.has(round.id) ? "bg-amber-400/[0.04]" : ""}`}>
                      <span className={`text-[11px] font-bold uppercase tracking-[0.1em] [overflow-wrap:anywhere] ${round.state === "cancelled" ? "text-white/40 line-through" : "text-white/75"}`} data-testid="calendar-session">{round.session || "Rennen"}</span>
                      <span className="min-w-0">
                        <span className={`block text-sm tabular-nums ${round.state === "cancelled" ? "text-white/45" : "text-white/85"}`}>{round.club_day !== weekend.lead.club_day ? roundWhen(round) : round.time || "ohne Uhrzeit"}</span>
                        <RoundNotes round={round} />
                      </span>
                      <StateBadge state={round.state} />
                      {board && <div className="col-span-3 sm:col-span-1 -ml-1.5 sm:ml-0">{actions(round, index)}</div>}
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ol>
      )}

      {board && archived.length > 0 && (
        <details className="mt-3 text-sm text-white/55" data-testid="calendar-archived">
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider">Archiviert ({archived.length})</summary>
          <ul className="mt-2 space-y-1">
            {archived.map((round) => (
              <li key={round.id} className="flex items-center gap-3">
                <span className="flex-1 min-w-0">{(round.code || "Termin")}{round.session ? ` ${round.session}` : ""} · {roundWhen(round)}{round.venue ? ` · ${round.venue}` : ""}</span>
                <button type="button" disabled={busy} onClick={() => run(() => api.post(`${base}/${round.id}/restore`, { expected_version: calendar?.version }), "Termin zurückgeholt.")} className="tls-btn tls-btn--quiet px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                  <ArchiveRestore className="w-3.5 h-3.5" /> Zurückholen
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {sheet?.type === "round" && <RoundSheet series={series} lineage={lineage} round={sheet.round} suggestion={sheet.suggestion} version={calendar?.version} onClose={() => setSheet(null)} onSaved={saved} onStale={load} />}
      {sheet?.type === "postpone" && <PostponeSheet series={series} round={sheet.round} version={calendar?.version} onClose={() => setSheet(null)} onSaved={saved} onStale={load} />}
      {sheet?.type === "paste" && <PasteSheet series={series} lineage={lineage} version={calendar?.version} onClose={() => setSheet(null)} onSaved={saved} onStale={load} />}
    </section>
  );
}
