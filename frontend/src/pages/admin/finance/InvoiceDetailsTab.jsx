import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { InvoiceTermsPanel } from "@/components/tls/InvoiceTermsPanel";
import { viennaDate } from "@/lib/vienna";

// Rechnungsangaben (#1358): der Kassier pflegt Zahlungsziel, Zahlungsart, Bankkonto, Sprache der PDFs, „Steuersätze
// geprüft“ und „Rechnungen gleich freigeben“ selbst - über einen schmalen Weg mit dem Bereich Finanzen. Die Listen kommen
// weiter aus Dolibarr; Adresse, Schlüssel, Modus und der Schalter „Rechnungen schreiben“ bleiben beim System.

const PROFILE_LABELS = { none: "ohne Umsatzsteuer", standard: "Normalsatz", reduced: "ermäßigt" };

export function InvoiceDetailsTab({ onSaved }) {
  const [details, setDetails] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    api.get("/admin/finance/invoice-details").then(({ data }) => { setDetails(data); setError(""); })
      .catch((failure) => setError(formatRequestError(failure, "Die Rechnungsangaben lassen sich gerade nicht laden.")));
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (payload, success) => {
    setBusy("save");
    try {
      const { data } = await api.put("/admin/finance/invoice-details", payload);
      setDetails(data);
      toast.success(success);
      onSaved?.();
    } catch (failure) {
      toast.error(formatRequestError(failure, "Speichern hat nicht geklappt."));
    } finally {
      setBusy("");
    }
  };

  if (error) return <div className="mt-6 border border-[#FF3B30]/40 bg-[#FF3B30]/10 rounded-sm p-4 text-sm" data-testid="invoice-details-error">{error}</div>;
  if (!details) return <div className="mt-6 text-sm text-white/45" role="status">Lade Rechnungsangaben …</div>;

  const ready = Boolean(details.terms?.complete && details.tax_confirmed);
  return (
    <div className="mt-6 space-y-4 max-w-4xl" data-testid="invoice-details">
      <div className={`border rounded-sm p-4 text-sm ${details.write_capable ? "border-[#00FF88]/30" : "border-[#FF9500]/40 bg-[#FF9500]/5"}`} data-testid="invoice-details-write">
        {details.write_capable
          ? "Rechnungen schreiben ist an: die Website legt Belege in Dolibarr an."
          : details.connected
            ? "Rechnungen schreiben ist aus – das schaltet System unter Dolibarr → Funktionen ein. Die Angaben hier gelten ab dann."
            : "Dolibarr ist noch nicht angebunden – das richtet System ein. Die Angaben hier gelten ab dann."}
      </div>

      <section className="border border-white/10 bg-[#121212] rounded-sm p-4 space-y-3" data-testid="invoice-details-tax">
        <div className="text-xs font-bold uppercase tracking-wider text-white/70">Steuersätze je Profil</div>
        <div className="text-sm text-white/65 flex flex-wrap gap-x-4 gap-y-1">
          {Object.entries(details.tax_rates || {}).map(([profile, rate]) => (
            <span key={profile}>{PROFILE_LABELS[profile] || profile}: <span className="text-white tabular-nums">{Number(rate).toLocaleString("de-AT")} %</span></span>
          ))}
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={Boolean(details.tax_confirmed)} disabled={!!busy}
            onChange={(event) => save({ tax_confirmed: event.target.checked }, event.target.checked ? "Steuersätze als geprüft gemerkt." : "Bestätigung zurückgenommen – Belege bleiben Entwurf.")}
            data-testid="invoice-details-tax-confirmed" />
          <span>
            Steuersätze geprüft (Kassier oder Steuerberatung)
            {details.tax_confirmed?.at && <span className="block text-xs text-white/45" data-testid="invoice-details-tax-by">{details.tax_confirmed.by || "bestätigt"} am {viennaDate(details.tax_confirmed.at)}</span>}
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={Boolean(details.invoice_auto_validate)} disabled={!!busy || (!details.invoice_auto_validate && !ready)}
            onChange={(event) => save({ invoice_auto_validate: event.target.checked }, event.target.checked ? "Rechnungen werden gleich freigegeben." : "Rechnungen bleiben Entwurf zur Prüfung.")}
            data-testid="invoice-details-auto-validate" />
          <span>
            Rechnungen gleich freigeben (sonst Entwurf zur Prüfung in Dolibarr)
            {!ready && <span className="block text-xs text-[#FF9500]">erst mit vollständigen Angaben unten und geprüften Steuersätzen</span>}
          </span>
        </label>
      </section>

      <InvoiceTermsPanel
        terms={details.terms}
        connected={details.connected}
        busy={busy}
        optionsUrl="/admin/finance/invoice-options"
        saveLabel="Rechnungsangaben speichern"
        onSave={(payload) => save(payload, "Rechnungsangaben gespeichert.")}
      />
    </div>
  );
}

export default InvoiceDetailsTab;
