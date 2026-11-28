import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowRight, ArrowUp, FileDown, Scale } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormSection } from "@/components/tls/AdminForm";
import { SelectField, TextAreaField } from "@/components/tls/FormFields";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { StandingsTable, ZoneLegend } from "@/components/tls/tournament/StandingsTable";
import { methodOptions } from "@/lib/leagueFinal";
import { byMaps, hidesDraws, tiebreakOrder } from "@/lib/leagueTable";
import { staffelAdminUrl } from "@/lib/staffelTabs";
import { staffelBeforeStart } from "@/pages/admin/tournament/StaffelParts";
import { formatWhen } from "@/lib/datetime";
import { ConflictReasonField, CONFLICT_REASON_MIN, OwnTeamNote, overrideMissing, overridePayload } from "@/components/tls/league/ConflictOverride";

// Gleichstände je Staffel (E.1, #1625, docs/LIGA.md „E.1 Tabelle“): Wo Teams nach allen Kriterien gleich stehen, legt die
// Leitung mit Grund die Reihenfolge fest - nur dort, nie über das eigene Team (der Server prüft beides). Ein Entscheid gilt,
// solange genau diese Teams gleich stehen; danach bleibt er zur Nachvollziehbarkeit stehen.

const MIN_REASON = 5;

function when(value) {
  try {
    return value ? formatWhen(value) : "";
  } catch {
    return "";
  }
}

const DECISION_METHODS = [["playoff", "Entscheidungsspiel"], ["lot", "Los"], ["lead", "Entscheid der Leitung"]];

/** Reihenfolge bei echtem Gleichstand festlegen. „Wie wurde entschieden?“ (F.1, Nr. 156) ist freiwillig - nur für den Meisterplatz
 *  Pflicht (`methodRequired` im Reiter „Abschluss“; der Server verlangt es dort auch, wenn der Entscheid im Reiter „Tabelle“ fällt). */
export function OrderSheet({ staffel, tie, override, onClose, onSaved, methods = DECISION_METHODS, methodRequired = false }) {
  const [method, setMethod] = useState("");
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
    if (methodRequired && !method) {
      toast.error("Bitte wählen, wie entschieden wurde.");
      return;
    }
    if (overrideMissing(override, conflictReason)) {
      toast.error(`Bitte den Grund für die Notausnahme mit mindestens ${CONFLICT_REASON_MIN} Zeichen angeben.`);
      return;
    }
    setSaving(true);
    try {
      await api.put(`/admin/leagues/staffeln/${staffel.tournament_id}/table-decision`, { registration_ids: order.map((item) => item.id), reason: reason.trim(),
        ...(method ? { method } : {}), ...overridePayload(override, conflictReason) });
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
      <p className="tls-type-body text-white/65">Nur bei echtem Gleichstand nach allen Kriterien. Die Tabelle zeigt „Platz durch Entscheid der Leitung“ mit deinem Grund.</p>
      <ol className="mt-4 space-y-2" data-testid="table-decision-order">
        {order.map((item, index) => (
          <li key={item.id} className="flex min-h-[44px] items-center gap-2 rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2">
            <span className="w-8 tls-type-num text-[#29B6E8]">{tie.rank + index}.</span>
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
        <SelectField label="Wie wurde entschieden?" required={methodRequired} value={method} onChange={setMethod} testId="table-decision-method"
          options={[["", methodRequired ? "Bitte wählen" : "Keine Angabe"], ...methods]}
          hint={methodRequired ? "Steht mit dem Grund im Endstand." : "Freiwillig – für den Meisterplatz der obersten Liga Pflicht. Steht mit dem Grund an der Tabelle."} />
      </div>
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
      <p className="tls-type-small text-white/65">{decision.names.join(" vor ")}. Danach teilen sich die Teams den Platz wieder, solange sie gleich stehen.</p>
      <div className="mt-4">
        <TextAreaField label="Grund" rows={3} value={reason} onChange={setReason} required testId="table-decision-remove-reason" />
      </div>
      {override ? <div className="mt-4"><ConflictReasonField value={conflictReason} onChange={setConflictReason} testId="table-decision-remove-conflict-reason" /></div> : null}
    </AdminSheet>
  );
}


// Gleichstände, die den Abschluss aufhalten (Server: `league_final.classify_ties`) - dieselben Fälle wie im Reiter „Abschluss“.
const TIE_KINDS = { champion: "Meisterplatz", zone: "Grenze zu Auf- oder Abstieg" };

function StaffelTies({ tournamentId, label, data, canDecide, onSaved }) {
  const [sheet, setSheet] = useState(null);
  const staffel = { tournament_id: tournamentId, label };
  const saved = () => {
    setSheet(null);
    onSaved();
  };
  // Abgeschlossen (Endstand festgehalten): entschieden und zurückgenommen wird erst nach dem Wiederöffnen - der Satz statt der Knöpfe.
  const closed = Boolean(data.closed);
  const change = canDecide && !closed;
  const decide = change && data.can_decide;
  const ties = Array.isArray(data.ties) ? data.ties : [];
  const decisions = Array.isArray(data.decisions) ? data.decisions : [];
  // Befangen (eigenes Team): nur der Superadmin, mit Grund für die Notausnahme - sonst der Satz statt des Knopfs.
  const blocked = (entry) => Boolean(entry.own_team) && !data.superadmin;
  return (
    <div className="space-y-2" data-testid={`season-ties-${tournamentId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bold text-white">Gleichstand</h3>
        {data.rules?.tiebreakers ? (
          <span className="tls-type-small text-white/60">{byMaps(data.rules) ? "Punkte = gewonnene Maps · " : ""}{tiebreakOrder(data.rules.tiebreakers)}</span>
        ) : null}
      </div>
      {!ties.length ? <p className="tls-type-small text-white/60">Kein offener Gleichstand.</p> : null}
      {canDecide && closed && (ties.length || decisions.length) ? (
        <p className="tls-type-body text-white/70" data-testid="staffel-ties-closed">Abgeschlossen – entscheiden und zurücknehmen geht erst nach dem Wiederöffnen im Reiter „Abschluss“ der Season.</p>
      ) : null}
      {ties.map((tie) => (
        <div key={tie.rank} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm border border-warn/30 bg-warn/5 px-3 py-2" data-testid={`season-tie-${tournamentId}-${tie.rank}`}>
          {TIE_KINDS[tie.kind] ? (
            <span className="rounded-sm border border-warn/50 px-1.5 py-0.5 tls-type-label text-warn" data-testid={`season-tie-kind-${tournamentId}-${tie.rank}`}>
              {TIE_KINDS[tie.kind]}
            </span>
          ) : null}
          <span className="min-w-0 tls-type-small text-white [overflow-wrap:anywhere]">Platz {tie.rank}: {tie.names.join(", ")}</span>
          <span className="tls-type-small text-white/60 tabular-nums">{tie.points} Punkte, nach allen Kriterien gleich</span>
          {decide && blocked(tie) ? <span className="ml-auto"><OwnTeamNote testId={`season-tie-own-${tie.rank}`} /></span> : null}
          {decide && !blocked(tie) ? (
            <button type="button" onClick={() => setSheet({ kind: "order", tie })} data-testid={`season-tie-decide-${tie.rank}`}
              className="tls-btn tls-btn--secondary ml-auto min-h-[44px] rounded-sm px-3 py-1.5 tls-type-label">Reihenfolge festlegen</button>
          ) : null}
        </div>
      ))}
      {ties.length && !data.can_decide ? <p className="tls-type-small text-white/60">Die Season sieht keinen Entscheid der Leitung vor – die Teams teilen sich den Platz.</p> : null}
      {decisions.length ? (
        <ul className="space-y-1.5" aria-label="Entscheide der Leitung">
          {decisions.map((decision) => (
            <li key={decision.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 tls-type-small text-white/70" data-testid={`season-decision-${decision.id}`}>
              <span className={`rounded-sm border px-1.5 py-0.5 tls-type-label ${decision.applies ? "border-[#29B6E8]/50 text-[#29B6E8]" : "border-white/15 text-white/60"}`}>
                {decision.applies ? "Gilt" : "Gilt nicht mehr"}
              </span>
              <span className="text-white [overflow-wrap:anywhere]">{decision.names.join(" vor ")}</span>
              <span className="min-w-0 break-words">„{decision.reason}“ · {when(decision.decided_at)}</span>
              {change && blocked(decision) ? <span className="ml-auto"><OwnTeamNote testId={`season-decision-own-${decision.id}`} /></span> : null}
              {change && !blocked(decision) ? (
                <button type="button" onClick={() => setSheet({ kind: "remove", decision })} data-testid={`season-decision-remove-${decision.id}`}
                  className="tls-btn tls-btn--quiet ml-auto min-h-[44px] rounded-sm px-3 py-1 tls-type-label">Zurücknehmen</button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {/* Meister-Gleichstand (#2262): Art der Entscheidung Pflicht wie im Abschluss - mit den Wörtern des Servers. */}
      {sheet?.kind === "order" ? (
        <OrderSheet staffel={staffel} tie={sheet.tie} override={Boolean(sheet.tie.own_team)} onClose={() => setSheet(null)} onSaved={saved}
          methods={data.methods ? methodOptions(data.methods) : DECISION_METHODS} methodRequired={Boolean(sheet.tie.method_required)} />
      ) : null}
      {sheet?.kind === "remove" ? <RemoveSheet staffel={staffel} decision={sheet.decision} override={Boolean(sheet.decision.own_team)} onClose={() => setSheet(null)} onSaved={saved} /> : null}
    </div>
  );
}

/**
 * Tabelle einer Staffel samt Gleichstand-Entscheid (#2262, Paket B: Reiter „Tabelle“ der Staffel-Seite, Entscheidung Nr. 190): die Zeilen
 * wie öffentlich mit Zonen für Auf- und Abstieg, darunter offene Gleichstände und die Entscheide der Leitung. Lesen darf jede
 * Zuständigkeit, entscheiden „Ergebnisse korrigieren“ (`canDecide`) - der Server prüft es und die Befangenheit selbst.
 */
export function StaffelTablePanel({ tournamentId, label = "Tabelle", canDecide = false, pdfHref = "" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/admin/leagues/staffeln/${tournamentId}/table`);
      setData(body);
      setError("");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || "Die Tabelle ließ sich nicht laden.");
    }
  }, [tournamentId]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["tournaments", "matches"]);
  if (error && !data) {
    return (
      <div role="alert" className="flex flex-col gap-3 rounded-sm border border-warn/40 bg-warn/10 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="staffel-table-error">
        <p className="tls-type-small text-white/85 [overflow-wrap:anywhere]">Die Tabelle ließ sich nicht laden. <span className="block text-white/60">{error}</span></p>
        <button type="button" onClick={load} className="tls-btn tls-btn--secondary inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-sm px-4 tls-type-label">Nochmal versuchen</button>
      </div>
    );
  }
  if (!data) return <p className="tls-type-small text-white/60" aria-busy="true" data-testid="staffel-table-loading">Lade Tabelle …</p>;
  const rows = Array.isArray(data.standings) ? data.standings : [];
  return (
    <div className="space-y-5" data-testid={`staffel-table-${tournamentId}`}>
      <section className="space-y-2" aria-label={label}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="tls-type-section">Tabelle</h2>
          {pdfHref ? (
            <a href={pdfHref} target="_blank" rel="noreferrer" data-testid="staffel-pdf-standings"
              className="tls-btn tls-btn--quiet inline-flex min-h-[44px] items-center justify-center gap-2 rounded-sm px-4 tls-type-label">
              <FileDown className="h-4 w-4" aria-hidden="true" /> PDF Tabelle
            </a>
          ) : null}
        </div>
        {/* Namen umbrechen, Form am Handy weg, voller Name im `title` - wie in allen Tabellen (StandingsTable, #2498).
            Hier bleiben dazu # und Name beim seitlichen Wischen (große Schrift) stehen (index.css, `.staffel-standings`). */}
        <div className="staffel-standings min-w-0" data-testid="staffel-standings">
          <StandingsTable rows={rows} kind="team_league" label={label} mineLabel="Dein Team" hideDraws={hidesDraws(data.rules, rows)} mapPoints={byMaps(data.rules)} />
        </div>
        <ZoneLegend rows={rows} testId="staffel-table-zones" />
      </section>
      <section id="gleichstand" className="scroll-mt-24 rounded-sm border border-white/10 bg-[#121212] p-4">
        <StaffelTies tournamentId={tournamentId} label={label} data={data} canDecide={canDecide} onSaved={load} />
        <p className="mt-3 flex items-center gap-1.5 tls-type-small text-white/60"><Scale className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Kampflos, Austritt und „beide nicht erschienen“ rechnet die Tabelle nach den Regeln der Season.</p>
      </section>
    </div>
  );
}

/**
 * Season-Reiter „Tabelle“ (#2262, Entscheidung Nr. 190): Die Regeln stehen in der Season, Tabelle und Gleichstand-Entscheid je Staffel auf
 * ihrer Seite - hier nur der Weg dorthin, damit jeder Entscheid an genau einer Stelle steht.
 */
export function SeasonTableLinks({ divisions = [] }) {
  const staffeln = divisions.flatMap((division) => (division.staffeln || [])
    .map((staffel) => ({ ...staffel, label: `${division.label} · Staffel ${staffel.staffel}` })));
  if (!staffeln.length) return null;
  return (
    <FormSection title="Tabellen der Staffeln" testId="season-table-links"
      hint="Tabelle, Zonen und Gleichstand-Entscheid stehen auf der Seite jeder Staffel.">
      <ul className="divide-y divide-white/5 rounded-sm border border-white/10">
        {staffeln.map((staffel) => (staffelBeforeStart(staffel) ? (
          // Vor dem Start gibt es noch keine Tabelle - kein Weg auf eine leere Seite.
          <li key={staffel.tournament_id} className="flex min-h-[44px] items-center justify-between gap-3 px-3 tls-type-small text-white/70"
            data-testid={`season-table-none-${staffel.tournament_id}`}>
            <span className="min-w-0 [overflow-wrap:anywhere]">{staffel.label}</span>
            <span className="shrink-0 tls-type-small text-white/60">noch keine Tabelle</span>
          </li>
        ) : (
          <li key={staffel.tournament_id}>
            <Link to={staffelAdminUrl(staffel.tournament_id, "tabelle")} data-testid={`season-table-open-${staffel.tournament_id}`}
              className="flex min-h-[44px] items-center justify-between gap-3 px-3 tls-type-small font-semibold text-white/85 hover:bg-white/5 hover:text-white">
              <span className="min-w-0 [overflow-wrap:anywhere]">{staffel.label}</span>
              <span className="inline-flex shrink-0 items-center gap-1 tls-type-label text-[#29B6E8]">Tabelle öffnen <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
            </Link>
          </li>
        )))}
      </ul>
    </FormSection>
  );
}
