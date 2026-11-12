// Reiter „Proteste“ der Season-Seite (#1619, E.2, docs/LIGA.md „D.5/E.2-Vertrag“): oben der Eingang der Verfahren für die Leitung
// mit „Proteste“ (Sprungmarke `#verfahren`), darunter die Einstellungen je Season - Fristen, Gründe zum Antippen und die Wirkung
// auf die Tabelle (Sprungmarke `#protestregeln`, eigenes Speichern, gilt sofort in allen nicht gesperrten Staffeln). Entschieden wird
// auf der Matchseite, an der Karte des Verfahrens - hier steht nur, was wartet.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { SelectField, TextField } from "@/components/tls/FormFields";
import { api, formatApiError } from "@/lib/api";
import { PROCEDURE_STATE_LABELS, deadlineTone, remainingText } from "@/lib/leagueProcedures";
import { viennaDateTime } from "@/lib/vienna";

const NUMBER_FIELDS = [
  ["protest_hours", "Protestfrist (Stunden)", "ab der Bestätigung des Ergebnisses"],
  ["statement_hours", "Stellungnahme der Gegenseite (Stunden)", "ab der Benachrichtigung; die Leitung kann verlängern"],
  ["protest_target_hours", "Zielfrist der Leitung (Stunden)", "ab „Übernehmen“; danach Erinnerung und Eskalation, nie eine automatische Entscheidung"],
  ["protest_escalate_hours", "Eskalation an die Liga-Leitung (Stunden)", "nach der Zielfrist geht ein offenes Verfahren an „Liga verwalten“"],
  ["appeal_hours", "Einspruchsfrist (Stunden)", "ab Bekanntgabe der Entscheidung"],
  ["moss_upload_hours", "MOSS-Datei hochladen (Stunden)", "ab der Anforderung durch die Leitung"],
  ["evidence_keep_days", "Nachweise aufbewahren (Tage)", "nach dem Ende der Season; MOSS-Dateien nur bis Verfahrensende plus Einspruchsfrist"],
];
const MODE_OPTIONS = [
  ["counts", "Zählt vorläufig, markiert „in Klärung“"],
  ["excluded", "Zählt bis zur Entscheidung nicht"],
];
const TONE = { none: "text-white/55", calm: "text-white/70", soon: "text-warn", over: "text-[#FF6B60]" };
const WHEN = { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" };

/** Die Eingabe als Werte für den Server: ganze Zahlen, Gründe ohne leere Zeilen. */
export function protestSettingsPayload(form) {
  const out = { contested_result_mode: form.contested_result_mode };
  for (const [key] of NUMBER_FIELDS) {
    if (form[key] === "" || form[key] == null) continue;
    out[key] = Number.parseInt(String(form[key]), 10);
  }
  out.protest_reasons = (form.protest_reasons || []).filter((row) => row.label.trim() || row.fixed)
    .map((row) => ({ key: row.key, label: row.label.trim(), ask_notified: Boolean(row.ask_notified) }));
  return out;
}

/** Ein Schlüssel aus der Bezeichnung: Kleinbuchstaben, Ziffern, Unterstrich - eindeutig in der Liste. */
export function reasonKeyFor(label, taken = []) {
  const map = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };
  const base = String(label || "").toLowerCase().replace(/[äöüß]/g, (char) => map[char]).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "grund";
  let key = base;
  for (let index = 2; taken.includes(key); index += 1) key = `${base}_${index}`;
  return key;
}

function ProceduresInbox({ seasonId }) {
  const [state, setState] = useState({ status: "loading", items: [], open: 0 });
  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/admin/leagues/seasons/${seasonId}/procedures`);
      setState({ status: "ready", items: data.items || [], open: data.open || 0 });
    } catch (failure) {
      setState({ status: "error", items: [], open: 0, error: formatApiError(failure.response?.data?.detail) || "Die Verfahren ließen sich nicht laden." });
    }
  }, [seasonId]);
  useEffect(() => { load(); }, [load]);
  const now = Date.now();

  return (
    <FormSection title="Eingang der Verfahren" testId="season-procedures"
      hint="Beanstandungen, Proteste und Einsprüche dieser Season. Übernommen und entschieden wird auf der Matchseite - dort stehen Nachweise, Stellungnahme und MOSS.">
      {state.status === "loading" ? <p className="text-sm text-white/50">Verfahren werden geladen …</p> : null}
      {state.status === "error" ? <p className="text-sm text-warn" role="alert" data-testid="season-procedures-error">{state.error}</p> : null}
      {state.status === "ready" && !state.items.length ? <p className="text-sm text-white/60" data-testid="season-procedures-empty">Kein Verfahren in dieser Season.</p> : null}
      {state.items.length ? (
        <>
          <p className="text-sm text-white/75" data-testid="season-procedures-count"><strong className="text-white">{state.open}</strong> {state.open === 1 ? "Verfahren wartet" : "Verfahren warten"} auf eine Entscheidung.</p>
          <ul className="tls-stagger space-y-2" data-testid="season-procedures-list">
            {state.items.map((item) => {
              const deadline = item.target_at || item.statement?.due_at || null;
              return (
                <li key={item.id} className={`rounded-sm border bg-[#0A0A0A] p-3 ${item.state === "open" ? "border-honor/30" : "border-white/10"}`} data-testid={`season-procedure-${item.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold uppercase tracking-widest text-white/50">{item.staffel}</div>
                      <div className="font-bold text-white">{item.kind_label}{item.reason_label ? ` · ${item.reason_label}` : ""}</div>
                      <div className="text-sm text-white/70">{(item.sides || []).join(" gegen ")}{item.side_name ? ` · eingereicht von ${item.side_name}` : ""}</div>
                    </div>
                    <span className="shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white/70">{PROCEDURE_STATE_LABELS[item.state] || item.state}</span>
                  </div>
                  {item.conflict ? (
                    <p className="mt-2 text-xs text-warn" data-testid={`season-procedure-conflict-${item.id}`}>Du bist an diesem Spiel selbst beteiligt. Das entscheidet eine zweite berechtigte Person.</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
                      <span className="text-white/60">
                        {item.state === "open" ? (item.assignee ? `Übernommen von ${item.assignee.name}` : "Noch nicht übernommen") : `Entschieden ${item.resolved_at ? viennaDateTime(item.resolved_at, WHEN) : ""}`}
                        {item.state === "open" && deadline ? <span className={`ml-2 tabular-nums ${TONE[deadlineTone(deadline, now)]}`}>· {item.target_at ? "Zielfrist" : "Stellungnahme"} {remainingText(deadline, now)}</span> : null}
                      </span>
                      <Link to={`/matches/${item.match_id}#verfahren-${item.id}`} className="inline-flex min-h-11 items-center font-bold uppercase tracking-wider text-[#29B6E8] hover:underline" data-testid={`season-procedure-open-${item.id}`}>Zum Spiel</Link>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </FormSection>
  );
}

function ProtestSettings({ seasonId, canEdit }) {
  const [state, setState] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const take = (data) => {
    setState(data);
    setForm({ ...data.settings, protest_reasons: data.settings.protest_reasons.map((row) => ({ ...row, fixed: (data.fixed_reasons || []).includes(row.key) })) });
  };
  useEffect(() => {
    let alive = true;
    api.get(`/admin/leagues/seasons/${seasonId}/protest-settings`).then(({ data }) => alive && data?.settings && take(data))
      .catch((failure) => alive && setError(formatApiError(failure.response?.data?.detail) || "Die Einstellungen konnten nicht geladen werden."));
    return () => { alive = false; };
  }, [seasonId]);

  if (!form) return error ? <p className="text-sm text-warn" role="alert" data-testid="protest-settings-error">{error}</p> : null;
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const setReason = (index, patch) => set("protest_reasons", form.protest_reasons.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  const addReason = () => set("protest_reasons", [...form.protest_reasons, { key: reasonKeyFor(`grund ${form.protest_reasons.length + 1}`, form.protest_reasons.map((row) => row.key)), label: "", ask_notified: false, fresh: true }]);
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const keys = [];
      const reasons = form.protest_reasons.map((row) => {
        const key = row.fresh ? reasonKeyFor(row.label, keys.concat(form.protest_reasons.filter((other) => !other.fresh).map((other) => other.key))) : row.key;
        keys.push(key);
        return { ...row, key };
      });
      const { data } = await api.put(`/admin/leagues/seasons/${seasonId}/protest-settings`, protestSettingsPayload({ ...form, protest_reasons: reasons }));
      take(data);
      toast.success(data.staffeln_updated ? `Gespeichert – gilt jetzt in ${data.staffeln_updated} Staffel${data.staffeln_updated === 1 ? "" : "n"}.` : "Gespeichert.");
    } catch (failure) {
      setError(formatApiError(failure.response?.data?.detail) || "Die Einstellungen konnten nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSection title="Fristen, Gründe und Tabelle" testId="season-protest-settings"
      hint="Gilt sofort für alle Staffeln dieser Season (gesperrte nehmen es beim Übertragen mit). Laufende Verfahren behalten ihre Fristen. Alle Fristen ruhen in Sperrzeiten.">
      {!state?.active ? (
        <p className="rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/75" data-testid="protest-settings-defaults">
          Diese Season hat noch keine eigenen Werte gespeichert – es gelten die Vorgaben des Regelwerks.
        </p>
      ) : null}
      <fieldset disabled={!canEdit} className="space-y-5 disabled:opacity-70">
        <FormGrid cols={2}>
          {NUMBER_FIELDS.map(([key, label, hint]) => (
            <TextField key={key} label={label} type="number" min={state.limits?.[key]?.min} max={state.limits?.[key]?.max} value={form[key]}
              onChange={(value) => set(key, value)} hint={`${hint}; Vorgabe ${state.defaults[key]}`} testId={`protest-settings-${key}`} />
          ))}
          <SelectField label="Angefochtenes Ergebnis in der Tabelle" value={form.contested_result_mode} onChange={(value) => set("contested_result_mode", value)}
            options={MODE_OPTIONS} hint="Gilt für Proteste nach der Bestätigung. Eine Beanstandung davor hält das Spiel immer an." testId="protest-settings-mode" />
        </FormGrid>
        <div className="space-y-2" data-testid="protest-settings-reasons">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Gründe zum Antippen</div>
          <p className="text-xs text-white/50">„Sofort hingewiesen?“ stellt die Pflichtfrage, ob die Gegenseite sofort darauf angesprochen wurde (Regelwerk § 8.8). Die vier Grundgründe bleiben, damit auch die App melden kann.</p>
          {form.protest_reasons.map((row, index) => (
            <div key={row.key} className="grid grid-cols-[1fr_auto] items-center gap-2 sm:grid-cols-[1fr_auto_auto]">
              <TextField label={`Grund ${index + 1}`} maxLength={60} value={row.label} onChange={(value) => setReason(index, { label: value })} testId={`protest-reason-label-${index}`} />
              <label className="col-span-2 flex min-h-11 items-center gap-2 text-sm text-white/75 sm:col-span-1 sm:mt-5">
                <input type="checkbox" checked={Boolean(row.ask_notified)} onChange={(event) => setReason(index, { ask_notified: event.target.checked })} data-testid={`protest-reason-ask-${index}`} />
                Sofort hingewiesen?
              </label>
              {row.fixed ? <span className="row-start-1 col-start-2 text-[11px] uppercase tracking-wider text-white/40 sm:col-start-3 sm:mt-5">fest</span> : (
                <button type="button" onClick={() => set("protest_reasons", form.protest_reasons.filter((_, at) => at !== index))} aria-label={`Grund ${index + 1} entfernen`}
                  className="row-start-1 col-start-2 flex min-h-11 min-w-11 items-center justify-center rounded-sm text-white/50 hover:text-live focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] sm:col-start-3 sm:mt-5" data-testid={`protest-reason-remove-${index}`}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          {form.protest_reasons.length < (state.reasons_max || 20) ? (
            <button type="button" onClick={addReason} className="tls-btn tls-btn--quiet inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider" data-testid="protest-reason-add">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Grund hinzufügen
            </button>
          ) : null}
        </div>
      </fieldset>
      {error ? <p className="text-sm text-warn" role="alert" data-testid="protest-settings-error">{error}</p> : null}
      {canEdit ? (
        <button type="button" onClick={save} disabled={saving} data-testid="protest-settings-save"
          className="tls-btn tls-btn--primary min-h-11 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
          {saving ? "Speichere …" : "Proteste speichern"}
        </button>
      ) : null}
    </FormSection>
  );
}

export function SeasonProtestsTab({ seasonId, canSeason, canDisputes }) {
  return (
    <div className="space-y-6">
      {canDisputes ? <div id="verfahren" className="scroll-mt-24"><ProceduresInbox seasonId={seasonId} /></div> : null}
      <div id="protestregeln" className="scroll-mt-24"><ProtestSettings seasonId={seasonId} canEdit={canSeason} /></div>
    </div>
  );
}
