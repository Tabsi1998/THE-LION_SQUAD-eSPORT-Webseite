import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Info, Link2 } from "lucide-react";
import { toast } from "sonner";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { FAQ_PFAD, THEMEN, ankerAus, faqBereich, hilfePfad, hilfeSchritte, hilfeThema } from "@/hilfe";
import FaqClip from "@/hilfe/FaqClip";
import { ShortCaps } from "@/components/tls/ShortCaps";

// Eine Anleitung der FAQ (#2295, seit #2448 unter /faq/<thema>; /hilfe/<thema> leitet her): Inhalt oben, dann je
// Abschnitt die Schritte mit Nummer, kurzem Satz, Hinweis und Bild. Jeder Schritt hat einen Anker (#<schritt>), den „?“-Links und „Link kopieren“ nutzen.
// Bild bzw. Schleife wie ein GIF zeigt FaqClip (#2448): am Handy die Handy-Fassung, sonst die PC-Fassung.

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
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-[#29B6E8] tls-type-card text-black" aria-hidden="true">
          {schritt.nummer}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="tls-type-card text-white [overflow-wrap:anywhere]">
              <span className="sr-only">Schritt {schritt.nummer}: </span>{schritt.titel}
            </h3>
            <button type="button" onClick={() => copyLink(slug, schritt.id)} data-testid={`help-copy-${schritt.id}`}
              aria-label={`Link zu „${schritt.titel}“ kopieren`} title="Link kopieren"
              className="-mr-2 -mt-1.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-white/45 hover:bg-white/5 hover:text-[#29B6E8]">
              <Link2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <p className="mt-1 tls-type-body leading-relaxed text-white/85">{schritt.text}</p>
          {schritt.hinweis ? (
            <p className="mt-3 flex items-start gap-2 rounded-sm border border-[#29B6E8]/25 bg-[#29B6E8]/[0.06] px-3 py-2 tls-type-small text-white/80" data-testid={`help-hint-${schritt.id}`}>
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#29B6E8]" aria-hidden="true" /> <span>{schritt.hinweis}</span>
            </p>
          ) : null}
          {schritt.link ? (
            <Link to={schritt.link.to} className="mt-3 inline-flex min-h-[44px] items-center gap-1 tls-type-small font-semibold text-[#29B6E8] hover:underline">
              {schritt.link.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
          {schritt.bild ? <FaqClip slug={slug} schritt={schritt} /> : null}
        </div>
      </div>
    </li>
  );
}

export default function HelpTopicPage() {
  // Groß/klein egal wie beim Server (Teilen-Karte): /faq/Liga-Captains zeigt dasselbe Thema.
  const slug = useParams().thema?.toLowerCase();
  const { hash } = useLocation();
  const thema = hilfeThema(slug);
  const active = ankerAus(hash);
  const [scrolled, setScrolled] = useState("");
  useDocumentTitle(thema ? `${thema.titel} · FAQ` : "FAQ", thema?.kurz, thema ? {} : { robots: "noindex, follow" });

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
          <Breadcrumbs items={[{ label: "Start", to: "/" }, { label: "FAQ", to: FAQ_PFAD }]} />
          <h1 className="tls-type-title mt-4"><ShortCaps>Anleitung nicht gefunden</ShortCaps></h1>
          <p className="mt-3 text-white/70">Diese Anleitung gibt es nicht. Alle Fragen und Anleitungen findest du in der FAQ.</p>
          <Link to={FAQ_PFAD} className="mt-5 inline-flex min-h-[44px] items-center gap-1 font-semibold text-[#29B6E8] hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Zur FAQ
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
        <Breadcrumbs items={[{ label: "Start", to: "/" }, { label: "FAQ", to: FAQ_PFAD }, { label: thema.titel }]} />
        <p className="mt-4 tls-type-label text-[#29B6E8]">{faqBereich(thema.bereich)?.titel || "Anleitung"} · {thema.zielgruppe}</p>
        <h1 className="tls-type-title mt-2 [overflow-wrap:anywhere]">{thema.titel}</h1>
        <p className="mt-3 text-white/70 max-w-2xl">{thema.kurz}</p>

        <nav aria-label="Inhalt" className="mt-8 rounded-sm border border-white/10 bg-[#0F0F10] p-4" data-testid="help-toc">
          <p className="tls-type-label text-white/50">Inhalt</p>
          <ol className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {thema.abschnitte.map((abschnitt) => (
              <li key={abschnitt.id} className="min-w-0">
                <a href={`#${abschnitt.id}`} className="font-semibold text-white hover:text-[#29B6E8]">{abschnitt.titel}</a>
                <ol className="mt-1 space-y-0.5">
                  {abschnitt.schritte.map((schritt) => (
                    <li key={schritt.id}>
                      <a href={`#${schritt.id}`} className="flex min-h-[44px] items-center tls-type-small text-white/60 hover:text-[#29B6E8] sm:inline-block sm:min-h-0 sm:py-0.5">
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
            <h2 id={`${abschnitt.id}-titel`} className="tls-type-section text-white">{abschnitt.titel}</h2>
            <ol className="mt-4">
              {abschnitt.schritte.map((schritt) => {
                const row = steps.find((item) => item.id === schritt.id);
                return <Step key={schritt.id} slug={thema.slug} schritt={row} active={active === schritt.id} />;
              })}
            </ol>
          </section>
        ))}

        <section className="mt-14 border-t border-white/10 pt-6" aria-labelledby="help-more">
          <h2 id="help-more" className="tls-type-label text-white/50">Weitere Anleitungen</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {others.map((item) => (
              <li key={item.slug}>
                <Link to={hilfePfad(item.slug)} className="tls-btn tls-btn--quiet inline-flex min-h-[44px] items-center rounded-sm px-4 py-2 tls-type-label">{item.titel}</Link>
              </li>
            ))}
          </ul>
          <Link to={FAQ_PFAD} className="mt-4 inline-flex min-h-[44px] items-center gap-1 tls-type-small font-semibold text-[#29B6E8] hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Alle Fragen und Suche
          </Link>
        </section>
      </article>
    </PublicLayout>
  );
}
