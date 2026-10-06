/**
 * Achievement Groups View — Phase B v4, Erfolge II (#619).
 *
 * Renders achievement groups returned from /api/achievements/{me|user/:id}.
 * In profile-edit views it can show earned + locked tiers. Public profile views
 * pass earnedOnly so visitors see only achievements the user actually has.
 *
 * Secret negative/fun groups appear only after a user has earned at least one
 * tier. Locked negative tiers are never sent by the API.
 *
 * Seit #618 zeigen die Zeilen das Abzeichen (Material, Rang-Kerben, Motiv; Silhouette mit Fortschrittsring).
 * Seit #619: Seltenheit je Gruppe und Stufe („4,2 % haben Diamant“), Sortierung nach Seltenheit,
 * die „?“-Karte mit dem Zähler für geheime Gruppen und die Vitrine „Für Vereinsmitglieder“;
 * im eigenen Profil Filter (Material, Status), das Anheften einzelner Stufen und „Teilen“ je Vergabe.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, CircleHelp, Pin, PinOff, Share2 } from "lucide-react";
import { AchievementIcon } from "@/components/tls/AchievementIcon";
import { Badge } from "@/components/achievements/Badge";
import { viennaDate } from "@/lib/vienna";

const LEVEL_META = {
  1: { name: "Bronze",   color: "#CD7F32" },
  2: { name: "Silber",   color: "#C0C0C0" },
  3: { name: "Gold",     color: "#FFD700" },
  4: { name: "Platin",   color: "#29B6E8" },
  5: { name: "Legendär", color: "#FF3B30" },
};

export const CATEGORY_META = {
  match:      { label: "Spielen",   icon: "swords",        accent: "#29B6E8", order: 1 },
  tournament: { label: "Turnier",   icon: "trophy",        accent: "#FFD700", order: 2 },
  fastlap:    { label: "Fast Lap",  icon: "flag",          accent: "#A855F7", order: 3 },
  season:     { label: "Saison",    icon: "calendar-check", accent: "#29B6E8", order: 3.5 },
  team:       { label: "Team",      icon: "users",         accent: "#00FF88", order: 4 },
  community:  { label: "Community", icon: "messages-square", accent: "#29B6E8", order: 5 },
  // Erfolge II (#611): Streaming & Content heißt jetzt Streaming & Creator, Fortschritt Profil & Konto.
  content:    { label: "Streaming & Creator", icon: "radio", accent: "#9146FF", order: 6 },
  creator:    { label: "Streaming & Creator", icon: "radio", accent: "#9146FF", order: 6 },
  progression:{ label: "Profil & Konto", icon: "user-check",  accent: "#00FF88", order: 7 },
  profile:    { label: "Profil & Konto", icon: "user-check",  accent: "#00FF88", order: 7 },
  club:       { label: "Verein",    icon: "crown",         accent: "#FFD700", order: 8 },
  special:    { label: "Besonders", icon: "sparkles",  accent: "#FF3B30", order: 9 },
  hidden:     { label: "Geheim",    icon: "ghost",   accent: "#A855F7", order: 9.5 },
  negative:   { label: "Geheim / Fun", icon: "alert-triangle", accent: "#FF3B30", order: 10 },
};

// „4,2 %“ - deutsche Schreibweise, höchstens eine Nachkommastelle, kleine Werte bleiben lesbar.
export function formatPercent(value) {
  const n = Number(value || 0);
  if (n > 0 && n < 0.1) return "< 0,1 %";
  return `${n.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;
}

// Das Abzeichen (E8, #618) in Listen: Material und Motiv aus dem Katalog, nicht erreichte Stufen als
// Silhouette mit Fortschrittsring; der Hover sagt, wie man es schafft.
function ListBadge({ tier, group, earned = true, size = "md", animate = false, percent = 0 }) {
  const howTo = !earned ? (tier?.how_to || group?.how_to || tier?.description || "") : "";
  return (
    <span className="inline-flex shrink-0" title={howTo ? `So schaffst du es: ${howTo}` : undefined} data-testid={tier?.code ? `badge-${tier.code}` : undefined}>
      <Badge
        material={tier?.material}
        level={tier?.level}
        rank={tier?.rank}
        art={group?.art || tier?.art}
        icon={tier?.icon || group?.icon}
        earned={earned}
        percent={percent}
        size={size}
        animate={animate}
        special={group?.is_special || group?.category === "special"}
        negative={Boolean(group?.is_negative)}
        title={tier?.name}
      />
    </span>
  );
}

const SPECIAL_ACCENTS = [
  "#FF3B30", "#9146FF", "#29B6E8", "#FFD700", "#00FF88", "#FF8A3D", "#E4405F",
];

function groupAccent(group) {
  if (group.category !== "special") return group.accent_color || "#29B6E8";
  const seed = String(group.code || group.name || "special").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return group.accent_color && group.accent_color !== "#FF3B30"
    ? group.accent_color
    : SPECIAL_ACCENTS[seed % SPECIAL_ACCENTS.length];
}

function levelLabel(level, group, tier) {
  if (tier?.level_name) return tier.level_name;
  if (Number(level) === 5) {
    if (group?.is_negative || group?.category === "negative") return "Geheim";
    if (group?.is_special || group?.category === "special") return "Sonderauszeichnung";
    return "Legendär";
  }
  return LEVEL_META[level]?.name || "?";
}

function groupRarity(rarity, group) {
  return rarity?.groups?.[group.code] || null;
}

// Nach Seltenheit: erst die Gruppen, deren höchste Stufe die wenigsten Leute haben - bei Gleichstand
// die mit weniger Leuten insgesamt, dann nach Name. Ohne Seltenheitsdaten bleibt die Katalogreihenfolge.
export function sortGroupsByRarity(groups, rarity) {
  return [...groups].sort((a, b) => {
    const ra = groupRarity(rarity, a);
    const rb = groupRarity(rarity, b);
    const pa = ra ? Number(ra.top?.percent ?? 0) : 101;
    const pb = rb ? Number(rb.top?.percent ?? 0) : 101;
    if (pa !== pb) return pa - pb;
    const ha = ra ? Number(ra.holders || 0) : Infinity;
    const hb = rb ? Number(rb.holders || 0) : Infinity;
    if (ha !== hb) return ha - hb;
    return String(a.name || "").localeCompare(String(b.name || ""), "de");
  });
}

export const STATUS_FILTERS = [
  ["all", "Alle"],
  ["earned", "Erreicht"],
  ["progress", "In Arbeit"],
  ["locked", "Gesperrt"],
  ["secret", "Geheim"],
];

// Status einer Stufe für den Filter im Profil: erreicht, in Arbeit (messbar und schon angefangen),
// gesperrt (noch nichts, von Hand oder geplant) - geheime Gruppen zählen als „geheim“.
export function tierStatus(tier, group) {
  if (group?.hidden) return "secret";
  if (tier.earned) return "earned";
  const measurable = !tier.manual_only && tier.condition_status !== "planned" && Number(tier.target || 0) > 0;
  if (measurable && Number(tier.current || 0) > 0) return "progress";
  return "locked";
}

export function applyTierFilters(groups, filters) {
  if (!filters) return groups;
  const material = filters.material || "";
  const status = filters.status && filters.status !== "all" ? filters.status : "";
  if (!material && !status) return groups;
  return groups
    .map((group) => ({
      ...group,
      tiers: (group.tiers || []).filter((tier) => (!material || tier.material === material) && (!status || tierStatus(tier, group) === status)),
    }))
    .filter((group) => group.tiers.length > 0);
}

export function AchievementGroupsView({
  groups = [],
  emptyText = "Noch keine Achievements freigeschaltet.",
  earnedOnly = false,
  rarity = null,
  sortBy = "category",
  hidden = null,
  clubTeaser = false,
  categoryFilter = null,
  filters = null,
  pins = null,
  share = null,
}) {
  const byCategory = categoryFilter ? groups.filter((group) => group.category === categoryFilter) : groups;
  const filtered = applyTierFilters(byCategory, filters);
  const visibleGroups = earnedOnly
    ? filtered
        .map((group) => ({
          ...group,
          tiers: (group.tiers || []).filter((tier) => tier.earned),
          tier_count: (group.tiers || []).filter((tier) => tier.earned).length,
          earned_count: (group.tiers || []).filter((tier) => tier.earned).length,
        }))
        .filter((group) => group.tiers.length > 0)
    : filtered;
  const filtering = Boolean(filters && ((filters.material) || (filters.status && filters.status !== "all")));
  const showHiddenCard = Boolean(hidden && Number(hidden.total || 0) > 0 && !earnedOnly && (!categoryFilter || categoryFilter === "hidden") && (!filtering || filters.status === "secret"));

  if (!visibleGroups.length && !showHiddenCard) {
    return (
      <div className="border border-dashed border-white/10 rounded-sm p-12 text-center text-white/50" data-testid="achievements-empty">
        {emptyText}
      </div>
    );
  }

  if (sortBy === "rarity") {
    const ordered = sortGroupsByRarity(visibleGroups, rarity);
    return (
      <div className="space-y-4" data-testid="achievement-groups" data-sort="rarity">
        <div className="flex items-baseline justify-between">
          <h2 className="font-heading text-xl md:text-2xl font-bold uppercase">Die seltensten zuerst</h2>
          <span className="text-[10px] uppercase tracking-widest text-white/40">{ordered.length} Gruppen</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {ordered.map((g) => <GroupCard key={g.code} group={g} earnedOnly={earnedOnly} rarity={rarity} pins={pins} share={share} />)}
          {showHiddenCard && <HiddenSummaryCard hidden={hidden} />}
        </div>
      </div>
    );
  }

  // Group by category, ordered by CATEGORY_META.order
  const byCat = {};
  for (const g of visibleGroups) (byCat[g.category] ||= []).push(g);
  if (showHiddenCard) byCat.hidden ||= [];
  const order = Object.keys(byCat).sort(
    (a, b) => (CATEGORY_META[a]?.order ?? 99) - (CATEGORY_META[b]?.order ?? 99)
  );

  return (
    <div className="space-y-10" data-testid="achievement-groups" data-sort="category">
      {order.filter(c => byCat[c]?.length || (c === "hidden" && showHiddenCard)).map((cat) => {
        const meta = CATEGORY_META[cat] || CATEGORY_META.special;
        const isClub = cat === "club";
        return (
          <section key={cat} data-testid={`achievement-category-${cat}`}>
            <div className="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <AchievementIcon name={meta.icon} fallback="trophy" className="w-4 h-4" style={{ color: meta.accent }} />
                <h2 className="font-heading text-xl md:text-2xl font-bold uppercase">{meta.label}</h2>
                {isClub && clubTeaser && (
                  <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border border-[#FFD700]/40 text-[#FFD700]/90" data-testid="club-showcase-badge">
                    Für Vereinsmitglieder
                  </span>
                )}
              </div>
              <span className="text-[10px] uppercase tracking-widest text-white/40">
                {byCat[cat].length} Gruppen{cat === "hidden" && hidden ? ` · ${hidden.earned} von ${hidden.total} gefunden` : ""}
              </span>
            </div>
            {isClub && clubTeaser && (
              <div className="mb-4 border border-[#FFD700]/25 bg-[#FFD700]/5 rounded-sm px-4 py-3 text-sm text-white/70 flex items-center gap-3 flex-wrap" data-testid="club-showcase-note">
                <span className="flex-1 min-w-[16rem]">
                  Diese Vitrine gehört dem Verein: die Stufen gibt es nur für Mitglieder – für Jahre im Rudel, die Mitgliedskarte, Vereinsabende und Ehrenamt.
                </span>
                <Link to="/membership/join" className="shrink-0 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 border border-[#FFD700]/50 text-[#FFD700] rounded-sm hover:bg-[#FFD700]/10">
                  Mitglied werden
                </Link>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {byCat[cat].map(g => <GroupCard key={g.code} group={g} earnedOnly={earnedOnly} rarity={rarity} pins={pins} share={share} />)}
              {cat === "hidden" && showHiddenCard && <HiddenSummaryCard hidden={hidden} />}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// Die „?“-Karte (#619): geheime Gruppen zeigen ihren Namen erst nach der Freischaltung - hier steht nur,
// wie viele es gibt und wie viele die Person schon gefunden hat.
function HiddenSummaryCard({ hidden }) {
  const total = Number(hidden?.total || 0);
  const earned = Number(hidden?.earned || 0);
  const remaining = Math.max(total - earned, 0);
  return (
    <motion.div
      data-testid="achievement-hidden-summary"
      className="border border-dashed border-[#A855F7]/40 rounded-sm bg-[#0F0A16] p-4 flex items-center gap-4"
      whileHover={{ y: -3 }}
      animate={{ borderColor: ["rgba(168,85,247,0.25)", "rgba(168,85,247,0.6)", "rgba(168,85,247,0.25)"] }}
      transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
    >
      <div className="w-12 h-12 rounded-sm flex items-center justify-center border border-[#A855F7]/40 bg-[#A855F7]/10 shrink-0">
        <CircleHelp className="w-6 h-6 text-[#c084fc]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-heading text-base md:text-lg font-bold uppercase">Geheim</div>
          <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border border-[#A855F7]/50 text-[#c084fc]" data-testid="achievement-hidden-count">
            {earned} von {total} gefunden
          </span>
        </div>
        <div className="mt-1 text-xs text-white/55">
          {remaining === 0
            ? "Alle gefunden. Du kennst jede Ecke dieser Seite."
            : `${remaining === total ? "Sie zeigen sich erst, wenn du sie gefunden hast" : `${remaining} warten noch`} – zu ungewöhnlichen Zeiten, an ungewöhnlichen Orten, mit ungewöhnlichen Zahlen.`}
        </div>
      </div>
    </motion.div>
  );
}

function GroupCard({ group, earnedOnly = false, rarity = null, pins = null, share = null }) {
  const [open, setOpen] = useState(false);
  const earnedTiers = group.tiers.filter(t => t.earned).sort((a, b) => b.level - a.level);
  const lockedTiers = group.tiers.filter(t => !t.earned).sort((a, b) => a.level - b.level);
  const highest = earnedTiers[0]; // top tier achieved
  const nextLocked = earnedOnly ? null : lockedTiers[0];
  const hasAny = earnedTiers.length > 0;
  const accent = groupAccent(group);
  const isNegative = Boolean(group.is_negative || group.category === "negative");
  const prestige = hasAny && !isNegative && highest?.level >= 4;
  const lockedPulse = !earnedOnly && !hasAny && !isNegative && Number(nextLocked?.percent || 0) >= 80;
  const highestLabel = highest ? levelLabel(highest.level, group, highest) : "";
  const rare = !isNegative ? groupRarity(rarity, group) : null;

  return (
    <motion.div
      layout
      data-testid={`achievement-group-${group.code}`}
      className={`border rounded-sm bg-[#0F0F10] transition-all ${hasAny ? "border-white/15" : "border-white/5"} ${isNegative ? "bg-[#120A0A]" : ""} ${hasAny && !isNegative && highest?.level >= 5 ? "tls-achievement-card-legendary" : ""}`}
      style={hasAny ? { boxShadow: `inset 0 0 0 1px ${accent}22` } : undefined}
      whileHover={{ y: -3 }}
      animate={prestige
        ? { boxShadow: [`inset 0 0 0 1px ${accent}22`, `inset 0 0 0 1px ${accent}55, 0 0 22px ${accent}18`, `inset 0 0 0 1px ${accent}22`] }
        : lockedPulse
          ? { borderColor: ["rgba(255,255,255,0.05)", `${accent}33`, "rgba(255,255,255,0.05)"] }
          : undefined}
      transition={prestige
        ? { duration: 3.2, repeat: Infinity, ease: "easeInOut" }
        : lockedPulse
          ? { duration: 5.5, repeat: Infinity, ease: "easeInOut" }
          : undefined}
    >
      {/* Header — tap to expand */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-white/[0.02] transition"
      >
        {hasAny
          ? <ListBadge tier={highest} group={group} earned size="lg" animate={prestige} />
          : <ListBadge tier={nextLocked || group.tiers[0]} group={group} earned={false} size="lg" percent={isNegative ? 0 : Number(nextLocked?.percent || 0)} />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-heading text-base md:text-lg font-bold uppercase truncate">{group.name}</div>
            {hasAny && (
              <span
                className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border"
                style={{ color: LEVEL_META[highest.level].color, borderColor: LEVEL_META[highest.level].color + "55" }}
              >
                {isNegative ? "Geheim" : highestLabel}
              </span>
            )}
            {!earnedOnly && !hasAny && nextLocked && (
              <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border border-white/10 text-white/50">
                Locked
              </span>
            )}
            {group.member_only && !isNegative && (
              <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border border-[#FFD700]/35 text-[#FFD700]/85">
                Verein
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-white/55 line-clamp-1">{group.description}</div>
          {rare?.top && (
            <div className="mt-1 text-[10px] uppercase tracking-widest text-white/40 tabular-nums" data-testid={`achievement-rarity-${group.code}`}>
              <span style={{ color: accent }}>{formatPercent(rare.top.percent)}</span> haben {rare.top.material_name || "die höchste Stufe"}
              {Number(rare.holders || 0) > 0 && <span className="text-white/30"> · {rare.holders} mit mindestens einer Stufe</span>}
            </div>
          )}
          {/* Compact progress hint when nothing earned yet */}
          {!earnedOnly && !isNegative && !hasAny && nextLocked && nextLocked.target > 0 && nextLocked.condition_status !== "planned" && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1 bg-white/5 rounded-sm overflow-hidden max-w-[200px]">
                <div className={`h-full ${nextLocked.percent >= 80 ? "tls-near-fill" : ""}`} style={{ width: `${nextLocked.percent}%`, backgroundColor: accent, color: accent }} />
              </div>
              <span className="text-[10px] text-white/40 tabular-nums">{nextLocked.current}/{nextLocked.target}</span>
              {nextLocked.percent >= 80 && (
                <span className="tls-near-chip text-[9px] font-black uppercase tracking-widest shrink-0" style={{ color: accent }}>Fast geschafft!</span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] uppercase tracking-widest text-white/40 hidden sm:inline">
            {earnedOnly ? group.earned_count : (isNegative ? `${group.earned_count} geheim` : `${group.earned_count}/${group.tier_count}`)}
          </span>
          <ChevronDown className={`w-4 h-4 text-white/40 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      {/* Expandable Tier List */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/5 px-4 py-3 space-y-2" data-testid={`achievement-group-${group.code}-tiers`}>
              {group.tiers.map(t => <TierRow key={t.code} tier={t} group={group} accent={accent} isNegative={isNegative} rarityPercent={!isNegative ? rarity?.tiers?.[t.code] : undefined} pins={!isNegative ? pins : null} share={!isNegative && !group.member_only ? share : null} />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function TierRow({ tier, group, accent, isNegative = false, rarityPercent, pins = null, share = null }) {
  const lvl = LEVEL_META[tier.level] || LEVEL_META[1];
  const label = levelLabel(tier.level, group, tier);
  const rowGlow = tier.earned && tier.level >= 4 && !isNegative ? `tls-tierrow--${tier.level}` : "";
  const hasRarity = rarityPercent !== undefined && rarityPercent !== null;
  const pinned = Boolean(pins && (pins.codes || []).includes(tier.code));
  const pinFull = Boolean(pins && !pinned && (pins.codes || []).length >= (pins.max || 6));
  const canPin = Boolean(pins && tier.earned);
  const shareId = share && tier.earned && !tier.member_only ? share.ids?.[tier.code] : null;
  return (
    <motion.div
      data-testid={`achievement-tier-${tier.code}`}
      className={`flex items-center gap-3 p-2 rounded-sm border transition ${tier.earned ? "border-white/10 bg-white/[0.02]" : "border-white/5 opacity-95"} ${rowGlow}`}
      style={tier.earned ? { "--tier": lvl.color, boxShadow: rowGlow ? undefined : `inset 2px 0 0 ${lvl.color}` } : undefined}
      animate={!tier.earned && !isNegative
        ? { borderColor: ["rgba(255,255,255,0.05)", `${accent}2b`, "rgba(255,255,255,0.05)"] }
        : undefined}
      transition={!tier.earned && !isNegative
        ? { duration: 6, repeat: Infinity, ease: "easeInOut" }
        : undefined}
    >
      <ListBadge tier={tier} group={group} earned={tier.earned} size="md" percent={Number(tier.percent || 0)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: lvl.color }}>
            {isNegative ? "Geheim" : label}
          </span>
          <span className={`text-sm font-semibold truncate ${tier.earned ? "text-white" : "text-white/55"}`}>{tier.name}</span>
          {tier.member_only && (
            <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border border-[#FFD700]/35 text-[#FFD700]/85">
              Verein
            </span>
          )}
          {tier.condition_status === "planned" && !tier.earned && (
            <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border border-white/10 text-white/35">
              geplant
            </span>
          )}
        </div>
        <div className="text-xs text-white/65 mt-0.5">{tier.description}</div>
        {!tier.earned && tier.target > 0 && !tier.manual_only && tier.condition_status !== "planned" && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1 h-1 bg-white/5 rounded-sm overflow-hidden">
              <div className={`h-full ${tier.percent >= 80 ? "tls-near-fill" : ""}`} style={{ width: `${tier.percent}%`, backgroundColor: accent, color: accent }} />
            </div>
            <span className="text-[10px] text-white/40 tabular-nums">{tier.current}/{tier.target}</span>
            {tier.percent >= 80 && (
              <span className="tls-near-chip text-[9px] font-black uppercase tracking-widest shrink-0" style={{ color: accent }}>Fast geschafft!</span>
            )}
          </div>
        )}
        {!tier.earned && tier.condition_status === "planned" && !tier.manual_only && (
          <div className="mt-1 text-[10px] uppercase tracking-widest text-white/30">Automatisierung geplant</div>
        )}
        {!tier.earned && tier.manual_only && (
          <div className="mt-1 text-[10px] uppercase tracking-widest text-white/30">Wird manuell vergeben</div>
        )}
      </div>
      <div className="shrink-0 text-right">
        {tier.earned ? (
          <div className="text-[10px] uppercase tracking-widest text-white/70">
            +{tier.points} Pkt.
            {tier.earned_at && <div className="text-white/45">{viennaDate(tier.earned_at)}</div>}
          </div>
        ) : (
          <div className="text-[10px] uppercase tracking-widest text-white/50">+{tier.points}</div>
        )}
        {hasRarity && (
          <div className="mt-0.5 text-[10px] tracking-widest text-white/35 tabular-nums" data-testid={`achievement-tier-rarity-${tier.code}`}>
            {formatPercent(rarityPercent)} haben das
          </div>
        )}
        {canPin && (
          <button
            type="button"
            onClick={() => pins.onToggle(tier.code)}
            disabled={pinFull}
            aria-pressed={pinned}
            aria-label={pinned ? `${tier.name} lösen` : `${tier.name} anheften`}
            title={pinned ? "Vom Profil lösen" : pinFull ? `Höchstens ${pins.max || 6} angeheftet` : "Im Profil anheften"}
            data-testid={`achievement-pin-${tier.code}`}
            className={`mt-1.5 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest px-1.5 py-1 rounded-sm border transition ${pinned ? "border-[#FFD700]/60 text-[#FFD700] bg-[#FFD700]/10" : "border-white/15 text-white/50 hover:text-white hover:border-white/40"} disabled:opacity-35 disabled:cursor-not-allowed`}
          >
            {pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
            {pinned ? "Angeheftet" : "Anheften"}
          </button>
        )}
        {shareId && (
          <button
            type="button"
            onClick={() => share.onShare({ awardId: shareId, tier })}
            aria-label={`${tier.name} teilen`}
            title="Teilen-Karte öffnen oder Link kopieren"
            data-testid={`achievement-share-${tier.code}`}
            className="mt-1.5 ml-1 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest px-1.5 py-1 rounded-sm border border-white/15 text-white/50 hover:text-white hover:border-white/40 transition"
          >
            <Share2 className="w-3 h-3" /> Teilen
          </button>
        )}
      </div>
    </motion.div>
  );
}
