import { useEffect, useState } from "react";
import { Plus, Trash2, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { PRICE_BASES, TAX_PROFILES, TOURNAMENT_PRICE_BASES, applyDolibarrService, billingFormError, emptyPosition, formatCents, previewQuote, formToBilling } from "@/lib/pricing";

// „Kosten und Abrechnung“ am Event (#315, #318, #322): nur wer den Bereich Finanzen hat, sieht
// und pflegt den Abschnitt. Beträge als Text („20“ oder „20,50“), typisierte Preisbasis und
// Steuerprofil - keine Formeln. Was die Anmeldung kostet, zeigt die Vorschau rechts.
// Mit `kind="tournament"` (#319) heißt der Abschnitt „Startgeld“, „je Person“ meint den Roster,
// und es kommen zwei Schalter dazu: Ersatzspieler mitzählen, im Eventbeitrag enthalten.

const KINDS = {
  event: {
    title: "Kosten und Abrechnung", toggle: "Teilnahme kostet etwas", bases: PRICE_BASES, previewSeats: 2,
    off: "Kostenlos. Zum Einschalten den Haken setzen – dann gibt es Positionen wie „Kostenbeitrag 20 € je Person inkl. Essen“.",
    preview: (total) => <>Eine Person mit einer Begleitperson zahlt <strong className="text-white">{total}</strong> (nur Pflichtpositionen).</>,
    defaultLabel: "Kostenbeitrag",
  },
  tournament: {
    title: "Startgeld", toggle: "Teilnahme kostet Startgeld", bases: TOURNAMENT_PRICE_BASES, previewSeats: 5,
    off: "Kein Startgeld. Zum Einschalten den Haken setzen – dann gibt es Positionen wie „Startgeld 10 € je Spieler“.",
    preview: (total) => <>Ein Team mit fünf Spielern zahlt <strong className="text-white">{total}</strong> (nur Pflichtpositionen; Solo zählt als eine Person).</>,
    defaultLabel: "Startgeld",
  },
};

export function EventBillingSection({ value, onChange, canEdit, dolibarrConnected = false, kind = "event", hasEvent = false }) {
  const copy = KINDS[kind] || KINDS.event;
  // Leistungen aus Dolibarr (z. B. „Kostenbeitrag 20,00 brutto“): auswählen statt Nummer tippen.
  // Die Auswahl füllt Bezeichnung, Betrag, Steuer und Nummer vor; danach lässt sich alles ändern.
  const [services, setServices] = useState(null);
  useEffect(() => {
    if (!canEdit) return;
    api.get("/admin/finance/dolibarr-services").then(({ data }) => setServices(data)).catch(() => setServices({ available: false, services: [] }));
  }, [canEdit]);
  if (!canEdit) return null;
  const form = value || { enabled: false, positions: [], invoice_timing: "on_confirm" };
  const set = (patch) => onChange({ ...form, ...patch });
  const setPosition = (index, patch) => set({ positions: form.positions.map((position, i) => (i === index ? { ...position, ...patch } : position)) });
  const pickService = (index, serviceId) => {
    const service = (services?.services || []).find((item) => String(item.id) === String(serviceId));
    set({ positions: form.positions.map((position, i) => (i === index ? applyDolibarrService(position, service) : position)) });
  };
  const error = billingFormError(form);
  const preview = form.enabled && !error ? previewQuote({ ...formToBilling(form), currency: "EUR" }, { seats: copy.previewSeats }) : null;

  return (
    <section className="border border-[#FFD700]/30 rounded-sm p-4 space-y-4" data-testid="event-billing">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-heading text-lg font-black uppercase inline-flex items-center gap-2"><Wallet className="w-4 h-4 text-[#FFD700]" /> {copy.title}</h3>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={Boolean(form.enabled)} onChange={(ev) => set({ enabled: ev.target.checked, positions: ev.target.checked && !form.positions.length ? [{ ...emptyPosition(), label: copy.defaultLabel }] : form.positions })} data-testid="event-billing-enabled" />
          {copy.toggle}
        </label>
      </div>
      {!form.enabled ? (
        <p className="text-sm text-white/55">{copy.off}</p>
      ) : (
        <>
          <div className="space-y-3">
            {form.positions.map((position, index) => (
              <div key={index} className="border border-white/10 rounded-sm p-3 grid gap-2 md:grid-cols-12" data-testid={`event-billing-position-${index}`}>
                <label className="md:col-span-4 text-xs">
                  <div className="uppercase tracking-widest text-white/45 font-bold mb-1">Bezeichnung</div>
                  <input value={position.label} onChange={(ev) => setPosition(index, { label: ev.target.value })} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="Kostenbeitrag inkl. Essen" />
                </label>
                <label className="md:col-span-2 text-xs">
                  <div className="uppercase tracking-widest text-white/45 font-bold mb-1">Betrag €</div>
                  <input value={position.amount} onChange={(ev) => setPosition(index, { amount: ev.target.value })} inputMode="decimal" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm tabular-nums" placeholder="20,00" data-testid={`event-billing-amount-${index}`} />
                </label>
                <label className="md:col-span-3 text-xs">
                  <div className="uppercase tracking-widest text-white/45 font-bold mb-1">Preisbasis</div>
                  <select value={position.basis} onChange={(ev) => setPosition(index, { basis: ev.target.value })} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
                    {copy.bases.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                  </select>
                </label>
                <label className="md:col-span-3 text-xs">
                  <div className="uppercase tracking-widest text-white/45 font-bold mb-1">Steuer</div>
                  <select value={position.tax_profile} onChange={(ev) => setPosition(index, { tax_profile: ev.target.value })} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
                    {TAX_PROFILES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                  </select>
                </label>
                <label className="md:col-span-6 text-xs">
                  <div className="uppercase tracking-widest text-white/45 font-bold mb-1">Beschreibung (auf der Rechnung)</div>
                  <input value={position.description} onChange={(ev) => setPosition(index, { description: ev.target.value })} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="Essen und Getränke inklusive" />
                </label>
                <label className="md:col-span-3 text-xs">
                  <div className="uppercase tracking-widest text-white/45 font-bold mb-1">Leistung aus Dolibarr</div>
                  {services?.available && services.services.length ? (
                    <select value={position.dolibarr_product_id || ""} onChange={(ev) => pickService(index, ev.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" data-testid={`event-billing-service-${index}`}>
                      <option value="">– keine (eigene Position) –</option>
                      {services.services.map((service) => (
                        <option key={service.id} value={service.id}>{service.label} · {formatCents(service.amount_cents)}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={position.dolibarr_product_id} onChange={(ev) => setPosition(index, { dolibarr_product_id: ev.target.value })} inputMode="numeric" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder={dolibarrConnected || services?.available ? "Nr. (optional)" : "erst mit Dolibarr"} />
                  )}
                </label>
                <div className="md:col-span-3 flex items-end justify-between gap-2 text-xs">
                  <label className="inline-flex items-center gap-2 pb-2">
                    <input type="checkbox" checked={position.optional} onChange={(ev) => setPosition(index, { optional: ev.target.checked })} /> wählbar
                  </label>
                  <button type="button" onClick={() => set({ positions: form.positions.filter((_, i) => i !== index) })} className="inline-flex items-center gap-1 px-2 py-2 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm uppercase tracking-wider font-bold" aria-label={`Position ${index + 1} entfernen`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
            <button type="button" onClick={() => set({ positions: [...form.positions, emptyPosition()] })} className="inline-flex items-center gap-2 px-3 py-2 border border-white/15 text-white/70 hover:text-white text-xs uppercase tracking-wider font-bold rounded-sm" data-testid="event-billing-add">
              <Plus className="w-3.5 h-3.5" /> Position
            </button>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <label className="text-xs">
              <div className="uppercase tracking-widest text-white/45 font-bold mb-1">Rechnung anlegen</div>
              <select value={form.invoice_timing} onChange={(ev) => set({ invoice_timing: ev.target.value })} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" data-testid="event-billing-timing">
                <option value="on_confirm">gleich nach der verbindlichen Anmeldung</option>
                <option value="manual">erst nach Freigabe in der Finanzübersicht</option>
              </select>
            </label>
            <div className="text-xs text-white/55 border border-white/10 rounded-sm p-3">
              <div className="uppercase tracking-widest text-white/45 font-bold mb-1">Vorschau</div>
              {error ? <span className="text-[#FF3B30]" data-testid="event-billing-error">{error}</span> : preview ? (
                <span data-testid="event-billing-preview">{copy.preview(formatCents(preview.total_cents))}</span>
              ) : null}
            </div>
          </div>
          {kind === "tournament" && (
            <div className="grid sm:grid-cols-2 gap-3 text-sm" data-testid="tournament-billing-options">
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={Boolean(form.count_substitutes)} onChange={(ev) => set({ count_substitutes: ev.target.checked })} className="mt-1" data-testid="tournament-billing-substitutes" />
                <span>Ersatzspieler zählen mit<br /><span className="text-xs text-white/45">Nur bei „je Spieler“. Ohne Haken zahlt ein Team nur für die Stammspieler.</span></span>
              </label>
              <label className={`flex items-start gap-2 ${hasEvent ? "" : "opacity-50"}`}>
                <input type="checkbox" checked={Boolean(form.included_in_event)} disabled={!hasEvent} onChange={(ev) => set({ included_in_event: ev.target.checked })} className="mt-1" data-testid="tournament-billing-included" />
                <span>Im Eventbeitrag enthalten<br /><span className="text-xs text-white/45">{hasEvent ? "Das Event stellt die Rechnung – hier entsteht keine zweite." : "Erst wählbar, wenn das Turnier an einem Event hängt."}</span></span>
              </label>
            </div>
          )}
          <p className="text-xs text-white/45">
            {kind === "tournament"
              ? "Wer anmeldet, übernimmt das Startgeld und bestätigt das beim Anmelden – bei Teams die Teamleitung für das ganze Team. Bezahlt wird erst mit der verbindlichen Teilnahme: Warteliste und offene Freigabe kosten nichts, Ablehnung oder Abmeldung vor dem Beleg schließt den Auftrag. Der Preis wird dabei eingefroren – spätere Änderungen hier betreffen nur neue Anmeldungen."
              : "Wer sich anmeldet, sieht die Positionen und die Summe vor dem Absenden. Der Preis wird bei der verbindlichen Anmeldung eingefroren – spätere Änderungen hier betreffen nur neue Anmeldungen. Die Rechnung entsteht in Dolibarr, sobald der Schreibzugriff eingerichtet ist (Einstellungen → Dolibarr)."}
          </p>
        </>
      )}
    </section>
  );
}
