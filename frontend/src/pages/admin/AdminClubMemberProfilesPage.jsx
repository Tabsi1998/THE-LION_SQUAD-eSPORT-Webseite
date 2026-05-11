import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Crown, Edit3, Eye, Plus, Save, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { MarkdownEditor } from "@/components/tls/MarkdownEditor";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { api, formatRequestError, resolveMediaUrl, suggestSlug } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

const emptyForm = {
  display_name: "",
  gamertag: "",
  real_name: "",
  slug: "",
  role_title: "",
  photo_url: "",
  cover_url: "",
  bio: "",
  birth_date: "",
  gender: "",
  user_id: "",
  games: "",
  platforms: "",
  order_index: 0,
  is_active: true,
};

function listToText(values) {
  return (values || []).join(", ");
}

function textToList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toForm(profile) {
  if (!profile) return emptyForm;
  return {
    display_name: profile.display_name || "",
    gamertag: profile.gamertag || "",
    real_name: profile.real_name || "",
    slug: profile.slug || "",
    role_title: profile.editorial_role_title || "",
    photo_url: profile.photo_url || "",
    cover_url: profile.cover_url || "",
    bio: profile.bio || "",
    birth_date: profile.birth_date || "",
    gender: profile.gender || "",
    user_id: profile.user_id || "",
    games: listToText(profile.games),
    platforms: listToText(profile.platforms),
    order_index: profile.order_index || 0,
    is_active: profile.is_active !== false,
  };
}

export function ClubMemberProfilesAdminContent() {
  const [profiles, setProfiles] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profilesRes, usersRes] = await Promise.all([
        api.get("/membership/profiles/admin/all"),
        api.get("/users"),
      ]);
      setProfiles(profilesRes.data || []);
      setUsers(usersRes.data || []);
    } catch (e) {
      toast.error(formatRequestError(e, "Mitgliederprofile konnten nicht geladen werden."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["membership", "media", "uploads", "users", "board"]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return profiles;
    return profiles.filter((p) => [p.display_name, p.gamertag, p.real_name, p.role_title, p.board_title, p.slug, p.linked_account?.username, ...(p.games || []), ...(p.platforms || [])].join(" ").toLowerCase().includes(needle));
  }, [profiles, q]);

  const remove = async (profile) => {
    if (!await confirm({ title: "Mitgliederprofil löschen?", description: `"${profile.display_name}" wird von der öffentlichen Vereinsmitgliederseite entfernt.`, confirmLabel: "Löschen" })) return;
    try {
      await api.delete(`/membership/profiles/admin/${profile.id}`);
      toast.success("Mitgliederprofil gelöscht.");
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Mitgliederprofil konnte nicht gelöscht werden."));
    }
  };

  return (
    <>
      <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Öffentliche Seite</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Vereinsmitglieder</h1>
          <p className="text-sm text-white/60 mt-1 max-w-3xl">
            Redaktionelle Mitgliederübersicht mit festen Profilen, großen Bildern, Bio, Games und Plattformen. Funktionen wie Obmann/Kassier kommen automatisch aus dem Vorstand.
          </p>
        </div>
        <button onClick={() => setEditing({ profile: null, form: toForm(null) })} className="inline-flex items-center gap-2 px-4 py-2 bg-[#FFD700] text-black rounded-sm text-xs font-black uppercase tracking-wider hover:bg-[#e8c200]">
          <Plus className="w-4 h-4" /> Profil erstellen
        </button>
      </div>

      <div className="flex items-center gap-2 max-w-md mb-5">
        <Search className="w-4 h-4 text-white/40" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, Funktion, Game suchen…" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
      </div>

      {loading ? (
        <div className="text-white/40 text-sm">Lade Mitgliederprofile...</div>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-white/15 bg-[#121212] rounded-sm p-12 text-center text-white/45">
          Noch keine redaktionellen Vereinsmitglieder angelegt.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((profile) => (
            <article key={profile.id} className={`border rounded-sm bg-[#121212] overflow-hidden ${profile.is_active ? "border-white/10" : "border-white/10 opacity-55"}`}>
              <div className="aspect-[16/9] bg-[#0A0A0A]">
                {profile.photo_url ? (
                  <img src={resolveMediaUrl(profile.photo_url)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/20"><Crown className="w-10 h-10" /></div>
                )}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-heading font-black uppercase truncate">{profile.gamertag || profile.display_name}</h2>
                    {profile.real_name && <p className="text-[10px] text-white/40 truncate">{profile.real_name}</p>}
                    <p className="text-xs text-[#FFD700] uppercase tracking-wider font-bold">{profile.board_title || profile.role_title || "Mitglied"}</p>
                    {profile.board_title && profile.role_title && profile.board_title !== profile.role_title && (
                      <p className="text-[10px] text-white/35 uppercase tracking-widest">Profil: {profile.role_title}</p>
                    )}
                    {profile.linked_account && (
                      <p className="text-[10px] text-white/35 truncate">@{profile.linked_account.username}</p>
                    )}
                  </div>
                  <span className="text-[10px] text-white/40 font-mono">#{profile.order_index || 0}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(profile.games || []).slice(0, 4).map((game) => <span key={game} className="px-2 py-1 bg-white/5 border border-white/10 rounded-sm text-[10px] text-white/60">{game}</span>)}
                </div>
                <div className="mt-4 flex gap-2">
                  <Link to={`/members/${profile.slug}`} target="_blank" className="px-3 py-2 border border-white/10 text-white/65 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 hover:text-white">
                    <Eye className="w-3.5 h-3.5" /> Öffnen
                  </Link>
                  <button onClick={() => setEditing({ profile, form: toForm(profile) })} className="px-3 py-2 border border-[#29B6E8]/40 text-[#29B6E8] rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 hover:bg-[#29B6E8]/10">
                    <Edit3 className="w-3.5 h-3.5" /> Bearbeiten
                  </button>
                  <button onClick={() => remove(profile)} className="ml-auto px-3 py-2 border border-[#FF3B30]/35 text-[#FF3B30] rounded-sm text-xs font-bold uppercase tracking-wider hover:bg-[#FF3B30]/10">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing && (
        <ProfileModal
          entry={editing}
          users={users}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}

export default function AdminClubMemberProfilesPage() {
  return (
    <AdminLayout>
      <ClubMemberProfilesAdminContent />
    </AdminLayout>
  );
}

function ProfileModal({ entry, users = [], onClose, onSaved }) {
  const [form, setForm] = useState(entry.form);
  const [saving, setSaving] = useState(false);
  const isEdit = !!entry.profile;
  const set = (key, value) => setForm((cur) => ({ ...cur, [key]: value }));

  const payload = () => ({
    display_name: form.display_name,
    gamertag: form.gamertag || null,
    real_name: form.real_name || form.display_name || null,
    slug: form.slug || suggestSlug(form.gamertag || form.display_name).replace(/-\d{4}$/, ""),
    role_title: form.role_title || null,
    photo_url: form.photo_url || null,
    cover_url: form.cover_url || null,
    bio: form.bio || "",
    birth_date: form.birth_date || null,
    gender: form.gender || null,
    user_id: form.user_id || null,
    games: textToList(form.games),
    platforms: textToList(form.platforms),
    order_index: Number(form.order_index) || 0,
    is_active: !!form.is_active,
  });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (isEdit) await api.patch(`/membership/profiles/admin/${entry.profile.id}`, payload());
      else await api.post("/membership/profiles/admin", payload());
      toast.success(isEdit ? "Mitgliederprofil gespeichert." : "Mitgliederprofil erstellt.");
      onSaved();
    } catch (e) {
      toast.error(formatRequestError(e, "Mitgliederprofil konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 overflow-y-auto p-4">
      <form onSubmit={submit} className="w-full max-w-6xl mx-auto my-4 bg-[#121212] border border-white/10 rounded-sm shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="font-heading font-black uppercase">{isEdit ? "Profil bearbeiten" : "Profil erstellen"}</h2>
          <button type="button" onClick={onClose} className="p-1 text-white/60 hover:text-white" aria-label="Schließen"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 grid lg:grid-cols-[minmax(0,1fr)_19rem] gap-5">
          <div className="space-y-4 min-w-0">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Gamertag"><input value={form.gamertag} onChange={(e) => set("gamertag", e.target.value)} placeholder="z.B. Tabsi98" className="input" /></Field>
              <Field label="Vor- und Nachname"><input required value={form.display_name} onChange={(e) => set("display_name", e.target.value)} placeholder="z.B. Fabian Tabelander" className="input" /></Field>
              <Field label="Öffentlicher Realname"><input value={form.real_name} onChange={(e) => set("real_name", e.target.value)} placeholder="leer = Vor- und Nachname" className="input" /></Field>
              <Field label="URL-Slug"><input value={form.slug} onChange={(e) => set("slug", e.target.value)} placeholder="wird aus Gamertag erstellt" className="input font-mono" /></Field>
              <Field label="Geburtsdatum"><input type="date" value={form.birth_date} onChange={(e) => set("birth_date", e.target.value)} className="input" /></Field>
              <Field label="Geschlecht"><select value={form.gender || ""} onChange={(e) => set("gender", e.target.value)} className="input">
                <option value="">Keine Angabe</option>
                <option value="male">Männlich</option>
                <option value="female">Weiblich</option>
                <option value="diverse">Divers</option>
              </select></Field>
              <Field label="Plattform-Konto"><select value={form.user_id || ""} onChange={(e) => set("user_id", e.target.value)} className="input">
                <option value="">Kein Account verknüpft</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.display_name || u.username} · @{u.username}</option>
                ))}
              </select></Field>
              <Field label="Games"><input value={form.games} onChange={(e) => set("games", e.target.value)} placeholder="F1 25, Valorant, Rocket League" className="input" /></Field>
              <Field label="Plattformen"><input value={form.platforms} onChange={(e) => set("platforms", e.target.value)} placeholder="PC, PS5, Xbox" className="input" /></Field>
            </div>
            <div className="border border-[#FFD700]/20 bg-[#FFD700]/5 px-3 py-2 text-xs text-white/60 rounded-sm">
              Ohne Vorstandszuteilung ist die öffentliche Funktion automatisch <span className="text-white font-bold">Mitglied</span>. Obmann, Kassierin und Stellvertretungen steuerst du im Tab <span className="text-white font-bold">Vorstand</span>.
            </div>
            <Field label="Biografie">
              <MarkdownEditor value={form.bio} onChange={(v) => set("bio", v)} rows={8} testId="club-member-bio" />
            </Field>
          </div>
          <aside className="space-y-4 min-w-0">
            <ImageUpload value={form.photo_url} onChange={(v) => set("photo_url", v)} label="Profilbild" testId="club-member-photo" variant="wide" allowLibrary />
            <ImageUpload value={form.cover_url} onChange={(v) => set("cover_url", v)} label="Detail-Cover optional" testId="club-member-cover" variant="wide" allowLibrary />
            <Field label="Sortierung"><input type="number" value={form.order_index} onChange={(e) => set("order_index", e.target.value)} className="input" /></Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} className="accent-[#FFD700]" />
              <span>Öffentlich anzeigen</span>
            </label>
          </aside>
        </div>
        <div className="flex gap-3 p-5 border-t border-white/10">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-white/10 text-white/60 hover:text-white text-xs uppercase tracking-wider font-bold rounded-sm">Abbrechen</button>
          <button type="submit" disabled={saving} className="ml-auto inline-flex items-center gap-2 px-5 py-2 bg-[#FFD700] text-black text-xs uppercase tracking-wider font-black rounded-sm hover:bg-[#e8c200] disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> {saving ? "Speichere…" : "Speichern"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      {children}
    </div>
  );
}
