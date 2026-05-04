import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { BracketTree } from "@/components/tls/BracketTree";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { Tv } from "lucide-react";

export default function TournamentBracketPage() {
  const { slug } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: t } = await api.get(`/tournaments/${slug}`);
      const { data: br } = await api.get(`/tournaments/${t.id}/bracket`);
      setData(br);
    })();
  }, [slug]);

  if (!data) return <PublicLayout><div className="p-20 text-center text-white/40 font-display tracking-widest">LADE BRACKET …</div></PublicLayout>;
  const t = data.tournament;

  return (
    <PublicLayout>
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <Link to={`/tournaments/${t.slug}`} className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] hover:text-white">← Zurück zum Turnier</Link>
            <h1 className="mt-2 font-heading text-3xl md:text-5xl font-black uppercase">{t.title}</h1>
            <div className="mt-2 flex gap-2 items-center">
              <StatusBadge status={t.status} />
              <span className="text-white/40 text-sm">{t.format?.replace("_", " ")}</span>
            </div>
          </div>
          <Link to={`/display/bracket/${t.id}`} target="_blank" data-testid="bracket-tv-link" className="inline-flex items-center gap-2 px-4 py-2.5 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm hover:bg-[#29B6E8]/10 text-sm">
            <Tv className="w-4 h-4" /> TV Ansicht
          </Link>
        </div>
        {data.matches.length === 0 ? (
          <div className="border border-white/10 rounded-sm bg-[#121212] p-12 text-center">
            <div className="text-white/50 font-display tracking-widest">BRACKET WURDE NOCH NICHT GENERIERT</div>
          </div>
        ) : (
          <BracketTree data={data} />
        )}
      </div>
    </PublicLayout>
  );
}
