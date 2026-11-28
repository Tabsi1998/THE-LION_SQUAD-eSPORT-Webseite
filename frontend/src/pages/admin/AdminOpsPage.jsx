import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Activity, AlertTriangle, CheckCircle2, Gauge, PlayCircle, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { OpsAlertsPanel } from "./ops/OpsAlertsPanel";
import { OpsEventsTab } from "./ops/OpsEventsTab";
import { FileCleanupsPanel } from "./ops/FileCleanupsPanel";
import { OpsOverview } from "./ops/OpsOverview";
import { AppLogsTab } from "./ops/AppLogsTab";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { RATING_LABELS, STATUS_LABELS, TONE_COLORS, describeRun, formatVital, ratingTone } from "@/lib/ops";
import { formatWhen } from "@/lib/datetime";
import { ShortCaps } from "@/components/tls/ShortCaps";

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
// Fehler-Sammler (#1657): Server, Website und App in einer Liste.
const SOURCE_LABELS = { server: "Server", web: "Website", app: "App" };
const REACH_LABELS = { web: "Website", api: "API", database: "Datenbank" };

/** Die oberste eigene Code-Stelle - statt einer Meldung, die seit #1657 nie gespeichert wird. Im Python-Traceback die
 *  letzte Zeile, im Browser- und App-Stack die erste. */
export function topPlace(row) {
  const lines = String(row?.stack || "").split("\n").filter((line) => line.trim());
  if (!lines.length) return "";
  return (row.source || "server") === "server" ? lines[lines.length - 1] : lines[0];
}

function reachText(key, row) {
  const label = REACH_LABELS[key] || key;
  if (row?.state === "down") return `${label}: weg seit ${formatTime(row.since)}`;
  if (row?.state === "up") return `${label}: läuft`;
  return `${label}: nicht geprüft`;
}

function ReachabilityStrip({ reachability }) {
  if (!reachability?.targets) return null;
  const bad = reachability.overall === "disturbance";
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 border rounded-sm px-3 py-2 tls-type-small ${bad ? "border-warn/40 bg-warn/10" : "border-white/10 bg-[#121212] text-white/60"}`} data-testid="ops-reachability">
      <span className="font-bold uppercase tracking-wider">Erreichbarkeit</span>
      {Object.keys(REACH_LABELS).map((key) => (
        <span key={key} className={reachability.targets[key]?.state === "down" ? "text-warn font-bold" : ""}>{reachText(key, reachability.targets[key])}</span>
      ))}
      <span className="text-white/40">geprüft {formatTime(reachability.checked_at)}</span>
    </div>
  );
}

function formatTime(value) {
  if (!value) return "-";
  try {
    return formatWhen(value);
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
  // `extra.state` (#2447): „open“ öffnet die Ereignisse mit nur den offenen Einträgen - der Tipp auf eine Kachel.
  const setTab = (next, source = null, extra = {}) => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next === "overview") params.delete("tab");
      else params.set("tab", next);
      if (source && source !== "all") params.set("source", source);
      else params.delete("source");
      if (extra.state) params.set("state", extra.state);
      else params.delete("state");
      return params;
    }, { replace: true });
  };
  const [status, setStatus] = useState("open");
  // Quelle und Suche (#1657); ?q= kommt von der Fehlerseite mit der Kennung der Gruppe.
  const [source, setSource] = useState("all");
  const [search, setSearch] = useState(() => searchParams.get("q") || "");
  const [searchDraft, setSearchDraft] = useState(() => searchParams.get("q") || "");
  const [summary, setSummary] = useState(null);
  const [errors, setErrors] = useState([]);
  const [slow, setSlow] = useState(null);
  const [vitals, setVitals] = useState(null);
  const [checks, setChecks] = useState(null);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState([]);
  const [resolvingMany, setResolvingMany] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryResult, errorsResult, slowResult, vitalsResult, checksResult] = await Promise.all([
        api.get("/admin/ops/summary"),
        api.get(`/admin/ops/errors?status=${status}&limit=200&source=${source}${search ? `&q=${encodeURIComponent(search)}` : ""}`),
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
  }, [status, source, search]);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ["admin/ops"], { pollMs: 30000 });

  // Jetzt neu prüfen (#2447): ein Lauf zur Zeit (Doppelklick sperrt der Ref, bevor React neu zeichnet), der Server
  // drosselt zusätzlich. Die Ampel oben zeigt das Ergebnis sofort, nicht erst nach dem nächsten Laden.
  const runningRef = useRef(false);
  const runChecks = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    try {
      const { data } = await api.post("/admin/ops/checks/run");
      setChecks((current) => ({ ...(current || {}), latest: data }));
      setSummary((current) => ({ ...(current || {}), checks: { at: data?.at, status: data?.status, counts: data?.counts || {}, failing: data?.failing || [] } }));
      toast.success(data?.status === "ok" ? "Alle Prüfungen grün." : `Lauf fertig: ${STATUS_LABELS[data?.status] || data?.status}.`);
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  const setResolved = async (row, resolved) => {
    try {
      const { data } = await api.post(`/admin/ops/errors/${row.fingerprint}/${resolved ? "resolve" : "reopen"}`);
      setErrors((items) => items.map((item) => (item.fingerprint === row.fingerprint ? data : item)));
      setPicked((current) => current.filter((value) => value !== row.fingerprint));
      toast.success(resolved ? "Als gelöst markiert." : "Wieder geöffnet.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  // Mehrfachauswahl (#2447): „Ausgewählte als gelöst“ in einem Schritt.
  const togglePicked = (fingerprint) => setPicked((current) => (current.includes(fingerprint) ? current.filter((value) => value !== fingerprint) : [...current, fingerprint]));
  const openErrors = errors.filter((row) => !row.resolved_at);
  const resolvePicked = async () => {
    if (resolvingMany || !picked.length) return;
    setResolvingMany(true);
    try {
      const { data } = await api.post("/admin/ops/errors/resolve", { fingerprints: picked });
      const byFingerprint = new Map((data?.items || []).map((item) => [item.fingerprint, item]));
      setErrors((items) => items.map((item) => byFingerprint.get(item.fingerprint) || item));
      setPicked([]);
      toast.success(`${data?.resolved ?? 0} ${Number(data?.resolved) === 1 ? "Fehlergruppe" : "Fehlergruppen"} als gelöst markiert.`);
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setResolvingMany(false);
    }
  };

  const tiles = useMemo(() => [
    { label: "Fehlergruppen offen", value: summary?.open_error_groups ?? "–", tone: (summary?.open_error_groups || 0) > 0 ? "danger" : "ok" },
    { label: "Fehlergruppen 24 h", value: summary?.error_groups_24h ?? "–", tone: (summary?.error_groups_24h || 0) > 0 ? "warn" : "ok" },
    // Datei-Uploads (#2447) zählen nicht als langsam - die Kachel sagt, wie viele draußen blieben.
    { label: `Langsam (> ${summary?.threshold_ms ?? 1000} ms) 24 h`, value: summary?.slow_requests_24h ?? "–", tone: (summary?.slow_requests_24h || 0) > 20 ? "warn" : "ok",
      detail: summary?.slow_uploads_24h ? `ohne ${summary.slow_uploads_24h} Datei-Upload${summary.slow_uploads_24h === 1 ? "" : "s"}` : undefined },
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
          <span className="tls-type-label text-[#29B6E8]">System</span>
          <h1 className="tls-type-title mt-1" data-testid="ops-title"><ShortCaps>Betrieb & Logs</ShortCaps></h1>
          <p className="tls-type-body text-white/55 mt-2 max-w-2xl">
            Alles, was der Betrieb meldet, an einem Ort: Fehler aus Server, Website und App, Auto-Checks, Alarme, App-Logs, E-Mail-Versand,
            Adminaktionen und Abgleiche. Ohne Namen, Adressen oder Tokens; Aufbewahrung unter Alarme.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex min-h-[44px] items-center gap-2 border border-white/10 bg-[#121212] px-3 py-2 rounded-sm tls-type-label hover:border-[#29B6E8]/50"
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
            <div className="tls-type-label text-quiet">{tile.label}</div>
            <div className="tls-type-section tls-type-num">{tile.value}</div>
            {tile.detail ? <div className="tls-type-small text-white/50 truncate" title={tile.detail}>{tile.detail}</div> : null}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`min-h-[44px] px-3 py-2 rounded-sm tls-type-label border ${tab === item.key ? "border-[#29B6E8] text-[#29B6E8] bg-[#29B6E8]/10" : "border-white/10 text-white/60 hover:border-white/30"}`}
          >
            {item.label}
          </button>
        ))}
        {tab === "errors" ? (
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="ml-auto min-h-[44px] bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" aria-label="Status">
            <option value="open">Offen</option>
            <option value="resolved">Gelöst</option>
            <option value="all">Alle</option>
          </select>
        ) : null}
      </div>

      {tab === "overview" ? (
        <OpsOverview onOpenSource={(source, extra) => setTab("events", source, extra)} />
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
        <div className="space-y-3" data-testid="ops-errors">
          <ReachabilityStrip reachability={summary?.reachability} />
          <form
            className="flex flex-col sm:flex-row gap-2"
            onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); }}
            role="search"
          >
            <select value={source} onChange={(event) => setSource(event.target.value)} data-testid="ops-errors-source" aria-label="Quelle"
              className="min-h-[44px] bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              <option value="all">Alle Quellen</option>
              <option value="server">Server</option>
              <option value="web">Website</option>
              <option value="app">App</option>
            </select>
            <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} data-testid="ops-errors-search" aria-label="Suche"
              placeholder="Fehlerart, Seite, Stelle oder Kennung" maxLength={80}
              className="min-h-[44px] flex-1 min-w-0 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            <button type="submit" className="min-h-[44px] px-4 border border-white/10 rounded-sm tls-type-label hover:border-[#29B6E8]/50">Suchen</button>
          </form>
          {/* Mehrfachauswahl (#2447): offene Gruppen ankreuzen, dann „Ausgewählte als gelöst“. */}
          {openErrors.length ? (
            <div className="flex flex-wrap items-center gap-2 border border-white/10 bg-[#121212] rounded-sm p-2" data-testid="ops-errors-bulk">
              <label className="inline-flex min-h-[44px] items-center gap-3 px-2 tls-type-label text-white/60 cursor-pointer">
                <input
                  type="checkbox"
                  checked={picked.length > 0 && picked.length === openErrors.length}
                  ref={(node) => { if (node) node.indeterminate = picked.length > 0 && picked.length < openErrors.length; }}
                  onChange={(event) => setPicked(event.target.checked ? openErrors.map((row) => row.fingerprint) : [])}
                  data-testid="ops-errors-pick-all"
                  className="h-5 w-5 accent-ok"
                />
                {picked.length ? `${picked.length} ausgewählt` : "Alle offenen auswählen"}
              </label>
              <button
                type="button"
                onClick={resolvePicked}
                disabled={!picked.length || resolvingMany}
                data-testid="ops-errors-resolve-picked"
                className="ml-auto inline-flex min-h-[44px] items-center gap-2 border border-ok/40 bg-ok/10 text-ok px-3 rounded-sm tls-type-label disabled:opacity-40"
              >
                <CheckCircle2 className="w-4 h-4" /> {resolvingMany ? "Markiere …" : "Ausgewählte als gelöst"}
              </button>
            </div>
          ) : null}
          {!loading && !errors.length ? (
            <div className="border border-white/10 bg-[#121212] rounded-sm p-6 text-center text-white/50 flex items-center justify-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-ok" /> {status === "open" ? "Alles erledigt – keine Fehlergruppe offen." : "Keine Fehlergruppen in dieser Auswahl."}
            </div>
          ) : null}
          {errors.map((row) => {
            const isExpanded = expanded === row.fingerprint;
            const resolved = Boolean(row.resolved_at);
            const isPicked = picked.includes(row.fingerprint);
            const isClient = row.source === "web" || row.source === "app";
            return (
              <article key={row.fingerprint} className={`border rounded-sm bg-[#121212] ${resolved ? "border-white/10" : isPicked ? "border-ok/40" : "border-warn/30"}`} data-testid={`ops-error-${row.fingerprint}`}>
                <div className="flex flex-col md:flex-row md:items-stretch">
                  <div className="flex flex-1 min-w-0 items-start">
                    {!resolved ? (
                      <label className="flex min-h-[44px] min-w-[44px] shrink-0 items-start justify-center pt-4 pl-2 cursor-pointer" title="Auswählen">
                        <input type="checkbox" checked={isPicked} onChange={() => togglePicked(row.fingerprint)} aria-label={`${row.error_type} auf ${row.route} auswählen`}
                          data-testid={`ops-error-pick-${row.fingerprint}`} className="h-5 w-5 accent-ok" />
                      </label>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setExpanded(isExpanded ? null : row.fingerprint)}
                      aria-expanded={isExpanded}
                      className="flex-1 min-w-0 text-left p-4 flex flex-col md:flex-row md:items-start gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center gap-1 tls-type-label px-2 py-0.5 rounded-sm border ${resolved ? "border-white/10 text-white/50" : "border-warn/40 bg-warn/10 text-warn"}`}>
                            <AlertTriangle className="w-3 h-3" /> {row.error_type}
                          </span>
                          {SOURCE_LABELS[row.source] && row.source !== "server" ? (
                            <span className="tls-type-label px-2 py-0.5 rounded-sm border border-brand/40 text-brand">{SOURCE_LABELS[row.source]}</span>
                          ) : null}
                          <span className="tls-type-small font-mono text-white/60 break-all">{`${row.method || ""} ${row.route || ""}`.trim()}</span>
                          {isClient ? null : <span className="tls-type-small text-quiet">HTTP {row.status_code}</span>}
                        </div>
                        <div className="mt-1 tls-type-small font-semibold break-words font-mono">{row.message || topPlace(row) || "Ohne Stelle"}</div>
                        <div className="mt-1 tls-type-small text-white/45">
                          {row.count}× · zuerst {formatTime(row.first_seen_at)} · zuletzt {formatTime(row.last_seen_at)}{isClient ? "" : ` · ${row.actor || ""}`}
                          {row.version ? ` · Version ${row.version}` : ""}
                          {resolved ? ` · gelöst ${formatTime(row.resolved_at)}` : ""}
                        </div>
                      </div>
                      <div className="tls-type-section tls-type-num text-right md:w-16">{row.count}</div>
                    </button>
                  </div>
                  {/* Direkt in der Zeile (#2447) - ohne Aufklappen. */}
                  <div className="flex shrink-0 items-start gap-2 px-4 pb-4 md:pt-4 md:pl-0">
                    {resolved ? (
                      <button type="button" onClick={() => setResolved(row, false)} data-testid={`ops-error-reopen-${row.fingerprint}`}
                        className="inline-flex min-h-[44px] w-full md:w-auto items-center justify-center gap-2 border border-white/10 px-3 rounded-sm tls-type-label hover:border-[#29B6E8]/50">
                        <RotateCcw className="w-4 h-4" /> Wieder öffnen
                      </button>
                    ) : (
                      <button type="button" onClick={() => setResolved(row, true)} data-testid={`ops-error-resolve-${row.fingerprint}`}
                        className="inline-flex min-h-[44px] w-full md:w-auto items-center justify-center gap-2 border border-ok/40 bg-ok/10 text-ok px-3 rounded-sm tls-type-label">
                        <CheckCircle2 className="w-4 h-4" /> Als gelöst markieren
                      </button>
                    )}
                  </div>
                </div>
                {isExpanded ? (
                  <div className="border-t border-white/10 p-4">
                    {row.stack ? (
                      <pre className="tls-type-small leading-relaxed text-white/70 bg-[#0A0A0A] border border-white/10 rounded-sm p-3 tls-swipe max-h-96">{row.stack}</pre>
                    ) : (
                      <p className="tls-type-small text-white/50">{isClient ? "Ohne Code-Stelle – der Browser hat keine mitgeschickt." : "Keine Ausnahme – der Server hat diese Antwort bewusst gesendet."}</p>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
          {errors.length ? (
            <p className="tls-type-small text-quiet">Die Prüfung „Fehlergruppen“ unter Checks zählt nur die offenen Gruppen des Servers – nach dem Lösen dort „Jetzt neu prüfen“, damit die Ampel gleich stimmt. Website und App stehen hier, färben die Ampel aber nicht.</p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="border border-white/10 bg-[#121212] rounded-sm tls-swipe pb-0">
            <table className="w-full tls-type-small">
              <thead>
                <tr className="tls-type-label text-quiet border-b border-white/10">
                  <th className="text-left p-3">Route</th>
                  <th className="text-right p-3">Anfragen</th>
                  <th className="text-right p-3">Ø ms</th>
                  <th className="text-right p-3">p95 ms</th>
                  <th className="text-right p-3">max ms</th>
                </tr>
              </thead>
              <tbody>
                {(slow?.routes || []).map((row) => (
                  <tr key={`${row.method} ${row.route}`} className={`border-b border-white/5 ${row.upload ? "text-white/50" : ""}`} data-testid={`ops-slow-${row.method}-${row.route}`}>
                    <td className="p-3 font-mono tls-type-small">
                      <span className="text-white/40 mr-2">{row.method}</span>{row.route}
                      {row.upload ? <span className="ml-2 rounded-sm border border-[#29B6E8]/40 px-1.5 py-0.5 font-sans tls-type-label text-[#29B6E8]">Upload</span> : null}
                    </td>
                    <td className="p-3 text-right">{row.count}</td>
                    <td className="p-3 text-right">{row.avg_ms}</td>
                    <td className="p-3 text-right font-semibold">{row.p95_ms}</td>
                    <td className="p-3 text-right">{row.max_ms}</td>
                  </tr>
                ))}
                {!loading && !(slow?.routes || []).length ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-white/50">
                      <span className="inline-flex items-center gap-2"><Gauge className="w-4 h-4 text-ok" /> Keine Anfrage über {slow?.threshold_ms ?? 1000} ms in den letzten 24 Stunden.</span>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="tls-type-small text-quiet">
            Gemessen wird die Zeit im Backend je Anfrage; Bilder und Dateien, die nginx liefert, stehen hier nicht. Datei-Uploads (Kennzeichen „Upload“)
            dauern so lange wie die Leitung des Hochladenden – sie stehen am Ende und zählen nicht als langsam (Liste unter Alarme).
          </p>
        </div>
      )}
    </AdminLayout>
  );
}

function toneClass(tone) {
  if (tone === "crit") return "text-[#FF6B61]";
  if (tone === "warn") return "text-[#FFD95A]";
  if (tone === "ok") return "text-ok";
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
              <div className="tls-type-small text-quiet">{name} · p75 · alle Seiten</div>
              <div className={`tls-type-section tls-type-num ${toneClass(ratingTone(metric?.rating))}`}>{metric ? formatVital(name, metric.p75) : "–"}</div>
              <div className="tls-type-small text-white/50">{metric ? `${metric.count} Messungen · ${Math.round((metric.good_share || 0) * 100)} % gut` : "keine Messungen"}</div>
            </div>
          );
        })}
      </div>
      <div className="border border-white/10 bg-[#121212] rounded-sm tls-swipe pb-0">
        <table className="w-full tls-type-small">
          <thead>
            <tr className="tls-type-small text-quiet border-b border-white/10">
              <th className="text-left p-3">Route</th>
              <th className="text-right p-3">Messungen</th>
              {VITAL_COLUMNS.map((name) => <th key={name} className="text-right p-3">{name} p75</th>)}
            </tr>
          </thead>
          <tbody>
            {routes.map((row) => (
              <tr key={row.route} className="border-b border-white/5" data-testid={`ops-vitals-${row.route}`}>
                <td className="p-3 font-mono tls-type-small">{row.route}</td>
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
      <p className="tls-type-small text-quiet">
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
        <p className="tls-type-small text-white/60" data-testid="ops-checks-summary">{describeRun(latest)}</p>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          data-testid="ops-checks-run"
          aria-busy={running}
          className="inline-flex min-h-[44px] items-center gap-2 border border-[#29B6E8]/40 bg-[#29B6E8]/10 text-[#29B6E8] px-3 py-2 rounded-sm tls-type-label disabled:opacity-50"
        >
          <PlayCircle className={`w-4 h-4 ${running ? "animate-pulse" : ""}`} /> {running ? "Prüfe …" : "Jetzt neu prüfen"}
        </button>
      </div>
      <div className="border border-white/10 bg-[#121212] rounded-sm divide-y divide-white/5">
        {(latest?.checks || []).map((check) => (
          <div key={check.key} className="flex items-start gap-3 p-3" data-testid={`ops-check-${check.key}`}>
            <span className="mt-1 w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: TONE_COLORS[check.status] || TONE_COLORS.crit }} aria-label={STATUS_LABELS[check.status] || check.status} />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-bold">{check.label}</span>
                <span className={`tls-type-small ${toneClass(check.status)}`}>{check.value}</span>
              </div>
              {check.detail ? <div className="tls-type-small text-white/45">{check.detail}</div> : null}
            </div>
          </div>
        ))}
        {!loading && !latest ? (
          <div className="p-6 text-center text-white/50">Noch kein Lauf – der Scheduler prüft alle {checks?.interval_minutes ?? 5} Minuten, oder „Jetzt neu prüfen“.</div>
        ) : null}
      </div>
      <FileCleanupsPanel onChanged={onRun} />
      {history.length ? (
        <div className="border border-white/10 bg-[#121212] rounded-sm p-4" data-testid="ops-checks-history">
          <div className="tls-type-small text-quiet mb-2">Verlauf {checks?.history_days ?? 7} Tage · Läufe mit rot / gelb</div>
          <div className="flex flex-wrap gap-2">
            {history.map((day) => (
              <div key={day.day} className="border border-white/10 rounded-sm px-3 py-2 tls-type-small">
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
      <p className="tls-type-small text-quiet">
        Rote Prüfungen und neue 5xx-Fehlergruppen schickt der Discord-Bot in den Betriebskanal (Verbindungen → Discord), höchstens eine Meldung je Prüfung und Stunde.
      </p>
    </div>
  );
}
