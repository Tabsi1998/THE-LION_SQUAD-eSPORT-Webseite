import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CalendarClock, Check, MessageSquare, Send, X } from "lucide-react";
import { toast } from "sonner";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { MentionTextarea } from "@/components/tls/MentionTextarea";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

const scheduleLabels = {
  proposed: "Terminvorschlag offen",
  accepted: "Termin bestätigt",
  declined: "Vorschlag abgelehnt",
  escalated: "Turnierleitung nötig",
};

const eventModeLabels = {
  local: "Vor Ort",
  online: "Online",
  hybrid: "Hybrid",
};

const resultModeLabels = {
  staff_only: "Ergebnis durch Turnierleitung",
  player_confirmed: "Spieler bestaetigen Ergebnis",
  hybrid: "Spieler + Staff",
};

const scheduleModeLabels = {
  fixed_by_staff: "Termin durch Turnierleitung",
  player_proposal: "Terminabstimmung",
  hybrid: "Terminabstimmung + Staff",
};

function formatDateTime(value) {
  if (!value) return "Noch kein Termin";
  return new Date(value).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

function stationLabel(match) {
  return match?.station_label || match?.station_name || match?.station?.name || match?.station_id || "";
}

function toLocalInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export default function MatchPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [chat, setChat] = useState([]);
  const [proposalAt, setProposalAt] = useState("");
  const [proposalNote, setProposalNote] = useState("");
  const [counterAt, setCounterAt] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: page }, { data: messages }] = await Promise.all([
      api.get(`/matches/${id}/page`),
      api.get(`/matches/${id}/chat`),
    ]);
    setData(page);
    setChat(messages || []);
    setProposalAt(toLocalInput(page.match?.scheduled_at));
  }, [id]);

  useEffect(() => { load().catch(() => setData(null)); }, [load]);
  useApiInvalidation(load, ["matches", "matches_v2", "tournaments"]);

  const title = data?.tournament?.title ? `${data.matchday_label} - ${data.tournament.title}` : "Match";
  useDocumentTitle(title, "Matchseite mit Terminabstimmung und Matchchat.");

  const propose = async (e) => {
    e.preventDefault();
    const scheduled_at = fromLocalInput(proposalAt);
    if (!scheduled_at) return toast.error("Bitte Datum und Uhrzeit wählen.");
    setBusy(true);
    try {
      await api.post(`/matches/${id}/schedule-proposals`, { scheduled_at, note: proposalNote || null });
      toast.success("Terminvorschlag gesendet.");
      setProposalNote("");
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (proposal, action) => {
    const payload = { action, note: decisionNote || null };
    if (action === "counter") {
      const scheduled_at = fromLocalInput(counterAt);
      if (!scheduled_at) return toast.error("Bitte Datum und Uhrzeit für den Gegenvorschlag wählen.");
      payload.scheduled_at = scheduled_at;
    }
    setBusy(true);
    try {
      await api.post(`/matches/${id}/schedule-proposals/${proposal.id}/decision`, payload);
      toast.success(action === "accept" ? "Termin bestätigt." : action === "counter" ? "Gegenvorschlag gesendet." : "Vorschlag abgelehnt.");
      setDecisionNote("");
      setCounterAt("");
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    try {
      const { data: saved } = await api.post(`/matches/${id}/chat`, { message: message.trim() });
      setChat((rows) => [...rows, saved]);
      setMessage("");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  if (!data) {
    return <PublicLayout><div className="min-h-[50vh] flex items-center justify-center text-white/40 font-display tracking-widest">MATCH NICHT GEFUNDEN</div></PublicLayout>;
  }

  const match = data.match || {};
  const latestProposal = (data.schedule_proposals || []).find((p) => p.status === "pending");
  const canProposeSchedule = Boolean(data.can_propose_schedule);
  const canManageSchedule = Boolean(data.can_manage_schedule);
  const canUseChat = Boolean(user && data.can_act);
  const showFixedScheduleNotice = data.schedule_mode === "fixed_by_staff" && !canProposeSchedule;
  const addStaffMention = () => {
    setMessage((current) => {
      const prefix = current.trim() ? `${current.trim()} ` : "";
      return `${prefix}@leitung `;
    });
  };

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.3em] text-[#29B6E8] font-bold">{data.matchday_label}</div>
            <h1 className="mt-2 font-heading text-3xl md:text-5xl font-black uppercase">Match {match.match_key || match.id}</h1>
            {data.tournament && <Link to={`/tournaments/${data.tournament.slug || data.tournament.id}`} className="mt-2 inline-flex text-sm text-white/55 hover:text-[#29B6E8]">{data.tournament.title}</Link>}
          </div>
          <div className="border border-white/10 bg-[#121212] rounded-sm px-4 py-3 min-w-[16rem]">
            <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold">Terminstatus</div>
            <div className="mt-1 font-heading font-black uppercase text-[#FFD700]">{scheduleLabels[match.schedule_status] || "Noch offen"}</div>
            <div className="mt-1 text-sm text-white/65">{formatDateTime(match.scheduled_at)}</div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {eventModeLabels[data.event_mode] && <Pill>{eventModeLabels[data.event_mode]}</Pill>}
              {resultModeLabels[data.result_entry_mode] && <Pill>{resultModeLabels[data.result_entry_mode]}</Pill>}
              {scheduleModeLabels[data.schedule_mode] && <Pill>{scheduleModeLabels[data.schedule_mode]}</Pill>}
            </div>
            {stationLabel(match) && (
              <div className="mt-1 text-xs font-bold uppercase tracking-wider text-[#29B6E8]">Station {stationLabel(match)}</div>
            )}
          </div>
        </div>

        <div className="mt-8 grid lg:grid-cols-[minmax(0,1fr)_24rem] gap-6">
          <div className="space-y-6">
            <div className="border border-white/10 bg-[#121212] rounded-sm p-5">
              <h2 className="font-heading text-xl font-black uppercase">Teilnehmer</h2>
              <div className="mt-4 grid md:grid-cols-2 gap-3">
                {(data.participants || []).map((p) => (
                  <div key={p.slot} className="border border-white/10 bg-[#0A0A0A] rounded-sm p-4">
                    <div className="text-[10px] uppercase tracking-widest text-white/35">Slot {p.slot}</div>
                    <div className="mt-1 font-heading text-lg font-bold uppercase">{p.display_name || "Offen"}</div>
                    {p.team && <div className="mt-1 text-xs text-[#29B6E8]">[{p.team.tag}] {p.team.name}</div>}
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-white/10 bg-[#121212] rounded-sm p-5">
              <h2 className="font-heading text-xl font-black uppercase flex items-center gap-2"><CalendarClock className="w-5 h-5 text-[#29B6E8]" /> Terminabstimmung</h2>
              {canProposeSchedule ? (
                <form onSubmit={propose} className="mt-4 grid md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                  <Field label="Vorschlag">
                    <input type="datetime-local" value={proposalAt} onChange={(e) => setProposalAt(e.target.value)} className="input" />
                  </Field>
                  <Field label="Notiz">
                    <input value={proposalNote} onChange={(e) => setProposalNote(e.target.value)} className="input" placeholder="z.B. nach 20:00 Uhr möglich" />
                  </Field>
                  <button disabled={busy} className="px-4 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50">Vorschlagen</button>
                </form>
              ) : showFixedScheduleNotice ? (
                <p className="mt-3 text-sm text-white/55">Termin und Station werden durch die Turnierleitung festgelegt. Rueckfragen bitte im Matchchat mit <button type="button" onClick={addStaffMention} className="text-[#29B6E8] font-bold hover:text-white">@leitung</button> markieren.</p>
              ) : (
                <p className="mt-3 text-sm text-white/50">Termine koennen Teilnehmer, Team-Captains und Turnierleitung vorschlagen, sofern die Terminabstimmung aktiv ist.</p>
              )}

              <div className="mt-5 space-y-3">
                {(data.schedule_proposals || []).map((p) => (
                  <div key={p.id} className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold">{formatDateTime(p.scheduled_at)}</div>
                        <div className="text-xs text-white/45 mt-1">{p.actor?.display_name || p.actor?.username || "Teilnehmer"} · {p.status}</div>
                        {p.note && <div className="text-xs text-white/60 mt-2">{p.note}</div>}
                      </div>
                      {canManageSchedule && p.status === "pending" && (
                        <div className="flex gap-1 shrink-0">
                          <button type="button" onClick={() => decide(p, "accept")} className="p-2 border border-[#00D26A]/40 text-[#00D26A] rounded-sm"><Check className="w-3.5 h-3.5" /></button>
                          <button type="button" onClick={() => decide(p, "decline")} className="p-2 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      )}
                    </div>
                    {canManageSchedule && p.status === "pending" && (
                      <div className="mt-3 grid md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                        <input type="datetime-local" value={counterAt} onChange={(e) => setCounterAt(e.target.value)} className="input" />
                        <input value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} className="input" placeholder="Antwort / Grund" />
                        <button type="button" onClick={() => decide(p, "counter")} className="px-3 py-2 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm text-[10px] uppercase tracking-wider font-bold">Gegenvorschlag</button>
                      </div>
                    )}
                  </div>
                ))}
                {!latestProposal && (data.schedule_proposals || []).length === 0 && <div className="text-sm text-white/40">Noch kein Terminvorschlag vorhanden.</div>}
              </div>
            </div>
          </div>

          <aside className="border border-white/10 bg-[#121212] rounded-sm p-5 h-fit">
            <h2 className="font-heading text-xl font-black uppercase flex items-center gap-2"><MessageSquare className="w-5 h-5 text-[#29B6E8]" /> Matchchat</h2>
            <div className="mt-4 space-y-3 max-h-[28rem] overflow-y-auto pr-1">
              {chat.map((m) => (
                <div key={m.id} className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3">
                  <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{m.author?.display_name || m.author?.username || "Benutzer"}</div>
                  <div className="mt-1 text-sm text-white/75 whitespace-pre-wrap">{m.message}</div>
                </div>
              ))}
              {chat.length === 0 && <div className="text-sm text-white/40">Noch keine Nachrichten.</div>}
            </div>
            {canUseChat ? (
              <form onSubmit={sendMessage} className="mt-4 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={addStaffMention} className="px-2.5 py-1.5 border border-[#29B6E8]/40 text-[#29B6E8] rounded-sm text-[10px] font-bold uppercase tracking-wider hover:bg-[#29B6E8]/10">@leitung</button>
                </div>
                <div className="flex gap-2 items-end">
                  <MentionTextarea
                    value={message}
                    onValueChange={setMessage}
                    scope="tournament"
                    scopeId={data.tournament?.id}
                    rows={2}
                    maxLength={1500}
                    className="flex-1"
                    textareaClassName="input w-full min-h-[4.5rem] resize-y"
                    placeholder="Nachricht schreiben, @leitung oder @username markieren"
                  />
                  <button className="px-3 py-2 bg-[#29B6E8] text-black rounded-sm"><Send className="w-4 h-4" /></button>
                </div>
              </form>
            ) : (
              <p className="mt-4 text-xs text-white/45">Schreiben können Teilnehmer, Team-Captains und Turnierleitung.</p>
            )}
          </aside>
        </div>
      </section>
    </PublicLayout>
  );
}

function Pill({ children }) {
  return <span className="rounded-sm border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white/60">{children}</span>;
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      {children}
    </label>
  );
}
