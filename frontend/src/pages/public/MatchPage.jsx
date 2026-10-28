import { useCallback, useEffect, useState } from "react";
import { ModerationStateBadge } from "@/components/tls/ModerationStateBadge";
import { Link, useParams } from "react-router-dom";
import { CalendarClock, Check, Flag, MessageSquare, RefreshCw, Send, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { MentionTextarea } from "@/components/tls/MentionTextarea";
import { ChatAttachButton, ChatAttachmentDrafts, ChatMessageAttachments, useChatAttachmentDrafts } from "@/components/tls/ChatAttachments";
import { ChatMessageSticker, ChatStickerButton, ChatStickerPicker } from "@/components/tls/ChatStickers";
import { AuthFormAlert } from "@/components/tls/AuthFormFields";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useAccountGeneration } from "@/hooks/useAccountGeneration";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useChatRead } from "@/hooks/useChats";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";
import { CommendButton } from "@/components/tls/CommendButton";
import { viennaDateTime } from "@/lib/vienna";
import { formatWhen } from "@/lib/datetime";
import { showLapTime } from "@/lib/laptime";
import { finishedMatchText, formatMatchKind, formatMatchStatus, isByeSlot, isMatchFinished, matchHeadline, slotName, stationText } from "@/lib/tournamentLabels";
import { matchIsOver } from "@/lib/afterEnd";
import { rankingMode } from "@/lib/matchReport";
import { MatchReportForm } from "@/components/tls/tournament/MatchReportForm";
import { LeagueReportForm } from "@/components/tls/league/LeagueReportForm";
import { defaultTimeText, lineupAmendClosed, sidesInSlotOrder } from "@/components/tls/league/leagueGames";
import { LeagueGamesView, LeagueLobbyIds, LineupAmendForm, StaffLineupAmend } from "@/components/tls/league/LeagueGamesView";
import { LiveQueueStatus } from "@/components/tls/live/LiveQueueStatus";
import { MatchCallBox } from "@/components/tls/tournament/MatchCallBox";
import { ProblemReportForm } from "@/components/tls/results/ProblemReportForm";
import { OwnDisputes } from "@/components/tls/results/OwnDisputes";
import { ResultWindow } from "@/components/tls/results/ResultWindow";
import { ResultUndoBar, useResultUndo } from "@/components/tls/results/ResultUndoBar";
import { isOwnProposal, proposalStatusLabel, waitingForOtherSide } from "@/lib/scheduleProposals";
import { useLeagueTrail } from "@/hooks/useLeagueTrail";
import { leagueCrumbs } from "@/lib/leagueTrail";
import { LeagueEmblem } from "@/components/tls/league/public/LeagueLook";

const DECISION_TOASTS = {
  accept: "Termin bestätigt.",
  decline: "Vorschlag abgelehnt.",
  counter: "Gegenvorschlag gesendet.",
  withdraw: "Vorschlag zurückgezogen.",
};

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
  return viennaDateTime(value, { dateStyle: "medium", timeStyle: "short" });
}

// Ein laufendes Spiel nennt im Kopf seinen Zustand statt des Termins.
const LIVE_MATCH_STATUSES = new Set(["in_progress", "running", "waiting_result", "disputed"]);

/** Was im Terminkasten groß steht (#1220): „Noch offen“ nur vor dem Spiel ohne Termin. Liegt nur der eigene Vorschlag
 * offen, wartet die Seite auf die Gegenseite (#2110). */
function scheduleHeadline(match, league = null, waiting = false) {
  if (LIVE_MATCH_STATUSES.has(String(match.status))) return formatMatchStatus(match.status);
  if (waiting && match.schedule_status === "proposed") return "Wartet auf Gegenseite";
  if (scheduleLabels[match.schedule_status]) return scheduleLabels[match.schedule_status];
  if (!match.scheduled_at && league?.default_time) return "Standardtermin";
  return match.scheduled_at ? "Termin steht" : "Noch offen";
}

/** Der Termin in Worten. Liga ohne Einigung (#2096): der Standardtermin der Spielwoche statt „Noch kein Termin“. */
function scheduleWhen(match, league = null) {
  if (match.scheduled_at) return formatWhen(match.scheduled_at);
  if (league?.default_time) return `Standardtermin ${defaultTimeText(league.default_time)} (ohne Einigung)`;
  return "Noch kein Termin";
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

// Terminvorschläge nur in der Zukunft (#2124): frühestens 5 Minuten ab jetzt - wie der Server
// (services/schedule_proposal_time.py).
const PROPOSAL_LEAD_MS = 5 * 60 * 1000;
const PAST_PROPOSAL_TEXT = "Der Termin liegt in der Vergangenheit – bitte einen Zeitpunkt frühestens 5 Minuten ab jetzt wählen.";

function earliestProposalInput(now = Date.now()) {
  return toLocalInput(new Date(now + PROPOSAL_LEAD_MS).toISOString());
}

function tooEarly(iso, now = Date.now()) {
  return new Date(iso).getTime() < now + PROPOSAL_LEAD_MS;
}

// Eigener Stand je Match und Konto (#1047): ein Wechsel des Matches oder ein echter Kontowechsel baut die Seite neu
// auf - Chat-Entwurf, Anhänge und Eingaben gehen weg, späte Antworten laufen ins Leere. Das erste Laden der
// Anmeldung zählt nicht als Wechsel.
export default function MatchPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const accountGeneration = useAccountGeneration(user?.id);
  return <MatchPageView key={`${id}:${accountGeneration}`} />;
}

function MatchPageView() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [chat, setChat] = useState([]);
  const [proposalAt, setProposalAt] = useState("");
  const [proposalNote, setProposalNote] = useState("");
  const [counterAt, setCounterAt] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [message, setMessage] = useState("");
  // Das eine Ergebnis-Fenster (#1370): dieselbe Eingabe wie in Turnierleitung, Matchplan und Stationen.
  const [resultOpen, setResultOpen] = useState(false);
  const { submitting: busy, submitOnce } = useSubmissionGuard();
  // „Stimmt nicht“ (#1159) öffnet „Problem melden“ mit „Falsches Ergebnis“.
  const [problemCategory, setProblemCategory] = useState("");
  const [actionError, setActionError] = useState("");

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
    } else {
      setProposalAt(toLocalInput(nextMatch.scheduled_at));
    }
  }, [id]);

  useEffect(() => {
    const refreshVisible = () => {
      if (typeof document === "undefined" || !document.hidden) load().catch(() => {});
    };
    load({ preserveDrafts: false }).catch(() => setData(null));
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [load]);
  // Ein fertiges Match ändert sich nicht mehr - die Live-Aktualisierung hört dann auf (#1221).
  // Nur Änderungen des eigenen Turniers (#1801) - bis das Spiel geladen ist, jede.
  useLiveRefresh(load, ["matches", "matches-v2", "tournaments"], {
    fallbackMs: 10000, enabled: !matchIsOver(data?.match), tournamentId: data?.tournament?.id || data?.match?.tournament_id,
  });
  // Match-Chat gelesen (#1148) - nur für die, die mitschreiben dürfen.
  useChatRead("match", id, chat, Boolean(user && data?.can_act));
  // Liga-Staffel (#2110): Brotkrumen „Liga · Season · Staffel“ statt „Turniere“.
  const trail = useLeagueTrail(data?.tournament);

  const headline = data ? matchHeadline(data.participants || [], data.match || {}) : "Match";
  const title = data?.tournament?.title ? `${data.matchday_label} · ${headline} - ${data.tournament.title}` : "Match";
  const description = data?.tournament?.title
    ? `Matchseite für ${data.tournament.title} mit Terminabstimmung, Matchchat und Ergebnisstatus.`
    : "Matchseite mit Terminabstimmung, Matchchat und Ergebnisstatus.";
  useDocumentTitle(title, description, { robots: "noindex, follow" });

  const failAction = (message) => {
    setActionError(message);
    toast.error(message);
  };

  const runAction = async (task, fallback) => {
    setActionError("");
    const attempt = await submitOnce(task);
    if (!attempt.started || !attempt.error) return attempt.started;
    failAction(formatApiError(attempt.error.response?.data?.detail) || fallback);
    return false;
  };

  const propose = async (e) => {
    e.preventDefault();
    const scheduled_at = fromLocalInput(proposalAt);
    if (!scheduled_at) return failAction("Bitte Datum und Uhrzeit wählen.");
    if (tooEarly(scheduled_at)) return failAction(PAST_PROPOSAL_TEXT);
    await runAction(async () => {
      await api.post(`/matches/${id}/schedule-proposals`, { scheduled_at, note: proposalNote || null });
      toast.success("Terminvorschlag gesendet.");
      setProposalNote("");
      await load();
    }, "Terminvorschlag konnte nicht gesendet werden.");
  };

  const decide = async (proposal, action) => {
    const payload = { action, note: decisionNote || null };
    if (action === "counter") {
      const scheduled_at = fromLocalInput(counterAt);
      if (!scheduled_at) return failAction("Bitte Datum und Uhrzeit für den Gegenvorschlag wählen.");
      if (tooEarly(scheduled_at)) return failAction(PAST_PROPOSAL_TEXT);
      payload.scheduled_at = scheduled_at;
    }
    await runAction(async () => {
      await api.post(`/matches/${id}/schedule-proposals/${proposal.id}/decision`, payload);
      toast.success(DECISION_TOASTS[action] || "Gespeichert.");
      setDecisionNote("");
      setCounterAt("");
      await load();
    }, "Terminentscheidung konnte nicht gespeichert werden.");
  };

  // Ergebnis melden (#1132): die Platzierungsliste an /report - der Server vergleicht die Meldungen beider Seiten.
  const submitReport = async (payload) => runAction(async () => {
    const { data: answer } = await api.post(`/matches/${id}/report`, payload);
    toast.success(answer?.awaiting_confirmation === false ? "Ergebnis bestätigt – das Spiel ist entschieden." : "Ergebnis gemeldet.");
    await load({ preserveDrafts: false });
  }, "Ergebnis konnte nicht gemeldet werden.");

  // Liga (#1650): die eigene Aufstellung je Map nachtragen - bis zur Frist, danach über die Turnierleitung.
  const saveLineups = async (payload) => runAction(async () => {
    await api.put(`/matches/${id}/lineups`, payload);
    toast.success("Aufstellung gespeichert.");
    await load({ preserveDrafts: false });
  }, "Aufstellung konnte nicht gespeichert werden.");

  // Problem melden (#1158): Grund, Text und auf Wunsch ein Foto - die Turnierleitung entscheidet.
  const submitDispute = async (payload) => runAction(async () => {
    await api.post(`/matches/${id}/dispute`, payload);
    toast.success("Gemeldet. Die Turnierleitung schaut es sich an.");
    await load({ preserveDrafts: false });
  }, "Problem konnte nicht gemeldet werden.");

  const resultUndo = useResultUndo({ onDone: () => load({ preserveDrafts: false }).catch(() => {}) });
  const chatAttachments = useChatAttachmentDrafts();
  const [stickersOpen, setStickersOpen] = useState(false);

  const sendSticker = async (sticker) => {
    await runAction(async () => {
      const { data: saved } = await api.post(`/matches/${id}/chat`, { sticker_id: sticker.id });
      setChat((rows) => [...rows, saved]);
      setStickersOpen(false);
    }, "Sticker konnte nicht gesendet werden.");
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!chatAttachments.canSend(message)) return;
    await runAction(async () => {
      const { data: saved } = await api.post(`/matches/${id}/chat`, { message: message.trim(), attachment_ids: chatAttachments.attachmentIds });
      setChat((rows) => [...rows, saved]);
      setMessage("");
      chatAttachments.reset();
    }, "Nachricht konnte nicht gesendet werden.");
  };

  if (!data) {
    return <PublicLayout><div className="min-h-[50vh] flex items-center justify-center text-white/40 font-display tracking-widest">MATCH NICHT GEFUNDEN</div></PublicLayout>;
  }

  const match = data.match || {};
  // Liga (#2096): Seiten in der Reihenfolge der Plätze - Heim links, wie in der Überschrift.
  const league = sidesInSlotOrder(data.league, match);
  const latestProposal = (data.schedule_proposals || []).find((p) => p.status === "pending");
  const canProposeSchedule = Boolean(data.can_propose_schedule);
  const canManageSchedule = Boolean(data.can_manage_schedule);
  const canUseChat = Boolean(user && data.can_act);
  const participants = data.participants || [];
  const duelParticipants = participants.slice(0, 2);
  const isV2 = data.collection === "matches_v2" || Boolean(match.slots?.length);
  const v2Mode = rankingMode(match);
  const isCompleted = ["completed", "forfeit"].includes(String(match.status));
  // Klartext (#1220): ein fertiges Spiel zeigt „Beendet“ mit Ergebnis statt des Terminstatus; Freilos heißt Freilos.
  const finished = isMatchFinished(match);
  const isBye = participants.some((participant) => isByeSlot(participant, match));
  const station = stationText(match);
  // Nach dem Ende (#1221): Ergebnis und Verlauf. Den Chat sehen dann nur noch Teilnehmer und Turnierleitung, und nur,
  // wenn darin etwas steht.
  const over = matchIsOver(match);
  // Liga (#2110): fehlt die eigene Aufstellung nach der Nachtragsfrist, bleibt der Matchchat zum Schreiben offen - der
  // Hinweis schickt die Seite mit @leitung dorthin.
  const lineupLate = Boolean(data.league && lineupAmendClosed(league));
  const showChat = !over || (Boolean(data.can_act) && (chat.length > 0 || lineupLate));
  const chatClosed = over && !lineupLate;
  // Ergebnis (#1132): Spieler melden über das Meldeformular, die Turnierleitung trägt über /result ein. Wer beides
  // dürfte, bekommt das Formular der Turnierleitung.
  const canStaffSubmit = Boolean(data.can_staff_submit_result);
  const canPlayerReport = Boolean(data.can_player_report_result && !canStaffSubmit && !isCompleted);
  // Team-Mitglieder ohne Leitung (#1159): sie sehen die Meldung der Gegenseite, bestätigen kann die Teamleitung.
  const showReportReadOnly = Boolean(!canPlayerReport && !canStaffSubmit && !isCompleted && data.report_state?.status === "confirm");
  const wrongResult = () => {
    setProblemCategory("wrong_result");
    window.setTimeout(() => document.querySelector("[data-testid='match-dispute-form']")?.scrollIntoView?.({ block: "center" }), 0);
  };
  // Turnierleitung (#1370): ein Knopf öffnet das Ergebnis-Fenster - eintragen oder, wenn es schon eins gibt, korrigieren.
  const canSubmitV2Result = Boolean(canStaffSubmit && data.result_entry && !data.result_entry.hold);
  // Dispute (#1134): jeder Teilnehmer in jedem Modus, auch gegen ein eingetragenes Ergebnis - der Server sagt, bis wann.
  const canDispute = Boolean(data.can_dispute);
  // Nur Turnierleitung (#1157): wer mitspielt, sieht statt eines Melde-Knopfs, wer das Ergebnis einträgt.
  const showStaffEnters = Boolean(data.acting_registration_id && !canPlayerReport && !canStaffSubmit && !finished && data.result_entry_mode === "staff_only" && !data.in_dispute);
  // „Login zum Ergebnis melden“ (#2124, TP6) nur, wo Spieler selbst melden - nicht bei „Nur Turnierleitung“ oder vor Ort.
  const guestsCouldReport = data.result_entry_mode !== "staff_only" && data.event_mode !== "local";
  const hasOtherResultActions = Boolean(canPlayerReport || canSubmitV2Result || showReportReadOnly);
  const hasResultActions = Boolean(hasOtherResultActions || canDispute);
  const reports = Array.isArray(match.reports) ? match.reports : [];
  const resultParticipants = isV2 ? participants : duelParticipants;
  const isHeat = Boolean(isV2 && (resultParticipants.length > 2 || match.match_type === "ffa"));
  const showFixedScheduleNotice = data.schedule_mode === "fixed_by_staff" && !canProposeSchedule;
  const tournamentUrl = data.tournament ? `/tournaments/${data.tournament.slug || data.tournament.id}` : "/tournaments";
  const addStaffMention = () => {
    setMessage((current) => {
      const prefix = current.trim() ? `${current.trim()} ` : "";
      return `${prefix}@leitung `;
    });
  };
  const askStaff = () => {
    addStaffMention();
    window.setTimeout(() => document.querySelector("[data-testid='match-chat'] textarea")?.focus?.(), 0);
  };

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <Breadcrumbs
          items={leagueCrumbs(data.tournament, trail, { tournamentUrl, current: { label: `Match ${match.match_key || match.id}` } }) || [
            { label: "Home", to: "/" },
            { label: "Turniere", to: "/tournaments" },
            ...(data.tournament ? [{ label: data.tournament.title, to: tournamentUrl }] : []),
            { label: `Match ${match.match_key || match.id}` },
          ]}
          className="mb-5"
        />
        {/* Kopf (#1220): Runde und Namen statt „Match A“ - der Schlüssel steht nur noch klein. Rechts der Zustand:
            vor dem Spiel der Termin, danach „Beendet“ mit dem Ergebnis. */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-[#29B6E8] font-bold">
              {/* Liga-Spiel (#2107): das Emblem der Season bzw. Liga klein vor dem Spieltag. */}
              {trail?.emblemUrl ? <LeagueEmblem src={trail.emblemUrl} size={24} testId="match-league-emblem" /> : null}
              {data.matchday_label}
            </div>
            <h1 className="mt-2 font-heading text-3xl md:text-5xl font-black uppercase [overflow-wrap:anywhere]" data-testid="match-headline">{headline}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/55">
              <span className="text-[11px] uppercase tracking-widest text-white/40" data-testid="match-key">{formatMatchKind(match)} {match.match_key || ""}</span>
              {data.tournament && (
                <>
                  <span aria-hidden="true" className="text-white/25">·</span>
                  <Link to={`/tournaments/${data.tournament.slug || data.tournament.id}`} className="tls-hit hover:text-[#29B6E8]">{data.tournament.title}</Link>
                </>
              )}
            </div>
          </div>
          {finished ? (
            <div className="border border-white/10 bg-[#121212] rounded-sm px-4 py-3 w-full sm:w-auto sm:min-w-[16rem] sm:max-w-sm" data-testid="match-finished">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="rounded-sm border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/80">Beendet</span>
                {match.scheduled_at && <span className="text-sm text-white/65" data-testid="match-when">{formatWhen(match.scheduled_at)}</span>}
              </div>
              <div className="mt-2 font-heading font-black text-white" data-testid="match-outcome">{finishedMatchText(participants, match)}</div>
              {station && <div className="mt-1 text-xs font-bold uppercase tracking-wider text-[#29B6E8]" data-testid="match-station">{station}</div>}
            </div>
          ) : (
            <div className="border border-white/10 bg-[#121212] rounded-sm px-4 py-3 w-full sm:w-auto sm:min-w-[16rem]" data-testid="match-schedule">
              <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold">Terminstatus</div>
              <div className="mt-1 font-heading font-black uppercase text-[#FFD700]" data-testid="match-schedule-headline">{scheduleHeadline(match, league, waitingForOtherSide(data.schedule_proposals, data, user?.id))}</div>
              <div className="mt-1 text-sm text-white/65" data-testid="match-when">{scheduleWhen(match, league)}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {eventModeLabels[data.event_mode] && <Pill>{eventModeLabels[data.event_mode]}</Pill>}
                {resultModeLabels[data.result_entry_mode] && <Pill>{resultModeLabels[data.result_entry_mode]}</Pill>}
                {scheduleModeLabels[data.schedule_mode] && <Pill>{scheduleModeLabels[data.schedule_mode]}</Pill>}
              </div>
              {station && <div className="mt-2 text-xs font-bold uppercase tracking-wider text-[#29B6E8]" data-testid="match-station">{station}</div>}
            </div>
          )}
        </div>

        {data.call && <MatchCallBox call={data.call} />}
        {/* Vor Ort (#1556): wo und wann das Spiel laut Warteschlange dran ist - den Aufruf selbst zeigt die Karte darüber. */}
        {!finished && isV2 && data.tournament?.id && data.event_mode && data.event_mode !== "online" ? (
          <LiveQueueStatus tournamentId={data.tournament.id} eventId={data.tournament.event_id} matchId={id} hideCalled className="mt-6" />
        ) : null}

        {actionError && <div className="mt-5"><AuthFormAlert id="match-action-error">{actionError}</AuthFormAlert></div>}

        <div className="mt-8 border border-[#29B6E8]/35 bg-[#0F1D23] rounded-sm p-5" data-testid="match-result-card">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="font-heading text-xl font-black uppercase flex items-center gap-2"><Trophy className="w-5 h-5 text-[#29B6E8]" /> Ergebnis</h2>
              {!over && <p className="mt-1 text-sm text-white/55">Der Matchstand aktualisiert sich automatisch.</p>}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* GG (#616): eine Seite lobt die andere - einmal je Match, nur nach dem Ende. */}
              {user && isV2 ? <CommendButton matchId={id} completed={String(match.status) === "completed"} /> : null}
              {/* Nach dem Ende (#1221) aktualisiert sich nichts mehr - der Hinweis fällt weg. */}
              {!over && (
                <div className="inline-flex items-center gap-2 rounded-sm border border-[#29B6E8]/25 bg-[#29B6E8]/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#29B6E8]" data-testid="match-live-refresh">
                  <RefreshCw className="w-3.5 h-3.5" /> Live-Refresh
                </div>
              )}
            </div>
          </div>

          {isBye && finished ? (
            <p className="mt-5 text-sm text-white/65" data-testid="match-bye-line">Ein Freilos wird nicht gespielt – es zählt als Sieg für {slotName(participants.find((participant) => participant.registration_id)?.display_name, {}, match)}.</p>
          ) : (
          <div className={`mt-5 grid gap-3 items-stretch ${isV2 ? "sm:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-[1fr_auto_1fr]"}`} data-testid="match-result-sides">
            {isHeat ? (
              // Lauf mit mehreren (#2124, TP1): der Platz groß, in Platzreihenfolge - Punkte oder Zeit klein darunter.
              heatInPlaceOrder(resultParticipants, match).map((participant, index) => (
                <HeatSide
                  key={participant.registration_id || participant.slot || `result-${index}`}
                  participant={participant}
                  match={match}
                  result={v2ResultForParticipant(match, participant)}
                  mode={v2Mode}
                />
              ))
            ) : isV2 ? (
              resultParticipants.map((participant, index) => (
                <ResultSide
                  key={participant.registration_id || participant.slot || `result-${index}`}
                  participant={participant}
                  match={match}
                  score={v2ResultDisplay(match, participant, v2Mode)}
                  isWinner={v2ResultRank(match, participant) === 1}
                />
              ))
            ) : (
              <>
                <ResultSide participant={duelParticipants[0]} match={match} score={match.score_a} isWinner={match.winner_id && match.winner_id === duelParticipants[0]?.registration_id} />
                <div className="hidden md:flex items-center justify-center font-display text-3xl text-white/35">:</div>
                <ResultSide participant={duelParticipants[1]} match={match} score={match.score_b} isWinner={match.winner_id && match.winner_id === duelParticipants[1]?.registration_id} />
              </>
            )}
          </div>
          )}

          {/* Liga (#1650): gespielte Maps mit Sieger und Aufstellungen; fehlt die eigene noch, hier nachtragen. */}
          {data.league ? <LeagueGamesView league={league} /> : null}
          {/* Spiel-IDs für die Lobby (#2108) - nur Beteiligte und Turnierleitung bekommen sie vom Server. */}
          {data.league ? <LeagueLobbyIds league={league} /> : null}
          {data.league ? (
            <LineupAmendForm key={`${(data.league.lineups_missing || []).join(",")}-${match.updated_at || ""}`} league={league} busy={busy} onSave={saveLineups}
              onAskStaff={canUseChat && showChat && !chatClosed ? askStaff : null} />
          ) : null}
          {data.league && canStaffSubmit ? (
            <StaffLineupAmend key={`staff-${match.updated_at || ""}`} league={league} busy={busy} onSave={saveLineups} />
          ) : null}

          {/* Nur Turnierleitung (#1157): Spieler sehen keinen Melde-Knopf, sondern wer das Ergebnis einträgt. */}
          {showStaffEnters ? (
            <div className="mt-5 flex items-start gap-3 rounded-sm border border-[#29B6E8]/30 bg-[#29B6E8]/5 px-4 py-3" data-testid="match-staff-enters">
              <Flag className="mt-0.5 w-4 h-4 shrink-0 text-[#29B6E8]" />
              <div>
                <p className="text-sm font-bold text-white">Das Ergebnis trägt die Turnierleitung ein.</p>
                <p className="mt-0.5 text-xs text-white/55">Du musst nichts melden. Sobald es drin ist, bekommst du eine Benachrichtigung.</p>
              </div>
            </div>
          ) : null}

          {data.in_dispute && (
            <p className="mt-5 rounded-sm border border-[#FF3B30]/40 bg-[#FF3B30]/10 px-4 py-3 text-sm text-[#FFD2CF]" data-testid="match-in-dispute">
              <strong>In Klärung</strong> – zu diesem Spiel liegt ein Dispute vor. Die Turnierleitung prüft und entscheidet.
              {/* Die Turnierleitung entscheidet in ihrer Ansicht (#1158) - mit Meldung, Foto und Ergebnis. */}
              {canStaffSubmit && data.tournament ? (
                <Link to={`/tournaments/${data.tournament.slug || data.tournament.id}/leitung?fall=ds-${id}`} className="ml-2 font-bold text-white underline underline-offset-2" data-testid="match-dispute-decide">Streitfall entscheiden</Link>
              ) : null}
            </p>
          )}
          {/* Deine Meldung – Entscheidung (#2124): was die Turnierleitung zur eigenen Meldung entschieden hat. */}
          <OwnDisputes match={match} userId={user?.id} />

          {hasResultActions ? (
            <div className="mt-5 border-t border-white/10 pt-5 space-y-5">
              {(canPlayerReport || showReportReadOnly) && data.league && (
                <LeagueReportForm
                  league={league}
                  readOnly={!canPlayerReport}
                  onWrongResult={wrongResult}
                  state={data.report_state}
                  busy={busy}
                  onReport={submitReport}
                />
              )}
              {(canPlayerReport || showReportReadOnly) && !data.league && (
                <MatchReportForm
                  readOnly={!canPlayerReport}
                  onWrongResult={wrongResult}
                  participants={participants}
                  match={match}
                  entry={data.report_entry}
                  state={data.report_state}
                  allowsDraw={Boolean(data.allows_draw)}
                  busy={busy}
                  onReport={submitReport}
                />
              )}

              {canSubmitV2Result && (
                <div className="flex flex-wrap items-center gap-3" data-testid="match-staff-result">
                  <button type="button" onClick={() => setResultOpen(true)} className="tls-btn tls-btn--primary min-h-[44px] px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold" data-testid="match-staff-result-open">
                    {data.result_entry.has_result ? "Ergebnis korrigieren" : "Ergebnis eintragen"}
                  </button>
                  <p className="text-xs text-white/50">{data.result_entry.has_result ? "Korrigieren geht nur mit Grund – er steht im Protokoll." : "Mit „Nicht erschienen“ und „Aufgegeben“ je Seite. Danach 10 Sekunden „Rückgängig“."}</p>
                </div>
              )}
              {canStaffSubmit && data.result_entry?.hold ? (
                <p className="text-sm text-[#29B6E8]" data-testid="match-staff-result-held">{data.result_entry.hold.mine ? "Gespeichert – in wenigen Sekunden geht es raus." : `${data.result_entry.hold.actor_name} trägt gerade das Ergebnis ein.`}</p>
              ) : null}

              {canDispute && (
                <ProblemReportForm matchId={id} until={data.dispute_until} busy={busy} onSubmit={submitDispute} separated={hasOtherResultActions} initialCategory={problemCategory} />
              )}

            </div>
          ) : !user && !isCompleted && guestsCouldReport ? (
            <Link to={`/login?next=/matches/${id}`} data-testid="match-login-to-report" className="tls-btn tls-btn--secondary mt-5 inline-flex min-h-11 items-center gap-2 px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold">
              Login zum Ergebnis melden
            </Link>
          ) : showStaffEnters ? null : (
            <p className="mt-4 text-sm text-white/50">{isCompleted ? "Dieses Match ist abgeschlossen." : resultModeLabels[data.result_entry_mode] || "Ergebnis wird durch die Turnierleitung gepflegt."}</p>
          )}
          {canStaffSubmit && !isCompleted && reports.length > 0 && <p className="mt-3 text-xs text-white/45" data-testid="match-report-count">{reports.length} Ergebnismeldung{reports.length === 1 ? "" : "en"} der Spieler vorhanden.</p>}
        </div>

        {/* Nach dem Ende (#1221): Ergebnis und Verlauf - keine Terminabstimmung mehr; der Matchchat bleibt für
            Teilnehmer und Turnierleitung zum Nachlesen, ein leerer Chat verschwindet. */}
        {/* Eine Spalte, die nie breiter als der Bildschirm wird (#1155): mit großer Schrift brechen Namen um. */}
        <div className={`mt-6 grid grid-cols-1 gap-6 ${showChat ? "lg:grid-cols-[minmax(0,1fr)_24rem]" : ""}`}>
          {/* Die Teilnehmer stehen genau einmal - in den Ergebnis-Kacheln oben (#2124, TP7). */}
          <div className="space-y-6">
            {!over && (
            <div className="border border-white/10 bg-[#121212] rounded-sm p-5" data-testid="match-scheduling">
              <h2 className="font-heading text-xl font-black uppercase flex items-center gap-2"><CalendarClock className="w-5 h-5 text-[#29B6E8]" /> Terminabstimmung</h2>
              {canProposeSchedule ? (
                <form onSubmit={propose} className="mt-4 grid md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                  <Field label="Vorschlag">
                    <input type="datetime-local" min={earliestProposalInput()} value={proposalAt} onChange={(e) => setProposalAt(e.target.value)} className="input" data-testid="match-proposal-at" />
                  </Field>
                  <Field label="Notiz">
                    <input value={proposalNote} onChange={(e) => setProposalNote(e.target.value)} className="input" placeholder="z.B. nach 20:00 Uhr möglich" />
                  </Field>
                  <button disabled={busy} className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50">Vorschlagen</button>
                </form>
              ) : showFixedScheduleNotice ? (
                <p className="mt-3 text-sm text-white/55">Termin und Station werden durch die Turnierleitung festgelegt. Rückfragen bitte im Matchchat mit <button type="button" onClick={addStaffMention} className="text-[#29B6E8] font-bold hover:text-white">@leitung</button> markieren.</p>
              ) : (
                <p className="mt-3 text-sm text-white/50">Termine können Teilnehmer, Team-Captains und Turnierleitung vorschlagen, sofern die Terminabstimmung aktiv ist.</p>
              )}

              <div className="mt-5 space-y-3">
                {(data.schedule_proposals || []).map((p) => {
                  const open = p.status === "pending";
                  // Der eigene Vorschlag (#2110): annehmen oder ablehnen kann nur die Gegenseite - hier „Zurückziehen“.
                  const own = open && isOwnProposal(p, data, user?.id);
                  const answer = canManageSchedule && open && !own;
                  return (
                  <div key={p.id} className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3" data-testid={`match-proposal-${p.id}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold">{formatDateTime(p.scheduled_at)}</div>
                        <div className="text-xs text-white/45 mt-1 [overflow-wrap:anywhere]" data-testid={`match-proposal-status-${p.id}`}>{p.actor?.display_name || p.actor?.username || "Teilnehmer"} · {own ? "wartet auf die Gegenseite" : proposalStatusLabel(p)}</div>
                        {p.note && <div className="text-xs text-white/60 mt-2 [overflow-wrap:anywhere]">{p.note}</div>}
                      </div>
                      {answer && (
                        <div className="flex gap-1 shrink-0">
                          <button type="button" disabled={busy} onClick={() => decide(p, "accept")} aria-label="Termin annehmen" title="Annehmen" data-testid={`match-proposal-accept-${p.id}`} className="tls-btn tls-btn--quiet min-h-11 min-w-11 inline-flex items-center justify-center border border-[#00D26A]/40 text-[#00D26A] rounded-sm disabled:opacity-50"><Check className="w-3.5 h-3.5" /></button>
                          <button type="button" disabled={busy} onClick={() => decide(p, "decline")} aria-label="Termin ablehnen" title="Ablehnen" data-testid={`match-proposal-decline-${p.id}`} className="tls-btn tls-btn--quiet min-h-11 min-w-11 inline-flex items-center justify-center border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm disabled:opacity-50"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      )}
                      {own && canManageSchedule && (
                        <button type="button" disabled={busy} onClick={() => decide(p, "withdraw")} data-testid={`match-proposal-withdraw-${p.id}`} className="tls-btn tls-btn--quiet shrink-0 min-h-11 px-3 py-2 rounded-sm text-[10px] uppercase tracking-wider font-bold disabled:opacity-50">Zurückziehen</button>
                      )}
                    </div>
                    {answer && (
                      <div className="mt-3 grid md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                        <input type="datetime-local" min={earliestProposalInput()} aria-label="Gegenvorschlag: Datum und Uhrzeit" value={counterAt} onChange={(e) => setCounterAt(e.target.value)} className="input" />
                        <input aria-label="Antwort oder Grund" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} className="input" placeholder="Antwort / Grund" />
                        <button type="button" disabled={busy} onClick={() => decide(p, "counter")} className="tls-btn tls-btn--secondary px-3 py-2 rounded-sm text-[10px] uppercase tracking-wider font-bold disabled:opacity-50">Gegenvorschlag</button>
                      </div>
                    )}
                  </div>
                  );
                })}
                {!latestProposal && (data.schedule_proposals || []).length === 0 && <div className="text-sm text-white/40">Noch kein Terminvorschlag vorhanden.</div>}
              </div>
            </div>
            )}
          </div>

          {showChat && (
          <aside className="border border-white/10 bg-[#121212] rounded-sm p-5 h-fit" data-testid="match-chat">
            <h2 className="font-heading text-xl font-black uppercase flex items-center gap-2"><MessageSquare className="w-5 h-5 text-[#29B6E8]" /> Matchchat</h2>
            <div className="mt-4 space-y-3 max-h-[28rem] overflow-y-auto pr-1">
              {chat.map((m) => (
                <div key={m.id} className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3">
                  <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{m.author?.display_name || m.author?.username || "Benutzer"}</div>
                  {m.message && <div className="mt-1 text-sm text-white/75 whitespace-pre-wrap">{m.message}</div>}
                  <ModerationStateBadge moderation={m.moderation} />
                  <ChatMessageAttachments attachments={m.attachments} />
                  <ChatMessageSticker sticker={m.sticker} />
                </div>
              ))}
              {chat.length === 0 && <div className="text-sm text-white/40">Noch keine Nachrichten.</div>}
            </div>
            {chatClosed ? (
              <p className="mt-4 text-xs text-white/45" data-testid="match-chat-closed">Das Match ist beendet – der Chat bleibt zum Nachlesen.</p>
            ) : canUseChat ? (
              <form onSubmit={sendMessage} className="mt-4 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={addStaffMention} className="tls-btn tls-btn--secondary tls-hit px-2.5 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider">@leitung</button>
                </div>
                <ChatAttachmentDrafts drafts={chatAttachments.drafts} onRemove={chatAttachments.remove} />
                <ChatStickerPicker open={stickersOpen} onClose={() => setStickersOpen(false)} onPick={sendSticker} disabled={busy} />
                <div className="flex gap-2 items-end" onPaste={chatAttachments.onPaste}>
                  <ChatAttachButton onFiles={chatAttachments.addFiles} disabled={busy} testId="match-chat-attach" />
                  <ChatStickerButton open={stickersOpen} onToggle={() => setStickersOpen((value) => !value)} disabled={busy} testId="match-chat-stickers" />
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
                  <button disabled={busy || !chatAttachments.canSend(message)} aria-label="Senden" className="tls-btn tls-btn--primary px-3 py-2 rounded-sm disabled:opacity-50"><Send className="w-4 h-4" /></button>
                </div>
              </form>
            ) : (
              <p className="mt-4 text-xs text-white/45">Schreiben können Teilnehmer, Team-Captains und Turnierleitung.</p>
            )}
          </aside>
          )}
        </div>
      </section>
      {resultOpen && data.result_entry ? <ResultWindow entry={data.result_entry} league={league} onClose={() => setResultOpen(false)} onSaved={resultUndo.start} /> : null}
      <ResultUndoBar undo={resultUndo} />
    </PublicLayout>
  );
}

function Pill({ children }) {
  return <span className="rounded-sm border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white/60">{children}</span>;
}

function ResultSide({ participant, match, score, isWinner }) {
  return (
    <div className={`border rounded-sm bg-[#0A0A0A] p-4 ${isWinner ? "border-[#29B6E8]/70 shadow-[0_0_18px_rgba(41,182,232,0.18)]" : "border-white/10"}`}>
      <div className="font-heading text-lg font-bold uppercase truncate">{slotName(participant?.display_name, participant, match)}</div>
      {participant?.team && <div className="mt-1 text-xs text-[#29B6E8] truncate">[{participant.team.tag}] {participant.team.name}</div>}
      <div className={`mt-3 font-display text-5xl font-bold ${isWinner ? "text-[#29B6E8]" : "text-white/75"}`}>{score ?? 0}</div>
    </div>
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

function v2ResultForParticipant(match, participant) {
  return (match.results || []).find((result) => result.registration_id === participant?.registration_id) || null;
}

function v2ResultRank(match, participant) {
  return Number(v2ResultForParticipant(match, participant)?.rank || 0);
}

/** Ein Lauf in Platzreihenfolge (#2124, TP1): wer einen Platz hat, nach Platz - der Rest nach Startplatz dahinter. */
function heatInPlaceOrder(participants = [], match = {}) {
  const place = (participant) => v2ResultRank(match, participant) || Number.POSITIVE_INFINITY;
  return [...participants].sort((left, right) => (place(left) - place(right)) || (Number(left?.slot || 0) - Number(right?.slot || 0)));
}

/** Was unter dem Platz steht: Punkte, Stand oder Zeit - oder warum es keinen Platz gab. */
function heatResultDetail(result, mode) {
  if (!result) return "";
  if (result.forfeit) return "Nicht erschienen";
  if (result.dnf) return "Aufgegeben";
  if (mode === "time") return result.time_ms != null ? showLapTime(result.time_ms) : "";
  if (result.points != null) return `${result.points} ${Number(result.points) === 1 ? "Punkt" : "Punkte"}`;
  if (result.score != null) return `Stand ${result.score}`;
  return "";
}

function HeatSide({ participant, match, result, mode }) {
  const place = Number(result?.rank || 0);
  const detail = heatResultDetail(result, mode);
  return (
    <div className={`border rounded-sm bg-[#0A0A0A] p-4 ${place === 1 ? "border-[#29B6E8]/70 shadow-[0_0_18px_rgba(41,182,232,0.18)]" : "border-white/10"}`} data-testid="match-heat-side" data-place={place || ""}>
      <div className={`font-display text-4xl font-bold ${place === 1 ? "text-[#29B6E8]" : place ? "text-white/80" : "text-white/35"}`} data-testid="match-heat-place">{place ? `Platz ${place}` : "–"}</div>
      <div className="mt-2 font-heading text-lg font-bold uppercase truncate">{slotName(participant?.display_name, participant, match)}</div>
      {participant?.team && <div className="mt-1 text-xs text-[#29B6E8] truncate">[{participant.team.tag}] {participant.team.name}</div>}
      <div className="mt-1 text-xs text-white/50" data-testid="match-heat-detail">{[detail, participant?.slot ? `Startplatz ${participant.slot}` : ""].filter(Boolean).join(" · ")}</div>
    </div>
  );
}

function v2ResultDisplay(match, participant, mode) {
  const result = v2ResultForParticipant(match, participant);
  if (!result) return "-";
  if (result.forfeit) return "Nicht erschienen";
  if (result.dnf) return "Aufgegeben";
  if (mode === "time") return result.time_ms != null ? showLapTime(result.time_ms) : "-";
  const score = result.score ?? result.points;
  return score != null ? score : "-";
}
