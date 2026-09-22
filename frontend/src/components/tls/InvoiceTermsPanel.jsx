import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// Rechnungskonditionen (#370): Zahlungsziel, Zahlungsart und Bankkonto für jeden Beleg aus der
// Website. Die Listen kommen aus Dolibarr; darf der Website-Benutzer eine nicht lesen, wird die
// Nummer getippt (sie steht in Dolibarr in der Adresszeile des Eintrags, „id=…“). Ohne alle drei
// bleibt jeder Beleg Entwurf - auch wenn „gleich freigeben“ an ist.

const FIELDS = [
  { key: "payment_term_id", setting: "invoice_payment_term_id", list: "terms", label: "Zahlungsziel", hint: "Vorgabe des Vereins: 30 Tage" },
  { key: "payment_mode_id", setting: "invoice_payment_mode_id", list: "modes", label: "Zahlungsart", hint: "Vorgabe des Vereins: Banküberweisung" },
  { key: "bank_account_id", setting: "invoice_bank_account_id", list: "accounts", label: "Bankkonto", hint: "das Girokonto des Vereins" },
];

export function InvoiceTermsPanel({ terms, connected, busy, onSave }) {
  const [options, setOptions] = useState(null);
  const [draft, setDraft] = useState(() => valuesOf(terms));
  useEffect(() => { setDraft(valuesOf(terms)); }, [terms?.payment_term_id, terms?.payment_mode_id, terms?.bank_account_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!connected) { setOptions(null); return; }
    api.get("/admin/dolibarr/invoice-options").then(({ data }) => setOptions(data)).catch(() => setOptions({ available: false, terms: null, modes: null, accounts: null, suggested: {} }));
  }, [connected]);

  const dirty = FIELDS.some((field) => String(draft[field.key] || "") !== String(terms?.[field.key] || ""));
  const suggested = options?.suggested || {};
  const canSuggest = FIELDS.some((field) => suggested[field.key] && !draft[field.key]);
  const complete = FIELDS.every((field) => Number(draft[field.key]) > 0);
  const save = () => onSave(Object.fromEntries(FIELDS.map((field) => [field.setting, Number(draft[field.key]) > 0 ? Number(draft[field.key]) : 0])));

  return (
    <div className="border border-white/10 rounded-sm p-3 space-y-3" data-testid="invoice-terms">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold uppercase tracking-wider text-white/70">Rechnungskonditionen</div>
        <span className={`text-[11px] uppercase tracking-wider font-bold ${terms?.complete ? "text-[#00FF88]" : "text-[#FFD700]"}`} data-testid="invoice-terms-state">
          {terms?.complete ? "vollständig" : "unvollständig – Belege bleiben Entwurf"}
        </span>
      </div>
      <p className="text-xs text-white/55">Stehen an jedem Beleg, den die Website anlegt. Die Listen kommen aus Dolibarr; fehlt eine Liste, darf der Website-Benutzer sie nicht lesen – dann die Nummer aus Dolibarr eintragen (Adresszeile des Eintrags, „id=…“).</p>
      <div className="grid sm:grid-cols-3 gap-3">
        {FIELDS.map((field) => {
          const list = options?.[field.list];
          return (
            <label key={field.key} className="text-xs">
              <div className="uppercase tracking-widest text-white/45 font-bold mb-1">{field.label}</div>
              {Array.isArray(list) && list.length ? (
                <select value={draft[field.key] || ""} onChange={(ev) => setDraft((current) => ({ ...current, [field.key]: ev.target.value }))} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" data-testid={`invoice-terms-${field.key}`}>
                  <option value="">– bitte wählen –</option>
                  {list.map((item) => <option key={item.id} value={item.id}>{item.label}{item.code ? ` (${item.code})` : ""}</option>)}
                </select>
              ) : (
                <input value={draft[field.key] || ""} onChange={(ev) => setDraft((current) => ({ ...current, [field.key]: ev.target.value.replace(/\D/g, "") }))} inputMode="numeric" placeholder="Nummer aus Dolibarr" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" data-testid={`invoice-terms-${field.key}`} />
              )}
              <div className="mt-1 text-white/40">{field.hint}</div>
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!!busy || !dirty} onClick={save} data-testid="invoice-terms-save" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-40">Konditionen speichern</button>
        {canSuggest && (
          <button type="button" disabled={!!busy} onClick={() => setDraft((current) => Object.fromEntries(FIELDS.map((field) => [field.key, current[field.key] || (suggested[field.key] ? String(suggested[field.key]) : "")])))} data-testid="invoice-terms-suggest" className="px-4 py-2 border border-white/15 text-white/70 font-bold uppercase tracking-wider rounded-sm text-xs">
            Vorschlag übernehmen (30 Tage, Überweisung{suggested.bank_account_id ? ", Konto" : ""})
          </button>
        )}
        {dirty && !complete && <span className="text-xs text-[#FFD700] self-center">Erst mit allen drei Angaben werden Belege automatisch freigegeben.</span>}
      </div>
    </div>
  );
}

function valuesOf(terms) {
  return Object.fromEntries(FIELDS.map((field) => [field.key, terms?.[field.key] ? String(terms[field.key]) : ""]));
}
