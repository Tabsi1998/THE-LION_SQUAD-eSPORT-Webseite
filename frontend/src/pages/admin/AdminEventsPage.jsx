import { useCallback, useEffect, useState } from "react";
import { api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { appendEmbedToken } from "@/components/tls/RichContent";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Flag, Plus, Save, X, Trash2, Calendar, Trophy } from "lucide-react";

const CREATE_STATUS_OPTIONS = [
  ["draft", "Entwurf"],
  ["scheduled", "Angekündigt"],
];

export default function AdminEventsPage() {
  const [list, setList] = useState([]);
  const [meta, setMeta] = useState({ types: [], statuses: [], visibilities: [] });
  const [sponsors, setSponsors] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [f1Challenges, setF1Challenges] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    const { data } = await api.get("/events");
    setList(data);
  }, []);
  const loadRelations = useCallback(async () => {
    Promise.allSettled([
      api.get("/sponsors/admin"),
      api.get("/tournaments"),
      api.get("/f1/challenges"),
    ]).then(([s, t, f]) => {
      if (s.status === "fulfilled") setSponsors(s.value.data || []);
      if (t.status === "fulfilled") setTournaments(t.value.data || []);
      if (f.status === "fulfilled") setF1Challenges(f.value.data || []);
    });
  }, []);
  const refreshAll = useCallback(() => {
    load();
    loadRelations();
  }, [load, loadRelations]);
  useEffect(() => {
    load();
    api.get("/events/meta").then(({ data }) => setMeta(data)).catch(() => {});
    loadRelations();
  }, [load, loadRelations]);
  useApiInvalidation(refreshAll, ["events", "tournaments", "f1"]);

  const remove = async (id) => {
    if (!window.confirm("Event löschen?")) return;
    try { await api.delete(`/events/${id}`); toast.success("Gelöscht."); load(); } catch (err) { toast.error(formatRequestError(err, "Event konnte nicht geloescht werden.")); }
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

      {editing && <EventModal event={editing} meta={meta} sponsors={sponsors} tournaments={tournaments} f1Challenges={f1Challenges} onClose={() => setEditing(null)} onSaved={refreshAll} />}
    </AdminLayout>
  );
}

function EventModal({ event, meta, sponsors = [], tournaments = [], f1Challenges = [], onClose, onSaved }) {
  const isNew = !event?.id;
  const slugFrom = (txt) => (txt || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
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
    has_registration: event.has_registration ?? false,
    registration_url: event.registration_url || "",
    location: event.location || "",
    address: event.address || "",
    postal_code: event.postal_code || "",
    city: event.city || "",
    country: event.country || "Österreich",
    show_map: event.show_map ?? true,
    organizer_name: event.organizer_name || "",
    organizer_url: event.organizer_url || "",
    owned_by_club: event.owned_by_club ?? true,
    show_sponsors: event.show_sponsors ?? true,
    sponsor_ids: event.sponsor_ids || [],
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
  const [relatedTournamentIds, setRelatedTournamentIds] = useState([]);
  const [relatedF1Ids, setRelatedF1Ids] = useState([]);
  const eventTypes = (meta.types || []).filter((t) => !meta.primary_types || meta.primary_types.includes(t.k) || t.k === form.event_type);

  useEffect(() => {
    if (!event?.id) {
      setRelatedTournamentIds([]);
      setRelatedF1Ids([]);
      return;
    }
    setRelatedTournamentIds(tournaments.filter((t) => t.event_id === event.id).map((t) => t.id));
    setRelatedF1Ids(f1Challenges.filter((c) => c.event_id === event.id).map((c) => c.id));
  }, [event?.id, tournaments, f1Challenges]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const insertProgramEmbed = (kind, item) => {
    setForm((f) => ({ ...f, program: appendEmbedToken(f.program, kind, item) }));
    if (kind === "tournament" && !relatedTournamentIds.includes(item.id)) setRelatedTournamentIds((ids) => [...ids, item.id]);
    if (kind === "fastlap" && !relatedF1Ids.includes(item.id)) setRelatedF1Ids((ids) => [...ids, item.id]);
  };

  const syncRelatedItems = async (eventId) => {
    const jobs = [];
    tournaments.forEach((t) => {
      const selected = relatedTournamentIds.includes(t.id);
      if (selected && t.event_id !== eventId) jobs.push(api.patch(`/tournaments/${t.id}`, { event_id: eventId }));
      if (!selected && t.event_id === eventId) jobs.push(api.patch(`/tournaments/${t.id}`, { event_id: null }));
    });
    f1Challenges.forEach((c) => {
      const selected = relatedF1Ids.includes(c.id);
      if (selected && c.event_id !== eventId) jobs.push(api.patch(`/f1/challenges/${c.id}`, { event_id: eventId }));
      if (!selected && c.event_id === eventId) jobs.push(api.patch(`/f1/challenges/${c.id}`, { event_id: null }));
    });
    if (jobs.length) await Promise.all(jobs);
  };

  const submit = async (ev) => {
    ev.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      Object.keys(payload).forEach((k) => { if (payload[k] === "") payload[k] = null; });
      if (payload.max_participants) payload.max_participants = parseInt(payload.max_participants);
      payload.sponsor_ids = payload.owned_by_club && payload.show_sponsors ? (payload.sponsor_ids || []) : [];
      let savedEvent;
      if (isNew) {
        const { data } = await api.post("/events", payload);
        savedEvent = data;
      } else {
        const { data } = await api.patch(`/events/${event.id}`, payload);
        savedEvent = data;
      }
      await syncRelatedItems(savedEvent.id);
      toast.success("Gespeichert.");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(formatRequestError(err, "Event konnte nicht gespeichert werden.", { slug: form.slug, name: form.name }));
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
          <Field label="Slug"><Input value={form.slug} onChange={(v) => set("slug", slugFrom(v))} testId="event-slug" required /></Field>
          <Field label="Beschreibung">
            <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Typ">
              <select value={form.event_type} onChange={(e) => set("event_type", e.target.value)} data-testid="event-type" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
                {eventTypes.map((t) => <option key={t.k} value={t.k}>{t.l}</option>)}
              </select>
            </Field>
            <Field label="Sichtbarkeit">
              <select value={form.visibility} onChange={(e) => set("visibility", e.target.value)} data-testid="event-visibility" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
                {meta.visibilities.map((v) => <option key={v.k} value={v.k}>{v.l}</option>)}
              </select>
            </Field>
            <Field label={isNew ? "Veröffentlichung" : "Status"}>
              {isNew ? (
                <select value={form.status} onChange={(e) => set("status", e.target.value)} data-testid="event-status" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
                  {CREATE_STATUS_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              ) : (
                <select value={form.status} onChange={(e) => set("status", e.target.value)} data-testid="event-status" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
                  {meta.statuses.map((s) => <option key={s.k} value={s.k}>{s.l}</option>)}
                </select>
              )}
            </Field>
          </div>
          <div className="border border-[#29B6E8]/20 bg-[#29B6E8]/5 rounded-sm p-3 text-xs text-white/55">
            Für neue Inhalte reicht normalerweise <span className="text-white font-semibold">Entwurf</span> oder <span className="text-white font-semibold">Angekündigt</span>. Anmeldung, Live und Beendet werden über die Datumsfelder automatisch berechnet.
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start"><input type="datetime-local" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} data-testid="event-start" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" /></Field>
            <Field label="Ende"><input type="datetime-local" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" /></Field>
            <Field label="Einlass / Türöffnung"><input type="datetime-local" value={form.door_time} onChange={(e) => set("door_time", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" /></Field>
            <Field label="Max. Teilnehmer"><input type="number" value={form.max_participants} onChange={(e) => set("max_participants", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" /></Field>
            <Field label="Ort / Location"><Input value={form.location} onChange={(v) => set("location", v)} placeholder="Innsbruck" /></Field>
            <Field label="Adresse"><Input value={form.address} onChange={(v) => set("address", v)} placeholder="Maria-Theresien-Str. 1" /></Field>
            <Field label="PLZ"><Input value={form.postal_code} onChange={(v) => set("postal_code", v)} placeholder="6020" /></Field>
            <Field label="Stadt"><Input value={form.city} onChange={(v) => set("city", v)} placeholder="Innsbruck" /></Field>
            <Field label="Land"><Input value={form.country} onChange={(v) => set("country", v)} placeholder="Österreich" /></Field>
            <Field label="Veranstalter"><Input value={form.organizer_name} onChange={(v) => set("organizer_name", v)} placeholder="THE LION SQUAD oder extern" /></Field>
            <Field label="Veranstalter-Link"><Input value={form.organizer_url} onChange={(v) => set("organizer_url", v)} placeholder="https://…" /></Field>
            <Field label="Banner-Bild"><ImageUpload value={form.banner_url} onChange={(v) => set("banner_url", v)} testId="event-banner" variant="wide" allowLibrary /></Field>
            <Field label="Kontakt"><Input value={form.contact} onChange={(v) => set("contact", v)} placeholder="Name oder E-Mail" /></Field>
          </div>
          <div className="border border-white/10 p-3 rounded-sm bg-[#0A0A0A] space-y-3">
            <div className="text-[11px] uppercase tracking-widest font-bold text-white/60">Anmeldung</div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.has_registration} onChange={(e) => set("has_registration", e.target.checked)} className="accent-[#9F7AEA]" />
              Registrierung/Anmeldung für dieses Event anzeigen
            </label>
            {form.has_registration && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Anmeldung öffnet"><input type="datetime-local" value={form.registration_opens_at} onChange={(e) => set("registration_opens_at", e.target.value)} className="w-full bg-[#121212] border border-white/10 px-3 py-2 rounded-sm" /></Field>
                <Field label="Anmeldung schließt"><input type="datetime-local" value={form.registration_closes_at} onChange={(e) => set("registration_closes_at", e.target.value)} className="w-full bg-[#121212] border border-white/10 px-3 py-2 rounded-sm" /></Field>
                <Field label="Externer Anmeldelink"><Input value={form.registration_url} onChange={(v) => set("registration_url", v)} placeholder="https://…" /></Field>
              </div>
            )}
          </div>
          <Field label="Programm / Tagesablauf">
            <textarea value={form.program} onChange={(e) => set("program", e.target.value)} rows={4} placeholder="17:00 Einlass&#10;18:00 LAN-Setup&#10;19:30 Eröffnungsturnier" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm font-mono text-sm" />
            <div className="mt-1 text-[11px] text-white/40">Turniere/Fast-Laps können hier als Karten eingefügt werden.</div>
          </Field>
          {(tournaments.length > 0 || f1Challenges.length > 0) && (
            <div className="border border-white/10 p-3 rounded-sm bg-[#0A0A0A] space-y-3">
              <div>
                <div className="text-[11px] uppercase tracking-widest font-bold text-white/60">Verknüpfte eSports-Inhalte</div>
                <p className="mt-1 text-xs text-white/45">Diese Zuordnung erscheint direkt auf der Eventseite.</p>
              </div>
              {tournaments.length > 0 && (
                <RelationSelect
                  icon={Trophy}
                  label="Turniere"
                  options={tournaments}
                  selected={relatedTournamentIds}
                  onChange={setRelatedTournamentIds}
                  labelKey="title"
                  accent="text-[#FFD700]"
                  onEmbed={(item) => insertProgramEmbed("tournament", item)}
                />
              )}
              {f1Challenges.length > 0 && (
                <RelationSelect
                  icon={Flag}
                  label="Fast-Lap Challenges"
                  options={f1Challenges}
                  selected={relatedF1Ids}
                  onChange={setRelatedF1Ids}
                  labelKey="title"
                  accent="text-[#29B6E8]"
                  onEmbed={(item) => insertProgramEmbed("fastlap", item)}
                />
              )}
            </div>
          )}
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
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.show_map} onChange={(e) => set("show_map", e.target.checked)} className="accent-[#9F7AEA]" />
              Karte anzeigen
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.owned_by_club} onChange={(e) => set("owned_by_club", e.target.checked)} className="accent-[#9F7AEA]" />
              Event von uns
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.show_sponsors} onChange={(e) => set("show_sponsors", e.target.checked)} disabled={!form.owned_by_club} className="accent-[#9F7AEA]" />
              Sponsoren beim Event anzeigen
            </label>
          </div>
          {form.owned_by_club && form.show_sponsors && sponsors.length > 0 && (
            <div className="border border-white/10 p-3 rounded-sm bg-[#0A0A0A]">
              <div className="text-[11px] uppercase tracking-widest font-bold text-white/60 mb-3">Event-Sponsoren</div>
              <div className="grid sm:grid-cols-2 gap-2">
                {sponsors.filter((s) => s.is_active !== false).map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm text-white/75">
                    <input
                      type="checkbox"
                      checked={(form.sponsor_ids || []).includes(s.id)}
                      onChange={(ev) => set("sponsor_ids", ev.target.checked ? [...(form.sponsor_ids || []), s.id] : (form.sponsor_ids || []).filter((id) => id !== s.id))}
                      className="accent-[#FFD700]"
                    />
                    {s.name}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-white/40">Leer lassen, um automatisch Sponsoren mit Event-Platzierung zu zeigen.</p>
            </div>
          )}
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

function RelationSelect({ icon: Icon, label, options, selected, onChange, labelKey, accent, onEmbed }) {
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest font-bold text-white/50 mb-2">{label}</div>
      <div className="grid sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1">
        {options.map((item) => (
          <div key={item.id} className="flex items-center gap-2 text-sm text-white/75 border border-white/5 hover:border-white/15 rounded-sm px-2 py-2">
            <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
              <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} className="accent-[#9F7AEA]" />
              <Icon className={`w-3.5 h-3.5 ${accent} shrink-0`} />
              <span className="truncate">{item[labelKey] || item.name}</span>
            </label>
            {onEmbed && (
              <button type="button" onClick={() => onEmbed(item)} className="shrink-0 text-[10px] uppercase tracking-wider font-bold text-[#29B6E8] hover:text-white">
                Ins Programm
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
