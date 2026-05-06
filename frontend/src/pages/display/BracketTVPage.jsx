import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { BracketTree } from "@/components/tls/BracketTree";
import { MascotBadge } from "@/components/tls/Logo";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { SponsorGrid } from "@/components/tls/SponsorTicker";
import { QRCodeSVG } from "qrcode.react";

export default function BracketTVPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    const { data: br } = await api.get(`/tournaments/${id}/bracket`);
    setData(br);
  }, [id]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [load]);
  useApiInvalidation(load, ["tournaments", "matches", "stations"]);

  if (!data) return <div className="min-h-screen bg-black flex items-center justify-center font-display tracking-widest text-white/40">LADE BRACKET …</div>;
  const t = data.tournament;
  const publicUrl = `${window.location.origin}/tournaments/${t.slug || t.id}/bracket`;

  return (
    <div className="min-h-screen tv-bg text-white pb-28">
      <header className="flex items-center justify-between px-8 py-5 border-b border-white/10">
        <div className="flex items-center gap-4">
          <MascotBadge className="w-12 h-12" />
          <div>
            <div className="text-[11px] uppercase tracking-[0.3em] text-[#29B6E8] font-bold">THE LION SQUAD · LIVE</div>
            <h1 className="font-heading text-2xl md:text-4xl font-black uppercase">{t.title}</h1>
          </div>
        </div>
        <StatusBadge status={t.status} size="lg" />
      </header>
      <div className="p-6 overflow-x-auto">
        <BracketTree data={data} />
      </div>
      <footer className="fixed bottom-0 left-0 right-0 px-8 py-4 pr-40 border-t border-white/10 flex items-center justify-between gap-4 bg-[#0A0A0A]/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-4 min-w-0">
          <div className="bg-white p-1.5 rounded-sm shrink-0">
            <QRCodeSVG value={publicUrl} size={56} bgColor="#ffffff" fgColor="#0A0A0A" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.3em] text-[#29B6E8] font-bold">Jetzt mitfiebern</div>
            <div className="text-sm text-white/80 truncate font-mono">{publicUrl.replace(/^https?:\/\//, "")}</div>
          </div>
        </div>
        <SponsorGrid max={4} />
      </footer>
    </div>
  );
}
