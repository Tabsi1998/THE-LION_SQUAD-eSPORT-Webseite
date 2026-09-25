// Einstellungen (#223): Abschnitt „Systemstatus“ – nur Darstellung; Zustand und Handler bleiben in AdminSettingsPage.
import { SystemCard } from "../fields";
import { RefreshCw } from "lucide-react";

export function SystemSection({ systemStatus, load }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={load} data-testid="system-refresh" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5" /> Aktualisieren</button>
        <span className="text-xs text-white/50">Live-Status für Versand, Uploads, Scheduler und Queue.</span>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        <SystemCard title="Datenbank" ok={systemStatus?.database?.ok} detail={systemStatus?.database?.error || "MongoDB Ping"} />
        <SystemCard title="SMTP / Mail" ok={systemStatus?.smtp?.ok} detail={`${systemStatus?.smtp?.provider || "-"} ${systemStatus?.smtp?.host || ""}`} problem={systemStatus?.smtp?.latest_problem?.error} />
        <SystemCard title="Discord" ok={systemStatus?.discord?.ok} detail={systemStatus?.discord?.configured ? (systemStatus?.discord?.bot_enabled ? "Bot sendet in gewählte Kanäle" : "Kanäle gewählt, Bot aus") : "Kein Kanal gewählt"} problem={systemStatus?.discord?.latest?.error} />
        <SystemCard title="Uploads" ok={systemStatus?.uploads?.ok} detail={(systemStatus?.uploads?.checks || []).map((c) => `${c.label}: ${c.ok ? "OK" : "NO"}`).join(" · ")} />
        <SystemCard title="Scheduler" ok={systemStatus?.scheduler?.running} detail={(systemStatus?.scheduler?.jobs || []).map((j) => `${j.id}: ${j.next_run_time ? new Date(j.next_run_time).toLocaleString("de-DE") : "-"}`).join(" · ")} />
        <SystemCard title="Mail-Queue" ok={(systemStatus?.mail_queue?.failed || 0) === 0} detail={systemStatus?.mail_queue ? `pending ${systemStatus.mail_queue.pending || 0} · failed ${systemStatus.mail_queue.failed || 0} · sent ${systemStatus.mail_queue.sent || 0}` : "-"} />
      </div>
      {systemStatus?.uploads?.checks?.length > 0 && (
        <div className="border border-white/10 bg-[#121212] rounded-sm p-5">
          <div className="font-heading font-bold uppercase mb-3">Upload-Pfade</div>
          <div className="space-y-2 text-xs">
            {systemStatus.uploads.checks.map((c) => (
              <div key={c.label} className="grid md:grid-cols-[120px_1fr_120px] gap-2 border-b border-white/5 pb-2">
                <span className="text-white/70">{c.label}</span>
                <span className="font-mono text-white/50 break-all">{c.path}</span>
                <span className={c.ok ? "text-[#00FF88]" : "text-[#FF3B30]"}>{c.ok ? "beschreibbar" : "nicht beschreibbar"}</span>
                {c.error && <span className="md:col-start-2 md:col-span-2 text-[#FF3B30] break-words">{c.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
