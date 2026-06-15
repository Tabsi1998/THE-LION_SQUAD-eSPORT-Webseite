import { useEffect, useMemo, useState } from "react";
import { ImageIcon, Link2, Search, Share2 } from "lucide-react";
import { api, resolveMediaUrl } from "@/lib/api";

function text(value, fallback = "") {
  const next = String(value || "").trim();
  return next || fallback;
}

function absoluteUrl(value) {
  const next = String(value || "").trim();
  if (!next) return "";
  try {
    return new URL(next, typeof window !== "undefined" ? window.location.origin : undefined).toString();
  } catch {
    return next;
  }
}

function hostLabel(value) {
  try {
    return new URL(value).host;
  } catch {
    return "lionsquad.at";
  }
}

export function SeoPreviewPanel({ path, fallback = {}, className = "" }) {
  const [remote, setRemote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState("local");

  useEffect(() => {
    const normalizedPath = String(path || "").trim();
    if (!normalizedPath) {
      setRemote(null);
      setSource("local");
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    api.get("/seo/meta", { params: { path: normalizedPath } })
      .then(({ data }) => {
        if (!active) return;
        setRemote(data || null);
        setSource("live");
      })
      .catch(() => {
        if (!active) return;
        setRemote(null);
        setSource("local");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [path]);

  const meta = useMemo(() => ({ ...(remote || {}), ...fallback }), [fallback, remote]);
  const canonical = text(meta.canonical || meta.url, path ? absoluteUrl(path) : "");
  const title = text(meta.title, "Seitentitel fehlt noch");
  const description = text(meta.description, "Kurzbeschreibung fehlt noch.");
  const robots = text(meta.robots, fallback.published === false ? "noindex, follow" : "index, follow");
  const image = resolveMediaUrl(meta.image || meta.banner_url || fallback.image);
  const urlLabel = canonical || absoluteUrl(path) || "https://lionsquad.at";
  const statusLabel = loading ? "Lade echte Meta-Daten" : source === "live" ? "Live + Formular" : "Lokale Vorschau";

  return (
    <section className={`border border-white/10 bg-[#0A0A0A] rounded-sm p-4 space-y-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">SEO-Vorschau</div>
          <div className="mt-1 text-xs text-white/45">Google, Teilen-Karte, Canonical und Index-Status.</div>
        </div>
        <span className="rounded-sm border border-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white/45">
          {statusLabel}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-sm border border-white/10 bg-white p-4 text-[#202124]">
          <div className="flex items-center gap-2 text-xs text-[#4d5156]">
            <Search className="h-3.5 w-3.5 text-[#29B6E8]" />
            <span className="truncate">{hostLabel(urlLabel)}</span>
          </div>
          <div className="mt-1 truncate text-[13px] text-[#3c4043]">{urlLabel}</div>
          <h3 className="mt-2 line-clamp-2 text-lg leading-snug text-[#1a0dab]">{title}</h3>
          <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-[#4d5156]">{description}</p>
        </div>

        <div className="overflow-hidden rounded-sm border border-white/10 bg-[#121212]">
          <div className="aspect-[1.91/1] bg-white/5">
            {image ? (
              <img src={image} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-white/30">
                <ImageIcon className="h-8 w-8" />
              </div>
            )}
          </div>
          <div className="space-y-1 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/35">
              <Share2 className="h-3 w-3 text-[#29B6E8]" />
              Social Preview
            </div>
            <div className="line-clamp-2 text-sm font-bold text-white">{title}</div>
            <p className="line-clamp-2 text-xs leading-relaxed text-white/50">{description}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-2 text-xs text-white/50 sm:grid-cols-2">
        <div className="flex min-w-0 items-center gap-2 rounded-sm border border-white/10 bg-[#121212] px-3 py-2">
          <Link2 className="h-3.5 w-3.5 shrink-0 text-[#29B6E8]" />
          <span className="truncate">{canonical || "Canonical wird nach dem Speichern gesetzt."}</span>
        </div>
        <div className="rounded-sm border border-white/10 bg-[#121212] px-3 py-2">
          <span className="text-white/35">Robots:</span> <span className="font-bold text-white/70">{robots}</span>
        </div>
      </div>
    </section>
  );
}
