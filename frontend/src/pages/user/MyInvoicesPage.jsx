import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CreditCard, Eye, FileText, Receipt } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { DocumentViewer } from "@/components/tls/DocumentViewer";
import { SkeletonTable } from "@/components/tls/Skeleton";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { amountLine, dueLine, filterInvoices, invoiceLine, outageText, sourceFilters, sourceLine, splitInvoices, STATE_FILTERS, STATUS_TONES, summaryText } from "@/lib/invoices";

// Meine Rechnungen (#296): eigene Belege aus Dolibarr – offen oben, Archiv darunter, PDF im
// gemeinsamen Betrachter (#325), bezahlen über Dolibarrs Zahlungsseite. Der Server prüft im
// Moment des Klicks, ob der Beleg noch offen ist. Seit #320 für alle Konten: Nicht-Mitglieder
// sehen ihre Event- und Turnierrechnungen, jeder Beleg trägt seinen Vorgang, Filter nach Quelle
// und Stand gibt es, sobald es mehr als eine Quelle gibt.

const TONE_CLASSES = {
  info: "border-[#29B6E8]/50 text-[#29B6E8]",
  warn: "border-[#FFD700]/60 text-[#FFD700]",
  ok: "border-[#00FF88]/40 text-[#00FF88]",
  muted: "border-white/15 text-white/50",
};

export default function MyInvoicesPage() {
  useDocumentTitle("Meine Rechnungen", "Deine Rechnungen und Belege aus der Mitgliederverwaltung.", { robots: "noindex, nofollow" });
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState(null);
  const [source, setSource] = useState("all");
  const [state, setState] = useState("all");

  const load = useCallback(() => {
    api.get("/account/invoices").then(({ data: result }) => { setData(result); setError(""); })
      .catch((err) => setError(formatRequestError(err, "Rechnungen konnten nicht geladen werden.")));
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["membership", "account/invoices"]);

  const pay = async (row) => {
    // Der Server prüft im Moment des Klicks (eigener Beleg, noch offen, zulässiges Ziel) und nennt das Ziel.
    try {
      const { data: result } = await api.post(`/account/invoices/${row.key}/pay`);
      if (result?.url) window.location.assign(result.url);
      else toast.error("Die Zahlungsseite konnte nicht geöffnet werden.");
    } catch (err) {
      toast.error(formatRequestError(err, "Bezahlen ist gerade nicht möglich."));
      load();
    }
  };

  const sources = sourceFilters(data);
  const groups = splitInvoices(filterInvoices(data?.invoices, source, state));
  const back = data?.member === false ? { to: "/profile", label: "Mein Profil" } : { to: "/members/membership", label: "Meine Mitgliedschaft" };
  const currency = data?.currency || "EUR";
  const outage = outageText(data);

  return (
    <PublicLayout>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link to={back.to} className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-white/50 hover:text-[#FFD700]">
          <ArrowLeft className="w-3.5 h-3.5" /> {back.label}
        </Link>
        <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-6 inline-flex items-center gap-3"><Receipt className="w-7 h-7 text-[#FFD700]" /> Meine Rechnungen</h1>

        {error && <div className="mt-6 border border-[#FF3B30]/40 bg-[#FF3B30]/10 rounded-sm p-4 text-sm" data-testid="invoices-error">{error}</div>}
        {!data && !error && <SkeletonTable rows={4} columns={4} className="mt-6" label="Lade Belege" />}
        {data && (
          <>
            <div className="mt-6 border border-white/10 bg-[#121212] rounded-sm p-5 text-sm text-white/80" data-testid="invoices-summary">{summaryText(data)}</div>
            {outage && <div className="mt-3 border border-[#FFD700]/40 bg-[#FFD700]/10 rounded-sm p-4 text-sm text-white/80" data-testid="invoices-outage">{outage}</div>}
            {(sources.length > 0 || (data.invoices || []).length > 1) && (
              <div className="mt-5 flex flex-wrap items-center gap-2" data-testid="invoices-filters">
                {sources.map((item) => <Chip key={item.key} active={source === item.key} onClick={() => setSource(item.key)} testId={`invoices-source-${item.key}`}>{item.label}</Chip>)}
                {sources.length > 0 && <span className="w-px h-5 bg-white/10 mx-1" aria-hidden="true" />}
                {STATE_FILTERS.map((item) => <Chip key={item.key} active={state === item.key} onClick={() => setState(item.key)} testId={`invoices-state-${item.key}`}>{item.label}</Chip>)}
              </div>
            )}
            {groups.open.length === 0 && groups.archive.length === 0 && (data.invoices || []).length > 0 && (
              <div className="mt-6 text-sm text-white/50" data-testid="invoices-filter-empty">Nichts in dieser Auswahl – ändere den Filter oben.</div>
            )}

            {groups.open.length > 0 && (
              <div className="mt-8">
                <h2 className="font-heading text-lg font-black uppercase mb-3">Offen</h2>
                <div className="space-y-3">{groups.open.map((row) => <InvoiceRow key={row.key} row={row} currency={currency} onView={setViewing} onPay={pay} />)}</div>
              </div>
            )}
            {groups.archive.length > 0 && (
              <div className="mt-8">
                <h2 className="font-heading text-lg font-black uppercase mb-3">Archiv</h2>
                <div className="space-y-3">{groups.archive.map((row) => <InvoiceRow key={row.key} row={row} currency={currency} onView={setViewing} onPay={pay} />)}</div>
              </div>
            )}
            <p className="mt-8 text-xs text-white/40">Rechnungen kommen aus der Mitgliederverwaltung des Vereins. Stimmt etwas nicht, melde dich beim Kassier.</p>
          </>
        )}
      </section>
      {viewing && (
        <DocumentViewer
          path={`/account/invoices/${viewing.key}/pdf`}
          downloadPath={`/account/invoices/${viewing.key}/pdf?download=1`}
          title={`${viewing.type_label} ${viewing.ref}`}
          subtitle={amountLine(viewing, currency)}
          onClose={() => setViewing(null)}
        />
      )}
    </PublicLayout>
  );
}

function InvoiceRow({ row, currency, onView, onPay }) {
  const tone = TONE_CLASSES[STATUS_TONES[row.status] || "muted"];
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] p-4 flex flex-col sm:flex-row sm:items-center gap-3" data-testid={`invoice-${row.key}`}>
      <div className="w-11 h-11 shrink-0 rounded-sm border border-white/10 flex items-center justify-center"><FileText className="w-5 h-5 text-white/60" /></div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-heading font-bold">{row.ref}</span>
          <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 border rounded-sm ${tone}`}>{row.status_label}</span>
        </div>
        <div className="text-xs text-white/55 mt-0.5">{invoiceLine(row)}</div>
        {sourceLine(row) && <div className="text-xs text-white/75 mt-0.5" data-testid={`invoice-source-${row.key}`}>{sourceLine(row)}</div>}
        <div className="text-sm text-white/85 mt-1">{amountLine(row, currency)}</div>
        {dueLine(row) && <div className="text-xs text-white/45">{dueLine(row)}</div>}
      </div>
      <div className="flex gap-2 shrink-0">
        <button type="button" onClick={() => onView(row)} data-testid={`invoice-view-${row.key}`} className="inline-flex items-center gap-2 px-3 py-2 border border-white/15 text-white/80 hover:text-white font-bold uppercase tracking-wider text-xs rounded-sm"><Eye className="w-3.5 h-3.5" /> Ansehen</button>
        {row.can_pay && (
          <button type="button" onClick={() => onPay(row)} data-testid={`invoice-pay-${row.key}`} className="inline-flex items-center gap-2 px-3 py-2 bg-[#FFD700] text-black font-bold uppercase tracking-wider text-xs rounded-sm"><CreditCard className="w-3.5 h-3.5" /> Bezahlen</button>
        )}
      </div>
    </div>
  );
}

function Chip({ active, onClick, testId, children }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} aria-pressed={active} className={`px-3 py-1.5 border rounded-sm text-[11px] font-bold uppercase tracking-wider ${active ? "border-[#FFD700]/60 text-[#FFD700] bg-[#FFD700]/10" : "border-white/15 text-white/55 hover:text-white"}`}>
      {children}
    </button>
  );
}
