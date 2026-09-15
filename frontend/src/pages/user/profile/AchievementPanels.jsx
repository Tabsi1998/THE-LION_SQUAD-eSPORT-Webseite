import { Medal, Sparkles, Target, User } from "lucide-react";
import { ACHIEVEMENT_ACTIONS } from "./constants";

export function AchievementOverview({ insights, profileScore }) {
  if (!insights) return null;
  const next = insights.openProgress.slice(0, 3);
  const nearlyDone = insights.openProgress.filter((tier) => Number(tier.percent || 0) >= 50).slice(0, 3);
  const manual = insights.manual.slice(0, 3);
  const planned = insights.planned.slice(0, 3);

  return (
    <div className="space-y-4" data-testid="achievement-overview">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <AchievementStat icon={Medal} label="Freigeschaltet" value={`${insights.earned.length}/${insights.total}`} color="#FFD700" />
        <AchievementStat icon={Sparkles} label="Punkte" value={insights.points.toLocaleString("de-DE")} color="#A855F7" />
        <AchievementStat icon={Target} label="Machbar" value={insights.openProgress.length} color="#00FF88" />
        <AchievementStat icon={User} label="Profilpflege" value={`${profileScore}%`} color="#29B6E8" />
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-4">
        <div className="border border-white/10 bg-[#121212] rounded-sm p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#00FF88]">Nächste Ziele</div>
              <h3 className="font-heading text-xl font-black uppercase mt-1">Was als Nächstes lohnt</h3>
            </div>
            <Target className="w-5 h-5 text-[#00FF88]" />
          </div>
          {next.length ? (
            <div className="space-y-2">
              {next.map((tier) => <NextAchievementRow key={tier.code} tier={tier} />)}
            </div>
          ) : (
            <div className="border border-dashed border-white/10 rounded-sm p-8 text-sm text-white/45 text-center">
              Keine automatisch messbaren offenen Ziele. Schau bei manuellen oder geplanten Achievements nach.
            </div>
          )}
        </div>

        <div className="space-y-4">
          <SmallAchievementPanel
            title="Fast geschafft"
            empty="Noch kein Ziel über 50%."
            rows={nearlyDone}
            color="#FFD700"
          />
          <SmallAchievementPanel
            title="Manuell / Event"
            empty="Keine manuellen Ziele offen."
            rows={manual}
            color="#FF3B30"
            manual
          />
          <SmallAchievementPanel
            title="Geplant"
            empty="Keine geplanten Ziele offen."
            rows={planned}
            color="#FFFFFF"
            manual
          />
        </div>
      </div>
    </div>
  );
}

function AchievementStat({ icon: Icon, label, value, color }) {
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/45 font-bold">
        <Icon className="w-3.5 h-3.5" style={{ color }} /> {label}
      </div>
      <div className="mt-2 font-heading text-2xl font-black tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}

function NextAchievementRow({ tier }) {
  const missing = Math.max(Number(tier.target || 0) - Number(tier.current || 0), 0);
  const action = ACHIEVEMENT_ACTIONS[tier.condition_key] || "Weiter aktiv bleiben";
  return (
    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3" data-testid={`next-achievement-${tier.code}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: tier.group_accent }}>{tier.group_name}</div>
          <div className="font-heading font-bold text-lg truncate">{tier.name}</div>
          <div className="text-xs text-white/50 mt-1">{action}{missing ? ` · noch ${missing.toLocaleString("de-DE")}` : ""}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-white/45 uppercase tracking-widest">+{tier.points}</div>
          {tier.member_only && <div className="mt-1 text-[9px] uppercase tracking-widest text-[#FFD700]">Verein</div>}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-white/5 rounded-sm overflow-hidden">
          <div className="h-full" style={{ width: `${Math.max(0, Math.min(100, Number(tier.percent || 0)))}%`, backgroundColor: tier.group_accent }} />
        </div>
        <span className="text-[10px] text-white/45 tabular-nums">{tier.current}/{tier.target}</span>
      </div>
    </div>
  );
}

function SmallAchievementPanel({ title, rows, empty, color, manual = false }) {
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="font-heading font-black uppercase text-base">{title}</h3>
        <span className="text-[10px] uppercase tracking-widest text-white/35">{rows.length}</span>
      </div>
      {rows.length ? (
        <div className="space-y-2">
          {rows.map((tier) => (
            <div key={tier.code} className="border border-white/10 bg-[#0A0A0A] rounded-sm px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{tier.name}</div>
                  <div className="text-[10px] uppercase tracking-widest text-white/35 truncate">{manual ? tier.group_name : `${tier.current}/${tier.target}`}</div>
                </div>
                <span className="text-xs font-bold shrink-0" style={{ color }}>{manual ? "Event" : `${tier.percent}%`}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-white/40 border border-dashed border-white/10 rounded-sm p-4 text-center">{empty}</div>
      )}
    </div>
  );
}

