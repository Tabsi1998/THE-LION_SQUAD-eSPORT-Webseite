import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { BadgeCard } from "@/components/tls/BadgeGrid";
import { Link } from "react-router-dom";
import { Medal, TrendingUp } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export default function BadgesPage() {
  const { user } = useAuth();
  const [badges, setBadges] = useState([]);
  const [progress, setProgress] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try { const { data } = await api.get("/badges"); setBadges(data); }
      catch { setBadges([]); }
      if (user) {
        try { const { data } = await api.get("/badges/progress/me"); setProgress(data); }
        catch { setProgress([]); }
      }
      setLoading(false);
    })();
  }, [user]);

  const groups = {};
  for (const b of badges) (groups[b.category || "other"] ||= []).push(b);

  const catLabel = (c) => ({ tournament: "Turniere", match: "Matches", fastlap: "Fast Lap", community: "Community", season: "Saison", club: "Verein", fun: "Fun & Negative", other: "Weitere" }[c] || c);
  const catOrder = ["tournament", "match", "fastlap", "community", "season", "club", "fun", "other"];

  return (
    <PublicLayout>
      <div className="relative border-b border-white/10">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/3 w-96 h-96 rounded-full bg-[#FFD700] blur-[160px] opacity-10" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#FFD700]/10 border border-[#FFD700]/30 rounded-sm mb-4">
            <Medal className="w-3.5 h-3.5 text-[#FFD700]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Honors &amp; Achievements</span>
          </div>
          <h1 className="font-heading text-4xl md:text-6xl font-black uppercase leading-[0.95]">Badge Katalog</h1>
          <p className="mt-3 text-white/70 max-w-2xl">Schalte Abzeichen frei durch Turniere, Fast-Lap-Runden, Community-Beiträge und mehr. Jedes Badge bringt dir Saison-Punkte. Negative Fun-Badges sind augenzwinkernd — bleiben unsichtbar bis sie ausgelöst werden.</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
        {/* Phase B v3 — User progress section */}
        {user && progress.length > 0 && (
          <section data-testid="badge-progress-section">
            <div className="flex items-baseline justify-between mb-4">
              <div>
                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-sm bg-[#29B6E8]/10 border border-[#29B6E8]/30 mb-2">
                  <TrendingUp className="w-3.5 h-3.5 text-[#29B6E8]" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Mein Fortschritt</span>
                </div>
                <h2 className="font-heading text-2xl md:text-3xl font-bold uppercase">Beinahe geschafft</h2>
              </div>
              <span className="text-[10px] uppercase tracking-widest text-white/40">{progress.length} Badges in Arbeit</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {progress.slice(0, 8).map((p) => (
                <BadgeCard key={p.code} badge={p} locked progress={{ current: p.current, target: p.target, percent: p.percent }} />
              ))}
            </div>
          </section>
        )}

        {loading ? (
          <div className="py-20 text-center font-display tracking-widest text-white/40">LADE …</div>
        ) : (
          catOrder.filter((c) => groups[c]?.length).map((cat) => (
            <div key={cat}>
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="font-heading text-2xl md:text-3xl font-bold uppercase">{catLabel(cat)}</h2>
                <span className="text-[10px] uppercase tracking-widest text-white/40">{groups[cat].length} Badges</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {groups[cat].map((b) => (
                  <Link key={b.code} to={`/badges/${b.code}`} data-testid={`badge-link-${b.code}`}>
                    <BadgeCard badge={b} />
                    {b.awarded_count > 0 && (
                      <div className="mt-2 text-center text-[10px] uppercase tracking-widest text-white/40">
                        {b.awarded_count} × verliehen
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </PublicLayout>
  );
}
