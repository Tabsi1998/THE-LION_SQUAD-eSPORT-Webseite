import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { Search, Crown } from "lucide-react";

export default function PlayersPage() {
  const [list, setList] = useState([]);
  const [members, setMembers] = useState([]);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.allSettled([
      api.get("/users/public-list").catch(() => ({ data: [] })),
      api.get("/membership/public"),
    ]).then(([u, m]) => {
      if (u.status === "fulfilled") setList(u.value.data || []);
      if (m.status === "fulfilled") setMembers(m.value.data || []);
      setLoading(false);
    });
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["users", "membership", "achievements"]);

  const memberUsernames = new Set(members.map((m) => m.username));
  const filtered = (tab === "members" ? members : list).filter((p) => {
    if (!q) return true;
    const blob = `${p.username} ${p.display_name || ""}`.toLowerCase();
    return blob.includes(q.toLowerCase());
  });

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">COMMUNITY</span>
        <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-2">Spieler</h1>
        <p className="mt-3 text-white/60 max-w-2xl">
          Alle Spieler der TLS Community. Klick auf ein Profil, um Stats, Achievements und Match-Historie zu sehen.
        </p>

        <div className="mt-8 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div className="flex gap-2">
            <button onClick={() => setTab("all")} data-testid="players-tab-all" className={`px-4 py-2 text-xs uppercase tracking-wider font-bold rounded-sm transition ${tab === "all" ? "bg-[#29B6E8] text-black" : "border border-white/10 text-white/60 hover:text-white"}`}>Alle</button>
            <button onClick={() => setTab("members")} data-testid="players-tab-members" className={`px-4 py-2 text-xs uppercase tracking-wider font-bold rounded-sm transition ${tab === "members" ? "bg-[#FFD700] text-black" : "border border-white/10 text-white/60 hover:text-white"}`}>Vereinsmitglieder</button>
          </div>
          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Spieler suchen…"
              data-testid="players-search"
              className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] pl-9 pr-3 py-2 rounded-sm text-sm"
            />
          </div>
        </div>

        <div className="mt-8">
          {loading ? (
            <div className="text-white/40 text-sm">Lade …</div>
          ) : filtered.length === 0 ? (
            <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">Keine Spieler gefunden.</div>
          ) : (
            <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filtered.map((p) => {
                const isMember = memberUsernames.has(p.username);
                return (
                  <Link
                    key={p.username}
                    to={`/u/${p.username}`}
                    data-testid={`player-card-${p.username}`}
                    className="border border-white/10 hover:border-[#29B6E8]/50 rounded-sm bg-[#121212] p-4 transition group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className={`w-12 h-12 rounded-sm border ${isMember ? "border-[#FFD700]/50" : "border-white/15"} bg-[#0A0A0A] flex items-center justify-center overflow-hidden`}>
                          {p.avatar_url ? (
                            <img src={resolveMediaUrl(p.avatar_url)} alt={p.display_name} className="w-full h-full object-cover" />
                          ) : (
                            <span className={`font-heading font-black ${isMember ? "text-[#FFD700]" : "text-white/40"}`}>{(p.display_name || p.username)[0]}</span>
                          )}
                        </div>
                        {p.profile_completeness != null && (
                          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#0A0A0A] border border-white/20 flex items-center justify-center" title={`Profil ${p.profile_completeness}% komplett`}>
                            <span className="text-[8px] font-bold tabular-nums text-white/70">{p.profile_completeness}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-heading font-bold text-white group-hover:text-[#29B6E8] truncate flex items-center gap-1.5">
                          {p.display_name || p.username}
                          {isMember && <Crown className="w-3 h-3 text-[#FFD700] shrink-0" />}
                        </div>
                        <div className="text-[11px] text-white/45 truncate">@{p.username}</div>
                      </div>
                    </div>
                    {/* Phase C: Top Achievement chip + count */}
                    {p.top_achievement && (
                      <div className="mt-3 flex items-center gap-2 text-[10px] uppercase tracking-widest" data-testid={`player-top-${p.username}`}>
                        <span className="px-1.5 py-0.5 rounded-sm border" style={{ color: p.top_achievement.level_color, borderColor: p.top_achievement.level_color + "55" }}>
                          {p.top_achievement.level_name} · {p.top_achievement.name}
                        </span>
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-white/35">
                      <span>{p.achievements_count || 0} Achievements</span>
                      {p.achievement_level && <span className="text-[#29B6E8] font-bold">Level {p.achievement_level.level}</span>}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </PublicLayout>
  );
}
