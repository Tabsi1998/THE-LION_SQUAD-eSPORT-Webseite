import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, formatRequestError } from "@/lib/api";
import { formatTimeUntil } from "@/lib/newsPublication";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminFormPage, FormActions, FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, FieldLabel, SelectField, TextField } from "@/components/tls/FormFields";
import { DiscordPreview } from "@/components/tls/DiscordPreview";
import { SharePreviewToggle } from "@/components/tls/SharePreviewToggle";
import { EditorialChecklist } from "@/components/tls/EditorialChecklist";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { MarkdownEditor } from "@/components/tls/MarkdownEditor";
import { SeoPreviewPanel } from "@/components/tls/SeoPreviewPanel";
import { SkeletonDetailHeader, SkeletonLines } from "@/components/tls/Skeleton";
import { appendEmbedToken } from "@/components/tls/RichContent";
import { toDateTimeLocalInput } from "@/lib/datetime";
import { buildDirtyPayload, hasPayloadChanges } from "@/lib/dirtyPayload";
import { toast } from "sonner";
import { AtSign, Flag, Search, X } from "lucide-react";

// Beitrag anlegen und bearbeiten als eigene Seite (#434) - vorher ein 1024-px-Fenster über der
// Liste. Links Titel, Text, Bild, Personen und Verknüpfungen, Checkliste und SEO-Vorschau; rechts
// Veröffentlichung, Discord- und Teilen-Vorschau.
export default function AdminNewsEditPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const [post, setPost] = useState(isNew ? {} : null);
  const [missing, setMissing] = useState(false);
  const [meta, setMeta] = useState({ categories: [], visibilities: [] });

  useEffect(() => {
    api.get("/news-meta").then(({ data }) => setMeta(data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (isNew) {
      setPost({});
      setMissing(false);
      return undefined;
    }
    let cancelled = false;
    setPost(null);
    setMissing(false);
    // Dieselben Daten wie die Liste (inkl. Verknüpfungen und Newsletter-Stand).
    api.get("/admin/news").then(({ data }) => {
      if (cancelled) return;
      const found = (data || []).find((item) => item.id === id);
      if (found) setPost(found);
      else setMissing(true);
    }).catch(() => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
  }, [id, isNew]);

  if (missing) {
    return (
      <AdminLayout>
        <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50" data-testid="news-missing">
          <div className="font-heading font-bold text-white">Beitrag nicht gefunden</div>
          <p className="mt-2 text-sm">Vielleicht wurde er gelöscht. <Link to="/admin/news" className="text-[#29B6E8] hover:underline">Zurück zur Liste</Link></p>
        </div>
      </AdminLayout>
    );
  }
  if (!post) {
    return (
      <AdminLayout>
        <div className="max-w-3xl"><SkeletonDetailHeader label="Lade Beitrag" /><SkeletonLines lines={8} className="mt-8" label="Lade Beitrag" /></div>
      </AdminLayout>
    );
  }
  return (
    <AdminLayout>
      <NewsForm key={post.id || "new"} post={post} meta={meta} onDone={() => navigate("/admin/news")} />
    </AdminLayout>
  );
}

function NewsForm({ post, meta, onDone }) {
  const isNew = !post?.id;
  const formFromPost = (source = {}) => ({
    title: source.title || "",
    slug: source.slug || "",
    excerpt: source.excerpt || "",
    content: source.content || "",
    banner_url: source.banner_url || "",
    video_url: source.video_url || "",
    category: source.category || "club",
    visibility: source.visibility || "public",
    published: source.published ?? true,
    pinned: source.pinned ?? false,
    published_at: toDateTimeLocalInput(source.published_at),
    discord_skip: source.discord_skip ?? false,
    share_preview: source.share_preview ?? false,
  });
  const [form, setForm] = useState(() => formFromPost(post));
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
      if (t.status === "fulfilled") setTournaments(t.value.data || []);
      if (e.status === "fulfilled") setEvents(e.value.data || []);
      if (f.status === "fulfilled") setF1Challenges(f.value.data || []);
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
  const safeMentionLabel = (user) => userLabel(user).replace(/[[\]\n\r]/g, "").trim() || user.username;
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
    .replace(/[̀-ͯ]/g, "")
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
      onDone();
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
    <AdminFormPage
      eyebrow="News"
      title={isNew ? "Neuer Beitrag" : "Beitrag bearbeiten"}
      intro={isNew ? "Titel, Teaser und Text — der Rest ist Feinschliff. Ohne Datum erscheint der Beitrag sofort nach dem Speichern, wenn „Veröffentlicht“ gesetzt ist." : post.title}
      backTo="/admin/news"
      backLabel="News"
      onSubmit={submit}
      testId="news-form"
      aside={(
        <>
          <FormSection title="Veröffentlichung">
            <SelectField label="Kategorie" value={form.category} onChange={(v) => set("category", v)} options={meta.categories || []} testId="news-category" />
            <SelectField label="Sichtbarkeit" value={form.visibility} onChange={(v) => set("visibility", v)} options={meta.visibilities || []} testId="news-visibility" />
            <TextField label="Veröffentlichungsdatum (optional, sonst jetzt)" type="datetime-local" value={form.published_at || ""} onChange={(v) => set("published_at", v)} testId="news-published-at" hint={plannedDetail || undefined} />
            <CheckField label="Veröffentlicht" checked={form.published} onChange={(v) => set("published", v)} testId="news-published" />
            <CheckField label="Anpinnen" hint="Bleibt oben in der News-Liste und auf der Startseite." checked={form.pinned} onChange={(v) => set("pinned", v)} testId="news-pinned" accent="#FFD700" />
          </FormSection>
          <DiscordPreview kind="news" item={form} skip={form.discord_skip} onSkipChange={(value) => set("discord_skip", value)} />
          <SharePreviewToggle visibility={form.visibility} checked={form.share_preview} onChange={(value) => set("share_preview", value)} />
        </>
      )}
      actions={<FormActions saving={saving} submitTestId="news-save" cancelTo="/admin/news" />}
    >
      <FormSection title="Der Beitrag">
        <FormGrid>
          <TextField label="Titel" value={form.title} onChange={(v) => { set("title", v); if (isNew && !form.slug) set("slug", slugFrom(v)); }} testId="news-title" required />
          <TextField label="Slug" value={form.slug} onChange={(v) => set("slug", slugFrom(v))} placeholder="kebab-case" testId="news-slug" required />
        </FormGrid>
        <TextField label="Kurzbeschreibung" value={form.excerpt} onChange={(v) => set("excerpt", v)} testId="news-excerpt" />
        <FieldLabel label="Inhalt" required>
          <MarkdownEditor
            value={form.content}
            onChange={(v) => set("content", v)}
            rows={14}
            required
            testId="news-content"
            helperText="Markdown plus Einbettungen: [[fastlap:slug]], [[tournament:slug]], [[event:slug]]. HTML wird nicht roh gerendert."
          />
        </FieldLabel>
        <FieldLabel label="Banner">
          <ImageUpload value={form.banner_url} onChange={(v) => set("banner_url", v)} testId="news-banner" variant="wide" allowLibrary />
        </FieldLabel>
        <TextField label="Video (YouTube-Link)" value={form.video_url} onChange={(v) => set("video_url", v)} placeholder="https://www.youtube.com/watch?v=…" testId="news-video-url" hint="Steht oben auf der News-Seite als Player – erst nach Zustimmung zu externen Medien; statt des Banners." />
      </FormSection>

      <FormSection title="Personen und Verknüpfungen" hint="Ein Klick fügt einen Profil-Link bzw. eine Karte in den Text ein und merkt die Verknüpfung für die News-Seite vor.">
        <FieldLabel label="Benutzer markieren" hint="Angezeigt werden aktive öffentliche Profile.">
          <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35" />
              <input
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                placeholder="Username oder Anzeigename suchen"
                data-testid="news-mention-search"
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
              <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2">
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
          </div>
        </FieldLabel>
        {(events.length > 0 || tournaments.length > 0 || f1Challenges.length > 0) && (
          <FormGrid cols={3}>
            {events.length > 0 && (
              <FieldLabel label="Verknüpfte Events">
                <MultiSelect options={events} valueKey="id" labelKey="name" selected={linkedE} onChange={setLinkedE} onEmbed={(item) => insertEmbed("event", item)} />
              </FieldLabel>
            )}
            {tournaments.length > 0 && (
              <FieldLabel label="Verknüpfte Turniere">
                <MultiSelect options={tournaments} valueKey="id" labelKey="title" selected={linkedT} onChange={setLinkedT} onEmbed={(item) => insertEmbed("tournament", item)} />
              </FieldLabel>
            )}
            {f1Challenges.length > 0 && (
              <FieldLabel label="Verknüpfte Fast-Lap Challenges">
                <MultiSelect options={f1Challenges} valueKey="id" labelKey="title" selected={linkedF} onChange={setLinkedF} icon={Flag} onEmbed={(item) => insertEmbed("fastlap", item)} />
              </FieldLabel>
            )}
          </FormGrid>
        )}
      </FormSection>

      <EditorialChecklist items={editorialChecklist} />
      <SeoPreviewPanel path={publicPath} fallback={seoFallback} />
    </AdminFormPage>
  );
}

function MultiSelect({ options, valueKey, labelKey, selected, onChange, icon: Icon, onEmbed }) {
  const toggle = (v) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div className="border border-white/10 rounded-sm bg-[#0A0A0A] p-2 max-h-40 overflow-y-auto space-y-1">
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
