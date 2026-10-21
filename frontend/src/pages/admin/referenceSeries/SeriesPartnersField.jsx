import { CheckField } from "@/components/tls/FormFields";
import { PARTNER_ROLE_LABELS, PARTNER_ROLE_OPTIONS, roleOf, setPartnerRole, togglePartner } from "@/lib/seriesPartners";

// Partner einer Spur bzw. Saison (#1934): ein Haken je aktivem Partner, bei gewähltem Partner die Rolle – Veranstalter
// oder Mitwirkender. Die Serienseite zeigt Veranstalter mit Logo im Kopf, Mitwirkende darunter; die Partnerseite listet
// die Spur unter „Ligen und Serien mit uns“. Bei der Saison stehen die Partner der Spur als geerbt darüber.

export function SeriesPartnersField({ partners = [], value, onChange, inherited = [], testPrefix = "lineage-partner", hint = "" }) {
  if (!Array.isArray(partners) || partners.length === 0) return null;
  const inheritedIds = new Set(inherited.map((item) => item.id));
  const selectable = partners.filter((partner) => !inheritedIds.has(partner.id) || (value?.partner_ids || []).includes(partner.id));
  return (
    <fieldset className="border border-white/10 p-3 rounded-sm bg-[#0A0A0A] min-w-0" data-testid={`${testPrefix}-picker`}>
      <legend className="px-1 text-[11px] uppercase tracking-widest font-bold text-white/60">Partner</legend>
      {inherited.length > 0 && (
        <p className="mb-3 text-xs text-white/55 break-words" data-testid={`${testPrefix}-inherited`}>
          Von der Spur: {inherited.map((item) => `${item.name} (${PARTNER_ROLE_LABELS[item.role]})`).join(", ")}
        </p>
      )}
      <ul className="space-y-2">
        {selectable.map((partner) => {
          const checked = (value?.partner_ids || []).includes(partner.id);
          return (
            <li key={partner.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-h-[40px]">
              <CheckField
                label={partner.name}
                checked={checked}
                onChange={(next) => onChange(togglePartner(value, partner.id, next))}
                accent="#29B6E8"
                testId={`${testPrefix}-${partner.id}`}
                className="flex-1 min-w-[10rem]"
              />
              {checked && (
                <select
                  value={roleOf(value, partner.id)}
                  onChange={(event) => onChange(setPartnerRole(value, partner.id, event.target.value))}
                  aria-label={`Rolle von ${partner.name}`}
                  data-testid={`${testPrefix}-${partner.id}-role`}
                  className="h-10 bg-[#121212] border border-white/15 rounded-sm px-2 text-sm text-white focus:border-[#29B6E8] outline-none"
                >
                  {PARTNER_ROLE_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              )}
            </li>
          );
        })}
      </ul>
      {hint && <p className="mt-2 text-[11px] text-white/40">{hint}</p>}
    </fieldset>
  );
}
