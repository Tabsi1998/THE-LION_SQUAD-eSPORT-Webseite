// Turnier-Bearbeitung (#223): Turnier-Staff (Leitung, Ergebnis, Stationen).
import { useState } from "react";
import { api, formatRequestError } from "@/lib/api";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { toast } from "sonner";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { STAFF_ROLE_OPTIONS, STAFF_SCOPE_OPTIONS } from "@/lib/tournamentLabels";

export function TournamentStaffPanel({ tournamentId, staff, users, onChanged }) {
  const [form, setForm] = useState({ user_id: "", role: "scorekeeper", scope: "tournament", scope_id: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));
  const add = async (e) => {
    e.preventDefault();
    if (!form.user_id) {
      toast.error("Bitte Nutzer auswählen.");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/tournaments/${tournamentId}/staff`, {
        user_id: form.user_id,
        role: form.role,
        scope: form.scope,
        scope_id: form.scope === "tournament" ? null : form.scope_id || null,
        notes: form.notes || null,
      });
      toast.success("Zuweisung gespeichert.");
      setForm({ user_id: "", role: "scorekeeper", scope: "tournament", scope_id: "", notes: "" });
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
  const userLabel = (u) => `${u.display_name || u.username || u.email || u.id}${u.email ? ` · ${u.email}` : ""}`;

  return (
    <div className="grid lg:grid-cols-3 gap-5">
      <form onSubmit={add} className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Turnier-Team</div>
          <h2 className="font-heading text-lg font-bold mt-1">Zuweisung hinzufügen</h2>
        </div>
        <label className="block">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Nutzer</div>
          <select value={form.user_id} onChange={(e) => set("user_id", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
            <option value="">— auswählen —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
          </select>
        </label>
        <label className="block">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Rolle</div>
          <select value={form.role} onChange={(e) => set("role", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
            {STAFF_ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Bereich</div>
            <select value={form.scope} onChange={(e) => set("scope", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              {STAFF_SCOPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Bereich-ID</div>
            <input value={form.scope_id} disabled={form.scope === "tournament"} onChange={(e) => set("scope_id", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm disabled:opacity-40" placeholder="optional" />
          </label>
        </div>
        <label className="block">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Notiz</div>
          <input value={form.notes} onChange={(e) => set("notes", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="z.B. Samstag Vormittag" />
        </label>
        <button disabled={saving} className="w-full px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-sm disabled:opacity-50">
          Hinzufügen
        </button>
      </form>
      <div className="lg:col-span-2 border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3">Nutzer</th>
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
                    <div className="text-xs text-white/40">{a.user?.email || a.user_id}</div>
                  </td>
                  <td className="px-4 py-3">{roleLabel(a.role)}</td>
                  <td className="px-4 py-3">
                    <div>{scopeLabel(a.scope || "tournament")}</div>
                    {a.scope_id && <div className="text-xs text-white/40 font-mono">{a.scope_id}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={a.is_active === false ? "paused" : "approved"} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => toggleActive(a)} className="px-2 py-1 border border-white/15 text-white/70 rounded-sm text-[10px] font-bold uppercase">
                        {a.is_active === false ? "Aktivieren" : "Pausieren"}
                      </button>
                      <button type="button" onClick={() => remove(a)} className="px-2 py-1 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm text-[10px] font-bold uppercase">
                        Entfernen
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {staff.length === 0 && <tr><td colSpan="5" className="text-center py-10 text-white/40">Noch keine Zuweisungen</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
