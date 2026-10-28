import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useOptionalAuth } from "@/context/AuthContext";
import { newsCategoryLabel } from "@/lib/newsCategories";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { LazyImg } from "@/components/tls/LazyImg";
import { SizedImage } from "@/components/tls/SizedImage";
import { PublicLoadingState } from "@/components/tls/PublicLoadingState";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { RichContent } from "@/components/tls/RichContent";
import { VideoEmbed } from "@/components/tls/VideoEmbed";
import { NewsTextCard } from "@/components/tls/NewsTextCard";
import { NewsSignupCards, signupItems } from "@/components/tls/NewsSignupCard";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useCanonicalSlugRedirect } from "@/hooks/useCanonicalSlugRedirect";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { seoTextPreview } from "@/lib/textPreview";
import { Pin, ArrowLeft, ArrowRight, Calendar, Trophy, Users, Flag, Clock, Link2, Share2, MessageCircle, Newspaper, User } from "lucide-react";
import { asInstant, viennaDate, viennaDateTime } from "@/lib/vienna";

// News-Detail (Rückmeldung des Betreibers, 24.09.: „sieht am PC aus wie am Handy, nichts ist
// ausgenutzt“): am PC und Tablet ein breites Raster - links der Artikel in Lesebreite mit großem
// Bild und größerer Schrift, rechts eine klebende Seitenleiste mit Angaben, Teilen, Verknüpftem,
// markierten Personen und weiteren News. Am Handy bleibt es eine Spalte, die Seitenleiste folgt
// dem Text. Eine Überschrift, die im Text den Titel wiederholt, fällt weg.

const WORDS_PER_MINUTE = 200;
const PROSE = "prose prose-invert prose-lg xl:prose-xl max-w-none text-white/85 prose-headings:font-heading prose-headings:uppercase prose-a:text-[#29B6E8]";

// Tags weg, bis keine mehr übrig sind (#1408) - der Wert wird nur verglichen, nie angezeigt.
function withoutTags(value) {
  let text = String(value || "");
  let previous;
  do {
    previous = text;
    text = text.replace(/<[^>]+>/g, "");
  } while (text !== previous);
  return text;
}

function normalizeTitle(value) {
  return withoutTags(value).replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

// Der Editor legt den Titel oft als erste Überschrift in den Text - auf der Seite stünde er dann zweimal.
export function stripLeadingTitle(text, title) {
  const source = String(text || "");
  const wanted = normalizeTitle(title);
  if (!wanted) return source;
  const match = source.match(/^\s*(?:#{1,3}\s+(.+?)\s*(?:\r?\n|$)|<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>\s*)/i);
  if (!match) return source;
  const heading = normalizeTitle(match[1] ?? match[2]);
  return heading === wanted ? source.slice(match[0].length).replace(/^\s+/, "") : source;
}

// Wo die Anmelde-Karte hinkommt (#1266): nach dem ersten Absatz - bei HTML nach dem ersten </p>, sonst an der ersten
// Leerzeile (nicht mitten in einem Code-Block). Ohne zweiten Absatz steht alles vorne, die Karte danach.
export function splitAfterFirstParagraph(text) {
  const source = String(text || "");
  const html = source.search(/<\/p>/i);
  if (html >= 0) {
    const end = html + "</p>".length;
    return [source.slice(0, end), source.slice(end).replace(/^\s+/, "")];
  }
  for (const match of source.matchAll(/\r?\n[ \t]*\r?\n/g)) {
    const head = source.slice(0, match.index);
    if (!head.trim()) continue;
    if ((head.match(/```/g) || []).length % 2 === 1) continue;
    return [head, source.slice(match.index + match[0].length).replace(/^\s+/, "")];
  }
  return [source, ""];
}

export function readingMinutes(text) {
  const words = String(text || "").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

function formatDate(value, style = "long") {
  const date = asInstant(value || 0);
  return Number.isNaN(date.getTime()) ? "" : viennaDate(date, { dateStyle: style });
}

// Vorschau für das Admin-Team (#2122 NW2): ein Beitrag, den Besucher nicht sehen, trägt ein deutliches Band - sonst
// hält man einen Entwurf leicht für veröffentlicht.
export function previewText(preview) {
  if (!preview) return "";
  if (preview.state === "withdrawn") {
    const since = preview.since ? ` am ${formatDate(preview.since, "medium")}` : "";
    return `Zurückgezogen${since}. Besucher sehen statt des Beitrags nur einen Hinweis.`;
  }
  if (preview.state === "scheduled") {
    const when = asInstant(preview.published_at || 0);
    const at = Number.isNaN(when.getTime()) ? "" : ` am ${viennaDateTime(when, { dateStyle: "medium", timeStyle: "short" })}`;
    return `Geplant – erscheint${at} von selbst. Bis dahin sieht nur das Admin-Team diese Vorschau.`;
  }
  return "Entwurf – nur das Admin-Team sieht diese Vorschau.";
}

function PreviewBand({ preview, postId }) {
  return (
    <div role="status" data-testid="news-preview-band" data-state={preview.state} className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-sm border border-warn/50 bg-warn/10 px-4 py-3 text-sm">
      <span className="font-heading font-black uppercase tracking-wider text-warn">Noch nicht öffentlich</span>
      <span className="min-w-0 flex-1 text-white/80">{previewText(preview)}</span>
      {postId && <Link to={`/admin/news/${encodeURIComponent(postId)}`} className="text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:underline">Im Editor öffnen</Link>}
    </div>
  );
}

export default function NewsDetailPage() {
  const { slug } = useParams();
  const [post, setPost] = useState(null);
  const [more, setMore] = useState([]);
  const [error, setError] = useState(null);
  const seoDescription = seoTextPreview(post?.excerpt || post?.content, "News von THE LION SQUAD eSports aus Tirol.");
  useDocumentTitle(post?.title || "News", seoDescription, {
    image: post?.banner_url,
    type: "article",
    canonical: post?.slug ? `${window.location.origin}/news/${post.slug}` : undefined,
  });
  useCanonicalSlugRedirect(slug, post?.slug, "/news");

  // Ohne Anmeldeprovider (Tests, Einbettung) gibt es keinen Leser - und keinen Marker.
  const user = useOptionalAuth()?.user || null;
  const load = useCallback(() => {
    api.get(`/news/${slug}`).then(({ data }) => {
      setPost(data);
      setError(null);
      // Gelesen-Marker (#616): nur mit Anmeldung, nur die Zahl - still im Hintergrund.
      if (user?.id) api.post(`/news/${slug}/read`, null, { skipInvalidation: true }).catch(() => {});
    }).catch((e) => {
      const status = e.response?.status;
      // Zurückgezogen (#2122 NW3): ein Link aus Newsletter oder Discord bekommt einen freundlichen Hinweis.
      if (status === 410) setError({ title: "Beitrag zurückgezogen", text: typeof e.response?.data?.detail === "string" ? e.response.data.detail : "Dieser Beitrag wurde zurückgezogen." });
      else setError({ title: status === 403 ? "Dieser Beitrag ist nicht öffentlich." : "Nicht gefunden." });
    });
    api.get("/news?limit=6").then(({ data }) => setMore(Array.isArray(data) ? data : data?.items || [])).catch(() => setMore([]));
  }, [slug, user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useApiInvalidation(load, ["news", "events", "tournaments", "f1", "teams"]);

  if (error) return (
    <PublicLayout>
      <div className="max-w-2xl mx-auto px-6 py-20 text-center" data-testid="news-error">
        <h1 className="font-heading text-3xl font-black">{error.title}</h1>
        {error.text && <p className="mt-3 text-white/65">{error.text}</p>}
        <Link to="/news" className="mt-6 inline-flex items-center gap-2 text-[#29B6E8]"><ArrowLeft className="w-4 h-4" /> {error.text ? "Zu den aktuellen News" : "Zurück zu News"}</Link>
      </div>
    </PublicLayout>
  );

  if (!post) return <PublicLayout><PublicLoadingState label="Lade News" /></PublicLayout>;

  const content = stripLeadingTitle(post.content, post.title);
  const mentionNames = (post.mentioned_users || []).map((user) => user.username);
  // Verknüpfte Turniere und Events mit Anmelde-Stand (#1266): die Karte steht nach dem ersten Absatz.
  const signups = signupItems(post);
  const [firstParagraph, restContent] = signups.length ? splitAfterFirstParagraph(content) : [content, ""];
  const others = more.filter((item) => item.slug !== post.slug && item.id !== post.id).slice(0, 4);
  const linked = [
    ...(post.linked_events || []).map((e) => ({ key: `e-${e.id}`, to: `/events/${e.slug}`, icon: Calendar, color: "#9F7AEA", title: e.name, sub: e.start_date ? formatDate(e.start_date, "medium") : "" })),
    ...(post.linked_tournaments || []).map((t) => ({ key: `t-${t.id}`, to: `/tournaments/${t.slug}`, icon: Trophy, color: "#FFD700", title: t.title, sub: "Turnier" })),
    ...(post.linked_f1_challenges || []).map((c) => ({ key: `c-${c.id}`, to: `/fastlap/${c.slug || c.id}`, icon: Flag, color: "#29B6E8", title: c.title, sub: c.start_date ? formatDate(c.start_date, "medium") : "Fast Lap" })),
    ...(post.linked_teams || []).map((t) => ({ key: `team-${t.id}`, to: "/teams", icon: Users, color: "#10B981", title: t.name, sub: "Team" })),
  ];
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/news/${post.slug}` : "";
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Link kopiert.");
    } catch {
      toast.error("Konnte den Link nicht kopieren.");
    }
  };
  const nativeShare = async () => {
    try {
      await navigator.share({ title: post.title, text: post.excerpt || post.title, url: shareUrl });
    } catch {
      // abgebrochen - nichts zu tun
    }
  };
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <PublicLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        {post.preview && <PreviewBand preview={post.preview} postId={post.id} />}
        <Breadcrumbs items={[{ label: "Start", to: "/" }, { label: "News", to: "/news" }, { label: post.title }]} className="mb-4" />
        <Link to="/news" data-testid="news-back" className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-white/50 hover:text-[#29B6E8]">
          <ArrowLeft className="w-3.5 h-3.5" /> Alle News
        </Link>

        <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem] 2xl:gap-16 items-start" data-testid="news-layout">
          <article className="min-w-0" data-testid="news-article">
            <div className="flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-widest font-bold">
              <span className="text-[#29B6E8]">{newsCategoryLabel(post.category)}</span>
              {post.pinned && <span className="inline-flex items-center gap-1 text-[#FFD700]"><Pin className="w-3 h-3" /> Angepinnt</span>}
              <span className="text-white/40 lg:hidden ml-auto">{formatDate(post.published_at || post.created_at)}</span>
            </div>
            <h1 className="mt-3 font-heading text-3xl md:text-5xl xl:text-6xl font-black uppercase leading-[1.02] break-words">{post.title}</h1>
            {post.excerpt && <p className="mt-4 text-lg xl:text-xl text-white/70 max-w-4xl">{post.excerpt}</p>}
            {post.video_url && <VideoEmbed url={post.video_url} title={post.title} className="mt-8" />}
            {post.banner_url && !post.video_url && (
              <div className="mt-8 rounded-sm overflow-hidden border border-white/10 bg-[#0A0A0A]">
                <LazyImg src={post.banner_url} alt="" priority sizes="(min-width: 1024px) 70vw, 100vw" className="w-full h-auto max-h-[38rem] object-cover" />
              </div>
            )}
            {signups.length > 0 ? (
              <>
                <RichContent text={firstParagraph} embeds={post.content_embeds || []} validProfileUsernames={mentionNames} className={`mt-8 ${PROSE}`} />
                <NewsSignupCards post={post} className="my-8" />
                {restContent && <RichContent text={restContent} embeds={post.content_embeds || []} validProfileUsernames={mentionNames} className={PROSE} />}
              </>
            ) : (
              <RichContent text={content} embeds={post.content_embeds || []} validProfileUsernames={mentionNames} className={`mt-8 ${PROSE}`} />
            )}
          </article>

          <aside className="space-y-4 lg:sticky lg:top-24" data-testid="news-sidebar">
            <div className="border border-white/10 bg-[#121212] rounded-sm p-4 space-y-3" data-testid="news-meta">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/45">Zum Beitrag</div>
              <div className="grid gap-2 text-sm">
                <div className="flex items-center gap-2 text-white/75"><Calendar className="w-4 h-4 text-[#29B6E8] shrink-0" /> {formatDate(post.published_at || post.created_at)}</div>
                {post.author_name && <div className="flex items-center gap-2 text-white/75"><User className="w-4 h-4 text-[#29B6E8] shrink-0" /> Von <strong className="text-white">{post.author_name}</strong></div>}
                <div className="flex items-center gap-2 text-white/75"><Clock className="w-4 h-4 text-[#29B6E8] shrink-0" /> {readingMinutes(content)} Min. Lesezeit</div>
                <div className="flex items-center gap-2 text-white/75"><Newspaper className="w-4 h-4 text-[#29B6E8] shrink-0" /> {newsCategoryLabel(post.category)}</div>
              </div>
              <div className="flex flex-wrap gap-2 pt-1" data-testid="news-share">
                <button type="button" onClick={copyLink} data-testid="news-share-copy" className="tls-btn tls-btn--quiet inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider"><Link2 className="w-3.5 h-3.5" /> Link kopieren</button>
                <a href={`https://wa.me/?text=${encodeURIComponent(`${post.title} – ${shareUrl}`)}`} target="_blank" rel="noreferrer" data-testid="news-share-whatsapp" className="tls-btn tls-btn--quiet inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider"><MessageCircle className="w-3.5 h-3.5" /> WhatsApp</a>
                {canNativeShare && <button type="button" onClick={nativeShare} data-testid="news-share-native" className="tls-btn tls-btn--quiet inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider"><Share2 className="w-3.5 h-3.5" /> Teilen …</button>}
              </div>
            </div>

            {linked.length > 0 && (
              <div className="border border-white/10 bg-[#121212] rounded-sm p-4" data-testid="news-linked">
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/45 mb-3">Verknüpft</div>
                <div className="grid gap-2">
                  {linked.map((item) => (
                    <Link key={item.key} to={item.to} className="flex items-center gap-3 min-w-0 overflow-hidden border border-white/10 hover:border-white/30 p-2.5 rounded-sm">
                      <item.icon className="w-4 h-4 shrink-0" style={{ color: item.color }} />
                      <div className="min-w-0">
                        <div className="font-bold text-sm truncate">{item.title}</div>
                        {item.sub && <div className="text-xs text-white/50">{item.sub}</div>}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {post.mentioned_users?.length > 0 && (
              <div className="border border-white/10 bg-[#121212] rounded-sm p-4" data-testid="news-mentions">
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/45 mb-3">Markierte Personen</div>
                <div className="grid gap-2">
                  {post.mentioned_users.map((user) => (
                    <Link key={user.id} to={`/u/${user.username}`} className="inline-flex items-center gap-3 border border-white/10 hover:border-[#29B6E8]/50 bg-[#0A0A0A] rounded-sm px-3 py-2 transition">
                      <span className="w-9 h-9 rounded-sm bg-[#121212] border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                        {user.avatar_url ? <SizedImage src={user.avatar_url} size={36} alt="" className="w-full h-full" /> : <Users className="w-4 h-4 text-white/35" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-bold truncate">{user.display_name || user.username}</span>
                        <span className="block text-xs text-white/45 truncate">@{user.username}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {others.length > 0 && (
              <div className="border border-white/10 bg-[#121212] rounded-sm p-4" data-testid="news-more">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="text-[11px] font-bold uppercase tracking-widest text-white/45">Weitere News</div>
                  <Link to="/news" className="text-[11px] font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white inline-flex items-center gap-1">Alle <ArrowRight className="w-3 h-3" /></Link>
                </div>
                <div className="grid gap-2">
                  {others.map((item) => (
                    <Link key={item.id || item.slug} to={`/news/${item.slug}`} data-testid={`news-more-${item.slug}`} className="flex items-center gap-3 border border-white/10 hover:border-[#29B6E8]/50 rounded-sm p-2 transition group">
                      <span className="w-16 h-12 shrink-0 rounded-sm overflow-hidden bg-[#0A0A0A] border border-white/10 flex items-center justify-center">
                        {item.banner_url ? <SizedImage src={item.banner_url} width={64} height={48} alt="" className="w-full h-full" /> : <NewsTextCard news={item} size="thumb" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-bold leading-snug line-clamp-2 group-hover:text-[#29B6E8] transition">{item.title}</span>
                        <span className="block text-[11px] text-white/45 mt-0.5">{formatDate(item.published_at || item.created_at, "medium")}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </PublicLayout>
  );
}
