import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { formatDateTime } from "@/lib/datetime";
import { toast } from "sonner";

export default function MatchHubPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [m, setM] = useState(null);
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [reportNote, setReportNote] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [disputeReason, setDisputeReason] = useState("");

  const load = useCallback(async () => {
    const { data } = await api.get(`/matches/${id}`);
    setM(data);
    setScoreA(data.score_a || 0);
    setScoreB(data.score_b || 0);
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["matches", "tournaments"]);

  if (!m) return <PublicLayout><div className="p-20 text-center text-white/40 font-display tracking-widest">LADE …</div></PublicLayout>;
  const a = m.participant_a, b = m.participant_b;

  const reportScore = async () => {
    try {
      await api.post(`/matches/${m.id}/report`, {
        score_a: Number(scoreA),
        score_b: Number(scoreB),
        note: reportNote || null,
        screenshot_url: proofUrl || null,
      });
      toast.success("Ergebnis gemeldet.");
      setReportNote("");
      setProofUrl("");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const raiseDispute = async () => {
    if (!disputeReason.trim()) { toast.error("Bitte Grund angeben."); return; }
    try {
      await api.post(`/matches/${m.id}/dispute`, { reason: disputeReason });
      toast.success("Klärfall erstellt.");
      setDisputeReason("");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const isParticipant = user && [a?.user_id, b?.user_id].includes(user.id);

  return (
    <PublicLayout>
      <div className="max-w-4xl mx-auto px-4 py-10">
        <Link to={`/tournaments/${m.tournament_id}`} className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] hover:text-white">← Zum Turnier</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <StatusBadge status={m.status} size="lg" />
          <span className="text-sm text-white/60">{m.round_name} · Best of {m.best_of}</span>
          {m.scheduled_at && <span className="text-sm text-[#29B6E8]">{formatDateTime(m.scheduled_at)}</span>}
          {m.duration_minutes && <span className="text-sm text-white/50">{m.duration_minutes} Min.</span>}
        </div>
        <h1 className="mt-2 font-heading text-3xl md:text-5xl font-black uppercase">Spiel-Hub</h1>

        <div className="mt-8 grid grid-cols-2 gap-4 items-center">
          <SideCard side="A" reg={a} score={m.score_a} isWinner={m.winner_id === m.participant_a_id} />
          <SideCard side="B" reg={b} score={m.score_b} isWinner={m.winner_id === m.participant_b_id} />
        </div>

        {isParticipant && m.status !== "completed" && m.status !== "forfeit" && (
          <div className="mt-8 border border-white/10 rounded-sm bg-[#121212] p-5">
            <h2 className="font-heading text-lg font-bold uppercase mb-4">Ergebnis melden</h2>
            <div className="grid sm:grid-cols-[1fr_auto_1fr] gap-4 items-end">
              <label className="block">
                <span className="block text-[11px] font-bold uppercase tracking-widest text-white/50 mb-1">{a?.display_name || "Seite A"} Punkte</span>
                <input type="number" value={scoreA} onChange={(e) => setScoreA(e.target.value)} data-testid="match-score-a" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm font-display text-2xl font-bold text-center" placeholder="Punkte" />
              </label>
              <span className="hidden sm:block font-display text-2xl text-white/40 pb-2">:</span>
              <label className="block">
                <span className="block text-[11px] font-bold uppercase tracking-widest text-white/50 mb-1">{b?.display_name || "Seite B"} Punkte</span>
                <input type="number" value={scoreB} onChange={(e) => setScoreB(e.target.value)} data-testid="match-score-b" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm font-display text-2xl font-bold text-center" placeholder="Punkte" />
              </label>
            </div>
            <div className="mt-4 grid sm:grid-cols-2 gap-3">
              <input type="url" value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} className="bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="Screenshot-/Beweis-Link optional" />
              <input type="text" value={reportNote} onChange={(e) => setReportNote(e.target.value)} className="bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="Notiz optional" />
            </div>
            <button onClick={reportScore} data-testid="match-report-btn" className="mt-4 px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2]">Ergebnis melden</button>
            <p className="mt-3 text-xs text-white/50">Wenn beide Seiten das gleiche Ergebnis melden, wird das Spiel automatisch bestätigt. Unterschiedliche Meldungen werden als Klärfall markiert und von der Turnierleitung entschieden.</p>

            <div className="mt-6 border-t border-white/5 pt-5">
              <input type="text" placeholder="Grund für Klärung" value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} data-testid="match-dispute-input" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
              <button onClick={raiseDispute} data-testid="match-dispute-btn" className="mt-2 px-4 py-2 border border-[#FF3B30]/40 text-[#FF3B30] font-bold text-sm uppercase tracking-wider rounded-sm hover:bg-[#FF3B30]/10">Klärung melden</button>
            </div>
          </div>
        )}

        {m.reports?.length > 0 && (
          <div className="mt-6 border border-white/10 rounded-sm bg-[#121212] p-5">
            <h3 className="font-heading font-bold uppercase mb-3 text-sm">Meldungen</h3>
            <div className="space-y-2">
              {m.reports.map((r, i) => (
                <div key={i} className="text-sm text-white/70 flex justify-between border-b border-white/5 pb-2">
                  <span className="font-display">{r.score_a} : {r.score_b}</span>
                  <span className="text-white/40">{new Date(r.at).toLocaleString("de-DE")}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}

function SideCard({ side, reg, score, isWinner }) {
  return (
    <div className={`border rounded-sm p-6 bg-[#121212] ${isWinner ? "border-[#29B6E8] shadow-[0_0_16px_rgba(41,182,232,0.25)]" : "border-white/10"}`}>
      <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">Seite {side}</div>
      <div className="mt-2 font-heading text-xl font-bold truncate">{reg?.display_name || reg?.ingame_name || reg?.user?.display_name || "Offen"}</div>
      <div className={`mt-3 font-display text-5xl font-bold ${isWinner ? "text-[#29B6E8]" : "text-white/70"}`}>{score ?? 0}</div>
    </div>
  );
}
