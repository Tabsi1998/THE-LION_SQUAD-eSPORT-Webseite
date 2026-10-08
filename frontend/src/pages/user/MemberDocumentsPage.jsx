import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { FileText, ArrowLeft, Search } from "lucide-react";
import { DocumentViewer } from "@/components/tls/DocumentViewer";
import { SkeletonList } from "@/components/tls/Skeleton";
import { CATEGORY_LABELS, DocumentGroup } from "./DocumentRows";

// Vereinsdokumente im Mitgliederbereich: für alle Mitglieder gleich (#1255) - Statuten, Protokolle, Ordnungen. Die
// eigenen Unterlagen aus der Vereinsakte (Bestätigungen, Schreiben) stehen im Profil unter „Nur für dich“.

export default function MemberDocumentsPage() {
  const [list, setList] = useState([]);
  const [meta, setMeta] = useState({ categories: [] });
  const [activeCat, setActiveCat] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  // PDFs öffnen im gemeinsamen Betrachter (#325) statt in einem neuen Tab; alles andere wie bisher.
  const [viewing, setViewing] = useState(null);
  // Vereinsakte (#324 Teil 1): ohne Bindung ein Hinweis, wie die eigenen Unterlagen ins Profil kommen.
  const [identity, setIdentity] = useState(null);
  useEffect(() => {
    api.get("/membership/me/identity").then(({ data }) => setIdentity(data && data.available === true ? data : null)).catch(() => setIdentity(null));
  }, []);

  const loadMeta = useCallback(() => api.get("/documents/meta").then(({ data }) => setMeta(data)).catch(() => {}), []);
  useEffect(() => { loadMeta(); }, [loadMeta]);
  const load = useCallback(() => {
    setLoading(true);
    api.get("/documents", { params: activeCat ? { scope: "club", category: activeCat } : { scope: "club" } })
      .then(({ data }) => setList(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeCat]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(() => {
    loadMeta();
    load();
  }, ["documents"]);

  const filtered = list.filter((d) => {
    if (!q) return true;
    const blob = `${d.title} ${d.description || ""} ${(d.tags || []).join(" ")}`.toLowerCase();
    return blob.includes(q.toLowerCase());
  });
  const pinned = filtered.filter((d) => d.pinned);
  const rest = filtered.filter((d) => !d.pinned);

  return (
    <PublicLayout>
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link to="/members/area" className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-white/50 hover:text-[#FFD700]">
          <ArrowLeft className="w-3.5 h-3.5" /> Mitgliederbereich
        </Link>
        <span className="mt-6 text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700] block">EXKLUSIV</span>
        <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-2">Vereins&shy;dokumente</h1>
        <p className="mt-3 text-white/60 max-w-2xl">
          Statuten, Protokolle, Formulare und Vereinsleitlinien - zentral abgelegt, direkt einsehbar und immer aktuell.
        </p>
        <p className="mt-2 text-sm text-white/55" data-testid="docs-own-hint">
          Deine eigenen Unterlagen aus der Vereinsakte (Bestätigungen, Schreiben) stehen in deinem Profil unter{" "}
          <Link to="/account/documents" className="text-[#29B6E8] hover:underline">„Nur für dich“ → Deine Unterlagen</Link>.
        </p>
        {identity && identity.status !== "bound" && (
          <div className="mt-6 border border-[#FFD700]/30 bg-[#FFD700]/5 rounded-sm p-4 text-sm text-white/75" data-testid="docs-identity-hint">
            Dort erscheinen sie von selbst, sobald dein Konto deinem Mitgliedseintrag zugeordnet ist (über die bestätigte E-Mail-Adresse oder durch den Vorstand) – oder du löst einen{" "}
            <Link to="/members/membership" className="text-[#FFD700] hover:underline">Einladungscode unter Meine Mitgliedschaft</Link> ein.
          </div>
        )}

        <div className="mt-8 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setActiveCat("")}
              data-testid="docs-filter-all"
              className={`px-3 py-1.5 text-xs uppercase tracking-wider font-bold rounded-sm transition ${!activeCat ? "bg-[#FFD700] text-black" : "border border-white/10 text-white/60 hover:text-white"}`}
            >Alle</button>
            {meta.categories.map((c) => (
              <button
                key={c.k}
                onClick={() => setActiveCat(c.k)}
                data-testid={`docs-filter-${c.k}`}
                className={`px-3 py-1.5 text-xs uppercase tracking-wider font-bold rounded-sm transition ${activeCat === c.k ? "bg-[#FFD700] text-black" : "border border-white/10 text-white/60 hover:text-white"}`}
              >{c.l}</button>
            ))}
          </div>
          <div className="relative w-full md:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Dokumente suchen…" data-testid="docs-search" className="w-full bg-[#0A0A0A] border border-white/10 pl-9 pr-3 py-2 rounded-sm text-sm" />
          </div>
        </div>

        {loading ? (
          <SkeletonList rows={5} className="mt-10" label="Lade Dokumente" />
        ) : filtered.length === 0 ? (
          <div className="mt-10 border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
            <FileText className="w-10 h-10 mx-auto opacity-40 mb-3" />
            <div className="font-heading font-bold text-lg">Keine Dokumente gefunden</div>
          </div>
        ) : (
          <div className="mt-10 space-y-8">
            {pinned.length > 0 && (
              <DocumentGroup label="Angepinnt" docs={pinned} onView={setViewing} />
            )}
            {rest.length > 0 && (
              <DocumentGroup label={pinned.length ? "Weitere" : null} docs={rest} onView={setViewing} />
            )}
          </div>
        )}
      </section>
      {viewing && (
        <DocumentViewer
          path={`/documents/${viewing.id}/view`}
          downloadPath={viewing.allow_download ? `/documents/${viewing.id}/download` : null}
          title={viewing.title}
          subtitle={CATEGORY_LABELS[viewing.category] || viewing.category}
          onClose={() => setViewing(null)}
        />
      )}
    </PublicLayout>
  );
}
