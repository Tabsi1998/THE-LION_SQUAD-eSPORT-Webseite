import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { BadgeCard } from "@/components/tls/BadgeGrid";
import { Link } from "react-router-dom";
import { Medal } from "lucide-react";

export default function BadgesPage() {
  const [badges, setBadges] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try { const { data } = await api.get("/badges"); setBadges(data); }
      catch { setBadges([]); }
      setLoading(false);
    })();
  }, []);

  const groups = {};
  for (const b of badges) (groups[b.category || "other"] ||= []).push(b);

  const catLabel = (c) => ({ tournament: "Turniere", match: "Matches", fastlap: "Fast Lap", community: "Community", season: "Saison", other: "Weitere" }[c] || c);
  const catOrder = ["tournament", "match", "fastlap", "community", "season", "other"];

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
          <p className="mt-3 text-white/70 max-w-2xl">Schalte Abzeichen frei durch Turniere, Fast-Lap-Runden, Community-Beiträge und mehr. Jedes Badge bringt dir Saison-Punkte.</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
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
