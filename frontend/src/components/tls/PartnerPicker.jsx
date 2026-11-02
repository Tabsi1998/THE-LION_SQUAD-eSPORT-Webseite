import { FormGrid } from "@/components/tls/AdminForm";
import { CheckField } from "@/components/tls/FormFields";

// Partner an Events und Turnieren (#469 Teil 2): ein Haken je Partner. Die Event- bzw. Turnierseite
// nennt den Partner, die Partnerseite zeigt das Event oder Turnier unter „Gemeinsam“.

/** Archivierte Partner stehen nicht in der Auswahl, bleiben aber verknüpft (#2130); hier lässt sich der Link lösen. */
export function ArchivedPartnersNote({ count, onRemove, testId }) {
  if (!count) return null;
  return (
    <p className="mt-2 text-[11px] text-white/55" data-testid={testId}>
      {count === 1 ? "1 archivierter Partner bleibt verknüpft und ist öffentlich nicht zu sehen, bis er zurückgeholt wird." : `${count} archivierte Partner bleiben verknüpft und sind öffentlich nicht zu sehen, bis sie zurückgeholt werden.`}{" "}
      <button type="button" onClick={onRemove} data-testid={`${testId}-remove`} className="font-bold text-[#29B6E8] hover:text-white underline-offset-2 hover:underline">Verknüpfung lösen</button>
    </p>
  );
}

export function PartnerPicker({ partners, value = [], onChange, testPrefix = "partner", hint = "" }) {
  if (!Array.isArray(partners) || partners.length === 0) return null;
  const selected = Array.isArray(value) ? value : [];
  const shown = new Set(partners.map((partner) => partner.id));
  const archived = selected.filter((id) => !shown.has(id));
  return (
    <div className="border border-white/10 p-3 rounded-sm bg-[#0A0A0A]" data-testid={`${testPrefix}-picker`}>
      <div className="text-[11px] uppercase tracking-widest font-bold text-white/60 mb-3">Partner</div>
      <FormGrid cols={3}>
        {partners.map((partner) => (
          <CheckField
            key={partner.id}
            label={partner.name}
            checked={selected.includes(partner.id)}
            onChange={(checked) => onChange(checked ? [...selected, partner.id] : selected.filter((id) => id !== partner.id))}
            accent="#29B6E8"
            testId={`${testPrefix}-${partner.id}`}
          />
        ))}
      </FormGrid>
      <ArchivedPartnersNote count={archived.length} onRemove={() => onChange(selected.filter((id) => shown.has(id)))} testId={`${testPrefix}-archived`} />
      {hint && <p className="mt-2 text-[11px] text-white/40">{hint}</p>}
    </div>
  );
}
