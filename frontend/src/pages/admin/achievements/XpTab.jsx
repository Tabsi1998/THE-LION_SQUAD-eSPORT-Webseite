import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Gauge, RotateCcw, Star, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { INPUT_CLASS } from "@/components/tls/FormFields";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { BoardOnly, Panel, PersonPicker, Stat, XP_SOURCES, errorText, personName } from "./shared";

/** XP (E10): Stand einer Person, Tagesdeckel je Quelle, Korrektur mit Grund, Prestige zurücksetzen. */
export function XpTab({ board = false }) {
  const [person, setPerson] = useState(null);
  const [caps, setCaps] = useState(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [resetReason, setResetReason] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(() => {
    if (!person) { setCaps(null); return; }
    api.get(`/admin/achievements/xp/caps?user_id=${encodeURIComponent(person.id)}`).then(({ data }) => setCaps(data)).catch((err) => { toast.error(errorText(err)); setCaps(null); });
  }, [person]);
  useEffect(() => { load(); }, [load]);

  const correct = async () => {
    const value = parseInt(amount, 10);
    if (!value) { toast.error("Bitte eine Zahl ungleich null eingeben."); return; }
    if (reason.trim().length < 3) { toast.error("Bitte einen Grund angeben."); return; }
    setBusy(true);
    try {
      await api.post("/admin/achievements/xp", { user_id: person.id, amount: value, reason: reason.trim() });
      toast.success(`${value > 0 ? "+" : ""}${value} XP für ${personName(person)}`);
      setAmount("");
      setReason("");
      load();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const resetPrestige = async () => {
    if (resetReason.trim().length < 3) { toast.error("Bitte einen Grund angeben."); return; }
    if (!await confirm({ title: "Prestige zurücksetzen?", description: `${personName(person)} verliert alle ${caps.view.prestige} Sterne. Die XP bleiben, das Level wird neu gerechnet.`, confirmLabel: "Zurücksetzen" })) return;
    setBusy(true);
    try {
      await api.post("/admin/achievements/xp/prestige-reset", { user_id: person.id, reason: resetReason.trim() });
      toast.success("Prestige zurückgesetzt");
      setResetReason("");
      load();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const view = caps?.view;
  return (
    <div className="space-y-6" data-testid="ach-xp">
      <div className="grid lg:grid-cols-[minmax(0,22rem)_1fr] gap-6">
        <Panel title="Person" icon={Zap} testId="xp-person">
          <PersonPicker value={person} onChange={setPerson} testId="xp-person" />
        </Panel>
        {view ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Level" value={view.level} hint={view.title} testId="xp-level" />
              <Stat label="XP" value={Number(view.xp || 0).toLocaleString("de-DE")} hint={`nächstes Level ab ${Number(view.next_level_xp || 0).toLocaleString("de-DE")}`} accent="#29B6E8" testId="xp-total" />
              <Stat label="Prestige" value={"★".repeat(view.prestige || 0) || "–"} hint={view.prestige_available ? "Prestige möglich" : `${view.prestige || 0} Stern${view.prestige === 1 ? "" : "e"}`} accent="#FF3B30" testId="xp-prestige" />
              <Stat label="Login-Serie" value={view.login_streak || 0} hint="Tage in Folge" accent="#00FF88" />
            </div>
            <Panel title={`Tagesdeckel heute (${caps.day})`} icon={Gauge} accent="#29B6E8" hint="Wie oft eine Quelle heute schon XP gebracht hat – volle Deckel bringen bis Mitternacht nichts mehr." testId="xp-caps">
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[480px]">
                  <thead className="text-[10px] uppercase tracking-widest text-white/45">
                    <tr><th className="text-left py-2 pr-3">Quelle</th><th className="text-right py-2 pr-3">XP je Mal</th><th className="text-left py-2 pr-3">Heute</th><th className="text-right py-2">Stand</th></tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {caps.rows.map((row) => (
                      <tr key={row.source} data-testid={`xp-cap-${row.source}`}>
                        <td className="py-2 pr-3">{XP_SOURCES[row.source] || row.source}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{row.xp}</td>
                        <td className="py-2 pr-3 w-1/3">
                          {row.cap ? (
                            <span className="block h-2 bg-white/5 rounded-sm overflow-hidden"><span className="block h-full" style={{ width: `${Math.min(100, Math.round((row.used / row.cap) * 100))}%`, backgroundColor: row.full ? "#FF3B30" : "#29B6E8" }} /></span>
                          ) : <span className="text-white/35">ohne Deckel</span>}
                        </td>
                        <td className={`py-2 text-right tabular-nums ${row.full ? "text-[#FF3B30] font-bold" : ""}`}>{row.cap ? `${row.used} / ${row.cap}${row.full ? " · voll" : ""}` : row.used}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <div className="grid lg:grid-cols-2 gap-6">
              <Panel title="XP korrigieren" icon={Star} hint="Plus oder minus, immer mit Grund – steht im Protokoll und im Verlauf der Person." testId="xp-correct">
                <BoardOnly board={board} what="XP-Korrekturen">
                  <div className="space-y-2">
                    <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="z. B. 50 oder -20" aria-label="XP" data-testid="xp-amount" className={INPUT_CLASS} />
                    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Grund" aria-label="Grund" data-testid="xp-reason" className={INPUT_CLASS} />
                    <button type="button" onClick={correct} disabled={busy} data-testid="xp-submit" className="px-4 py-2 bg-[#FFD700] text-black text-[10px] font-bold uppercase tracking-widest rounded-sm disabled:opacity-40">Korrigieren</button>
                  </div>
                </BoardOnly>
              </Panel>
              <Panel title="Prestige zurücksetzen" icon={RotateCcw} accent="#FF3B30" hint="Alle Sterne weg, die XP bleiben, das Level wird neu gerechnet." testId="xp-reset">
                <BoardOnly board={board} what="Das Zurücksetzen">
                  {view.prestige ? (
                    <div className="space-y-2">
                      <input value={resetReason} onChange={(e) => setResetReason(e.target.value)} placeholder="Grund" aria-label="Grund für das Zurücksetzen" data-testid="xp-reset-reason" className={INPUT_CLASS} />
                      <button type="button" onClick={resetPrestige} disabled={busy} data-testid="xp-reset-submit" className="px-4 py-2 bg-[#FF3B30] text-white text-[10px] font-bold uppercase tracking-widest rounded-sm disabled:opacity-40">Zurücksetzen</button>
                    </div>
                  ) : <p className="text-xs text-white/45">{personName(person)} hat keine Prestige-Sterne.</p>}
                </BoardOnly>
              </Panel>
            </div>
          </div>
        ) : (
          <p className="text-sm text-white/40 self-center" data-testid="xp-empty">Eine Person wählen, um Stand und Deckel zu sehen.</p>
        )}
      </div>
    </div>
  );
}
