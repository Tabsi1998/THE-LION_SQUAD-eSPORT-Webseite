import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, formatMs } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { Tv, Trophy, Flag, Download } from "lucide-react";

export default function F1DetailPage() {
  const { slug } = useParams();
  const [challenge, setChallenge] = useState(null);
  const [activeTrack, setActiveTrack] = useState(null);
  const [board, setBoard] = useState(null);
  const [championship, setChampionship] = useState(null);
  const [tab, setTab] = useState("track"); // track | championship

  useEffect(() => {
    (async () => {
      const { data } = await api.get(`/f1/challenges/${slug}`);
      setChallenge(data);
      if (data.tracks?.length) setActiveTrack(data.tracks[0].id);
      if (data.is_championship) {
        const { data: cs } = await api.get(`/f1/challenges/${data.id}/championship`);
        setChampionship(cs);
      }
    })();
  }, [slug]);

  useEffect(() => {
    if (!challenge || !activeTrack) return;
    (async () => {
      const { data } = await api.get(`/f1/challenges/${challenge.id}/leaderboard?track_id=${activeTrack}`);
      setBoard(data);
    })();
    const iv = setInterval(async () => {
      const { data } = await api.get(`/f1/challenges/${challenge.id}/leaderboard?track_id=${activeTrack}`);
      setBoard(data);
    }, 10000);
    return () => clearInterval(iv);
  }, [challenge, activeTrack]);

  if (!challenge) return <PublicLayout><div className="p-20 text-center font-display tracking-widest text-white/40">LADE …</div></PublicLayout>;

  return (
    <PublicLayout>
      <div className="relative border-b border-white/10 overflow-hidden bg-grid-dense">
        {challenge.banner_url && <img src={challenge.banner_url} className="absolute inset-0 w-full h-full object-cover opacity-25" alt="" />}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0A]/70 to-[#0A0A0A]" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <Link to="/f1" className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] hover:text-white">← F1 Fast Lap Challenges</Link>
          <div className="mt-2 flex flex-wrap items-center gap-3 mb-3">
            <StatusBadge status={challenge.status} size="lg" />
            {challenge.is_championship && <span className="text-[11px] font-bold uppercase tracking-wider text-[#FFD700] border border-[#FFD700]/40 px-2 py-1 rounded-sm">Championship</span>}
          </div>
          <h1 data-testid="f1-challenge-title" className="font-heading text-4xl md:text-6xl font-black uppercase leading-tight">{challenge.title}</h1>
          {challenge.description && <p className="mt-3 text-white/70 max-w-2xl">{challenge.description}</p>}
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to={`/display/f1/${challenge.id}`} target="_blank" data-testid="f1-tv-link" className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] transition">
              <Tv className="w-4 h-4" /> TV / Beamer Modus
            </Link>
            <a
              href={`${process.env.REACT_APP_BACKEND_URL}/api/f1/challenges/${challenge.id}/export.csv`}
              data-testid="f1-export-csv"
              className="inline-flex items-center gap-2 px-5 py-2.5 border border-white/20 text-white font-bold uppercase tracking-wider rounded-sm hover:border-[#29B6E8]/60 hover:text-[#29B6E8] transition"
            >
              <Download className="w-4 h-4" /> Export CSV
            </a>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {challenge.is_championship && (
          <div className="flex gap-2 mb-6">
            <button
              data-testid="f1-tab-track"
              onClick={() => setTab("track")}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-sm border transition ${tab === "track" ? "bg-[#29B6E8] text-black border-[#29B6E8]" : "text-white/70 border-white/10 hover:border-[#29B6E8]/40"}`}
            >
              Strecken-Rangliste
            </button>
            <button
              data-testid="f1-tab-championship"
              onClick={() => setTab("championship")}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-sm border transition ${tab === "championship" ? "bg-[#29B6E8] text-black border-[#29B6E8]" : "text-white/70 border-white/10 hover:border-[#29B6E8]/40"}`}
            >
              Gesamtwertung
            </button>
          </div>
        )}

        {tab === "track" && (
          <div className="grid lg:grid-cols-4 gap-6">
            <aside>
              <div className="text-[11px] uppercase tracking-widest font-bold text-white/50 mb-3">Strecken</div>
              <div className="space-y-2">
                {challenge.tracks?.map((tr) => (
                  <button
                    key={tr.id}
                    data-testid={`f1-track-${tr.id}`}
                    onClick={() => setActiveTrack(tr.id)}
                    className={`w-full text-left p-3 border rounded-sm transition flex items-center gap-3 ${
                      activeTrack === tr.id ? "border-[#29B6E8] bg-[#29B6E8]/10" : "border-white/10 hover:border-[#29B6E8]/40"
                    }`}
                  >
                    {tr.image_url ? (
                      <img src={tr.image_url} alt="" className="w-14 h-10 object-cover rounded-sm" />
                    ) : (
                      <div className="w-14 h-10 rounded-sm bg-[#0A0A0A] border border-white/5" />
                    )}
                    <div className="min-w-0">
                      <div className="font-heading font-bold truncate">{tr.name}</div>
                      <div className="text-[10px] uppercase tracking-widest text-white/50">{tr.country}</div>
                    </div>
                  </button>
                ))}
              </div>
            </aside>
            <div className="lg:col-span-3">
              {board?.track?.image_url ? (
                <div className="mb-4 rounded-sm overflow-hidden border border-white/10">
                  <img src={board.track.image_url} alt={board.track.name} className="w-full h-48 object-cover" />
                </div>
              ) : null}
              <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
                <div className="p-4 border-b border-white/10 flex items-center justify-between">
                  <h3 className="font-heading text-xl font-bold">{board?.track?.name || "—"}</h3>
                  <span className="text-[11px] uppercase tracking-widest text-white/50 font-display">{board?.entries?.length || 0} Fahrer</span>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
                    <tr>
                      <th className="text-left px-4 py-3 w-12">#</th>
                      <th className="text-left px-4 py-3">Fahrer</th>
                      <th className="text-right px-4 py-3 font-display">Beste Zeit</th>
                      <th className="text-right px-4 py-3">Abstand</th>
                      <th className="text-right px-4 py-3">Versuche</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {board?.entries?.map((e) => (
                      <tr key={e.user_id} data-testid={`f1-row-${e.rank}`} className={e.rank <= 3 ? "bg-[#29B6E8]/5" : ""}>
                        <td className={`px-4 py-3 font-display font-bold ${e.rank === 1 ? "text-[#FFD700]" : e.rank === 2 ? "text-white/80" : e.rank === 3 ? "text-[#CD7F32]" : "text-[#29B6E8]"}`}>{e.rank}</td>
                        <td className="px-4 py-3">{e.display_name}</td>
                        <td className="px-4 py-3 text-right font-display font-bold text-white tabular-nums">{e.time_str}</td>
                        <td className="px-4 py-3 text-right text-white/60 tabular-nums">{e.gap_str || "—"}</td>
                        <td className="px-4 py-3 text-right text-white/50">{e.attempts}</td>
                      </tr>
                    ))}
                    {(!board || board.entries?.length === 0) && <tr><td colSpan="5" className="text-center py-10 text-white/40">Noch keine Zeiten</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === "championship" && championship && (
          <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center gap-2">
              <Trophy className="w-4 h-4 text-[#FFD700]" />
              <h3 className="font-heading text-xl font-bold">Championship Gesamtwertung</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
                <tr>
                  <th className="text-left px-4 py-3 w-12">#</th>
                  <th className="text-left px-4 py-3">Fahrer</th>
                  <th className="text-right px-4 py-3">Siege</th>
                  <th className="text-right px-4 py-3">Rennen</th>
                  <th className="text-right px-4 py-3 font-display">Punkte</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {championship.standings.map((s) => (
                  <tr key={s.user_id} className={s.rank <= 3 ? "bg-[#FFD700]/5" : ""}>
                    <td className={`px-4 py-3 font-display font-bold ${s.rank === 1 ? "text-[#FFD700]" : s.rank === 2 ? "text-white/80" : s.rank === 3 ? "text-[#CD7F32]" : "text-[#29B6E8]"}`}>{s.rank}</td>
                    <td className="px-4 py-3 text-white">{s.display_name}</td>
                    <td className="px-4 py-3 text-right">{s.wins}</td>
                    <td className="px-4 py-3 text-right">{s.races}</td>
                    <td className="px-4 py-3 text-right font-display font-bold text-[#29B6E8] text-lg">{s.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
