// Turnier-Bearbeitung (#223): Turnier-Staff (Leitung, Ergebnis, Stationen). Personen kommen seit #1354 aus der
// Personensuche - Name und Bild, keine E-Mail-Adressen.
import { useState } from "react";
import { api, formatRequestError } from "@/lib/api";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { PersonPicker } from "@/components/tls/PersonPicker";
import { toast } from "sonner";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { STAFF_ROLE_OPTIONS, STAFF_SCOPE_OPTIONS } from "@/lib/tournamentLabels";
import { displayRoundLabels, sectionRoundLabel } from "@/lib/bracketNames";
import { staffRoleSentence } from "@/lib/staffRoles";
import { useNarrowScreen } from "@/hooks/useNarrowScreen";

// Bereich eines Einsatzes (#2111, TA25): eine Auswahl aus diesem Turnier statt einer rohen Kennung als Freitext - ein
// Tippfehler ergab vorher einen Helfer ohne Rechte. „Alle …“ (leer) gilt für jede Phase, Gruppe, Station oder jedes Spiel.
const ALL_LABELS = { stage: "Alle Phasen", group: "Alle Gruppen", station: "Alle Stationen", match: "Alle Spiele" };

export function scopeChoices({ stages = [], groups = [], stations = [], matches = [] } = {}) {
  return {
    stage: stages.map((stage) => [stage.id, stage.name || `Phase ${stage.number || ""}`.trim()]),
    group: groups.map((group) => [group.id, group.name || "Gruppe"]),
    station: stations.map((station) => [station.id, station.name ? `Station ${station.name}` : "Station"]),
    // Rundennamen wie im Baum (#1947).
    match: displayRoundLabels(matches).filter((match) => !match.is_preview).map((match) => [
      match.id,
      [sectionRoundLabel(match), match.match_key].filter(Boolean).join(" · "),
    ]),
  };
}

export function TournamentStaffPanel({ tournamentId, staff, staffError = "", onChanged, stages = [], groups = [], stations = [], matches = [] }) {
  const choices = scopeChoices({ stages, groups, stations, matches });
  const scopeName = (scope, id) => (choices[scope] || []).find(([value]) => value === id)?.[1] || "nicht mehr vorhanden";
  const [person, setPerson] = useState(null);
  const [form, setForm] = useState({ role: "scorekeeper", scope: "tournament", scope_id: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();
  const narrow = useNarrowScreen();

  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));
  const add = async (e) => {
    e.preventDefault();
    if (!person) {
      toast.error("Bitte eine Person suchen und wählen.");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/tournaments/${tournamentId}/staff`, {
        user_id: person.id,
        role: form.role,
        scope: form.scope,
        scope_id: form.scope === "tournament" ? null : form.scope_id || null,
        notes: form.notes || null,
      });
      toast.success(`${person.name || "Die Person"} ist eingetragen und bekommt Bescheid.`);
      setPerson(null);
      setForm({ role: "scorekeeper", scope: "tournament", scope_id: "", notes: "" });
      onChanged();
    } catch (e2) {
      toast.error(formatRequestError(e2, "Zuweisung konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (assignment) => {
    if (!await confirm({
      title: "Zuweisung entfernen?",
      description: "Der Account verliert die operativen Rechte für dieses Turnier.",
      confirmLabel: "Entfernen",
    })) return;
    try {
      await api.delete(`/tournaments/${tournamentId}/staff/${assignment.id}`);
      toast.success("Zuweisung entfernt.");
      onChanged();
    } catch (e) {
      toast.error(formatRequestError(e, "Zuweisung konnte nicht entfernt werden."));
    }
  };
  const toggleActive = async (assignment) => {
    try {
      await api.patch(`/tournaments/${tournamentId}/staff/${assignment.id}`, { is_active: !assignment.is_active });
      onChanged();
    } catch (e) {
      toast.error(formatRequestError(e, "Zuweisung konnte nicht aktualisiert werden."));
    }
  };
  const roleLabel = (role) => STAFF_ROLE_OPTIONS.find(([v]) => v === role)?.[1] || role;
  const scopeLabel = (scope) => STAFF_SCOPE_OPTIONS.find(([v]) => v === scope)?.[1] || scope;

  return (
    <div className="grid lg:grid-cols-3 gap-5">
      <form onSubmit={add} className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
        <div>
          <div className="tls-type-label text-[#29B6E8]">Helfer</div>
          <h2 className="tls-type-section mt-1">Helfer eintragen</h2>
          <p className="mt-1 tls-type-small text-white/50">Wer eingetragen wird, bekommt eine Nachricht mit seiner Rolle und dem Weg zu „Mein Dienst“.</p>
        </div>
        <PersonPicker purpose="tournament" contextId={tournamentId} value={person} onChange={setPerson} label="Person" testId="tournament-staff-person" />
        <label className="block">
          <div className="tls-type-label text-white/60 mb-1.5">Rolle</div>
          <select value={form.role} onChange={(e) => set("role", e.target.value)} data-testid="tournament-staff-role" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
            {STAFF_ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {/* Je Rolle ein Satz (#1384) - aus derselben Liste, die der Server prüft. */}
          <p className="mt-1.5 tls-type-small text-white/55" data-testid="tournament-staff-role-sentence">{staffRoleSentence(form.role)}</p>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <div className="tls-type-label text-white/60 mb-1.5">Bereich</div>
            <select value={form.scope} onChange={(e) => setForm((x) => ({ ...x, scope: e.target.value, scope_id: "" }))} data-testid="tournament-staff-scope" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              {STAFF_SCOPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {form.scope !== "tournament" && (
            <label className="block">
              <div className="tls-type-label text-white/60 mb-1.5">Welche</div>
              <select value={form.scope_id} onChange={(e) => set("scope_id", e.target.value)} data-testid="tournament-staff-scope-id" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
                <option value="">{ALL_LABELS[form.scope]}</option>
                {(choices[form.scope] || []).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          )}
        </div>
        <label className="block">
          <div className="tls-type-label text-white/60 mb-1.5">Notiz</div>
          <input value={form.notes} onChange={(e) => set("notes", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="z.B. Samstag Vormittag" />
        </label>
        <button disabled={saving} className="w-full min-h-[44px] px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm tls-type-small disabled:opacity-50">
          Eintragen
        </button>
      </form>
      <div className="lg:col-span-2 border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
        {staffError ? <div className="px-4 py-10 text-center tls-type-small text-white/55" data-testid="tournament-staff-error">{staffError}</div> : (
        <>
        {/* Am Handy (#1384): je Helfer eine Karte mit Rolle und Satz statt einer Tabelle zum Wischen. */}
        {narrow ? (
        <ul className="divide-y divide-white/5" data-testid="tournament-staff-cards">
          {staff.map((a) => (
            <li key={a.id} className="p-4 space-y-2" data-testid={`tournament-staff-card-${a.id}`}>
              <div className="flex items-start justify-between gap-3 min-w-0">
                <div className="min-w-0">
                  <div className="font-semibold [overflow-wrap:anywhere]">{a.user?.display_name || a.user?.username || "—"}</div>
                  {a.user?.username && <div className="tls-type-small text-quiet truncate">@{a.user.username}</div>}
                </div>
                <StatusBadge status={a.is_active === false ? "paused" : "approved"} />
              </div>
              <div className="tls-type-small">
                <span className="font-bold text-[#29B6E8]">{roleLabel(a.role)}</span>
                <span className="text-white/45"> · {scopeLabel(a.scope || "tournament")}{a.scope_id ? `: ${scopeName(a.scope, a.scope_id)}` : ""}</span>
              </div>
              <p className="tls-type-small text-white/55">{staffRoleSentence(a.role)}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" onClick={() => toggleActive(a)} className="min-h-[44px] px-3 py-2 border border-white/15 text-white/70 rounded-sm tls-type-label">
                  {a.is_active === false ? "Aktivieren" : "Pausieren"}
                </button>
                <button type="button" onClick={() => remove(a)} className="min-h-[44px] px-3 py-2 border border-live/40 text-live rounded-sm tls-type-label">
                  Entfernen
                </button>
              </div>
            </li>
          ))}
          {staff.length === 0 && <li className="text-center py-10 text-white/40">Noch keine Helfer</li>}
        </ul>
        ) : (
        <div className="tls-swipe pb-0">
          <table className="w-full tls-type-small min-w-[760px]">
            <thead className="bg-[#0A0A0A] tls-type-label text-white/50">
              <tr>
                <th className="text-left px-4 py-3">Person</th>
                <th className="text-left px-4 py-3">Rolle</th>
                <th className="text-left px-4 py-3">Bereich</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {staff.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{a.user?.display_name || a.user?.username || "—"}</div>
                    {a.user?.username && <div className="tls-type-small text-quiet">@{a.user.username}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div>{roleLabel(a.role)}</div>
                    <div className="tls-type-small text-white/45 max-w-[16rem]" data-testid={`tournament-staff-sentence-${a.id}`}>{staffRoleSentence(a.role)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{scopeLabel(a.scope || "tournament")}</div>
                    {a.scope_id ? <div className="tls-type-small text-quiet">{scopeName(a.scope, a.scope_id)}</div>
                      : a.scope && a.scope !== "tournament" ? <div className="tls-type-small text-quiet">{ALL_LABELS[a.scope]}</div> : null}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={a.is_active === false ? "paused" : "approved"} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => toggleActive(a)} className="px-2 py-1 border border-white/15 text-white/70 rounded-sm tls-type-label">
                        {a.is_active === false ? "Aktivieren" : "Pausieren"}
                      </button>
                      <button type="button" onClick={() => remove(a)} className="px-2 py-1 border border-live/40 text-live rounded-sm tls-type-label">
                        Entfernen
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {staff.length === 0 && <tr><td colSpan="5" className="text-center py-10 text-white/40">Noch keine Helfer</td></tr>}
            </tbody>
          </table>
        </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}
