import { useCallback, useEffect, useState } from "react";
import { api, formatApiError, resolveMediaUrl } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Plus, Trash2, Image as ImageIcon } from "lucide-react";
import { AlbumModal } from "./gallery/AlbumModal";
import { AlbumPhotos } from "./gallery/AlbumPhotos";
import { albumMediaCount } from "./gallery/shared";

export default function AdminGalleryPage() {
  const [albums, setAlbums] = useState([]);
  const [activeAlbum, setActiveAlbum] = useState(null);
  const [editingAlbum, setEditingAlbum] = useState(null);
  const [events, setEvents] = useState([]);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const { data } = await api.get("/admin/gallery");
    setAlbums(data);
  }, []);

  useEffect(() => {
    load();
    api.get("/events?include_drafts=true").then(({ data }) => setEvents(data)).catch(() => {});
  }, [load]);
  useApiInvalidation(load, ["gallery"]);

  const remove = async (id) => {
    if (!await confirm({
      title: "Album löschen?",
      description: "Das Album und alle zugeordneten Medien werden entfernt.",
      confirmLabel: "Löschen",
    })) return;
    const previous = albums;
    setAlbums((rows) => rows.filter((a) => a.id !== id));
    if (activeAlbum?.id === id) setActiveAlbum(null);
    if (editingAlbum?.id === id) setEditingAlbum(null);
    try {
      await api.delete(`/gallery/${id}`);
      toast.success("Gelöscht.");
      load();
    } catch (err) {
      setAlbums(previous);
      toast.error(formatApiError(err.response?.data?.detail));
      load();
    }
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
                  <span className="text-[10px] uppercase tracking-widest text-white/40">{albumMediaCount(a)} Medien</span>
                </div>
                <div className="text-[10px] uppercase tracking-widest text-[#29B6E8]/80 mt-1">
                  {a.visibility} · {a.published ? "live" : "entwurf"}{a.section_count ? ` · ${a.section_count} Abschnitte` : ""}{a.video_count ? ` · ${a.video_count} Videos` : ""}
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setActiveAlbum(a)} data-testid={`album-open-${a.id}`} className="flex-1 text-xs font-bold uppercase px-3 py-1 rounded-sm border border-[#29B6E8]/40 text-[#29B6E8] hover:bg-[#29B6E8]/10">Medien</button>
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
