import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Info, Link2, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { THEMEN, hilfeBild, hilfePfad, hilfeSchritte, hilfeThema, hilfeVideo } from "@/hilfe";

// Ein Hilfe-Thema (#2295) unter /hilfe/<thema>: Inhalt oben, dann je Abschnitt die Schritte mit Nummer, kurzem Satz,
// Hinweis und Bild. Jeder Schritt hat einen Anker (#<schritt>), den „?“-Links und „Link kopieren“ nutzen. Am Handy
// zeigt das Bild die Handy-Ansicht, ab 768 px die PC-Ansicht.

function StepImage({ slug, schritt }) {
  const handy = hilfeBild(slug, schritt.id, "handy");
  const pc = hilfeBild(slug, schritt.id, "pc");
  const fallback = handy || pc;
  if (!fallback) return null;
  return (
    <figure className="mt-4">
      <picture>
        {pc && handy ? <source media="(min-width: 768px)" srcSet={pc.src} width={pc.width} height={pc.height} /> : null}
        <img src={fallback.src} width={fallback.width} height={fallback.height} alt={`Bildschirmfoto: ${schritt.titel}`} loading="lazy" decoding="async"
          data-testid={`help-step-image-${schritt.id}`}
          className="block h-auto max-w-full rounded-sm border border-white/10 bg-[#0F0F10]" />
      </picture>
    </figure>
  );
}

function StepVideo({ video }) {
  const src = hilfeVideo(video.id);
  if (!src) return null;
  return (
    <figure className="mt-4 rounded-sm border border-white/10 bg-[#0F0F10] p-3" data-testid={`help-video-${video.id}`}>
      <figcaption className="mb-2 flex items-center gap-2 text-sm font-semibold text-white/85">
        <PlayCircle className="h-4 w-4 text-[#29B6E8]" aria-hidden="true" /> {video.titel}
      </figcaption>
      <video src={src} controls muted playsInline preload="metadata" className="mx-auto block w-full max-w-[360px] rounded-sm bg-black" />
    </figure>
  );
}

async function copyLink(slug, id) {
  const url = `${window.location.origin}${hilfePfad(slug, id)}`;
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link kopiert. Du kannst ihn jetzt weiterschicken.");
  } catch {
    window.history.replaceState(null, "", hilfePfad(slug, id));
    toast("Der Link steht jetzt oben in der Adresszeile.");
  }
}

function Step({ slug, schritt, active }) {
  return (
    <li id={schritt.id} data-testid={`help-step-${schritt.id}`} data-active={active ? "true" : undefined}
      className={`scroll-mt-24 border-t border-white/10 py-6 transition-colors ${active ? "bg-[#29B6E8]/[0.06] -mx-3 px-3 rounded-sm" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-[#29B6E8] font-heading text-base font-black text-black" aria-hidden="true">
          {schritt.nummer}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-heading text-xl font-bold uppercase text-white [overflow-wrap:anywhere]">
              <span className="sr-only">Schritt {schritt.nummer}: </span>{schritt.titel}
            </h3>
            <button type="button" onClick={() => copyLink(slug, schritt.id)} data-testid={`help-copy-${schritt.id}`}
              aria-label={`Link zu „${schritt.titel}“ kopieren`} title="Link kopieren"
              className="-mr-2 -mt-1.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-white/45 hover:bg-white/5 hover:text-[#29B6E8]">
              <Link2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <p className="mt-1 text-base leading-relaxed text-white/85">{schritt.text}</p>
          {schritt.hinweis ? (
            <p className="mt-3 flex items-start gap-2 rounded-sm border border-[#29B6E8]/25 bg-[#29B6E8]/[0.06] px-3 py-2 text-sm text-white/80" data-testid={`help-hint-${schritt.id}`}>
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#29B6E8]" aria-hidden="true" /> <span>{schritt.hinweis}</span>
            </p>
          ) : null}
          {schritt.link ? (
            <Link to={schritt.link.to} className="mt-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-[#29B6E8] hover:underline">
              {schritt.link.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
          {schritt.bild ? <StepImage slug={slug} schritt={schritt} /> : null}
        </div>
      </div>
    </li>
  );
}

export default function HelpTopicPage() {
  const { thema: slug } = useParams();
  const { hash } = useLocation();
  const thema = hilfeThema(slug);
  const active = decodeURIComponent(hash.replace(/^#/, ""));
  const [scrolled, setScrolled] = useState("");
  useDocumentTitle(thema ? `${thema.titel} · Hilfe` : "Hilfe", thema?.kurz, thema ? {} : { robots: "noindex, follow" });

  // Die Seite wird nachgeladen: Kommt jemand über einen Link mit Anker, steht der Schritt erst jetzt da.
  useEffect(() => {
    if (!thema || !active || scrolled === `${slug}#${active}`) return;
    const target = document.getElementById(active);
    if (target) {
      target.scrollIntoView({ block: "start" });
      setScrolled(`${slug}#${active}`);
    }
  }, [thema, slug, active, scrolled]);

  if (!thema) {
    return (
      <PublicLayout>
        <article className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12" data-testid="help-missing">
          <Breadcrumbs items={[{ label: "Start", to: "/" }, { label: "Hilfe", to: "/hilfe" }]} />
          <h1 className="font-heading text-3xl font-black uppercase mt-4">Thema nicht gefunden</h1>
          <p className="mt-3 text-white/70">Dieses Hilfe-Thema gibt es nicht. Alle Themen findest du in der Übersicht.</p>
          <Link to="/hilfe" className="mt-5 inline-flex min-h-[44px] items-center gap-1 font-semibold text-[#29B6E8] hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Zur Hilfe
          </Link>
        </article>
      </PublicLayout>
    );
  }

  const steps = hilfeSchritte(thema);
  const others = THEMEN.filter((item) => item.slug !== thema.slug);
  return (
    <PublicLayout>
      <article className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12" data-testid="help-topic">
        <Breadcrumbs items={[{ label: "Start", to: "/" }, { label: "Hilfe", to: "/hilfe" }, { label: thema.titel }]} />
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">{thema.zielgruppe}</p>
        <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-2 [overflow-wrap:anywhere]">{thema.titel}</h1>
        <p className="mt-3 text-white/70 max-w-2xl">{thema.kurz}</p>

        <nav aria-label="Inhalt" className="mt-8 rounded-sm border border-white/10 bg-[#0F0F10] p-4" data-testid="help-toc">
          <p className="text-xs font-bold uppercase tracking-widest text-white/50">Inhalt</p>
          <ol className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {thema.abschnitte.map((abschnitt) => (
              <li key={abschnitt.id} className="min-w-0">
                <a href={`#${abschnitt.id}`} className="font-semibold text-white hover:text-[#29B6E8]">{abschnitt.titel}</a>
                <ol className="mt-1 space-y-0.5">
                  {abschnitt.schritte.map((schritt) => (
                    <li key={schritt.id}>
                      <a href={`#${schritt.id}`} className="inline-block py-0.5 text-sm text-white/60 hover:text-[#29B6E8]">
                        {steps.find((row) => row.id === schritt.id)?.nummer}. {schritt.titel}
                      </a>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </nav>

        {thema.abschnitte.map((abschnitt) => (
          <section key={abschnitt.id} id={abschnitt.id} aria-labelledby={`${abschnitt.id}-titel`} className="mt-12 scroll-mt-24" data-testid={`help-section-${abschnitt.id}`}>
            <h2 id={`${abschnitt.id}-titel`} className="font-heading text-2xl md:text-3xl font-black uppercase text-white">{abschnitt.titel}</h2>
            {(thema.videos || []).filter((video) => video.abschnitt === abschnitt.id).map((video) => <StepVideo key={video.id} video={video} />)}
            <ol className="mt-4">
              {abschnitt.schritte.map((schritt) => {
                const row = steps.find((item) => item.id === schritt.id);
                return <Step key={schritt.id} slug={thema.slug} schritt={row} active={active === schritt.id} />;
              })}
            </ol>
          </section>
        ))}

        <section className="mt-14 border-t border-white/10 pt-6" aria-labelledby="help-more">
          <h2 id="help-more" className="text-xs font-bold uppercase tracking-widest text-white/50">Weitere Themen</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {others.map((item) => (
              <li key={item.slug}>
                <Link to={hilfePfad(item.slug)} className="tls-btn tls-btn--quiet inline-flex min-h-[44px] items-center rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider">{item.titel}</Link>
              </li>
            ))}
          </ul>
          <Link to="/hilfe" className="mt-4 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-[#29B6E8] hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Alle Themen und Suche
          </Link>
        </section>
      </article>
    </PublicLayout>
  );
}
