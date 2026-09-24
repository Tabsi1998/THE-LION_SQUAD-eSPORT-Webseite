import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { BellRing, Send } from "lucide-react";
import { api, formatApiError } from "@/lib/api";

// Alarme (#517): je Ereignisart, ob eine Meldung per Discord (Betriebs-Webhook) und/oder per E-Mail an
// den Vorstand geht; Sperrfrist je Schlüssel; Testalarm; Aufbewahrung der Versandlogs und Adminaktionen.
// Die Regeln liegen im Backend (services/ops_alerts), hier nur Anzeige und Speichern.

const RETENTION_LABELS = { email_logs: "Versandlogs (Tage)", audit_logs: "Adminaktionen (Tage)" };

function formatTime(value) {
  if (!value) return "–";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("de-DE");
}

export function OpsAlertsPanel() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const { data: next } = await api.get("/admin/ops/alerts");
      setData(next);
      setForm({ ...next.settings, emails: (next.settings.emails || []).join(", ") });
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Alarme konnten nicht geladen werden.");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data || !form) return <div className="text-sm text-white/45" data-testid="ops-alerts-loading">Lade Alarme …</div>;

  const setRule = (kind, channel, value) => setForm((current) => ({ ...current, rules: { ...current.rules, [kind]: { ...current.rules[kind], [channel]: value } } }));
  const save = async () => {
    if (busy) return;
    setBusy("save");
    try {
      const payload = { emails: form.emails, cooldown_minutes: Number(form.cooldown_minutes), rules: form.rules, retention_days: Object.fromEntries(Object.entries(form.retention_days).map(([k, v]) => [k, Number(v)])) };
      const { data: saved } = await api.put("/admin/ops/alerts", payload);
      setForm({ ...saved, emails: (saved.emails || []).join(", ") });
      setData((current) => ({ ...current, settings: saved }));
      toast.success("Alarme gespeichert.");
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Speichern hat nicht geklappt.");
    } finally {
      setBusy("");
    }
  };
  const sendTest = async () => {
    if (busy) return;
    setBusy("test");
    try {
      const { data: result } = await api.post("/admin/ops/alerts/test");
      const ways = (result.channels || []).map((c) => (c === "discord" ? "Discord" : "E-Mail")).join(" und ");
      if (result.sent) toast.success(`Testalarm raus per ${ways}.`);
      else toast.error("Kein Weg eingerichtet: Betriebs-Webhook (Verbindungen → Discord) oder E-Mail-Empfänger fehlen.");
      await load();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Testalarm hat nicht geklappt.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-4" data-testid="ops-alerts">
      <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-heading font-bold uppercase text-sm inline-flex items-center gap-2"><BellRing className="w-4 h-4 text-[#FFD700]" /> Wer erfährt was</div>
            <p className="text-xs text-white/50 mt-1 max-w-2xl">
              Discord geht über den Betriebs-Webhook (Verbindungen → Discord, ein privater Kanal nur für den Vorstand). E-Mail geht über die Mail-Queue an die Empfänger unten.
              Je Schlüssel (eine Prüfung, eine Fehlergruppe, ein Job) meldet die Website höchstens einmal je Sperrfrist.
            </p>
          </div>
          <button type="button" onClick={sendTest} disabled={!!busy} data-testid="ops-alert-test" className="inline-flex items-center gap-2 border border-[#29B6E8] text-[#29B6E8] px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
            <Send className="w-3.5 h-3.5" /> {busy === "test" ? "Sende …" : "Testalarm"}
          </button>
        </div>
        <table className="w-full mt-4 text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-white/45">
            <tr><th className="text-left py-2">Ereignis</th><th className="py-2">Discord</th><th className="py-2">E-Mail</th></tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {data.kinds.map((kind) => (
              <tr key={kind.key} data-testid={`ops-alert-row-${kind.key}`}>
                <td className="py-2 pr-3">
                  <div className="font-bold">{kind.label}</div>
                  <div className="text-xs text-white/45">{kind.hint}</div>
                </td>
                <td className="text-center"><input type="checkbox" checked={!!form.rules[kind.key]?.discord} onChange={(e) => setRule(kind.key, "discord", e.target.checked)} data-testid={`ops-alert-${kind.key}-discord`} className="accent-[#5865F2]" /></td>
                <td className="text-center">
                  <input type="checkbox" checked={!!form.rules[kind.key]?.email} disabled={kind.email_allowed === false} onChange={(e) => setRule(kind.key, "email", e.target.checked)} data-testid={`ops-alert-${kind.key}-email`} className="accent-[#29B6E8] disabled:opacity-40" title={kind.email_allowed === false ? "Nicht per Mail – der Mailversand ist ja selbst betroffen." : ""} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          <label className="block sm:col-span-2">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">E-Mail-Empfänger (mit Komma)</div>
            <input value={form.emails} onChange={(e) => setForm((c) => ({ ...c, emails: e.target.value }))} placeholder="vorstand@verein.at, kassier@verein.at" data-testid="ops-alert-emails" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          </label>
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Sperrfrist je Schlüssel (Minuten)</div>
            <input type="number" min={5} max={1440} value={form.cooldown_minutes} onChange={(e) => setForm((c) => ({ ...c, cooldown_minutes: e.target.value }))} data-testid="ops-alert-cooldown" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          </label>
          {Object.entries(RETENTION_LABELS).map(([key, label]) => (
            <label key={key} className="block">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Aufbewahrung: {label}</div>
              <input type="number" min={7} max={3650} value={form.retention_days[key]} onChange={(e) => setForm((c) => ({ ...c, retention_days: { ...c.retention_days, [key]: e.target.value } }))} data-testid={`ops-retention-${key}`} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            </label>
          ))}
        </div>
        <p className="text-xs text-white/40 mt-2">App-Logs, Fehlergruppen, Tempo-Messungen und Upload-Ereignisse räumt die Datenbank selbst nach ihrer festen Frist.</p>
        <button type="button" onClick={save} disabled={!!busy} data-testid="ops-alert-save" className="mt-3 px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-50">{busy === "save" ? "Speichere …" : "Alarme speichern"}</button>
      </div>

      <div className="border border-white/10 bg-[#121212] rounded-sm p-4" data-testid="ops-alert-recent">
        <div className="font-heading font-bold uppercase text-sm mb-2">Letzte Alarme</div>
        {!data.recent?.length ? <div className="text-sm text-white/45">Noch kein Alarm.</div> : (
          <ul className="divide-y divide-white/5 text-sm">
            {data.recent.map((row) => (
              <li key={row.id} className="py-2 flex flex-wrap gap-x-3 gap-y-1">
                <span className="text-white/40 text-xs w-36 shrink-0">{formatTime(row.at)}</span>
                <span className="font-bold">{row.title}</span>
                <span className="text-xs text-white/45">{row.channels?.length ? row.channels.map((c) => (c === "discord" ? "Discord" : "E-Mail")).join(", ") : "kein Weg (Regel aus oder nichts eingerichtet)"}</span>
                {row.description ? <span className="basis-full text-xs text-white/50 break-words">{row.description}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default OpsAlertsPanel;
