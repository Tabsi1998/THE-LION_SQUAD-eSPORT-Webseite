import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { TournamentCard } from "@/components/tls/TournamentCard";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { MapPin, Calendar, Mail, Image as ImageIcon, Newspaper, Crown, Lock, Users } from "lucide-react";

const TYPE_LABELS = {
  club_evening: "Vereinsabend", lan_party: "LAN-Party", public_event: "Public Event",
  community_evening: "Community-Abend", grill_evening: "Grillabend",
  mario_kart_event: "Mario Kart Event", f1_event: "F1 Event", expo: "Messe / Expo",
  online_event: "Online Event", internal: "Interner Termin",
  sponsor_action: "Sponsorenaktion", tournament_finals: "Turnier-Finals", general: "Event",
};

export default function EventDetailPage() {
  const { slug } = useParams();
  const [e, setE] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.get(`/events/${slug}`).then(({ data }) => setE(data)).catch((err) => {
      setError(err.response?.status === 403 ? "Dieses Event ist nicht öffentlich zugänglich." : "Event nicht gefunden.");
    });
  }, [slug]);

  if (error) return (
    <PublicLayout>
      <div className="max-w-2xl mx-auto px-6 py-20 text-center">
        <h1 className="font-heading text-3xl font-black">{error}</h1>
        <Link to="/events" className="mt-6 inline-flex text-[#9F7AEA]">← Zurück zu Events</Link>
      </div>
    </PublicLayout>
  );
  if (!e) return <PublicLayout><div className="p-20 text-center text-white/40 font-display tracking-widest">LADE …</div></PublicLayout>;

  return (
    <PublicLayout>
      <div className="relative border-b border-white/10">
        {e.banner_url && <img src={e.banner_url} className="absolute inset-0 w-full h-full object-cover opacity-25" alt="" />}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0A]/40 via-[#0A0A0A]/80 to-[#0A0A0A]" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Events", to: "/events" }, { label: e.name }]} className="mb-4" />
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#9F7AEA]">{TYPE_LABELS[e.event_type] || "EVENT"}</span>
            <StatusBadge status={e.status || "draft"} size="md" />
            {e.visibility === "members" && <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-[#FFD700]"><Crown className="w-3 h-3" /> Mitglieder</span>}
            {e.visibility === "internal" && <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-white/60"><Lock className="w-3 h-3" /> Intern</span>}
          </div>
          <h1 className="mt-3 font-heading text-4xl md:text-6xl font-black uppercase leading-tight">{e.name}</h1>
          {e.description && <p className="mt-3 text-white/70 max-w-2xl text-lg">{e.description}</p>}
          <div className="mt-6 flex flex-wrap gap-5 text-sm text-white/70">
            {e.start_date && <span className="inline-flex items-center gap-2"><Calendar className="w-4 h-4 text-[#9F7AEA]" />{new Date(e.start_date).toLocaleString("de-DE", { dateStyle: "long", timeStyle: "short" })}</span>}
            {e.location && <span className="inline-flex items-center gap-2"><MapPin className="w-4 h-4 text-[#9F7AEA]" />{e.location}{e.address ? `, ${e.address}` : ""}</span>}
            {e.contact && <span className="inline-flex items-center gap-2"><Mail className="w-4 h-4 text-[#9F7AEA]" />{e.contact}</span>}
            {e.max_participants && <span className="inline-flex items-center gap-2"><Users className="w-4 h-4 text-[#9F7AEA]" />max. {e.max_participants}</span>}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-12">
        {e.program && (
          <div>
            <h2 className="font-heading text-2xl font-black uppercase mb-4">Programm</h2>
            <div className="border border-white/10 bg-[#121212] p-6 rounded-sm whitespace-pre-line text-white/85 leading-relaxed">{e.program}</div>
          </div>
        )}

        {!!e.tournaments?.length && (
          <div>
            <h2 className="font-heading text-2xl font-black uppercase mb-5">Turniere</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {e.tournaments.map((t) => <TournamentCard key={t.id} tournament={t} />)}
            </div>
          </div>
        )}

        {!!e.f1_challenges?.length && (
          <div>
            <h2 className="font-heading text-2xl font-black uppercase mb-5">Fast-Lap Challenges</h2>
            <div className="space-y-3">
              {e.f1_challenges.map((c) => (
                <Link key={c.id} to={`/f1/${c.slug || c.id}`} className="block border border-white/10 rounded-sm p-4 bg-[#121212] hover:border-[#FFD700]/60 transition">
                  <div className="flex items-center justify-between">
                    <div>
                      <StatusBadge status={c.status} />
                      <div className="mt-1 font-heading text-lg font-bold">{c.title}</div>
                    </div>
                    <span className="text-[#FFD700] text-sm font-bold uppercase tracking-wider">Öffnen →</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {!!e.albums?.length && (
          <div>
            <h2 className="font-heading text-2xl font-black uppercase mb-5 inline-flex items-center gap-2"><ImageIcon className="w-5 h-5 text-[#29B6E8]" /> Galerie</h2>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
              {e.albums.map((a) => (
                <Link key={a.id} to={`/gallery/${a.slug}`} className="border border-white/10 hover:border-[#29B6E8]/50 rounded-sm bg-[#121212] overflow-hidden">
                  <div className="aspect-video bg-[#0A0A0A] overflow-hidden">
                    {a.cover_url ? <img src={a.cover_url} alt={a.title} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-8 h-8 text-white/15" /></div>}
                  </div>
                  <div className="p-4"><div className="font-heading font-bold">{a.title}</div></div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {!!e.news?.length && (
          <div>
            <h2 className="font-heading text-2xl font-black uppercase mb-5 inline-flex items-center gap-2"><Newspaper className="w-5 h-5 text-[#29B6E8]" /> Verknüpfte News</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {e.news.map((n) => (
                <Link key={n.id} to={`/news/${n.slug}`} className="border border-white/10 hover:border-[#29B6E8]/50 rounded-sm bg-[#121212] p-4 transition">
                  <div className="text-[10px] uppercase tracking-widest text-white/40">{new Date(n.created_at).toLocaleDateString("de-DE")}</div>
                  <div className="font-heading font-bold mt-1">{n.title}</div>
                  {n.excerpt && <div className="text-xs text-white/60 mt-1 line-clamp-2">{n.excerpt}</div>}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
