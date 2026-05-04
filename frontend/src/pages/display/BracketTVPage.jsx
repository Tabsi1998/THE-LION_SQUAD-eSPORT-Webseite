import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { BracketTree } from "@/components/tls/BracketTree";
import { MascotBadge } from "@/components/tls/Logo";
import { StatusBadge } from "@/components/tls/StatusBadge";

export default function BracketTVPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    const load = async () => {
      const { data: br } = await api.get(`/tournaments/${id}/bracket`);
      setData(br);
    };
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [id]);

  if (!data) return <div className="min-h-screen bg-black flex items-center justify-center font-display tracking-widest text-white/40">LADE BRACKET …</div>;
  const t = data.tournament;

  return (
    <div className="min-h-screen tv-bg text-white">
      <header className="flex items-center justify-between px-8 py-5 border-b border-white/10">
        <div className="flex items-center gap-4">
          <MascotBadge className="w-12 h-12" />
          <div>
            <div className="text-[11px] uppercase tracking-[0.3em] text-[#29B6E8] font-bold">TLS ARENA · LIVE</div>
            <h1 className="font-heading text-2xl md:text-4xl font-black uppercase">{t.title}</h1>
          </div>
        </div>
        <StatusBadge status={t.status} size="lg" />
      </header>
      <div className="p-6">
        <BracketTree data={data} />
      </div>
    </div>
  );
}
