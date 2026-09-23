import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Crown, Edit3, Eye, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, FieldLabel, SelectField, TextField } from "@/components/tls/FormFields";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { MarkdownEditor } from "@/components/tls/MarkdownEditor";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { api, formatRequestError, resolveMediaUrl, suggestSlug } from "@/lib/api";
import { buildDirtyPayload, hasPayloadChanges } from "@/lib/dirtyPayload";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { GermanDateField } from "@/components/tls/GermanDateField";
import { SkeletonList } from "@/components/tls/Skeleton";

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
  directory_blocked: false,
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
    directory_blocked: !!profile.directory_blocked,
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
        <SkeletonList rows={5} label="Lade Mitgliederprofile" />
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
                    {/* Verzeichnis per Opt-in (#410): vom Mitglied selbst angelegt, ggf. gesperrt */}
                    {profile.source === "member" && <p className="mt-1 text-[10px] uppercase tracking-widest font-bold text-[#29B6E8]" data-testid={`club-member-self-${profile.id}`}>vom Mitglied eingetragen</p>}
                    {profile.directory_blocked && <p className="text-[10px] uppercase tracking-widest font-bold text-[#FF3B30]" data-testid={`club-member-blocked-${profile.id}`}>gesperrt</p>}
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

  const payload = (source = form) => ({
    display_name: source.display_name,
    gamertag: source.gamertag || null,
    real_name: source.real_name || source.display_name || null,
    slug: source.slug || suggestSlug(source.gamertag || source.display_name).replace(/-\d{4}$/, ""),
    role_title: source.role_title || null,
    photo_url: source.photo_url || null,
    cover_url: source.cover_url || null,
    bio: source.bio || "",
    birth_date: source.birth_date || null,
    gender: source.gender || null,
    user_id: source.user_id || null,
    games: textToList(source.games),
    platforms: textToList(source.platforms),
    order_index: Number(source.order_index) || 0,
    is_active: !!source.is_active,
    directory_blocked: !!source.directory_blocked,
  });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const currentPayload = payload();
      if (isEdit) {
        const patch = buildDirtyPayload(currentPayload, payload(entry.form));
        if (!hasPayloadChanges(patch)) {
          toast.info("Keine Änderungen zum Speichern.");
          return;
        }
        await api.patch(`/membership/profiles/admin/${entry.profile.id}`, patch);
      } else {
        await api.post("/membership/profiles/admin", currentPayload);
      }
      toast.success(isEdit ? "Mitgliederprofil gespeichert." : "Mitgliederprofil erstellt.");
      onSaved();
    } catch (e) {
      toast.error(formatRequestError(e, "Mitgliederprofil konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  };

  // Seitenblatt statt 1152-px-Fenster (#435): Person, Biografie, Bilder und Anzeige als Abschnitte.
  return (
    <AdminSheet title={isEdit ? "Profil bearbeiten" : "Profil erstellen"} eyebrow="Mitgliederprofile" accent="#FFD700" size="xl" onClose={onClose} onSubmit={submit} saving={saving} submitTestId="club-member-save" testId="club-member-sheet">
      <FormSection title="Person" accent="#FFD700">
        <FormGrid>
          <TextField label="Gamertag" value={form.gamertag} onChange={(v) => set("gamertag", v)} placeholder="z.B. Tabsi98" testId="club-member-gamertag" />
          <TextField label="Vor- und Nachname" required value={form.display_name} onChange={(v) => set("display_name", v)} placeholder="z.B. Fabian Tabelander" testId="club-member-display-name" />
          <TextField label="Öffentlicher Realname" value={form.real_name} onChange={(v) => set("real_name", v)} placeholder="leer = Vor- und Nachname" />
          <TextField label="URL-Slug" value={form.slug} onChange={(v) => set("slug", v)} placeholder="wird aus Gamertag erstellt" className="font-mono" />
          <GermanDateField id="member-birth-date" label="Geburtsdatum" value={form.birth_date} onChange={(v) => set("birth_date", v)} testId="member-birth-date" />
          <SelectField label="Geschlecht" value={form.gender || ""} onChange={(v) => set("gender", v)} options={[["", "Keine Angabe"], ["male", "Männlich"], ["female", "Weiblich"], ["diverse", "Divers"]]} />
          <SelectField label="Plattform-Konto" value={form.user_id || ""} onChange={(v) => set("user_id", v)} options={[["", "Kein Account verknüpft"], ...users.map((u) => [u.id, `${u.display_name || u.username} · @${u.username}`])]} />
          <TextField label="Games" value={form.games} onChange={(v) => set("games", v)} placeholder="F1 25, Valorant, Rocket League" />
          <TextField label="Plattformen" value={form.platforms} onChange={(v) => set("platforms", v)} placeholder="PC, PS5, Xbox" />
        </FormGrid>
        <div className="border border-[#FFD700]/20 bg-[#FFD700]/5 px-3 py-2 text-xs text-white/60 rounded-sm">
          Ohne Vorstandszuteilung ist die öffentliche Funktion automatisch <span className="text-white font-bold">Mitglied</span>. Obmann, Kassierin und Stellvertretungen steuerst du im Tab <span className="text-white font-bold">Vorstand</span>.
        </div>
        <FieldLabel label="Biografie">
          <MarkdownEditor value={form.bio} onChange={(v) => set("bio", v)} rows={8} testId="club-member-bio" />
        </FieldLabel>
      </FormSection>

      <FormSection title="Bilder und Anzeige" accent="#FFD700">
        <FormGrid>
          <ImageUpload value={form.photo_url} onChange={(v) => set("photo_url", v)} label="Profilbild" testId="club-member-photo" variant="wide" allowLibrary />
          <ImageUpload value={form.cover_url} onChange={(v) => set("cover_url", v)} label="Detail-Cover optional" testId="club-member-cover" variant="wide" allowLibrary />
        </FormGrid>
        <FormGrid>
          <TextField label="Sortierung" type="number" value={form.order_index} onChange={(v) => set("order_index", v)} />
          <CheckField label="Öffentlich anzeigen" checked={form.is_active} onChange={(v) => set("is_active", v)} accent="#FFD700" className="self-end pb-2" />
        </FormGrid>
        <CheckField label="Für das Mitglied sperren" checked={form.directory_blocked} onChange={(v) => set("directory_blocked", v)} accent="#FF3B30" testId="club-member-blocked" hint="Der Eintrag geht offline, und das Mitglied kann ihn unter „Meine Mitgliedschaft“ nicht wieder einschalten, bis die Sperre weg ist." />
      </FormSection>
    </AdminSheet>
  );
}
