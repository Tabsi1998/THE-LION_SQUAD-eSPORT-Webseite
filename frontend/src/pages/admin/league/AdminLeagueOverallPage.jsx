// Gesamtwertung über Seasons verwalten (F.5, #2215, docs/LIGA.md „F.5“) unter /admin/leagues/<liga>/gesamtwertung - in Reitern wie die
// Season-Seite: Einstellungen (Punkte, Zählen, Gleichstand) · Zeiträume (welche Seasons zusammen zählen) · Abschluss (Vorschau je Liga N,
// Sperrgründe, Entscheid bei Gleichstand, abschließen und wieder öffnen) · Belohnungen (dieselbe Zusammenstellung wie F.4). Jeder Reiter
// speichert nur seine Felder. Lesen darf jede Zuständigkeit der Liga, ändern „Season konfigurieren“ - der Server prüft selbst.
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Crown, Gift, History, Lock, LockOpen, Plus, Scale, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { AdminTabBar } from "@/components/tls/AdminTabBar";
import { FormSection } from "@/components/tls/AdminForm";
import { SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { ConflictReasonField, OwnTeamNote, overrideMissing, overridePayload } from "@/components/tls/league/ConflictOverride";
import { LeagueEmblem } from "@/components/tls/league/public/LeagueLook";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { api, formatApiError } from "@/lib/api";
import { finalMoment, reopenProblem } from "@/lib/leagueFinal";
import { accentStyle } from "@/lib/leagueLook";
import {
  BEST_MAX, BONUS_MAX, COUNTING, METHODS, PERIOD_NAME_MAX, POINTS_MODES, TABLE_MAX, TIEBREAKERS, cellText, decisionProblem, periodsPayload,
  periodsProblem, periodsToForm, rulesLine, seasonColumns, settingsPayload, settingsProblem, settingsToForm, takenBy, tiebreakLine,
} from "@/lib/leagueOverall";
import { PLAYER_BASIS, listProblem, rewardPayload, rewardToForm } from "@/lib/leagueRewards";
import { RewardList } from "./SeasonRewardsTab";

const TABS = [
  { key: "einstellungen", label: "Einstellungen" },
  { key: "zeitraeume", label: "Zeiträume" },
  { key: "abschluss", label: "Abschluss" },
  { key: "belohnungen", label: "Belohnungen" },
];
const BUTTON = "tls-btn inline-flex min-h-11 items-center gap-1.5 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50";
const SMALL = "tls-btn tls-btn--quiet inline-flex min-h-11 items-center gap-1.5 rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider disabled:opacity-40";
const ICON = "tls-btn tls-btn--quiet inline-flex h-11 w-11 items-center justify-center rounded-sm disabled:opacity-30";

function errorOf(failure, fallback) {
  return formatApiError(failure.response?.data?.detail) || fallback;
}

function SaveBar({ dirty, problem, saving, onSave, onDiscard, label, testId }) {
  return (
    <div className="sticky bottom-3 z-10 mt-6 flex flex-wrap items-center justify-end gap-3 rounded-sm border border-white/10 bg-[#0A0A0A]/95 p-3" data-testid={`${testId}-bar`}>
      <span className={`mr-auto text-xs ${problem ? "text-warn" : "text-white/60"}`} role={problem ? "alert" : undefined}>{problem || (dirty ? "Nicht gespeichert." : "Gespeichert.")}</span>
      {dirty ? <button type="button" onClick={onDiscard} className={`${BUTTON} tls-btn--quiet`} data-testid={`${testId}-discard`}>Verwerfen</button> : null}
      <button type="button" onClick={onSave} disabled={!dirty || saving || Boolean(problem)} className={`${BUTTON} tls-btn--primary`} data-testid={`${testId}-save`}>{label}</button>
    </div>
  );
}

function Choice({ name, rows, value, onChange, readOnly, testId }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {rows.map((row) => (
        <label key={row.key} className={`flex cursor-pointer items-start gap-3 rounded-sm border p-3 transition-colors ${value === row.key ? "border-[#29B6E8]/60 bg-[#29B6E8]/5" : "border-white/10 hover:border-white/25"}`}>
          <input type="radio" name={name} value={row.key} checked={value === row.key} disabled={readOnly} onChange={() => onChange(row.key)}
            className="mt-1 h-4 w-4 accent-[var(--tls-cyan)]" data-testid={`${testId}-${row.key}`} />
          <span>
            <span className="block text-sm font-semibold text-white">{row.label}</span>
            {row.hint ? <span className="block text-xs text-white/55">{row.hint}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Reiter „Einstellungen“

function SettingsTab({ data, onSaved }) {
  const [form, setForm] = useState(() => settingsToForm(data));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm(settingsToForm(data)); }, [data]);
  const saved = useMemo(() => JSON.stringify(settingsPayload(settingsToForm(data))), [data]);
  const dirty = JSON.stringify(settingsPayload(form)) !== saved;
  const problem = settingsProblem(form);
  const readOnly = !data.can_edit;
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const move = (index, step) => setForm((current) => {
    const next = [...current.tiebreakers];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    return { ...current, tiebreakers: next };
  });
  const toggle = (key) => set("tiebreakers", form.tiebreakers.includes(key) ? form.tiebreakers.filter((item) => item !== key) : [...form.tiebreakers, key]);
  const save = async () => {
    setSaving(true);
    try {
      onSaved((await api.put(`/admin/leagues/${data.league.id}/overall`, settingsPayload(form))).data);
      toast.success("Einstellungen gespeichert. Laufende Wertungen rechnen sofort neu, abgeschlossene bleiben fest.");
    } catch (failure) {
      toast.error(errorOf(failure, "Speichern ging nicht."));
    }
    setSaving(false);
  };
  return (
    <div className="space-y-6" data-testid="overall-settings">
      {readOnly ? <p className="text-xs text-white/55" data-testid="overall-readonly">Ändern darf, wer „Season konfigurieren“ hat.</p> : null}
      <FormSection title="Punkte je Season-Platz" testId="overall-points"
        hint="Jede Liga N hat ihre eigene Gesamtwertung. Gerechnet wird aus dem festen Endstand jeder Season, je Staffel – Ausgeschiedene bekommen 0, ein geteilter Platz dieselben Punkte.">
        <Choice name="points-mode" rows={POINTS_MODES} value={form.points_mode} onChange={(value) => set("points_mode", value)} readOnly={readOnly} testId="overall-points-mode" />
        {form.points_mode === "table" ? (
          <fieldset className="mt-4">
            <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Punkte für Platz</legend>
            <ol className="mt-2 flex flex-wrap gap-2" data-testid="overall-points-table">
              {form.points_table.map((value, index) => (
                <li key={index} className="flex items-end gap-1">
                  <TextField label={`${index + 1}.`} type="number" min={0} max={999} value={value} disabled={readOnly} className="w-20"
                    onChange={(next) => set("points_table", form.points_table.map((item, at) => (at === index ? next : item)))} testId={`overall-points-place-${index + 1}`} />
                </li>
              ))}
            </ol>
            {readOnly ? null : (
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={SMALL} disabled={form.points_table.length >= TABLE_MAX} data-testid="overall-points-add"
                  onClick={() => set("points_table", [...form.points_table, String(Math.max(0, Number(form.points_table.at(-1) || 1) - 1))])}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Platz dazu
                </button>
                <button type="button" className={SMALL} disabled={!form.points_table.length} onClick={() => set("points_table", form.points_table.slice(0, -1))}
                  data-testid="overall-points-remove">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Letzten Platz entfernen
                </button>
              </div>
            )}
          </fieldset>
        ) : null}
        <div className="mt-4 max-w-xs">
          <TextField label="Zusatzpunkte für Platz 1 der Staffel" type="number" min={0} max={BONUS_MAX} value={form.champion_bonus} disabled={readOnly}
            onChange={(value) => set("champion_bonus", value)} hint="In der obersten Liga N der Meister, sonst der Staffelsieger. Vorgabe 2." testId="overall-bonus" />
        </div>
      </FormSection>

      <FormSection title="Welche Seasons zählen" testId="overall-counting" hint="Alle Seasons des Zeitraums oder nur die besten – die übrigen stehen als Streichergebnis in der Tabelle.">
        <Choice name="counting" rows={COUNTING} value={form.counting} onChange={(value) => set("counting", value)} readOnly={readOnly} testId="overall-counting" />
        {form.counting === "best" ? (
          <div className="mt-4 max-w-xs">
            <TextField label="Wie viele zählen" type="number" min={1} max={BEST_MAX} value={form.best_count} disabled={readOnly}
              onChange={(value) => set("best_count", value)} testId="overall-best" />
          </div>
        ) : null}
      </FormSection>

      <FormSection title="Gleichstand" testId="overall-tiebreak" hint="Bei gleicher Summe gilt diese Reihenfolge. Steht danach Platz 1 noch gleich, entscheidet die Leitung im Reiter „Abschluss“.">
        <ol className="space-y-2" aria-label="Reihenfolge bei Gleichstand">
          {[...form.tiebreakers, ...TIEBREAKERS.map((row) => row.key).filter((key) => !form.tiebreakers.includes(key))].map((key) => {
            const active = form.tiebreakers.includes(key);
            const index = form.tiebreakers.indexOf(key);
            const label = TIEBREAKERS.find((row) => row.key === key)?.label;
            return (
              <li key={key} className={`flex items-center gap-2 rounded-sm border p-2 ${active ? "border-white/15" : "border-dashed border-white/10 opacity-70"}`} data-testid={`overall-tiebreak-${key}`}>
                <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3 text-sm text-white">
                  <input type="checkbox" checked={active} disabled={readOnly} onChange={() => toggle(key)} className="h-4 w-4 accent-[var(--tls-cyan)]" />
                  {active ? <span className="w-5 text-right font-bold text-[#29B6E8]">{index + 1}.</span> : <span className="w-5" />}
                  {label}
                </label>
                {active && !readOnly ? (
                  <>
                    <button type="button" className={ICON} disabled={index === 0} onClick={() => move(index, -1)} aria-label={`${label} nach oben`}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
                    <button type="button" className={ICON} disabled={index === form.tiebreakers.length - 1} onClick={() => move(index, 1)} aria-label={`${label} nach unten`}>
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </>
                ) : null}
              </li>
            );
          })}
        </ol>
      </FormSection>
      {readOnly ? null : (
        <SaveBar dirty={dirty} problem={problem} saving={saving} onSave={save} onDiscard={() => setForm(settingsToForm(data))} label="Einstellungen speichern" testId="overall-settings" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Reiter „Zeiträume“

function PeriodsTab({ data, onSaved }) {
  const [rows, setRows] = useState(() => periodsToForm(data.periods));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setRows(periodsToForm(data.periods)); }, [data]);
  const names = Object.fromEntries((data.seasons || []).map((row) => [row.id, row.name]));
  const dirty = JSON.stringify(periodsPayload(rows)) !== JSON.stringify(periodsPayload(periodsToForm(data.periods)));
  const problem = periodsProblem(rows, names);
  const readOnly = !data.can_edit;
  const update = (key, patch) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const save = async () => {
    setSaving(true);
    try {
      onSaved((await api.put(`/admin/leagues/${data.league.id}/overall`, { periods: periodsPayload(rows) })).data);
      toast.success("Zeiträume gespeichert.");
    } catch (failure) {
      toast.error(errorOf(failure, "Speichern ging nicht."));
    }
    setSaving(false);
  };
  return (
    <div className="space-y-4" data-testid="overall-periods">
      <FormSection title="Wertungszeiträume" testId="overall-periods-section"
        hint="Welche Seasons zusammen eine Gesamtwertung bilden – etwa ein Jahr oder Season 1 bis 4. Eine Season gehört zu höchstens einem Zeitraum. Ohne Zeitraum gibt es keine Gesamtwertung.">
        {!rows.length ? <p className="text-sm text-white/55" data-testid="overall-periods-empty">Noch kein Zeitraum.</p> : null}
        <ul className="space-y-4">
          {rows.map((row, index) => {
            const locked = row.closed_levels.length > 0;
            return (
              <li key={row.key} className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3 sm:p-4" data-testid={`overall-period-${index}`}>
                <div className="flex flex-wrap items-end gap-3">
                  <TextField label="Name" value={row.name} maxLength={PERIOD_NAME_MAX} disabled={readOnly} className="min-w-[12rem] flex-1"
                    placeholder="z. B. 2027" onChange={(value) => update(row.key, { name: value })} testId={`overall-period-name-${index}`} />
                  {readOnly || locked ? null : (
                    <button type="button" className={`${ICON} tls-btn--danger`} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                      aria-label={`${row.name || "Zeitraum"} entfernen`} data-testid={`overall-period-remove-${index}`}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                {locked ? (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-[#29B6E8]" data-testid={`overall-period-locked-${index}`}>
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Abgeschlossen ({row.closed_levels.map((level) => `Liga ${level}`).join(", ")}) – die Seasons bleiben, bis im Reiter „Abschluss“ wieder geöffnet ist.
                  </p>
                ) : null}
                <fieldset className="mt-3">
                  <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Seasons</legend>
                  <div className="mt-1 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    {(data.seasons || []).map((season) => {
                      const other = takenBy(rows, season.id, row.key);
                      return (
                        <label key={season.id} className={`flex min-h-11 items-center gap-2 text-sm ${other ? "text-white/40" : "cursor-pointer text-white/85"}`}>
                          <input type="checkbox" checked={row.season_ids.includes(season.id)} disabled={readOnly || locked || Boolean(other)}
                            onChange={() => update(row.key, { season_ids: row.season_ids.includes(season.id) ? row.season_ids.filter((id) => id !== season.id) : [...row.season_ids, season.id] })}
                            className="h-4 w-4 accent-[var(--tls-cyan)]" data-testid={`overall-period-${index}-season-${season.number}`} />
                          <span className="min-w-0 break-words">{season.name}{other ? ` · in „${other}“` : ""}{season.visibility === "off" ? " · nicht sichtbar" : ""}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              </li>
            );
          })}
        </ul>
        {readOnly ? null : (
          <button type="button" className={`${SMALL} mt-3`} data-testid="overall-period-add"
            onClick={() => setRows((current) => [...current, { key: `neu-${Date.now()}`, id: null, name: "", season_ids: [], closed_levels: [] }])}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Zeitraum anlegen
          </button>
        )}
      </FormSection>
      {readOnly ? null : (
        <SaveBar dirty={dirty} problem={problem} saving={saving} onSave={save} onDiscard={() => setRows(periodsToForm(data.periods))} label="Zeiträume speichern" testId="overall-periods" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Reiter „Abschluss“

function Preview({ block, seasons, kind, testId }) {
  const rows = kind === "teams" ? block.teams : block.players;
  const columns = seasonColumns(seasons, block.season_ids);
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- eine scrollbare Fläche muss per Tastatur erreichbar sein (axe: scrollable-region-focusable)
    <div role="region" aria-label={`${kind === "teams" ? "Co-Teams" : "Spieler"} ${block.label}`} tabIndex={0} className="tls-swipe rounded-sm border border-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#29B6E8]">
      <table className="w-full text-sm tabular-nums" data-testid={testId}>
        <thead className="text-[11px] uppercase tracking-[0.12em] text-white/50">
          <tr className="border-b border-white/10">
            <th scope="col" className="py-2 pl-3 pr-1 text-left">#</th>
            <th scope="col" className="px-2 py-2 text-left">{kind === "teams" ? "Co-Team" : "Spieler"}</th>
            {columns.map((column) => <th key={column.id} scope="col" className="hidden px-2 py-2 text-right sm:table-cell">{column.name}</th>)}
            <th scope="col" className="py-2 pl-2 pr-3 text-right">Summe</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key || index} className="border-t border-white/5">
              <td className="py-2 pl-3 pr-1 font-bold text-white">{row.place}.</td>
              <td className="px-2 py-2 text-white [overflow-wrap:anywhere]">
                {row.name}{row.tie ? <span className="ml-2 text-[10px] font-bold uppercase text-warn">gleich</span> : null}
                {row.lead_decision ? <span className="block text-[11px] text-white/50">{row.lead_decision.method_label}: {row.lead_decision.reason}</span> : null}
              </td>
              {row.seasons.map((cell, at) => (
                <td key={cell.season_id} title={cellText(cell, columns[at]?.name)}
                  className={`hidden px-2 py-2 text-right sm:table-cell ${!cell.played ? "text-white/25" : cell.counted ? "text-white/80" : "text-white/35 line-through"}`}>
                  {cell.played ? (cell.exit ? "ausg." : cell.points) : "–"}
                </td>
              ))}
              <td className="py-2 pl-2 pr-3 text-right font-bold text-white">{row.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length ? <p className="px-3 py-6 text-center text-sm text-white/45">Noch niemand in der Wertung.</p> : null}
    </div>
  );
}

function CloseSheet({ block, data, superadmin, onClose, onDone }) {
  const [conflictReason, setConflictReason] = useState("");
  const [saving, setSaving] = useState(false);
  const override = Boolean(block.own_team) && superadmin;
  const leader = block.teams.find((row) => row.place === 1);
  const submit = async (event) => {
    event.preventDefault();
    if (overrideMissing(override, conflictReason)) {
      toast.error("Bitte den Grund für die Notausnahme mit mindestens 5 Zeichen angeben.");
      return;
    }
    setSaving(true);
    try {
      const { data: body } = await api.post(`/admin/leagues/${data.leagueId}/overall/${data.period.id}/levels/${block.level}/close`,
        { confirm: true, ...overridePayload(override, conflictReason) });
      toast.success(`Gesamtwertung abgeschlossen.${body.rewards ? ` ${body.rewards} Belohnungen vergeben.` : ""}`);
    } catch (failure) {
      toast.error(errorOf(failure, "Abschließen hat nicht geklappt."));
    }
    onDone();
  };
  return (
    <AdminSheet title="Gesamtwertung abschließen" eyebrow={`${data.period.name} · ${block.label}`} onClose={onClose} onSubmit={submit} saving={saving}
      submitLabel="Jetzt abschließen" savingLabel="Schließe ab …" submitTestId="overall-close-confirm" testId="overall-close-sheet">
      <div className="space-y-3 text-sm text-white/75">
        <p>Der Endstand der Gesamtwertung wird festgehalten: Plätze, Punkte je Season, Entscheide und die Einstellungen von jetzt.</p>
        <ul className="list-disc space-y-1 pl-5 text-white/65">
          <li>Ein neuer Endstand einer Season oder geänderte Punkte ändern ihn danach nicht mehr.</li>
          <li>Die Belohnungen der Gesamtwertung werden vergeben – wer etwas bekommt, erhält eine Nachricht.</li>
          <li>Korrigieren geht nur über „Wieder öffnen“ – das macht eine zweite Person, mit Grund.</li>
        </ul>
        {leader ? (
          <p className="flex items-center gap-2 rounded-sm border border-honor/40 bg-honor/5 px-3 py-2 text-white" data-testid="overall-close-leader">
            <Crown className="h-4 w-4 shrink-0 text-honor" aria-hidden="true" /> Gesamtsieger: <strong className="min-w-0 break-words">{leader.name}</strong>
          </p>
        ) : null}
      </div>
      {override ? <div className="mt-4"><ConflictReasonField value={conflictReason} onChange={setConflictReason} testId="overall-close-conflict" /></div> : null}
    </AdminSheet>
  );
}

function ReopenSheet({ block, data, superadmin, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [emergencyReason, setEmergencyReason] = useState("");
  const [conflictReason, setConflictReason] = useState("");
  const [saving, setSaving] = useState(false);
  const needsEmergency = Boolean(block.closed_by_me) && superadmin;
  const needsConflict = Boolean(block.own_team) && superadmin;
  const submit = async (event) => {
    event.preventDefault();
    const problem = reopenProblem({ reason, needsEmergency, emergencyReason, needsConflict, conflictReason });
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      await api.post(`/admin/leagues/${data.leagueId}/overall/${data.period.id}/levels/${block.level}/reopen`, {
        reason: reason.trim(), ...(needsEmergency ? { emergency_reason: emergencyReason.trim() } : {}), ...overridePayload(needsConflict, conflictReason) });
      toast.success("Gesamtwertung wieder geöffnet. Die alte Fassung bleibt im Verlauf.");
      onDone();
    } catch (failure) {
      toast.error(errorOf(failure, "Wieder öffnen hat nicht geklappt."));
      setSaving(false);
    }
  };
  return (
    <AdminSheet title="Gesamtwertung wieder öffnen" eyebrow={`${data.period.name} · ${block.label}`} onClose={onClose} onSubmit={submit} saving={saving} noValidate
      submitLabel="Wieder öffnen" savingLabel="Öffne …" submitTestId="overall-reopen-confirm" testId="overall-reopen-sheet">
      <p className="text-sm text-white/75">Die Wertung rechnet wieder aus den Endständen der Seasons. Fassung {block.final?.version} bleibt im Verlauf, die Belohnungen ruhen, bis neu abgeschlossen ist.</p>
      <div className="mt-4">
        <TextAreaField label="Grund" rows={3} value={reason} onChange={setReason} required placeholder="z. B. Endstand von Season 2 wurde korrigiert"
          hint="Pflicht. Steht im Verlauf und im Protokoll." testId="overall-reopen-reason" />
      </div>
      {needsEmergency ? (
        <div className="mt-4 space-y-2 rounded-sm border border-warn/40 p-3">
          <p className="text-xs font-semibold text-white/80">Du hast selbst abgeschlossen. Wieder öffnen soll eine zweite Person.</p>
          <TextAreaField label="Grund für die Notausnahme" rows={2} value={emergencyReason} onChange={setEmergencyReason} required testId="overall-reopen-emergency" />
        </div>
      ) : null}
      {needsConflict ? <div className="mt-4"><ConflictReasonField value={conflictReason} onChange={setConflictReason} testId="overall-reopen-conflict" /></div> : null}
    </AdminSheet>
  );
}

function DecideSheet({ block, tie, data, superadmin, onClose, onDone }) {
  const [order, setOrder] = useState(() => tie.keys.map((key, index) => ({ key, name: tie.names[index] })));
  const [method, setMethod] = useState("");
  const [reason, setReason] = useState("");
  const [conflictReason, setConflictReason] = useState("");
  const [saving, setSaving] = useState(false);
  const override = Boolean(tie.own_team) && superadmin;
  const move = (index, step) => setOrder((current) => {
    const next = [...current];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    return next;
  });
  const submit = async (event) => {
    event.preventDefault();
    const problem = decisionProblem({ method, reason }) || (overrideMissing(override, conflictReason) ? "Bitte den Grund für die Notausnahme angeben." : "");
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      await api.put(`/admin/leagues/${data.leagueId}/overall/${data.period.id}/levels/${block.level}/decision`, {
        keys: order.map((row) => row.key), method, reason: reason.trim(), ...overridePayload(override, conflictReason) });
      toast.success("Entscheid gespeichert.");
      onDone();
    } catch (failure) {
      toast.error(errorOf(failure, "Der Entscheid ging nicht."));
      setSaving(false);
    }
  };
  return (
    <AdminSheet title={`Platz ${tie.place} entscheiden`} eyebrow={`${data.period.name} · ${block.label}`} onClose={onClose} onSubmit={submit} saving={saving} noValidate
      submitLabel="Entscheid speichern" submitTestId="overall-decide-confirm" testId="overall-decide-sheet">
      <p className="text-sm text-white/75">Diese Co-Teams stehen mit {tie.total} Punkten nach allen Kriterien gleich. Lege die Reihenfolge fest – sie gilt, solange genau diese Teams gleich stehen.</p>
      <ol className="mt-3 space-y-2">
        {order.map((row, index) => (
          <li key={row.key} className="flex items-center gap-2 rounded-sm border border-white/10 p-2">
            <span className="w-6 text-right font-bold text-[#29B6E8]">{tie.place + index}.</span>
            <span className="min-w-0 flex-1 break-words text-sm text-white">{row.name}</span>
            <button type="button" className={ICON} disabled={index === 0} onClick={() => move(index, -1)} aria-label={`${row.name} nach oben`}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" className={ICON} disabled={index === order.length - 1} onClick={() => move(index, 1)} aria-label={`${row.name} nach unten`}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
          </li>
        ))}
      </ol>
      <div className="mt-4 grid gap-3">
        <SelectField label="Wie entschieden" value={method} onChange={setMethod} required testId="overall-decide-method"
          options={[["", "Bitte wählen"], ...METHODS.map((row) => [row.key, row.label])]} />
        <TextAreaField label="Grund" rows={2} value={reason} onChange={setReason} required testId="overall-decide-reason" placeholder="z. B. Entscheidungsspiel am 12.01. gewonnen" />
      </div>
      {override ? <div className="mt-4"><ConflictReasonField value={conflictReason} onChange={setConflictReason} testId="overall-decide-conflict" /></div> : null}
    </AdminSheet>
  );
}

function LevelCard({ block, data, onSheet, onUndecide }) {
  const [kind, setKind] = useState("teams");
  const testId = `overall-level-${block.level}`;
  const state = block.closed ? { label: "Abgeschlossen", tone: "border-[#29B6E8]/50 text-[#29B6E8]" }
    : block.blockers.length ? { label: "Noch offen", tone: "border-warn/50 text-warn" } : { label: "Bereit", tone: "border-ok/50 text-ok" };
  return (
    <section className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3 sm:p-4" aria-label={block.label} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading text-lg font-black uppercase text-white">{block.label}</h3>
        <span className={`rounded-sm border px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${state.tone}`} data-testid={`${testId}-state`}>{state.label}</span>
      </div>
      {block.closed ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-white/75"><Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#29B6E8]" aria-hidden="true" />
          <span>Abgeschlossen am {finalMoment(block.final.closed_at)} von {block.final.closed_by_name} · Fassung {block.final.version}
            {block.rewards ? ` · ${block.rewards} ${block.rewards === 1 ? "Belohnung" : "Belohnungen"} vergeben` : ""}</span></p>
      ) : block.blockers.length ? (
        <ul className="mt-3 space-y-2" aria-label="Was noch fehlt" data-testid={`${testId}-blockers`}>
          {block.blockers.map((blocker) => (
            <li key={blocker.code} className="rounded-sm border border-warn/30 bg-warn/5 p-3 text-sm" data-testid={`${testId}-blocker-${blocker.code}`}>
              <p className="font-semibold text-white">{blocker.label}</p>
              <p className="mt-0.5 text-xs text-white/65">{blocker.text}</p>
              {blocker.items.length ? (
                <ul className="mt-1 space-y-0.5 text-xs">
                  {blocker.items.map((item) => (
                    <li key={item.text}>{item.url ? <Link to={item.url} className="text-[#29B6E8] hover:underline">{item.text}</Link> : item.text}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 flex items-start gap-2 text-sm text-ok" data-testid={`${testId}-ready`}>
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> Alle Seasons dieser Liga N sind abgeschlossen, Platz 1 steht fest.
        </p>
      )}

      {block.ties.length ? (
        <div className="mt-3 space-y-2" data-testid={`${testId}-ties`}>
          {block.ties.map((tie) => (
            <div key={tie.place} className="flex flex-wrap items-center gap-2 rounded-sm border border-white/10 p-2 text-sm">
              <Scale className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
              <span className="min-w-0 flex-1 break-words text-white/80">Platz {tie.place}: {tie.names.join(" – ")}</span>
              {block.can_decide && !(tie.own_team && !data.superadmin) ? (
                <button type="button" className={SMALL} onClick={() => onSheet({ kind: "decide", block, tie })} data-testid={`${testId}-decide-${tie.place}`}>Entscheiden</button>
              ) : tie.own_team ? <OwnTeamNote /> : null}
            </div>
          ))}
        </div>
      ) : null}
      {block.decisions.length ? (
        <ul className="mt-3 space-y-1 text-xs text-white/65" data-testid={`${testId}-decisions`}>
          {block.decisions.map((decision) => (
            <li key={decision.id} className="flex flex-wrap items-center gap-2">
              <span>Entscheid ({decision.method_label}): {decision.names.join(" vor ")} – {decision.reason}</span>
              {block.can_decide ? <button type="button" className="text-[#29B6E8] hover:underline min-h-11" onClick={() => onUndecide(block, decision)}>Zurücknehmen</button> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">{block.closed ? "Endstand" : "Vorschau"}</h4>
          <div className="flex gap-1" role="group" aria-label="Wertung">
            {[["teams", "Co-Teams"], ["players", "Spieler"]].map(([key, text]) => (
              <button key={key} type="button" aria-pressed={kind === key} onClick={() => setKind(key)} data-testid={`${testId}-${key}`}
                className={`min-h-11 rounded-sm border px-3 text-[11px] font-bold uppercase tracking-wider ${kind === key ? "border-[#29B6E8]/60 text-white" : "border-white/10 text-white/55"}`}>{text}</button>
            ))}
          </div>
        </div>
        <Preview block={block} seasons={data.seasons} kind={kind} testId={`${testId}-${kind}`} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!block.closed && data.can_act && block.own_team && !data.superadmin ? <OwnTeamNote testId={`${testId}-own`} /> : null}
        {!block.closed && data.can_act && !(block.own_team && !data.superadmin) ? (
          <button type="button" disabled={!block.can_close} onClick={() => onSheet({ kind: "close", block })} className={`${BUTTON} tls-btn--primary`} data-testid={`${testId}-close`}>
            <Lock className="h-4 w-4" aria-hidden="true" /> Gesamtwertung abschließen
          </button>
        ) : null}
        {block.closed && block.can_reopen ? (
          <button type="button" onClick={() => onSheet({ kind: "reopen", block })} className={`${BUTTON} tls-btn--secondary`} data-testid={`${testId}-reopen`}>
            <LockOpen className="h-4 w-4" aria-hidden="true" /> Wieder öffnen
          </button>
        ) : null}
        {block.closed && data.can_act && !block.can_reopen ? (
          <p className="text-xs font-semibold text-white/80">{block.closed_by_me ? "Du hast abgeschlossen. Wieder öffnen muss eine zweite Person." : "Über dein eigenes Team entscheidet eine andere Person."}</p>
        ) : null}
        {!data.can_act ? <span className="text-xs text-white/55">Abschließen und wieder öffnen darf, wer „Season konfigurieren“ hat.</span> : null}
      </div>

      {block.history.length ? (
        <div className="mt-4 border-t border-white/10 pt-3">
          <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-white/50"><History className="h-3.5 w-3.5" aria-hidden="true" /> Verlauf</h4>
          <ul className="space-y-1.5 text-xs text-white/70" data-testid={`${testId}-history`}>
            {block.history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap gap-x-3 gap-y-1">
                <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${entry.active ? "border-[#29B6E8]/50 text-[#29B6E8]" : "border-white/15 text-white/50"}`}>{entry.active ? "Gilt" : "Ersetzt"}</span>
                <span className="text-white">Fassung {entry.version} · {finalMoment(entry.closed_at)} · {entry.closed_by_name}</span>
                {entry.leader ? <span>Platz 1: {entry.leader}</span> : null}
                {entry.reopened_at ? <span className="min-w-0 break-words">wieder geöffnet von {entry.reopened_by_name}: „{entry.reopen_reason}“</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function CloseTab({ data: settings }) {
  const periods = settings.periods || [];
  const [periodId, setPeriodId] = useState(periods[0]?.id || "");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState(null);
  const current = periods.some((row) => row.id === periodId) ? periodId : periods[0]?.id;
  const load = useCallback(async () => {
    if (!current) return;
    try {
      const { data: body } = await api.get(`/admin/leagues/${settings.league.id}/overall/${current}`);
      setData({ ...body, leagueId: settings.league.id });
      setError("");
    } catch (failure) {
      setError(errorOf(failure, "Der Abschluss konnte nicht geladen werden."));
    }
  }, [current, settings.league.id]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["leagues", "tournaments"]);
  const done = () => {
    setSheet(null);
    load();
  };
  const undecide = async (block, decision) => {
    try {
      await api.delete(`/admin/leagues/${settings.league.id}/overall/${current}/levels/${block.level}/decision/${decision.id}`);
      toast.success("Entscheid zurückgenommen.");
      load();
    } catch (failure) {
      toast.error(errorOf(failure, "Zurücknehmen ging nicht."));
    }
  };
  if (!periods.length) return <p className="text-sm text-white/60" data-testid="overall-close-empty">Zuerst im Reiter „Zeiträume“ einen Zeitraum mit Seasons anlegen.</p>;
  return (
    <FormSection title="Abschluss der Gesamtwertung" testId="overall-close"
      hint="Abgeschlossen wird je Liga N, wenn alle Seasons des Zeitraums abgeschlossen sind. Danach steht die Wertung fest und die Belohnungen werden vergeben.">
      {periods.length > 1 ? (
        <div className="mb-4 max-w-sm">
          <SelectField label="Zeitraum" value={current} onChange={setPeriodId} options={periods.map((row) => [row.id, row.name])} testId="overall-close-period" />
        </div>
      ) : null}
      {error && !data ? <p className="text-sm text-warn" role="alert">{error}</p> : null}
      {!data && !error ? <p className="text-sm text-white/45" aria-busy="true">Lade Abschluss …</p> : null}
      {data ? (
        <>
          <p className="text-sm text-white/75" data-testid="overall-close-summary">
            {data.period.name}: {data.seasons.map((row) => row.name).join(", ") || "keine Season"}. {rulesLine(data.settings)} {tiebreakLine(data.settings)}
          </p>
          <div className="mt-4 space-y-4">
            {data.levels.length ? data.levels.map((block) => <LevelCard key={block.level} block={block} data={data} onSheet={setSheet} onUndecide={undecide} />)
              : <p className="text-sm text-white/55">Noch kein Endstand einer Season in diesem Zeitraum.</p>}
          </div>
          {sheet?.kind === "close" ? <CloseSheet block={sheet.block} data={data} superadmin={data.superadmin} onClose={() => setSheet(null)} onDone={done} /> : null}
          {sheet?.kind === "reopen" ? <ReopenSheet block={sheet.block} data={data} superadmin={data.superadmin} onClose={() => setSheet(null)} onDone={done} /> : null}
          {sheet?.kind === "decide" ? <DecideSheet block={sheet.block} tie={sheet.tie} data={data} superadmin={data.superadmin} onClose={() => setSheet(null)} onDone={done} /> : null}
        </>
      ) : null}
    </FormSection>
  );
}

// ---------------------------------------------------------------- Reiter „Belohnungen“

function RewardsTab({ data, onSaved }) {
  const toForm = (body) => ({ reward_players: body.settings?.reward_players || "fielded", items: (body.rewards || []).map(rewardToForm) });
  const payload = (form) => ({ reward_players: form.reward_players, rewards: form.items.map(rewardPayload) });
  const [form, setForm] = useState(() => toForm(data));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm(toForm(data)); }, [data]);
  const dirty = JSON.stringify(payload(form)) !== JSON.stringify(payload(toForm(data)));
  const problem = listProblem(form.items);
  const readOnly = !data.can_edit;
  const save = async () => {
    setSaving(true);
    try {
      onSaved((await api.put(`/admin/leagues/${data.league.id}/overall`, payload(form))).data);
      toast.success("Belohnungen gespeichert. Sie gelten beim nächsten Abschluss der Gesamtwertung.");
    } catch (failure) {
      toast.error(errorOf(failure, "Speichern ging nicht."));
    }
    setSaving(false);
  };
  return (
    <div className="space-y-6" data-testid="overall-rewards">
      <FormSection title="Belohnungen der Gesamtwertung" testId="overall-rewards-section"
        hint="Wie die Belohnungen einer Season: Banner, Emblem, Medaille oder Titel je Platz, Platzbereich oder für alle. Vergeben beim Abschluss jeder Liga N – etwa „Gesamtsieger 2027“ für Platz 1.">
        <fieldset>
          <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Spieler-Belohnungen gehen an</legend>
          <div className="mt-1">
            <Choice name="overall-reward-players" value={form.reward_players} readOnly={readOnly} testId="overall-rewards-basis"
              rows={PLAYER_BASIS.map((row) => ({ ...row, hint: row.key === "fielded" ? "Wer in der Spielerwertung Punkte für das Co-Team geholt hat." : "Alle im Kader des Co-Teams beim Abschluss." }))}
              onChange={(value) => setForm((current) => ({ ...current, reward_players: value }))} />
          </div>
        </fieldset>
        <div className="mt-4">
          <RewardList items={form.items} readOnly={readOnly} testId="overall-rewards-items" onChange={(items) => setForm((current) => ({ ...current, items }))}
            emptyText="Noch keine Belohnungen – die Gesamtwertung steht dann ohne Auszeichnung." />
        </div>
      </FormSection>
      {readOnly ? null : (
        <SaveBar dirty={dirty} problem={problem} saving={saving} onSave={save} onDiscard={() => setForm(toForm(data))} label="Belohnungen speichern" testId="overall-rewards" />
      )}
    </div>
  );
}

export default function AdminLeagueOverallPage() {
  const { leagueId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const idBase = useId().replace(/:/g, "");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const hashTab = location.hash.replace("#", "");
  const tab = TABS.some((row) => row.key === hashTab) ? hashTab : TABS[0].key;
  const load = useCallback(async () => {
    try {
      setData((await api.get(`/admin/leagues/${leagueId}/overall`)).data);
      setError("");
    } catch (failure) {
      setError(errorOf(failure, "Die Gesamtwertung konnte nicht geladen werden."));
    }
  }, [leagueId]);
  useEffect(() => { load(); }, [load]);
  const select = (key) => navigate({ pathname: location.pathname, hash: key === TABS[0].key ? "" : `#${key}` }, { replace: true });
  const panels = data ? {
    einstellungen: () => <SettingsTab data={data} onSaved={setData} />,
    zeitraeume: () => <PeriodsTab data={data} onSaved={setData} />,
    abschluss: () => <CloseTab data={data} />,
    belohnungen: () => <RewardsTab data={data} onSaved={setData} />,
  } : {};
  return (
    <AdminLayout>
      <Link to="/admin/leagues" data-testid="overall-back" className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white/50 hover:text-[#29B6E8]">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Liga
      </Link>
      {error ? <p className="mt-6 text-sm text-warn" role="alert" data-testid="overall-error">{error}</p> : null}
      {!data && !error ? <div className="mt-6 h-40 animate-pulse rounded-sm bg-white/5" aria-busy="true" aria-label="Lade Gesamtwertung" /> : null}
      {data ? (
        <>
          <div className="mb-5 mt-3 flex min-w-0 items-center gap-3" style={accentStyle(data.league.accent_color)}>
            <LeagueEmblem src={data.league.emblem_url} size={48} />
            <div className="min-w-0">
              <h1 className="break-words font-heading text-3xl font-black uppercase md:text-4xl">{data.league.name} · Gesamtwertung</h1>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-white/60" data-testid="overall-head">
                <Gift className="h-3.5 w-3.5" aria-hidden="true" />
                {data.enabled ? `${data.periods.length} ${data.periods.length === 1 ? "Zeitraum" : "Zeiträume"} · je Liga N eine eigene Wertung` : "Noch kein Zeitraum – die Ligaseite zeigt keine Gesamtwertung."}
              </p>
            </div>
          </div>
          <AdminTabBar tabs={TABS} active={tab} onSelect={select} idBase={idBase} label="Bereiche der Gesamtwertung" testPrefix="overall" />
          {TABS.map((row) => (row.key === tab ? (
            <div key={row.key} role="tabpanel" id={`${idBase}-panel-${row.key}`} aria-labelledby={`${idBase}-tab-${row.key}`} data-testid={`overall-panel-${row.key}`} className="min-w-0">
              {panels[row.key]()}
            </div>
          ) : null))}
        </>
      ) : null}
    </AdminLayout>
  );
}
