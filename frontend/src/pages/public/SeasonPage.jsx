import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { Trophy } from "lucide-react";

export default function SeasonPage() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  useEffect(() => {
    (async () => {
      const { data: st } = await api.get(`/seasons/${slug}/standings`);
      setData(st);
    })();
  }, [slug]);
  if (!data) return <PublicLayout><div className="p-20 text-center text-white/40 font-display tracking-widest">LADE …</div></PublicLayout>;
  const s = data.season;
  return (
    <PublicLayout>
      <div className="relative border-b border-white/10 bg-grid-dense overflow-hidden">
        {s.banner_url && <img src={resolveMediaUrl(s.banner_url)} className="absolute inset-0 w-full h-full object-cover opacity-20" alt=""/>}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0A]/70 to-[#0A0A0A]"/>
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">{s.kind === "circuit" ? "Circuit" : "Saison"}</span>
          <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase">{s.name}</h1>
          {s.description && <p className="mt-3 text-white/70 max-w-2xl">{s.description}</p>}
          <div className="mt-6 flex gap-2"><StatusBadge status={s.status} size="lg"/></div>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-[#FFD700]"/><h2 className="font-heading font-bold uppercase">Gesamtwertung</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr><th className="text-left px-4 py-3 w-14">#</th><th className="text-left px-4 py-3">Spieler</th><th className="text-right px-4 py-3">Events</th><th className="text-right px-4 py-3">Siege</th><th className="text-right px-4 py-3 font-display">Punkte</th></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.standings.map((r)=>(
                <tr key={r.user_id} className={r.rank<=3 ? "bg-[#FFD700]/5" : ""}>
                  <td className={`px-4 py-3 font-display font-bold ${r.rank===1?"text-[#FFD700]":r.rank===2?"text-white/80":r.rank===3?"text-[#CD7F32]":"text-[#29B6E8]"}`}>{r.rank}</td>
                  <td className="px-4 py-3">{r.display_name}</td>
                  <td className="px-4 py-3 text-right text-white/70">{r.events_count}</td>
                  <td className="px-4 py-3 text-right text-white/70">{r.wins}</td>
                  <td className="px-4 py-3 text-right font-display font-bold text-[#29B6E8] text-lg">{r.points}</td>
                </tr>
              ))}
              {data.standings.length === 0 && <tr><td colSpan="5" className="text-center py-10 text-white/40">Noch keine Ergebnisse</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </PublicLayout>
  );
}
