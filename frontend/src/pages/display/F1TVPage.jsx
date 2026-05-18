import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { MascotBadge } from "@/components/tls/Logo";
import { SponsorGrid } from "@/components/tls/SponsorTicker";
import { DisplayStatusBanner } from "@/components/tls/DisplayStatusBanner";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

const medalColors = ["#FFD700", "#C0C0C0", "#CD7F32"];

export default function F1TVPage() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [challenge, setChallenge] = useState(null);
  const [activeTrackIdx, setActiveTrackIdx] = useState(0);
  const [board, setBoard] = useState(null);
  const [challengeError, setChallengeError] = useState(null);
  const [boardError, setBoardError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const trackParam = searchParams.get("track");

  const loadChallenge = useCallback(async () => {
    try {
      const { data } = await api.get(`/f1/challenges/${id}`);
      setChallenge(data);
      setChallengeError(null);
      if (trackParam && data.tracks) {
        const idx = data.tracks.findIndex((t) => t.id === trackParam || t.slug === trackParam);
        if (idx >= 0) setActiveTrackIdx(idx);
      }
    } catch (error) {
      setChallengeError(error);
    }
  }, [id, trackParam]);

  useEffect(() => {
    loadChallenge();
  }, [loadChallenge]);

  useApiInvalidation(loadChallenge, ["f1"]);

  useEffect(() => {
    if (!challenge?.tracks?.length) return;
    const tr = challenge.tracks[activeTrackIdx % challenge.tracks.length];
    const fetchLB = async () => {
      try {
        const { data } = await api.get(`/f1/challenges/${id}/leaderboard?track_id=${tr.id}`);
        setBoard(data);
        setBoardError(null);
        setLastUpdated(Date.now());
      } catch (error) {
        setBoardError(error);
      }
    };
    fetchLB();
    const iv = setInterval(fetchLB, 7000);
    return () => clearInterval(iv);
  }, [challenge, activeTrackIdx, id]);

  // Cycle tracks every 45s if championship AND no manual override via ?track=
  useEffect(() => {
    if (!challenge?.is_championship || !challenge.tracks?.length) return;
    if (searchParams.get("track")) return; // manual lock
    const iv = setInterval(() => setActiveTrackIdx((i) => (i + 1) % challenge.tracks.length), 45000);
    return () => clearInterval(iv);
  }, [challenge, searchParams]);

  // Arrow key navigation
  useEffect(() => {
    if (!challenge?.tracks?.length) return;
    const onKey = (e) => {
      if (e.key === "ArrowRight") setActiveTrackIdx((i) => (i + 1) % challenge.tracks.length);
      else if (e.key === "ArrowLeft") setActiveTrackIdx((i) => (i - 1 + challenge.tracks.length) % challenge.tracks.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [challenge]);

  if (!challenge) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col">
        <DisplayStatusBanner error={challengeError} label="Fast-Lap Challenge" onRetry={loadChallenge} />
        <div className="flex-1 flex items-center justify-center font-display tracking-widest text-white/40">
          {challengeError ? "FAST-LAP ANSICHT KONNTE NICHT GELADEN WERDEN" : "LADE …"}
        </div>
      </div>
    );
  }

  const track = board?.track;
  const entries = board?.entries || [];
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3, 13);
  const references = board?.club_reference_entries || [];
  const publicUrl = `${window.location.origin}/fastlap/${challenge.slug || challenge.id}`;
  const prevTrack = () => challenge.tracks?.length && setActiveTrackIdx((i) => (i - 1 + challenge.tracks.length) % challenge.tracks.length);
  const nextTrack = () => challenge.tracks?.length && setActiveTrackIdx((i) => (i + 1) % challenge.tracks.length);

  return (
    <div className="min-h-screen tv-bg text-white overflow-hidden relative">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#29B6E8] to-transparent" />
      <header className="flex items-center justify-between p-8 border-b border-white/5">
        <div className="flex items-center gap-5">
          <MascotBadge className="w-16 h-16" />
          <div>
            <div className="text-[11px] uppercase tracking-[0.3em] text-[#29B6E8] font-bold">THE LION SQUAD · FAST LAP</div>
            <h1 className="font-heading text-3xl md:text-5xl font-black uppercase leading-none mt-1">{challenge.title}</h1>
          </div>
        </div>
        <div className="flex items-center justify-end gap-5 min-w-[28vw]">
          {track?.image_url && (
            <div className="hidden xl:flex w-52 h-28 border border-[#29B6E8]/25 bg-black/50 rounded-sm overflow-hidden items-center justify-center shrink-0">
              <img src={resolveMediaUrl(track.image_url)} alt="" className="w-full h-full object-contain" />
            </div>
          )}
          <div className="text-right min-w-0">
          <div className="text-[11px] uppercase tracking-[0.3em] text-white/50">Strecke {activeTrackIdx + 1} / {challenge.tracks?.length || 1}</div>
          <div className="font-heading text-3xl md:text-5xl font-black uppercase text-[#29B6E8]">{track?.name || "—"}</div>
          {track?.country && <div className="text-white/50 text-sm mt-1">{track.country}</div>}
          {(challenge.tracks?.length || 0) > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2">
              <button onClick={prevTrack} data-testid="f1-tv-prev-track" className="p-2 border border-white/10 rounded-sm hover:border-[#29B6E8] hover:text-[#29B6E8] transition" title="Vorherige Strecke (←)">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <select
                value={activeTrackIdx}
                onChange={(e) => setActiveTrackIdx(Number(e.target.value))}
                data-testid="f1-tv-track-select"
                className="bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm min-w-[180px]"
              >
                {challenge.tracks.map((tr, i) => <option key={tr.id} value={i}>{tr.name}</option>)}
              </select>
              <button onClick={nextTrack} data-testid="f1-tv-next-track" className="p-2 border border-white/10 rounded-sm hover:border-[#29B6E8] hover:text-[#29B6E8] transition" title="Nächste Strecke (→)">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
          </div>
        </div>
      </header>
      <DisplayStatusBanner error={boardError} lastUpdated={lastUpdated} label="Rangliste" onRetry={loadChallenge} compact />

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
        {references.length > 0 && (
          <div className="mt-6 border border-[#FFD700]/25 bg-[#FFD700]/5 rounded-sm p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.3em] text-[#FFD700] font-bold">Vereins-Referenz · außer Wertung</div>
                <div className="text-xs text-white/45 mt-1">Zielzeiten zum Schlagen, nicht Teil der offiziellen Rangliste.</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {references.map((e) => (
                <div key={e.user_id} className="border border-white/10 bg-[#0A0A0A]/60 rounded-sm px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-display font-bold text-[#FFD700]">#{e.rank}</span>
                    <span className="font-display font-bold tabular-nums text-white text-2xl">{e.time_str}</span>
                  </div>
                  <div className="mt-1 font-heading font-bold uppercase truncate">{e.display_name}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <footer className="absolute bottom-0 left-0 right-0 px-8 py-4 border-t border-white/5 flex items-center justify-between gap-6 bg-[#0A0A0A]/80 backdrop-blur-sm">
        <div className="flex items-center gap-4 min-w-0">
          <div className="bg-white p-1.5 rounded-sm shrink-0">
            <QRCodeSVG value={publicUrl} size={92} bgColor="#ffffff" fgColor="#0A0A0A" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.3em] text-[#29B6E8] font-bold">Join The Race</div>
            <div className="text-sm text-white/70 truncate">QR scannen und mitfahren</div>
          </div>
        </div>
        <SponsorGrid max={3} marquee className="flex-1 max-w-[54vw]" />
      </footer>
    </div>
  );
}
