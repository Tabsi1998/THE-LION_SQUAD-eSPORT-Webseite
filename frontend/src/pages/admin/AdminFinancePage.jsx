import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, RefreshCw, Wallet } from "lucide-react";
import { api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { SkeletonTable } from "@/components/tls/Skeleton";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

// Finanzübersicht (#322): Rechnungsaufträge nach Status - was fehlt, was wartet, was frei zu
// geben ist. Kein Rechnungsdienst: Belege legt (Teil 2) der Dolibarr-Adapter an.

const STATUS_TONE = {
  pending: "text-white/70", ready: "text-[#00FF88]", invoiced: "text-[#00FF88]",
  waiting_write_access: "text-[#FFD700]", waiting_link: "text-[#FFD700]", waiting_review: "text-[#FFD700]", held: "text-[#29B6E8]",
  failed: "text-[#FF3B30]", cancelled: "text-white/40",
};

const INVOICE_STATUS = { draft: "Entwurf", validated: "freigegeben", paid: "bezahlt", abandoned: "aufgegeben" };

export default function AdminFinancePage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [thirdpartyInput, setThirdpartyInput] = useState({});

  const load = useCallback(() => {
    api.get("/admin/finance/overview").then(({ data: next }) => { setData(next); setError(""); })
      .catch((err) => setError(formatRequestError(err, "Finanzübersicht konnte nicht geladen werden.")));
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["events", "billing", "dolibarr"]);

  const run = async (key, request, message) => {
    setBusy(key);
    try {
      await request();
      if (message) toast.success(message);
      load();
    } catch (err) {
      toast.error(formatRequestError(err, "Das hat nicht geklappt."));
    } finally {
      setBusy("");
    }
  };

  const status = data?.by_status || {};
  const labels = data?.labels || {};
  const waiting = (status.waiting_write_access?.count || 0) + (status.waiting_link?.count || 0) + (status.waiting_review?.count || 0);

  return (
    <AdminLayout>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-black uppercase inline-flex items-center gap-3"><Wallet className="w-7 h-7 text-[#FFD700]" /> Finanzen</h1>
          <p className="mt-2 text-sm text-white/60 max-w-2xl">Rechnungsaufträge aus kostenpflichtigen Anmeldungen. Jede verbindliche Anmeldung mit Preis wird hier zu einem Auftrag; die Rechnung entsteht in Dolibarr, sobald Schreibzugriff und Geschäftspartner da sind.</p>
        </div>
        <button type="button" disabled={!!busy} onClick={() => run("run", () => api.post("/admin/finance/orders/run"), "Aufträge einsortiert.")} className="inline-flex items-center gap-2 px-4 py-2 border border-white/20 text-white/80 font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-40" data-testid="finance-run">
          <RefreshCw className="w-3.5 h-3.5" /> Jetzt prüfen
        </button>
      </div>

      {error && <div className="mt-6 border border-[#FF3B30]/40 bg-[#FF3B30]/10 rounded-sm p-4 text-sm" data-testid="finance-error">{error}</div>}
      {!data && !error && <SkeletonTable rows={4} columns={5} className="mt-6" label="Lade Finanzübersicht" />}

      {data && (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="finance-summary">
            <Stat label="Wartet auf Voraussetzungen" value={waiting} tone={waiting ? "text-[#FFD700]" : "text-white"} />
            <Stat label="Wartet auf Freigabe" value={status.held?.count || 0} tone="text-[#29B6E8]" />
            <Stat label="Bereit für Dolibarr" value={status.ready?.count || 0} tone="text-[#00FF88]" />
            <Stat label="Gescheitert" value={status.failed?.count || 0} tone={status.failed?.count ? "text-[#FF3B30]" : "text-white"} />
          </div>

          <div className={`mt-4 border rounded-sm p-4 text-sm flex items-start gap-3 ${data.dolibarr?.write_capable ? "border-[#00FF88]/30" : "border-[#FFD700]/40 bg-[#FFD700]/5"}`} data-testid="finance-dolibarr">
            {data.dolibarr?.write_capable ? <CheckCircle2 className="w-4 h-4 text-[#00FF88] mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-[#FFD700] mt-0.5" />}
            <div>
              {data.dolibarr?.write_capable
                ? "Dolibarr ist angebunden und darf Rechnungen anlegen."
                : !data.dolibarr?.connected
                  ? <>Dolibarr ist nicht angebunden – Aufträge bleiben hier stehen. <Link to="/admin/dolibarr" className="text-[#29B6E8] hover:underline">Zur Anbindung</Link></>
                  : <>Für Rechnungen fehlt der Schreibzugriff (eigener Schlüssel unter <Link to="/admin/dolibarr" className="text-[#29B6E8] hover:underline">Dolibarr → Schreibzugriff</Link>). Aufträge bleiben bis dahin hier stehen.</>}
            </div>
          </div>

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
                      {row.source?.slug ? <Link to={`/events/${row.source.slug}`} className="text-white hover:text-[#29B6E8]">{row.source.name}</Link> : row.source?.name || row.source_id}
                      <div className="text-[11px] text-white/40">{new Date(row.created_at).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</div>
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
              <p className="mt-1 text-xs text-white/45">Nummer und Stand kommen aus Dolibarr; Zahlungen bucht ihr dort, die Website liest sie alle zehn Minuten nach.</p>
              <div className="mt-3 border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
                    <tr>
                      <th className="text-left px-4 py-3">Rechnung</th>
                      <th className="text-left px-4 py-3">Angebot</th>
                      <th className="text-left px-4 py-3">Person</th>
                      <th className="text-right px-4 py-3">Betrag</th>
                      <th className="text-left px-4 py-3">Stand</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.invoiced.map((row) => (
                      <tr key={row.id} data-testid={`finance-invoice-${row.id}`}>
                        <td className="px-4 py-3 font-mono text-white">{row.invoice_ref || "–"}</td>
                        <td className="px-4 py-3 text-white/80">{row.source?.name || row.source_id}</td>
                        <td className="px-4 py-3 text-white/80">{row.person || row.user_id}</td>
                        <td className="px-4 py-3 text-right font-display font-bold tabular-nums">{row.total}</td>
                        <td className={`px-4 py-3 ${row.paid ? "text-[#00FF88]" : row.invoice_status === "draft" ? "text-[#FFD700]" : "text-white/80"}`}>
                          {row.paid ? "bezahlt" : INVOICE_STATUS[row.invoice_status] || row.invoice_status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </AdminLayout>
  );
}

function Stat({ label, value, tone = "text-white" }) {
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] p-4">
      <div className={`font-heading text-2xl font-black ${tone}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-widest text-white/45 mt-1">{label}</div>
    </div>
  );
}
