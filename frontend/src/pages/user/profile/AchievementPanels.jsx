import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Reorder } from "framer-motion";
import { ArrowRight, Filter, GripVertical, Medal, Pin, Sparkles, Star, Target, User, X } from "lucide-react";
import { AchievementIcon } from "@/components/tls/AchievementIcon";
import { CATEGORY_META, STATUS_FILTERS, formatPercent } from "@/components/tls/AchievementGroups";
import { AccountLevelProgress } from "@/components/tls/AccountLevel";

// Der Reiter „Achievements“ im Profil (#619): Kopf mit Level, Titel, Prestige und XP-Leiste; „Als Nächstes“
// mit „So schaffst du es“ und Link; Angeheftete (bis zu sechs, per Drag sortierbar); Kategorien als
// Vitrinen mit Fortschritt; Filter nach Material und Status.

export const MAX_PINS = 6;
export const MATERIAL_OPTIONS = [
  ["wood", "Holz"], ["iron", "Eisen"], ["bronze", "Bronze"], ["silver", "Silber"], ["gold", "Gold"],
  ["platinum", "Platin"], ["diamond", "Diamant"], ["legendary", "Legendär"], ["hidden", "Geheim"],
];

export function AchievementStat({ icon: Icon, label, value, color, testId }) {
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-4" data-testid={testId}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/45 font-bold">
        <Icon className="w-3.5 h-3.5" style={{ color }} /> {label}
      </div>
      <div className="mt-2 font-heading text-2xl font-black tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}

export function AchievementStatsRow({ insights, profileScore, hidden }) {
  if (!insights) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="achievement-stats-row">
      <AchievementStat icon={Medal} label="Freigeschaltet" value={`${insights.earned.length}/${insights.total}`} color="#FFD700" />
      <AchievementStat icon={Sparkles} label="Punkte" value={insights.points.toLocaleString("de-DE")} color="#A855F7" />
      <AchievementStat icon={Target} label="Geheim gefunden" value={hidden ? `${hidden.earned}/${hidden.total}` : "–"} color="#c084fc" testId="achievement-stat-hidden" />
      <AchievementStat icon={User} label="Profilpflege" value={`${profileScore}%`} color="#29B6E8" />
    </div>
  );
}

// Kopf: Level-Stand aus dem XP-System (#617) - Level 1–60, Titel, Sterne für Prestige, XP bis zum nächsten Level.
export function AchievementLevelHeader({ level, earnedPercent, children }) {
  const lvl = level || {};
  const prestige = Number(lvl.prestige || 0);
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5" data-testid="achievement-level-header">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative w-14 h-14 shrink-0">
          <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
            <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
            <circle cx="18" cy="18" r="16" fill="none" stroke="#A855F7" strokeWidth="3" strokeDasharray={`${earnedPercent ?? 0} 100`} pathLength="100" strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-heading font-black text-sm">{earnedPercent ?? 0}%</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#A855F7]">Account-Level & Achievements</div>
          <h2 className="font-heading text-2xl md:text-3xl font-black uppercase mt-1 flex items-center gap-2 flex-wrap">
            <span>Deine Achievements</span>
            {lvl.title && (
              <span className="text-sm font-bold tracking-widest text-[#FFD700] inline-flex items-center gap-1" data-testid="achievement-level-title">
                Level {lvl.level} · {lvl.title}
                {prestige > 0 && <span className="inline-flex items-center gap-0.5 text-[#FFD700]" title={`Prestige ${prestige}`} data-testid="achievement-prestige">{Array.from({ length: Math.min(5, prestige) }).map((_, i) => <Star key={i} className="w-3 h-3 fill-current" />)}</span>}
              </span>
            )}
          </h2>
          {lvl.next_title_at && lvl.level < lvl.next_title_at && (
            <p className="text-xs text-white/45 mt-1">Nächster Titel ab Level {lvl.next_title_at}.</p>
          )}
        </div>
        {children}
      </div>
      {lvl.level && (
        <div className="mt-5">
          <AccountLevelProgress level={lvl.level} points={lvl.xp ?? lvl.points ?? 0} nextLevelPoints={lvl.next_level_xp ?? lvl.next_level_points ?? 100} progress={lvl.progress ?? 0} />
        </div>
      )}
    </div>
  );
}

function MaterialChip({ tier }) {
  const color = tier.material_color || tier.level_color || "#29B6E8";
  return (
    <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border" style={{ color, borderColor: `${color}66`, backgroundColor: `${color}12` }}>
      {tier.material_name || tier.level_name}
    </span>
  );
}

// „Als Nächstes“: die drei Stufen, die dem Ziel am nächsten sind - vom Backend nach Prozent sortiert.
export function NextUpPanel({ items = [] }) {
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5" data-testid="achievement-next-up">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#00FF88]">Als Nächstes</div>
          <h3 className="font-heading text-xl font-black uppercase mt-1">Was dem Ziel am nächsten ist</h3>
        </div>
        <Target className="w-5 h-5 text-[#00FF88]" />
      </div>
      {items.length ? (
        <div className="grid md:grid-cols-3 gap-3">
          {items.slice(0, 3).map((tier) => {
            const accent = tier.group_accent || "#29B6E8";
            const percent = Math.max(0, Math.min(100, Number(tier.percent || 0)));
            return (
              <div key={tier.code} className="border border-white/10 bg-[#0A0A0A] rounded-sm p-4 flex flex-col" data-testid={`next-achievement-${tier.code}`}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-sm flex items-center justify-center border shrink-0" style={{ borderColor: `${accent}55`, backgroundColor: `${accent}12` }}>
                    <AchievementIcon name={tier.icon || tier.group_icon} fallback="trophy" className="w-5 h-5" style={{ color: accent }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] uppercase tracking-widest font-bold truncate" style={{ color: accent }}>{tier.group_name}</div>
                    <div className="font-heading font-bold text-base leading-tight truncate">{tier.name}</div>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      <MaterialChip tier={tier} />
                      <span className="text-[10px] text-white/40 uppercase tracking-widest">+{tier.points}</span>
                      {tier.member_only && <span className="text-[9px] uppercase tracking-widest text-[#FFD700]">Verein</span>}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-white/5 rounded-sm overflow-hidden">
                    <div className="h-full" style={{ width: `${percent}%`, backgroundColor: accent }} />
                  </div>
                  <span className="text-[10px] text-white/45 tabular-nums">{tier.current}/{tier.target}</span>
                </div>
                <p className="mt-3 text-xs text-white/60 flex-1">
                  <span className="text-white/40 uppercase tracking-widest text-[9px] font-bold block mb-0.5">So schaffst du es</span>
                  {tier.how_to || tier.description}{tier.missing ? ` Noch ${Number(tier.missing).toLocaleString("de-DE")}.` : ""}
                </p>
                {tier.link && (
                  <Link to={tier.link} className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest hover:underline" style={{ color: accent }} data-testid={`next-achievement-link-${tier.code}`}>
                    Dorthin <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="border border-dashed border-white/10 rounded-sm p-8 text-sm text-white/45 text-center">
          Keine messbaren offenen Ziele – alles erreicht oder nur noch von Hand vergeben.
        </div>
      )}
    </div>
  );
}

function PinnedCard({ award, onRemove, dragging }) {
  const color = award.material_color || award.level_color || "#FFD700";
  return (
    <div
      className={`relative border rounded-sm bg-[#0A0A0A] p-3 flex items-center gap-3 select-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
      style={{ borderColor: `${color}55`, boxShadow: `inset 0 0 0 1px ${color}14` }}
      data-testid={`pinned-award-${award.code}`}
    >
      <GripVertical className="w-4 h-4 text-white/25 shrink-0" aria-hidden="true" />
      <div className="w-10 h-10 rounded-sm flex items-center justify-center border shrink-0" style={{ borderColor: `${color}66`, backgroundColor: `${color}14` }}>
        <AchievementIcon name={award.icon || award.group_icon} fallback="trophy" className="w-5 h-5" style={{ color }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-widest font-bold truncate" style={{ color }}>{award.material_name || award.level_name}</div>
        <div className="font-semibold text-sm truncate">{award.name}</div>
        <div className="text-[10px] text-white/40 truncate">{award.group_name}</div>
      </div>
      <button
        type="button"
        onClick={() => onRemove(award.code)}
        aria-label={`${award.name} lösen`}
        title="Lösen"
        data-testid={`pinned-remove-${award.code}`}
        className="shrink-0 w-7 h-7 inline-flex items-center justify-center border border-white/10 rounded-sm text-white/45 hover:text-white hover:border-white/40"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// Angeheftet: bis zu sechs eigene Vergaben, per Drag sortierbar (framer-motion Reorder); jede Änderung der
// Reihenfolge wird kurz gesammelt und dann gespeichert, Lösen sofort.
export function PinnedPanel({ pinned = [], codes = [], onChange }) {
  const [order, setOrder] = useState(codes);
  const [dragging, setDragging] = useState(false);
  const dirty = useRef(false);
  useEffect(() => { setOrder(codes); dirty.current = false; }, [codes]);
  useEffect(() => {
    if (!dirty.current) return undefined;
    const timer = setTimeout(() => { dirty.current = false; onChange(order); }, 600);
    return () => clearTimeout(timer);
  }, [order, onChange]);
  const byCode = useMemo(() => Object.fromEntries(pinned.map((award) => [award.code, award])), [pinned]);
  const items = order.filter((code) => byCode[code]);
  const free = Math.max(MAX_PINS - items.length, 0);
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5" data-testid="achievement-pinned">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Angeheftet</div>
          <h3 className="font-heading text-xl font-black uppercase mt-1">Was dein Profil zuerst zeigt</h3>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-white/40 tabular-nums" data-testid="achievement-pinned-count">{items.length} von {MAX_PINS}</span>
      </div>
      {items.length ? (
        <Reorder.Group
          as="ul"
          axis="y"
          values={items}
          onReorder={(next) => { dirty.current = true; setOrder(next); }}
          className="grid md:grid-cols-2 gap-2 list-none p-0 m-0"
        >
          {items.map((code) => (
            <Reorder.Item as="li" key={code} value={code} onDragStart={() => setDragging(true)} onDragEnd={() => setDragging(false)} className="list-none">
              <PinnedCard award={byCode[code]} dragging={dragging} onRemove={(removed) => { dirty.current = false; onChange(items.filter((c) => c !== removed)); }} />
            </Reorder.Item>
          ))}
        </Reorder.Group>
      ) : null}
      {free > 0 && (
        <p className={`text-xs text-white/45 border border-dashed border-white/10 rounded-sm px-4 py-3 ${items.length ? "mt-3" : ""}`} data-testid="achievement-pinned-hint">
          <Pin className="w-3 h-3 inline mr-1 -mt-0.5" />
          {items.length ? `Noch ${free} ${free === 1 ? "Platz" : "Plätze"} frei` : "Bis zu sechs Erfolge anheften"} – unten an jeder erreichten Stufe über „Anheften“. Die Reihenfolge hier ist die im öffentlichen Profil; ziehen sortiert.
        </p>
      )}
    </div>
  );
}

// Kategorien als Vitrinen: „Spielen 41 von 104“ - Klick filtert den Katalog darunter.
export function categoryProgress(groups = []) {
  const rows = {};
  for (const group of groups) {
    if (group.is_negative) continue;
    const meta = CATEGORY_META[group.category] || CATEGORY_META.special;
    const row = (rows[group.category] ||= { key: group.category, label: meta.label, icon: meta.icon, accent: meta.accent, order: meta.order, earned: 0, total: 0, groups: 0 });
    row.groups += 1;
    for (const tier of group.tiers || []) {
      row.total += 1;
      if (tier.earned) row.earned += 1;
    }
  }
  return Object.values(rows).sort((a, b) => a.order - b.order);
}

export function CategoryShowcase({ groups = [], active = null, onPick }) {
  const rows = categoryProgress(groups);
  if (!rows.length) return null;
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5" data-testid="achievement-showcase">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Vitrinen</div>
          <h3 className="font-heading text-xl font-black uppercase mt-1">Je Kategorie</h3>
        </div>
        {active && (
          <button type="button" onClick={() => onPick(null)} className="text-[10px] font-bold uppercase tracking-widest text-white/60 hover:text-white" data-testid="achievement-showcase-clear">
            Alle Kategorien
          </button>
        )}
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {rows.map((row) => {
          const percent = row.total ? Math.round((row.earned / row.total) * 100) : 0;
          const selected = active === row.key;
          return (
            <button
              key={row.key}
              type="button"
              onClick={() => onPick(selected ? null : row.key)}
              aria-pressed={selected}
              data-testid={`achievement-showcase-${row.key}`}
              className={`text-left border rounded-sm px-3 py-2.5 bg-[#0A0A0A] transition ${selected ? "border-white/40" : "border-white/10 hover:border-white/25"}`}
            >
              <div className="flex items-center gap-2">
                <AchievementIcon name={row.icon} fallback="trophy" className="w-3.5 h-3.5 shrink-0" style={{ color: row.accent }} />
                <span className="font-heading font-bold uppercase text-sm truncate">{row.label}</span>
                <span className="ml-auto text-[10px] uppercase tracking-widest text-white/50 tabular-nums shrink-0">{row.earned} von {row.total}</span>
              </div>
              <div className="mt-2 h-1 bg-white/5 rounded-sm overflow-hidden">
                <div className="h-full" style={{ width: `${percent}%`, backgroundColor: row.accent }} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AchievementFilters({ filters, onChange, resultCount }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="achievement-filters">
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-white/45 font-bold mr-1"><Filter className="w-3 h-3" /> Filter</span>
      <div className="inline-flex border border-white/15 rounded-sm overflow-hidden" role="group" aria-label="Status">
        {STATUS_FILTERS.map(([key, label]) => {
          const active = (filters.status || "all") === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange({ ...filters, status: key })}
              aria-pressed={active}
              data-testid={`achievement-filter-status-${key}`}
              className={`px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest transition ${active ? "bg-[#29B6E8]/15 text-[#29B6E8]" : "text-white/55 hover:text-white"}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <select
        value={filters.material || ""}
        onChange={(event) => onChange({ ...filters, material: event.target.value })}
        aria-label="Material"
        data-testid="achievement-filter-material"
        className="bg-[#0A0A0A] border border-white/15 rounded-sm px-2 py-1.5 text-[10px] uppercase tracking-widest text-white/80"
      >
        <option value="">Jedes Material</option>
        {MATERIAL_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {typeof resultCount === "number" && (
        <span className="text-[10px] uppercase tracking-widest text-white/40 tabular-nums" data-testid="achievement-filter-count">{resultCount} Gruppen</span>
      )}
      {(filters.material || (filters.status && filters.status !== "all")) && (
        <button type="button" onClick={() => onChange({ status: "all", material: "" })} className="text-[10px] font-bold uppercase tracking-widest text-white/60 hover:text-white" data-testid="achievement-filter-reset">
          Zurücksetzen
        </button>
      )}
    </div>
  );
}

export { formatPercent };
