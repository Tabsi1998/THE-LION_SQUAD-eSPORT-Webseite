import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Image as ImageIcon, Crown } from "lucide-react";

export default function GalleryPage() {
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/gallery").then(({ data }) => setAlbums(data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">RUDEL-IMPRESSIONEN</span>
        <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase">Galerie</h1>
        <p className="mt-3 text-white/60 max-w-2xl">
          Eindrücke aus Turnieren, LAN-Partys, Events und allem dazwischen.
        </p>

        {loading ? (
          <div className="mt-10 text-white/40 text-sm">Lade …</div>
        ) : albums.length === 0 ? (
          <div className="mt-10 border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
            <ImageIcon className="w-10 h-10 mx-auto opacity-40 mb-3" />
            <div className="font-heading font-bold text-lg">Noch keine Alben</div>
            <div className="text-sm mt-1">Fotos von Events und Turnieren erscheinen hier.</div>
          </div>
        ) : (
          <div className="mt-10 grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {albums.map((a) => <AlbumCard key={a.id} a={a} />)}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}

function AlbumCard({ a }) {
  return (
    <Link
      to={`/gallery/${a.slug}`}
      data-testid={`album-card-${a.slug}`}
      className="group border border-white/10 hover:border-[#29B6E8]/50 rounded-sm bg-[#121212] overflow-hidden block transition"
    >
      <div className="aspect-video bg-[#0A0A0A] overflow-hidden relative">
        {a.cover_url ? (
          <img src={a.cover_url} alt={a.title} className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-10 h-10 text-white/15" /></div>
        )}
        {a.visibility === "members" && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-[#FFD700] bg-black/60 px-2 py-1 rounded-sm">
            <Crown className="w-3 h-3" /> Mitglieder
          </span>
        )}
        <span className="absolute bottom-2 right-2 text-[10px] uppercase tracking-widest font-bold text-white bg-black/60 px-2 py-1 rounded-sm">
          {a.photo_count || 0} Fotos
        </span>
      </div>
      <div className="p-4">
        <div className="font-heading font-black uppercase group-hover:text-[#29B6E8] transition">{a.title}</div>
        {a.taken_at && <div className="text-xs text-white/45 mt-1">{new Date(a.taken_at).toLocaleDateString("de-DE")}</div>}
        {a.description && <div className="text-xs text-white/55 mt-2 line-clamp-2">{a.description}</div>}
      </div>
    </Link>
  );
}
