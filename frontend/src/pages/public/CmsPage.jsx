/**
 * Phase F — Generic CMS Page renderer.
 *
 * Loads content from /api/pages/{slug}. Supports a pragmatic Markdown-light
 * formatter (headings, bold, italic, paragraphs, links, lists) without a heavy
 * external lib. For the current need (vereinsstatuten/imprint/privacy/about)
 * this is enough; admin can paste plain text or simple markdown.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { useSeoPage } from "@/hooks/useSeoPage";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

export default function CmsPage({ slug: forced }) {
  const params = useParams();
  const slug = forced || params.slug;
  const [page, setPage] = useState(null);
  const [error, setError] = useState(null);
  useSeoPage(slug);
  const load = useCallback(() => {
    setError(null);
    return api.get(`/pages/${slug}`).then(({ data }) => setPage(data)).catch((e) => setError(e?.response?.status || "error"));
  }, [slug]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["pages", "cms"]);

  if (error === 404) return <PublicLayout><Empty title="Seite nicht gefunden" /></PublicLayout>;
  if (!page) return <PublicLayout><div className="max-w-4xl mx-auto px-6 py-20 text-white/40 font-display tracking-widest">LADE …</div></PublicLayout>;

  return (
    <PublicLayout>
      <article className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12" data-testid={`cms-page-${slug}`}>
        <Breadcrumbs items={[{ label: page.title }]} />
        <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-4">{page.title}</h1>
        {page.meta_description && (
          <p className="mt-3 text-white/60 text-lg max-w-2xl">{page.meta_description}</p>
        )}
        <div className="mt-10 prose-cms" dangerouslySetInnerHTML={{ __html: renderMarkdownLite(page.body_md || "") }} />
        <style>{`
          .prose-cms { color: rgba(255,255,255,0.78); line-height: 1.7; font-size: 15px; }
          .prose-cms h1 { font-family: var(--font-heading, "Bebas Neue"), sans-serif; font-size: 2rem; text-transform: uppercase; letter-spacing: 0.03em; margin: 1.5em 0 0.5em; color: #fff; }
          .prose-cms h2 { font-family: var(--font-heading, "Bebas Neue"), sans-serif; font-size: 1.5rem; text-transform: uppercase; letter-spacing: 0.04em; margin: 1.25em 0 0.5em; color: #fff; }
          .prose-cms h3 { font-weight: 700; font-size: 1.15rem; margin: 1em 0 0.4em; color: #fff; }
          .prose-cms p { margin-bottom: 1em; }
          .prose-cms a { color: #29B6E8; text-decoration: underline; }
          .prose-cms ul { padding-left: 1.25rem; margin-bottom: 1em; list-style-type: disc; }
          .prose-cms ol { padding-left: 1.25rem; margin-bottom: 1em; list-style-type: decimal; }
          .prose-cms strong { color: #fff; }
          .prose-cms hr { border-color: rgba(255,255,255,0.1); margin: 2rem 0; }
        `}</style>
      </article>
    </PublicLayout>
  );
}

function Empty({ title }) {
  return (
    <div className="max-w-3xl mx-auto px-6 py-24 text-center">
      <h1 className="font-heading text-4xl font-black uppercase">{title}</h1>
      <p className="mt-4 text-white/55">Die gewünschte Seite ist nicht verfügbar.</p>
    </div>
  );
}

function renderMarkdownLite(md) {
  if (!md) return "";
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = md.split(/\r?\n/);
  let html = "";
  let inList = null; // 'ul' | 'ol' | null
  for (let raw of lines) {
    let line = esc(raw);
    // bold/italic/links inline
    line = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    line = line.replace(/\*(.+?)\*/g, "<em>$1</em>");
    line = line.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

    if (/^###\s+/.test(raw)) { close(); html += `<h3>${line.replace(/^###\s+/, "")}</h3>`; continue; }
    if (/^##\s+/.test(raw)) { close(); html += `<h2>${line.replace(/^##\s+/, "")}</h2>`; continue; }
    if (/^#\s+/.test(raw))  { close(); html += `<h1>${line.replace(/^#\s+/, "")}</h1>`; continue; }
    if (/^\s*[-*]\s+/.test(raw)) {
      if (inList !== "ul") { close(); html += "<ul>"; inList = "ul"; }
      html += `<li>${line.replace(/^\s*[-*]\s+/, "")}</li>`; continue;
    }
    if (/^\s*\d+\.\s+/.test(raw)) {
      if (inList !== "ol") { close(); html += "<ol>"; inList = "ol"; }
      html += `<li>${line.replace(/^\s*\d+\.\s+/, "")}</li>`; continue;
    }
    if (/^---+$/.test(raw)) { close(); html += "<hr/>"; continue; }
    if (raw.trim() === "") { close(); continue; }
    close();
    html += `<p>${line}</p>`;
  }
  function close() { if (inList) { html += inList === "ul" ? "</ul>" : "</ol>"; inList = null; } }
  close();
  return html;
}
