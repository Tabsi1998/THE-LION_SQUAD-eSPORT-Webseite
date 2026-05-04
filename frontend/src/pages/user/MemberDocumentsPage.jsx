import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { FileText, Download, Pin, ArrowLeft, Search } from "lucide-react";

const CATEGORY_LABELS = {
  statutes: "Statuten", minutes: "Protokolle", form: "Formular",
  regulations: "Regelwerk", guideline: "Leitlinie", download: "Download",
  media_kit: "Media Kit", presentation: "Präsentation", template: "Vorlage",
  other: "Sonstiges",
};

const CATEGORY_COLORS = {
  statutes: "#FFD700", minutes: "#9F7AEA", form: "#29B6E8",
  regulations: "#FF3B30", guideline: "#10B981", download: "#29B6E8",
  media_kit: "#FFD700", presentation: "#9F7AEA", template: "#10B981", other: "#6B7280",
};

function fmtSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function MemberDocumentsPage() {
  const [list, setList] = useState([]);
  const [meta, setMeta] = useState({ categories: [] });
  const [activeCat, setActiveCat] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.get("/documents/meta").then(({ data }) => setMeta(data)).catch(() => {}); }, []);
  useEffect(() => {
    setLoading(true);
    const url = activeCat ? `/documents?category=${activeCat}` : "/documents";
    api.get(url).then(({ data }) => setList(data)).catch(() => {}).finally(() => setLoading(false));
  }, [activeCat]);

  const trackDownload = async (doc) => {
    try {
      await api.post(`/documents/${doc.id}/track-download`);
    } catch { /* swallow */ }
  };

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
        <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-2">Vereinsdokumente & Downloads</h1>
        <p className="mt-3 text-white/60 max-w-2xl">
          Statuten, Protokolle, Formulare, Vereinsleitlinien und Mitglieder-Downloads — zentral abgelegt und immer aktuell.
        </p>

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
          <div className="mt-10 text-white/40 text-sm">Lade …</div>
        ) : filtered.length === 0 ? (
          <div className="mt-10 border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
            <FileText className="w-10 h-10 mx-auto opacity-40 mb-3" />
            <div className="font-heading font-bold text-lg">Keine Dokumente gefunden</div>
          </div>
        ) : (
          <div className="mt-10 space-y-8">
            {pinned.length > 0 && (
              <Group label="Angepinnt" docs={pinned} onTrack={trackDownload} />
            )}
            {rest.length > 0 && (
              <Group label={pinned.length ? "Weitere" : null} docs={rest} onTrack={trackDownload} />
            )}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}

function Group({ label, docs, onTrack }) {
  return (
    <div>
      {label && <div className="text-[11px] uppercase tracking-widest text-white/40 font-bold mb-3">{label}</div>}
      <div className="space-y-2">
        {docs.map((d) => <DocRow key={d.id} d={d} onTrack={onTrack} />)}
      </div>
    </div>
  );
}

function DocRow({ d, onTrack }) {
  const c = CATEGORY_COLORS[d.category] || "#29B6E8";
  return (
    <div data-testid={`doc-row-${d.id}`} className="border border-white/10 hover:border-white/25 rounded-sm bg-[#121212] p-4 flex items-center gap-4 transition">
      <div className="w-12 h-12 shrink-0 rounded-sm flex items-center justify-center" style={{ background: `${c}15`, border: `1px solid ${c}40` }}>
        <FileText className="w-5 h-5" style={{ color: c }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: c }}>{CATEGORY_LABELS[d.category] || d.category}</span>
          {d.pinned && <Pin className="w-3 h-3 text-[#FFD700]" />}
        </div>
        <div className="font-heading font-bold text-white mt-0.5">{d.title}</div>
        {d.description && <div className="text-xs text-white/55 mt-1 line-clamp-2">{d.description}</div>}
        <div className="mt-2 flex items-center gap-3 text-[10px] text-white/40 uppercase tracking-wider">
          {d.original_filename && <span>{d.original_filename}</span>}
          {d.file_size && <span>{fmtSize(d.file_size)}</span>}
          {d.download_count > 0 && <span>{d.download_count} Downloads</span>}
        </div>
      </div>
      <a
        href={d.file_url}
        target="_blank"
        rel="noreferrer"
        download={d.original_filename || true}
        onClick={() => onTrack(d)}
        data-testid={`doc-download-${d.id}`}
        className="shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-[#FFD700]/15 hover:bg-[#FFD700]/25 text-[#FFD700] border border-[#FFD700]/40 font-bold uppercase tracking-wider text-xs rounded-sm transition"
      >
        <Download className="w-3.5 h-3.5" /> Laden
      </a>
    </div>
  );
}
