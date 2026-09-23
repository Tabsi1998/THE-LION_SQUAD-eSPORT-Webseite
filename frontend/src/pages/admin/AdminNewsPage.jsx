import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, formatRequestError } from "@/lib/api";
import { newsCategoryLabel } from "@/lib/newsCategories";
import { formatTimeUntil } from "@/lib/newsPublication";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Download, Plus, Pin, Trash2, Search, Newspaper } from "lucide-react";

function csvCell(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return /[",;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportNewsCsv(rows) {
  const header = ["Titel", "Slug", "Kategorie", "Sichtbarkeit", "Status", "Datum"];
  const lines = rows.map((item) => [
    item.title,
    item.slug,
    item.category,
    item.visibility,
    item.status_label,
    item.date_label,
  ].map(csvCell).join(";"));
  const blob = new Blob([[header.map(csvCell).join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tls-news-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// News-Liste. Anlegen und Bearbeiten sind seit #434 eigene Seiten (`/admin/news/new`,
// `/admin/news/:id`) statt eines Fensters über der Liste; alte Links mit `?edit=` leiten dorthin.
export default function AdminNewsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [list, setList] = useState([]);
  const [meta, setMeta] = useState({ categories: [], visibilities: [] });
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState("");
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const { data } = await api.get("/admin/news");
    setList(data);
  }, []);
  useEffect(() => {
    load();
    api.get("/news-meta").then(({ data }) => setMeta(data)).catch(() => {});
  }, [load]);
  useApiInvalidation(load, ["news"]);

  useEffect(() => {
    const editId = searchParams.get("edit");
    if (editId) navigate(`/admin/news/${encodeURIComponent(editId)}`, { replace: true });
  }, [navigate, searchParams]);

  const remove = async (id) => {
    if (!await confirm({ title: "Beitrag löschen?", description: "Der News-Beitrag wird dauerhaft entfernt.", confirmLabel: "Löschen" })) return;
    try { await api.delete(`/news/${id}`); toast.success("Gelöscht."); load(); } catch (err) { toast.error(formatRequestError(err, "Beitrag konnte nicht gelöscht werden.")); }
  };

  const publicationState = (post) => {
    if (!post.published) return { key: "draft", label: "Entwurf", detail: "", className: "text-white/40" };
    const date = post.published_at ? new Date(post.published_at) : null;
    if (date && !Number.isNaN(date.getTime()) && date.getTime() > Date.now()) {
      return { key: "scheduled", label: "Geplant", detail: `Wird ${formatTimeUntil(date)} veröffentlicht`, className: "text-[#29B6E8]" };
    }
    return { key: "published", label: "Veröffentlicht", detail: "", className: "text-[#10B981]" };
  };
  const categoryOptions = useMemo(() => {
    const rows = (meta.categories || []).map((item) => [item.k, item.l || item.k]);
    const known = new Set(rows.map(([key]) => key));
    list.forEach((item) => {
      if (item.category && !known.has(item.category)) rows.push([item.category, item.category]);
    });
    return rows;
  }, [list, meta.categories]);
  const visibilityOptions = useMemo(() => {
    const rows = (meta.visibilities || []).map((item) => [item.k, item.l || item.k]);
    const known = new Set(rows.map(([key]) => key));
    list.forEach((item) => {
      if (item.visibility && !known.has(item.visibility)) rows.push([item.visibility, item.visibility]);
    });
    return rows;
  }, [list, meta.visibilities]);
  const filteredList = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return list.filter((item) => {
      const state = publicationState(item);
      if (statusFilter && state.key !== statusFilter) return false;
      if (categoryFilter && item.category !== categoryFilter) return false;
      if (visibilityFilter && item.visibility !== visibilityFilter) return false;
      if (!needle) return true;
      return [
        item.title,
        item.slug,
        item.excerpt,
        item.category,
        item.visibility,
        state.label,
      ].filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }, [categoryFilter, list, query, statusFilter, visibilityFilter]);

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">VEREINS-CMS</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">News</h1>
        </div>
        <Link to="/admin/news/new" data-testid="news-new" className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider text-xs rounded-sm hover:bg-[#1E95C2] transition">
          <Plus className="w-3.5 h-3.5" /> Neuer Beitrag
        </Link>
      </div>

      {list.length > 0 && (
        <div className="mb-4 rounded-sm border border-white/10 bg-[#121212] p-3">
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(16rem,1fr)_10rem_12rem_12rem_auto]">
            <label className="relative block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Titel, Slug, Teaser oder Kategorie suchen"
                data-testid="news-admin-search"
                className="w-full rounded-sm border border-white/10 bg-[#0A0A0A] py-2 pl-9 pr-3 text-sm focus:border-[#29B6E8] focus:outline-none"
              />
            </label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} data-testid="news-admin-status-filter" className="rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm">
              <option value="">Alle Status</option>
              <option value="published">Veröffentlicht</option>
              <option value="scheduled">Geplant</option>
              <option value="draft">Entwurf</option>
            </select>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} data-testid="news-admin-category-filter" className="rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm">
              <option value="">Alle Kategorien</option>
              {categoryOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <select value={visibilityFilter} onChange={(e) => setVisibilityFilter(e.target.value)} data-testid="news-admin-visibility-filter" className="rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm">
              <option value="">Alle Sichtbarkeiten</option>
              {visibilityOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <button
              type="button"
              onClick={() => exportNewsCsv(filteredList.map((item) => {
                const state = publicationState(item);
                return {
                  ...item,
                  status_label: state.label,
                  date_label: new Date(item.published_at || item.created_at).toLocaleDateString("de-DE"),
                };
              }))}
              disabled={filteredList.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-sm border border-white/15 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/65 hover:border-[#29B6E8]/45 hover:text-white disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
          </div>
          <div className="mt-2 text-xs text-white/45">{filteredList.length} / {list.length} Beiträge sichtbar</div>
        </div>
      )}

      {list.length === 0 ? (
        <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
          <Newspaper className="w-10 h-10 mx-auto opacity-40 mb-3" />
          <div className="font-heading font-bold">Noch keine News-Beiträge</div>
        </div>
      ) : (
        <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
                <tr>
                  <th className="text-left px-4 py-3">Titel</th>
                  <th className="text-left px-4 py-3">Kategorie</th>
                  <th className="text-left px-4 py-3">Sichtbarkeit</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Datum</th>
                  <th className="text-center px-4 py-3">Aktion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredList.map((n) => {
                  const state = publicationState(n);
                  return (
                  <tr key={n.id}>
                    <td className="px-4 py-3">
                      <div className="font-bold text-white flex items-center gap-1.5">
                        {n.pinned && <Pin className="w-3 h-3 text-[#FFD700]" />}
                        {n.title}
                      </div>
                      <div className="text-[11px] text-white/50">/{n.slug}</div>
                    </td>
                    <td className="px-4 py-3 text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{newsCategoryLabel(n.category)}</td>
                    <td className="px-4 py-3 text-[10px] uppercase tracking-widest text-white/60 font-bold">{n.visibility}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className={`${state.className} font-bold uppercase`}>{state.label}</span>
                      {state.detail && <div className="mt-0.5 text-[11px] normal-case text-white/45">{state.detail}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs text-white/55">{new Date(n.published_at || n.created_at).toLocaleDateString("de-DE")}</td>
                    <td className="px-4 py-3 text-center space-x-2 whitespace-nowrap">
                      <Link to={`/admin/news/${n.id}`} data-testid={`news-edit-${n.id}`} className="inline-flex text-xs font-bold uppercase px-3 py-1 rounded-sm border border-[#29B6E8]/40 text-[#29B6E8] hover:bg-[#29B6E8]/10">Bearbeiten</Link>
                      <button onClick={() => remove(n.id)} data-testid={`news-delete-${n.id}`} className="text-xs font-bold uppercase px-3 py-1 rounded-sm border border-[#FF3B30]/40 text-[#FF3B30] hover:bg-[#FF3B30]/10 inline-flex items-center gap-1">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                  );
                })}
                {filteredList.length === 0 && (
                  <tr>
                    <td colSpan="6" className="px-4 py-10 text-center text-sm text-white/40">Keine News für diesen Filter.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
