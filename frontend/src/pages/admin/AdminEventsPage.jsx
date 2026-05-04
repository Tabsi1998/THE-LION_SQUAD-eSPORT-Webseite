import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { toast } from "sonner";
import { Plus, Save, X, Trash2, Calendar } from "lucide-react";

export default function AdminEventsPage() {
  const [list, setList] = useState([]);
  const [meta, setMeta] = useState({ types: [], statuses: [], visibilities: [] });
  const [editing, setEditing] = useState(null);

  const load = async () => {
    const { data } = await api.get("/events");
    setList(data);
  };
  useEffect(() => {
    load();
    api.get("/events/meta").then(({ data }) => setMeta(data)).catch(() => {});
  }, []);

  const remove = async (id) => {
    if (!window.confirm("Event löschen?")) return;
    try { await api.delete(`/events/${id}`); toast.success("Gelöscht."); load(); } catch { toast.error("Fehler."); }
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#9F7AEA]">VEREINS-CMS</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Events</h1>
          <p className="text-sm text-white/60 mt-1">Vereinsabende, LAN-Partys, Grillabende, Messen — alles zentral verwaltet.</p>
        </div>
        <button onClick={() => setEditing({})} data-testid="events-new" className="inline-flex items-center gap-2 px-4 py-2 bg-[#9F7AEA] text-black font-bold uppercase tracking-wider text-xs rounded-sm hover:bg-[#7C5CE0] transition">
          <Plus className="w-3.5 h-3.5" /> Neues Event
        </button>
      </div>

      {list.length === 0 ? (
        <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
          <Calendar className="w-10 h-10 mx-auto opacity-40 mb-3" />
          <div className="font-heading font-bold">Noch keine Events</div>
        </div>
      ) : (
        <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Typ</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Sichtbar</th>
                  <th className="text-left px-4 py-3">Start</th>
                  <th className="text-left px-4 py-3">Ort</th>
                  <th className="text-center px-4 py-3">Aktion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {list.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-3"><div className="font-bold">{e.name}</div><div className="text-[11px] text-white/50">/{e.slug}</div></td>
                    <td className="px-4 py-3 text-[10px] uppercase tracking-widest text-[#9F7AEA] font-bold">{meta.types.find((t) => t.k === e.event_type)?.l || e.event_type}</td>
                    <td className="px-4 py-3 text-[10px] uppercase tracking-widest text-white/70 font-bold">{meta.statuses.find((s) => s.k === e.status)?.l || e.status}</td>
                    <td className="px-4 py-3 text-[10px] uppercase tracking-widest text-white/60">{e.visibility}</td>
                    <td className="px-4 py-3 text-xs text-white/70">{e.start_date ? new Date(e.start_date).toLocaleDateString("de-DE") : "—"}</td>
                    <td className="px-4 py-3 text-xs text-white/55">{e.location || "—"}</td>
                    <td className="px-4 py-3 text-center space-x-1 whitespace-nowrap">
                      <button onClick={() => setEditing(e)} data-testid={`event-edit-${e.id}`} className="text-xs font-bold uppercase px-3 py-1 rounded-sm border border-[#9F7AEA]/40 text-[#9F7AEA] hover:bg-[#9F7AEA]/10">Bearbeiten</button>
                      <button onClick={() => remove(e.id)} data-testid={`event-delete-${e.id}`} className="text-xs font-bold uppercase px-3 py-1 rounded-sm border border-[#FF3B30]/40 text-[#FF3B30] hover:bg-[#FF3B30]/10 inline-flex items-center"><Trash2 className="w-3 h-3" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && <EventModal event={editing} meta={meta} onClose={() => setEditing(null)} onSaved={load} />}
    </AdminLayout>
  );
}

function EventModal({ event, meta, onClose, onSaved }) {
  const isNew = !event?.id;
  const slugFrom = (txt) => (txt || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  const [form, setForm] = useState({
    name: event.name || "",
    slug: event.slug || "",
    description: event.description || "",
    event_type: event.event_type || "general",
    visibility: event.visibility || "public",
    start_date: event.start_date?.slice(0, 16) || "",
    end_date: event.end_date?.slice(0, 16) || "",
    door_time: event.door_time?.slice(0, 16) || "",
    registration_opens_at: event.registration_opens_at?.slice(0, 16) || "",
    registration_closes_at: event.registration_closes_at?.slice(0, 16) || "",
    location: event.location || "",
    address: event.address || "",
    is_online: event.is_online ?? false,
    is_hybrid: event.is_hybrid ?? false,
    banner_url: event.banner_url || "",
    contact: event.contact || "",
    max_participants: event.max_participants || "",
    show_participants: event.show_participants ?? true,
    program: event.program || "",
    has_live_stream: event.has_live_stream ?? false,
    stream_platform: event.stream_platform || "",
    stream_url: event.stream_url || "",
    status: event.status || "draft",
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (ev) => {
    ev.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      Object.keys(payload).forEach((k) => { if (payload[k] === "") payload[k] = null; });
      if (payload.max_participants) payload.max_participants = parseInt(payload.max_participants);
      if (isNew) {
        delete payload.status;
        await api.post("/events", payload);
      } else {
        await api.patch(`/events/${event.id}`, payload);
      }
      toast.success("Gespeichert.");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Fehler.");
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-3xl bg-[#121212] border border-white/10 rounded-sm">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="font-heading font-black uppercase">{isNew ? "Neues Event" : "Event bearbeiten"}</h2>
          <button type="button" onClick={onClose} className="text-white/60 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <Field label="Name"><Input value={form.name} onChange={(v) => { set("name", v); if (isNew && !form.slug) set("slug", slugFrom(v)); }} testId="event-name" required /></Field>
          <Field label="Slug"><Input value={form.slug} onChange={(v) => set("slug", v)} testId="event-slug" required /></Field>
          <Field label="Beschreibung">
            <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Typ">
              <select value={form.event_type} onChange={(e) => set("event_type", e.target.value)} data-testid="event-type" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
                {meta.types.map((t) => <option key={t.k} value={t.k}>{t.l}</option>)}
              </select>
            </Field>
            <Field label="Sichtbarkeit">
              <select value={form.visibility} onChange={(e) => set("visibility", e.target.value)} data-testid="event-visibility" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
                {meta.visibilities.map((v) => <option key={v.k} value={v.k}>{v.l}</option>)}
              </select>
            </Field>
            {!isNew && (
              <Field label="Status">
                <select value={form.status} onChange={(e) => set("status", e.target.value)} data-testid="event-status" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
                  {meta.statuses.map((s) => <option key={s.k} value={s.k}>{s.l}</option>)}
                </select>
              </Field>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start"><input type="datetime-local" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} data-testid="event-start" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" /></Field>
            <Field label="Ende"><input type="datetime-local" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" /></Field>
            <Field label="Einlass / Türöffnung"><input type="datetime-local" value={form.door_time} onChange={(e) => set("door_time", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" /></Field>
            <Field label="Max. Teilnehmer"><input type="number" value={form.max_participants} onChange={(e) => set("max_participants", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" /></Field>
            <Field label="Anmeldung öffnet"><input type="datetime-local" value={form.registration_opens_at} onChange={(e) => set("registration_opens_at", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" /></Field>
            <Field label="Anmeldung schließt"><input type="datetime-local" value={form.registration_closes_at} onChange={(e) => set("registration_closes_at", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" /></Field>
            <Field label="Ort / Location"><Input value={form.location} onChange={(v) => set("location", v)} placeholder="Innsbruck" /></Field>
            <Field label="Adresse"><Input value={form.address} onChange={(v) => set("address", v)} placeholder="Maria-Theresien-Str. 1" /></Field>
            <Field label="Banner URL"><Input value={form.banner_url} onChange={(v) => set("banner_url", v)} placeholder="https://…" /></Field>
            <Field label="Kontakt"><Input value={form.contact} onChange={(v) => set("contact", v)} placeholder="Name oder E-Mail" /></Field>
          </div>
          <Field label="Programm / Tagesablauf">
            <textarea value={form.program} onChange={(e) => set("program", e.target.value)} rows={4} placeholder="17:00 Einlass&#10;18:00 LAN-Setup&#10;19:30 Eröffnungsturnier" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm font-mono text-sm" />
          </Field>
          <div className="border border-white/10 p-3 rounded-sm bg-[#0A0A0A] space-y-3">
            <div className="text-[11px] uppercase tracking-widest font-bold text-white/60">Live Stream (optional)</div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.has_live_stream} onChange={(e) => set("has_live_stream", e.target.checked)} className="accent-[#FF3B30]" />
              Live Stream hinterlegt
            </label>
            {form.has_live_stream && (
              <div className="grid grid-cols-2 gap-3">
                <select value={form.stream_platform || ""} onChange={(e) => set("stream_platform", e.target.value)} className="bg-[#121212] border border-white/10 px-3 py-2 rounded-sm">
                  <option value="">Plattform —</option>
                  <option value="twitch">Twitch</option>
                  <option value="youtube">YouTube</option>
                  <option value="kick">Kick</option>
                  <option value="custom">Custom</option>
                </select>
                <Input value={form.stream_url} onChange={(v) => set("stream_url", v)} placeholder="Stream URL / Channel" />
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_online} onChange={(e) => set("is_online", e.target.checked)} className="accent-[#9F7AEA]" />
              Nur Online
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_hybrid} onChange={(e) => set("is_hybrid", e.target.checked)} className="accent-[#9F7AEA]" />
              Hybrid (offline + online)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.show_participants} onChange={(e) => set("show_participants", e.target.checked)} className="accent-[#9F7AEA]" />
              Teilnehmer öffentlich anzeigen
            </label>
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t border-white/10">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-white/10 text-white/60 hover:text-white text-xs uppercase tracking-wider font-bold rounded-sm">Abbrechen</button>
          <button type="submit" disabled={saving} data-testid="event-save" className="ml-auto inline-flex items-center gap-2 px-5 py-2 bg-[#9F7AEA] text-black text-xs uppercase tracking-wider font-bold rounded-sm hover:bg-[#7C5CE0] disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> {saving ? "Speichere…" : "Speichern"}
          </button>
        </div>
      </form>
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
function Input({ value, onChange, placeholder, testId, required }) {
  return <input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-testid={testId} required={required} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />;
}
