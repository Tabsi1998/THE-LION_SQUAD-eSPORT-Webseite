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
import { renderMarkdownLite } from "@/lib/markdownLite";

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
