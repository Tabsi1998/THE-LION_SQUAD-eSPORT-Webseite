// Kader eines Co-Teams in einer Staffel bearbeiten (#2203, docs/LIGA.md Abschnitt 12): Solange die Staffel läuft, ändern das nur
// das eigene Team und die Liga-Leitung mit „Kader prüfen“. Die Liga-Leitung kommt hierher aus der Kaderübersicht der Season. Abgänge
// bleiben möglich, auch unter die Mindestgröße - das Blatt sagt es vorher, der Server warnt das Team. Der Server prüft selbst.
import { useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { SelectField } from "@/components/tls/FormFields";
import { SQUAD_ROLES, SQUAD_STATUS_LABELS, isLocked, roleChoices, roleOf } from "@/components/tls/league/squadRoles";
import { toast } from "sonner";

const STATUS_OPTIONS = Object.entries(SQUAD_STATUS_LABELS);

export function kaderChanges(squad, form) {
  const changes = {};
  if (form.member_ids.join() !== squad.member_ids.join()) changes.member_ids = form.member_ids;
  if (form.status !== squad.squad_status) changes.status = form.status;
  for (const role of SQUAD_ROLES) {
    if ((form[role.field] || null) !== (squad[role.field] || null)) changes[role.field] = form[role.field] || null;
  }
  return changes;
}

export function SquadKaderSheet({ squad, onClose, onSaved }) {
  const [form, setForm] = useState({ member_ids: squad.member_ids, status: squad.squad_status, captain_id: squad.captain_id || "", vice_captain_id: squad.vice_captain_id || "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const members = squad.team_members.map((person) => ({ id: person.id, display_name: person.name }));
  const toggle = (id) => setForm((current) => ({
    ...current,
    member_ids: current.member_ids.includes(id) ? current.member_ids.filter((row) => row !== id) : [...current.member_ids, id],
  }));
  const short = form.member_ids.length < squad.min_squad_size;

  const submit = async (event) => {
    event.preventDefault();
    const changes = kaderChanges(squad, form);
    if (!Object.keys(changes).length) {
      onClose();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.patch(`/teams/${squad.team_id}/squads/${squad.squad_id}`, changes);
      toast.success("Kader gespeichert.");
      onSaved();
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || "Der Kader konnte nicht gespeichert werden.");
      setSaving(false);
    }
  };

  return (
    <AdminSheet title="Kader bearbeiten" eyebrow={squad.display_name} onClose={onClose} onSubmit={submit} saving={saving} submitTestId="kader-save" testId="kader-sheet" noValidate>
      <fieldset className="grid gap-2 sm:grid-cols-2" data-testid="kader-members">
        <legend className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/60">Kader</legend>
        {members.map((person) => {
          const role = form.member_ids.includes(person.id) ? roleOf(form, person.id) : null;
          return (
            <label key={person.id} className="flex min-h-[44px] min-w-0 cursor-pointer items-center gap-2.5 rounded-sm border border-white/10 px-3 py-2 text-sm has-[:checked]:border-[#29B6E8]/60 has-[:checked]:bg-[#29B6E8]/5">
              <input type="checkbox" className="accent-[#29B6E8]" checked={form.member_ids.includes(person.id)} disabled={isLocked(form, person.id)} onChange={() => toggle(person.id)} data-testid={`kader-member-${person.id}`} />
              <span className="min-w-0 flex-1 truncate">{person.display_name}</span>
              {role ? <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#FFD700]">{role.label}</span> : null}
            </label>
          );
        })}
      </fieldset>
      {short ? (
        <p className="rounded-sm border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-white/85" role="status" data-testid="kader-short">
          Im Kader stehen dann {form.member_ids.length} Spieler, die Liga verlangt mindestens {squad.min_squad_size}. Speichern geht trotzdem, das Team bekommt eine Warnung.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {SQUAD_ROLES.map((role) => (
          <SelectField key={role.field} label={role.label} value={form[role.field]} onChange={(value) => setForm((current) => ({ ...current, [role.field]: value }))}
            options={[["", "Niemand"], ...roleChoices(form.member_ids, members, role.field, form).map((person) => [person.id, person.name])]} testId={`kader-${role.field}`} />
        ))}
      </div>
      <p className="text-xs leading-relaxed text-white/55">Wer eine Rolle hat, bleibt im Kader, bis die Rolle neu vergeben ist. Ohne Captain und Vertreter handelt im Spiel die Teamleitung.</p>
      <SelectField label="Status" value={form.status} onChange={(value) => setForm((current) => ({ ...current, status: value }))} options={STATUS_OPTIONS} testId="kader-status" />
      <p className="text-xs text-white/55">Steht im Protokoll. Das Team sieht den neuen Kader sofort.</p>
      {error ? <p className="text-sm text-warn" role="alert" data-testid="kader-error">{error}</p> : null}
    </AdminSheet>
  );
}
