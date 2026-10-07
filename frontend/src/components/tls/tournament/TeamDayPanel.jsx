import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, Check, UserCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";
import { lineupLabel, presenceLine, starterLabel } from "@/lib/teamDay";
import { viennaDateTime, viennaTime } from "@/lib/vienna";

// Team am Spieltag (#1192) in „Dein Stand“ - nur bei Team-Turnieren. Kapitän oder Co-Kapitän wählt, wer spielt
// (genau so viele wie Spieler je Team; die übrigen sind Ersatz, wenn erlaubt), bis zum Ende des Check-ins. Am
// Turniertag tippt jedes Mitglied „Ich bin da“; der Kapitän sieht „4 von 5 da“ und kann Fehlende anstupsen.

export function TeamDayPanel({ tournament }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const { submitting, submitOnce } = useSubmissionGuard();

  const load = useCallback(async () => {
    try {
      const { data: next } = await api.get(`/team-day/${tournament.id}`);
      setData(next);
      setDraft(null);
    } catch {
      setData(null);
    }
  }, [tournament.id]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["tournaments"]);

  const chosen = useMemo(() => draft ?? data?.lineup ?? [], [draft, data]);
  if (!data?.applicable) return null;

  const run = async (task, fallback) => {
    const attempt = await submitOnce(task);
    if (attempt.started && attempt.error) toast.error(formatRequestError(attempt.error, fallback));
  };
  const toggle = (id) => {
    const current = draft ?? data.lineup ?? [];
    setDraft(current.includes(id) ? current.filter((uid) => uid !== id) : [...current, id]);
  };
  const save = () => run(async () => {
    const { data: next } = await api.put(`/team-day/${tournament.id}/lineup`, { lineup: chosen });
    setData(next);
    setDraft(null);
    toast.success("Aufstellung gespeichert.");
  }, "Aufstellung konnte nicht gespeichert werden.");
  const reset = () => run(async () => {
    const { data: next } = await api.delete(`/team-day/${tournament.id}/lineup`);
    setData(next);
    setDraft(null);
    toast.success("Aufstellung zurückgenommen – es gilt wieder das ganze Team.");
  }, "Das hat nicht geklappt.");
  const presence = (here) => run(async () => {
    const { data: next } = here ? await api.post(`/team-day/${tournament.id}/presence`) : await api.delete(`/team-day/${tournament.id}/presence`);
    setData(next);
  }, "Das hat nicht geklappt.");
  const nudge = () => run(async () => {
    const { data: next } = await api.post(`/team-day/${tournament.id}/nudge`);
    setData(next);
    toast.success(next.nudged ? `${next.nudged} angestupst.` : "Alle sind schon da.");
  }, "Anstupsen hat nicht geklappt.");

  const size = data.team_size;
  const dirty = draft !== null;
  const valid = chosen.length === size;
  const pres = data.presence || {};
  const counted = new Set(pres.counted || []);
  const present = pres.present || {};

  return (
    <div className="mt-4 border-t border-white/10 pt-4 space-y-5" data-testid="team-day">
      <section data-testid="team-lineup">
        <div className="flex items-center justify-between gap-3">
          <div className="font-heading font-bold uppercase text-sm flex items-center gap-2"><Users className="w-4 h-4 text-[#29B6E8]" /> Wer spielt heute?</div>
          <span className={`text-xs font-bold ${valid ? "text-[#29B6E8]" : "text-white/55"}`} data-testid="team-lineup-count">{chosen.length} von {size}</span>
        </div>
        <ul className="mt-2 divide-y divide-white/5 border border-white/10 rounded-sm bg-black/20">
          {data.members.map((member) => {
            const on = chosen.includes(member.id);
            const label = on ? starterLabel(member) : (data.substitutes_allowed ? "Ersatz" : "–");
            return (
              <li key={member.id} className="flex items-center gap-3 px-3 py-2" data-testid={`team-lineup-member-${member.id}`}>
                {data.can_edit ? (
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(member.id)}
                    aria-label={`${member.display_name} spielt`}
                    data-testid={`team-lineup-toggle-${member.id}`}
                    className="w-4 h-4 accent-[#29B6E8]"
                  />
                ) : (
                  <span className={`w-4 h-4 inline-flex items-center justify-center ${on ? "text-[#29B6E8]" : "text-white/20"}`}>{on ? <Check className="w-4 h-4" /> : "·"}</span>
                )}
                <span className="flex-1 min-w-0 truncate text-sm font-bold">{member.display_name}</span>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${on ? "text-[#29B6E8]" : "text-white/45"}`}>{label}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-white/55" data-testid="team-lineup-note">{lineupLabel(data, chosen.length)}</p>
        {data.can_edit ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={save} disabled={!dirty || !valid || submitting} data-testid="team-lineup-save" className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-45">Aufstellung speichern</button>
            {data.lineup_set ? <button type="button" onClick={reset} disabled={submitting} data-testid="team-lineup-reset" className="tls-btn tls-btn--quiet px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-45">Zurücknehmen</button> : null}
            {data.editable_until ? <span className="text-[11px] text-white/45">änderbar bis {viennaDateTime(data.editable_until, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span> : null}
          </div>
        ) : null}
      </section>

      {pres.enabled ? (
        <section data-testid="team-presence">
          <div className="flex items-center justify-between gap-3">
            <div className="font-heading font-bold uppercase text-sm flex items-center gap-2"><UserCheck className="w-4 h-4 text-[#29B6E8]" /> Wer ist da?</div>
            <span className="text-xs font-bold text-[#29B6E8]" data-testid="team-presence-count">{presenceLine(pres)}</span>
          </div>
          <div className="mt-2 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-[#29B6E8] rounded-full" style={{ width: `${pres.total ? Math.round((pres.count / pres.total) * 100) : 0}%` }} />
          </div>
          <ul className="mt-2 space-y-1">
            {data.members.filter((member) => counted.has(member.id)).map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 text-sm" data-testid={`team-presence-${member.id}`}>
                <span className="truncate">{member.display_name}</span>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${present[member.id] ? "text-[#29B6E8]" : "text-white/40"}`}>
                  {present[member.id] ? `da · ${viennaTime(present[member.id], { hour: "2-digit", minute: "2-digit" })}` : "fehlt"}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {pres.me_present ? (
              <button type="button" onClick={() => presence(false)} disabled={submitting} data-testid="team-presence-undo" className="tls-btn tls-btn--quiet px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-45">Doch noch nicht da</button>
            ) : (
              <button type="button" onClick={() => presence(true)} disabled={submitting} data-testid="team-presence-here" className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-45">Ich bin da</button>
            )}
            {data.can_nudge ? (
              <button type="button" onClick={nudge} disabled={submitting || Boolean(data.nudge_available_at) || pres.count >= pres.total} data-testid="team-presence-nudge" className="tls-btn tls-btn--secondary inline-flex items-center gap-2 px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-45">
                <BellRing className="w-3.5 h-3.5" /> {data.nudge_available_at ? `Wieder ab ${viennaTime(data.nudge_available_at, { hour: "2-digit", minute: "2-digit" })}` : "Fehlende anstupsen"}
              </button>
            ) : null}
          </div>
        </section>
      ) : (
        <p className="text-xs text-white/50" data-testid="team-presence-later">Am Turniertag tippt hier jedes Mitglied „Ich bin da“ – so sieht das Team, wer schon da ist.</p>
      )}
    </div>
  );
}

export default TeamDayPanel;
