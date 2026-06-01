import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CalendarClock, Check, ExternalLink, Flag, MessageSquare, RefreshCw, Send, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
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
  player_confirmed: "Spieler bestätigen Ergebnis",
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
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [reportNote, setReportNote] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [forfeitReason, setForfeitReason] = useState("");
  const [forfeitWinnerId, setForfeitWinnerId] = useState("");
  const [v2Rows, setV2Rows] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async ({ preserveDrafts = true } = {}) => {
    const [{ data: page }, { data: messages }] = await Promise.all([
      api.get(`/matches/${id}/page`),
      api.get(`/matches/${id}/chat`),
    ]);
    setData(page);
    setChat(messages || []);
    const nextMatch = page.match || {};
    if (preserveDrafts) {
      setProposalAt((current) => current || toLocalInput(nextMatch.scheduled_at));
      setScoreA((current) => current || String(nextMatch.score_a ?? 0));
      setScoreB((current) => current || String(nextMatch.score_b ?? 0));
      setForfeitWinnerId((current) => current || firstRegistrationId(page.participants));
      setV2Rows((current) => current.length ? current : buildV2Rows(page));
    } else {
      setProposalAt(toLocalInput(nextMatch.scheduled_at));
      setScoreA(String(nextMatch.score_a ?? 0));
      setScoreB(String(nextMatch.score_b ?? 0));
      setForfeitWinnerId(firstRegistrationId(page.participants));
      setV2Rows(buildV2Rows(page));
    }
  }, [id]);

  useEffect(() => {
    load({ preserveDrafts: false }).catch(() => setData(null));
    const timer = window.setInterval(() => {
      load().catch(() => {});
    }, 10000);
    return () => window.clearInterval(timer);
  }, [load]);
  useApiInvalidation(load, ["matches", "matches_v2", "tournaments"]);

  const title = data?.tournament?.title ? `${data.matchday_label} - ${data.tournament.title}` : "Match";
  const description = data?.tournament?.title
    ? `Matchseite für ${data.tournament.title} mit Terminabstimmung, Matchchat und Ergebnisstatus.`
    : "Matchseite mit Terminabstimmung, Matchchat und Ergebnisstatus.";
  useDocumentTitle(title, description, { robots: "noindex, follow" });

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

  const submitLegacyResult = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const score_a = Math.max(0, Number.parseInt(scoreA || "0", 10) || 0);
      const score_b = Math.max(0, Number.parseInt(scoreB || "0", 10) || 0);
      if (data?.can_staff_submit_result) {
        const winner_id = score_a > score_b ? duelParticipants[0]?.registration_id : score_b > score_a ? duelParticipants[1]?.registration_id : null;
        await api.patch(`/matches/${id}`, {
          score_a,
          score_b,
          status: winner_id ? "completed" : "waiting_result",
          winner_id,
        });
        toast.success("Ergebnis gespeichert.");
      } else {
        await api.post(`/matches/${id}/report`, {
          score_a,
          score_b,
          screenshot_url: proofUrl.trim() || null,
          note: reportNote.trim() || null,
        });
        toast.success("Ergebnis gemeldet.");
      }
      setProofUrl("");
      setReportNote("");
      await load({ preserveDrafts: false });
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const submitV2Result = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/matches/${id}/result`, {
        proof_url: proofUrl.trim() || null,
        note: reportNote.trim() || null,
        results: v2Rows.map((row) => ({
          dnf: row.dnf,
          forfeit: row.forfeit,
          rank: Math.max(1, Number.parseInt(row.rank || "0", 10) || 1),
          registration_id: row.registration_id,
          score: numberOrNull(row.score),
          time_ms: numberOrNull(row.time_ms),
        })),
      });
      toast.success("Heat-Ergebnis gespeichert.");
      setProofUrl("");
      setReportNote("");
      await load({ preserveDrafts: false });
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const submitDispute = async (e) => {
    e.preventDefault();
    const reason = disputeReason.trim();
    if (!reason) return toast.error("Bitte Grund angeben.");
    setBusy(true);
    try {
      await api.post(`/matches/${id}/dispute`, { reason });
      toast.success("Klärfall gemeldet.");
      setDisputeReason("");
      await load({ preserveDrafts: false });
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const submitForfeit = async (e) => {
    e.preventDefault();
    const note = forfeitReason.trim();
    if (!note || note.length < 5) return toast.error("Bitte Forfeit-Begründung mit mindestens 5 Zeichen angeben.");
    if (!forfeitWinnerId) return toast.error("Bitte Gewinner auswählen.");
    if (!window.confirm("Forfeit wirklich speichern? Diese Staff-Aktion wertet das Match als Forfeit.")) return;
    setBusy(true);
    try {
      await api.post(`/matches/${id}/forfeit`, { winner_id: forfeitWinnerId, note });
      toast.success("Forfeit gespeichert.");
      setForfeitReason("");
      await load({ preserveDrafts: false });
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
  const participants = data.participants || [];
  const duelParticipants = participants.slice(0, 2);
  const isV2 = data.collection === "matches_v2" || Boolean(match.slots?.length);
  const v2Mode = rankingMode(match);
  const isCompleted = ["completed", "forfeit"].includes(String(match.status));
  const canReportScore = Boolean(data.can_player_report_result || data.can_report_score);
  const canSubmitLegacyResult = Boolean(!isV2 && duelParticipants.length >= 2 && !isCompleted && (canReportScore || data.can_staff_submit_result || data.can_submit_result));
  const canSubmitV2Result = Boolean(isV2 && !isCompleted && data.can_staff_submit_result && v2Rows.length);
  const hasResultActions = Boolean(canSubmitLegacyResult || canSubmitV2Result || (!isCompleted && data.can_dispute) || (!isCompleted && data.can_forfeit));
  const reports = Array.isArray(match.reports) ? match.reports : [];
  const resultParticipants = isV2 ? participants : duelParticipants;
  const showFixedScheduleNotice = data.schedule_mode === "fixed_by_staff" && !canProposeSchedule;
  const tournamentUrl = data.tournament ? `/tournaments/${data.tournament.slug || data.tournament.id}` : "/tournaments";
  const addStaffMention = () => {
    setMessage((current) => {
      const prefix = current.trim() ? `${current.trim()} ` : "";
      return `${prefix}@leitung `;
    });
  };

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <Breadcrumbs
          items={[
            { label: "Home", to: "/" },
            { label: "Turniere", to: "/tournaments" },
            ...(data.tournament ? [{ label: data.tournament.title, to: tournamentUrl }] : []),
            { label: `Match ${match.match_key || match.id}` },
          ]}
          className="mb-5"
        />
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

        <div className="mt-8 border border-[#29B6E8]/35 bg-[#0F1D23] rounded-sm p-5" data-testid="match-result-card">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="font-heading text-xl font-black uppercase flex items-center gap-2"><Trophy className="w-5 h-5 text-[#29B6E8]" /> Ergebnis</h2>
              <p className="mt-1 text-sm text-white/55">Der Matchstand aktualisiert sich automatisch.</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-sm border border-[#29B6E8]/25 bg-[#29B6E8]/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#29B6E8]">
              <RefreshCw className="w-3.5 h-3.5" /> Live-Refresh
            </div>
          </div>

          <div className={`mt-5 grid gap-3 items-stretch ${isV2 ? "sm:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-[1fr_auto_1fr]"}`}>
            {isV2 ? (
              resultParticipants.map((participant) => (
                <ResultSide
                  key={participant.registration_id || participant.slot}
                  participant={participant}
                  score={v2ResultDisplay(match, participant, v2Mode)}
                  isWinner={v2ResultRank(match, participant) === 1}
                />
              ))
            ) : (
              <>
                <ResultSide participant={duelParticipants[0]} score={match.score_a} isWinner={match.winner_id && match.winner_id === duelParticipants[0]?.registration_id} />
                <div className="hidden md:flex items-center justify-center font-display text-3xl text-white/35">:</div>
                <ResultSide participant={duelParticipants[1]} score={match.score_b} isWinner={match.winner_id && match.winner_id === duelParticipants[1]?.registration_id} />
              </>
            )}
          </div>

          {hasResultActions ? (
            <div className="mt-5 border-t border-white/10 pt-5 space-y-5">
              {canSubmitLegacyResult && (
            <form onSubmit={submitLegacyResult}>
              <div className="grid sm:grid-cols-[1fr_1fr] gap-3">
                <Field label={`${duelParticipants[0]?.display_name || "Seite A"} Punkte`}>
                  <input type="number" min="0" value={scoreA} onChange={(e) => setScoreA(e.target.value)} className="input text-center font-display text-2xl font-bold" data-testid="match-inline-score-a" />
                </Field>
                <Field label={`${duelParticipants[1]?.display_name || "Seite B"} Punkte`}>
                  <input type="number" min="0" value={scoreB} onChange={(e) => setScoreB(e.target.value)} className="input text-center font-display text-2xl font-bold" data-testid="match-inline-score-b" />
                </Field>
              </div>
              <div className="mt-3 grid sm:grid-cols-2 gap-3">
                <input type="url" value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} className="input" placeholder="Screenshot-/Beweis-Link optional" />
                <input value={reportNote} onChange={(e) => setReportNote(e.target.value)} className="input" placeholder="Notiz optional" />
              </div>
              <button disabled={busy} className="mt-4 px-4 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid="match-inline-report-btn">{data.can_staff_submit_result ? "Ergebnis speichern" : "Ergebnis melden"}</button>
            </form>
              )}

              {canSubmitV2Result && (
                <form onSubmit={submitV2Result} className="space-y-4">
                  <p className="text-sm text-white/55">{v2Mode === "time" ? "Zeit erfassen. Schnellste Zeit gewinnt automatisch." : v2Mode === "lower_score" ? "Score erfassen. Niedrigster Score gewinnt automatisch." : "Punkte erfassen. Höchste Punkte gewinnen automatisch."}</p>
                  <div className="grid gap-3" data-testid="match-v2-result-form">
                    {v2Rows.map((row, index) => (
                      <div key={row.registration_id} className="grid lg:grid-cols-[minmax(0,1fr)_12rem] gap-3 border border-white/10 bg-[#0A0A0A] rounded-sm p-4">
                        <div className="min-w-0">
                          <div className="font-heading font-bold uppercase truncate">{participantNameByRegistration(participants, row.registration_id)}</div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <ToggleChip label="Nicht erschienen" active={row.forfeit} tone="danger" onClick={() => updateV2Row(setV2Rows, index, { forfeit: !row.forfeit })} />
                            <ToggleChip label="Disqualifiziert" active={row.dnf} tone="gold" onClick={() => updateV2Row(setV2Rows, index, { dnf: !row.dnf })} />
                          </div>
                        </div>
                        <Field label={v2Mode === "time" ? "Zeit ms" : v2Mode === "lower_score" ? "Score" : "Punkte"}>
                          <input
                            type="number"
                            min="0"
                            value={v2Mode === "time" ? row.time_ms : row.score}
                            onChange={(e) => updateV2Row(setV2Rows, index, v2Mode === "time" ? { time_ms: e.target.value } : { score: e.target.value })}
                            className="input text-center font-display text-xl font-bold"
                          />
                        </Field>
                      </div>
                    ))}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <input type="url" value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} className="input" placeholder="Screenshot-/Beweis-Link optional" />
                    <input value={reportNote} onChange={(e) => setReportNote(e.target.value)} className="input" placeholder="Notiz optional" />
                  </div>
                  <button disabled={busy} className="px-4 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid="match-v2-submit-btn">Heat-Ergebnis speichern</button>
                </form>
              )}

              {data.can_dispute && !isCompleted && (
                <form onSubmit={submitDispute} className="border-t border-white/10 pt-5">
                  <Field label="Dispute-Grund">
                    <input value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} className="input" placeholder="Was stimmt nicht?" data-testid="match-dispute-input" />
                  </Field>
                  <button disabled={busy || !disputeReason.trim()} className="mt-3 px-4 py-2 border border-[#FF3B30]/45 text-[#FF3B30] rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid="match-dispute-btn">Dispute melden</button>
                </form>
              )}

              {data.can_forfeit && !isCompleted && duelParticipants.length >= 2 && (
                <form onSubmit={submitForfeit} className="border-t border-white/10 pt-5">
                  <div className="text-xs text-[#FFD700] font-bold uppercase tracking-wider flex items-center gap-2"><Flag className="w-3.5 h-3.5" /> Staff-Aktion: Forfeit</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {duelParticipants.map((participant) => (
                      <button
                        key={participant.registration_id}
                        type="button"
                        onClick={() => setForfeitWinnerId(participant.registration_id || "")}
                        className={`px-3 py-2 border rounded-sm text-xs font-bold uppercase tracking-wider ${forfeitWinnerId === participant.registration_id ? "border-[#FFD700]/70 bg-[#FFD700]/15 text-[#FFD700]" : "border-white/10 bg-white/5 text-white/60 hover:border-[#FFD700]/45"}`}
                      >
                        {participant.display_name || "Teilnehmer"}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3">
                    <Field label="Forfeit-Begründung">
                      <input value={forfeitReason} onChange={(e) => setForfeitReason(e.target.value)} className="input" placeholder="Mindestens 5 Zeichen" />
                    </Field>
                  </div>
                  <button disabled={busy || forfeitReason.trim().length < 5 || !forfeitWinnerId} className="mt-3 px-4 py-2 bg-[#FF3B30] text-white rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50">Forfeit speichern</button>
                </form>
              )}
            </div>
          ) : !user && !isCompleted ? (
            <Link to={`/login?next=/matches/${id}`} className="mt-5 inline-flex items-center gap-2 px-4 py-2 border border-[#29B6E8]/40 text-[#29B6E8] rounded-sm text-xs uppercase tracking-wider font-bold hover:bg-[#29B6E8]/10">
              Login zum Ergebnis melden
            </Link>
          ) : (
            <p className="mt-4 text-sm text-white/50">{isCompleted ? "Dieses Match ist abgeschlossen." : resultModeLabels[data.result_entry_mode] || "Ergebnis wird durch die Turnierleitung gepflegt."}</p>
          )}
          {reports.length > 0 && <p className="mt-3 text-xs text-white/45">{reports.length} Ergebnismeldung{reports.length === 1 ? "" : "en"} vorhanden.</p>}
        </div>

        <div className="mt-6 grid lg:grid-cols-[minmax(0,1fr)_24rem] gap-6">
          <div className="space-y-6">
            <div className="border border-white/10 bg-[#121212] rounded-sm p-5">
              <h2 className="font-heading text-xl font-black uppercase">Teilnehmer</h2>
              <div className="mt-4 grid md:grid-cols-2 gap-3">
                {participants.map((p) => (
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

function ResultSide({ participant, score, isWinner }) {
  return (
    <div className={`border rounded-sm bg-[#0A0A0A] p-4 ${isWinner ? "border-[#29B6E8]/70 shadow-[0_0_18px_rgba(41,182,232,0.18)]" : "border-white/10"}`}>
      <div className="text-[10px] uppercase tracking-widest text-white/35">Slot {participant?.slot || "-"}</div>
      <div className="mt-1 font-heading text-lg font-bold uppercase truncate">{participant?.display_name || "Offen"}</div>
      {participant?.team && <div className="mt-1 text-xs text-[#29B6E8] truncate">[{participant.team.tag}] {participant.team.name}</div>}
      <div className={`mt-3 font-display text-5xl font-bold ${isWinner ? "text-[#29B6E8]" : "text-white/75"}`}>{score ?? 0}</div>
    </div>
  );
}

function ToggleChip({ label, active, tone = "cyan", onClick }) {
  const activeClass = tone === "danger"
    ? "border-[#FF3B30]/55 bg-[#FF3B30]/15 text-[#FF3B30]"
    : tone === "gold"
      ? "border-[#FFD700]/55 bg-[#FFD700]/15 text-[#FFD700]"
      : "border-[#29B6E8]/55 bg-[#29B6E8]/15 text-[#29B6E8]";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition ${active ? activeClass : "border-white/10 bg-white/5 text-white/55 hover:border-white/25"}`}
    >
      {label}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      {children}
    </label>
  );
}

function buildV2Rows(page) {
  const match = page?.match || {};
  const byRegistration = new Map((match.results || []).map((result) => [result.registration_id, result]));
  return (page?.participants || [])
    .filter((participant) => participant.registration_id)
    .map((participant, index) => {
      const existing = byRegistration.get(participant.registration_id || "");
      return {
        dnf: Boolean(existing?.dnf),
        forfeit: Boolean(existing?.forfeit),
        rank: String(existing?.rank || index + 1),
        registration_id: participant.registration_id || "",
        score: existing?.score != null ? String(existing.score) : existing?.points != null ? String(existing.points) : "",
        time_ms: existing?.time_ms != null ? String(existing.time_ms) : "",
      };
    });
}

function rankingMode(match) {
  const raw = String(match?.settings?.calculation || match?.settings?.score_type || "points").toLowerCase().replace(/[-\s]/g, "_");
  if (["time", "time_ms", "fastest", "fastest_lap", "lowest_time", "best_time"].includes(raw)) return "time";
  if (["lower_score", "lowest_score", "low_score", "strokes", "penalty_points"].includes(raw)) return "lower_score";
  return "higher_score";
}

function firstRegistrationId(participants) {
  return (participants || []).find((participant) => participant.registration_id)?.registration_id || "";
}

function participantNameByRegistration(participants, registrationId) {
  return participants.find((participant) => participant.registration_id === registrationId)?.display_name || "Teilnehmer";
}

function numberOrNull(value) {
  if (String(value || "").trim() === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isNaN(parsed) ? null : parsed;
}

function updateV2Row(setRows, index, patch) {
  setRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
}

function v2ResultForParticipant(match, participant) {
  return (match.results || []).find((result) => result.registration_id === participant?.registration_id) || null;
}

function v2ResultRank(match, participant) {
  return Number(v2ResultForParticipant(match, participant)?.rank || 0);
}

function v2ResultDisplay(match, participant, mode) {
  const result = v2ResultForParticipant(match, participant);
  if (!result) return "-";
  if (result.forfeit) return "Forfeit";
  if (result.dnf) return "DNF";
  if (mode === "time") return result.time_ms != null ? `${result.time_ms} ms` : "-";
  const score = result.score ?? result.points;
  return score != null ? score : "-";
}
