import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatRequestError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { AREA_HINTS, AREA_LABELS, GRANTABLE_AREAS, ROLE_AREAS, roleLabel } from "@/lib/permissions";
import { Link as LinkIcon, Plus, Trash2, X, ShieldCheck } from "lucide-react";

// Rollen und Rechte (#287–#292): die Rolle ist die Grundstufe, Freigaben je
// Bereich kommen dazu. Die Rolle team_leader gibt es nicht mehr - Teamleitung
// läuft pro Team. Quelle der Wahrheit: docs/ROLLEN.md.
const ROLE_OPTIONS = ["player", "moderator", "tournament_admin", "club_admin", "superadmin"];
const STAFF_ROLES = ["moderator", "tournament_admin", "club_admin", "superadmin"];
export const ROLE_INFO = {
  player: { can: ["Teilnahme, Profil, App, eigene Anmeldungen"], cannot: ["Adminbereich – außer mit Freigabe oder Vorstandsposten"] },
  moderator: { can: ["Meldungen und Chats moderieren", "Turnier-, Fast-Lap- und Stationsseiten lesen"], cannot: ["Turniere anlegen, Redaktion, Mitgliederdaten"] },
  tournament_admin: { can: ["Turniere, Events, Stationen, Fast Lap, Saisons, Gewinne", "Moderation"], cannot: ["News, Galerie, Sponsoren (Redaktion)", "Mitglieder, Dokumente, Einstellungen"] },
  club_admin: { can: ["Alle Bereiche inklusive System"], cannot: ["Rollen und Freigaben vergeben"] },
  superadmin: { can: ["Alles, dazu Rollen, Freigaben und Setup"], cannot: [] },
};

export default function AdminUsersPage() {
  const { isSuperAdmin } = useAuth();
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const confirm = useConfirm();
  const load = useCallback(async () => {
    const { data } = await api.get(`/users${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    setList(data);
  }, [q]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["users"]);

  const roleCounts = useMemo(() => list.reduce((acc, user) => {
    const role = user.role || "player";
    acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {}), [list]);
  const staffCount = useMemo(
    () => list.filter((user) => STAFF_ROLES.includes(user.role)).length,
    [list],
  );

  // Freigaben je Bereich (#287): nur der Superadmin, nur Turnierleitung, Redaktion, Vereinsverwaltung.
  const toggleArea = async (user, area) => {
    const current = Array.isArray(user.areas) ? user.areas : [];
    const next = current.includes(area) ? current.filter((a) => a !== area) : [...current, area];
    try {
      await api.put(`/users/${user.id}/areas`, { areas: next });
      toast.success(`${AREA_LABELS[area]} ${next.includes(area) ? "freigegeben" : "entzogen"}.`);
      load();
    } catch (e) { toast.error(formatRequestError(e, "Freigabe konnte nicht gespeichert werden.")); }
  };

  const setRole = async (id, role) => {
    try { await api.post(`/users/${id}/role`, { role }); toast.success("Rolle aktualisiert."); load(); }
    catch (e) { toast.error(formatRequestError(e, "Rolle konnte nicht aktualisiert werden.")); }
  };
  const toggleBan = async (u) => {
    try {
      await api.post(`/users/${u.id}/${u.is_banned ? "unban" : "ban"}`);
      toast.success(u.is_banned ? "Entbannt." : "Gebannt.");
      load();
    } catch (e) {
      toast.error(formatRequestError(e, u.is_banned ? "Entbannen fehlgeschlagen." : "Bannen fehlgeschlagen."));
    }
  };
  const deleteUser = async (u) => {
    if (!await confirm({
      title: "Benutzer anonymisieren?",
      description: `Login und personenbezogene Daten von "${u.username}" werden unwiderruflich entfernt. Sporthistorie bleibt anonymisiert erhalten.`,
      confirmLabel: "Anonymisieren",
    })) return;
    try {
      await api.delete(`/users/${u.id}`);
      toast.success("Benutzer anonymisiert.");
      load();
    } catch (e) { toast.error(formatRequestError(e, "Löschen fehlgeschlagen.")); }
  };
  const resendInvite = async (u) => {
    try {
      const { data } = await api.post(`/users/${u.id}/invite`);
      if (data.invite_url && navigator.clipboard) {
        await navigator.clipboard.writeText(data.invite_url).catch(() => null);
        toast.success("Einladung gesendet und Link kopiert.");
      } else {
        toast.success("Einladung gesendet.");
      }
      load();
    } catch (e) { toast.error(formatRequestError(e, "Einladung konnte nicht gesendet werden.")); }
  };

  return (
    <AdminLayout>
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Spieler</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Benutzer</h1>
        </div>
        {isSuperAdmin && (
          <button onClick={() => setCreating(true)} data-testid="user-create-open" className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black rounded-sm text-xs font-bold uppercase tracking-wider">
            <Plus className="w-3.5 h-3.5" /> Benutzer anlegen
          </button>
        )}
      </div>
      <input placeholder="Suche…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="users-search" className="w-full max-w-md bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm mb-5" />
      <div className="mb-5 border border-white/10 bg-[#121212] rounded-sm p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Rollen & Berechtigungen</div>
            <p className="mt-1 text-xs text-white/50">Die Rolle ist die Grundstufe; einzelne Bereiche (Turnierleitung, Redaktion, Vereinsverwaltung) lassen sich je Person freigeben. Wer einen Vorstandsposten hält, hat die Vereinsverwaltung von selbst.</p>
          </div>
          <Link to="/admin/audit?action=user.role_change" className="inline-flex items-center gap-2 rounded-sm border border-white/15 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/65 hover:border-[#29B6E8]/45 hover:text-white">
            <ShieldCheck className="h-3.5 w-3.5" /> Rollen-Audit
          </Link>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {ROLE_OPTIONS.map((role) => {
            const info = ROLE_INFO[role] || { can: [], cannot: [] };
            const label = roleLabel(role);
            const count = roleCounts[role] || 0;
            return (
              <div key={role} className={`rounded-sm border px-3 py-3 ${role === "superadmin" ? "border-[#FFD700]/25 bg-[#FFD700]/5" : count ? "border-white/10 bg-black/15" : "border-white/5 bg-black/10 opacity-70"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-white">{label}</div>
                    <ul className="mt-1 text-[11px] leading-relaxed text-white/55" data-testid={`role-can-${role}`}>
                      {info.can.map((line) => <li key={line}>✓ {line}</li>)}
                    </ul>
                    {info.cannot.length ? (
                      <ul className="mt-1 text-[11px] leading-relaxed text-white/35" data-testid={`role-cannot-${role}`}>
                        {info.cannot.map((line) => <li key={line}>✗ {line}</li>)}
                      </ul>
                    ) : null}
                  </div>
                  <div className="font-heading text-2xl font-black tabular-nums text-[#29B6E8]">{count}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 text-xs text-white/45">{staffCount} Account(s) mit operativen Admin-/Staff-Rechten.</div>
      </div>
      <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
            <tr>
              <th className="text-left px-4 py-3">Username</th>
              <th className="text-left px-4 py-3">Display</th>
              <th className="text-left px-4 py-3">E-Mail</th>
              <th className="text-left px-4 py-3">Rolle</th>
              <th className="text-center px-4 py-3">Aktion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {list.map((u) => (
              <tr key={u.id} className={u.is_banned ? "opacity-50" : ""}>
                <td className="px-4 py-3 text-white/80">{u.username}</td>
                <td className="px-4 py-3">
                  <div>{u.display_name}</div>
                  {u.password_setup_required && <div className="text-[10px] uppercase tracking-widest text-[#FFD700]">Einladung offen</div>}
                </td>
                <td className="px-4 py-3 text-white/60 text-xs">{u.email}</td>
                <td className="px-4 py-3">
                  <select value={u.role} onChange={(e) => setRole(u.id, e.target.value)} data-testid={`user-role-${u.username}`} className="bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-xs">
                    {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                  </select>
                  {isSuperAdmin ? (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1" data-testid={`user-areas-${u.username}`}>
                      {GRANTABLE_AREAS.map((area) => {
                        const fromRole = (ROLE_AREAS[u.role] || []).includes(area);
                        const granted = Array.isArray(u.areas) && u.areas.includes(area);
                        return (
                          <label key={area} className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider ${fromRole ? "text-white/30" : "text-white/60"}`} title={fromRole ? "Schon in der Rolle enthalten" : AREA_HINTS[area]}>
                            <input
                              type="checkbox"
                              className="accent-[#29B6E8]"
                              checked={fromRole || granted}
                              disabled={fromRole}
                              onChange={() => toggleArea(u, area)}
                              data-testid={`user-area-${u.username}-${area}`}
                            />
                            {AREA_LABELS[area]}
                          </label>
                        );
                      })}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="inline-flex items-center gap-2">
                    <button onClick={() => toggleBan(u)} data-testid={`user-ban-${u.username}`} className={`text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-sm ${u.is_banned ? "text-[#00FF88] border border-[#00FF88]/40" : "text-[#FF3B30] border border-[#FF3B30]/40 hover:bg-[#FF3B30]/10"}`}>
                      {u.is_banned ? "Entbannen" : "Bannen"}
                    </button>
                    {isSuperAdmin && (
                      <>
                        <button onClick={() => resendInvite(u)} data-testid={`user-invite-${u.username}`} className="p-1.5 border border-[#29B6E8]/40 text-[#29B6E8] rounded-sm hover:bg-[#29B6E8]/10" title="Einladung senden">
                          <LinkIcon className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => deleteUser(u)} data-testid={`user-delete-${u.username}`} className="p-1.5 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm hover:bg-[#FF3B30]/10" title="Benutzer löschen">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      {creating && <CreateUserModal onClose={() => setCreating(false)} onCreated={load} onSaved={() => { setCreating(false); load(); }} />}
    </AdminLayout>
  );
}

function CreateUserModal({ onClose, onSaved, onCreated }) {
  const [form, setForm] = useState({ username: "", display_name: "", email: "", gender: "", role: "player", is_active: true, privacy_public_profile: false, send_invite: true });
  const [saving, setSaving] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post("/users", { ...form, gender: form.gender || null });
      Promise.resolve(onCreated?.()).catch(() => null);
      if (data.invite_url) {
        setInviteUrl(data.invite_url);
        if (navigator.clipboard) await navigator.clipboard.writeText(data.invite_url).catch(() => null);
        toast.success("Benutzer angelegt, Einladung gesendet und Link kopiert.");
      } else {
        toast.success("Benutzer angelegt.");
        onSaved();
      }
    } catch (err) {
      toast.error(formatRequestError(err, "Benutzer konnte nicht angelegt werden.", { name: form.username }));
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-lg bg-[#121212] border border-white/10 rounded-sm">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="font-heading font-black uppercase">Benutzer anlegen</h2>
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Username"><Input value={form.username} onChange={(v) => set("username", v)} required testId="create-user-username" /></Field>
          <Field label="Display Name"><Input value={form.display_name} onChange={(v) => set("display_name", v)} testId="create-user-display" /></Field>
          <Field label="E-Mail"><Input type="email" value={form.email} onChange={(v) => set("email", v)} required testId="create-user-email" /></Field>
          <Field label="Geschlecht">
            <select value={form.gender || ""} onChange={(e) => set("gender", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
              <option value="">Keine Angabe</option>
              <option value="male">Männlich</option>
              <option value="female">Weiblich</option>
              <option value="diverse">Divers</option>
            </select>
          </Field>
          <div className="border border-[#29B6E8]/25 bg-[#29B6E8]/5 p-3 rounded-sm text-sm text-white/70">
            Der Benutzer bekommt per E-Mail einen einmaligen Link und erstellt sein Passwort selbst.
          </div>
          <Field label="Rolle">
            <select value={form.role} onChange={(e) => set("role", e.target.value)} data-testid="create-user-role" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
              {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} className="accent-[#29B6E8]" /> Aktiv</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.privacy_public_profile} onChange={(e) => set("privacy_public_profile", e.target.checked)} className="accent-[#29B6E8]" /> Öffentliches Profil</label>
          {inviteUrl && (
            <div className="border border-[#FFD700]/30 bg-[#FFD700]/10 p-3 rounded-sm">
              <div className="text-[11px] uppercase tracking-widest text-[#FFD700] font-bold">Einladungslink</div>
              <div className="mt-1 text-xs break-all text-white/80">{inviteUrl}</div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-white/10">
          <button type="button" onClick={inviteUrl ? onSaved : onClose} className="px-4 py-2 border border-white/10 text-white/60 rounded-sm text-xs uppercase tracking-wider font-bold">{inviteUrl ? "Schließen" : "Abbrechen"}</button>
          {!inviteUrl && <button disabled={saving} data-testid="create-user-submit" className="px-5 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50">{saving ? "Speichere…" : "Anlegen & einladen"}</button>}
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>{children}</label>;
}

function Input({ value, onChange, type = "text", required, testId }) {
  return <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={required} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />;
}
