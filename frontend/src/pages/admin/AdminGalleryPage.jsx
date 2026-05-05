import { useEffect, useState } from "react";
import { api, resolveMediaUrl } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { toast } from "sonner";
import { Plus, Save, X, Trash2, Image as ImageIcon, ArrowLeft } from "lucide-react";

export default function AdminGalleryPage() {
  const [albums, setAlbums] = useState([]);
  const [activeAlbum, setActiveAlbum] = useState(null);
  const [editingAlbum, setEditingAlbum] = useState(null);
  const [events, setEvents] = useState([]);

  const load = async () => {
    const { data } = await api.get("/admin/gallery");
    setAlbums(data);
  };
  useEffect(() => {
    load();
    api.get("/events").then(({ data }) => setEvents(data)).catch(() => {});
  }, []);

  const remove = async (id) => {
    if (!window.confirm("Album mit allen Fotos löschen?")) return;
    try { await api.delete(`/gallery/${id}`); toast.success("Gelöscht."); load(); } catch { toast.error("Fehler."); }
  };

  if (activeAlbum) {
    return <AlbumPhotos album={activeAlbum} events={events} onBack={() => { setActiveAlbum(null); load(); }} />;
  }

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">VEREINS-CMS</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Galerie</h1>
        </div>
        <button onClick={() => setEditingAlbum({})} data-testid="album-new" className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider text-xs rounded-sm hover:bg-[#1E95C2] transition">
          <Plus className="w-3.5 h-3.5" /> Neues Album
        </button>
      </div>

      {albums.length === 0 ? (
        <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
          <ImageIcon className="w-10 h-10 mx-auto opacity-40 mb-3" />
          <div className="font-heading font-bold">Noch keine Alben</div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {albums.map((a) => (
            <div key={a.id} className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
              <div className="aspect-video bg-[#0A0A0A]">
                {a.cover_url ? <img src={resolveMediaUrl(a.cover_url)} alt={a.title} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-10 h-10 text-white/15" /></div>}
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-heading font-black uppercase truncate">{a.title}</div>
                  <span className="text-[10px] uppercase tracking-widest text-white/40">{a.photo_count} Fotos</span>
                </div>
                <div className="text-[10px] uppercase tracking-widest text-[#29B6E8]/80 mt-1">{a.visibility} · {a.published ? "live" : "entwurf"}</div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setActiveAlbum(a)} data-testid={`album-open-${a.id}`} className="flex-1 text-xs font-bold uppercase px-3 py-1 rounded-sm border border-[#29B6E8]/40 text-[#29B6E8] hover:bg-[#29B6E8]/10">Fotos</button>
                  <button onClick={() => setEditingAlbum(a)} className="text-xs font-bold uppercase px-3 py-1 rounded-sm border border-white/15 text-white/70 hover:text-white">Bearb.</button>
                  <button onClick={() => remove(a.id)} className="text-xs font-bold uppercase px-3 py-1 rounded-sm border border-[#FF3B30]/40 text-[#FF3B30] hover:bg-[#FF3B30]/10"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingAlbum && <AlbumModal album={editingAlbum} events={events} onClose={() => setEditingAlbum(null)} onSaved={load} />}
    </AdminLayout>
  );
}

function AlbumModal({ album, events, onClose, onSaved }) {
  const isNew = !album?.id;
  const slugFrom = (txt) => (txt || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  const [form, setForm] = useState({
    title: album.title || "",
    slug: album.slug || "",
    description: album.description || "",
    cover_url: album.cover_url || "",
    event_id: album.event_id || "",
    visibility: album.visibility || "public",
    taken_at: album.taken_at?.slice(0, 10) || "",
    published: album.published ?? true,
    order_index: album.order_index ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      Object.keys(payload).forEach((k) => { if (payload[k] === "") payload[k] = null; });
      if (payload.taken_at) payload.taken_at = `${payload.taken_at}T00:00:00`;
      payload.order_index = parseInt(form.order_index) || 0;
      if (payload.slug) payload.slug = slugFrom(payload.slug);
      if (isNew) await api.post("/gallery", payload);
      else await api.patch(`/gallery/${album.id}`, payload);
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
      <form onSubmit={submit} className="w-full max-w-xl bg-[#121212] border border-white/10 rounded-sm">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="font-heading font-black uppercase">{isNew ? "Neues Album" : "Album bearbeiten"}</h2>
          <button type="button" onClick={onClose} className="text-white/60 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <Field label="Titel"><Input value={form.title} onChange={(v) => { set("title", v); if (isNew && !form.slug) set("slug", slugFrom(v)); }} testId="album-title" required /></Field>
          <Field label="Slug"><Input value={form.slug} onChange={(v) => set("slug", v)} testId="album-slug" required /></Field>
          <Field label="Beschreibung"><textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" /></Field>
          <Field label="Cover-Bild"><ImageUpload value={form.cover_url} onChange={(v) => set("cover_url", v)} testId="album-cover" variant="wide" allowLibrary /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Verknüpftes Event">
              <select value={form.event_id || ""} onChange={(e) => set("event_id", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
                <option value="">— keines —</option>
                {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </Field>
            <Field label="Aufgenommen am"><input type="date" value={form.taken_at} onChange={(e) => set("taken_at", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" /></Field>
            <Field label="Sichtbarkeit">
              <select value={form.visibility} onChange={(e) => set("visibility", e.target.value)} data-testid="album-visibility" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
                <option value="public">Öffentlich</option>
                <option value="community">Community</option>
                <option value="members">Nur Mitglieder</option>
              </select>
            </Field>
            <Field label="Sortierung"><Input value={form.order_index} onChange={(v) => set("order_index", v)} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.published} onChange={(e) => set("published", e.target.checked)} className="accent-[#29B6E8]" /> Veröffentlicht
          </label>
        </div>
        <div className="flex gap-3 p-5 border-t border-white/10">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-white/10 text-white/60 hover:text-white text-xs uppercase tracking-wider font-bold rounded-sm">Abbrechen</button>
          <button type="submit" disabled={saving} data-testid="album-save" className="ml-auto inline-flex items-center gap-2 px-5 py-2 bg-[#29B6E8] text-black text-xs uppercase tracking-wider font-bold rounded-sm hover:bg-[#1E95C2] disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> {saving ? "Speichere…" : "Speichern"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AlbumPhotos({ album, events, onBack }) {
  const [photos, setPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    const { data } = await api.get(`/admin/gallery/${album.id}`);
    setPhotos(data.photos || []);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [album.id]);

  const onPick = async (files) => {
    if (!files || !files.length) return;
    setUploading(true);
    let ok = 0, fail = 0;
    for (const file of Array.from(files)) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const { data } = await api.post("/uploads/image", fd, { headers: { "Content-Type": "multipart/form-data" } });
        await api.post(`/gallery/${album.id}/photos`, {
          image_url: data.url,
          thumbnail_url: data.url,
          caption: file.name.replace(/\.[^/.]+$/, ""),
          order_index: photos.length + ok + 1,
        });
        ok++;
      } catch { fail++; }
    }
    setUploading(false);
    toast.success(`${ok} Foto(s) hinzugefügt${fail ? `, ${fail} fehlgeschlagen` : ""}.`);
    load();
  };
  const remove = async (id) => {
    if (!window.confirm("Foto löschen?")) return;
    try { await api.delete(`/gallery/photos/${id}`); load(); } catch { toast.error("Fehler."); }
  };

  return (
    <AdminLayout>
      <button onClick={onBack} className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-white/50 hover:text-[#29B6E8] mb-4">
        <ArrowLeft className="w-3.5 h-3.5" /> Alben
      </button>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="font-heading text-3xl font-black uppercase">{album.title}</h1>
          <div className="text-xs text-white/50">{photos.length} Fotos · /{album.slug}</div>
        </div>
        <label className={`inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider text-xs rounded-sm cursor-pointer ${uploading ? "opacity-50" : ""}`} data-testid="photo-bulk-upload">
          <Plus className="w-3.5 h-3.5" /> {uploading ? "Lade hoch…" : "Fotos hochladen"}
          <input type="file" accept="image/*" multiple disabled={uploading} className="hidden" onChange={(e) => onPick(e.target.files)} />
        </label>
      </div>

      {photos.length === 0 ? (
        <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">Noch keine Fotos. Lade welche hoch — du kannst auch mehrere auf einmal auswählen.</div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
          {photos.map((p) => (
            <div key={p.id} className="relative group aspect-square bg-[#0A0A0A] border border-white/10">
              <img src={resolveMediaUrl(p.thumbnail_url || p.image_url)} alt={p.caption || ""} className="w-full h-full object-cover" />
              <button onClick={() => remove(p.id)} className="absolute top-1 right-1 p-1 bg-black/70 text-[#FF3B30] opacity-0 group-hover:opacity-100 transition" aria-label="Löschen"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}
    </AdminLayout>
  );
}

function Field({ label, children }) {
  return <label className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>{children}</label>;
}
function Input({ value, onChange, placeholder, testId, required }) {
  return <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-testid={testId} required={required} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />;
}
