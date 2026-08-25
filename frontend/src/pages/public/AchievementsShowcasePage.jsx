import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Trophy, Crown, Medal, Sparkles, Target, Flame } from "lucide-react";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { AchievementGroupsView } from "@/components/tls/AchievementGroups";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useAuth } from "@/context/AuthContext";

const RANK_STYLES = {
  1: { color: "#FFD700", ring: "border-[#FFD700]", label: "1" },
  2: { color: "#C0C0C0", ring: "border-[#C0C0C0]", label: "2" },
  3: { color: "#CD7F32", ring: "border-[#CD7F32]", label: "3" },
};

export default function AchievementsShowcasePage() {
  const [groups, setGroups] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useDocumentTitle(
    "Achievements",
    "Alle Erfolge, Abzeichen und Bestenliste von THE LION SQUAD eSports – schalte Achievements frei und klettere im Ranking.",
  );

  const load = () => {
    const calls = [
      api.get("/achievements/groups"),
      api.get("/achievements/leaderboard", { params: { limit: 24 } }),
    ];
    if (user) calls.push(api.get("/achievements/me").catch(() => null));
    Promise.allSettled(calls).then(([g, lb, mine]) => {
      if (g.status === "fulfilled") setGroups(g.value.data || []);
      if (lb.status === "fulfilled") setLeaderboard(lb.value.data || []);
      if (mine && mine.status === "fulfilled" && mine.value) setMe(mine.value.data || null);
      else if (!user) setMe(null);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
  useApiInvalidation(load, ["achievements", "badges", "users"]);

  const stats = useMemo(() => {
    let tierCount = 0;
    let pointsTotal = 0;
    const categories = new Set();
    for (const group of groups) {
      if (group.is_negative) continue;
      categories.add(group.category);
      for (const tier of group.tiers || []) {
        tierCount += 1;
        pointsTotal += Number(tier.points || 0);
      }
    }
    return { tierCount, pointsTotal, categoryCount: categories.size };
  }, [groups]);

  const myStats = useMemo(() => {
    if (!me?.groups) return null;
    let count = 0;
    let points = 0;
    for (const group of me.groups) {
      if (group.is_negative) continue;
      for (const tier of group.tiers || []) {
        if (tier.earned) {
          count += 1;
          points += Number(tier.points || 0);
        }
      }
    }
    return { count, points };
  }, [me]);

  const podium = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,#0d2b38_0%,#000_65%)]" />
        <div className="tls-scanline relative max-w-6xl mx-auto px-4 md:px-6 py-14 md:py-20">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.4em] text-[#29B6E8]">
              <Sparkles className="w-4 h-4" /> Ruhmeshalle
            </div>
            <h1 className="font-heading text-4xl md:text-6xl font-black uppercase mt-3 leading-none">
              Achieve<span className="text-[#FFD700]">ments</span>
            </h1>
            <p className="mt-4 max-w-2xl text-white/60 md:text-lg">
              Spiele Matches, gewinne Turniere, fahre Bestzeiten und engagiere dich im Verein –
              jede Aktion bringt dich weiter. Schalte Abzeichen frei und klettere in der Bestenliste.
            </p>
          </motion.div>

          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="achievements-stats">
            <StatCard icon={Trophy} label="Achievements" value={stats.tierCount} accent="#FFD700" />
            <StatCard icon={Target} label="Punkte zu holen" value={stats.pointsTotal} accent="#29B6E8" />
            <StatCard icon={Flame} label="Kategorien" value={stats.categoryCount} accent="#00FF88" />
            {myStats ? (
              <StatCard icon={Crown} label="Deine Punkte" value={myStats.points} accent="#A855F7" testId="my-points" />
            ) : (
              <Link to="/register" className="group">
                <StatCard icon={Crown} label="Jetzt mitmachen" value="→" accent="#A855F7" />
              </Link>
            )}
          </div>

          {myStats && (
            <div className="mt-4 text-sm text-white/60" data-testid="my-achievement-summary">
              Du hast bereits <span className="text-[#FFD700] font-bold">{myStats.count}</span> Achievements
              freigeschaltet · <Link to="/profile?tab=achievements" className="text-[#29B6E8] hover:underline">Meine Achievements ansehen</Link>
            </div>
          )}
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-4 md:px-6 py-10 md:py-14 space-y-14">
        {/* Leaderboard */}
        <section data-testid="achievements-leaderboard">
          <div className="flex items-center gap-2 mb-6">
            <Medal className="w-5 h-5 text-[#FFD700]" />
            <h2 className="font-heading text-2xl md:text-3xl font-bold uppercase">Bestenliste</h2>
          </div>

          {leaderboard.length === 0 ? (
            <div className="border border-dashed border-white/10 rounded-sm p-10 text-center text-white/45">
              {loading ? "Lade Bestenliste …" : "Noch keine Platzierungen – sei der Erste und schalte Achievements frei!"}
            </div>
          ) : (
            <>
              {/* Podium */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                {podium.map((entry, index) => (
                  <PodiumCard key={entry.user_id} entry={entry} index={index} />
                ))}
              </div>
              {/* Rest */}
              {rest.length > 0 && (
                <div className="border border-white/10 rounded-sm overflow-hidden divide-y divide-white/5">
                  {rest.map((entry, index) => (
                    <motion.div
                      key={entry.user_id}
                      data-testid={`leaderboard-row-${entry.rank}`}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02]"
                      initial={{ opacity: 0, x: -12 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: Math.min(index * 0.04, 0.4) }}
                    >
                      <span className="w-7 text-center font-display font-bold text-white/40 tabular-nums">{entry.rank}</span>
                      <Avatar entry={entry} size={9} />
                      <Link
                        to={entry.username ? `/u/${entry.username}` : "#"}
                        className="flex-1 min-w-0 truncate font-semibold text-white/85 hover:text-[#29B6E8]"
                      >
                        {entry.display_name}
                      </Link>
                      <span className="text-xs text-white/40 tabular-nums">{entry.count} Erfolge</span>
                      <span className="font-display font-bold text-[#FFD700] tabular-nums shrink-0">{entry.points}</span>
                    </motion.div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {/* Trophy wall */}
        <section data-testid="achievements-catalog">
          <div className="flex items-center gap-2 mb-6">
            <Trophy className="w-5 h-5 text-[#29B6E8]" />
            <h2 className="font-heading text-2xl md:text-3xl font-bold uppercase">Alle Achievements</h2>
          </div>
          {loading && groups.length === 0 ? (
            <div className="text-white/40 py-10 text-center">Lade Achievements …</div>
          ) : (
            <AchievementGroupsView groups={groups} />
          )}
        </section>
      </div>
    </PublicLayout>
  );
}

function StatCard({ icon: Icon, label, value, accent, testId }) {
  return (
    <div
      data-testid={testId}
      className="border border-white/10 rounded-sm bg-[#0A0A0A]/70 p-4 transition-all hover:border-white/25"
      style={{ boxShadow: `inset 0 0 0 1px ${accent}12` }}
    >
      <Icon className="w-5 h-5 mb-2" style={{ color: accent }} />
      <div className="font-display text-2xl md:text-3xl font-black tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-white/45 mt-1">{label}</div>
    </div>
  );
}

function PodiumCard({ entry, index }) {
  const style = RANK_STYLES[entry.rank] || RANK_STYLES[3];
  const isFirst = entry.rank === 1;
  return (
    <motion.div
      data-testid={`podium-${entry.rank}`}
      className={`relative border rounded-sm bg-[#0F0F10] p-5 text-center ${isFirst ? "sm:-mt-2" : ""}`}
      style={{ borderColor: style.color + "55", boxShadow: `0 0 0 1px ${style.color}18, 0 0 26px ${style.color}12` }}
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.12, type: "spring", stiffness: 200, damping: 18 }}
    >
      <div
        className="mx-auto w-9 h-9 rounded-full border-2 flex items-center justify-center font-display font-black mb-3"
        style={{ borderColor: style.color, color: style.color }}
      >
        {entry.rank}
      </div>
      <div className="mx-auto mb-3">
        <Avatar entry={entry} size={16} ring={style.ring} center />
      </div>
      <Link
        to={entry.username ? `/u/${entry.username}` : "#"}
        className="block font-heading font-bold uppercase truncate hover:text-[#29B6E8]"
      >
        {entry.display_name}
      </Link>
      <div className="mt-2 font-display text-2xl font-black tabular-nums" style={{ color: style.color }}>
        {entry.points}
      </div>
      <div className="text-[10px] uppercase tracking-widest text-white/55">{entry.count} Erfolge</div>
      {isFirst && <Crown className="absolute top-3 right-3 w-5 h-5 text-[#FFD700]" />}
    </motion.div>
  );
}

function Avatar({ entry, size = 10, ring = "border-white/15", center = false }) {
  const dim = `${size * 4}px`;
  const src = entry.avatar_url ? resolveMediaUrl(entry.avatar_url) : null;
  const initial = (entry.display_name || "?").trim().charAt(0).toUpperCase();
  return src ? (
    <img
      src={src}
      alt=""
      className={`rounded-sm object-cover border ${ring} ${center ? "mx-auto" : ""}`}
      style={{ width: dim, height: dim }}
    />
  ) : (
    <div
      className={`rounded-sm border ${ring} bg-white/5 flex items-center justify-center font-bold text-white/60 ${center ? "mx-auto" : ""}`}
      style={{ width: dim, height: dim }}
    >
      {initial}
    </div>
  );
}
