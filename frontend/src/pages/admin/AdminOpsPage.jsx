import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Activity, AlertTriangle, CheckCircle2, Gauge, PlayCircle, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { OpsAlertsPanel } from "./ops/OpsAlertsPanel";
import { OpsEventsTab } from "./ops/OpsEventsTab";
import { OpsOverview } from "./ops/OpsOverview";
import { AppLogsTab } from "./ops/AppLogsTab";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { RATING_LABELS, STATUS_LABELS, TONE_COLORS, describeRun, formatVital, ratingTone } from "@/lib/ops";

// Betrieb (#233, #265): Server-Fehler als Gruppen mit Zähler, die langsamsten
// Routen, Web Vitals je Seite von echten Besuchern und die Ampel der
// Auto-Checks. Nichts davon kommt über den Änderungsstrom - die Seite fragt
// alle 30 Sekunden nach, solange sie offen ist.

// Eine Seite für alles (#517 Teil 2): Überblick und Ereignisse über alle Quellen, dazu die bisherigen
// Reiter und die App-Logs. Der Reiter steht in der Adresse (?tab=), damit alte Seiten hierher umleiten.
const TABS = [
  { key: "overview", label: "Überblick" },
  { key: "events", label: "Ereignisse" },
  { key: "errors", label: "Fehler" },
  { key: "slow", label: "Tempo" },
  { key: "vitals", label: "Vitals" },
  { key: "checks", label: "Checks" },
  { key: "app", label: "App-Logs" },
  { key: "alerts", label: "Alarme" },
];
const VITAL_COLUMNS = ["LCP", "INP", "CLS", "TTFB"];

function formatTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("de-DE");
  } catch {
    return value;
  }
}

export function describeSummary(summary) {
  if (!summary) return "Noch keine Daten.";
  const parts = [
    `${summary.open_error_groups ?? 0} Fehlergruppen offen`,
    `${summary.slow_requests_24h ?? 0} langsame Anfragen in 24 h`,
  ];
  if (summary.slowest_route_24h?.route) {
    parts.push(`langsamste: ${summary.slowest_route_24h.route} (${summary.slowest_route_24h.duration_ms} ms)`);
  }
  return parts.join(" · ");
}

export default function AdminOpsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab = TABS.some((item) => item.key === tabParam) ? tabParam : "overview";
  const setTab = (next, source = null) => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next === "overview") params.delete("tab");
      else params.set("tab", next);
      if (source) params.set("source", source);
      else params.delete("source");
      return params;
    }, { replace: true });
  };
  const [status, setStatus] = useState("open");
  const [summary, setSummary] = useState(null);
  const [errors, setErrors] = useState([]);
  const [slow, setSlow] = useState(null);
  const [vitals, setVitals] = useState(null);
  const [checks, setChecks] = useState(null);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryResult, errorsResult, slowResult, vitalsResult, checksResult] = await Promise.all([
        api.get("/admin/ops/summary"),
        api.get(`/admin/ops/errors?status=${status}&limit=200`),
        api.get("/admin/ops/slow?hours=24&limit=50"),
        api.get("/admin/ops/vitals?days=7"),
        api.get("/admin/ops/checks"),
      ]);
      setSummary(summaryResult.data || null);
      setErrors(Array.isArray(errorsResult.data) ? errorsResult.data : []);
      setSlow(slowResult.data || null);
      setVitals(vitalsResult.data || null);
      setChecks(checksResult.data || null);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ["admin/ops"], { pollMs: 30000 });

  const runChecks = async () => {
    setRunning(true);
    try {
      const { data } = await api.post("/admin/ops/checks/run");
      setChecks((current) => ({ ...(current || {}), latest: data }));
      toast.success(data?.status === "ok" ? "Alle Prüfungen grün." : `Lauf fertig: ${STATUS_LABELS[data?.status] || data?.status}.`);
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setRunning(false);
    }
  };

  const setResolved = async (row, resolved) => {
    try {
      const { data } = await api.post(`/admin/ops/errors/${row.fingerprint}/${resolved ? "resolve" : "reopen"}`);
      setErrors((items) => items.map((item) => (item.fingerprint === row.fingerprint ? data : item)));
      toast.success(resolved ? "Als gelöst markiert." : "Wieder geöffnet.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const tiles = useMemo(() => [
    { label: "Fehlergruppen offen", value: summary?.open_error_groups ?? "–", tone: (summary?.open_error_groups || 0) > 0 ? "danger" : "ok" },
    { label: "Fehlergruppen 24 h", value: summary?.error_groups_24h ?? "–", tone: (summary?.error_groups_24h || 0) > 0 ? "warn" : "ok" },
    { label: `Langsam (> ${summary?.threshold_ms ?? 1000} ms) 24 h`, value: summary?.slow_requests_24h ?? "–", tone: (summary?.slow_requests_24h || 0) > 20 ? "warn" : "ok" },
    { label: "Langsamste Route 24 h", value: summary?.slowest_route_24h ? `${summary.slowest_route_24h.duration_ms} ms` : "–", detail: summary?.slowest_route_24h?.route, tone: "plain" },
    {
      label: "Auto-Checks",
      value: summary?.checks?.status ? STATUS_LABELS[summary.checks.status] || summary.checks.status : "–",
      detail: summary?.checks ? `${summary.checks.counts?.crit ?? 0} rot · ${summary.checks.counts?.warn ?? 0} gelb · ${formatTime(summary.checks.at)}` : "noch kein Lauf",
      tone: summary?.checks?.status === "crit" ? "danger" : summary?.checks?.status === "warn" ? "warn" : "ok",
    },
  ], [summary]);

  return (
    <AdminLayout>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">System</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1" data-testid="ops-title">Betrieb & Logs</h1>
          <p className="text-sm text-white/55 mt-2 max-w-2xl">
            Alles, was der Betrieb meldet, an einem Ort: Serverfehler, Auto-Checks, Alarme, App-Logs, E-Mail-Versand,
            Adminaktionen und Abgleiche. Ohne Namen, Adressen oder Tokens; Aufbewahrung unter Alarme.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 border border-white/10 bg-[#121212] px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider hover:border-[#29B6E8]/50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Aktualisieren
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className={`border rounded-sm p-3 ${tile.tone === "danger" ? "border-[#FF3B30]/30 bg-[#FF3B30]/10" : tile.tone === "warn" ? "border-[#FFD95A]/30 bg-[#FFD95A]/10" : "border-white/10 bg-[#121212]"}`}
          >
            <div className="text-[10px] uppercase tracking-widest text-white/40">{tile.label}</div>
            <div className="font-display text-2xl font-bold">{tile.value}</div>
            {tile.detail ? <div className="text-[11px] text-white/50 truncate" title={tile.detail}>{tile.detail}</div> : null}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider border ${tab === item.key ? "border-[#29B6E8] text-[#29B6E8] bg-[#29B6E8]/10" : "border-white/10 text-white/60 hover:border-white/30"}`}
          >
            {item.label}
          </button>
        ))}
        {tab === "errors" ? (
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="ml-auto bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" aria-label="Status">
            <option value="open">Offen</option>
            <option value="resolved">Gelöst</option>
            <option value="all">Alle</option>
          </select>
        ) : null}
      </div>

      {tab === "overview" ? (
        <OpsOverview onOpenSource={(source) => setTab("events", source)} />
      ) : tab === "events" ? (
        <OpsEventsTab />
      ) : tab === "app" ? (
        <AppLogsTab />
      ) : tab === "alerts" ? (
        <OpsAlertsPanel />
      ) : tab === "vitals" ? (
        <VitalsTab vitals={vitals} loading={loading} />
      ) : tab === "checks" ? (
        <ChecksTab checks={checks} loading={loading} running={running} onRun={runChecks} />
      ) : tab === "errors" ? (
        <div className="space-y-3">
          {!loading && !errors.length ? (
            <div className="border border-white/10 bg-[#121212] rounded-sm p-6 text-center text-white/50 flex items-center justify-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-[#00FF88]" /> Keine Fehlergruppen {status === "open" ? "offen" : "in dieser Auswahl"}.
            </div>
          ) : null}
          {errors.map((row) => {
            const isExpanded = expanded === row.fingerprint;
            const resolved = Boolean(row.resolved_at);
            return (
              <article key={row.fingerprint} className={`border rounded-sm bg-[#121212] ${resolved ? "border-white/10" : "border-[#FF3B30]/30"}`}>
                <button
                  type="button"
                  onClick={() => setExpanded(isExpanded ? null : row.fingerprint)}
                  aria-expanded={isExpanded}
                  className="w-full text-left p-4 flex flex-col md:flex-row md:items-start gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-sm border ${resolved ? "border-white/10 text-white/50" : "border-[#FF3B30]/40 bg-[#FF3B30]/10 text-[#FF6B61]"}`}>
                        <AlertTriangle className="w-3 h-3" /> {row.error_type}
                      </span>
                      <span className="text-[11px] font-mono text-white/60">{row.method} {row.route}</span>
                      <span className="text-[11px] text-white/40">HTTP {row.status_code}</span>
                    </div>
                    <div className="mt-1 text-sm font-semibold break-words">{row.message || "Ohne Meldung"}</div>
                    <div className="mt-1 text-[11px] text-white/45">
                      {row.count}× · zuerst {formatTime(row.first_seen_at)} · zuletzt {formatTime(row.last_seen_at)} · {row.actor}
                    </div>
                  </div>
                  <div className="font-display text-2xl font-bold text-right md:w-20">{row.count}</div>
                </button>
                {isExpanded ? (
                  <div className="border-t border-white/10 p-4 space-y-3">
                    {row.stack ? (
                      <pre className="text-[11px] leading-relaxed text-white/70 bg-[#0A0A0A] border border-white/10 rounded-sm p-3 overflow-x-auto max-h-96">{row.stack}</pre>
                    ) : (
                      <p className="text-sm text-white/50">Keine Ausnahme – der Server hat diese Antwort bewusst gesendet.</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {resolved ? (
                        <button type="button" onClick={() => setResolved(row, false)} className="inline-flex items-center gap-2 border border-white/10 px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider hover:border-[#29B6E8]/50">
                          <RotateCcw className="w-4 h-4" /> Wieder öffnen
                        </button>
                      ) : (
                        <button type="button" onClick={() => setResolved(row, true)} className="inline-flex items-center gap-2 border border-[#00FF88]/40 bg-[#00FF88]/10 text-[#00FF88] px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
                          <CheckCircle2 className="w-4 h-4" /> Als gelöst markieren
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="border border-white/10 bg-[#121212] rounded-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-white/40 border-b border-white/10">
                  <th className="text-left p-3">Route</th>
                  <th className="text-right p-3">Anfragen</th>
                  <th className="text-right p-3">Ø ms</th>
                  <th className="text-right p-3">p95 ms</th>
                  <th className="text-right p-3">max ms</th>
                </tr>
              </thead>
              <tbody>
                {(slow?.routes || []).map((row) => (
                  <tr key={`${row.method} ${row.route}`} className="border-b border-white/5">
                    <td className="p-3 font-mono text-xs"><span className="text-white/40 mr-2">{row.method}</span>{row.route}</td>
                    <td className="p-3 text-right">{row.count}</td>
                    <td className="p-3 text-right">{row.avg_ms}</td>
                    <td className="p-3 text-right font-semibold">{row.p95_ms}</td>
                    <td className="p-3 text-right">{row.max_ms}</td>
                  </tr>
                ))}
                {!loading && !(slow?.routes || []).length ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-white/50">
                      <span className="inline-flex items-center gap-2"><Gauge className="w-4 h-4 text-[#00FF88]" /> Keine Anfrage über {slow?.threshold_ms ?? 1000} ms in den letzten 24 Stunden.</span>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-white/40">
            Gemessen wird die Zeit im Backend je Anfrage; Bilder und Dateien, die nginx liefert, stehen hier nicht.
          </p>
        </div>
      )}
    </AdminLayout>
  );
}

function toneClass(tone) {
  if (tone === "crit") return "text-[#FF6B61]";
  if (tone === "warn") return "text-[#FFD95A]";
  if (tone === "ok") return "text-[#00FF88]";
  return "text-white/70";
}

// Web Vitals je Route (#265): p75 der letzten sieben Tage, gefärbt nach
// den Schwellen von web.dev; Median und Anzahl im Tooltip.
function VitalsTab({ vitals, loading }) {
  const routes = vitals?.routes || [];
  return (
    <div className="space-y-4" data-testid="ops-vitals">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {VITAL_COLUMNS.map((name) => {
          const metric = vitals?.overall?.[name];
          return (
            <div key={name} className="border border-white/10 bg-[#121212] rounded-sm p-3">
              <div className="text-[10px] uppercase tracking-widest text-white/40">{name} · p75 · alle Seiten</div>
              <div className={`font-display text-2xl font-bold ${toneClass(ratingTone(metric?.rating))}`}>{metric ? formatVital(name, metric.p75) : "–"}</div>
              <div className="text-[11px] text-white/50">{metric ? `${metric.count} Messungen · ${Math.round((metric.good_share || 0) * 100)} % gut` : "keine Messungen"}</div>
            </div>
          );
        })}
      </div>
      <div className="border border-white/10 bg-[#121212] rounded-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-white/40 border-b border-white/10">
              <th className="text-left p-3">Route</th>
              <th className="text-right p-3">Messungen</th>
              {VITAL_COLUMNS.map((name) => <th key={name} className="text-right p-3">{name} p75</th>)}
            </tr>
          </thead>
          <tbody>
            {routes.map((row) => (
              <tr key={row.route} className="border-b border-white/5" data-testid={`ops-vitals-${row.route}`}>
                <td className="p-3 font-mono text-xs">{row.route}</td>
                <td className="p-3 text-right">{row.samples}</td>
                {VITAL_COLUMNS.map((name) => {
                  const metric = row.metrics?.[name];
                  return (
                    <td key={name} className={`p-3 text-right font-semibold ${toneClass(ratingTone(metric?.rating))}`} title={metric ? `Median ${formatVital(name, metric.p50)} · ${metric.count} Messungen · ${RATING_LABELS[metric.rating] || ""}` : ""}>
                      {metric ? formatVital(name, metric.p75) : "–"}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!loading && !routes.length ? (
              <tr>
                <td colSpan={2 + VITAL_COLUMNS.length} className="p-6 text-center text-white/50">
                  <span className="inline-flex items-center gap-2"><Activity className="w-4 h-4 text-[#29B6E8]" /> Noch keine Messwerte – sie kommen von echten Besuchern, anonym, am Ende jedes Besuchs.</span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-white/40">
        LCP: größtes Element sichtbar (gut ≤ 2,5 s). INP: Reaktion auf Eingaben (gut ≤ 200 ms). CLS: Springen des Layouts (gut ≤ 0,1). TTFB: erstes Byte (gut ≤ 0,8 s).
        Werte der letzten {vitals?.days ?? 7} Tage, p75 = drei von vier Besuchen sind so schnell oder schneller. Ohne Adresse, Nutzer oder Cookies, {vitals?.retention_days ?? 30} Tage aufgehoben.
      </p>
    </div>
  );
}

// Auto-Checks (#265): der letzte Lauf als Ampel je Prüfung, sieben Tage Verlauf.
function ChecksTab({ checks, loading, running, onRun }) {
  const latest = checks?.latest;
  const history = checks?.history || [];
  return (
    <div className="space-y-4" data-testid="ops-checks">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-white/60" data-testid="ops-checks-summary">{describeRun(latest)}</p>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          data-testid="ops-checks-run"
          className="inline-flex items-center gap-2 border border-[#29B6E8]/40 bg-[#29B6E8]/10 text-[#29B6E8] px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50"
        >
          <PlayCircle className={`w-4 h-4 ${running ? "animate-pulse" : ""}`} /> Jetzt prüfen
        </button>
      </div>
      <div className="border border-white/10 bg-[#121212] rounded-sm divide-y divide-white/5">
        {(latest?.checks || []).map((check) => (
          <div key={check.key} className="flex items-start gap-3 p-3" data-testid={`ops-check-${check.key}`}>
            <span className="mt-1 w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: TONE_COLORS[check.status] || TONE_COLORS.crit }} aria-label={STATUS_LABELS[check.status] || check.status} />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-bold">{check.label}</span>
                <span className={`text-sm ${toneClass(check.status)}`}>{check.value}</span>
              </div>
              {check.detail ? <div className="text-[11px] text-white/45">{check.detail}</div> : null}
            </div>
          </div>
        ))}
        {!loading && !latest ? (
          <div className="p-6 text-center text-white/50">Noch kein Lauf – der Scheduler prüft alle {checks?.interval_minutes ?? 5} Minuten, oder „Jetzt prüfen“.</div>
        ) : null}
      </div>
      {history.length ? (
        <div className="border border-white/10 bg-[#121212] rounded-sm p-4" data-testid="ops-checks-history">
          <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">Verlauf {checks?.history_days ?? 7} Tage · Läufe mit rot / gelb</div>
          <div className="flex flex-wrap gap-2">
            {history.map((day) => (
              <div key={day.day} className="border border-white/10 rounded-sm px-3 py-2 text-xs">
                <div className="text-white/50">{day.day.slice(5)}</div>
                <div>
                  <span className={day.crit ? "text-[#FF6B61] font-bold" : "text-white/40"}>{day.crit} rot</span>
                  <span className="text-white/30"> · </span>
                  <span className={day.warn ? "text-[#FFD95A] font-bold" : "text-white/40"}>{day.warn} gelb</span>
                  <span className="text-white/30"> · {day.runs} Läufe</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <p className="text-[11px] text-white/40">
        Rote Prüfungen und neue 5xx-Fehlergruppen gehen per Discord-Webhook raus (Einstellungen → Discord), höchstens eine Meldung je Prüfung und Stunde.
      </p>
    </div>
  );
}
