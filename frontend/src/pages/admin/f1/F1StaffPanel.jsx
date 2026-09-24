// Fast Lap (#223): Zeitnehmer und Challenge-Rechte.
import { useState } from "react";
import { api, formatRequestError } from "@/lib/api";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { toast } from "sonner";
import { useConfirm } from "@/components/tls/ConfirmDialog";

const F1_STAFF_ROLE_OPTIONS = [
  ["scorekeeper", "Ergebnisdienst"],
  ["referee", "Schiedsrichter"],
  ["organizer", "Organisation"],
];

export function F1StaffPanel({ challengeId, staff, users, onChanged }) {
  const [form, setForm] = useState({ user_id: "", role: "scorekeeper", notes: "" });
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();
  const set = (k, v) => setForm((current) => ({ ...current, [k]: v }));
  const userLabel = (u) => `${u.display_name || u.username || u.email || u.id}${u.email ? ` - ${u.email}` : ""}`;
  const roleLabel = (role) => F1_STAFF_ROLE_OPTIONS.find(([value]) => value === role)?.[1] || role;

  const add = async (event) => {
    event.preventDefault();
    if (!form.user_id) {
      toast.error("Bitte Nutzer auswahlen.");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/f1/challenges/${challengeId}/staff`, form);
      toast.success("Fast-Lap-Zuweisung gespeichert.");
      setForm({ user_id: "", role: "scorekeeper", notes: "" });
      onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Fast-Lap-Zuweisung konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (assignment) => {
    try {
      await api.patch(`/f1/challenges/${challengeId}/staff/${assignment.id}`, { is_active: assignment.is_active === false });
      onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Zuweisung konnte nicht aktualisiert werden."));
    }
  };

  const remove = async (assignment) => {
    if (!await confirm({
      title: "Zuweisung entfernen?",
      description: "Der Account verliert die Berechtigung, Fast-Lap-Zeiten direkt einzutragen.",
      confirmLabel: "Entfernen",
    })) return;
    try {
      await api.delete(`/f1/challenges/${challengeId}/staff/${assignment.id}`);
      toast.success("Zuweisung entfernt.");
      onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Zuweisung konnte nicht entfernt werden."));
    }
  };

  return (
    <div className="mb-6 border border-white/10 bg-[#121212] rounded-sm p-5">
      <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Fast-Lap-Team</div>
      <div className="mt-4 grid lg:grid-cols-3 gap-5">
        <form onSubmit={add} className="space-y-3">
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Nutzer</div>
            <select value={form.user_id} onChange={(e) => set("user_id", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              <option value="">- auswählen -</option>
              {users.map((u) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Rolle</div>
            <select value={form.role} onChange={(e) => set("role", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              {F1_STAFF_ROLE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Notiz</div>
            <input value={form.notes} onChange={(e) => set("notes", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="z.B. Beamer-Station Samstag" />
          </label>
          <button disabled={saving} className="w-full px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-sm disabled:opacity-50">Hinzufügen</button>
        </form>
        <div className="lg:col-span-2 border border-white/10 rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3">Nutzer</th>
                <th className="text-left px-4 py-3">Rolle</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {staff.map((assignment) => (
                <tr key={assignment.id}>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{assignment.user?.display_name || assignment.user?.username || "-"}</div>
                    <div className="text-xs text-white/40">{assignment.user?.email || assignment.user_id}</div>
                  </td>
                  <td className="px-4 py-3">{roleLabel(assignment.role)}</td>
                  <td className="px-4 py-3"><StatusBadge status={assignment.is_active === false ? "paused" : "approved"} /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => toggle(assignment)} className="px-2 py-1 border border-white/15 text-white/70 rounded-sm text-[10px] font-bold uppercase">
                        {assignment.is_active === false ? "Aktivieren" : "Pausieren"}
                      </button>
                      <button type="button" onClick={() => remove(assignment)} className="px-2 py-1 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm text-[10px] font-bold uppercase">
                        Entfernen
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {staff.length === 0 && <tr><td colSpan="4" className="text-center py-8 text-white/40">Noch keine Fast-Lap-Zeitnehmer</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
