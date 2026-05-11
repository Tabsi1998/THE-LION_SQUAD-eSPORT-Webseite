import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { RichContent } from "@/components/tls/RichContent";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Pin, ArrowLeft, Calendar, Trophy, Users, Flag } from "lucide-react";

export default function NewsDetailPage() {
  const { slug } = useParams();
  const [post, setPost] = useState(null);
  const [error, setError] = useState(null);
  useDocumentTitle(post?.title || "News", post?.excerpt || "News von THE LION SQUAD eSports.");

  const load = useCallback(() => {
    api.get(`/news/${slug}`).then(({ data }) => {
      setPost(data);
      setError(null);
    }).catch((e) => {
      setError(e.response?.status === 403 ? "Dieser Beitrag ist nicht öffentlich." : "Nicht gefunden.");
    });
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  useApiInvalidation(load, ["news", "events", "tournaments", "f1", "teams"]);

  if (error) return (
    <PublicLayout>
      <div className="max-w-2xl mx-auto px-6 py-20 text-center">
        <h1 className="font-heading text-3xl font-black">{error}</h1>
        <Link to="/news" className="mt-6 inline-flex items-center gap-2 text-[#29B6E8]"><ArrowLeft className="w-4 h-4" /> Zurück zu News</Link>
      </div>
    </PublicLayout>
  );

  if (!post) return <PublicLayout><div className="max-w-3xl mx-auto px-6 py-20 text-white/40">Lade …</div></PublicLayout>;

  return (
    <PublicLayout>
      <article className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "News", to: "/news" }, { label: post.title }]} className="mb-6" />
        <Link to="/news" data-testid="news-back" className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-white/50 hover:text-[#29B6E8]">
          <ArrowLeft className="w-3.5 h-3.5" /> Alle News
        </Link>
        <div className="mt-6 flex items-center gap-3 text-[11px] uppercase tracking-widest font-bold">
          <span className="text-[#29B6E8]">{post.category}</span>
          {post.pinned && <span className="inline-flex items-center gap-1 text-[#FFD700]"><Pin className="w-3 h-3" /> Angepinnt</span>}
          <span className="text-white/40 ml-auto">{new Date(post.published_at || post.created_at).toLocaleDateString("de-DE", { dateStyle: "long" })}</span>
        </div>
        <h1 className="mt-3 font-heading text-3xl md:text-5xl font-black uppercase leading-tight break-words">{post.title}</h1>
        {post.excerpt && <p className="mt-4 text-lg text-white/70">{post.excerpt}</p>}
        {post.author_name && <div className="mt-3 text-xs text-white/50">Von <strong className="text-white/80">{post.author_name}</strong></div>}
        {post.banner_url && (
          <div className="mt-8 rounded-sm overflow-hidden border border-white/10">
            <img src={resolveMediaUrl(post.banner_url)} alt="" className="w-full h-auto" />
          </div>
        )}
        <RichContent text={post.content} embeds={post.content_embeds || []} className="mt-8 prose prose-invert max-w-none text-white/85" />

        {post.mentioned_users?.length > 0 && (
          <div className="mt-10 border-t border-white/10 pt-8">
            <h2 className="font-heading text-xl font-black uppercase mb-4">Markierte Personen</h2>
            <div className="flex flex-wrap gap-3">
              {post.mentioned_users.map((user) => (
                <Link key={user.id} to={`/u/${user.username}`} className="inline-flex items-center gap-3 border border-white/10 hover:border-[#29B6E8]/50 bg-[#121212] rounded-sm px-3 py-2 transition">
                  <span className="w-9 h-9 rounded-sm bg-[#0A0A0A] border border-white/10 overflow-hidden flex items-center justify-center">
                    {user.avatar_url ? (
                      <img src={resolveMediaUrl(user.avatar_url)} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Users className="w-4 h-4 text-white/35" />
                    )}
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

        {(post.linked_events?.length || post.linked_tournaments?.length || post.linked_f1_challenges?.length || post.linked_teams?.length) && (
          <div className="mt-10 border-t border-white/10 pt-8">
            <h2 className="font-heading text-xl font-black uppercase mb-4">Verknüpft</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {post.linked_events?.map((e) => (
                <Link key={e.id} to={`/events/${e.slug}`} className="flex items-center gap-3 border border-white/10 hover:border-[#9F7AEA]/50 p-3 rounded-sm">
                  <Calendar className="w-4 h-4 text-[#9F7AEA]" />
                  <div>
                    <div className="font-bold text-sm">{e.name}</div>
                    {e.start_date && <div className="text-xs text-white/50">{new Date(e.start_date).toLocaleDateString("de-DE")}</div>}
                  </div>
                </Link>
              ))}
              {post.linked_tournaments?.map((t) => (
                <Link key={t.id} to={`/tournaments/${t.slug}`} className="flex items-center gap-3 border border-white/10 hover:border-[#FFD700]/50 p-3 rounded-sm">
                  <Trophy className="w-4 h-4 text-[#FFD700]" />
                  <div className="font-bold text-sm">{t.title}</div>
                </Link>
              ))}
              {post.linked_f1_challenges?.map((c) => (
                <Link key={c.id} to={`/fastlap/${c.slug || c.id}`} className="flex items-center gap-3 border border-white/10 hover:border-[#29B6E8]/50 p-3 rounded-sm">
                  <Flag className="w-4 h-4 text-[#29B6E8]" />
                  <div>
                    <div className="font-bold text-sm">{c.title}</div>
                    {c.start_date && <div className="text-xs text-white/50">{new Date(c.start_date).toLocaleDateString("de-DE")}</div>}
                  </div>
                </Link>
              ))}
              {post.linked_teams?.map((t) => (
                <Link key={t.id} to={`/teams`} className="flex items-center gap-3 border border-white/10 hover:border-[#10B981]/50 p-3 rounded-sm">
                  <Users className="w-4 h-4 text-[#10B981]" />
                  <div className="font-bold text-sm">{t.name}</div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </article>
    </PublicLayout>
  );
}
