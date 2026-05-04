import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { MascotBadge } from "@/components/tls/Logo";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";

const medalColors = ["#FFD700", "#C0C0C0", "#CD7F32"];

export default function F1TVPage() {
  const { id } = useParams();
  const [challenge, setChallenge] = useState(null);
  const [activeTrackIdx, setActiveTrackIdx] = useState(0);
  const [board, setBoard] = useState(null);
  const [sponsors, setSponsors] = useState([]);
  const [sponsorIdx, setSponsorIdx] = useState(0);

  useEffect(() => {
    (async () => {
      const { data } = await api.get(`/f1/challenges/${id}`);
      setChallenge(data);
      try {
        const { data: sp } = await api.get("/sponsors");
        setSponsors(sp || []);
      } catch { setSponsors([]); }
    })();
  }, [id]);

  useEffect(() => {
    if (!challenge?.tracks?.length) return;
    const tr = challenge.tracks[activeTrackIdx % challenge.tracks.length];
    const fetchLB = async () => {
      const { data } = await api.get(`/f1/challenges/${id}/leaderboard?track_id=${tr.id}`);
      setBoard(data);
    };
    fetchLB();
    const iv = setInterval(fetchLB, 7000);
    return () => clearInterval(iv);
  }, [challenge, activeTrackIdx, id]);

  // Cycle tracks every 45s if championship
  useEffect(() => {
    if (!challenge?.is_championship || !challenge.tracks?.length) return;
    const iv = setInterval(() => setActiveTrackIdx((i) => (i + 1) % challenge.tracks.length), 45000);
    return () => clearInterval(iv);
  }, [challenge]);

  // Rotate sponsors every 8s
  useEffect(() => {
    if (sponsors.length < 2) return;
    const iv = setInterval(() => setSponsorIdx((i) => (i + 1) % sponsors.length), 8000);
    return () => clearInterval(iv);
  }, [sponsors]);

  if (!challenge) return <div className="min-h-screen bg-black flex items-center justify-center font-display tracking-widest text-white/40">LADE …</div>;

  const track = board?.track;
  const entries = board?.entries || [];
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3, 13);
  const publicUrl = `${window.location.origin}/f1/${challenge.slug || challenge.id}`;
  const currentSponsor = sponsors[sponsorIdx];

  return (
    <div className="min-h-screen tv-bg text-white overflow-hidden relative">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#29B6E8] to-transparent" />
      <header className="flex items-center justify-between p-8 border-b border-white/5">
        <div className="flex items-center gap-5">
          <MascotBadge className="w-16 h-16" />
          <div>
            <div className="text-[11px] uppercase tracking-[0.3em] text-[#29B6E8] font-bold">THE LION SQUAD · TLS ARENA</div>
            <h1 className="font-heading text-3xl md:text-5xl font-black uppercase leading-none mt-1">{challenge.title}</h1>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-[0.3em] text-white/50">Strecke {activeTrackIdx + 1} / {challenge.tracks?.length || 1}</div>
          <div className="font-heading text-3xl md:text-5xl font-black uppercase text-[#29B6E8]">{track?.name || "—"}</div>
          {track?.country && <div className="text-white/50 text-sm mt-1">{track.country}</div>}
        </div>
      </header>

      <div className="px-8 py-6">
        <div className="grid grid-cols-3 gap-6 mb-10">
          {top3.map((e, i) => (
            <motion.div
              key={e.user_id}
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: i * 0.15 }}
              className="relative border-2 rounded-sm p-6"
              style={{ borderColor: medalColors[i] + "80", background: "linear-gradient(180deg, rgba(41,182,232,0.05) 0%, transparent 100%)" }}
            >
              <div className="absolute -top-4 left-6 px-3 py-1 font-display font-black text-xl" style={{ backgroundColor: medalColors[i], color: "#000" }}>
                P{i + 1}
              </div>
              <div className="mt-2 font-heading font-black text-2xl md:text-4xl uppercase tracking-tight leading-tight truncate">{e.display_name}</div>
              <div className="mt-4 font-display font-bold tabular-nums text-5xl md:text-7xl" style={{ color: medalColors[i] }}>{e.time_str}</div>
              <div className="mt-2 text-white/50 text-sm">{e.gap_str || "Leader"} · {e.attempts} Versuche</div>
            </motion.div>
          ))}
          {top3.length === 0 && (
            <div className="col-span-3 text-center py-10 font-display tracking-widest text-white/30 text-xl">NOCH KEINE ZEITEN</div>
          )}
        </div>

        <div className="space-y-2">
          <AnimatePresence>
            {rest.map((e, i) => (
              <motion.div
                key={e.user_id}
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ delay: i * 0.03 }}
                className="grid grid-cols-12 items-center border border-white/10 rounded-sm px-5 py-3 bg-[#0A0A0A]/60"
              >
                <div className="col-span-1 font-display font-bold text-2xl text-[#29B6E8]">{e.rank}</div>
                <div className="col-span-6 font-heading font-bold text-lg md:text-2xl truncate uppercase">{e.display_name}</div>
                <div className="col-span-3 text-right font-display font-bold tabular-nums text-xl md:text-3xl text-white">{e.time_str}</div>
                <div className="col-span-2 text-right text-white/50 text-sm tabular-nums">{e.gap_str}</div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <footer className="absolute bottom-0 left-0 right-0 px-8 py-4 border-t border-white/5 flex items-center justify-between gap-4 bg-[#0A0A0A]/80 backdrop-blur-sm">
        <div className="flex items-center gap-4 min-w-0">
          <div className="bg-white p-1.5 rounded-sm shrink-0">
            <QRCodeSVG value={publicUrl} size={64} bgColor="#ffffff" fgColor="#0A0A0A" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.3em] text-[#29B6E8] font-bold">Join The Race</div>
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
                <div className="text-[10px] uppercase tracking-[0.3em] text-white/40 font-bold">Presented by</div>
                <div className="font-heading text-lg md:text-xl font-bold text-white truncate uppercase">{currentSponsor.name}</div>
              </div>
              {currentSponsor.logo_url && (
                <div className="bg-white/5 border border-white/10 rounded-sm px-3 py-2 shrink-0">
                  <img src={currentSponsor.logo_url} alt={currentSponsor.name} className="h-10 w-auto object-contain" />
                </div>
              )}
            </motion.div>
          ) : (
            <div className="text-[11px] uppercase tracking-[0.3em] text-[#29B6E8]">AUTO-REFRESH · 7s</div>
          )}
        </AnimatePresence>
      </footer>
    </div>
  );
}
