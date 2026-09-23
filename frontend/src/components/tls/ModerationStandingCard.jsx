import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Send, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";

// Der eigene Stand bei der Moderation (#416): laufende Maßnahme (Hinweis, Verwarnung mit
// Chat-Sperre, Sperre bis zur Entscheidung) mit Grund und Dauer, die Treffer der letzten Monate,
// was beim nächsten Treffer käme, und der Einspruch. `compact` (Dashboard) zeigt die Karte nur,
// wenn es etwas gibt; die volle Karte steht unter „Meine Strafen“. Nur die Person sieht das.

const ACTION_TONE = { notice: "#FFD700", warning: "#FF9500", suspension: "#FF3B30" };

export function formatMoment(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

function appealState(appeal) {
  if (!appeal) return "";
  if (appeal.status === "open") return `Dein Einspruch vom ${formatMoment(appeal.created_at)} liegt bei der Moderation.`;
  const outcome = appeal.decision === "lift" ? "angenommen" : "abgelehnt";
  return `Dein Einspruch vom ${formatMoment(appeal.created_at)} wurde ${outcome}.${appeal.decision_note ? ` ${appeal.decision_note}` : ""}`;
}

export function ModerationStandingCard({ compact = false }) {
  const [standing, setStanding] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/moderation/me/standing");
      setStanding(data || null);
    } catch {
      setStanding(null);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!standing) return null;
  const active = standing.active;
  const relevant = Boolean(active) || (standing.strike_count || 0) > 0;
  if (compact && !relevant) return null;
  const tone = active ? ACTION_TONE[active.action] || "#FFD700" : "#00FF88";

  const sendAppeal = async () => {
    if (!active || message.trim().length < 10) {
      toast.error("Bitte schreib in ein paar Sätzen, warum die Maßnahme nicht passt (mindestens 10 Zeichen).");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/moderation/me/appeal", { sanction_id: active.id, message: message.trim() });
      setStanding(data?.standing || standing);
      setMessage("");
      toast.success("Dein Einspruch liegt jetzt bei der Moderation.");
    } catch (error) {
      toast.error(formatRequestError(error, "Der Einspruch konnte nicht gesendet werden."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border rounded-sm bg-[#121212] p-5" style={{ borderColor: `${tone}55` }} data-testid="moderation-standing">
      <h2 className="font-heading text-xl font-bold uppercase mb-3 flex items-center gap-2">
        {active ? <ShieldAlert className="w-4 h-4" style={{ color: tone }} /> : <ShieldCheck className="w-4 h-4 text-[#00FF88]" />} Moderation
      </h2>
      {active ? (
        <div className="border rounded-sm p-4 bg-black/30" style={{ borderColor: `${tone}66` }} data-testid="standing-active">
          <div className="font-bold" style={{ color: tone }}>{active.label}</div>
          <div className="text-xs text-white/60 mt-1">
            seit {formatMoment(active.created_at)}
            {active.chat_blocked_until ? ` · Chat gesperrt bis ${formatMoment(active.chat_blocked_until)}` : active.open_until_decision ? " · bis zur Entscheidung der Moderation" : ""}
          </div>
          {active.reason && <div className="text-sm text-white/80 mt-2">Grund: {active.reason}</div>}
          {active.appeal && <div className="text-xs text-white/70 mt-2" data-testid="standing-appeal-state">{appealState(active.appeal)}</div>}
          {standing.can_appeal && !compact && (
            <div className="mt-3" data-testid="standing-appeal-form">
              <label htmlFor="standing-appeal" className="block text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Einspruch – warum passt die Maßnahme nicht?</label>
              <textarea id="standing-appeal" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={2000} data-testid="standing-appeal-message" className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-sm" placeholder="Schreib der Moderation, was aus deiner Sicht passiert ist." />
              <button type="button" onClick={sendAppeal} disabled={busy} data-testid="standing-appeal-send" className="mt-2 inline-flex items-center gap-2 px-4 py-2 border border-[#29B6E8]/50 text-[#29B6E8] hover:bg-[#29B6E8]/10 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
                <Send className="w-3.5 h-3.5" /> Einspruch senden
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-white/60" data-testid="standing-clear">Keine laufende Maßnahme.</div>
      )}
      <div className="mt-3 text-xs text-white/60" data-testid="standing-strikes">
        {standing.strike_count || 0} Treffer in den letzten {standing.strike_ttl_months} Monaten
        {standing.next_level ? ` · beim ${standing.next_level.strikes}. Treffer: ${standing.next_level.label}` : ""}
      </div>
      {!compact && (standing.strikes || []).length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-white/60" data-testid="standing-strike-list">
          {standing.strikes.map((strike) => (
            <li key={strike.id}>{formatMoment(strike.created_at)} · {strike.source_label}{strike.note ? ` · ${strike.note}` : ""}</li>
          ))}
        </ul>
      )}
      {!compact && (standing.history || []).length > 0 && (
        <details className="mt-3 text-xs text-white/60">
          <summary className="cursor-pointer select-none hover:text-white">Verlauf ({standing.history.length})</summary>
          <ul className="mt-2 space-y-1">
            {standing.history.map((entry) => (
              <li key={entry.id}>{formatMoment(entry.created_at)} · {entry.label} · {entry.status === "active" ? "läuft" : entry.status === "lifted" ? "aufgehoben" : entry.status === "expired" ? "abgelaufen" : entry.status === "superseded" ? "durch höhere Stufe ersetzt" : entry.status}</li>
            ))}
          </ul>
        </details>
      )}
      {compact && (
        <Link to="/my/penalties" data-testid="standing-more" className="mt-3 inline-block text-[11px] font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white">Details und Einspruch →</Link>
      )}
    </section>
  );
}

export default ModerationStandingCard;
