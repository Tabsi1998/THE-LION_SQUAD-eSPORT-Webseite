import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Wallet } from "lucide-react";
import { api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { SkeletonTable } from "@/components/tls/Skeleton";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { PAYMENT_TONE, csvFilename, formatCents, parseEuro, sourcesFrom, summaryLines, syncLine, toCsv } from "@/lib/billing";

// Finanzübersicht (#322): Rechnungsaufträge nach Status - was fehlt, was wartet, was frei zu
// geben ist; angelegte Belege mit ihrem Zahlungsstand aus Dolibarr (#321); Prüffälle, die nur die
// Finanzverwaltung auflöst; Erstattungen, die außerhalb passiert sind und hier festgehalten werden.
// Kein Rechnungsdienst: Belege legt der Dolibarr-Adapter an, Zahlungen bucht Dolibarr.

const STATUS_TONE = {
  pending: "text-white/70", ready: "text-[#00FF88]", invoiced: "text-[#00FF88]",
  waiting_write_access: "text-[#FFD700]", waiting_link: "text-[#FFD700]", waiting_review: "text-[#FFD700]", held: "text-[#29B6E8]",
  failed: "text-[#FF3B30]", cancelled: "text-white/40",
};

const INVOICE_STATUS = { draft: "Entwurf", validated: "freigegeben", paid: "bezahlt", abandoned: "aufgegeben" };
const KIND_LABELS = { "": "Events und Turniere", event: "Events", tournament: "Turniere" };

export default function AdminFinancePage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [thirdpartyInput, setThirdpartyInput] = useState({});
  const [filters, setFilters] = useState({ kind: "", source: "", q: "" });
  const [knownSources, setKnownSources] = useState([]);
  const [detail, setDetail] = useState(null);
  const [caseReason, setCaseReason] = useState({});

  const load = useCallback(() => {
    const params = {};
    if (filters.kind) params.kind = filters.kind;
    if (filters.source) params.source = filters.source;
    if (filters.q.trim()) params.q = filters.q.trim();
    api.get("/admin/finance/overview", { params }).then(({ data: next }) => {
      setData(next);
      setError("");
      setKnownSources((current) => sourcesFrom([...current.map((s) => ({ source_id: s.id, kind: s.kind, source: { name: s.name } })), ...(next.open || []), ...(next.invoiced || [])]));
    }).catch((err) => setError(formatRequestError(err, "Finanzübersicht konnte nicht geladen werden.")));
  }, [filters]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["events", "billing", "dolibarr"]);

  const run = async (key, request, message) => {
    setBusy(key);
    try {
      const result = await request();
      if (message) toast.success(typeof message === "function" ? message(result) : message);
      load();
      if (detail?.order?.id) openDetail(detail.order.id);
      return result;
    } catch (err) {
      toast.error(formatRequestError(err, "Das hat nicht geklappt."));
      return null;
    } finally {
      setBusy("");
    }
  };

  const openDetail = async (orderId) => {
    try {
      const { data: next } = await api.get(`/admin/finance/orders/${orderId}`);
      setDetail(next);
    } catch (err) {
      toast.error(formatRequestError(err, "Details konnten nicht geladen werden."));
    }
  };

  const downloadCsv = () => {
    const csv = toCsv(data?.invoiced || []);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = csvFilename();
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const status = data?.by_status || {};
  const labels = data?.labels || {};
  const paymentLabels = data?.payment_labels || {};
  const waiting = (status.waiting_write_access?.count || 0) + (status.waiting_link?.count || 0) + (status.waiting_review?.count || 0);
  const cases = data?.cases || [];
  const sources = useMemo(() => knownSources.filter((s) => !filters.kind || s.kind === filters.kind), [knownSources, filters.kind]);

  return (
    <AdminLayout>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-black uppercase inline-flex items-center gap-3"><Wallet className="w-7 h-7 text-[#FFD700]" /> Finanzen</h1>
          <p className="mt-2 text-sm text-white/60 max-w-2xl">Rechnungsaufträge aus kostenpflichtigen Anmeldungen. Jede verbindliche Anmeldung mit Preis wird hier zu einem Auftrag; die Rechnung entsteht in Dolibarr, Zahlungen bucht ihr dort – die Website liest nach und meldet, was nicht zusammenpasst.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!!busy} onClick={() => run("run", () => api.post("/admin/finance/orders/run"), "Aufträge einsortiert.")} className="inline-flex items-center gap-2 px-4 py-2 border border-white/20 text-white/80 font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-40" data-testid="finance-run">
            <RefreshCw className="w-3.5 h-3.5" /> Jetzt prüfen
          </button>
          <button type="button" disabled={!!busy} onClick={() => run("reconcile", () => api.post("/admin/finance/reconcile"), (r) => `Abgeglichen: ${r?.data?.looked ?? 0} Belege gelesen, ${r?.data?.cases ?? 0} Prüffälle.`)} className="inline-flex items-center gap-2 px-4 py-2 border border-white/20 text-white/80 font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-40" data-testid="finance-reconcile">
            <RefreshCw className="w-3.5 h-3.5" /> Alles abgleichen
          </button>
          <button type="button" disabled={!data?.invoiced?.length} onClick={downloadCsv} className="inline-flex items-center gap-2 px-4 py-2 border border-white/20 text-white/80 font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-40" data-testid="finance-csv">
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
      </div>

      {error && <div className="mt-6 border border-[#FF3B30]/40 bg-[#FF3B30]/10 rounded-sm p-4 text-sm" data-testid="finance-error">{error}</div>}
      {!data && !error && <SkeletonTable rows={4} columns={5} className="mt-6" label="Lade Finanzübersicht" />}

      {data && (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="finance-summary">
            <Stat label="Wartet auf Voraussetzungen" value={waiting} tone={waiting ? "text-[#FFD700]" : "text-white"} />
            <Stat label="Wartet auf Freigabe" value={status.held?.count || 0} tone="text-[#29B6E8]" />
            <Stat label="Bereit für Dolibarr" value={status.ready?.count || 0} tone="text-[#00FF88]" />
            <Stat label="Gescheitert" value={status.failed?.count || 0} tone={status.failed?.count ? "text-[#FF3B30]" : "text-white"} />
            <Stat label="Prüffälle" value={data.cases_open || 0} tone={data.cases_open ? "text-[#FF3B30]" : "text-white"} testId="finance-cases-count" />
          </div>

          <div className={`mt-4 border rounded-sm p-4 text-sm flex items-start gap-3 ${data.dolibarr?.write_capable ? "border-[#00FF88]/30" : "border-[#FFD700]/40 bg-[#FFD700]/5"}`} data-testid="finance-dolibarr">
            {data.dolibarr?.write_capable ? <CheckCircle2 className="w-4 h-4 text-[#00FF88] mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-[#FFD700] mt-0.5" />}
            <div>
              {data.dolibarr?.write_capable
                ? "Dolibarr ist angebunden und darf Rechnungen anlegen."
                : !data.dolibarr?.connected
                  ? <>Dolibarr ist nicht angebunden – Aufträge bleiben hier stehen. <Link to="/admin/dolibarr" className="text-[#29B6E8] hover:underline">Zur Anbindung</Link></>
                  : <>Für Rechnungen fehlt der Schreibzugriff (eigener Schlüssel unter <Link to="/admin/dolibarr" className="text-[#29B6E8] hover:underline">Dolibarr → Schreibzugriff</Link>). Aufträge bleiben bis dahin hier stehen.</>}
              {data.dolibarr?.write_capable && !data.dolibarr?.terms_complete && (
                <div className="mt-1 text-xs text-[#FFD700]" data-testid="finance-terms-hint">Rechnungskonditionen (Zahlungsziel, Zahlungsart, Bankkonto) fehlen noch – Belege bleiben Entwurf. <Link to="/admin/dolibarr" className="text-[#29B6E8] hover:underline">Unter Dolibarr → Schreibzugriff eintragen</Link>.</div>
              )}
            </div>
          </div>

          {/* Filter (#322): nach Art, Veranstaltung und Person - die Summen unten gelten für die Auswahl. */}
          <div className="mt-6 flex flex-wrap items-end gap-3 text-xs" data-testid="finance-filters">
            <label className="flex flex-col gap-1">
              <span className="uppercase tracking-wider text-white/45 font-bold">Art</span>
              <select value={filters.kind} onChange={(ev) => setFilters((f) => ({ ...f, kind: ev.target.value, source: "" }))} className="bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm" data-testid="finance-filter-kind">
                {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="uppercase tracking-wider text-white/45 font-bold">Veranstaltung</span>
              <select value={filters.source} onChange={(ev) => setFilters((f) => ({ ...f, source: ev.target.value }))} className="bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm min-w-[12rem]" data-testid="finance-filter-source">
                <option value="">Alle</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="uppercase tracking-wider text-white/45 font-bold">Person</span>
              <input value={filters.q} onChange={(ev) => setFilters((f) => ({ ...f, q: ev.target.value }))} placeholder="Name suchen" className="bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm" data-testid="finance-filter-q" />
            </label>
            {(filters.kind || filters.source || filters.q) && (
              <button type="button" onClick={() => setFilters({ kind: "", source: "", q: "" })} className="px-3 py-1.5 border border-white/20 text-white/70 rounded-sm uppercase tracking-wider font-bold" data-testid="finance-filter-clear">Filter löschen</button>
            )}
          </div>

          {data.summary && (
            <div className="mt-4 border border-white/10 rounded-sm bg-[#121212] p-4" data-testid="finance-source-summary">
              <div className="text-[10px] uppercase tracking-[0.25em] text-white/45 font-bold">Summen der Veranstaltung · {data.summary.orders} Aufträge{data.summary.cancelled_orders ? `, ${data.summary.cancelled_orders} storniert` : ""}</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {summaryLines(data.summary).map((line) => (
                  <div key={line.key} data-testid={`finance-sum-${line.key}`}>
                    <div className="font-display font-bold tabular-nums text-white">{line.value}</div>
                    <div className="text-[11px] uppercase tracking-widest text-white/45">{line.label}</div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-white/40">Gutschrift und Erstattung sind zwei Dinge: Die Gutschrift gleicht den Beleg in Dolibarr aus, erstattet ist erst, was ihr hier mit Tag und Referenz festgehalten habt.</p>
            </div>
          )}

          {/* Prüffälle (#321): was die Website nicht selbst auflösen darf. */}
          {!!cases.length && (
            <div className="mt-8" data-testid="finance-cases">
              <h2 className="font-heading text-xl font-black uppercase text-[#FF3B30]">Prüffälle</h2>
              <p className="mt-1 text-xs text-white/45">Hier ist Buchung und Beleg auseinandergelaufen. Die Website ändert nichts still – ihr entscheidet in Dolibarr und erledigt den Fall hier mit Grund.</p>
              <div className="mt-3 space-y-3">
                {cases.map((item) => (
                  <div key={item.id} className="border border-[#FF3B30]/30 bg-[#FF3B30]/5 rounded-sm p-4 text-sm" data-testid={`finance-case-${item.id}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-bold text-white">{item.label} <span className="text-white/50 font-normal">· {item.source?.name || item.source_id} · {item.person || item.user_id} · {item.total}</span></div>
                        <div className="mt-1 text-xs text-white/70">{item.todo}</div>
                        <CaseFacts item={item} />
                      </div>
                      <button type="button" onClick={() => openDetail(item.order_id)} className="text-[11px] uppercase tracking-wider font-bold text-[#29B6E8] hover:underline">Auftrag ansehen</button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input value={caseReason[item.id] || ""} onChange={(ev) => setCaseReason((c) => ({ ...c, [item.id]: ev.target.value }))} placeholder="Grund, z. B. „Gutschrift GA2026-0003 angelegt, 20 € am 24.09. überwiesen“" className="flex-1 min-w-[16rem] bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm text-xs" aria-label="Grund für die Erledigung" data-testid={`finance-case-reason-${item.id}`} />
                      <button type="button" disabled={!!busy || (caseReason[item.id] || "").trim().length < 3} onClick={() => run(`case-${item.id}`, () => api.post(`/admin/finance/cases/${item.id}/resolve`, { reason: caseReason[item.id].trim() }), "Prüffall erledigt.")} className="px-3 py-1.5 border border-[#00FF88]/50 text-[#00FF88] rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40" data-testid={`finance-case-resolve-${item.id}`}>
                        Erledigt
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
                <tr>
                  <th className="text-left px-4 py-3">Angebot</th>
                  <th className="text-left px-4 py-3">Person</th>
                  <th className="text-right px-4 py-3">Betrag</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Aktion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.open.map((row) => (
                  <tr key={row.id} data-testid={`finance-order-${row.id}`}>
                    <td className="px-4 py-3">
                      {row.source?.slug ? <Link to={row.source.kind === "tournament" ? `/tournaments/${row.source.slug}` : `/events/${row.source.slug}`} className="text-white hover:text-[#29B6E8]">{row.source.name}</Link> : row.source?.name || row.source_id}
                      <div className="text-[11px] text-white/40">{new Date(row.created_at).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</div>
                      {Array.isArray(row.invoice_text) && (
                        <InvoiceTextEditor row={row} busy={busy} onSave={(text) => run(`text-${row.id}`, () => api.put(`/admin/finance/orders/${row.id}/text`, { extra_text: text }), "Rechnungstext gespeichert.")} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-white/80">{row.person || row.user_id}</td>
                    <td className="px-4 py-3 text-right font-display font-bold tabular-nums">{row.total}</td>
                    <td className={`px-4 py-3 ${STATUS_TONE[row.status] || "text-white/70"}`}>
                      {labels[row.status] || row.status}
                      {row.note && <div className="text-[11px] text-white/40">{row.note}</div>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.status === "held" && (
                        <button type="button" disabled={!!busy} onClick={() => run(row.id, () => api.post(`/admin/finance/orders/${row.id}/release`), "Auftrag freigegeben.")} className="px-3 py-1.5 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40" data-testid={`finance-release-${row.id}`}>
                          Freigeben
                        </button>
                      )}
                      {row.status === "failed" && (
                        <button type="button" disabled={!!busy} onClick={() => run(row.id, () => api.post(`/admin/finance/orders/${row.id}/retry`), "Auftrag neu gestartet.")} className="px-3 py-1.5 border border-[#FF3B30]/50 text-[#FF3B30] rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40" data-testid={`finance-retry-${row.id}`}>
                          Erneut versuchen
                        </button>
                      )}
                      {(row.status === "waiting_review" || row.status === "waiting_link") && (
                        <div className="flex flex-col items-end gap-1.5" data-testid={`finance-assign-${row.id}`}>
                          <div className="flex items-center gap-1.5">
                            <input value={thirdpartyInput[row.id] || ""} onChange={(ev) => setThirdpartyInput((current) => ({ ...current, [row.id]: ev.target.value }))} inputMode="numeric" placeholder="Nr. in Dolibarr" className="w-28 bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm text-xs" aria-label="Geschäftspartner-Nummer" />
                            <button type="button" disabled={!!busy || !/^\d+$/.test(thirdpartyInput[row.id] || "")} onClick={() => run(row.id, () => api.post(`/admin/finance/orders/${row.id}/thirdparty`, { thirdparty_id: Number(thirdpartyInput[row.id]) }), "Geschäftspartner zugeordnet.")} className="px-3 py-1.5 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">
                              Zuordnen
                            </button>
                          </div>
                          {row.status === "waiting_review" && (
                            <button type="button" disabled={!!busy} onClick={() => run(row.id, () => api.post(`/admin/finance/orders/${row.id}/new-thirdparty`), "Neuer Geschäftspartner angelegt.")} className="text-[11px] uppercase tracking-wider font-bold text-white/60 hover:text-white">
                              Trotzdem neu anlegen
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {!data.open.length && <tr><td colSpan="5" className="text-center py-10 text-white/40">Keine offenen Rechnungsaufträge.</td></tr>}
              </tbody>
            </table>
          </div>

          {!!data.invoiced?.length && (
            <div className="mt-8">
              <h2 className="font-heading text-xl font-black uppercase">Angelegte Rechnungen</h2>
              <p className="mt-1 text-xs text-white/45">Nummer, Freigabe und Zahlungen kommen aus Dolibarr; offene Belege liest die Website alle zehn Minuten nach, bezahlte einmal am Tag. Der Stand daneben sagt, wie frisch das ist.</p>
              <div className="mt-3 border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
                    <tr>
                      <th className="text-left px-4 py-3">Rechnung</th>
                      <th className="text-left px-4 py-3">Angebot</th>
                      <th className="text-left px-4 py-3">Person</th>
                      <th className="text-right px-4 py-3">Betrag</th>
                      <th className="text-left px-4 py-3">Zahlungsstand</th>
                      <th className="text-right px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.invoiced.map((row) => {
                      const sync = syncLine(row);
                      return (
                        <tr key={row.id} data-testid={`finance-invoice-${row.id}`}>
                          <td className="px-4 py-3 font-mono text-white">
                            {row.invoice_ref || "–"}
                            {row.booking_state === "cancelled" && <div className="text-[11px] text-[#FF3B30] font-sans">Buchung storniert</div>}
                          </td>
                          <td className="px-4 py-3 text-white/80">{row.source?.name || row.source_id}</td>
                          <td className="px-4 py-3 text-white/80">{row.person || row.user_id}</td>
                          <td className="px-4 py-3 text-right font-display font-bold tabular-nums">{row.total}</td>
                          <td className="px-4 py-3">
                            <div className={PAYMENT_TONE[row.payment_state] || "text-white/80"} data-testid={`finance-payment-${row.id}`}>
                              {row.payment_label || (row.paid ? "bezahlt" : INVOICE_STATUS[row.invoice_status] || row.invoice_status)}
                              {row.payment_state === "partial" && row.remaining_cents != null && <span className="text-white/50"> · {formatCents(row.remaining_cents, row.currency)} offen</span>}
                              {row.payment_state === "overdue" && row.due_on && <span className="text-white/50"> · fällig {row.due_on}</span>}
                            </div>
                            {(row.credited_cents > 0 || row.refunded_cents > 0) && (
                              <div className="text-[11px] text-white/50">{row.credited_cents > 0 ? `gutgeschrieben ${formatCents(row.credited_cents, row.currency)}` : ""}{row.credited_cents > 0 && row.refunded_cents > 0 ? " · " : ""}{row.refunded_cents > 0 ? `erstattet ${formatCents(row.refunded_cents, row.currency)}` : ""}</div>
                            )}
                            <div className={`text-[11px] ${sync.tone}`}>{sync.text}</div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button type="button" onClick={() => openDetail(row.id)} className="text-[11px] uppercase tracking-wider font-bold text-[#29B6E8] hover:underline" data-testid={`finance-detail-${row.id}`}>Details</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {detail && (
            <OrderDetail detail={detail} busy={busy} paymentLabels={paymentLabels} onClose={() => setDetail(null)}
              onResync={() => run("resync", () => api.post(`/admin/finance/orders/${detail.order.id}/resync`), "In Dolibarr nachgelesen.")}
              onRefund={(payload) => run("refund", () => api.post(`/admin/finance/orders/${detail.order.id}/refunds`, payload), "Erstattung festgehalten.")} />
          )}
        </>
      )}
    </AdminLayout>
  );
}

function CaseFacts({ item }) {
  const d = item.detail || {};
  const bits = [];
  if (d.invoice_ref) bits.push(`Beleg ${d.invoice_ref}`);
  if (d.paid_cents != null && item.kind !== "changed_after_invoice") bits.push(`bezahlt ${formatCents(d.paid_cents)}`);
  if (d.invoiced_cents != null && d.new_total_cents != null) bits.push(`Beleg ${formatCents(d.invoiced_cents)} → jetzt ${formatCents(d.new_total_cents)}`);
  if (d.remote_cents != null) bits.push(`in Dolibarr ${formatCents(d.remote_cents)}`);
  if (d.over_cents != null) bits.push(`zu viel ${formatCents(d.over_cents)}`);
  if (d.reason) bits.push(d.reason);
  if (!bits.length) return null;
  return <div className="mt-1 text-[11px] text-white/50" data-testid={`finance-case-facts-${item.id}`}>{bits.join(" · ")}</div>;
}

// Detail (#322): Positionen, Summen, die Zeitleiste und die zwei Handgriffe, die es nach dem Beleg
// noch gibt - nachlesen und eine Erstattung festhalten. Alles andere passiert in Dolibarr.
function OrderDetail({ detail, busy, paymentLabels, onClose, onResync, onRefund }) {
  const { order, positions = [], sums = {}, timeline = [], cases = [], registration } = detail;
  const [refund, setRefund] = useState({ amount: "", paid_on: new Date().toISOString().slice(0, 10), reference: "", reason: "", case_id: "" });
  const amountCents = parseEuro(refund.amount);
  const openCases = cases.filter((c) => c.status === "open");
  const canRefund = order.status === "invoiced" && (sums.refundable_cents || 0) > 0;
  const refundOk = amountCents != null && amountCents > 0 && amountCents <= (sums.refundable_cents || 0) && refund.reason.trim().length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(refund.paid_on);
  return (
    <div className="mt-8 border border-[#29B6E8]/40 rounded-sm bg-[#121212] p-5" data-testid="finance-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-[#29B6E8] font-bold">Auftrag</div>
          <h2 className="font-heading text-xl font-black uppercase mt-1">{order.source?.name || order.source_id} · {order.person || order.user_id}</h2>
          <div className="text-xs text-white/50 mt-1">
            {order.invoice_ref ? `Beleg ${order.invoice_ref} · ` : ""}{paymentLabels[order.payment_state] || order.status_label}
            {registration ? ` · Anmeldung ${registration.status}${registration.seat_count ? `, ${registration.seat_count} Personen` : ""}` : ""}
          </div>
        </div>
        <div className="flex gap-2">
          {order.status === "invoiced" && (
            <button type="button" disabled={!!busy} onClick={onResync} className="px-3 py-1.5 border border-white/20 text-white/80 rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40" data-testid="finance-resync">In Dolibarr nachlesen</button>
          )}
          <button type="button" onClick={onClose} className="px-3 py-1.5 border border-white/20 text-white/60 rounded-sm text-[11px] font-bold uppercase tracking-wider">Schließen</button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-white/45 font-bold">Positionen (eingefroren)</div>
          <ul className="mt-2 text-sm divide-y divide-white/5">
            {positions.map((line) => (
              <li key={line.key} className="py-1.5 flex justify-between gap-3"><span>{line.label} <span className="text-white/40">× {line.quantity}</span></span><span className="tabular-nums">{formatCents(line.total_cents, order.currency)}</span></li>
            ))}
            <li className="py-1.5 flex justify-between gap-3 font-bold"><span>Summe</span><span className="tabular-nums">{order.total}</span></li>
          </ul>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs" data-testid="finance-detail-sums">
            <div><span className="text-white/45">bezahlt</span> <span className="tabular-nums text-white">{formatCents(sums.paid_cents, order.currency)}</span></div>
            <div><span className="text-white/45">gutgeschrieben</span> <span className="tabular-nums text-white">{formatCents(sums.credited_cents, order.currency)}</span></div>
            <div><span className="text-white/45">erstattet</span> <span className="tabular-nums text-white">{formatCents(sums.refunded_cents, order.currency)}</span></div>
            <div><span className="text-white/45">noch erstattbar</span> <span className="tabular-nums text-white">{formatCents(sums.refundable_cents, order.currency)}</span></div>
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-widest text-white/45 font-bold">Verlauf</div>
          <ol className="mt-2 text-xs space-y-1.5" data-testid="finance-detail-timeline">
            {timeline.map((item, index) => (
              <li key={`${item.at}-${index}`} className="flex gap-3">
                <span className="text-white/40 shrink-0 tabular-nums w-28">{String(item.at).slice(0, 16).replace("T", " ")}</span>
                <span className={item.kind === "error" || item.kind === "case" ? "text-[#FF3B30]" : item.kind === "payment" ? "text-[#00FF88]" : "text-white/80"}>{item.text}</span>
              </li>
            ))}
            {!timeline.length && <li className="text-white/40">Noch nichts passiert.</li>}
          </ol>
        </div>
      </div>

      {canRefund && (
        <div className="mt-5 border-t border-white/10 pt-4" data-testid="finance-refund-form">
          <div className="text-[11px] uppercase tracking-widest text-white/45 font-bold">Erstattung festhalten</div>
          <p className="mt-1 text-xs text-white/50">Erst überweisen (oder bar zurückgeben), dann hier eintragen. Höchstens {formatCents(sums.refundable_cents, order.currency)} – bezahlt abzüglich schon erstattet. Die Gutschrift dazu legt ihr in Dolibarr an.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5 text-xs">
            <input value={refund.amount} onChange={(ev) => setRefund((r) => ({ ...r, amount: ev.target.value }))} placeholder="Betrag, z. B. 20,00" inputMode="decimal" className="bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm" aria-label="Erstattungsbetrag in Euro" />
            <input type="date" value={refund.paid_on} onChange={(ev) => setRefund((r) => ({ ...r, paid_on: ev.target.value }))} className="bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm" aria-label="Tag der Rückzahlung" />
            <input value={refund.reference} onChange={(ev) => setRefund((r) => ({ ...r, reference: ev.target.value }))} placeholder="Referenz (Überweisung, Gutschrift)" className="bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm" aria-label="Referenz der Rückzahlung" />
            <input value={refund.reason} onChange={(ev) => setRefund((r) => ({ ...r, reason: ev.target.value }))} placeholder="Grund (Pflicht)" className="bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm" aria-label="Grund der Rückzahlung" />
            {openCases.length ? (
              <select value={refund.case_id} onChange={(ev) => setRefund((r) => ({ ...r, case_id: ev.target.value }))} className="bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm" aria-label="Prüffall damit erledigen">
                <option value="">Prüffall offen lassen</option>
                {openCases.map((c) => <option key={c.id} value={c.id}>erledigt damit: {c.label}</option>)}
              </select>
            ) : <span />}
          </div>
          <button type="button" disabled={!!busy || !refundOk} onClick={() => onRefund({ amount_cents: amountCents, paid_on: refund.paid_on, reference: refund.reference.trim(), reason: refund.reason.trim(), case_id: refund.case_id || null })} className="mt-2 px-3 py-1.5 border border-[#00FF88]/50 text-[#00FF88] rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40" data-testid="finance-refund-save">
            Erstattung eintragen
          </button>
        </div>
      )}
    </div>
  );
}

// Rechnungstext (#370): so kämen die Zeilen auf den Beleg; ein Zusatztext geht mit, solange
// kein Beleg existiert - danach ist der Text in Dolibarr zu Hause.
function InvoiceTextEditor({ row, busy, onSave }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(row.extra_text || "");
  useEffect(() => { setText(row.extra_text || ""); }, [row.extra_text]);
  return (
    <details className="mt-1 text-[11px]" open={open} onToggle={(ev) => setOpen(ev.currentTarget.open)} data-testid={`finance-text-${row.id}`}>
      <summary className="cursor-pointer text-white/55 hover:text-white uppercase tracking-wider font-bold">Rechnungstext{row.extra_text ? " · mit Zusatz" : ""}</summary>
      <div className="mt-2 space-y-2">
        {row.invoice_text.map((line, index) => (
          <pre key={index} className="whitespace-pre-wrap font-sans text-white/70 border border-white/10 rounded-sm px-2 py-1.5 bg-black/20" data-testid={`finance-text-line-${row.id}-${index}`}>{line}</pre>
        ))}
        <textarea value={text} onChange={(ev) => setText(ev.target.value)} rows={2} maxLength={500} placeholder="Zusatz für die Rechnung, z. B. „inkl. Essen und Getränke“ oder „Tisch 4 reserviert“" className="w-full bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm text-xs" aria-label="Zusatztext für die Rechnung" />
        <button type="button" disabled={!!busy || text.trim() === (row.extra_text || "")} onClick={() => onSave(text)} className="px-3 py-1.5 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40" data-testid={`finance-text-save-${row.id}`}>
          Zusatz speichern
        </button>
      </div>
    </details>
  );
}

function Stat({ label, value, tone = "text-white", testId }) {
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid={testId}>
      <div className={`font-heading text-2xl font-black ${tone}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-widest text-white/45 mt-1">{label}</div>
    </div>
  );
}
