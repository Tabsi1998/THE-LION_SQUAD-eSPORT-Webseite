import { ArrowDown, ArrowUp, Plus, Shuffle, Signpost, Trash2 } from "lucide-react";
import { StatusChip } from "@/components/tls/StatusChip";
import { formatWhen } from "@/lib/datetime";

// Plan A/B/C beim Ort (#2613): in der Verwaltung beim Ort, nicht unten angehängt. Zwei bis fünf Orte als Alternativen
// (Name, Adresse bzw. Treffpunkt, Hinweis); der erste ist Plan A. Gespeichert werden sie mit dem Event, umgeschaltet wird
// mit einem Klick - der Server schreibt den aktiven Plan in die Ortsfelder, Seite, Kalender, ICS und App zeigen ihn.

export const MAX_PLANS = 5;
const FIELDS = ["key", "name", "address", "postal_code", "city", "country", "note"];

export function planLetter(index) {
  return String.fromCharCode(65 + index);
}

export function emptyPlan() {
  return { key: "", name: "", address: "", postal_code: "", city: "", country: "Österreich", note: "" };
}

/** Plan A aus dem Ort, der gerade eingetragen ist - so geht beim ersten Ausweichort nichts verloren. */
export function planFromPlace(form) {
  return { ...emptyPlan(), name: form?.location || "", address: form?.address || "", postal_code: form?.postal_code || "",
    city: form?.city || "", country: form?.country || "" };
}

export function plansToForm(plans) {
  return (Array.isArray(plans) ? plans : []).filter(Boolean).map((plan) => Object.fromEntries(FIELDS.map((field) => [field, plan[field] || ""])));
}

/** Für den Server: die Reihenfolge ist A, B, C …; ohne Schlüssel vergibt der Server einen. */
export function formToPlans(form) {
  return (form || []).map((plan) => Object.fromEntries(FIELDS.map((field) => [field, String(plan[field] || "").trim()])));
}

export function plansFormError(form) {
  const plans = form || [];
  if (!plans.length) return "";
  if (plans.length < 2) return "Ort-Pläne brauchen mindestens zwei Orte (Plan A und B) – oder den Plan entfernen.";
  if (plans.length > MAX_PLANS) return `Höchstens ${MAX_PLANS} Ort-Pläne.`;
  for (const [index, plan] of plans.entries()) {
    if (!plan.name?.trim() && !plan.address?.trim() && !plan.city?.trim()) return `Plan ${planLetter(index)}: Name oder Adresse fehlt.`;
  }
  return "";
}

/** Ändert das Speichern den Ort, der gerade gilt? Dann fragt die Maske „Angemeldete informieren?“ wie beim Verschieben. */
export function activePlanEdited(before, after, activeKey) {
  if (!activeKey) return false;
  const pick = (list) => (list || []).find((plan) => plan.key === activeKey);
  const old = pick(before);
  const now = pick(after);
  if (!old) return false;
  if (!now) return Boolean((after || []).length);
  return ["name", "address", "postal_code", "city", "country"].some((field) => String(old[field] || "").trim() !== String(now[field] || "").trim());
}

export function EventPlacePlansSection({ value, onChange, saved = [], activeKey, onSwitch, switching = "", dirty = false, history = [], canSwitch = true }) {
  const plans = value || [];
  const savedKeys = new Set((saved || []).map((plan) => plan.key));
  const setPlan = (index, patch) => onChange(plans.map((plan, i) => (i === index ? { ...plan, ...patch } : plan)));
  const move = (index, delta) => {
    const next = [...plans];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const error = plansFormError(plans);
  const input = "w-full bg-surface-0 border border-white/10 focus:border-event px-3 py-2 rounded-sm tls-type-small";
  const label = "block tls-type-label text-white/45 mb-1";
  const blockEnter = (ev) => { if (ev.key === "Enter") ev.preventDefault(); };

  return (
    <section className="border border-event/30 rounded-sm p-4 space-y-3" data-testid="event-place-plans-admin">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="tls-type-card inline-flex items-center gap-2"><Signpost className="w-4 h-4 text-event" aria-hidden="true" /> Ort-Pläne A, B, C</h3>
        <button type="button" onClick={() => onChange([...plans, emptyPlan()])} disabled={plans.length >= MAX_PLANS}
          className="tls-btn tls-btn--quiet inline-flex min-h-11 items-center gap-2 px-3 py-2 rounded-sm tls-type-label disabled:opacity-40" data-testid="event-place-plans-add">
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Plan {planLetter(plans.length)}
        </button>
      </div>
      <p className="tls-type-small text-white/60">
        Plan A ist der Ort, mit dem du rechnest. Gilt ein anderer, schaltest du hier mit einem Klick um – Event-Seite, Kalender, ICS-Datei und App zeigen dann diesen Ort.
      </p>
      <ol className="space-y-3">
        {plans.map((plan, index) => {
          const isSaved = Boolean(plan.key) && savedKeys.has(plan.key);
          const active = isSaved && plan.key === activeKey;
          return (
            <li key={plan.key || `neu-${index}`} className={`border rounded-sm p-3 grid gap-2 md:grid-cols-12 ${active ? "border-event/50 bg-event/5" : "border-white/10"}`} data-testid={`event-place-plan-row-${index}`}>
              <div className="md:col-span-12 flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2">
                  <span className="tls-type-label text-event">Plan {planLetter(index)}</span>
                  {active ? <StatusChip kind="joined" label="Gilt jetzt" testId={`event-place-plan-active-${index}`} /> : null}
                </span>
                <span className="flex items-center gap-1">
                  {isSaved && !active && canSwitch ? (
                    <button type="button" onClick={() => onSwitch(plan.key, `Plan ${planLetter(index)}`)} disabled={dirty || Boolean(switching)}
                      className="tls-btn tls-btn--secondary inline-flex min-h-11 items-center gap-2 px-3 py-2 rounded-sm tls-type-label disabled:opacity-40"
                      data-testid={`event-place-plan-switch-${index}`}>
                      <Shuffle className="w-3.5 h-3.5" aria-hidden="true" /> {switching === plan.key ? "Schalte um …" : `Auf Plan ${planLetter(index)} umschalten`}
                    </button>
                  ) : null}
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="tls-btn tls-btn--quiet min-h-11 min-w-11 inline-flex items-center justify-center rounded-sm disabled:opacity-30" aria-label={`Plan ${planLetter(index)} nach oben`}><ArrowUp className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => move(index, 1)} disabled={index === plans.length - 1} className="tls-btn tls-btn--quiet min-h-11 min-w-11 inline-flex items-center justify-center rounded-sm disabled:opacity-30" aria-label={`Plan ${planLetter(index)} nach unten`}><ArrowDown className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => onChange(plans.filter((_, i) => i !== index))} disabled={active} className="tls-btn tls-btn--danger min-h-11 min-w-11 inline-flex items-center justify-center rounded-sm disabled:opacity-30" aria-label={`Plan ${planLetter(index)} entfernen`} data-testid={`event-place-plan-remove-${index}`}><Trash2 className="w-3.5 h-3.5" /></button>
                </span>
              </div>
              <label className="md:col-span-6 tls-type-small"><span className={label}>Ort oder Treffpunkt (Name)</span><input value={plan.name} onKeyDown={blockEnter} onChange={(ev) => setPlan(index, { name: ev.target.value })} maxLength={120} className={input} placeholder="Rodelbahn Hochegg" data-testid={`event-place-plan-name-${index}`} /></label>
              <label className="md:col-span-6 tls-type-small"><span className={label}>Adresse</span><input value={plan.address} onKeyDown={blockEnter} onChange={(ev) => setPlan(index, { address: ev.target.value })} maxLength={120} className={input} placeholder="Hocheggweg 1" data-testid={`event-place-plan-address-${index}`} /></label>
              <label className="md:col-span-2 tls-type-small"><span className={label}>PLZ</span><input value={plan.postal_code} onKeyDown={blockEnter} onChange={(ev) => setPlan(index, { postal_code: ev.target.value })} maxLength={20} className={input} placeholder="6410" /></label>
              <label className="md:col-span-5 tls-type-small"><span className={label}>Stadt</span><input value={plan.city} onKeyDown={blockEnter} onChange={(ev) => setPlan(index, { city: ev.target.value })} maxLength={120} className={input} placeholder="Telfs" data-testid={`event-place-plan-city-${index}`} /></label>
              <label className="md:col-span-5 tls-type-small"><span className={label}>Land</span><input value={plan.country} onKeyDown={blockEnter} onChange={(ev) => setPlan(index, { country: ev.target.value })} maxLength={120} className={input} placeholder="Österreich" /></label>
              <label className="md:col-span-12 tls-type-small"><span className={label}>Hinweis</span><input value={plan.note} onKeyDown={blockEnter} onChange={(ev) => setPlan(index, { note: ev.target.value })} maxLength={300} className={input} placeholder="z. B. Treffpunkt Parkplatz, nur bei genug Schnee" data-testid={`event-place-plan-note-${index}`} /></label>
            </li>
          );
        })}
      </ol>
      {error ? <p className="tls-type-small text-warn" data-testid="event-place-plans-error">{error}</p> : null}
      {dirty && canSwitch && saved.length ? <p className="tls-type-small text-quiet" data-testid="event-place-plans-save-first">Erst speichern, dann umschalten.</p> : null}
      {history.length ? (
        <div className="border-t border-white/10 pt-3" data-testid="event-place-plans-history">
          <div className="tls-type-label text-white/45 mb-1">Umgeschaltet</div>
          <ul className="space-y-1 tls-type-small text-white/70">
            {history.slice(0, 5).map((row) => (
              <li key={`${row.at}-${row.to_label}`}>
                {formatWhen(row.at)} · {row.from_label} → {row.to_label} · {row.actor_name}{row.notified ? ` · ${row.notified} informiert` : " · ohne Nachricht"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
