import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { api } from "@/lib/api";

// Rechtstexte kommen fertig als Abschnitte vom Backend (#545, eine Quelle für Website und Crawler-Vorschau):
// Datenschutz aus den Schaltern, die wirklich an sind, Impressum aus den öffentlichen Vereinsdaten. Hier wird
// nur noch gerendert: Absätze mit **fett** und [Text](Adresse), Listen, Begriff/Wert-Zeilen und freie Vereinstexte.

const INLINE_RE = /(\*\*[^*]+\*\*|\[[^\]]+\]\((?:\/|mailto:|https?:\/\/)[^)\s]+\))/g;
const LINK_RE = /^\[([^\]]+)\]\(([^)]+)\)$/;
const LINK_CLASS = "text-[#29B6E8] hover:underline";

const PAGE_META = {
  privacy: { title: "Datenschutzerklärung", intro: "Informationen zur Verarbeitung personenbezogener Daten auf dieser Vereinsplattform." },
  imprint: { title: "Impressum", intro: "Anbieterkennzeichnung, Offenlegung und Kontaktinformationen des Vereins." },
  terms: { title: "Nutzungsbedingungen", intro: "Regeln für Accounts, Community-Funktionen und Wettbewerbe." },
};

function formatLegalDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function Inline({ text }) {
  const parts = String(text || "").split(INLINE_RE).filter(Boolean);
  return parts.map((piece, index) => {
    if (piece.startsWith("**") && piece.endsWith("**") && piece.length > 4) {
      return <strong key={index}>{piece.slice(2, -2)}</strong>;
    }
    const match = piece.match(LINK_RE);
    if (match) {
      const [, label, href] = match;
      if (href.startsWith("/")) return <Link key={index} to={href} className={LINK_CLASS}>{label}</Link>;
      if (href.startsWith("mailto:")) return <a key={index} href={href} className={LINK_CLASS}>{label}</a>;
      return <a key={index} href={href} target="_blank" rel="noreferrer" className={LINK_CLASS}>{label}</a>;
    }
    return piece;
  });
}

function LegalArticle({ title, intro, updatedAt, children }) {
  useDocumentTitle(title, intro, { robots: "noindex, follow" });
  const formattedUpdatedAt = formatLegalDate(updatedAt);

  return (
    <PublicLayout>
      <article className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Breadcrumbs items={[{ label: title }]} />
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Rechtliches</p>
        <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-2">{title}</h1>
        <p className="mt-3 text-white/60 max-w-2xl">{intro}</p>
        {formattedUpdatedAt && <p className="mt-2 text-xs text-white/40">Stand: {formattedUpdatedAt}</p>}
        <div className="mt-10 space-y-8 text-sm leading-relaxed text-white/75">{children}</div>
      </article>
    </PublicLayout>
  );
}

function Section({ title, children, id }) {
  return (
    <section className="border-t border-white/10 pt-6" id={id}>
      <h2 className="font-heading text-2xl font-black uppercase text-white">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function InfoList({ rows }) {
  if (!rows?.length) return null;
  return (
    <dl className="grid sm:grid-cols-[210px_1fr] gap-x-5 gap-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-white/45">{label}</dt>
          <dd className="text-white break-words">
            {Array.isArray(value) ? value.map((line) => <div key={line}><Inline text={line} /></div>) : <Inline text={value} />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function LegalDataNotice({ ready }) {
  if (ready !== false) return null;
  return (
    <div data-testid="legal-data-incomplete" className="rounded-sm border border-amber-300/30 bg-amber-300/10 p-4 text-amber-100">
      Die rechtlichen Kontaktdaten sind derzeit nicht vollständig verfügbar. Bitte nutze bei Fragen das Kontaktformular.
    </div>
  );
}

function Block({ block }) {
  if (block.type === "p") return <p data-testid={block.testid}><Inline text={block.text} /></p>;
  if (block.type === "list") {
    return (
      <ul className="list-disc pl-5 space-y-1" data-testid={block.testid}>
        {block.items.map((item) => <li key={item}><Inline text={item} /></li>)}
      </ul>
    );
  }
  if (block.type === "info") return <InfoList rows={block.rows} />;
  if (block.type === "text") {
    return <div className="rounded-sm border border-white/10 bg-[#121212] p-4 whitespace-pre-line text-white/80">{block.text}</div>;
  }
  return null;
}

export function LegalPage({ page }) {
  const meta = PAGE_META[page];
  const [doc, setDoc] = useState(null);
  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/settings/public/legal/${page}`);
      // Nur eine Antwort mit Abschnitten ist eine Rechtsseite - alles andere zeigt die leere Seite mit Titel.
      setDoc(data && Array.isArray(data.sections) ? data : { ...meta, legal_ready: data?.legal_ready, sections: [] });
    } catch {
      setDoc((current) => current || { sections: [] });
    }
  }, [page, meta]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["settings", "branding"]);

  return (
    <LegalArticle title={doc?.title || meta.title} intro={doc?.intro || meta.intro} updatedAt={doc?.updated_at}>
      <LegalDataNotice ready={doc?.legal_ready} />
      {doc === null ? (
        <p className="text-white/40" data-testid="legal-loading">Text wird geladen …</p>
      ) : (
        doc.sections.map((section) => (
          <Section key={section.id} id={section.id} title={section.title}>
            {section.blocks.map((block, index) => <Block key={`${section.id}-${index}`} block={block} />)}
          </Section>
        ))
      )}
    </LegalArticle>
  );
}

export function PrivacyPage() {
  return <LegalPage page="privacy" />;
}

export function ImprintPage() {
  return <LegalPage page="imprint" />;
}

export function TermsPage() {
  return <LegalPage page="terms" />;
}
