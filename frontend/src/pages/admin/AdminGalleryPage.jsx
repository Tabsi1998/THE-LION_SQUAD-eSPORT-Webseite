import { useCallback, useEffect, useState } from "react";
import { api, formatApiError, resolveMediaUrl } from "@/lib/api";
import { toastLoadFailed } from "@/lib/loadProblem";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Plus, Trash2, Image as ImageIcon } from "lucide-react";
import { AlbumModal } from "./gallery/AlbumModal";
import { AlbumPhotos } from "./gallery/AlbumPhotos";
import { ALBUM_VISIBILITY, albumMediaCount } from "./gallery/shared";
import { SubmissionQueue } from "./gallery/SubmissionQueue";
import { useAuth } from "@/context/AuthContext";
import { hasArea } from "@/lib/permissions";
import { ShortCaps } from "@/components/tls/ShortCaps";

export default function AdminGalleryPage() {
  const { user } = useAuth();
  // Eingesandte Fotos (#1186) gibt auch die Vereinsverwaltung frei (der Vorstand); Alben pflegt nur die Redaktion.
  const editsAlbums = hasArea(user, "content");
  const [albums, setAlbums] = useState([]);
  const [activeAlbum, setActiveAlbum] = useState(null);
  const [editingAlbum, setEditingAlbum] = useState(null);
  const [events, setEvents] = useState([]);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    if (!editsAlbums) return;
    const { data } = await api.get("/admin/gallery");
    setAlbums(data);
  }, [editsAlbums]);

  useEffect(() => {
    load();
    if (editsAlbums) api.get("/events?include_drafts=true").then(({ data }) => setEvents(data)).catch(toastLoadFailed("Die Events für die Auswahl konnten nicht geladen werden."));
  }, [load, editsAlbums]);
  useApiInvalidation(load, ["gallery"]);

  const remove = async (id) => {
    if (!await confirm({
      title: "Album löschen?",
      description: "Das Album und seine Einträge werden entfernt. Die Dateien bleiben in den Medien. Nur eingesandte Fotos, die noch auf Freigabe warten, werden mit gelöscht.",
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
          <span className="tls-type-label text-[#29B6E8]">VEREINS-CMS</span>
          <h1 className="tls-type-title mt-1"><ShortCaps>Galerie</ShortCaps></h1>
        </div>
        {editsAlbums && <button onClick={() => setEditingAlbum({})} data-testid="album-new" className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black tls-type-label rounded-sm hover:bg-[#1E95C2] transition">
          <Plus className="w-3.5 h-3.5" /> Neues Album
        </button>}
      </div>

      <SubmissionQueue />

      {!editsAlbums ? null : albums.length === 0 ? (
        <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
          <ImageIcon className="w-10 h-10 mx-auto opacity-40 mb-3" />
          <div className="font-bold">Noch keine Alben</div>
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
                  <div className="font-black uppercase tls-wrap">{a.title}</div>
                  <span className="tls-type-label text-quiet">{albumMediaCount(a)} Medien</span>
                </div>
                {/* Leere Alben (#1224) sehen Besucher nicht - sie erscheinen von selbst, sobald Medien da sind. */}
                {albumMediaCount(a) === 0 && <div className="mt-1 tls-type-label text-quiet" data-testid={`admin-album-empty-${a.id}`}>leer – für Besucher unsichtbar</div>}
                <div className="tls-type-label text-[#29B6E8]/80 mt-1">
                  {ALBUM_VISIBILITY[a.visibility] || a.visibility} · {a.published ? "Veröffentlicht" : "Entwurf"}{a.section_count ? ` · ${a.section_count} Abschnitte` : ""}{a.video_count ? ` · ${a.video_count} Videos` : ""}
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setActiveAlbum(a)} data-testid={`album-open-${a.id}`} className="flex-1 tls-type-label px-3 py-1 rounded-sm border border-[#29B6E8]/40 text-[#29B6E8] hover:bg-[#29B6E8]/10">Medien</button>
                  <button onClick={() => setEditingAlbum(a)} className="tls-type-label px-3 py-1 rounded-sm border border-white/15 text-white/70 hover:text-white">Bearb.</button>
                  <button onClick={() => remove(a.id)} className="tls-type-label px-3 py-1 rounded-sm border border-live/40 text-live hover:bg-live/10"><Trash2 className="w-3 h-3" /></button>
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
