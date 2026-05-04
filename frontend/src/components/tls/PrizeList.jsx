import { Trophy, Medal, Award, Star } from "lucide-react";

/**
 * PrizeList — renders structured prize_places (array of {place, label, value})
 * Falls back to whitespace-pre-line prize_pool text block when structured data is missing.
 */
export function PrizeList({ prizePlaces, prizePool, compact = false }) {
  if (!prizePlaces?.length && !prizePool) return null;

  if (prizePlaces?.length) {
    const sorted = [...prizePlaces].sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
    return (
      <div data-testid="prize-list" className={compact ? "space-y-1.5" : "grid grid-cols-1 sm:grid-cols-2 gap-3"}>
        {sorted.map((p, i) => <PrizeRow key={`${p.place}-${i}`} prize={p} compact={compact} />)}
      </div>
    );
  }

  return (
    <div className="text-white/80 whitespace-pre-line border border-[#FFD700]/20 rounded-sm p-5 bg-[#FFD700]/5">
      {prizePool}
    </div>
  );
}

function PrizeRow({ prize, compact }) {
  const place = Number(prize.place) || 0;
  const { bg, border, text, Icon } = placeStyle(place);
  if (compact) {
    return (
      <div className={`flex items-center gap-3 px-3 py-2 border rounded-sm ${border} ${bg}`}>
        <div className={`w-7 h-7 rounded-sm flex items-center justify-center shrink-0 ${text}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-[10px] uppercase tracking-widest font-bold ${text}`}>{prize.label || `Platz ${place}`}</div>
          <div className="text-sm text-white truncate">{prize.value}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={`relative overflow-hidden border rounded-sm p-4 ${border} ${bg}`}>
      <div className="absolute -top-4 -right-4 opacity-10 pointer-events-none">
        <Icon className="w-24 h-24" />
      </div>
      <div className="relative">
        <div className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] font-bold ${text}`}>
          <Icon className="w-3 h-3" /> {prize.label || `Platz ${place}`}
        </div>
        <div className="mt-2 font-heading text-lg md:text-xl font-bold text-white leading-tight">
          {prize.value}
        </div>
      </div>
    </div>
  );
}

function placeStyle(place) {
  if (place === 1) return { bg: "bg-[#FFD700]/5", border: "border-[#FFD700]/40", text: "text-[#FFD700]", Icon: Trophy };
  if (place === 2) return { bg: "bg-white/5", border: "border-white/25", text: "text-white", Icon: Medal };
  if (place === 3) return { bg: "bg-[#CD7F32]/5", border: "border-[#CD7F32]/40", text: "text-[#CD7F32]", Icon: Award };
  return { bg: "bg-[#29B6E8]/5", border: "border-[#29B6E8]/25", text: "text-[#29B6E8]", Icon: Star };
}
