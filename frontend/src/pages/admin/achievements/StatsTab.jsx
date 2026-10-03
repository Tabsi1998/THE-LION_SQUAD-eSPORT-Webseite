import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarRange, Download, Gem, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { CATEGORIES, MaterialChip, Panel, categoryLabel, download, errorText, personName } from "./shared";

const PAGE = 40;

/** „2026-W40“ → „KW 40“ */
function weekLabel(key) {
  const match = /W(\d+)$/.exec(String(key || ""));
  return match ? `KW ${Number(match[1])}` : key;
}

/** Statistik (E10): Freischaltungen je Woche, die Besten, Seltenheit je Stufe - und alles als CSV. */
export function StatsTab() {
  const [data, setData] = useState(null);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const load = useCallback(() => api.get("/admin/achievements/stats").then(({ data: next }) => setData(next)).catch((err) => toast.error(errorText(err))), []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["achievements"]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.rarity || []).filter((r) => (!category || r.category === category) && (!needle || `${r.name} ${r.group_name}`.toLowerCase().includes(needle)));
  }, [data, category, query]);

  const exportCsv = async () => {
    try {
      await download("/admin/achievements/stats.csv", "erfolge-statistik.csv");
    } catch (err) {
      toast.error(errorText(err, "Der Export hat nicht geklappt."));
    }
  };

  if (!data) return <div className="text-sm text-white/40">Lädt …</div>;
  const maxWeek = Math.max(1, ...data.weekly.map((w) => w.unlocks));
  return (
    <div className="space-y-6" data-testid="ach-stats">
      <div className="flex justify-end">
        <button type="button" onClick={exportCsv} data-testid="stats-csv" className="px-3 py-2 border border-white/20 text-white/70 text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 hover:text-white">
          <Download className="w-3.5 h-3.5" /> Als CSV
        </button>
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <Panel title="Freischaltungen je Woche" icon={CalendarRange} accent="#29B6E8" hint="Die letzten zwölf Wochen, ohne Fun-Erfolge." testId="stats-weekly">
          <div className="flex items-end gap-1.5 h-40" role="img" aria-label="Freischaltungen je Woche">
            {data.weekly.map((w) => (
              <div key={w.week} className="flex-1 flex flex-col items-center justify-end gap-1 h-full" data-testid={`stats-week-${w.week}`}>
                <span className="text-[9px] tabular-nums text-white/55">{w.unlocks || ""}</span>
                <span className="w-full rounded-t-sm bg-[#29B6E8]" style={{ height: `${Math.max(2, Math.round((w.unlocks / maxWeek) * 100))}%`, opacity: w.unlocks ? 1 : 0.25 }} />
                <span className="text-[8px] text-white/40 whitespace-nowrap">{weekLabel(w.week)}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Die Besten" icon={Trophy} hint="Erfolgspunkte – nur öffentliche Profile, wie auf der Seite." testId="stats-top">
          <ol className="divide-y divide-white/5">
            {data.top.map((row) => (
              <li key={row.id || row.user_id || row.rank} className="py-1.5 flex items-center gap-3 text-sm">
                <span className="w-6 font-heading font-black tabular-nums" style={{ color: row.rank === 1 ? "#FFD700" : "rgba(255,255,255,0.5)" }}>{row.rank}</span>
                <span className="flex-1 truncate">{personName(row)}</span>
                <span className="text-[11px] text-white/45 tabular-nums">{row.count} Erfolge · Level {row.level}</span>
                <span className="font-bold tabular-nums text-[#FFD700]">{Number(row.points || 0).toLocaleString("de-DE")}</span>
              </li>
            ))}
            {!data.top.length && <li className="py-6 text-center text-xs text-white/40">Noch niemand mit öffentlichem Profil.</li>}
          </ol>
        </Panel>
      </div>

      <Panel
        title="Seltenheit je Stufe"
        icon={Gem}
        accent="#A855F7"
        hint={`Anteil an ${data.base} Personen (Vereins-Stufen: an ${data.members_base} Mitgliedern) – die seltensten zuerst.`}
        actions={(
          <>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setShown(PAGE); }} aria-label="Kategorie" data-testid="stats-category" className="bg-[#0A0A0A] border border-white/15 rounded-sm px-2 py-1.5 text-xs text-white/80">
              <option value="">Alle Kategorien</option>
              {CATEGORIES.filter((c) => c.value !== "negative").map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <input value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} placeholder="Stufe suchen" aria-label="Stufe suchen" data-testid="stats-search" className="bg-[#0A0A0A] border border-white/15 rounded-sm px-2 py-1.5 text-xs text-white/80 w-40 focus:outline-none focus:border-[#29B6E8]" />
          </>
        )}
        testId="stats-rarity"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[640px]">
            <thead className="text-[10px] uppercase tracking-widest text-white/45">
              <tr><th className="text-left py-2 pr-3">Stufe</th><th className="text-left py-2 pr-3">Gruppe</th><th className="text-left py-2 pr-3">Kategorie</th><th className="text-right py-2 pr-3">Personen</th><th className="text-left py-2 w-1/4">Anteil</th></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.slice(0, shown).map((r) => (
                <tr key={r.code} data-testid={`stats-row-${r.code}`}>
                  <td className="py-1.5 pr-3">{r.name} <MaterialChip tier={r} className="ml-1" /></td>
                  <td className="py-1.5 pr-3 text-white/60">{r.group_name}</td>
                  <td className="py-1.5 pr-3 text-white/50">{categoryLabel(r.category)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.holders}</td>
                  <td className="py-1.5">
                    <span className="flex items-center gap-2">
                      <span className="flex-1 h-2 bg-white/5 rounded-sm overflow-hidden"><span className="block h-full bg-[#A855F7]" style={{ width: `${Math.min(100, r.percent)}%` }} /></span>
                      <span className="tabular-nums text-white/60 w-12 text-right">{String(r.percent).replace(".", ",")} %</span>
                    </span>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan="5" className="py-6 text-center text-white/40">Keine Stufe passt.</td></tr>}
            </tbody>
          </table>
        </div>
        {rows.length > shown && (
          <button type="button" onClick={() => setShown((n) => n + PAGE * 3)} data-testid="stats-more" className="mt-3 text-[10px] uppercase tracking-widest text-[#29B6E8] hover:underline">Mehr zeigen ({rows.length - shown} weitere)</button>
        )}
      </Panel>
    </div>
  );
}
