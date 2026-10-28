import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, formatRequestError } from "@/lib/api";
import { PUBLISH_MODES, formatTimeUntil, initialPublishMode, needsPublishQuestion, publishFields, publishQuestion } from "@/lib/newsPublication";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminFormPage, FormActions, FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, FieldLabel, SelectField, TextField } from "@/components/tls/FormFields";
import { DiscordPreview } from "@/components/tls/DiscordPreview";
import { DistributeBox } from "@/components/tls/DistributeBox";
import { SharePreviewToggle } from "@/components/tls/SharePreviewToggle";
import { EditorialChecklist } from "@/components/tls/EditorialChecklist";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { MarkdownEditor } from "@/components/tls/MarkdownEditor";
import { SeoPreviewPanel } from "@/components/tls/SeoPreviewPanel";
import { SkeletonDetailHeader, SkeletonLines } from "@/components/tls/Skeleton";
import { appendEmbedToken } from "@/components/tls/RichContent";
import { PersonPicker } from "@/components/tls/PersonPicker";
import { toDateTimeLocalInput } from "@/lib/datetime";
import { viennaDateTime } from "@/lib/vienna";
import { buildDirtyPayload, hasPayloadChanges } from "@/lib/dirtyPayload";
import { toast } from "sonner";
import { AtSign, ExternalLink, Flag, Search, X } from "lucide-react";

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

  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (isNew) {
      setPost({});
      setMissing(false);
      return undefined;
    }
    let cancelled = false;
    setPost(null);
    setMissing(false);
    // Der Beitrag einzeln (#2122 NW4) - inkl. Verknüpfungen und Newsletter-Stand; die Liste hört bei 500 auf.
    api.get(`/admin/news/${encodeURIComponent(id)}`).then(({ data }) => {
      if (cancelled) return;
      if (data?.id) setPost(data);
      else setMissing(true);
    }).catch(() => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
  }, [id, isNew, version]);

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
      <NewsForm key={`${post.id || "new"}-${version}`} post={post} meta={meta} onDone={() => navigate("/admin/news")} onReload={() => setVersion((value) => value + 1)} />
    </AdminLayout>
  );
}

function NewsForm({ post, meta, onDone, onReload }) {
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
    // Neu ist ein Entwurf (#2122 NW1) - veröffentlicht wird bewusst über „Wann erscheint der Beitrag?“.
    published: source.published ?? false,
    pinned: source.pinned ?? false,
    published_at: toDateTimeLocalInput(source.published_at),
    discord_skip: source.discord_skip ?? false,
    share_preview: source.share_preview ?? false,
  });
  const [form, setForm] = useState(() => formFromPost(post));
  const [initialMode] = useState(() => initialPublishMode(post));
  const [mode, setMode] = useState(initialMode);
  const [scheduleAt, setScheduleAt] = useState(() => (initialMode === "scheduled" ? toDateTimeLocalInput(post.published_at) : ""));
  const confirm = useConfirm();
  const [tournaments, setTournaments] = useState([]);
  const [events, setEvents] = useState([]);
  const [f1Challenges, setF1Challenges] = useState([]);
  // Markierte Personen (#1354): Treffer kommen aus der Erwähnungs-Suche (Name, Benutzername, Bild - öffentliche
  // Profile), nicht aus der ganzen Kontoliste. Bekannte Namen für die Schilder: aus dem Beitrag und aus dieser Sitzung.
  const [knownUsers, setKnownUsers] = useState(() => Object.fromEntries((post.mentioned_users || []).map((user) => [user.id, user])));
  const [userQuery, setUserQuery] = useState("");
  const [userHits, setUserHits] = useState([]);
  const [linkedT, setLinkedT] = useState(post.linked_tournament_ids || []);
  const [linkedE, setLinkedE] = useState(post.linked_event_ids || []);
  const [linkedF, setLinkedF] = useState(post.linked_f1_challenge_ids || []);
  const [mentionedUserIds, setMentionedUserIds] = useState(post.mentioned_user_ids || []);
  // Autor (#2122 NW3): änderbar über die Personensuche; ohne neue Wahl bleibt der bisherige.
  const [author, setAuthor] = useState(() => (post.author_id ? { id: post.author_id, name: post.author_name || "Unbekannt" } : null));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.allSettled([
      api.get("/tournaments?include_drafts=true"),
      api.get("/events?include_drafts=true"),
      api.get("/f1/challenges?include_drafts=true"),
    ]).then(([t, e, f]) => {
      if (t.status === "fulfilled") setTournaments(t.value.data || []);
      if (e.status === "fulfilled") setEvents(e.value.data || []);
      if (f.status === "fulfilled") setF1Challenges(f.value.data || []);
    });
  }, []);

  useEffect(() => {
    const needle = userQuery.trim();
    if (needle.length < 2) {
      setUserHits([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.get("/users/mention-search", { params: { q: needle } })
        .then(({ data }) => { if (!cancelled) setUserHits(Array.isArray(data) ? data : []); })
        .catch(() => { if (!cancelled) setUserHits([]); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [userQuery]);

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
    setKnownUsers((current) => ({ ...current, [user.id]: user }));
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

  // Die Rückfrage vor dem Veröffentlichen (#2122 NW1): wie viele den Newsletter bekämen und ob Discord meldet - beides
  // nach bestem Wissen; fehlt ein Recht oder geht ein Abruf schief, steht der allgemeine Satz da.
  const askBeforePublishing = async () => {
    const [audience, discord] = await Promise.allSettled([
      api.get("/settings/newsletter/audience", { params: { kind: "news", visibility: form.visibility } }),
      api.post("/settings/discord/preview", { kind: "news", item: { ...form, discord_skip: !!form.discord_skip } }, { skipInvalidation: true }),
    ]);
    const when = mode === "scheduled" ? new Date(scheduleAt) : null;
    return confirm(publishQuestion({
      mode,
      whenText: when && !Number.isNaN(when.getTime()) ? viennaDateTime(when, { dateStyle: "medium", timeStyle: "short" }) : "",
      audience: audience.status === "fulfilled" && audience.value?.data && typeof audience.value.data === "object" ? audience.value.data : null,
      sentAt: post.newsletter_sent_at || "",
      sentText: post.newsletter_sent_at ? viennaDateTime(post.newsletter_sent_at, { dateStyle: "medium" }) : "",
      discord: discord.status === "fulfilled" && typeof discord.value?.data?.would_send === "boolean" ? discord.value.data.would_send : null,
    }));
  };

  const submit = async (ev) => {
    ev.preventDefault();
    const timing = publishFields(mode, scheduleAt, initialMode, { published_at: form.published_at });
    if (timing.error) {
      toast.error(timing.error);
      return;
    }
    if (needsPublishQuestion(mode, initialMode) && !await askBeforePublishing()) return;
    setSaving(true);
    try {
      const payload = normalizePayload({ ...form, ...timing, linked_tournament_ids: linkedT, linked_event_ids: linkedE, linked_f1_challenge_ids: linkedF, mentioned_user_ids: mentionedUserIds });
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
        if (author?.id && author.id !== post.author_id) patch.author_id = author.id;
        if (!hasPayloadChanges(patch)) {
          toast.info("Keine Änderungen zum Speichern.");
          setSaving(false);
          return;
        }
        await api.patch(`/news/${post.id}`, patch);
      }
      toast.success(mode === initialMode ? "Gespeichert." : { draft: "Als Entwurf gespeichert.", now: "Veröffentlicht.", scheduled: "Geplant." }[mode]);
      onDone();
    } catch (err) {
      toast.error(formatRequestError(err, "Beitrag konnte nicht gespeichert werden.", { slug: form.slug, title: form.title }));
    }
    setSaving(false);
  };

  const restore = async () => {
    setSaving(true);
    try {
      await api.post(`/news/${post.id}/restore`);
      toast.success("Wiederhergestellt – als Entwurf.");
      onReload?.();
    } catch (err) {
      toast.error(formatRequestError(err, "Beitrag konnte nicht wiederhergestellt werden."));
    }
    setSaving(false);
  };

  const selectedUsers = mentionedUserIds.map((id) => knownUsers[id]).filter(Boolean);
  const userMatches = userHits.filter((user) => !mentionedUserIds.includes(user.id)).slice(0, 8);
  const plannedDate = mode === "scheduled" && scheduleAt ? new Date(scheduleAt) : null;
  const plannedDetail = plannedDate && !Number.isNaN(plannedDate.getTime())
    ? (plannedDate.getTime() > Date.now() ? `Erscheint ${formatTimeUntil(plannedDate)} von selbst – mit Newsletter und Discord.` : "Dieser Termin liegt in der Vergangenheit.")
    : "Wann soll der Beitrag erscheinen?";
  const willPublish = mode !== "draft";
  const origin = typeof window !== "undefined" ? window.location.origin : "https://lionsquad.at";
  const publicPath = form.slug ? `/news/${form.slug}` : "";
  const seoIsIndexable = Boolean(willPublish && form.visibility === "public");
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
    // Alltagssprache statt Fachbegriffen (#2122 NW5).
    { label: "Titel", done: Boolean(form.title.trim()), description: form.title.trim() ? "Sauber gesetzt." : "Pflicht – steht in Listen, bei Google und beim Teilen." },
    { label: "Kurzbeschreibung", done: Boolean(form.excerpt.trim()), description: form.excerpt.trim() ? "Kurzbeschreibung vorhanden." : "Hilft in der News-Liste, bei Google und beim Teilen." },
    { label: "Bild", done: Boolean(form.banner_url), description: form.banner_url ? "Bild für Liste und Teilen vorhanden." : "Ein eigenes Bild statt des Standardbilds wählen." },
    { label: "Text", done: Boolean(form.content.trim()), description: form.content.trim() ? "Beitragstext vorhanden." : "Der Text fehlt noch." },
    { label: "Sichtbarkeit", done: Boolean(form.visibility && willPublish), description: seoIsIndexable ? "Öffentlich – Suchmaschinen dürfen ihn finden." : "Entwurf oder nicht öffentlich – Suchmaschinen finden ihn nicht." },
    { label: "Verknüpfungen", done: linkedContentCount > 0 || hasEmbedToken, tone: linkedContentCount > 0 || hasEmbedToken ? undefined : "note", description: linkedContentCount > 0 || hasEmbedToken ? `${linkedContentCount || 1} Verknüpfung(en) erkannt.` : "Optional: Turnier, Event, Fast Lap oder Personen verknüpfen." },
    { label: "Google und Teilen", done: Boolean(form.slug && form.excerpt && form.banner_url), description: "Titel, Kurzbeschreibung und Bild prüfen – so erscheint der Beitrag bei Google und beim Teilen." },
    { label: "Newsletter/Discord", done: newsletterDone, tone: newsletterDone ? undefined : "note", description: newsletterDone ? "Newsletter wurde bereits versendet." : "Steht im Kasten „Verteilen“ – mit Empfängerzahl und „Jetzt senden“." },
  ];

  return (
    <AdminFormPage
      eyebrow="News"
      title={isNew ? "Neuer Beitrag" : "Beitrag bearbeiten"}
      intro={isNew ? "Titel, Kurzbeschreibung und Text – der Rest ist Feinschliff. Ein neuer Beitrag ist ein Entwurf, bis du „Jetzt veröffentlichen“ oder „Geplant“ wählst." : post.title}
      backTo="/admin/news"
      backLabel="News"
      onSubmit={submit}
      testId="news-form"
      headerExtra={!isNew && post.slug ? (
        // Vorschau (#2122 NW2): die echte Seite - mit Band „Noch nicht öffentlich“, solange Besucher sie nicht sehen.
        <Link to={`/news/${post.slug}`} target="_blank" rel="noreferrer" data-testid="news-preview-link" className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider font-bold text-white/60 hover:text-[#29B6E8] transition">
          Vorschau ansehen <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      ) : undefined}
      aside={(
        <>
          {post.withdrawn_at && (
            <div role="status" className="border border-[#FF6B6B]/40 bg-[#FF6B6B]/10 rounded-sm p-4 space-y-3" data-testid="news-withdrawn">
              <p className="text-sm text-white/85">
                <strong className="text-[#FF6B6B]">Zurückgezogen</strong> am {viennaDateTime(post.withdrawn_at, { dateStyle: "medium", timeStyle: "short" })}{post.withdrawn_by_name ? ` von ${post.withdrawn_by_name}` : ""}. Besucher sehen statt des Beitrags nur einen Hinweis.
              </p>
              <button type="button" onClick={restore} disabled={saving} data-testid="news-restore" className="tls-btn tls-btn--quiet px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">Wiederherstellen (als Entwurf)</button>
            </div>
          )}
          <FormSection title="Veröffentlichung">
            <SelectField label="Kategorie" value={form.category} onChange={(v) => set("category", v)} options={meta.categories || []} testId="news-category" />
            <SelectField label="Sichtbarkeit" value={form.visibility} onChange={(v) => set("visibility", v)} options={meta.visibilities || []} testId="news-visibility" />
            <PublishChoice mode={mode} initialMode={initialMode} onChange={setMode} />
            {mode === "scheduled" && (
              <TextField label="Termin" type="datetime-local" value={scheduleAt} onChange={setScheduleAt} testId="news-published-at" required hint={plannedDetail} />
            )}
            <CheckField label="Anpinnen" hint="Bleibt oben in der News-Liste und auf der Startseite." checked={form.pinned} onChange={(v) => set("pinned", v)} testId="news-pinned" accent="#FFD700" />
          </FormSection>
          <DistributeBox kind="news" itemId={post.id} title={post.title} visibility={form.visibility}>
            <DiscordPreview kind="news" item={form} skip={form.discord_skip} onSkipChange={(value) => set("discord_skip", value)} />
          </DistributeBox>
          <SharePreviewToggle visibility={form.visibility} checked={form.share_preview} onChange={(value) => set("share_preview", value)} />
          {!isNew && (
            <FormSection title="Autor und Verlauf" testId="news-history-section">
              <PersonPicker purpose="news_author" value={author} onChange={setAuthor} label="Autor" placeholder="Name tippen …" hint="Steht auf der News-Seite unter „Von“." testId="news-author" />
              {post.updated_at && (
                <p className="text-xs text-white/55" data-testid="news-last-change">
                  Zuletzt geändert {post.updated_by_name ? <>von <strong className="text-white/80">{post.updated_by_name}</strong> </> : ""}am {viennaDateTime(post.updated_at, { dateStyle: "medium", timeStyle: "short" })}.
                </p>
              )}
              <NewsHistory rows={post.history || []} />
            </FormSection>
          )}
        </>
      )}
      actions={<FormActions saving={saving} submitTestId="news-save" cancelTo="/admin/news" />}
    >
      <FormSection title="Der Beitrag">
        <FormGrid>
          <TextField label="Titel" value={form.title} onChange={(v) => { set("title", v); if (isNew && !form.slug) set("slug", slugFrom(v)); }} testId="news-title" required />
          <TextField label="Adresse (Link)" value={form.slug} onChange={(v) => set("slug", slugFrom(v))} placeholder="z. B. herbst-lan-2026" hint={form.slug ? `Der Link: /news/${form.slug}` : "Entsteht aus dem Titel – nur Kleinbuchstaben, Zahlen und Bindestriche."} testId="news-slug" required />
        </FormGrid>
        <TextField label="Kurzbeschreibung" value={form.excerpt} onChange={(v) => set("excerpt", v)} testId="news-excerpt" />
        <FieldLabel label="Inhalt" required>
          <MarkdownEditor
            value={form.content}
            onChange={(v) => set("content", v)}
            rows={14}
            required
            testId="news-content"
            helperText="Formatieren mit den Knöpfen oben (fett, Überschrift, Liste, Link). Karten für Turniere, Events und Fast Lap fügst du unten unter „Personen und Verknüpfungen“ mit „Einbetten“ ein."
          />
        </FieldLabel>
        <FieldLabel label="Bild">
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
                placeholder="Name oder Benutzername suchen"
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
                <MultiSelect options={events} valueKey="id" labelKey="name" selected={linkedE} onChange={setLinkedE} onEmbed={(item) => insertEmbed("event", item)} testId="news-link-events" searchLabel="Event suchen" />
              </FieldLabel>
            )}
            {tournaments.length > 0 && (
              <FieldLabel label="Verknüpfte Turniere">
                <MultiSelect options={tournaments} valueKey="id" labelKey="title" selected={linkedT} onChange={setLinkedT} onEmbed={(item) => insertEmbed("tournament", item)} testId="news-link-tournaments" searchLabel="Turnier suchen" />
              </FieldLabel>
            )}
            {f1Challenges.length > 0 && (
              <FieldLabel label="Verknüpfte Fast-Lap Challenges">
                <MultiSelect options={f1Challenges} valueKey="id" labelKey="title" selected={linkedF} onChange={setLinkedF} icon={Flag} onEmbed={(item) => insertEmbed("fastlap", item)} testId="news-link-fastlaps" searchLabel="Fast Lap suchen" />
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

// Wann erscheint der Beitrag? (#2122 NW1) - drei klare Wege statt Häkchen und Datum, die sich widersprechen konnten.
const PUBLISH_CHOICES = {
  draft: (initialMode) => (initialMode === "draft"
    ? ["Entwurf", "Nur das Admin-Team sieht ihn. Nichts wird verschickt."]
    : ["Zurück zum Entwurf", "Verschwindet aus allen Listen. Schon Verschicktes bleibt verschickt."]),
  now: (initialMode) => (initialMode === "now"
    ? ["Veröffentlicht", "Für alle sichtbar, die die Sichtbarkeit erlaubt."]
    : ["Jetzt veröffentlichen", "Erscheint beim Speichern – vorher kommt eine Rückfrage, was hinausgeht."]),
  scheduled: () => ["Geplant", "Erscheint zum Termin von selbst – mit Newsletter und Discord."],
};

export function PublishChoice({ mode, initialMode, onChange }) {
  return (
    <fieldset className="space-y-1.5" data-testid="news-publish-choice">
      <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Wann erscheint der Beitrag?</legend>
      {PUBLISH_MODES.map((key) => {
        const [label, hint] = PUBLISH_CHOICES[key](initialMode);
        const active = mode === key;
        return (
          <label key={key} className={`flex items-start gap-3 rounded-sm border px-3 py-2.5 cursor-pointer transition-colors duration-150 ${active ? "border-[#29B6E8]/60 bg-[#29B6E8]/[0.07]" : "border-white/10 hover:border-white/25"}`}>
            <input type="radio" name="news-publish-mode" value={key} checked={active} onChange={() => onChange(key)} className="mt-1 accent-[#29B6E8]" data-testid={`news-publish-${key}`} />
            <span className="min-w-0 block text-sm font-semibold text-white">
              {label}
              <span className="block text-xs font-normal text-white/50">{hint}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

// Verlauf (#2122 NW3): wer wann was gemacht hat - die neuesten oben, zugeklappt.
export function NewsHistory({ rows }) {
  if (!rows.length) return null;
  return (
    <details className="text-xs" data-testid="news-history">
      <summary className="cursor-pointer select-none font-bold uppercase tracking-wider text-white/60 hover:text-white">Verlauf ({rows.length})</summary>
      <ol className="mt-2 space-y-1.5">
        {rows.map((row, index) => (
          <li key={`${row.at}-${index}`} className="text-white/65">
            <span className="text-white/85 font-semibold">{row.label}</span> von {row.by} · {viennaDateTime(row.at, { dateStyle: "medium", timeStyle: "short" })}
            {row.fields?.length > 0 && <span className="block text-white/45">{row.fields.join(", ")}</span>}
          </li>
        ))}
      </ol>
    </details>
  );
}

// Verknüpfungen (#2122 NW5): mit Suchfeld, Gewähltes oben, Entwürfe gekennzeichnet - Besucher sehen deren Karte erst,
// wenn sie veröffentlicht sind.
export function filterLinkOptions(options, { query = "", labelKey, valueKey, selected = [] }) {
  const needle = query.trim().toLowerCase();
  const rows = needle ? options.filter((o) => String(o[labelKey] || "").toLowerCase().includes(needle) || selected.includes(o[valueKey])) : options;
  return [...rows].sort((a, b) => Number(selected.includes(b[valueKey])) - Number(selected.includes(a[valueKey])));
}

function MultiSelect({ options, valueKey, labelKey, selected, onChange, icon: Icon, onEmbed, testId, searchLabel = "Suchen" }) {
  const [query, setQuery] = useState("");
  const toggle = (v) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const rows = filterLinkOptions(options, { query, labelKey, valueKey, selected });
  return (
    <div className="border border-white/10 rounded-sm bg-[#0A0A0A] p-2 space-y-2" data-testid={testId}>
      {options.length > 5 && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/35" aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchLabel} aria-label={searchLabel} data-testid={testId ? `${testId}-search` : undefined}
            className="w-full bg-[#121212] border border-white/10 pl-8 pr-2 py-1.5 rounded-sm text-xs focus:outline-none focus:border-[#29B6E8]" />
        </div>
      )}
      <div className="max-h-40 overflow-y-auto space-y-1">
      {rows.length === 0 && <p className="px-2 py-1 text-xs text-white/45">Nichts gefunden.</p>}
      {rows.map((o) => (
        <div key={o[valueKey]} className="flex items-center gap-2 text-sm hover:bg-white/5 px-2 py-1 rounded-sm">
          <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
            <input type="checkbox" checked={selected.includes(o[valueKey])} onChange={() => toggle(o[valueKey])} className="accent-[#29B6E8]" />
            {Icon && <Icon className="w-3 h-3 text-[#29B6E8] shrink-0" />}
            <span className="truncate">{o[labelKey]}</span>
            {o.status === "draft" && <span className="shrink-0 rounded-sm border border-white/15 px-1.5 text-[10px] uppercase tracking-wider text-white/50" title="Besucher sehen die Karte erst, wenn es veröffentlicht ist.">Entwurf</span>}
          </label>
          {onEmbed && (
            <button type="button" onClick={() => onEmbed(o)} className="shrink-0 text-[10px] uppercase tracking-wider font-bold text-[#29B6E8] hover:text-white">
              Einbetten
            </button>
          )}
        </div>
      ))}
      </div>
    </div>
  );
}
