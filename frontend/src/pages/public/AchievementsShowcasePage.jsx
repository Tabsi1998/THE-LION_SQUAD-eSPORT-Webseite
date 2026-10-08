import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Trophy, Crown, Medal, Sparkles, Target, Flame, CircleHelp, Gem, ArrowDownWideNarrow, Layers, ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { AchievementCategoryGroups, CATEGORY_META, formatPercent } from "@/components/tls/AchievementGroups";
import { AchievementIcon } from "@/components/tls/AchievementIcon";
import { Badge } from "@/components/achievements/Badge";
import { LevelAvatarFrame, useCrownFor } from "@/components/tls/LevelAvatarFrame";
import { SkeletonTable } from "@/components/tls/Skeleton";
import { SizedImage } from "@/components/tls/SizedImage";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useAuth } from "@/context/AuthContext";
import { viennaDate } from "@/lib/vienna";

// Der Schaukasten (#619): Erfolg der Woche, Laufband der neuesten Freischaltungen, Kategorien mit Fortschritt und
// Ranglisten nach Punkten oder Level (je Kategorie und Zeitraum).
// Kürzer und leichter (#1229): die Kategorien stehen zugeklappt als je eine Zeile mit Fortschritt - angemeldet der
// eigene („12 von 40 · 30 %“), als Gast der der Community. Erst das Aufklappen holt die Gruppen der Kategorie vom
// Server und zeichnet ihre Abzeichen; mehrere dürfen gleichzeitig offen sein. Die Bestenliste zeigt Podest und
// Plätze 4 bis 10, „Alle anzeigen“ lädt weiter. Vorher waren es am Handy über 30 Bildschirme und 10 MB.

const RANK_STYLES = {
  1: { color: "#FFD700", ring: "border-[#FFD700]", label: "1" },
  2: { color: "#C0C0C0", ring: "border-[#C0C0C0]", label: "2" },
  3: { color: "#CD7F32", ring: "border-[#CD7F32]", label: "3" },
};

// Die Bestenliste: erst die besten zehn, „Alle anzeigen“ holt bis zu 100 (mehr gibt der Server nicht her).
export const BOARD_TOP = 10;
export const BOARD_ALL = 100;

/** „1 Erfolg“, „3 Erfolge“. */
export function erfolge(count) {
  const n = Number(count || 0);
  return `${n} ${n === 1 ? "Erfolg" : "Erfolge"}`;
}

function zahlwort(count, one, many) {
  const n = Number(count || 0);
  return `${n} ${n === 1 ? one : many}`;
}

export const PERIODS = [
  { key: "all", label: "Gesamt" },
  { key: "year", label: "Dieses Jahr" },
  { key: "season", label: "Diese Saison" },
  { key: "month", label: "Dieser Monat" },
];

/** Die Zeilen der Kategorien: alles aus der Übersicht außer Negativ - das bekommt nur, wer selbst etwas davon hat. */
export function categoryRows(overview, mine) {
  const rows = (overview?.categories || []).filter((category) => category.key !== "negative");
  if (Number(mine?.negative || 0) > 0) {
    const meta = CATEGORY_META.negative;
    rows.push({ key: "negative", label: meta.label, icon: meta.icon, accent: meta.accent, groups: 0, tiers: 0, negative: true });
  }
  return rows;
}

export default function AchievementsShowcasePage() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [leaderboard, setLeaderboard] = useState([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [board, setBoard] = useState({ by: "points", category: "", period: "all" });
  const [showAll, setShowAll] = useState(false);
  // Reihenfolge je offener Kategorie: Katalog oder die seltensten zuerst.
  const [sortBy, setSortBy] = useState({});
  const [open, setOpen] = useState(() => new Set());
  const [catalog, setCatalog] = useState({});
  const { user, isClubMember } = useAuth();
  const userId = user?.id || null;
  const openRef = useRef(open);
  openRef.current = open;

  useDocumentTitle(
    "Erfolge",
    "Alle Erfolge, Abzeichen und Bestenliste von THE LION SQUAD eSports – schalte Erfolge frei und klettere im Ranking.",
  );

  // Die Übersicht hängt am Konto (eigener Stand, gefundene Geheimnisse) - nach dem Anmelden neu.
  const loadOverview = useCallback(() => {
    api.get("/achievements/overview")
      .then(({ data }) => setOverview(data || null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview, userId]);

  // Die Gruppen einer Kategorie - angemeldet mit dem eigenen Fortschritt.
  const fetchCategory = useCallback((key) => {
    setCatalog((current) => ({ ...current, [key]: { status: "loading", groups: current[key]?.groups || [] } }));
    const params = { category: key };
    if (userId) params.mine = true;
    return api.get("/achievements/groups", { params })
      .then(({ data }) => setCatalog((current) => ({ ...current, [key]: { status: "ready", groups: Array.isArray(data) ? data : [] } })))
      .catch(() => setCatalog((current) => ({ ...current, [key]: { status: "error", groups: [] } })));
  }, [userId]);

  // Anderes Konto: offene Kategorien mit dem neuen Stand nachladen, geschlossene vergessen.
  useEffect(() => {
    setCatalog({});
    for (const key of openRef.current) fetchCategory(key);
  }, [fetchCategory]);

  useApiInvalidation(() => {
    loadOverview();
    for (const key of openRef.current) fetchCategory(key);
  }, ["achievements", "badges", "users"]);

  const toggleCategory = (key) => {
    const opening = !open.has(key);
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    const known = catalog[key];
    if (opening && (!known || known.status === "error")) fetchCategory(key);
  };

  // Die Rangliste lädt getrennt, weil ihre Schalter (Punkte oder Level, Kategorie, Zeitraum) sie neu holen.
  useEffect(() => {
    let alive = true;
    setBoardLoading(true);
    const params = { limit: showAll ? BOARD_ALL : BOARD_TOP, by: board.by };
    if (board.by === "points") {
      if (board.category) params.category = board.category;
      if (board.period !== "all") params.period = board.period;
    }
    api.get("/achievements/leaderboard", { params })
      .then(({ data }) => { if (alive) setLeaderboard(Array.isArray(data) ? data : []); })
      .catch(() => { if (alive) setLeaderboard([]); })
      .finally(() => { if (alive) setBoardLoading(false); });
    return () => { alive = false; };
  }, [board, showAll]);

  // Die Zahlen oben aus der Übersicht - ohne den ganzen Katalog zu laden. Geheim zählt nicht mit (wie bisher).
  const stats = useMemo(() => {
    let tierCount = 0;
    let pointsTotal = 0;
    let categoryCount = 0;
    for (const category of overview?.categories || []) {
      if (category.hidden || category.key === "negative") continue;
      tierCount += Number(category.tiers || 0);
      pointsTotal += Number(category.points || 0);
      if (Number(category.groups || 0) > 0) categoryCount += 1;
    }
    return { tierCount, pointsTotal, categoryCount };
  }, [overview]);

  const mine = userId ? overview?.mine || null : null;
  const rows = useMemo(() => categoryRows(overview, mine), [overview, mine]);
  const leaderboardCategories = (overview?.categories || []).filter((c) => c.key !== "negative" && c.key !== "hidden");
  const hidden = overview?.hidden || null;
  const podium = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);
  const byLevel = board.by === "level";
  const canShowAll = !showAll && leaderboard.length >= BOARD_TOP;

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,#0d2b38_0%,#000_65%)]" />
        <div className="tls-scanline relative max-w-6xl mx-auto px-4 md:px-6 pt-6 pb-7 sm:py-14 md:py-20">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-5 sm:gap-8 items-start">
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.4em] text-[#29B6E8]">
                <Sparkles className="w-4 h-4" /> Ruhmeshalle
              </div>
              <h1 className="font-heading text-4xl md:text-6xl font-black uppercase mt-2 sm:mt-3 leading-none">
                Achieve<span className="text-[#FFD700]">ments</span>
              </h1>
              <p className="mt-4 max-w-2xl text-sm sm:text-base md:text-lg text-white/60">
                Spiele Matches, gewinne Turniere, fahre Bestzeiten und engagiere dich im Verein –
                jede Aktion bringt dich weiter.<span className="hidden sm:inline"> Schalte Abzeichen frei und klettere in der Bestenliste.</span>
              </p>
            </motion.div>
            <WeekTile week={overview?.week} loading={loading} />
          </div>

          <div className="mt-6 sm:mt-8 grid grid-cols-4 gap-2 sm:gap-3" data-testid="achievements-stats">
            <StatCard icon={Trophy} label="Erfolge" value={stats.tierCount} accent="#FFD700" />
            <StatCard icon={Target} label="Punkte zu holen" value={stats.pointsTotal} accent="#29B6E8" />
            <StatCard icon={Flame} label="Kategorien" value={stats.categoryCount} accent="#00FF88" />
            {mine ? (
              <StatCard icon={Crown} label="Deine Punkte" value={mine.points || 0} accent="#A855F7" testId="my-points" />
            ) : (
              <Link to="/register" className="group">
                <StatCard icon={Crown} label="Jetzt mitmachen" value="→" accent="#A855F7" />
              </Link>
            )}
          </div>

          {mine && (
            <div className="mt-4 text-sm text-white/60" data-testid="my-achievement-summary">
              Du hast bereits <span className="text-[#FFD700] font-bold">{mine.count || 0}</span> Erfolge
              freigeschaltet · <Link to="/u/me?tab=achievements" className="text-[#29B6E8] hover:underline">Meine Erfolge ansehen</Link>
            </div>
          )}
        </div>
      </section>

      <UnlockTicker items={overview?.recent || []} />

      <div className="max-w-6xl mx-auto px-4 md:px-6 pt-6 pb-8 sm:py-10 md:py-14 space-y-8 sm:space-y-12">
        {/* Kategorien: zugeklappt, je eine Zeile mit Fortschritt - Aufklappen lädt die Abzeichen */}
        <section data-testid="achievements-categories" id="achievements-catalog">
          <div className="flex items-center gap-2 mb-2">
            <Layers className="w-5 h-5 text-[#00FF88]" />
            <h2 className="font-heading text-2xl md:text-3xl font-bold uppercase">Kategorien</h2>
          </div>
          <p className="mb-2 sm:mb-4 text-[10px] uppercase tracking-widest text-white/40" data-testid="categories-caption">
            {mine ? "Dein Fortschritt je Kategorie" : `Fortschritt der Community · ${overview?.rarity?.base ?? 0} Konten`}
            <span className="hidden sm:inline"> · antippen zeigt die Abzeichen</span>
          </p>
          {loading && rows.length === 0 ? (
            <SkeletonTable rows={4} columns={2} label="Lade Kategorien" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 md:gap-3">
              {rows.map((category) => {
                const entry = catalog[category.key];
                return (
                  <CategoryRow
                    key={category.key}
                    category={category}
                    own={mine ? Number(mine.categories?.[category.key] || 0) : null}
                    negativeCount={Number(mine?.negative || 0)}
                    hidden={hidden}
                    open={open.has(category.key)}
                    onToggle={() => toggleCategory(category.key)}
                  >
                    {!entry || entry.status === "loading" ? (
                      <div className="py-6 text-center text-sm text-white/45" data-testid={`category-loading-${category.key}`}>Lade Abzeichen …</div>
                    ) : entry.status === "error" ? (
                      <div className="py-4 flex flex-wrap items-center justify-center gap-3 text-sm text-white/55" data-testid={`category-error-${category.key}`}>
                        Die Abzeichen ließen sich nicht laden.
                        <button type="button" onClick={() => fetchCategory(category.key)} className="tls-btn tls-btn--quiet text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-sm">
                          Nochmal
                        </button>
                      </div>
                    ) : (
                      <>
                        {entry.groups.length > 1 && category.key !== "negative" && (
                          <div className="mb-3 flex justify-end">
                            <Toggle
                              value={sortBy[category.key] || "category"}
                              onChange={(value) => setSortBy((current) => ({ ...current, [category.key]: value }))}
                              options={[{ key: "category", label: "Katalog", icon: Layers }, { key: "rarity", label: "Seltenste zuerst", icon: ArrowDownWideNarrow }]}
                              testId={`catalog-sort-${category.key}`}
                            />
                          </div>
                        )}
                        <AchievementCategoryGroups
                          category={category.key}
                          groups={entry.groups}
                          rarity={overview?.rarity || null}
                          sortBy={sortBy[category.key] || "category"}
                          hidden={hidden}
                          clubTeaser={!isClubMember}
                        />
                      </>
                    )}
                  </CategoryRow>
                );
              })}
            </div>
          )}
        </section>

        {/* Bestenliste: Podest und Plätze 4 bis 10, „Alle anzeigen“ lädt weiter */}
        <section data-testid="achievements-leaderboard">
          <div className="flex items-center justify-between gap-3 mb-3 sm:mb-6 flex-wrap">
            <div className="flex items-center gap-2">
              <Medal className="w-5 h-5 text-[#FFD700]" />
              <h2 className="font-heading text-2xl md:text-3xl font-bold uppercase">Bestenliste</h2>
            </div>
            <div className="flex max-w-full items-center gap-2 flex-nowrap overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0" data-testid="leaderboard-controls">
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
                    className="shrink-0 bg-[#0A0A0A] border border-white/15 rounded-sm px-2 py-1.5 text-xs uppercase tracking-widest text-white/80"
                    aria-label="Kategorie"
                    data-testid="leaderboard-category"
                  >
                    <option value="">Alle Kategorien</option>
                    {leaderboardCategories.map((c) => (
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
              {/* Podest - am Handy drei schmale Karten nebeneinander, damit die Seite kurz bleibt */}
              <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
                {podium.map((entry, index) => (
                  <PodiumCard key={entry.user_id} entry={entry} index={index} byLevel={byLevel} />
                ))}
              </div>
              {/* Plätze ab 4 */}
              {rest.length > 0 && (
                <div className="border border-white/10 rounded-sm overflow-hidden divide-y divide-white/5">
                  {rest.map((entry, index) => (
                    <motion.div
                      key={entry.user_id}
                      data-testid={`leaderboard-row-${entry.rank}`}
                      className="flex items-center gap-3 px-3 sm:px-4 py-1.5 sm:py-2.5 hover:bg-white/[0.02]"
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
              {canShowAll && (
                <div className="mt-3 sm:mt-4 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    disabled={boardLoading}
                    className="tls-btn tls-btn--secondary w-full sm:w-auto px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-sm"
                    data-testid="leaderboard-show-all"
                  >
                    Alle anzeigen
                  </button>
                </div>
              )}
              {showAll && boardLoading && (
                <div className="mt-4 text-center text-xs text-white/45" data-testid="leaderboard-loading-more">Lädt weitere Plätze …</div>
              )}
            </>
          )}
        </section>
      </div>
    </PublicLayout>
  );
}

// Eine Kategorie als Zeile (#1229): Name, Fortschritt und ein dünner Balken; aufgeklappt nimmt sie am Tablet und
// am PC die ganze Breite, darunter die Gruppen.
function CategoryRow({ category, own, negativeCount = 0, hidden, open, onToggle, children }) {
  const meta = CATEGORY_META[category.key] || {};
  const accent = category.accent || meta.accent || "#29B6E8";
  const isHidden = category.key === "hidden";
  const isNegative = category.key === "negative";
  const total = Number(category.tiers || 0);
  const panelId = `achievement-category-panel-${category.key}`;
  let summary;
  let percent;
  if (isNegative) {
    summary = `${negativeCount} gefunden`;
    percent = 100;
  } else if (isHidden) {
    const found = Number(hidden?.earned || 0);
    const all = Number(hidden?.total || category.groups || 0);
    summary = `${found} von ${all} gefunden`;
    percent = all ? (100 * found) / all : 0;
  } else if (own != null) {
    percent = total ? (100 * own) / total : 0;
    summary = `${own} von ${total} · ${formatPercent(Math.round(percent))}`;
  } else {
    percent = Math.max(0, Math.min(100, Number(category.community_percent || 0)));
    summary = `${formatPercent(percent)} · ${zahlwort(category.groups, "Gruppe", "Gruppen")}`;
  }
  const detail = isNegative
    ? "Nur für dich sichtbar"
    : isHidden
      ? "Zeigen sich erst, wenn du sie gefunden hast"
      : [
        zahlwort(category.groups, "Gruppe", "Gruppen"),
        zahlwort(total, "Stufe", "Stufen"),
        own == null && category.holders != null ? `${zahlwort(category.holders, "Person", "Personen")} dabei` : null,
      ].filter(Boolean).join(" · ");
  return (
    <div className={`-mt-px first:mt-0 md:mt-0 border rounded-sm bg-[#0F0F10] transition-colors ${open ? "relative z-10 md:col-span-2 border-white/25" : "border-white/10 hover:border-white/25"}`} data-testid={`category-row-${category.key}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="w-full text-left px-3.5 py-2 md:px-4 md:py-3 flex items-center gap-3"
        style={{ boxShadow: `inset 2px 0 0 ${accent}` }}
        data-testid={`category-toggle-${category.key}`}
      >
        {isHidden
          ? <CircleHelp className="w-4 h-4 shrink-0" style={{ color: accent }} />
          : <AchievementIcon name={category.icon || meta.icon} fallback="trophy" className="w-4 h-4 shrink-0" style={{ color: accent }} />}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-heading font-bold uppercase text-sm md:text-base truncate">{category.label}</span>
            <span className="font-display font-bold text-sm tabular-nums shrink-0" style={{ color: accent }} data-testid={`category-progress-${category.key}`}>{summary}</span>
          </div>
          <div className="mt-1.5 h-1 bg-white/5 rounded-sm overflow-hidden" aria-hidden="true">
            <div className="h-full" style={{ width: `${Math.max(0, Math.min(100, percent))}%`, backgroundColor: accent }} />
          </div>
          <div className="mt-1 hidden md:flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/40" data-testid={`category-detail-${category.key}`}>
            <span className="truncate">{detail}</span>
            {category.member_only && <span className="ml-auto shrink-0 text-[#FFD700]/80">Mitglieder</span>}
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 shrink-0 text-white/40 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div id={panelId} className="border-t border-white/10 p-3 md:p-4" data-testid={`category-panel-${category.key}`}>
          {children}
        </div>
      )}
    </div>
  );
}

function Toggle({ value, onChange, options, testId }) {
  return (
    <div className="inline-flex shrink-0 border border-white/15 rounded-sm overflow-hidden" role="group" data-testid={testId}>
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 whitespace-nowrap text-[10px] font-bold uppercase tracking-widest transition ${active ? "bg-[#29B6E8]/15 text-[#29B6E8]" : "text-white/55 hover:text-white"}`}
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
      className="relative border rounded-sm bg-[#0A0A0A]/80 p-4 sm:p-5 overflow-hidden"
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
        <div className="mt-2 sm:mt-3 flex items-start gap-4">
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
      {week?.week_key && <div className="mt-2 sm:mt-3 text-[9px] uppercase tracking-widest text-white/30">Kalenderwoche {String(week.week_key).split("-W")[1]} · montags 08:00 neu</div>}
    </motion.aside>
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
      className="h-full min-w-0 border border-white/10 rounded-sm bg-[#0A0A0A]/70 p-2.5 sm:p-4 transition-all hover:border-white/25"
      style={{ boxShadow: `inset 0 0 0 1px ${accent}12` }}
    >
      <Icon className="w-4 h-4 sm:w-5 sm:h-5 mb-1 sm:mb-2" style={{ color: accent }} />
      <div className="font-display text-lg sm:text-2xl md:text-3xl font-black tabular-nums truncate">{value}</div>
      <div className="text-[9px] sm:text-[10px] uppercase tracking-wider sm:tracking-widest text-white/45 mt-0.5 sm:mt-1 leading-tight">{label}</div>
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
      className={`relative min-w-0 border rounded-sm bg-[#0F0F10] px-2 py-3 sm:p-5 text-center ${isFirst ? "sm:-mt-2" : ""}`}
      style={{ borderColor: style.color + "55", boxShadow: `0 0 0 1px ${style.color}18, 0 0 26px ${style.color}12` }}
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.12, type: "spring", stiffness: 200, damping: 18 }}
    >
      <div
        className="absolute left-1.5 top-1.5 w-6 h-6 text-xs sm:static sm:mx-auto sm:w-9 sm:h-9 sm:text-base rounded-full border-2 flex items-center justify-center font-display font-black sm:mb-3"
        style={{ borderColor: style.color, color: style.color }}
      >
        {entry.rank}
      </div>
      <div className={`mx-auto mb-2 sm:mb-3 flex justify-center ${crown ? "pt-4" : ""}`}>
        <LevelAvatarFrame level={level} crown={crown} compact className="w-12 h-12 sm:w-16 sm:h-16">
          {entry.avatar_url ? (
            <SizedImage src={entry.avatar_url} sizes="(min-width: 640px) 64px, 48px" widths={[160, 320]} alt="" className="w-full h-full" />
          ) : (
            <div className="w-full h-full flex items-center justify-center font-bold text-white/60">
              {(entry.display_name || "?").trim().charAt(0).toUpperCase()}
            </div>
          )}
        </LevelAvatarFrame>
      </div>
      <Link
        to={entry.username ? `/u/${entry.username}` : "#"}
        className="block font-heading font-bold uppercase truncate text-xs sm:text-base hover:text-[#29B6E8]"
      >
        {entry.display_name}
        {Number(entry.prestige || 0) > 0 && <span className="ml-1 text-[#FFD700]" title={`Prestige ${entry.prestige}`}>{"★".repeat(Math.min(5, Number(entry.prestige)))}</span>}
      </Link>
      <div className="mt-1 sm:mt-2 font-display text-lg sm:text-2xl font-black tabular-nums" style={{ color: style.color }}>
        {byLevel ? `Level ${entry.level}` : entry.points}
      </div>
      <div className="text-[10px] uppercase tracking-wider sm:tracking-widest text-white/55 truncate">{byLevel ? (entry.title || `${entry.xp || 0} XP`) : erfolge(entry.count)}</div>
    </motion.div>
  );
}

// Profilbilder in passender Größe (#1227): 28 oder 36 Pixel bekommen die 160er Fassung statt des Originals.
function Avatar({ entry, size = 10, ring = "border-white/15", center = false }) {
  const dim = `${size * 4}px`;
  const initial = (entry.display_name || "?").trim().charAt(0).toUpperCase();
  return entry.avatar_url ? (
    <SizedImage
      src={entry.avatar_url}
      size={size * 4}
      alt=""
      className={`rounded-sm border ${ring} ${center ? "mx-auto" : ""}`}
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
