import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { toast } from "sonner";

export default function AdminF1NewPage() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    title: "", slug: "", description: "",
    vehicle: "", weather: "", assists_allowed: "",
    controller_type: "", platform: "", banner_url: "",
    unlimited_attempts: true, max_attempts: 0,
    is_championship: false,
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (payload.unlimited_attempts) payload.max_attempts = null;
      const { data } = await api.post("/f1/challenges", payload);
      toast.success("Challenge erstellt.");
      nav(`/admin/f1/${data.id}`);
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
    setSaving(false);
  };

  const autoSlug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">F1 Fast Lap</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Neue Challenge</h1>
      <form onSubmit={submit} className="max-w-2xl space-y-4">
        <Field label="Titel" value={form.title} onChange={(v) => { set("title", v); if (!form.slug) set("slug", autoSlug(v)); }} required testId="f1-new-title" />
        <Field label="Slug (URL)" value={form.slug} onChange={(v) => set("slug", v)} required testId="f1-new-slug" />
        <Textarea label="Beschreibung" value={form.description} onChange={(v) => set("description", v)} testId="f1-new-description" />
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Fahrzeug" value={form.vehicle} onChange={(v) => set("vehicle", v)} testId="f1-new-vehicle" />
          <Field label="Wetter" value={form.weather} onChange={(v) => set("weather", v)} testId="f1-new-weather" />
          <Field label="Fahrhilfen" value={form.assists_allowed} onChange={(v) => set("assists_allowed", v)} testId="f1-new-assists" />
          <Field label="Controller-Typ" value={form.controller_type} onChange={(v) => set("controller_type", v)} testId="f1-new-controller" />
          <Field label="Plattform" value={form.platform} onChange={(v) => set("platform", v)} testId="f1-new-platform" />
          <Field label="Banner URL" value={form.banner_url} onChange={(v) => set("banner_url", v)} testId="f1-new-banner" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" data-testid="f1-new-championship" checked={form.is_championship} onChange={(e) => set("is_championship", e.target.checked)} className="accent-[#29B6E8]" />
          <span>Championship (mehrere Strecken + Punkte pro Platz)</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" data-testid="f1-new-unlimited" checked={form.unlimited_attempts} onChange={(e) => set("unlimited_attempts", e.target.checked)} className="accent-[#29B6E8]" />
          <span>Unbegrenzte Versuche</span>
        </label>
        {!form.unlimited_attempts && <Field label="Max Versuche" type="number" value={form.max_attempts} onChange={(v) => set("max_attempts", Number(v))} testId="f1-new-max-attempts" />}
        <button disabled={saving} data-testid="f1-new-submit" className="px-6 py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] disabled:opacity-50">
          {saving ? "Erstelle…" : "Challenge erstellen"}
        </button>
      </form>
    </AdminLayout>
  );
}

function Field({ label, value, onChange, type = "text", required, testId }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={required} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white focus:outline-none" />
    </label>
  );
}
function Textarea({ label, value, onChange, testId }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={3} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white focus:outline-none" />
    </label>
  );
}
