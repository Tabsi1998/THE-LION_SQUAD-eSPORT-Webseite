// Einstellungen (#223): Abschnitt „Mail-Queue“ – nur Darstellung; Zustand und Handler bleiben in AdminSettingsPage.
import { CheckCircle2, XCircle, RefreshCw, Trash2 } from "lucide-react";
import { STATUS_LABELS, mailTemplateLabel } from "../shared";

export function MailQueueSection({ queue, queueStats, queueFilter, setQueueFilter, processQueueNow, recoverQueue, retryFailedQueue, cleanupQueue, retryJob, deleteJob, filteredQueue, queueCounts }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          ["pending", "Wartet", "#FFD700"],
          ["sending", "Sending", "#29B6E8"],
          ["sent", "Gesendet", "#00FF88"],
          ["failed", "Fehler", "#FF3B30"],
          ["skipped", "Übersprungen", "#FFFFFF"],
        ].map(([key, label, color]) => (
          <button
            key={key}
            type="button"
            onClick={() => setQueueFilter(queueFilter === key ? "" : key)}
            data-testid={`queue-stat-${key}`}
            className={`border rounded-sm p-3 text-left transition ${queueFilter === key ? "border-[#29B6E8] bg-[#29B6E8]/10" : "border-white/10 bg-[#121212] hover:border-white/25"}`}
          >
            <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold">{label}</div>
            <div className="mt-1 font-heading text-2xl font-black tabular-nums" style={{ color }}>{queueCounts[key] || 0}</div>
          </button>
        ))}
      </div>
      {(queueStats?.stale_sending > 0 || queueStats?.latest_problem) && (
        <div className="border border-[#FFD700]/25 bg-[#FFD700]/5 rounded-sm p-4 text-sm text-white/70">
          <div className="font-bold uppercase tracking-widest text-[#FFD700] mb-1">Queue-Hinweis</div>
          {queueStats?.stale_sending > 0 && <div>{queueStats.stale_sending} Versand-Job hängt länger als {queueStats.stale_after_minutes} Minuten.</div>}
          {queueStats?.latest_problem && <div className="mt-1">Letztes Problem: {queueStats.latest_problem.template_key || "Mail"} · {queueStats.latest_problem.last_error || queueStats.latest_problem.status}</div>}
        </div>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={processQueueNow} data-testid="queue-process-now" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5" /> Jetzt verarbeiten</button>
        <button onClick={recoverQueue} data-testid="queue-recover" className="px-4 py-2 border border-[#FFD700]/60 text-[#FFD700] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5" /> Hänger retten</button>
        <button onClick={retryFailedQueue} data-testid="queue-retry-failed" className="px-4 py-2 border border-[#FF3B30]/60 text-[#FF3B30] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5" /> Fehler retry</button>
        <button onClick={cleanupQueue} data-testid="queue-cleanup" className="px-4 py-2 border border-white/15 text-white/70 font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><Trash2 className="w-3.5 h-3.5" /> Aufräumen</button>
        <select value={queueFilter} onChange={(e) => setQueueFilter(e.target.value)} data-testid="queue-filter" className="bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
          <option value="">Alle</option>
          <option value="pending">pending</option>
          <option value="sending">sending</option>
          <option value="sent">sent</option>
          <option value="failed">failed</option>
          <option value="skipped">skipped</option>
        </select>
        <span className="text-xs text-white/50">
          {filteredQueue.length} / {queue.length} Jobs · {queueStats?.due_pending || 0} jetzt fällig · Worker läuft alle 30s automatisch
        </span>
      </div>
      <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3">Erstellt</th>
                <th className="text-left px-4 py-3">An</th>
                <th className="text-left px-4 py-3">Template</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Versuche</th>
                <th className="text-left px-4 py-3">Nächster</th>
                <th className="text-left px-4 py-3">Fehler</th>
                <th className="text-right px-4 py-3">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredQueue.map((j) => (
                <tr key={j.id} data-testid={`queue-row-${j.id}`}>
                  <td className="px-4 py-3 text-white/50 text-xs whitespace-nowrap">{new Date(j.created_at).toLocaleString("de-DE")}</td>
                  <td className="px-4 py-3">{j.to}</td>
                  <td className="px-4 py-3 text-xs">
                    <div className="text-[#29B6E8] font-bold">{mailTemplateLabel(j)}</div>
                    <div className="text-white/45 truncate max-w-[240px]">{j.subject || j.template_key || "—"}</div>
                    {j.meta?.username && <div className="text-white/35 truncate max-w-[240px]">Benutzer: {j.meta.username}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {j.status === "sent" && <span className="text-[#00FF88] inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> sent</span>}
                    {j.status === "failed" && <span className="text-[#FF3B30] inline-flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> failed</span>}
                    {j.status === "pending" && <span className="text-[#FFD700]">{j.template_key === "user_invite" ? "Einladungsmail wartet auf Versand" : STATUS_LABELS.pending}</span>}
                    {j.status === "sending" && <span className="text-[#29B6E8]">{STATUS_LABELS.sending}</span>}
                    {j.status === "skipped" && <span className="text-white/50">{STATUS_LABELS.skipped}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">{j.attempts}</td>
                  <td className="px-4 py-3 text-white/50 text-xs whitespace-nowrap">{j.next_attempt_at ? new Date(j.next_attempt_at).toLocaleString("de-DE") : "—"}</td>
                  <td className="px-4 py-3 text-white/40 text-xs truncate max-w-xs">{j.last_error || "—"}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => retryJob(j.id)} data-testid={`queue-retry-${j.id}`} className="text-[#29B6E8] hover:underline mr-3 text-xs"><RefreshCw className="w-3 h-3 inline mr-1" />Retry</button>
                    <button onClick={() => deleteJob(j.id)} data-testid={`queue-delete-${j.id}`} className="text-[#FF3B30] hover:underline text-xs"><Trash2 className="w-3 h-3 inline mr-1" />Löschen</button>
                  </td>
                </tr>
              ))}
              {filteredQueue.length === 0 && <tr><td colSpan="8" className="text-center py-10 text-white/40">{queue.length === 0 ? "Mail-Queue ist leer." : "Keine Jobs für diesen Filter."}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
