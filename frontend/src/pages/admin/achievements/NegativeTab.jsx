import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertOctagon, ShieldOff } from "lucide-react";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { INPUT_CLASS } from "@/components/tls/FormFields";
import { Badge } from "@/components/achievements/Badge";
import { Panel, PersonPicker, errorText, formatWhen, personName, useCatalog } from "./shared";

/** Negativ und Vorfälle (E10): Vorfall auslösen, die Liste mit der neuen Symbolik, Entfernen mit Grund. */
export function NegativeTab() {
  const catalog = useCatalog();
  const [list, setList] = useState([]);
  const [types, setTypes] = useState([]);
  const [person, setPerson] = useState(null);
  const [type, setType] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [reason, setReason] = useState("");

  const load = useCallback(() => api.get("/admin/achievements/negative/awards").then(({ data }) => setList(Array.isArray(data) ? data : [])).catch(() => setList([])), []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["achievements"]);
  useEffect(() => {
    api.get("/admin/achievements/incident-types").then(({ data }) => setTypes(Array.isArray(data) ? data : [])).catch(() => setTypes([]));
  }, []);
  const tierByCode = useMemo(() => Object.fromEntries(catalog.tiers.map((t) => [t.code, t])), [catalog.tiers]);

  const trigger = async () => {
    if (!person || !type) return;
    setBusy(true);
    try {
      const { data } = await api.post("/admin/achievements/trigger-incident", { user_id: person.id, incident_type: type, note: note.trim() || null });
      if (data.newly_awarded) toast.success(`Vorfall bei ${personName(person)} eingetragen`);
      else toast.info(`${personName(person)} hat diesen Vorfall schon.`);
      setNote("");
      load();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a) => {
    if (reason.trim().length < 3) { toast.error("Bitte einen Grund angeben."); return; }
    try {
      await api.delete("/admin/achievements/award", { data: { user_id: a.user_id, tier_code: a.tier_code, note: reason.trim() } });
      toast.success("Entfernt");
      setRemoving(null);
      setReason("");
      setList((current) => current.filter((x) => !(x.user_id === a.user_id && x.tier_code === a.tier_code)));
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <div className="space-y-6" data-testid="ach-negative">
      <Panel title="Vorfall eintragen" icon={AlertOctagon} accent="#FF3B30" hint="Fun-Erfolge für kleine Missgeschicke – bis zur Freischaltung geheim, danach im Profil sichtbar." testId="negative-trigger">
        <div className="grid lg:grid-cols-2 gap-4">
          <PersonPicker value={person} onChange={setPerson} testId="negative-person" />
          <div className="space-y-2">
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">Vorfall</span>
              <select value={type} onChange={(e) => setType(e.target.value)} data-testid="negative-type" className={`${INPUT_CLASS} mt-1`}>
                <option value="">— wählen —</option>
                {types.map((t) => <option key={t.key} value={t.key}>{tierByCode[t.tier_code]?.name || t.key}</option>)}
              </select>
            </label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notiz (z. B. Match oder Turnier)" aria-label="Notiz" data-testid="negative-note" className={INPUT_CLASS} />
            <button type="button" onClick={trigger} disabled={busy || !person || !type} data-testid="negative-submit" className="px-4 py-2 bg-[#FF3B30] text-white text-[10px] font-bold uppercase tracking-widest rounded-sm disabled:opacity-40">Eintragen</button>
          </div>
        </div>
      </Panel>

      <Panel title={`${list.length} Fun-Erfolge vergeben`} icon={ShieldOff} accent="#FF3B30" testId="negative-list">
        <ul className="divide-y divide-white/5">
          {list.map((a) => (
            <li key={a.user_id + a.tier_code} className="py-2" data-testid={`negative-row-${a.tier_code}`}>
              <div className="flex items-center gap-3">
                <Badge material={a.material || "hidden"} art={a.art || undefined} icon={a.icon} size="sm" animate={false} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm"><span className="text-[#FF3B30] font-semibold">{a.tier_name}</span> · {a.display_name || a.username}</div>
                  <div className="text-[11px] text-white/45">{formatWhen(a.earned_at)}{a.context?.note ? ` · „${a.context.note}“` : ""}</div>
                </div>
                {removing !== a.user_id + a.tier_code && <button type="button" onClick={() => { setRemoving(a.user_id + a.tier_code); setReason(""); }} className="text-[#FF3B30] hover:underline text-xs">Entfernen</button>}
              </div>
              {removing === a.user_id + a.tier_code && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Grund" aria-label="Grund für das Entfernen" data-testid={`negative-reason-${a.tier_code}`} className={`${INPUT_CLASS} flex-1 min-w-[12rem]`} />
                  <button type="button" onClick={() => remove(a)} data-testid={`negative-remove-${a.tier_code}`} className="px-3 py-2 bg-[#FF3B30] text-white text-[10px] font-bold uppercase tracking-widest rounded-sm">Entfernen</button>
                  <button type="button" onClick={() => setRemoving(null)} className="text-[10px] uppercase tracking-widest text-white/50">Abbrechen</button>
                </div>
              )}
            </li>
          ))}
          {!list.length && <li className="py-10 text-center text-sm text-white/40">Keine Fun-Erfolge vergeben.</li>}
        </ul>
      </Panel>
    </div>
  );
}
