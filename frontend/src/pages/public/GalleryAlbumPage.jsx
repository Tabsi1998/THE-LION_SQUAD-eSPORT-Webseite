import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useCanonicalSlugRedirect } from "@/hooks/useCanonicalSlugRedirect";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { ArrowLeft, X, ChevronLeft, ChevronRight, Calendar } from "lucide-react";

export default function GalleryAlbumPage() {
  const { slug } = useParams();
  const [a, setA] = useState(null);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null); // index of active photo
  useDocumentTitle(a?.title || "Galerie", a?.description || "Fotos und Eindrücke von THE LION SQUAD.", {
    image: a?.cover_url || a?.photos?.[0]?.thumbnail_url || a?.photos?.[0]?.image_url,
    canonical: a?.slug ? `${window.location.origin}/galerie/${a.slug}` : undefined,
  });
  useCanonicalSlugRedirect(slug, a?.slug, "/galerie");

  const load = useCallback(() => {
    api.get(`/gallery/${slug}`).then(({ data }) => {
      setA(data);
      setError(null);
    }).catch((e) => {
      setError(e.response?.status === 403 ? "Album nicht öffentlich zugänglich." : "Album nicht gefunden.");
    });
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  useApiInvalidation(load, ["gallery"]);

  if (error) return (
    <PublicLayout>
      <div className="max-w-2xl mx-auto px-6 py-20 text-center">
        <h1 className="font-heading text-3xl font-black">{error}</h1>
        <Link to="/gallery" className="mt-6 inline-flex items-center gap-2 text-[#29B6E8]"><ArrowLeft className="w-4 h-4" /> Zurück</Link>
      </div>
    </PublicLayout>
  );
  if (!a) return <PublicLayout><div className="p-20 text-center text-white/40">LADE …</div></PublicLayout>;

  const photos = a.photos || [];

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link to="/gallery" data-testid="album-back" className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-white/50 hover:text-[#29B6E8]">
          <ArrowLeft className="w-3.5 h-3.5" /> Alle Alben
        </Link>
        <h1 className="mt-6 font-heading text-3xl md:text-5xl font-black uppercase">{a.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-white/60">
          {a.taken_at && <span className="inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> {new Date(a.taken_at).toLocaleDateString("de-DE", { dateStyle: "long" })}</span>}
          {a.event && <Link to={`/events/${a.event.slug}`} className="text-[#9F7AEA] hover:underline">→ {a.event.name}</Link>}
        </div>
        {a.description && <p className="mt-3 text-white/70 max-w-2xl">{a.description}</p>}

        {photos.length === 0 ? (
          <div className="mt-10 border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">Noch keine Fotos.</div>
        ) : (
          <div className="mt-10 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {photos.map((p, i) => (
              <button
                key={p.id}
                onClick={() => setActive(i)}
                data-testid={`gallery-photo-${i}`}
                className="aspect-square overflow-hidden bg-[#0A0A0A] border border-white/5 hover:border-[#29B6E8]/40 transition group"
              >
                <img
                  src={resolveMediaUrl(p.thumbnail_url || p.image_url)}
                  alt={p.caption || ""}
                  className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        )}
      </section>

      {active !== null && photos[active] && (
        <Lightbox photo={photos[active]} onClose={() => setActive(null)}
          onPrev={() => setActive((i) => (i - 1 + photos.length) % photos.length)}
          onNext={() => setActive((i) => (i + 1) % photos.length)}
        />
      )}
    </PublicLayout>
  );
}

function Lightbox({ photo, onClose, onPrev, onNext }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center" onClick={onClose}>
      <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="absolute top-4 right-4 p-2 text-white/70 hover:text-white" aria-label="Schließen"><X className="w-6 h-6" /></button>
      <button onClick={(e) => { e.stopPropagation(); onPrev(); }} className="absolute left-4 p-3 text-white/70 hover:text-white" aria-label="Vorheriges"><ChevronLeft className="w-6 h-6" /></button>
      <img src={resolveMediaUrl(photo.image_url)} alt={photo.caption || ""} loading="lazy" decoding="async" className="max-w-[90vw] max-h-[85vh] object-contain" onClick={(e) => e.stopPropagation()} />
      <button onClick={(e) => { e.stopPropagation(); onNext(); }} className="absolute right-4 p-3 text-white/70 hover:text-white" aria-label="Nächstes"><ChevronRight className="w-6 h-6" /></button>
      {photo.caption && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 max-w-[80vw] text-center text-sm text-white/85 bg-black/60 px-4 py-2 rounded-sm">
          {photo.caption}
        </div>
      )}
    </div>
  );
}
