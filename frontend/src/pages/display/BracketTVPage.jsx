import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { BracketTree } from "@/components/tls/BracketTree";
import { MascotBadge } from "@/components/tls/Logo";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "framer-motion";

export default function BracketTVPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [sponsors, setSponsors] = useState([]);
  const [sponsorIdx, setSponsorIdx] = useState(0);

  useEffect(() => {
    const load = async () => {
      const { data: br } = await api.get(`/tournaments/${id}/bracket`);
      setData(br);
    };
    load();
    (async () => {
      try { const { data: sp } = await api.get("/sponsors"); setSponsors(sp || []); }
      catch { setSponsors([]); }
    })();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [id]);

  useEffect(() => {
    if (sponsors.length < 2) return;
    const iv = setInterval(() => setSponsorIdx((i) => (i + 1) % sponsors.length), 8000);
    return () => clearInterval(iv);
  }, [sponsors]);

  if (!data) return <div className="min-h-screen bg-black flex items-center justify-center font-display tracking-widest text-white/40">LADE BRACKET …</div>;
  const t = data.tournament;
  const publicUrl = `${window.location.origin}/tournaments/${t.slug || t.id}/bracket`;
  const currentSponsor = sponsors[sponsorIdx];

  return (
    <div className="min-h-screen tv-bg text-white pb-24">
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
      <div className="p-6 overflow-x-auto">
        <BracketTree data={data} />
      </div>
      <footer className="fixed bottom-0 left-0 right-0 px-8 py-4 border-t border-white/10 flex items-center justify-between gap-4 bg-[#0A0A0A]/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-4 min-w-0">
          <div className="bg-white p-1.5 rounded-sm shrink-0">
            <QRCodeSVG value={publicUrl} size={56} bgColor="#ffffff" fgColor="#0A0A0A" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.3em] text-[#29B6E8] font-bold">Scan to follow</div>
            <div className="text-sm text-white/80 truncate font-mono">{publicUrl.replace(/^https?:\/\//, "")}</div>
          </div>
        </div>
        <AnimatePresence mode="wait">
          {currentSponsor ? (
            <motion.div
              key={currentSponsor.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.6 }}
              className="flex items-center gap-4 min-w-0"
            >
              <div className="text-right min-w-0">
                <div className="text-[10px] uppercase tracking-[0.3em] text-white/40 font-bold">Sponsored by</div>
                <div className="font-heading text-lg md:text-xl font-bold text-white truncate uppercase">{currentSponsor.name}</div>
              </div>
              {currentSponsor.logo_url && (
                <div className="bg-white/5 border border-white/10 rounded-sm px-3 py-2 shrink-0">
                  <img src={currentSponsor.logo_url} alt={currentSponsor.name} className="h-10 w-auto object-contain" />
                </div>
              )}
            </motion.div>
          ) : (
            <div className="text-[11px] uppercase tracking-[0.3em] text-[#29B6E8]">LIVE · AUTO-REFRESH 15s</div>
          )}
        </AnimatePresence>
      </footer>
    </div>
  );
}
