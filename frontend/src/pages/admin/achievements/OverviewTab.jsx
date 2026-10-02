import { useCallback, useEffect, useState } from "react";
import { Activity, BarChart3, Moon, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { Bars, CATEGORIES, Panel, Stat, errorText, formatWhen, materialColor } from "./shared";

const LEVEL_BUCKETS = ["1-9", "10-19", "20-29", "30-39", "40-49", "50-59", "60"];

/** Übersicht (E10): Kennzahlen, Level-Verteilung, Warteschlange mit „alle auswerten“, nächtlicher Abgleich. */
export function OverviewTab() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get("/admin/achievements/overview").then(({ data: next }) => setData(next)).catch((err) => toast.error(errorText(err))), []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["achievements"]);

  const evaluateAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data: result } = await api.post("/admin/achievements/evaluation/all");
      toast.success(`${result.queued} Konten vorgemerkt – die Auswertung läuft im Hintergrund.`);
      load();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="text-sm text-white/40" data-testid="ach-overview-loading">Lädt …</div>;
  const rarest = data.rarest;
  const active = data.most_active_category;
  const queue = data.queue || {};
  const reconcile = data.reconcile;
  const perCategory = CATEGORIES.filter((c) => data.per_category_30d?.[c.value]).map((c) => ({ key: c.value, label: c.label, value: data.per_category_30d[c.value] }));

  return (
    <div className="space-y-6" data-testid="ach-overview">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="Freischaltungen 7 Tage" value={data.unlocks_7d} testId="ov-unlocks-7d" />
        <Stat label="Freischaltungen 30 Tage" value={data.unlocks_30d} accent="#29B6E8" testId="ov-unlocks-30d" />
        <Stat label="Ohne Erfolg" value={data.users_without_award} hint={`von ${data.users_total} Personen`} accent="#FF3B30" testId="ov-without" />
        <Stat label="Seltenste Stufe" value={rarest ? rarest.name : "–"} hint={rarest ? `${rarest.group_name} · ${rarest.holders} Person${rarest.holders === 1 ? "" : "en"} (${rarest.percent} %)` : "noch keine Vergabe"} accent={rarest ? materialColor(rarest) : "#FFD700"} testId="ov-rarest" />
        <Stat label="Aktivste Kategorie" value={active ? active.label : "–"} hint={active ? `${active.count} Freischaltungen in 30 Tagen` : "noch keine"} accent="#00FF88" testId="ov-active" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Panel title="Level-Verteilung" icon={BarChart3} accent="#29B6E8" hint={`${data.prestige_holders} Person${data.prestige_holders === 1 ? " hat" : "en haben"} mindestens einen Prestige-Stern.`} testId="ov-levels">
          <Bars testId="ov-level-bars" rows={LEVEL_BUCKETS.map((key) => ({ key, label: key === "60" ? "Level 60" : `Level ${key}`, value: data.levels?.[key] || 0 }))} />
        </Panel>
        <Panel title="Freischaltungen je Kategorie (30 Tage)" icon={Users} accent="#00FF88" testId="ov-categories">
          {perCategory.length ? <Bars rows={perCategory} accent="#00FF88" testId="ov-category-bars" /> : <p className="text-xs text-white/45">In den letzten 30 Tagen wurde nichts freigeschaltet.</p>}
        </Panel>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Panel
          title="Auswertung"
          icon={Activity}
          hint="Erfolge werden vergeben, sobald etwas passiert (Ergebnis, Turnierabschluss, Bestzeit …) – eine Warteschlange arbeitet die Betroffenen alle 30 Sekunden ab."
          actions={(
            <button type="button" onClick={evaluateAll} disabled={busy} data-testid="ach-evaluate-all" className="px-3 py-1.5 border border-[#FFD700]/50 text-[#FFD700] text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 disabled:opacity-40">
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} /> Alle jetzt auswerten
            </button>
          )}
          testId="ach-evaluation"
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <dt className="text-white/45">Warten gerade</dt><dd className="tabular-nums" data-testid="ov-queue-waiting">{queue.waiting ?? "–"}</dd>
            <dt className="text-white/45">Noch zu melden</dt><dd className="tabular-nums">{queue.unannounced ?? "–"}</dd>
            <dt className="text-white/45">Letzter Lauf</dt><dd>{formatWhen(queue.last_queue_run_at)}</dd>
            <dt className="text-white/45">Letzte Runde über alle</dt><dd>{formatWhen(queue.last_full_sweep_at)}</dd>
          </dl>
        </Panel>
        <Panel title="Nächtlicher Abgleich" icon={Moon} accent="#A855F7" hint="Nachts werden alle zuletzt Aktiven komplett neu gerechnet; Abweichungen heißen, dass ein Ereignis unterwegs verloren ging." testId="ov-reconcile">
          {reconcile ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <dt className="text-white/45">Zuletzt</dt><dd>{formatWhen(reconcile.at)}</dd>
              <dt className="text-white/45">Geprüft</dt><dd className="tabular-nums">{reconcile.checked ?? 0} Personen</dd>
              <dt className="text-white/45">Abweichungen</dt><dd className={`tabular-nums ${reconcile.drift ? "text-[#FFD700]" : ""}`} data-testid="ov-reconcile-drift">{reconcile.drift ?? 0}</dd>
              <dt className="text-white/45">Dabei vergeben</dt><dd className="tabular-nums">{reconcile.awarded ?? 0}</dd>
            </dl>
          ) : <p className="text-xs text-white/45">Der Abgleich ist noch nicht gelaufen.</p>}
        </Panel>
      </div>
      <p className="text-[11px] text-white/35">Katalog: {data.catalog?.groups ?? 0} Gruppen · {data.catalog?.tiers ?? 0} Stufen</p>
    </div>
  );
}
