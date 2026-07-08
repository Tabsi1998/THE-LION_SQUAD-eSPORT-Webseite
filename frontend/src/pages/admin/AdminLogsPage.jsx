import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Bug,
  CheckCircle2,
  Clock,
  ExternalLink,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

const SOURCE_ICONS = {
  uploads: UploadCloud,
  client: Bug,
  audit: ShieldCheck,
  email: Send,
  mail_queue: Clock,
};

const SEVERITY_LABELS = {
  success: "OK",
  info: "Info",
  warn: "Warnung",
  error: "Fehler",
};

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("de-DE");
}

function sourceToneClass(source) {
  if (Number(source.problem_count || 0) > 0) return "border-[#FFD700]/35 bg-[#FFD700]/5";
  return "border-white/10 bg-[#121212]";
}

function severityClass(severity) {
  if (severity === "success") return "border-[#00FF88]/35 bg-[#00FF88]/10 text-[#00FF88]";
  if (severity === "error") return "border-[#FF3B30]/40 bg-[#FF3B30]/10 text-[#FF6B61]";
  if (severity === "warn") return "border-[#FFD700]/40 bg-[#FFD700]/10 text-[#FFD700]";
  return "border-white/10 bg-white/5 text-white/60";
}

function sourceIcon(key) {
  return SOURCE_ICONS[key] || Activity;
}

export default function AdminLogsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: payload } = await api.get("/admin/logs?limit=90");
      setData(payload);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Logs konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["uploads", "admin/logs", "mobile-logs"]);

  const sources = useMemo(() => data?.sources || [], [data]);
  const rows = useMemo(() => {
    const selectedSource = sources.find((item) => item.key === source);
    const baseRows = source === "all" ? (data?.combined || []) : (selectedSource?.items || []);
    const needle = q.trim().toLowerCase();
    return baseRows.filter((row) => {
      if (severity === "problem" && !["warn", "error"].includes(row.severity)) return false;
      if (!["all", "problem"].includes(severity) && row.severity !== severity) return false;
      if (!needle) return true;
      const haystack = [row.source_label, row.title, row.subtitle, row.detail, row.status].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [data, q, severity, source, sources]);

  return (
    <AdminLayout>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Monitoring</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Logs</h1>
          <p className="mt-2 max-w-3xl text-sm text-white/55">
            Zentrale Übersicht für Uploads, App-Fehler, Adminaktionen, Mailversand und Mail-Queue.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-sm border border-white/10 bg-[#121212] px-3 py-2 text-xs font-bold uppercase tracking-wider hover:border-[#29B6E8]/50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Aktualisieren
        </button>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {sources.map((item) => {
          const Icon = sourceIcon(item.key);
          return (
            <Link key={item.key} to={item.href} className={`rounded-sm border p-4 transition hover:border-[#29B6E8]/55 ${sourceToneClass(item)}`}>
              <div className="flex items-start justify-between gap-3">
                <Icon className="h-5 w-5 text-[#29B6E8]" />
                {Number(item.problem_count || 0) > 0 ? (
                  <span className="rounded-sm border border-[#FFD700]/35 bg-[#FFD700]/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[#FFD700]">
                    {item.problem_count} auffällig
                  </span>
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-[#00FF88]" />
                )}
              </div>
              <div className="mt-4 text-[10px] font-bold uppercase tracking-widest text-white/45">{item.label}</div>
              <div className="mt-1 font-heading text-2xl font-black tabular-nums text-white">{item.total || 0}</div>
              <div className="mt-1 text-[11px] text-white/40">{item.latest_at ? formatTime(item.latest_at) : "Noch keine Einträge"}</div>
            </Link>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-sm border border-white/10 bg-[#121212] p-1">
          {[{ key: "all", label: "Alle" }, ...sources.map((item) => ({ key: item.key, label: item.label }))].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setSource(item.key)}
              className={`rounded-sm px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest ${
                source === item.key ? "bg-[#29B6E8] text-black" : "text-white/55 hover:text-white"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <select
          value={severity}
          onChange={(event) => setSeverity(event.target.value)}
          className="h-[34px] rounded-sm border border-white/10 bg-[#121212] px-3 text-xs font-bold uppercase tracking-wider text-white"
        >
          <option value="all">Alle Level</option>
          <option value="problem">Nur Probleme</option>
          <option value="error">Fehler</option>
          <option value="warn">Warnungen</option>
          <option value="info">Info</option>
          <option value="success">OK</option>
        </select>
        <label className="relative min-w-[240px] flex-1 max-w-lg">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Logs suchen..."
            className="w-full rounded-sm border border-white/10 bg-[#0A0A0A] py-2 pl-9 pr-3 text-sm text-white"
          />
        </label>
      </div>

      <div className="mt-5 space-y-3">
        {rows.map((row) => {
          const Icon = sourceIcon(row.source);
          return (
            <article key={`${row.source}-${row.id}-${row.time}`} className="rounded-sm border border-white/10 bg-[#121212] p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[#29B6E8]" />
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className={`rounded-sm border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${severityClass(row.severity)}`}>
                      {SEVERITY_LABELS[row.severity] || row.severity || "Log"}
                    </span>
                    <span className="rounded-sm border border-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white/45">{row.source_label}</span>
                    {row.status && <span className="text-[10px] uppercase tracking-widest text-white/35">{row.status}</span>}
                    <span className="ml-auto text-xs text-white/35">{formatTime(row.time)}</span>
                  </div>
                  <div className="break-words text-sm font-bold text-white">{row.title}</div>
                  {row.subtitle && <div className="mt-1 break-words text-xs text-white/45">{row.subtitle}</div>}
                  {row.detail && (
                    <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-sm border border-white/10 bg-black/20 p-3 text-xs text-white/60">{row.detail}</pre>
                  )}
                </div>
                <Link
                  to={row.href}
                  className="inline-flex shrink-0 items-center gap-2 rounded-sm border border-white/10 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white/55 hover:border-[#29B6E8]/50 hover:text-[#29B6E8]"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Details
                </Link>
              </div>
            </article>
          );
        })}
        {!rows.length && (
          <div className="rounded-sm border border-white/10 bg-[#121212] p-10 text-center text-white/40">
            {loading ? "Lade Logs..." : "Keine passenden Logs gefunden."}
          </div>
        )}
      </div>

      {data?.summary?.problem_count > 0 && (
        <div className="mt-5 inline-flex items-center gap-2 rounded-sm border border-[#FFD700]/30 bg-[#FFD700]/5 px-3 py-2 text-xs text-[#FFD700]">
          <AlertTriangle className="h-4 w-4" /> {data.summary.problem_count} auffällige Logeinträge über alle Quellen.
        </div>
      )}
    </AdminLayout>
  );
}
