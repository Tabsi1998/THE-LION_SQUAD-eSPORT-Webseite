import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { PublicLoadingState } from "@/components/tls/PublicLoadingState";
import { ExternalMediaNotice } from "@/components/tls/ExternalMediaNotice";
import { useCookieConsent } from "@/components/tls/CookieConsent";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useCanonicalSlugRedirect } from "@/hooks/useCanonicalSlugRedirect";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { seoTextPreview } from "@/lib/textPreview";
import {
  galleryEmbedSrc,
  galleryMediaUrl,
  galleryPosterUrl,
  isExternalGalleryMedia,
  isVideoLike,
  mediaTypeFromItem,
  providerLabel,
} from "@/lib/galleryMedia";
import { ArrowLeft, X, ChevronLeft, ChevronRight, Calendar, Play, Film, ExternalLink, Layers, Download } from "lucide-react";

const PINBOARD_TILE_CLASSES = [
  "col-span-1 row-span-1",
  "col-span-1 row-span-2",
  "col-span-2 row-span-1",
  "col-span-1 row-span-1",
  "col-span-2 row-span-2",
  "col-span-1 row-span-1",
  "col-span-1 row-span-2",
  "col-span-2 row-span-1",
  "col-span-1 row-span-1",
  "col-span-1 sm:col-span-2 row-span-2",
  "col-span-1 row-span-1",
  "col-span-2 row-span-1",
];

function dimensionKey(item) {
  return item?.id || galleryMediaUrl(item) || item?.image_url || "";
}

function itemRatio(item, dimensions) {
  const known = dimensions?.[dimensionKey(item)];
  const width = Number(item?.width || known?.width || 0);
  const height = Number(item?.height || known?.height || 0);
  return width > 0 && height > 0 ? width / height : 0;
}

function pinboardTileClass(item, index, dimensions = {}) {
  const ratio = itemRatio(item, dimensions);
  if (ratio > 2.2) return "col-span-2 sm:col-span-3 row-span-1";
  if (ratio > 1.25) return index % 4 === 0 ? "col-span-2 row-span-2" : "col-span-2 row-span-1";
  if (ratio > 0 && ratio < 0.55) return "col-span-1 row-span-3";
  if (ratio > 0 && ratio < 0.82) return index % 5 === 0 ? "col-span-2 row-span-3" : "col-span-1 row-span-2";
  if (index === 0) return "col-span-2 row-span-2";
  if (isVideoLike(item) && index % 3 === 0) return "col-span-2 row-span-2";
  return PINBOARD_TILE_CLASSES[index % PINBOARD_TILE_CLASSES.length];
}

function sortSections(sections) {
  return [...(sections || [])].sort((a, b) => (a.order_index || 0) - (b.order_index || 0) || String(a.title || "").localeCompare(String(b.title || "")));
}

function sectionAnchor(section) {
  return `abschnitt-${section?.slug || section?.id || "ohne"}`;
}

function buildSectionGroups(items, sections) {
  const orderedSections = sortSections(sections);
  if (!orderedSections.length) {
    return [{ id: "__all", title: "", description: "", items: items.map((item, index) => ({ item, index })), section: null }];
  }
  const groups = orderedSections
    .map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description || "",
      section,
      items: items.map((item, index) => ({ item, index })).filter(({ item }) => item.section_id === section.id),
    }))
    .filter((group) => group.items.length > 0);
  const unsectioned = items.map((item, index) => ({ item, index }))
    .filter(({ item }) => !orderedSections.some((section) => section.id === item.section_id));
  if (unsectioned.length) {
    groups.push({ id: "__none", title: "Weitere Medien", description: "", items: unsectioned, section: null });
  }
  return groups.length ? groups : [{ id: "__all", title: "", description: "", items: items.map((item, index) => ({ item, index })), section: null }];
}

export default function GalleryAlbumPage() {
  const { slug } = useParams();
  const [a, setA] = useState(null);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null);
  const [dimensions, setDimensions] = useState({});
  const items = a?.photos || [];
  const sectionGroups = buildSectionGroups(items, a?.sections || []);
  const hasSections = sectionGroups.some((group) => group.section);
  const firstPreview = items.find((item) => galleryPosterUrl(item) || item.image_url);
  const seoDescription = seoTextPreview(a?.description, "Fotos, Videos und Eindrücke von THE LION SQUAD eSports: Turniere, LAN-Partys, Events und Gaming Community.");
  useDocumentTitle(a?.title || "Galerie", seoDescription, {
    image: a?.cover_url || galleryPosterUrl(firstPreview) || firstPreview?.image_url,
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

  useEffect(() => {
    if (active === null) return undefined;
    const handler = (event) => {
      if (event.key === "Escape") setActive(null);
      if (event.key === "ArrowLeft") setActive((i) => (i - 1 + items.length) % items.length);
      if (event.key === "ArrowRight") setActive((i) => (i + 1) % items.length);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, items.length]);

  useApiInvalidation(load, ["gallery"]);

  const rememberDimensions = useCallback((item, width, height) => {
    if (!item || !width || !height) return;
    const key = dimensionKey(item);
    if (!key) return;
    setDimensions((current) => {
      const known = current[key];
      if (known?.width === width && known?.height === height) return current;
      return { ...current, [key]: { width, height } };
    });
  }, []);

  if (error) return (
    <PublicLayout>
      <div className="max-w-2xl mx-auto px-6 py-20 text-center">
        <h1 className="font-heading text-3xl font-black">{error}</h1>
        <Link to="/galerie" className="mt-6 inline-flex items-center gap-2 text-[#29B6E8]"><ArrowLeft className="w-4 h-4" /> Zurück</Link>
      </div>
    </PublicLayout>
  );
  if (!a) return <PublicLayout><PublicLoadingState label="Lade Album" /></PublicLayout>;

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Breadcrumbs
          items={[
            { label: "Home", to: "/" },
            { label: "Galerie", to: "/galerie" },
            { label: a.title },
          ]}
          className="mb-3"
        />
        <Link to="/galerie" data-testid="album-back" className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-white/50 hover:text-[#29B6E8]">
          <ArrowLeft className="w-3.5 h-3.5" /> Alle Alben
        </Link>
        <h1 className="mt-6 font-heading text-3xl md:text-5xl font-black uppercase">{a.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-white/60">
          {a.taken_at && <span className="inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> {new Date(a.taken_at).toLocaleDateString("de-DE", { dateStyle: "long" })}</span>}
          {a.event && <Link to={`/events/${a.event.slug}`} className="text-[#9F7AEA] hover:underline">→ {a.event.name}</Link>}
          <span>{items.length} Medien</span>
          {hasSections && <span className="inline-flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" /> {sectionGroups.filter((group) => group.section).length} Abschnitte</span>}
        </div>
        {a.description && <p className="mt-3 text-white/70 max-w-2xl">{a.description}</p>}
        {hasSections && (
          <div className="mt-6 flex flex-wrap gap-2">
            {sectionGroups.map((group) => (
              <a key={group.id} href={`#${sectionAnchor(group.section || { id: group.id })}`} className="inline-flex items-center gap-2 rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/70 hover:border-[#29B6E8]/50 hover:text-white">
                {group.title || "Medien"} <span className="text-white/35">{group.items.length}</span>
              </a>
            ))}
          </div>
        )}

        {items.length === 0 ? (
          <div className="mt-10 border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">Noch keine Medien.</div>
        ) : (
          <div className="mt-10 space-y-14">
            {sectionGroups.map((group) => (
              <div key={group.id} id={sectionAnchor(group.section || { id: group.id })} className="scroll-mt-24" style={{ contentVisibility: "auto", containIntrinsicSize: "900px" }}>
                {hasSections && (
                  <div className="mb-4 flex items-end justify-between gap-3 border-b border-white/10 pb-3">
                    <div>
                      <h2 className="font-heading text-2xl md:text-3xl font-black uppercase">{group.title}</h2>
                      {group.description && <p className="mt-1 text-sm text-white/55 max-w-2xl">{group.description}</p>}
                    </div>
                    <span className="text-[10px] uppercase tracking-widest text-white/40">{group.items.length} Medien</span>
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-6 auto-rows-[7.5rem] sm:auto-rows-[8.5rem] lg:auto-rows-[9.5rem] grid-flow-dense gap-3">
                  {group.items.map(({ item, index }, localIndex) => (
                    <button
                      key={item.id}
                      onClick={() => setActive(index)}
                      data-testid={`gallery-photo-${index}`}
                      className={`${pinboardTileClass(item, hasSections ? localIndex : index, dimensions)} min-h-0 overflow-hidden bg-[#0A0A0A] border border-white/5 hover:border-[#29B6E8]/45 transition group relative rounded-sm shadow-sm shadow-black/30 hover:-translate-y-0.5`}
                      aria-label={isVideoLike(item) ? "Video öffnen" : "Bild öffnen"}
                    >
                      <GalleryTile item={item} onDimensions={rememberDimensions} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {active !== null && items[active] && (
        <Lightbox item={items[active]} onClose={() => setActive(null)}
          onPrev={() => setActive((i) => (i - 1 + items.length) % items.length)}
          onNext={() => setActive((i) => (i + 1) % items.length)}
        />
      )}
    </PublicLayout>
  );
}

function GalleryTile({ item, onDimensions }) {
  const type = mediaTypeFromItem(item);
  const poster = galleryPosterUrl(item);
  const url = galleryMediaUrl(item);
  if (type === "image") {
    return (
      <img
        src={resolveMediaUrl(poster || url)}
        alt={item.caption || ""}
        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
        loading="lazy"
        decoding="async"
        onLoad={(event) => onDimensions?.(item, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
      />
    );
  }
  return (
    <>
      {type === "video" && url && !isExternalGalleryMedia(item) ? (
        <CenterPreviewVideo src={resolveMediaUrl(url)} poster={poster ? resolveMediaUrl(poster) : ""} onDimensions={(width, height) => onDimensions?.(item, width, height)} />
      ) : poster ? (
        <img
          src={resolveMediaUrl(poster)}
          alt={item.caption || ""}
          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
          loading="lazy"
          decoding="async"
          onLoad={(event) => onDimensions?.(item, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-white/35">
          <Film className="w-9 h-9" />
          <span className="text-[10px] uppercase tracking-widest font-bold">Video</span>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent" />
      <span className="absolute left-2 bottom-2 inline-flex items-center gap-1 rounded-sm bg-black/70 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-white">
        <Play className="w-3 h-3 fill-current" /> {item.embed_provider ? providerLabel(item.embed_provider) : "Video"}
      </span>
    </>
  );
}

function CenterPreviewVideo({ src, poster, onDimensions }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        node.play().catch(() => {});
      } else {
        node.pause();
      }
    }, { rootMargin: "-35% 0px -35% 0px", threshold: 0.15 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <video
      ref={ref}
      src={src}
      poster={poster || undefined}
      muted
      loop
      playsInline
      preload="metadata"
      className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
      onLoadedMetadata={(event) => onDimensions?.(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
    />
  );
}

function Lightbox({ item, onClose, onPrev, onNext }) {
  const type = mediaTypeFromItem(item);
  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center" onClick={onClose}>
      <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="absolute top-4 right-4 p-2 text-white/70 hover:text-white z-10" aria-label="Schließen"><X className="w-6 h-6" /></button>
      <button onClick={(e) => { e.stopPropagation(); onPrev(); }} className="absolute left-4 p-3 text-white/70 hover:text-white z-10" aria-label="Vorheriges"><ChevronLeft className="w-6 h-6" /></button>
      <div className="max-w-[92vw] max-h-[86vh] w-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {type === "image" ? <LightboxImage item={item} /> : <LightboxVideo item={item} />}
      </div>
      <button onClick={(e) => { e.stopPropagation(); onNext(); }} className="absolute right-4 p-3 text-white/70 hover:text-white z-10" aria-label="Nächstes"><ChevronRight className="w-6 h-6" /></button>
      {item.caption && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 max-w-[80vw] text-center text-sm text-white/85 bg-black/60 px-4 py-2 rounded-sm">
          {item.caption}
        </div>
      )}
    </div>
  );
}

function LightboxImage({ item }) {
  return (
    <img
      src={resolveMediaUrl(item.image_url)}
      alt={item.caption || ""}
      loading="lazy"
      decoding="async"
      className="max-w-[90vw] max-h-[85vh] object-contain"
    />
  );
}

function LightboxVideo({ item }) {
  const { hasConsent } = useCookieConsent();
  const url = galleryMediaUrl(item);
  const embedSrc = mediaTypeFromItem(item) === "embed" ? galleryEmbedSrc(item) : "";
  const external = isExternalGalleryMedia(item);
  if (embedSrc) {
    if (!hasConsent("external_media")) {
      return (
        <div className="w-full max-w-4xl">
          <ExternalMediaNotice
            service={`${providerLabel(item.embed_provider)} Video`}
            reason="Der externe Videoplayer wird erst nach Zustimmung zu externen Medien geladen."
            url={url}
            accent="#9F7AEA"
            testId="gallery-video-consent"
          />
        </div>
      );
    }
    return (
      <div className="w-full max-w-5xl aspect-video bg-black border border-white/10">
        <iframe src={embedSrc} className="w-full h-full border-0" title={item.caption || "Galerie-Video"} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />
      </div>
    );
  }
  if (external && !hasConsent("external_media")) {
    return (
      <div className="w-full max-w-4xl">
        <ExternalMediaNotice
          service="Externes Video"
          reason="Das externe Video wird erst nach Zustimmung zu externen Medien geladen."
          url={url}
          accent="#9F7AEA"
          testId="gallery-direct-video-consent"
        />
      </div>
    );
  }
  if (mediaTypeFromItem(item) === "video" && url) {
    const src = resolveMediaUrl(url);
    return (
      <div className="flex max-h-[85vh] flex-col items-center gap-3">
        <video
          src={src}
          poster={galleryPosterUrl(item) ? resolveMediaUrl(galleryPosterUrl(item)) : undefined}
          controls
          autoPlay
          playsInline
          preload="metadata"
          className="max-w-[90vw] max-h-[78vh] bg-black"
        />
        <a href={src} download className="inline-flex items-center gap-2 rounded-sm border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white/75 hover:text-white">
          <Download className="w-3.5 h-3.5" /> Video herunterladen
        </a>
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-sm border border-white/15 px-5 py-3 text-white/80 hover:text-white">
      <ExternalLink className="w-4 h-4" /> Video öffnen
    </a>
  );
}
