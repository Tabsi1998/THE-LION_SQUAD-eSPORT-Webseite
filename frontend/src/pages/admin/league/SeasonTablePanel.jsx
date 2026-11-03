import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Scale } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormSection } from "@/components/tls/AdminForm";
import { TextAreaField } from "@/components/tls/FormFields";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { tiebreakOrder } from "@/lib/leagueTable";
import { viennaDateTime } from "@/lib/vienna";
import { ConflictReasonField, CONFLICT_REASON_MIN, OwnTeamNote, overrideMissing, overridePayload } from "@/components/tls/league/ConflictOverride";

// Gleichstände je Staffel (E.1, #1625, docs/LIGA.md „E.1 Tabelle“): Wo Teams nach allen Kriterien gleich stehen, legt die
// Leitung mit Grund die Reihenfolge fest - nur dort, nie über das eigene Team (der Server prüft beides). Ein Entscheid gilt,
// solange genau diese Teams gleich stehen; danach bleibt er zur Nachvollziehbarkeit stehen.

const MIN_REASON = 5;

function when(value) {
  try {
    return value ? viennaDateTime(value, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  } catch {
    return "";
  }
}

function OrderSheet({ staffel, tie, override, onClose, onSaved }) {
  const [order, setOrder] = useState(tie.registration_ids.map((id, index) => ({ id, name: tie.names[index] || "Team" })));
  const [reason, setReason] = useState("");
  const [conflictReason, setConflictReason] = useState("");
  const [saving, setSaving] = useState(false);
  const move = (index, by) => setOrder((current) => {
    const next = [...current];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    return next;
  });
  const submit = async (event) => {
    event.preventDefault();
    if (reason.trim().length < MIN_REASON) {
      toast.error(`Bitte einen Grund mit mindestens ${MIN_REASON} Zeichen angeben.`);
      return;
    }
    if (overrideMissing(override, conflictReason)) {
      toast.error(`Bitte den Grund für die Notausnahme mit mindestens ${CONFLICT_REASON_MIN} Zeichen angeben.`);
      return;
    }
    setSaving(true);
    try {
      await api.put(`/admin/leagues/staffeln/${staffel.tournament_id}/table-decision`, { registration_ids: order.map((item) => item.id), reason: reason.trim(),
        ...overridePayload(override, conflictReason) });
      toast.success("Reihenfolge festgelegt.");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      setSaving(false);
    }
  };
  return (
    <AdminSheet title={`Platz ${tie.rank}: Reihenfolge festlegen`} eyebrow={staffel.label} onClose={onClose} onSubmit={submit} saving={saving}
      submitLabel="Festlegen" submitTestId="table-decision-save" testId="table-decision-sheet">
      <p className="text-sm text-white/65">Nur bei echtem Gleichstand nach allen Kriterien. Die Tabelle zeigt „Platz durch Entscheid der Leitung“ mit deinem Grund.</p>
      <ol className="mt-4 space-y-2" data-testid="table-decision-order">
        {order.map((item, index) => (
          <li key={item.id} className="flex min-h-[44px] items-center gap-2 rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2">
            <span className="w-8 font-display font-bold tabular-nums text-[#29B6E8]">{tie.rank + index}.</span>
            <span className="min-w-0 flex-1 break-words text-white">{item.name}</span>
            <button type="button" className="tls-btn tls-btn--quiet inline-flex h-10 w-10 items-center justify-center rounded-sm disabled:opacity-30" disabled={index === 0}
              onClick={() => move(index, -1)} aria-label={`${item.name} nach oben`} data-testid={`table-decision-up-${index}`}>
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" className="tls-btn tls-btn--quiet inline-flex h-10 w-10 items-center justify-center rounded-sm disabled:opacity-30" disabled={index === order.length - 1}
              onClick={() => move(index, 1)} aria-label={`${item.name} nach unten`} data-testid={`table-decision-down-${index}`}>
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
      <div className="mt-4">
        <TextAreaField label="Grund" rows={3} value={reason} onChange={setReason} required placeholder="z. B. Losentscheid vor beiden Captains am 20.11."
          hint="Steht öffentlich an der Tabelle und im Protokoll." testId="table-decision-reason" />
      </div>
      {override ? <div className="mt-4"><ConflictReasonField value={conflictReason} onChange={setConflictReason} testId="table-decision-conflict-reason" /></div> : null}
    </AdminSheet>
  );
}

function RemoveSheet({ staffel, decision, override, onClose, onSaved }) {
  const [reason, setReason] = useState("");
  const [conflictReason, setConflictReason] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (reason.trim().length < MIN_REASON) {
      toast.error(`Bitte einen Grund mit mindestens ${MIN_REASON} Zeichen angeben.`);
      return;
    }
    if (overrideMissing(override, conflictReason)) {
      toast.error(`Bitte den Grund für die Notausnahme mit mindestens ${CONFLICT_REASON_MIN} Zeichen angeben.`);
      return;
    }
    setSaving(true);
    try {
      await api.delete(`/admin/leagues/staffeln/${staffel.tournament_id}/table-decision/${decision.id}`,
        { data: { reason: reason.trim(), ...overridePayload(override, conflictReason) } });
      toast.success("Entscheid zurückgenommen.");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      setSaving(false);
    }
  };
  return (
    <AdminSheet title="Entscheid zurücknehmen" eyebrow={staffel.label} onClose={onClose} onSubmit={submit} saving={saving}
      submitLabel="Zurücknehmen" submitTestId="table-decision-remove-save" testId="table-decision-remove-sheet">
      <p className="text-sm text-white/65">{decision.names.join(" vor ")}. Danach teilen sich die Teams den Platz wieder, solange sie gleich stehen.</p>
      <div className="mt-4">
        <TextAreaField label="Grund" rows={3} value={reason} onChange={setReason} required testId="table-decision-remove-reason" />
      </div>
      {override ? <div className="mt-4"><ConflictReasonField value={conflictReason} onChange={setConflictReason} testId="table-decision-remove-conflict-reason" /></div> : null}
    </AdminSheet>
  );
}

function StaffelTies({ staffel, canDecide, version }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState(null);
  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/admin/leagues/staffeln/${staffel.tournament_id}/table`);
      setData(body);
      setError("");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    }
  }, [staffel.tournament_id]);
  useEffect(() => { load(); }, [load, version]);
  const saved = () => {
    setSheet(null);
    load();
  };
  if (error) return <p className="text-xs text-warn" role="alert">{error}</p>;
  if (!data) return <p className="text-xs text-white/45" aria-busy="true">Lade Tabelle …</p>;
  const decide = canDecide && data.can_decide;
  const ties = Array.isArray(data.ties) ? data.ties : [];
  const decisions = Array.isArray(data.decisions) ? data.decisions : [];
  // Befangen (eigenes Team): nur der Superadmin, mit Grund für die Notausnahme - sonst der Satz statt des Knopfs.
  const blocked = (entry) => Boolean(entry.own_team) && !data.superadmin;
  return (
    <div className="space-y-2" data-testid={`season-ties-${staffel.tournament_id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bold text-white">{staffel.label}</h3>
        {data.rules?.tiebreakers ? <span className="text-[11px] text-white/45">{tiebreakOrder(data.rules.tiebreakers)}</span> : null}
      </div>
      {!ties.length ? <p className="text-xs text-white/55">Kein offener Gleichstand.</p> : null}
      {ties.map((tie) => (
        <div key={tie.rank} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm border border-warn/30 bg-warn/5 px-3 py-2" data-testid={`season-tie-${staffel.tournament_id}-${tie.rank}`}>
          <span className="text-sm text-white">Platz {tie.rank}: {tie.names.join(", ")}</span>
          <span className="text-xs text-white/55 tabular-nums">{tie.points} Punkte, nach allen Kriterien gleich</span>
          {decide && blocked(tie) ? <span className="ml-auto"><OwnTeamNote testId={`season-tie-own-${tie.rank}`} /></span> : null}
          {decide && !blocked(tie) ? (
            <button type="button" onClick={() => setSheet({ kind: "order", tie })} data-testid={`season-tie-decide-${tie.rank}`}
              className="tls-btn tls-btn--secondary ml-auto min-h-[40px] rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider">Reihenfolge festlegen</button>
          ) : null}
        </div>
      ))}
      {ties.length && !data.can_decide ? <p className="text-xs text-white/50">Die Season sieht keinen Entscheid der Leitung vor – die Teams teilen sich den Platz.</p> : null}
      {decisions.length ? (
        <ul className="space-y-1.5" aria-label="Entscheide der Leitung">
          {decisions.map((decision) => (
            <li key={decision.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/70" data-testid={`season-decision-${decision.id}`}>
              <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${decision.applies ? "border-[#29B6E8]/50 text-[#29B6E8]" : "border-white/15 text-white/50"}`}>
                {decision.applies ? "Gilt" : "Gilt nicht mehr"}
              </span>
              <span className="text-white">{decision.names.join(" vor ")}</span>
              <span className="min-w-0 break-words">„{decision.reason}“ · {when(decision.decided_at)}</span>
              {canDecide && blocked(decision) ? <span className="ml-auto"><OwnTeamNote testId={`season-decision-own-${decision.id}`} /></span> : null}
              {canDecide && !blocked(decision) ? (
                <button type="button" onClick={() => setSheet({ kind: "remove", decision })} data-testid={`season-decision-remove-${decision.id}`}
                  className="tls-btn tls-btn--quiet ml-auto min-h-[40px] rounded-sm px-3 py-1 text-[11px] font-bold uppercase tracking-wider">Zurücknehmen</button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {sheet?.kind === "order" ? <OrderSheet staffel={staffel} tie={sheet.tie} override={Boolean(sheet.tie.own_team)} onClose={() => setSheet(null)} onSaved={saved} /> : null}
      {sheet?.kind === "remove" ? <RemoveSheet staffel={staffel} decision={sheet.decision} override={Boolean(sheet.decision.own_team)} onClose={() => setSheet(null)} onSaved={saved} /> : null}
    </div>
  );
}

export function SeasonTablePanel({ divisions = [], canDecide = false }) {
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  useApiInvalidation(reload, ["tournaments", "matches"]);
  const staffeln = divisions.flatMap((division) => division.staffeln
    .filter((staffel) => staffel.status && staffel.status !== "draft")
    .map((staffel) => ({ ...staffel, label: `${division.label} · Staffel ${staffel.staffel}` })));
  if (!staffeln.length) return null;
  return (
    <FormSection title="Tabelle und Gleichstand" testId="season-table-panel"
      hint="Bei echtem Gleichstand nach allen Kriterien legt die Leitung die Reihenfolge mit Grund fest. Über das eigene Team entscheidet eine andere Person.">
      <div className="space-y-5">
        {staffeln.map((staffel) => (
          <StaffelTies key={staffel.tournament_id} staffel={staffel} canDecide={canDecide} version={version} />
        ))}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-white/45"><Scale className="h-3.5 w-3.5" aria-hidden="true" /> Kampflos, Austritt und „beide nicht erschienen“ rechnet die Tabelle nach den Regeln der Season.</p>
    </FormSection>
  );
}
