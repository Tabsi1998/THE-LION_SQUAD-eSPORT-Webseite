// Zuständige einer Liga (#2203, docs/LIGA.md Abschnitt 12): Wer den Bereich Ligen hat, vergibt hier je Person einzelne
// Zuständigkeiten. „Liga verwalten“ sieht die Liste nur. Der Server prüft und protokolliert jede Vergabe, die Person bekommt
// eine Meldung. Zuständige brauchen die Zwei-Faktor-Anmeldung: Fehlt sie, steht das an der Zeile - das Recht gilt erst damit.
import { useCallback, useEffect, useState } from "react";
import { ShieldAlert, Trash2, UserPlus } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { PersonAvatar, PersonPicker } from "@/components/tls/PersonPicker";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { LEAGUE_CAPABILITIES } from "@/lib/permissions";
import { toast } from "sonner";

const LABELS = Object.fromEntries(LEAGUE_CAPABILITIES.map((row) => [row.key, row.label]));

export function capabilityWords(keys) {
  return (keys || []).map((key) => LABELS[key] || key).join(" · ");
}

function CapabilityChoice({ value, onChange, idPrefix }) {
  const toggle = (key) => onChange(value.includes(key) ? value.filter((row) => row !== key) : [...value, key]);
  return (
    <fieldset className="grid gap-2 sm:grid-cols-2" data-testid={`${idPrefix}-capabilities`}>
      <legend className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/60">Zuständig für</legend>
      {LEAGUE_CAPABILITIES.map((row) => (
        <label key={row.key} className="flex min-h-[44px] cursor-pointer items-start gap-2.5 rounded-sm border border-white/10 px-3 py-2 text-sm has-[:checked]:border-[#29B6E8]/60 has-[:checked]:bg-[#29B6E8]/5 has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-[#29B6E8]">
          <input type="checkbox" className="mt-0.5 accent-[#29B6E8]" checked={value.includes(row.key)} onChange={() => toggle(row.key)} data-testid={`${idPrefix}-${row.key}`} />
          <span className="min-w-0">
            <span className="block font-semibold text-white">{row.label}</span>
            <span className="block text-[11px] leading-snug text-white/55">{row.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function StaffRow({ row, canGrant, busy, onSave, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [capabilities, setCapabilities] = useState(row.capabilities);
  const person = { name: row.display_name, avatar_url: row.avatar_url };
  return (
    <li className="px-3 py-3" data-testid={`league-staff-row-${row.user_id}`}>
      <div className="flex items-start gap-3">
        <PersonAvatar person={person} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-white [overflow-wrap:anywhere]">{row.display_name}</div>
          <div className="text-xs leading-relaxed text-white/60">{capabilityWords(row.capabilities)}</div>
          {!row.second_factor ? (
            <div className="mt-1 flex items-start gap-1.5 text-xs text-warn" data-testid={`league-staff-no-mfa-${row.user_id}`}>
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Gilt erst, wenn die Person die Zwei-Faktor-Anmeldung eingerichtet hat.
            </div>
          ) : null}
        </div>
        {canGrant ? (
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => { setCapabilities(row.capabilities); setEditing((open) => !open); }} aria-expanded={editing}
              className="tls-btn tls-btn--quiet min-h-[44px] rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider" data-testid={`league-staff-edit-${row.user_id}`}>
              Ändern
            </button>
            <button type="button" onClick={() => onRemove(row)} disabled={busy} aria-label={`${row.display_name} entfernen`}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm text-white/50 hover:text-live focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]" data-testid={`league-staff-remove-${row.user_id}`}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-3 space-y-3">
          <CapabilityChoice value={capabilities} onChange={setCapabilities} idPrefix={`league-staff-${row.user_id}`} />
          <button type="button" disabled={busy || !capabilities.length} onClick={async () => { if (await onSave(row.user_id, capabilities)) setEditing(false); }}
            className="tls-btn tls-btn--primary min-h-[44px] rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50" data-testid={`league-staff-save-${row.user_id}`}>
            Zuständigkeiten speichern
          </button>
        </div>
      ) : null}
    </li>
  );
}

export function LeagueStaffSheet({ league, onClose }) {
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [person, setPerson] = useState(null);
  const [capabilities, setCapabilities] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/admin/leagues/${league.id}/staff`);
      setData(body);
      setError("");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    }
  }, [league.id]);
  useEffect(() => { load(); }, [load]);

  const save = async (userId, wanted) => {
    setBusy(true);
    try {
      await api.put(`/admin/leagues/${league.id}/staff/${userId}`, { capabilities: wanted });
      toast.success("Zuständigkeiten gespeichert.");
      await load();
      return true;
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (await save(person.id, capabilities)) {
      setPerson(null);
      setCapabilities([]);
    }
  };

  const remove = async (row) => {
    const ok = await confirm({
      title: `${row.display_name} entfernen?`,
      description: `Die Person verliert alle Zuständigkeiten in ${league.name}: ${capabilityWords(row.capabilities)}. Sie bekommt eine Meldung.`,
      confirmLabel: "Entfernen",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`/admin/leagues/${league.id}/staff/${row.user_id}`);
      toast.success("Entfernt.");
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const canGrant = Boolean(data?.can_grant);
  const rows = data?.staff || [];
  return (
    <AdminSheet title="Zuständige" eyebrow={league.name} size="lg" onClose={onClose} testId="league-staff-sheet"
      footer={<button type="button" onClick={onClose} className="tls-btn tls-btn--quiet min-h-[44px] rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider" data-testid="league-staff-close">Schließen</button>}>
      <p className="text-sm leading-relaxed text-white/65">
        Zuständige arbeiten nur in dieser Liga und nur an dem, was hier angehakt ist. Der Bereich „Ligen“ darf alle Ligen. In einem Spiel, an dem jemand selbst beteiligt ist, entscheidet eine zweite Person.
      </p>
      {error ? <p className="text-sm text-warn" role="alert" data-testid="league-staff-error">{error}</p> : null}
      {!data && !error ? <p className="text-sm text-white/50" data-testid="league-staff-loading">Lade Zuständige …</p> : null}
      {data && !rows.length ? (
        <p className="rounded-sm border border-dashed border-white/15 px-4 py-5 text-sm text-white/60" data-testid="league-staff-empty">
          Noch niemand zuständig. Bis dahin arbeitet hier nur, wer den Bereich „Ligen“ hat.
        </p>
      ) : null}
      {rows.length ? (
        <ul className="divide-y divide-white/10 rounded-sm border border-white/10 bg-[#0A0A0A]" data-testid="league-staff-list">
          {rows.map((row) => <StaffRow key={row.user_id} row={row} canGrant={canGrant} busy={busy} onSave={save} onRemove={remove} />)}
        </ul>
      ) : null}
      {canGrant ? (
        <section className="space-y-3 border-t border-white/10 pt-4" aria-label="Person hinzufügen" data-testid="league-staff-add">
          <h3 className="font-heading text-lg font-bold uppercase">Person hinzufügen</h3>
          <PersonPicker purpose="league_staff" value={person} onChange={setPerson} label="Person" placeholder="Name tippen …" testId="league-staff-person" emptyText="Niemand mit diesem Namen." />
          <CapabilityChoice value={capabilities} onChange={setCapabilities} idPrefix="league-staff-new" />
          <button type="button" disabled={busy || !person || !capabilities.length} onClick={add}
            className="tls-btn tls-btn--primary inline-flex min-h-[44px] items-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50" data-testid="league-staff-grant">
            <UserPlus className="h-4 w-4" aria-hidden="true" /> Zuständig machen
          </button>
          <p className="text-xs text-white/50">Steht im Protokoll, die Person bekommt eine Meldung.</p>
        </section>
      ) : null}
    </AdminSheet>
  );
}
