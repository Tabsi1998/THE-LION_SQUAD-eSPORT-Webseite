import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { EditorialChecklist } from "@/components/tls/EditorialChecklist";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { MarkdownEditor } from "@/components/tls/MarkdownEditor";
import { SeoPreviewPanel } from "@/components/tls/SeoPreviewPanel";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { appendEmbedToken } from "@/components/tls/RichContent";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toDateTimeLocalInput } from "@/lib/datetime";
import { buildDirtyPayload, hasPayloadChanges } from "@/lib/dirtyPayload";
import { toast } from "sonner";
import { AtSign, Download, Flag, Plus, Pin, Trash2, Save, Search, X, Newspaper } from "lucide-react";

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

export default function AdminNewsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [list, setList] = useState([]);
  const [meta, setMeta] = useState({ categories: [], visibilities: [] });
  const [editing, setEditing] = useState(null);
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
    if (!editId || editing || list.length === 0) return;
    const post = list.find((item) => item.id === editId);
    if (post) setEditing(post);
  }, [editing, list, searchParams]);

  const closeEditor = () => {
    setEditing(null);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      params.delete("edit");
      return params;
    }, { replace: true });
  };

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
        <button onClick={() => { closeEditor(); setEditing({}); }} data-testid="news-new" className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider text-xs rounded-sm hover:bg-[#1E95C2] transition">
          <Plus className="w-3.5 h-3.5" /> Neuer Beitrag
        </button>
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
                    <td className="px-4 py-3 text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{n.category}</td>
                    <td className="px-4 py-3 text-[10px] uppercase tracking-widest text-white/60 font-bold">{n.visibility}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className={`${state.className} font-bold uppercase`}>{state.label}</span>
                      {state.detail && <div className="mt-0.5 text-[11px] normal-case text-white/45">{state.detail}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs text-white/55">{new Date(n.published_at || n.created_at).toLocaleDateString("de-DE")}</td>
                    <td className="px-4 py-3 text-center space-x-2 whitespace-nowrap">
                      <button onClick={() => setEditing(n)} data-testid={`news-edit-${n.id}`} className="text-xs font-bold uppercase px-3 py-1 rounded-sm border border-[#29B6E8]/40 text-[#29B6E8] hover:bg-[#29B6E8]/10">Bearbeiten</button>
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

      {editing && <NewsModal post={editing} meta={meta} onClose={closeEditor} onSaved={load} />}
    </AdminLayout>
  );
}

function NewsModal({ post, meta, onClose, onSaved }) {
  const isNew = !post?.id;
  const formFromPost = (source = {}) => ({
    title: source.title || "",
    slug: source.slug || "",
    excerpt: source.excerpt || "",
    content: source.content || "",
    banner_url: source.banner_url || "",
    category: source.category || "club",
    visibility: source.visibility || "public",
    published: source.published ?? true,
    pinned: source.pinned ?? false,
    published_at: toDateTimeLocalInput(source.published_at),
  });
  const [form, setForm] = useState({
    ...formFromPost(post),
  });
  const [tournaments, setTournaments] = useState([]);
  const [events, setEvents] = useState([]);
  const [f1Challenges, setF1Challenges] = useState([]);
  const [users, setUsers] = useState([]);
  const [userQuery, setUserQuery] = useState("");
  const [linkedT, setLinkedT] = useState(post.linked_tournament_ids || []);
  const [linkedE, setLinkedE] = useState(post.linked_event_ids || []);
  const [linkedF, setLinkedF] = useState(post.linked_f1_challenge_ids || []);
  const [mentionedUserIds, setMentionedUserIds] = useState(post.mentioned_user_ids || []);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.allSettled([
      api.get("/tournaments?include_drafts=true"),
      api.get("/events?include_drafts=true"),
      api.get("/f1/challenges?include_drafts=true"),
      api.get("/users"),
    ]).then(([t, e, f, u]) => {
      if (t.status === "fulfilled") setTournaments(t.value.data);
      if (e.status === "fulfilled") setEvents(e.value.data);
      if (f.status === "fulfilled") setF1Challenges(f.value.data);
      if (u.status === "fulfilled") setUsers(u.value.data || []);
    });
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const insertEmbed = (kind, item) => {
    setForm((f) => ({ ...f, content: appendEmbedToken(f.content, kind, item) }));
    if (kind === "event") setLinkedE((ids) => (ids.includes(item.id) ? ids : [...ids, item.id]));
    if (kind === "tournament") setLinkedT((ids) => (ids.includes(item.id) ? ids : [...ids, item.id]));
    if (kind === "fastlap") setLinkedF((ids) => (ids.includes(item.id) ? ids : [...ids, item.id]));
  };
  const userLabel = (user) => user?.display_name || user?.username || "Benutzer";
  const safeMentionLabel = (user) => userLabel(user).replace(/[\[\]\n\r]/g, "").trim() || user.username;
  const insertMention = (user) => {
    const mention = `[@${safeMentionLabel(user)}](/u/${encodeURIComponent(user.username)})`;
    setForm((f) => {
      const prefix = String(f.content || "").trimEnd();
      return { ...f, content: `${prefix}${prefix ? "\n\n" : ""}${mention}` };
    });
    setMentionedUserIds((ids) => (ids.includes(user.id) ? ids : [...ids, user.id]));
    setUserQuery("");
  };
  const removeMention = (userId) => setMentionedUserIds((ids) => ids.filter((id) => id !== userId));
  const slugFrom = (txt) => (txt || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  const normalizePayload = (payload) => {
    const next = { ...payload };
    if (next.published_at) {
      const d = new Date(next.published_at);
      if (!isNaN(d.getTime())) next.published_at = d.toISOString();
    } else {
      delete next.published_at;
    }
    return next;
  };

  const submit = async (ev) => {
    ev.preventDefault();
    setSaving(true);
    try {
      const payload = normalizePayload({ ...form, linked_tournament_ids: linkedT, linked_event_ids: linkedE, linked_f1_challenge_ids: linkedF, mentioned_user_ids: mentionedUserIds });
      if (isNew) await api.post("/news", payload);
      else {
        const originalPayload = normalizePayload({
          ...formFromPost(post),
          linked_tournament_ids: post.linked_tournament_ids || [],
          linked_event_ids: post.linked_event_ids || [],
          linked_f1_challenge_ids: post.linked_f1_challenge_ids || [],
          mentioned_user_ids: post.mentioned_user_ids || [],
        });
        const patch = buildDirtyPayload(payload, originalPayload);
        if (!hasPayloadChanges(patch)) {
          toast.info("Keine Änderungen zum Speichern.");
          setSaving(false);
          return;
        }
        await api.patch(`/news/${post.id}`, patch);
      }
      toast.success("Gespeichert.");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(formatRequestError(err, "Beitrag konnte nicht gespeichert werden.", { slug: form.slug, title: form.title }));
    }
    setSaving(false);
  };

  const selectedUsers = mentionedUserIds.map((id) => users.find((user) => user.id === id)).filter(Boolean);
  const userNeedle = userQuery.trim().toLowerCase();
  const userMatches = userNeedle.length >= 2
    ? users
      .filter((user) => user.is_active !== false && user.is_banned !== true && user.privacy_public_profile !== false)
      .filter((user) => !mentionedUserIds.includes(user.id))
      .filter((user) => `${user.username || ""} ${user.display_name || ""} ${user.email || ""}`.toLowerCase().includes(userNeedle))
      .slice(0, 8)
    : [];
  const plannedDate = form.published && form.published_at ? new Date(form.published_at) : null;
  const plannedDetail = plannedDate && !Number.isNaN(plannedDate.getTime()) && plannedDate.getTime() > Date.now()
    ? `Dieser Beitrag ist geplant und wird ${formatTimeUntil(plannedDate)} öffentlich angezeigt.`
    : "";
  const origin = typeof window !== "undefined" ? window.location.origin : "https://lionsquad.at";
  const publicPath = form.slug ? `/news/${form.slug}` : "";
  const seoIsIndexable = Boolean(form.published && form.visibility === "public");
  const seoFallback = {
    title: form.title || "News-Beitrag",
    description: form.excerpt || "Kurzbeschreibung fehlt noch.",
    image: form.banner_url,
    canonical: publicPath ? `${origin}${publicPath}` : "",
    url: publicPath ? `${origin}${publicPath}` : "",
    robots: seoIsIndexable ? "index, follow" : "noindex, follow",
    published: seoIsIndexable,
  };
  const linkedContentCount = linkedT.length + linkedE.length + linkedF.length + mentionedUserIds.length;
  const hasEmbedToken = /\[\[(fastlap|tournament|event):[^\]]+\]\]/i.test(form.content || "");
  const newsletterDone = Boolean(post.newsletter_sent_at);
  const editorialChecklist = [
    { label: "Titel", done: Boolean(form.title.trim()), description: form.title.trim() ? "Sauber gesetzt." : "Pflichtfeld für Listen, SEO und Social Cards." },
    { label: "Teaser", done: Boolean(form.excerpt.trim()), description: form.excerpt.trim() ? "Kurzbeschreibung vorhanden." : "Hilft auf News-Liste, Google und beim Teilen." },
    { label: "Banner", done: Boolean(form.banner_url), description: form.banner_url ? "Social-Bild vorhanden." : "Eigenes Bild statt generischem Fallback wählen." },
    { label: "Inhalt", done: Boolean(form.content.trim()), description: form.content.trim() ? "Beitragstext vorhanden." : "Markdown-Inhalt fehlt noch." },
    { label: "Sichtbarkeit", done: Boolean(form.visibility && form.published), description: seoIsIndexable ? "Öffentlich indexierbar." : "Entwurf, privat oder noindex." },
    { label: "Embeds", done: linkedContentCount > 0 || hasEmbedToken, tone: linkedContentCount > 0 || hasEmbedToken ? undefined : "note", description: linkedContentCount > 0 || hasEmbedToken ? `${linkedContentCount || 1} Verknüpfung(en) erkannt.` : "Optional: Turnier, Event, Fast-Lap oder Personen verknüpfen." },
    { label: "SEO", done: Boolean(form.slug && form.excerpt && form.banner_url), description: "Titel, Teaser, Canonical und Social Preview prüfen." },
    { label: "Newsletter/Discord", done: newsletterDone, tone: newsletterDone ? undefined : "note", description: newsletterDone ? "Newsletter wurde bereits versendet." : "Nach dem Speichern Versand und Discord-Post kontrollieren." },
  ];

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 overflow-y-auto p-2 sm:p-4">
      <form onSubmit={submit} className="w-full max-w-5xl mx-auto my-2 sm:my-6 bg-[#121212] border border-white/10 rounded-sm">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="font-heading font-black uppercase">{isNew ? "Neuer Beitrag" : "Beitrag bearbeiten"}</h2>
          <button type="button" onClick={onClose} className="text-white/60 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 sm:p-5 space-y-4">
          <Field label="Titel"><Input value={form.title} onChange={(v) => { set("title", v); if (isNew && !form.slug) set("slug", slugFrom(v)); }} testId="news-title" required /></Field>
          <Field label="Slug"><Input value={form.slug} onChange={(v) => set("slug", slugFrom(v))} placeholder="kebab-case" testId="news-slug" required /></Field>
          <Field label="Kurzbeschreibung"><Input value={form.excerpt} onChange={(v) => set("excerpt", v)} testId="news-excerpt" /></Field>
          <Field label="Inhalt">
            <MarkdownEditor
              value={form.content}
              onChange={(v) => set("content", v)}
              rows={12}
              required
              testId="news-content"
              helperText="Markdown plus Einbettungen: [[fastlap:slug]], [[tournament:slug]], [[event:slug]]. HTML wird nicht roh gerendert."
            />
          </Field>
          <Field label="Benutzer markieren">
            <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3 space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35" />
                <input
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  placeholder="Username oder Anzeigename suchen"
                  className="w-full bg-[#121212] border border-white/10 pl-9 pr-3 py-2 rounded-sm text-sm focus:outline-none focus:border-[#29B6E8]"
                />
              </div>
              {selectedUsers.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedUsers.map((user) => (
                    <span key={user.id} className="inline-flex items-center gap-1.5 px-2 py-1 border border-[#29B6E8]/30 text-[#29B6E8] rounded-sm text-xs">
                      <AtSign className="w-3 h-3" /> {userLabel(user)}
                      <button type="button" onClick={() => removeMention(user.id)} className="text-white/45 hover:text-[#FF3B30]" aria-label={`${userLabel(user)} entfernen`}>
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {userMatches.length > 0 && (
                <div className="grid sm:grid-cols-2 gap-2">
                  {userMatches.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => insertMention(user)}
                      className="min-w-0 flex items-center gap-2 border border-white/10 hover:border-[#29B6E8]/50 rounded-sm px-3 py-2 text-left text-sm"
                    >
                      <AtSign className="w-4 h-4 text-[#29B6E8] shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate text-white">{userLabel(user)}</span>
                        <span className="block truncate text-xs text-white/40">@{user.username}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-white/40">Ein Klick fügt einen Profil-Link in den Text ein und merkt die Person für die News-Seite vor. Angezeigt werden aktive öffentliche Profile.</p>
            </div>
          </Field>
          <Field label="Banner"><ImageUpload value={form.banner_url} onChange={(v) => set("banner_url", v)} testId="news-banner" variant="wide" allowLibrary /></Field>
          <EditorialChecklist items={editorialChecklist} />
          <SeoPreviewPanel path={publicPath} fallback={seoFallback} />

          <Field label="Veröffentlichungsdatum (optional, sonst jetzt)">
            <input
              type="datetime-local"
              value={form.published_at || ""}
              onChange={(e) => set("published_at", e.target.value)}
              data-testid="news-published-at"
              className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"
            />
            {plannedDetail && <div className="mt-1 text-xs text-[#29B6E8]">{plannedDetail}</div>}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Kategorie">
              <select value={form.category} onChange={(e) => set("category", e.target.value)} data-testid="news-category" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
                {meta.categories.map((c) => <option key={c.k} value={c.k}>{c.l}</option>)}
              </select>
            </Field>
            <Field label="Sichtbarkeit">
              <select value={form.visibility} onChange={(e) => set("visibility", e.target.value)} data-testid="news-visibility" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
                {meta.visibilities.map((v) => <option key={v.k} value={v.k}>{v.l}</option>)}
              </select>
            </Field>
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.published} onChange={(e) => set("published", e.target.checked)} className="accent-[#29B6E8]" />
              Veröffentlicht
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.pinned} onChange={(e) => set("pinned", e.target.checked)} data-testid="news-pinned" className="accent-[#FFD700]" />
              <Pin className="w-3 h-3 text-[#FFD700]" /> Anpinnen
            </label>
          </div>

          {events.length > 0 && (
            <Field label="Verknüpfte Events">
              <MultiSelect options={events} valueKey="id" labelKey="name" selected={linkedE} onChange={setLinkedE} onEmbed={(item) => insertEmbed("event", item)} />
            </Field>
          )}
          {tournaments.length > 0 && (
            <Field label="Verknüpfte Turniere">
              <MultiSelect options={tournaments} valueKey="id" labelKey="title" selected={linkedT} onChange={setLinkedT} onEmbed={(item) => insertEmbed("tournament", item)} />
            </Field>
          )}
          {f1Challenges.length > 0 && (
            <Field label="Verknüpfte Fast-Lap Challenges">
              <MultiSelect options={f1Challenges} valueKey="id" labelKey="title" selected={linkedF} onChange={setLinkedF} icon={Flag} onEmbed={(item) => insertEmbed("fastlap", item)} />
            </Field>
          )}
        </div>
        <div className="flex gap-3 p-5 border-t border-white/10">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-white/10 text-white/60 hover:text-white text-xs uppercase tracking-wider font-bold rounded-sm">Abbrechen</button>
          <button type="submit" disabled={saving} data-testid="news-save" className="ml-auto inline-flex items-center gap-2 px-5 py-2 bg-[#29B6E8] text-black text-xs uppercase tracking-wider font-bold rounded-sm hover:bg-[#1E95C2] disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> {saving ? "Speichere…" : "Speichern"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function formatTimeUntil(date) {
  const ms = Math.max(0, date.getTime() - Date.now());
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `in ${minutes} Minute${minutes === 1 ? "" : "n"}`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `in ${hours} Stunde${hours === 1 ? "" : "n"}`;
  const days = Math.ceil(hours / 24);
  return `in ${days} Tag${days === 1 ? "" : "en"}`;
}
function Input({ value, onChange, placeholder, testId, required }) {
  return <input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-testid={testId} required={required} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />;
}
function MultiSelect({ options, valueKey, labelKey, selected, onChange, icon: Icon, onEmbed }) {
  const toggle = (v) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div className="border border-white/10 rounded-sm bg-[#0A0A0A] p-2 max-h-32 overflow-y-auto space-y-1">
      {options.map((o) => (
        <div key={o[valueKey]} className="flex items-center gap-2 text-sm hover:bg-white/5 px-2 py-1 rounded-sm">
          <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
            <input type="checkbox" checked={selected.includes(o[valueKey])} onChange={() => toggle(o[valueKey])} className="accent-[#29B6E8]" />
            {Icon && <Icon className="w-3 h-3 text-[#29B6E8] shrink-0" />}
            <span className="truncate">{o[labelKey]}</span>
          </label>
          {onEmbed && (
            <button type="button" onClick={() => onEmbed(o)} className="shrink-0 text-[10px] uppercase tracking-wider font-bold text-[#29B6E8] hover:text-white">
              Einbetten
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
