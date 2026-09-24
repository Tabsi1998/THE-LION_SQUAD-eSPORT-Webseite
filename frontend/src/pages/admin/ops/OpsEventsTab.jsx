import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Activity, AlertTriangle, Bot, Bug, CheckCircle2, Clock, Download, ExternalLink, Repeat, Search, Send, ServerCrash, ShieldCheck, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

// Ereignisse (#517 Teil 2): alle Quellen in einer Liste - Serverfehler, Auto-Checks, Alarme, App-Logs,
// E-Mail-Versand, Mail-Queue, Adminaktionen, Uploads, Dolibarr-Abgleich, Discord-Bot. Gefiltert wird
// auf dem Server (Quelle, Schwere, Zeitraum, Text); „Als CSV“ holt dieselbe Auswahl als Datei.

const SOURCE_ICONS = { uploads: UploadCloud, client: Bug, audit: ShieldCheck, email: Send, mail_queue: Clock, server: ServerCrash, checks: Activity, alerts: AlertTriangle, sync: Repeat, bot: Bot };
const SEVERITY_LABELS = { success: "OK", info: "Info", warn: "Warnung", error: "Fehler" };
const RANGES = [["24", "24 Stunden"], ["168", "7 Tage"], ["720", "30 Tage"], ["0", "Alles"]];
// Adminaktionen lassen sich wie früher auf der Audit-Seite nach Aktion eingrenzen.
const AUDIT_QUICK = [["", "Alle Aktionen"], ["user.role", "Rollen"], ["tournament.staff", "Turnier-Staff"], ["f1.staff", "Fast-Lap-Staff"], ["match.", "Matches"], ["prize.", "Gewinne"], ["settings.", "Settings"]];

export function formatEventTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("de-DE");
}

function severityClass(severity) {
  if (severity === "success") return "border-[#00FF88]/35 bg-[#00FF88]/10 text-[#00FF88]";
  if (severity === "error") return "border-[#FF3B30]/40 bg-[#FF3B30]/10 text-[#FF6B61]";
  if (severity === "warn") return "border-[#FFD700]/40 bg-[#FFD700]/10 text-[#FFD700]";
  return "border-white/10 bg-white/5 text-white/60";
}

export function sourceIcon(key) {
  return SOURCE_ICONS[key] || Activity;
}

export function EventRow({ row }) {
  const Icon = sourceIcon(row.source);
  return (
    <article className="rounded-sm border border-white/10 bg-[#121212] p-4" data-testid={`ops-event-${row.source}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[#29B6E8]" />
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`rounded-sm border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${severityClass(row.severity)}`}>
              {SEVERITY_LABELS[row.severity] || row.severity || "Log"}
            </span>
            <span className="rounded-sm border border-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white/45">{row.source_label}</span>
            {row.status && <span className="text-[10px] uppercase tracking-widest text-white/35">{row.status}</span>}
            <span className="ml-auto text-xs text-white/35">{formatEventTime(row.time)}</span>
          </div>
          <div className="break-words text-sm font-bold text-white">{row.title}</div>
          {row.subtitle && <div className="mt-1 break-words text-xs text-white/45">{row.subtitle}</div>}
          {row.detail && (
            <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-sm border border-white/10 bg-black/20 p-3 text-xs text-white/60">{row.detail}</pre>
          )}
        </div>
        {row.href && (
          <Link to={row.href} className="inline-flex shrink-0 items-center gap-2 rounded-sm border border-white/10 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white/55 hover:border-[#29B6E8]/50 hover:text-[#29B6E8]">
            <ExternalLink className="h-3.5 w-3.5" /> Öffnen
          </Link>
        )}
      </div>
    </article>
  );
}

export function OpsEventsTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const source = searchParams.get("source") || "all";
  const [severity, setSeverity] = useState("all");
  const [hours, setHours] = useState("168");
  const [q, setQ] = useState("");
  const [needle, setNeedle] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setNeedle(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const params = useMemo(() => ({ source, severity, hours: Number(hours), q: needle, limit: 300 }), [source, severity, hours, needle]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: payload } = await api.get("/admin/ops/events", { params });
      setData(payload && Array.isArray(payload.items) ? payload : { items: [], sources: [], summary: {} });
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Ereignisse konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [params]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["uploads", "admin/logs", "mobile-logs", "admin/ops"]);

  const setSource = (next) => {
    setSearchParams((current) => {
      const nextParams = new URLSearchParams(current);
      if (next === "all") nextParams.delete("source");
      else nextParams.set("source", next);
      return nextParams;
    }, { replace: true });
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { data: blob } = await api.get("/admin/ops/events", { params: { ...params, limit: 500, format: "csv" }, responseType: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "ereignisse.csv";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Export hat nicht geklappt.");
    } finally {
      setExporting(false);
    }
  };

  const sources = data?.sources || [];
  const rows = data?.items || [];

  return (
    <div className="space-y-4" data-testid="ops-events">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-sm border border-white/10 bg-[#121212] p-1">
          {[{ key: "all", label: "Alle" }, ...sources.map((item) => ({ key: item.key, label: item.label, problems: item.problem_count }))].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setSource(item.key)}
              data-testid={`ops-events-source-${item.key}`}
              className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest ${source === item.key ? "bg-[#29B6E8] text-black" : "text-white/55 hover:text-white"}`}
            >
              {item.label}
              {Number(item.problems || 0) > 0 && <span className={`rounded-sm px-1 ${source === item.key ? "bg-black/20" : "bg-[#FFD700]/15 text-[#FFD700]"}`}>{item.problems}</span>}
            </button>
          ))}
        </div>
        <select value={severity} onChange={(event) => setSeverity(event.target.value)} data-testid="ops-events-severity" className="h-[34px] rounded-sm border border-white/10 bg-[#121212] px-3 text-xs font-bold uppercase tracking-wider text-white">
          <option value="all">Alle Level</option>
          <option value="problem">Nur Probleme</option>
          <option value="error">Fehler</option>
          <option value="warn">Warnungen</option>
          <option value="info">Info</option>
          <option value="success">OK</option>
        </select>
        <select value={hours} onChange={(event) => setHours(event.target.value)} data-testid="ops-events-range" className="h-[34px] rounded-sm border border-white/10 bg-[#121212] px-3 text-xs font-bold uppercase tracking-wider text-white">
          {RANGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label className="relative min-w-[220px] flex-1 max-w-lg">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Ereignisse suchen …" data-testid="ops-events-search"
            className="w-full rounded-sm border border-white/10 bg-[#0A0A0A] py-2 pl-9 pr-3 text-sm text-white" />
        </label>
        <button type="button" onClick={exportCsv} disabled={exporting || !rows.length} data-testid="ops-events-export"
          className="inline-flex items-center gap-2 rounded-sm border border-white/10 bg-[#121212] px-3 py-2 text-xs font-bold uppercase tracking-wider hover:border-[#29B6E8]/50 disabled:opacity-40">
          <Download className="h-4 w-4" /> Als CSV
        </button>
      </div>

      {source === "audit" && (
        <div className="flex flex-wrap gap-2" data-testid="ops-events-audit-quick">
          {AUDIT_QUICK.map(([value, label]) => (
            <button key={label} type="button" onClick={() => setQ(value)}
              className={`rounded-sm border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest ${q === value ? "border-[#29B6E8] bg-[#29B6E8]/10 text-[#29B6E8]" : "border-white/10 text-white/55 hover:text-white"}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {rows.map((row) => <EventRow key={`${row.source}-${row.id}-${row.time}`} row={row} />)}
        {!rows.length && (
          <div className="rounded-sm border border-white/10 bg-[#121212] p-10 text-center text-white/40" data-testid="ops-events-empty">
            {loading ? "Lade Ereignisse …" : <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#00FF88]" /> Keine Ereignisse für diese Auswahl.</span>}
          </div>
        )}
      </div>
      {data?.summary?.problem_count > 0 && (
        <div className="inline-flex items-center gap-2 rounded-sm border border-[#FFD700]/30 bg-[#FFD700]/5 px-3 py-2 text-xs text-[#FFD700]" data-testid="ops-events-problems">
          <AlertTriangle className="h-4 w-4" /> {data.summary.problem_count} auffällige Einträge über alle Quellen.
        </div>
      )}
    </div>
  );
}
