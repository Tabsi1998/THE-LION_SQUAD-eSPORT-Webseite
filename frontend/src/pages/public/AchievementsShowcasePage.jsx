import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Trophy, Crown, Medal, Sparkles, Target, Flame, CircleHelp, Gem, ArrowDownWideNarrow, Layers } from "lucide-react";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { AchievementGroupsView, formatPercent } from "@/components/tls/AchievementGroups";
import { AchievementIcon } from "@/components/tls/AchievementIcon";
import { Badge } from "@/components/achievements/Badge";
import { LevelAvatarFrame, useCrownFor } from "@/components/tls/LevelAvatarFrame";
import { SkeletonTable } from "@/components/tls/Skeleton";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useAuth } from "@/context/AuthContext";
import { viennaDate } from "@/lib/vienna";

// Der Schaukasten (#619): Erfolg der Woche, Kategorien mit dem Fortschritt der Community, das Laufband der
// neuesten Freischaltungen, Ranglisten nach Punkten oder Level (je Kategorie und Zeitraum) und der Katalog
// mit Seltenheit je Gruppe - wahlweise nach Kategorie oder nach Seltenheit sortiert. Angemeldet zeigt der Katalog
// den eigenen Fortschritt (E13: wie in der App), als Gast den öffentlichen Katalog.

const RANK_STYLES = {
  1: { color: "#FFD700", ring: "border-[#FFD700]", label: "1" },
  2: { color: "#C0C0C0", ring: "border-[#C0C0C0]", label: "2" },
  3: { color: "#CD7F32", ring: "border-[#CD7F32]", label: "3" },
};

/** „1 Erfolg“, „3 Erfolge“. */
export function erfolge(count) {
  const n = Number(count || 0);
  return `${n} ${n === 1 ? "Erfolg" : "Erfolge"}`;
}

export const PERIODS = [
  { key: "all", label: "Gesamt" },
  { key: "year", label: "Dieses Jahr" },
  { key: "season", label: "Diese Saison" },
  { key: "month", label: "Dieser Monat" },
];

export default function AchievementsShowcasePage() {
  const [groups, setGroups] = useState([]);
  const [overview, setOverview] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [boardLoading, setBoardLoading] = useState(false);
  const [board, setBoard] = useState({ by: "points", category: "", period: "all" });
  const [sortBy, setSortBy] = useState("category");
  const [categoryFilter, setCategoryFilter] = useState(null);
  const { user, isClubMember } = useAuth();

  useDocumentTitle(
    "Erfolge",
    "Alle Erfolge, Abzeichen und Bestenliste von THE LION SQUAD eSports – schalte Erfolge frei und klettere im Ranking.",
  );

  const load = () => {
    const calls = [
      api.get("/achievements/groups"),
      api.get("/achievements/overview").catch(() => null),
    ];
    if (user) calls.push(api.get("/achievements/me").catch(() => null));
    Promise.allSettled(calls).then(([g, ov, mine]) => {
      if (g.status === "fulfilled") setGroups(g.value.data || []);
      if (ov.status === "fulfilled" && ov.value) setOverview(ov.value.data || null);
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

  // Die Rangliste lädt getrennt, weil ihre Schalter (Punkte oder Level, Kategorie, Zeitraum) sie neu holen.
  useEffect(() => {
    let alive = true;
    setBoardLoading(true);
    const params = { limit: 24, by: board.by };
    if (board.by === "points") {
      if (board.category) params.category = board.category;
      if (board.period !== "all") params.period = board.period;
    }
    api.get("/achievements/leaderboard", { params })
      .then(({ data }) => { if (alive) setLeaderboard(Array.isArray(data) ? data : []); })
      .catch(() => { if (alive) setLeaderboard([]); })
      .finally(() => { if (alive) setBoardLoading(false); });
    return () => { alive = false; };
  }, [board]);

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

  const categories = useMemo(() => (overview?.categories || []).filter((c) => c.key !== "negative"), [overview]);
  const hidden = me?.hidden || overview?.hidden || null;
  const podium = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);
  const byLevel = board.by === "level";

  const pickCategory = (key) => {
    setCategoryFilter((current) => (current === key ? null : key));
    if (typeof document !== "undefined") {
      document.getElementById("achievements-catalog")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,#0d2b38_0%,#000_65%)]" />
        <div className="tls-scanline relative max-w-6xl mx-auto px-4 md:px-6 py-14 md:py-20">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-8 items-start">
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
            <WeekTile week={overview?.week} loading={loading} />
          </div>

          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="achievements-stats">
            <StatCard icon={Trophy} label="Erfolge" value={stats.tierCount} accent="#FFD700" />
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
              Du hast bereits <span className="text-[#FFD700] font-bold">{myStats.count}</span> Erfolge
              freigeschaltet · <Link to="/u/me?tab=achievements" className="text-[#29B6E8] hover:underline">Meine Erfolge ansehen</Link>
            </div>
          )}
        </div>
      </section>

      <UnlockTicker items={overview?.recent || []} />

      <div className="max-w-6xl mx-auto px-4 md:px-6 py-10 md:py-14 space-y-14">
        {/* Kategorien mit dem Fortschritt der Community */}
        {categories.length > 0 && (
          <section data-testid="achievements-categories">
            <div className="flex items-baseline justify-between gap-3 mb-6 flex-wrap">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-[#00FF88]" />
                <h2 className="font-heading text-2xl md:text-3xl font-bold uppercase">Kategorien</h2>
              </div>
              <span className="text-[10px] uppercase tracking-widest text-white/40">
                Fortschritt der Community · {overview?.rarity?.base ?? 0} Konten
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {categories.map((cat, index) => (
                <CategoryTile
                  key={cat.key}
                  category={cat}
                  hidden={cat.key === "hidden" ? hidden : null}
                  active={categoryFilter === cat.key}
                  index={index}
                  onPick={() => pickCategory(cat.key)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Leaderboard */}
        <section data-testid="achievements-leaderboard">
          <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
            <div className="flex items-center gap-2">
              <Medal className="w-5 h-5 text-[#FFD700]" />
              <h2 className="font-heading text-2xl md:text-3xl font-bold uppercase">Bestenliste</h2>
            </div>
            <div className="flex items-center gap-2 flex-wrap" data-testid="leaderboard-controls">
              <Toggle
                value={board.by}
                onChange={(by) => setBoard((b) => ({ ...b, by }))}
                options={[{ key: "points", label: "Erfolgspunkte" }, { key: "level", label: "Level" }]}
                testId="leaderboard-by"
              />
              {!byLevel && (
                <>
                  <select
                    value={board.category}
                    onChange={(event) => setBoard((b) => ({ ...b, category: event.target.value }))}
                    className="bg-[#0A0A0A] border border-white/15 rounded-sm px-2 py-1.5 text-xs uppercase tracking-widest text-white/80"
                    aria-label="Kategorie"
                    data-testid="leaderboard-category"
                  >
                    <option value="">Alle Kategorien</option>
                    {categories.filter((c) => c.key !== "hidden").map((c) => (
                      <option key={c.key} value={c.key}>{c.label}</option>
                    ))}
                  </select>
                  <Toggle
                    value={board.period}
                    onChange={(period) => setBoard((b) => ({ ...b, period }))}
                    options={PERIODS}
                    testId="leaderboard-period"
                  />
                </>
              )}
            </div>
          </div>

          {leaderboard.length === 0 && (loading || boardLoading) ? (
            <SkeletonTable rows={5} columns={4} label="Lade Bestenliste" />
          ) : leaderboard.length === 0 ? (
            <div className="border border-dashed border-white/10 rounded-sm p-10 text-center text-white/45" data-testid="leaderboard-empty">
              {board.period !== "all" || board.category
                ? "In diesem Ausschnitt gibt es noch keine Platzierungen."
                : "Noch keine Platzierungen – sei der Erste und schalte Erfolge frei!"}
            </div>
          ) : (
            <>
              {/* Podium */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                {podium.map((entry, index) => (
                  <PodiumCard key={entry.user_id} entry={entry} index={index} byLevel={byLevel} />
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
                        {Number(entry.prestige || 0) > 0 && <span className="ml-1 text-[#FFD700]" title={`Prestige ${entry.prestige}`}>{"★".repeat(Math.min(5, Number(entry.prestige)))}</span>}
                      </Link>
                      <span className="text-xs text-white/40 tabular-nums">{byLevel ? (entry.title || `Level ${entry.level}`) : erfolge(entry.count)}</span>
                      <span className="font-display font-bold text-[#FFD700] tabular-nums shrink-0">{byLevel ? `Lv ${entry.level}` : entry.points}</span>
                    </motion.div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {/* Trophy wall */}
        <section data-testid="achievements-catalog" id="achievements-catalog">
          <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-[#29B6E8]" />
              <h2 className="font-heading text-2xl md:text-3xl font-bold uppercase">Alle Erfolge</h2>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {categoryFilter && (
                <button
                  type="button"
                  onClick={() => setCategoryFilter(null)}
                  className="tls-btn tls-btn--quiet text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-sm"
                  data-testid="catalog-filter-clear"
                >
                  Nur {categories.find((c) => c.key === categoryFilter)?.label || categoryFilter} · alle zeigen
                </button>
              )}
              <Toggle
                value={sortBy}
                onChange={setSortBy}
                options={[{ key: "category", label: "Nach Kategorie", icon: Layers }, { key: "rarity", label: "Nach Seltenheit", icon: ArrowDownWideNarrow }]}
                testId="catalog-sort"
              />
            </div>
          </div>
          {loading && groups.length === 0 ? (
            <div className="text-white/40 py-10 text-center">Lade Erfolge …</div>
          ) : (
            <AchievementGroupsView
              groups={me?.groups || groups}
              rarity={overview?.rarity || null}
              sortBy={sortBy}
              hidden={hidden}
              clubTeaser={!isClubMember}
              categoryFilter={categoryFilter}
            />
          )}
        </section>
      </div>
    </PublicLayout>
  );
}

function Toggle({ value, onChange, options, testId }) {
  return (
    <div className="inline-flex border border-white/15 rounded-sm overflow-hidden" role="group" data-testid={testId}>
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest transition ${active ? "bg-[#29B6E8]/15 text-[#29B6E8]" : "text-white/55 hover:text-white"}`}
            data-testid={`${testId}-${option.key}`}
          >
            {Icon && <Icon className="w-3 h-3" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// Der Erfolg der Woche (#619): die Freischaltung der vergangenen Woche, die am wenigsten Leute haben.
function WeekTile({ week, loading }) {
  const award = week?.award || null;
  const color = award?.material_color || "#FFD700";
  return (
    <motion.aside
      data-testid="achievement-of-week"
      className="relative border rounded-sm bg-[#0A0A0A]/80 p-5 overflow-hidden"
      style={{ borderColor: `${color}55`, boxShadow: `inset 0 0 0 1px ${color}14, 0 0 32px ${color}10` }}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15 }}
    >
      <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full blur-2xl opacity-30 pointer-events-none" style={{ backgroundColor: color }} aria-hidden="true" />
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.35em]" style={{ color }}>
        <Gem className="w-3.5 h-3.5" /> Erfolg der Woche
      </div>
      {award ? (
        <div className="mt-3 flex items-start gap-4">
          <Badge material={award.material} level={award.level} rank={award.rank} art={award.art} icon={award.icon} size="xl" animate title={award.name} testId="week-award-badge" />
          <div className="min-w-0 flex-1">
            <div className="font-heading text-lg md:text-xl font-black uppercase leading-tight truncate" data-testid="week-award-name">{award.name}</div>
            <div className="text-[10px] uppercase tracking-widest text-white/45 mt-0.5 truncate">{award.group_name} · <span style={{ color }}>{award.material_name}</span></div>
            <div className="mt-2 text-xs text-white/60" data-testid="week-award-rarity">
              Nur <span className="text-white font-bold tabular-nums">{formatPercent(award.percent)}</span> haben das · {award.holders === 1 ? "eine Person" : `${award.holders} Personen`}
            </div>
            <Link to={award.user?.username ? `/u/${award.user.username}` : "#"} className="mt-3 inline-flex items-center gap-2 text-sm hover:text-[#29B6E8]" data-testid="week-award-user">
              <Avatar entry={award.user || {}} size={7} />
              <span className="font-semibold truncate">{award.user?.display_name || "Spieler"}</span>
              {award.earned_at && <span className="text-white/35 text-xs">{viennaDate(award.earned_at)}</span>}
            </Link>
            {award.award_id && (
              <Link to={`/achievements/a/${encodeURIComponent(award.award_id)}`} className="mt-2 ml-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest hover:underline" style={{ color }} data-testid="week-award-card">
                Karte ansehen
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3 text-sm text-white/55" data-testid="week-award-empty">
          {loading ? "Wird geladen …" : "Vergangene Woche gab es keine Freischaltung auf einem öffentlichen Profil – die nächste Kachel gehört dir."}
        </div>
      )}
      {week?.week_key && <div className="mt-3 text-[9px] uppercase tracking-widest text-white/30">Kalenderwoche {String(week.week_key).split("-W")[1]} · montags 08:00 neu</div>}
    </motion.aside>
  );
}

function CategoryTile({ category, hidden, active, index, onPick }) {
  const isHidden = category.key === "hidden";
  const percent = Math.max(0, Math.min(100, Number(category.community_percent || 0)));
  return (
    <motion.button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      data-testid={`category-tile-${category.key}`}
      className={`text-left border rounded-sm bg-[#0F0F10] p-4 transition ${active ? "border-white/40" : "border-white/10 hover:border-white/25"}`}
      style={{ boxShadow: `inset 0 0 0 1px ${category.accent}${active ? "44" : "14"}` }}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: Math.min(index * 0.04, 0.4) }}
      whileHover={{ y: -3 }}
    >
      <div className="flex items-center gap-2">
        {isHidden
          ? <CircleHelp className="w-4 h-4" style={{ color: category.accent }} />
          : <AchievementIcon name={category.icon} fallback="trophy" className="w-4 h-4" style={{ color: category.accent }} />}
        <span className="font-heading font-bold uppercase text-sm md:text-base truncate">{category.label}</span>
        {category.member_only && <span className="ml-auto text-[9px] uppercase tracking-widest text-[#FFD700]/80 shrink-0">Mitglieder</span>}
      </div>
      {isHidden ? (
        <div className="mt-3 font-display text-xl font-black tabular-nums" style={{ color: category.accent }} data-testid="category-hidden-count">
          {hidden ? `${hidden.earned} von ${hidden.total}` : `${category.groups}`}
          <span className="block text-[10px] uppercase tracking-widest text-white/45 font-bold mt-0.5">gefunden</span>
        </div>
      ) : (
        <>
          <div className="mt-3 flex items-baseline justify-between gap-2">
            <span className="font-display text-xl font-black tabular-nums" style={{ color: category.accent }}>{formatPercent(percent)}</span>
            <span className="text-[10px] uppercase tracking-widest text-white/45">{category.groups} Gruppen · {category.tiers} Stufen</span>
          </div>
          <div className="mt-2 h-1.5 bg-white/5 rounded-sm overflow-hidden">
            <motion.div className="h-full" style={{ backgroundColor: category.accent }} initial={{ width: 0 }} whileInView={{ width: `${percent}%` }} viewport={{ once: true }} transition={{ duration: 0.9, ease: "easeOut" }} />
          </div>
          <div className="mt-1.5 text-[10px] uppercase tracking-widest text-white/40 tabular-nums">
            {category.holders === 1 ? "eine Person dabei" : `${category.holders} Personen dabei`}
          </div>
        </>
      )}
    </motion.button>
  );
}

// Das Laufband (#619): die neuesten Freischaltungen öffentlicher Profile - ab vier Einträgen als Marquee,
// sonst als ruhige Zeile; bei reduzierter Bewegung steht es still.
function UnlockTicker({ items }) {
  if (!items.length) return null;
  const marquee = items.length >= 4;
  const loop = marquee ? [...items, ...items] : items;
  const duration = Math.max(28, items.length * 5);
  const renderItem = (item, index, duplicate) => (
    <Link
      key={`${item.award_id || item.tier_code}-${item.user?.id || index}-${duplicate ? "b" : "a"}`}
      to={item.user?.username ? `/u/${item.user.username}` : "#"}
      tabIndex={duplicate ? -1 : undefined}
      aria-hidden={duplicate ? "true" : undefined}
      className="inline-flex items-center gap-2 px-5 text-xs whitespace-nowrap hover:text-white"
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: item.material_color || "#29B6E8", boxShadow: `0 0 6px ${item.material_color || "#29B6E8"}` }} aria-hidden="true" />
      <span className="font-semibold text-white/85">{item.user?.display_name || "Spieler"}</span>
      <span className="text-white/45">hat</span>
      <span className="font-bold" style={{ color: item.material_color || "#FFD700" }}>{item.name}</span>
      <span className="text-white/35">({item.material_name})</span>
    </Link>
  );
  return (
    <section className="border-b border-white/5 bg-[#070707] overflow-hidden" data-testid="unlock-ticker" data-marquee={marquee ? "true" : "false"}>
      <div className="max-w-6xl mx-auto px-4 md:px-6 flex items-center">
        <span className="shrink-0 text-[9px] uppercase tracking-[0.35em] font-bold text-white/35 py-2.5 pr-4 border-r border-white/10">Zuletzt freigeschaltet</span>
        <div className="flex-1 overflow-hidden" style={marquee ? { maskImage: "linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)" } : undefined}>
          <div className={`flex items-center py-2 ${marquee ? "tls-unlock-ticker__track" : "flex-wrap"}`} style={marquee ? { "--ticker-duration": `${duration}s` } : undefined}>
            {loop.map((item, index) => renderItem(item, index, marquee && index >= items.length))}
          </div>
        </div>
      </div>
    </section>
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

function levelFromPoints(points) {
  let level = 1;
  const p = Math.max(0, Number(points || 0));
  while (p >= level * level * 100) level += 1;
  return level;
}

function PodiumCard({ entry, index, byLevel = false }) {
  const style = RANK_STYLES[entry.rank] || RANK_STYLES[3];
  const isFirst = entry.rank === 1;
  const crown = useCrownFor(entry.user_id);
  const level = Number(entry.level || 0) > 0 ? Number(entry.level) : levelFromPoints(entry.points);
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
      <div className={`mx-auto mb-3 flex justify-center ${crown ? "pt-4" : ""}`}>
        <LevelAvatarFrame level={level} crown={crown} compact className="w-16 h-16">
          {entry.avatar_url ? (
            <img src={resolveMediaUrl(entry.avatar_url)} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center font-bold text-white/60">
              {(entry.display_name || "?").trim().charAt(0).toUpperCase()}
            </div>
          )}
        </LevelAvatarFrame>
      </div>
      <Link
        to={entry.username ? `/u/${entry.username}` : "#"}
        className="block font-heading font-bold uppercase truncate hover:text-[#29B6E8]"
      >
        {entry.display_name}
        {Number(entry.prestige || 0) > 0 && <span className="ml-1 text-[#FFD700]" title={`Prestige ${entry.prestige}`}>{"★".repeat(Math.min(5, Number(entry.prestige)))}</span>}
      </Link>
      <div className="mt-2 font-display text-2xl font-black tabular-nums" style={{ color: style.color }}>
        {byLevel ? `Level ${entry.level}` : entry.points}
      </div>
      <div className="text-[10px] uppercase tracking-widest text-white/55">{byLevel ? (entry.title || `${entry.xp || 0} XP`) : erfolge(entry.count)}</div>
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
