import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { toast } from "sonner";

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const [form, setForm] = useState({
    display_name: user?.display_name || "",
    discord_name: user?.discord_name || "",
    switch_code: user?.switch_code || "",
    steam_id: user?.steam_id || "",
    epic_id: user?.epic_id || "",
    psn_id: user?.psn_id || "",
    xbox_id: user?.xbox_id || "",
    country: user?.country || "",
    bio: user?.bio || "",
    privacy_public_profile: user?.privacy_public_profile ?? true,
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch("/users/me", form);
      await refresh();
      toast.success("Profil gespeichert.");
    } catch (err) {
      toast.error("Fehler beim Speichern.");
    } finally { setSaving(false); }
  };

  return (
    <PublicLayout>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Einstellungen</span>
        <h1 className="mt-2 font-heading text-3xl md:text-5xl font-black uppercase">Mein Profil</h1>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <Field label="Display Name" value={form.display_name} onChange={(v) => set("display_name", v)} testId="profile-display-name" />
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Discord Name" value={form.discord_name} onChange={(v) => set("discord_name", v)} testId="profile-discord" />
            <Field label="Switch Friend Code" value={form.switch_code} onChange={(v) => set("switch_code", v)} testId="profile-switch" />
            <Field label="Steam ID" value={form.steam_id} onChange={(v) => set("steam_id", v)} testId="profile-steam" />
            <Field label="Epic ID" value={form.epic_id} onChange={(v) => set("epic_id", v)} testId="profile-epic" />
            <Field label="PSN" value={form.psn_id} onChange={(v) => set("psn_id", v)} testId="profile-psn" />
            <Field label="Xbox" value={form.xbox_id} onChange={(v) => set("xbox_id", v)} testId="profile-xbox" />
          </div>
          <Field label="Land" value={form.country} onChange={(v) => set("country", v)} placeholder="AT, DE, CH" testId="profile-country" />
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Bio</div>
            <textarea
              value={form.bio}
              onChange={(e) => set("bio", e.target.value)}
              rows={4}
              data-testid="profile-bio"
              className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.privacy_public_profile} onChange={(e) => set("privacy_public_profile", e.target.checked)} data-testid="profile-privacy" className="accent-[#29B6E8]" />
            <span>Mein Profil ist öffentlich sichtbar</span>
          </label>
          <button disabled={saving} data-testid="profile-save" className="px-6 py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] disabled:opacity-50 transition">
            {saving ? "Speichere …" : "Speichern"}
          </button>
        </form>
      </div>
    </PublicLayout>
  );
}

function Field({ label, value, onChange, placeholder, testId }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input
        type="text"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        data-testid={testId}
        className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white"
      />
    </label>
  );
}
