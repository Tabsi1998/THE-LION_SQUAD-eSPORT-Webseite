import { MapPin, Signpost } from "lucide-react";
import { StatusChip } from "@/components/tls/StatusChip";

// Plan A/B/C beim Ort (#2613): Gilt nicht mehr Plan A, steht oben „Plan B aktiv“ mit Ort und Hinweis; unter „Infos“
// stehen alle Pläne, der aktive markiert. Der Ort selbst kommt wie immer aus den Ortsfeldern - der Server schreibt den
// aktiven Plan hinein.

/** Der Hinweis oben auf der Seite, sobald ein Ausweichplan gilt. */
export function PlacePlanNotice({ plan }) {
  if (!plan?.alternative) return null;
  const where = [plan.name, plan.address_line].filter(Boolean).join(" · ");
  return (
    <div role="status" className="border border-event/40 bg-event/10 rounded-sm px-4 py-3 min-w-0" data-testid="event-place-plan-notice">
      <div className="inline-flex items-center gap-2 tls-type-label text-event">
        <Signpost className="w-4 h-4 shrink-0" aria-hidden="true" /> {plan.label} aktiv
      </div>
      {where ? <p className="mt-1 tls-type-small font-bold text-white break-words">{where}</p> : null}
      {plan.note ? <p className="tls-type-small text-white/75 break-words">{plan.note}</p> : null}
    </div>
  );
}

/** Alle Pläne unter „Infos“ - nur, wenn es mehr als einen gibt. */
export function PlacePlanList({ plans }) {
  const list = Array.isArray(plans) ? plans.filter((plan) => plan && plan.key) : [];
  if (list.length < 2) return null;
  return (
    <div data-testid="event-place-plans">
      <h3 className="tls-type-card mb-1">Ort: {list.map((plan) => plan.letter || plan.label).join(", ")}</h3>
      <p className="mb-4 tls-type-small text-white/60">Je nach Wetter gilt einer dieser Orte. Ändert sich der Plan, sagt dir die Seite Bescheid.</p>
      <ul className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {list.map((plan) => (
          <li key={plan.key} className={`border rounded-sm p-4 space-y-1.5 min-w-0 ${plan.active ? "border-event/50 bg-event/5" : "border-white/10 bg-surface-1"}`}
            data-testid={`event-place-plan-${plan.key}`} data-active={plan.active ? "1" : undefined}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="tls-type-label text-event">{plan.label}</span>
              {plan.active ? <StatusChip kind="joined" label="Gilt jetzt" testId={`event-place-plan-${plan.key}-active`} /> : null}
            </div>
            {plan.name ? <div className="tls-type-small font-bold text-white break-words">{plan.name}</div> : null}
            {plan.address_line ? (
              <div className="tls-type-small text-white/65 inline-flex items-start gap-2 min-w-0">
                <MapPin className="w-4 h-4 text-event shrink-0 mt-0.5" aria-hidden="true" /> <span className="min-w-0 break-words">{plan.address_line}</span>
              </div>
            ) : null}
            {plan.note ? <div className="tls-type-small text-white/60 break-words">{plan.note}</div> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
