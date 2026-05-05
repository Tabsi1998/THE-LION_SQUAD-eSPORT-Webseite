/**
 * Admin Achievements (Phase B v4) — full CRUD + manual award.
 *
 * Tabs:
 *   Groups · Tiers · Manuell vergeben · Negative Vorfälle
 */
import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { toast } from "sonner";
import {
  Plus, Trash2, Save, X, Pencil, Trophy, Award, AlertOctagon,
  Search, UserPlus, ShieldOff, Eye, EyeOff, Crown,
} from "lucide-react";

const LEVEL_NAMES = { 1: "Bronze", 2: "Silber", 3: "Gold", 4: "Platin", 5: "Special" };
const LEVEL_COLORS = { 1: "#CD7F32", 2: "#C0C0C0", 3: "#FFD700", 4: "#29B6E8", 5: "#FF3B30" };
const CATEGORIES = [
  { value: "match", label: "Match" },
  { value: "tournament", label: "Turnier" },
  { value: "fastlap", label: "Fast Lap" },
  { value: "club", label: "Verein" },
  { value: "special", label: "Special" },
  { value: "negative", label: "Negative" },
];

export default function AdminAchievementsPage() {
  const [tab, setTab] = useState("groups");

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Phase B · v4</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Achievements</h1>
      <p className="mt-2 text-white/55 text-sm max-w-2xl">
        Verwalte alle Achievement-Gruppen, Stufen, Special-Awards und Negative-Vorfälle.
        Negative/Fun-Awards bleiben bis zur Freischaltung geheim und erscheinen danach im Profil.
      </p>

      <div className="mt-6 flex gap-1 border-b border-white/10 overflow-x-auto">
        {[
          ["groups", "Groups", Trophy],
          ["tiers", "Tiers", Award],
          ["award", "Manuell vergeben", UserPlus],
          ["negative", "Negative Vorfälle", AlertOctagon],
        ].map(([k, label, Icon]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            data-testid={`ach-tab-${k}`}
            className={`px-4 py-2 text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 border-b-2 transition ${tab === k ? "border-[#FFD700] text-[#FFD700]" : "border-transparent text-white/50 hover:text-white"}`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "groups" && <GroupsTab />}
        {tab === "tiers" && <TiersTab />}
        {tab === "award" && <AwardTab />}
        {tab === "negative" && <NegativeTab />}
      </div>
    </AdminLayout>
  );
}

// ---------------- Groups Tab ----------------
function GroupsTab() {
  const [groups, setGroups] = useState([]);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const { data } = await api.get("/admin/achievements/groups");
    setGroups(data);
  };
  useEffect(() => { load(); }, []);

  const togglePublic = async (g) => {
    try { await api.patch(`/admin/achievements/groups/${g.code}`, { public: !g.public }); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
  };
  const del = async (g) => {
    if (!window.confirm(`Group "${g.name}" inkl. aller Tiers und Awards wirklich löschen?`)) return;
    try { await api.delete(`/admin/achievements/groups/${g.code}`); toast.success("Gelöscht"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-white/50">{groups.length} Groups · {groups.filter(g => g.is_negative).length} negativ · {groups.filter(g => g.is_special).length} special</span>
        <button onClick={() => setCreating(true)} data-testid="group-new-btn" className="px-4 py-2 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 text-xs"><Plus className="w-3.5 h-3.5" /> Neue Group</button>
      </div>
      <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3">Code</th>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Kategorie</th>
                <th className="text-left px-4 py-3">Sichtbar</th>
                <th className="text-left px-4 py-3">Flags</th>
                <th className="text-right px-4 py-3">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {groups.map(g => (
                <tr key={g.code} data-testid={`group-row-${g.code}`}>
                  <td className="px-4 py-3 text-xs text-white/40 font-mono">{g.code}</td>
                  <td className="px-4 py-3"><div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: g.accent_color }} /> <span className="font-semibold">{g.name}</span></div></td>
                  <td className="px-4 py-3 text-xs uppercase tracking-wider text-white/60">{g.category}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => togglePublic(g)} data-testid={`group-public-${g.code}`} className={`text-xs uppercase tracking-wider font-bold inline-flex items-center gap-1 ${g.public ? "text-[#00FF88]" : "text-white/40"}`}>
                      {g.public ? <><Eye className="w-3 h-3" /> Öffentlich</> : <><EyeOff className="w-3 h-3" /> Intern</>}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-[10px] uppercase tracking-widest space-x-2">
                    {g.is_special && <span className="text-[#FFD700]">Special</span>}
                    {g.is_negative && <span className="text-[#FF3B30]">Negative</span>}
                    {g.is_admin_created && <span className="text-[#29B6E8]">Custom</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing(g)} className="text-[#29B6E8] hover:underline mr-3 text-xs">Bearbeiten</button>
                    {g.is_admin_created && <button onClick={() => del(g)} className="text-[#FF3B30] hover:underline text-xs">Löschen</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {(creating || editing) && (
        <GroupForm group={editing} onClose={() => { setEditing(null); setCreating(false); }} onSaved={load} />
      )}
    </div>
  );
}

function GroupForm({ group, onClose, onSaved }) {
  const isNew = !group;
  const [form, setForm] = useState({
    code: group?.code || "",
    name: group?.name || "",
    category: group?.category || "special",
    icon: group?.icon || "trophy",
    accent_color: group?.accent_color || "#FF3B30",
    description: group?.description || "",
    public: group?.public ?? true,
    is_special: group?.is_special ?? true,
    is_negative: group?.is_negative ?? false,
    sort_order: group?.sort_order ?? 600,
  });
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (isNew) await api.post("/admin/achievements/groups", form);
      else await api.patch(`/admin/achievements/groups/${group.code}`, form);
      toast.success("Gespeichert"); onSaved(); onClose();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail) || "Fehler"); }
    setSaving(false);
  };

  return (
    <Modal onClose={onClose} title={isNew ? "Neue Group" : "Group bearbeiten"}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Code (slug, eindeutig)"><input required disabled={!isNew} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} data-testid="group-code" className="input" /></Field>
        <Field label="Name *"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="group-name" className="input" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kategorie">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} data-testid="group-category" className="input">
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Sortierung"><input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} className="input" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Icon (lucide-react kebab-case)"><input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} className="input" /></Field>
          <Field label="Farbe"><input type="color" value={form.accent_color} onChange={(e) => setForm({ ...form, accent_color: e.target.value })} className="input h-10" /></Field>
        </div>
        <Field label="Beschreibung"><textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" /></Field>
        <div className="flex flex-wrap gap-4 text-sm pt-2">
          <Check label="Öffentlich sichtbar" checked={form.public} onChange={(v) => setForm({ ...form, public: v })} testId="group-public" />
          <Check label="Special (Admin-curated)" checked={form.is_special} onChange={(v) => setForm({ ...form, is_special: v })} />
          <Check label="Negativ/Fun (bis Freischaltung geheim)" checked={form.is_negative} onChange={(v) => setForm({ ...form, is_negative: v })} testId="group-negative" />
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-white/60 hover:text-white">Abbrechen</button>
          <button type="submit" disabled={saving} data-testid="group-save" className="px-5 py-2 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm text-xs">{saving ? "Speichere…" : "Speichern"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------- Tiers Tab ----------------
function TiersTab() {
  const [groups, setGroups] = useState([]);
  const [groupCode, setGroupCode] = useState("");
  const [tiers, setTiers] = useState([]);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { api.get("/admin/achievements/groups").then(({ data }) => { setGroups(data); if (!groupCode && data[0]) setGroupCode(data[0].code); }); }, []);
  useEffect(() => {
    if (!groupCode) return;
    api.get(`/admin/achievements/tiers?group_code=${groupCode}`).then(({ data }) => setTiers(data));
  }, [groupCode]);

  const reload = () => api.get(`/admin/achievements/tiers?group_code=${groupCode}`).then(({ data }) => setTiers(data));
  const del = async (t) => {
    if (!window.confirm(`Tier "${t.name}" wirklich löschen?`)) return;
    try { await api.delete(`/admin/achievements/tiers/${t.code}`); toast.success("Gelöscht"); reload(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <Field label="Group">
          <select value={groupCode} onChange={(e) => setGroupCode(e.target.value)} data-testid="tier-group-select" className="input min-w-[260px]">
            {groups.map(g => <option key={g.code} value={g.code}>{g.name} ({g.category})</option>)}
          </select>
        </Field>
        <button onClick={() => setCreating(true)} data-testid="tier-new-btn" className="px-4 py-2 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 text-xs"><Plus className="w-3.5 h-3.5" /> Neue Stufe</button>
      </div>
      <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3">Stufe</th>
                <th className="text-left px-4 py-3">Code</th>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Bedingung</th>
                <th className="text-right px-4 py-3">Punkte</th>
                <th className="text-right px-4 py-3">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {tiers.map(t => (
                <tr key={t.code} data-testid={`tier-row-${t.code}`}>
                  <td className="px-4 py-3"><span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: LEVEL_COLORS[t.level] }}>{LEVEL_NAMES[t.level]}</span></td>
                  <td className="px-4 py-3 text-xs text-white/40 font-mono">{t.code}</td>
                  <td className="px-4 py-3 font-semibold">{t.name}</td>
                  <td className="px-4 py-3 text-xs text-white/55">
                    {t.manual_only ? <span className="text-[#FF3B30]">manuell</span>
                      : t.condition_key ? <>{t.condition_key} ≥ {t.progress_target}</>
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">+{t.points}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing(t)} className="text-[#29B6E8] hover:underline mr-3 text-xs">Bearbeiten</button>
                    <button onClick={() => del(t)} className="text-[#FF3B30] hover:underline text-xs">Löschen</button>
                  </td>
                </tr>
              ))}
              {!tiers.length && <tr><td colSpan="6" className="px-4 py-8 text-center text-white/40 text-sm">Keine Stufen.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {(creating || editing) && (
        <TierForm tier={editing} groupCode={groupCode} onClose={() => { setEditing(null); setCreating(false); }} onSaved={reload} />
      )}
    </div>
  );
}

function TierForm({ tier, groupCode, onClose, onSaved }) {
  const isNew = !tier;
  const [form, setForm] = useState({
    code: tier?.code || "",
    group_code: tier?.group_code || groupCode,
    level: tier?.level || 1,
    name: tier?.name || "",
    description: tier?.description || "",
    condition_key: tier?.condition_key || "",
    progress_target: tier?.progress_target || 1,
    points: tier?.points || 10,
    icon: tier?.icon || "trophy",
    manual_only: tier?.manual_only ?? false,
  });
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (form.manual_only) { payload.condition_key = null; payload.progress_target = null; }
      if (isNew) await api.post("/admin/achievements/tiers", payload);
      else { delete payload.code; delete payload.group_code; await api.patch(`/admin/achievements/tiers/${tier.code}`, payload); }
      toast.success("Gespeichert"); onSaved(); onClose();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail) || "Fehler"); }
    setSaving(false);
  };

  return (
    <Modal onClose={onClose} title={isNew ? "Neue Stufe" : "Stufe bearbeiten"}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Code (eindeutig)"><input required disabled={!isNew} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} data-testid="tier-code" className="input" /></Field>
        <Field label="Name *"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="tier-name" className="input" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Stufe">
            <select value={form.level} onChange={(e) => setForm({ ...form, level: parseInt(e.target.value) })} data-testid="tier-level" className="input">
              {Object.entries(LEVEL_NAMES).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
            </select>
          </Field>
          <Field label="Punkte"><input type="number" value={form.points} onChange={(e) => setForm({ ...form, points: parseInt(e.target.value) || 0 })} data-testid="tier-points" className="input" /></Field>
        </div>
        <Field label="Beschreibung"><textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" /></Field>
        <Check label="Manuell vergeben (kein Progress-Auto-Award)" checked={form.manual_only} onChange={(v) => setForm({ ...form, manual_only: v })} testId="tier-manual" />
        {!form.manual_only && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Condition Key"><input value={form.condition_key} onChange={(e) => setForm({ ...form, condition_key: e.target.value })} placeholder="z. B. matches_played" className="input" /></Field>
            <Field label="Ziel"><input type="number" value={form.progress_target} onChange={(e) => setForm({ ...form, progress_target: parseInt(e.target.value) || 1 })} className="input" /></Field>
          </div>
        )}
        <Field label="Icon (lucide-react)"><input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} className="input" /></Field>
        <div className="flex justify-end gap-2 pt-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-white/60 hover:text-white">Abbrechen</button>
          <button type="submit" disabled={saving} data-testid="tier-save" className="px-5 py-2 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm text-xs">{saving ? "Speichere…" : "Speichern"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------- Manual Award Tab ----------------
function AwardTab() {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [tierCode, setTierCode] = useState("");
  const [tiers, setTiers] = useState([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get("/admin/achievements/tiers").then(({ data }) => setTiers(data)); }, []);
  useEffect(() => {
    const t = setTimeout(() => api.get(`/admin/achievements/users/search?q=${encodeURIComponent(q)}`).then(({ data }) => setUsers(data)), 200);
    return () => clearTimeout(t);
  }, [q]);

  const award = async () => {
    if (!selectedUser || !tierCode) { toast.error("Spieler & Stufe wählen."); return; }
    setBusy(true);
    try {
      await api.post("/admin/achievements/award", { user_id: selectedUser.id, tier_code: tierCode, note });
      toast.success(`Vergeben an ${selectedUser.display_name || selectedUser.username}`);
      setNote("");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
    setBusy(false);
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5">
        <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-2">1 — Spieler suchen</div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input value={q} onChange={(e) => setQ(e.target.value)} data-testid="award-search" placeholder="Username, Name oder E-Mail …" className="w-full bg-[#0A0A0A] border border-white/10 pl-9 pr-3 py-2 rounded-sm text-sm" />
        </div>
        <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-white/5 border border-white/5 rounded-sm">
          {users.map(u => (
            <button key={u.id} type="button" onClick={() => setSelectedUser(u)} data-testid={`award-user-${u.id}`} className={`w-full text-left px-3 py-2 hover:bg-white/5 transition flex items-center gap-3 ${selectedUser?.id === u.id ? "bg-[#FFD700]/10" : ""}`}>
              {u.avatar_url ? <img src={u.avatar_url} alt="" className="w-8 h-8 rounded-sm object-cover" /> : <div className="w-8 h-8 rounded-sm bg-[#0A0A0A] border border-white/10" />}
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{u.display_name || u.username}</div>
                <div className="text-[10px] text-white/40">{u.email}</div>
              </div>
            </button>
          ))}
          {!users.length && <div className="px-3 py-6 text-center text-xs text-white/40">Keine Treffer.</div>}
        </div>
      </div>
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5">
        <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-2">2 — Stufe & Notiz</div>
        {selectedUser && <div className="mb-3 text-sm"><span className="text-white/50">Empfänger:</span> <strong className="ml-2">{selectedUser.display_name || selectedUser.username}</strong></div>}
        <Field label="Achievement-Tier">
          <select value={tierCode} onChange={(e) => setTierCode(e.target.value)} data-testid="award-tier-select" className="input">
            <option value="">— wählen —</option>
            {tiers.map(t => <option key={t.code} value={t.code}>{t.group_code} · {LEVEL_NAMES[t.level]} · {t.name}</option>)}
          </select>
        </Field>
        <Field label="Interne Notiz (Audit-Log)"><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} data-testid="award-note" className="input" placeholder="z. B. Gamers Heaven 2026 Teilnehmer" /></Field>
        <button onClick={award} disabled={busy || !selectedUser || !tierCode} data-testid="award-submit" className="w-full mt-2 px-4 py-3 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm text-xs inline-flex items-center justify-center gap-2 disabled:opacity-40">
          <Award className="w-4 h-4" /> {busy ? "Vergebe…" : "Achievement vergeben"}
        </button>
      </div>
    </div>
  );
}

// ---------------- Negative Tab ----------------
function NegativeTab() {
  const [list, setList] = useState([]);
  useEffect(() => { api.get("/admin/achievements/negative/awards").then(({ data }) => setList(data)); }, []);

  const revoke = async (a) => {
    if (!window.confirm(`Vergabe "${a.tier_name}" für ${a.display_name || a.username} entfernen?`)) return;
    try { await api.delete("/admin/achievements/award", { data: { user_id: a.user_id, tier_code: a.tier_code } }); toast.success("Entfernt"); setList(list.filter(x => !(x.user_id === a.user_id && x.tier_code === a.tier_code))); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
  };

  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden" data-testid="negative-list">
      <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2 text-xs uppercase tracking-widest text-white/55">
        <ShieldOff className="w-3.5 h-3.5 text-[#FF3B30]" /> {list.length} negative/Fun-Awards (vor Freischaltung geheim)
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
            <tr>
              <th className="text-left px-4 py-3">Datum</th>
              <th className="text-left px-4 py-3">Spieler</th>
              <th className="text-left px-4 py-3">Vorfall</th>
              <th className="text-left px-4 py-3">Code</th>
              <th className="text-right px-4 py-3">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {list.map(a => (
              <tr key={a.user_id + a.tier_code}>
                <td className="px-4 py-3 text-xs text-white/45 whitespace-nowrap">{new Date(a.earned_at).toLocaleString("de-DE")}</td>
                <td className="px-4 py-3"><div className="font-semibold">{a.display_name || a.username}</div><div className="text-xs text-white/40">@{a.username}</div></td>
                <td className="px-4 py-3 text-[#FF3B30]">{a.tier_name}</td>
                <td className="px-4 py-3 text-xs text-white/40 font-mono">{a.tier_code}</td>
                <td className="px-4 py-3 text-right"><button onClick={() => revoke(a)} className="text-[#FF3B30] hover:underline text-xs">Entfernen</button></td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan="5" className="px-4 py-12 text-center text-white/40 text-sm">Keine negativen Vorfälle.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- helpers ----------------
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#121212] border border-white/10 rounded-sm w-full max-w-xl my-6 p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-heading text-xl font-black uppercase">{title}</h3>
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        {children}
        <style>{`.input{ width:100%; background:#0A0A0A; border:1px solid rgba(255,255,255,0.1); padding:0.5rem 0.75rem; border-radius:2px; font-size:13px; color:#fff; }`}</style>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      {children}
    </label>
  );
}

function Check({ label, checked, onChange, testId }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} className="accent-[#FFD700]" /> {label}
    </label>
  );
}
