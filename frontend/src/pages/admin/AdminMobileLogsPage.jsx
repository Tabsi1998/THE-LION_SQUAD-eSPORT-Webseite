import { useCallback, useEffect, useMemo, useState } from "react";
import { Bug, CheckCircle2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

const LEVELS = ["", "fatal", "error", "warn", "info", "debug"];
const STATUSES = ["", "open", "info", "resolved", "ignored"];

function formatTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("de-DE");
  } catch {
    return value;
  }
}

function badgeClass(level) {
  if (level === "fatal" || level === "error") return "border-[#FF3B30]/40 bg-[#FF3B30]/10 text-[#FF6B61]";
  if (level === "warn") return "border-[#FFCC00]/40 bg-[#FFCC00]/10 text-[#FFD95A]";
  return "border-white/10 bg-white/5 text-white/60";
}

export default function AdminMobileLogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [level, setLevel] = useState("");
  const [status, setStatus] = useState("");
  const [expanded, setExpanded] = useState(null);

  const params = useMemo(() => {
    const query = new URLSearchParams({ limit: "150" });
    if (q.trim()) query.set("q", q.trim());
    if (level) query.set("level", level);
    if (status) query.set("status", status);
    return query.toString();
  }, [level, q, status]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/admin/mobile-logs?${params}`);
      setLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load);

  const patchLog = async (log, patch) => {
    try {
      const { data } = await api.patch(`/admin/mobile-logs/${log.id}`, patch);
      setLogs((items) => items.map((item) => (item.id === log.id ? data : item)));
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  return (
    <AdminLayout>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Mobile</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">App-Logs</h1>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 border border-white/10 bg-[#121212] px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider hover:border-[#29B6E8]/50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Aktualisieren
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_160px_160px] mb-5">
        <label className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Nachricht, Quelle, Benutzer suchen..."
            className="w-full bg-[#0A0A0A] border border-white/10 pl-9 pr-3 py-2.5 rounded-sm text-sm"
          />
        </label>
        <select value={level} onChange={(event) => setLevel(event.target.value)} className="bg-[#0A0A0A] border border-white/10 px-3 py-2.5 rounded-sm text-sm">
          {LEVELS.map((item) => <option key={item || "all"} value={item}>{item || "Alle Level"}</option>)}
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="bg-[#0A0A0A] border border-white/10 px-3 py-2.5 rounded-sm text-sm">
          {STATUSES.map((item) => <option key={item || "all"} value={item}>{item || "Alle Status"}</option>)}
        </select>
      </div>

      <div className="space-y-3">
        {logs.map((log) => {
          const isExpanded = expanded === log.id;
          return (
            <article key={log.id} className="border border-white/10 bg-[#121212] rounded-sm">
              <button
                type="button"
                onClick={() => setExpanded(isExpanded ? null : log.id)}
                className="w-full text-left p-4 flex flex-col md:flex-row md:items-start gap-3"
              >
                <Bug className="w-5 h-5 text-[#29B6E8] shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className={`text-[10px] font-black uppercase tracking-wider border px-2 py-1 rounded-sm ${badgeClass(log.level)}`}>{log.level || "info"}</span>
                    <span className="text-[10px] font-black uppercase tracking-wider border border-white/10 px-2 py-1 rounded-sm text-white/50">{log.status || "open"}</span>
                    <span className="text-xs text-white/35">{formatTime(log.received_at || log.created_at)}</span>
                    <span className="text-xs text-[#29B6E8]">{log.display_name || log.username || log.user_id?.slice(0, 8) || "Unbekannt"}</span>
                  </div>
                  <p className="text-sm font-semibold text-white break-words">{log.message}</p>
                  <p className="text-xs text-white/45 mt-1">
                    {[log.source, log.screen, log.platform, log.device_name, log.app_version && `v${log.app_version}`, log.build_version && `Build ${log.build_version}`].filter(Boolean).join(" | ")}
                  </p>
                </div>
              </button>
              {isExpanded && (
                <div className="border-t border-white/10 p-4 space-y-3">
                  {log.stack && (
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-sm bg-[#0A0A0A] border border-white/10 p-3 text-xs text-white/70">{log.stack}</pre>
                  )}
                  {log.context && (
                    <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-sm bg-[#0A0A0A] border border-white/10 p-3 text-xs text-white/55">{JSON.stringify(log.context, null, 2)}</pre>
                  )}
                  <textarea
                    defaultValue={log.admin_note || ""}
                    onBlur={(event) => {
                      if (event.target.value !== (log.admin_note || "")) patchLog(log, { admin_note: event.target.value });
                    }}
                    placeholder="Admin-Notiz..."
                    className="w-full min-h-20 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => patchLog(log, { status: "resolved" })} className="inline-flex items-center gap-2 bg-[#29B6E8] text-black px-3 py-2 rounded-sm text-xs font-black uppercase tracking-wider">
                      <CheckCircle2 className="w-4 h-4" /> Erledigt
                    </button>
                    <button onClick={() => patchLog(log, { status: "open" })} className="border border-white/10 px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider text-white/70">
                      Offen
                    </button>
                    <button onClick={() => patchLog(log, { status: "ignored" })} className="border border-white/10 px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider text-white/45">
                      Ignorieren
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
        {!logs.length && (
          <div className="border border-white/10 bg-[#121212] rounded-sm p-10 text-center text-white/40">
            {loading ? "Lade App-Logs..." : "Keine App-Logs gefunden"}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
