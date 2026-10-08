// Einstellungen (#223): Abschnitt „Mail-Queue“ – nur Darstellung; Daten und Handler bleiben in AdminSettingsPage.
// #1361: je Zeile nur die Aktion, die zum Stand passt (Fehlgeschlagen → „Nochmal versuchen“, sonst nichts; „Löschen“
// unter „Mehr“). Stand, Vorlage und Fehler stehen auf Deutsch. Ab 1024 px eine Tabelle, darunter Karten.
import { useState } from "react";
import { CheckCircle2, ChevronDown, Clock, RefreshCw, Send, SkipForward, Trash2, XCircle } from "lucide-react";
import { QUEUE_STATES, STATUS_LABELS, mailErrorKnown, mailTemplateLabel, queueActions, queueDetail } from "../shared";
import { viennaDateTime } from "@/lib/vienna";

const STATE_STYLE = {
  pending: { color: "#FFD700", icon: Clock },
  sending: { color: "#29B6E8", icon: Send },
  sent: { color: "#00FF88", icon: CheckCircle2 },
  failed: { color: "#FF3B30", icon: XCircle },
  skipped: { color: "#A1A1AA", icon: SkipForward },
};

// Tag und Uhrzeit ohne Sekunden - „8.10.2026, 09:30“.
const WHEN = { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" };

function when(value) {
  return viennaDateTime(value, WHEN);
}

function StateBadge({ job, testId }) {
  const style = STATE_STYLE[job.status] || STATE_STYLE.skipped;
  const Icon = style.icon;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold whitespace-nowrap" style={{ color: style.color }} data-testid={testId}>
      <Icon className="w-3.5 h-3.5" /> {STATUS_LABELS[job.status] || "Unbekannt"}
    </span>
  );
}

function Detail({ job, testId }) {
  return (
    <>
      <div className="mt-1 text-xs text-white/60" data-testid={testId}>{queueDetail(job, when)}</div>
      {job.last_error && !mailErrorKnown(job.last_error) && (
        <div className="mt-0.5 text-[11px] text-white/35 break-words">Meldung des Servers: {String(job.last_error).slice(0, 200)}</div>
      )}
    </>
  );
}

function MailText({ job }) {
  return (
    <>
      <div className="text-[#29B6E8] font-bold">{mailTemplateLabel(job)}</div>
      {job.subject && <div className="text-white/45 truncate">{job.subject}</div>}
      {job.meta?.username && <div className="text-white/35 truncate">Benutzer: {job.meta.username}</div>}
    </>
  );
}

export function MailQueueSection({ queue, queueStats, queueFilter, setQueueFilter, processQueueNow, recoverQueue, retryFailedQueue, cleanupQueue, retryJob, deleteJob, filteredQueue, queueCounts }) {
  const [menuFor, setMenuFor] = useState(null);
  const stale = queueStats?.stale_sending || 0;
  const latest = queueStats?.latest_problem;

  const actions = (job, prefix) => {
    const allowed = queueActions(job);
    const open = menuFor === `${prefix}-${job.id}`;
    if (!allowed.retry && !allowed.remove) return null;
    return (
      <div className="flex flex-col items-end gap-2">
        <div className="flex flex-wrap justify-end gap-2">
          {allowed.retry && (
            <button type="button" onClick={() => retryJob(job.id)} data-testid={`${prefix}-retry-${job.id}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#29B6E8] text-black text-[11px] font-bold uppercase tracking-wider rounded-sm whitespace-nowrap">
              <RefreshCw className="w-3 h-3" /> Nochmal versuchen
            </button>
          )}
          {allowed.remove && (
            <button type="button" onClick={() => setMenuFor(open ? null : `${prefix}-${job.id}`)} aria-expanded={open} data-testid={`${prefix}-more-${job.id}`} className="inline-flex items-center gap-1 px-3 py-1.5 border border-white/10 text-white/60 hover:text-white rounded-sm text-[11px] font-bold uppercase tracking-wider">
              Mehr <ChevronDown className={`w-3 h-3 transition ${open ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
        {open && (
          <button type="button" onClick={() => { setMenuFor(null); deleteJob(job); }} data-testid={`${prefix}-delete-${job.id}`} className="inline-flex items-center gap-1 text-xs text-[#FF6B6B] hover:underline">
            <Trash2 className="w-3 h-3" /> Löschen
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {QUEUE_STATES.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setQueueFilter(queueFilter === key ? "" : key)}
            aria-pressed={queueFilter === key}
            data-testid={`queue-stat-${key}`}
            className={`border rounded-sm p-3 text-left transition ${queueFilter === key ? "border-[#29B6E8] bg-[#29B6E8]/10" : "border-white/10 bg-[#121212] hover:border-white/25"}`}
          >
            <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold">{STATUS_LABELS[key]}</div>
            <div className="mt-1 font-heading text-2xl font-black tabular-nums" style={{ color: STATE_STYLE[key].color }}>{queueCounts[key] || 0}</div>
          </button>
        ))}
      </div>
      {(stale > 0 || latest) && (
        <div className="border border-[#FFD700]/25 bg-[#FFD700]/5 rounded-sm p-4 text-sm text-white/70" data-testid="queue-hint">
          <div className="font-bold uppercase tracking-widest text-[#FFD700] mb-1">Hinweis</div>
          {stale > 0 && (
            <div>
              {stale === 1 ? "Eine Mail hängt" : `${stale} Mails hängen`} seit über {queueStats.stale_after_minutes} Minuten beim Senden – „Hängende Mails neu anstoßen“ stellt sie zurück in die Warteschlange.
            </div>
          )}
          {latest && <div className="mt-1">Letztes Problem: {mailTemplateLabel(latest)} – {queueDetail(latest, when)}</div>}
        </div>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" onClick={processQueueNow} data-testid="queue-process-now" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5" /> Jetzt verarbeiten</button>
        <button type="button" onClick={recoverQueue} data-testid="queue-recover" className="px-4 py-2 border border-[#FFD700]/60 text-[#FFD700] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5" /> Hängende Mails neu anstoßen</button>
        <button type="button" onClick={retryFailedQueue} data-testid="queue-retry-failed" className="px-4 py-2 border border-[#FF3B30]/60 text-[#FF3B30] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5" /> Alle fehlgeschlagenen nochmal versuchen</button>
        <button type="button" onClick={cleanupQueue} data-testid="queue-cleanup" className="px-4 py-2 border border-white/15 text-white/70 font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><Trash2 className="w-3.5 h-3.5" /> Aufräumen</button>
        <select value={queueFilter} onChange={(e) => setQueueFilter(e.target.value)} aria-label="Nach Stand filtern" data-testid="queue-filter" className="bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
          <option value="">Alle</option>
          {QUEUE_STATES.map((key) => <option key={key} value={key}>{STATUS_LABELS[key]}</option>)}
        </select>
        <span className="text-xs text-white/50" data-testid="queue-count">
          {filteredQueue.length} von {queue.length} Mails · {queueStats?.due_pending || 0} jetzt fällig · der Versand läuft alle 30 Sekunden von selbst
        </span>
      </div>

      {filteredQueue.length === 0 ? (
        <div className="border border-white/10 bg-[#121212] rounded-sm py-10 text-center text-sm text-white/40" data-testid="queue-empty">
          {queue.length === 0 ? "Die Warteschlange ist leer." : "Keine Mails mit diesem Stand."}
        </div>
      ) : (
        <>
          <div className="hidden lg:block border border-white/10 bg-[#121212] rounded-sm overflow-hidden" data-testid="queue-table">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[680px]">
                <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
                  <tr>
                    <th className="text-left px-4 py-3">Erstellt</th>
                    <th className="text-left px-4 py-3">An</th>
                    <th className="text-left px-4 py-3">Mail</th>
                    <th className="text-left px-4 py-3">Stand</th>
                    <th className="text-right px-4 py-3"><span className="sr-only">Aktion</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredQueue.map((job) => (
                    <tr key={job.id} data-testid={`queue-row-${job.id}`} className="align-top">
                      <td className="px-4 py-3 text-white/50 text-xs whitespace-nowrap">{when(job.created_at)}</td>
                      <td className="px-4 py-3 break-all max-w-[220px]">{job.to}</td>
                      <td className="px-4 py-3 text-xs max-w-[260px]"><MailText job={job} /></td>
                      <td className="px-4 py-3 max-w-[300px]">
                        <StateBadge job={job} testId={`queue-state-${job.id}`} />
                        <Detail job={job} testId={`queue-detail-${job.id}`} />
                      </td>
                      <td className="px-4 py-3 text-right">{actions(job, "queue")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <ul className="lg:hidden space-y-3" data-testid="queue-cards">
            {filteredQueue.map((job) => (
              <li key={job.id} className="border border-white/10 bg-[#121212] rounded-sm p-4" data-testid={`queue-card-${job.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StateBadge job={job} testId={`queue-card-state-${job.id}`} />
                  <span className="text-[11px] text-white/45">{when(job.created_at)}</span>
                </div>
                <div className="mt-2 text-sm break-all">{job.to}</div>
                <div className="mt-1 text-xs min-w-0"><MailText job={job} /></div>
                <Detail job={job} testId={`queue-card-detail-${job.id}`} />
                {queueActions(job).retry || queueActions(job).remove ? <div className="mt-3">{actions(job, "queue-card")}</div> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
