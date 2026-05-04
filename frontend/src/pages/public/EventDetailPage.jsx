import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { TournamentCard } from "@/components/tls/TournamentCard";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { MapPin, Calendar, Mail } from "lucide-react";

export default function EventDetailPage() {
  const { slug } = useParams();
  const [e, setE] = useState(null);
  useEffect(() => { api.get(`/events/${slug}`).then(({ data }) => setE(data)); }, [slug]);
  if (!e) return <PublicLayout><div className="p-20 text-center text-white/40 font-display tracking-widest">LADE …</div></PublicLayout>;

  return (
    <PublicLayout>
      <div className="relative border-b border-white/10">
        {e.banner_url && <img src={e.banner_url} className="absolute inset-0 w-full h-full object-cover opacity-25" alt="" />}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0A]/60 to-[#0A0A0A]" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <StatusBadge status={e.status || "upcoming"} size="lg" />
          <h1 className="mt-3 font-heading text-4xl md:text-6xl font-black uppercase">{e.name}</h1>
          <p className="mt-3 text-white/70 max-w-2xl">{e.description}</p>
          <div className="mt-6 flex flex-wrap gap-5 text-sm text-white/70">
            {e.start_date && <span className="inline-flex items-center gap-2"><Calendar className="w-4 h-4 text-[#29B6E8]" />{new Date(e.start_date).toLocaleDateString("de-DE", { dateStyle: "long" })}</span>}
            {e.location && <span className="inline-flex items-center gap-2"><MapPin className="w-4 h-4 text-[#29B6E8]" />{e.location}</span>}
            {e.contact && <span className="inline-flex items-center gap-2"><Mail className="w-4 h-4 text-[#29B6E8]" />{e.contact}</span>}
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h2 className="font-heading text-2xl font-black uppercase mb-5">Turniere</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {e.tournaments?.map((t) => <TournamentCard key={t.id} tournament={t} />)}
        </div>
        <h2 className="mt-12 font-heading text-2xl font-black uppercase mb-5">Fast-Lap Challenges</h2>
        <div className="space-y-3">
          {e.f1_challenges?.map((c) => (
            <Link key={c.id} to={`/f1/${c.slug || c.id}`} className="block border border-white/10 rounded-sm p-4 bg-[#121212] hover:border-[#29B6E8]/60 transition">
              <div className="flex items-center justify-between">
                <div>
                  <StatusBadge status={c.status} />
                  <div className="mt-1 font-heading text-lg font-bold">{c.title}</div>
                </div>
                <span className="text-[#29B6E8] text-sm font-bold uppercase tracking-wider">Öffnen →</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </PublicLayout>
  );
}
