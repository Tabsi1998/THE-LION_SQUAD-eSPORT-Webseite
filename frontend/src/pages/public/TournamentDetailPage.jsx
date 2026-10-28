import { useCallback, useEffect, useRef, useState } from "react";
import { ModerationStateBadge } from "@/components/tls/ModerationStateBadge";
import { PrintLink } from "@/components/tls/print/PrintLink";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, formatApiError, resolveMediaUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useAccountGeneration } from "@/hooks/useAccountGeneration";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { PublicLoadingState } from "@/components/tls/PublicLoadingState";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { PhaseBadge } from "@/components/tls/PhaseBadge";
import { AuthFormAlert } from "@/components/tls/AuthFormFields";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { prefersReducedMotion } from "@/hooks/useLiveChanges";
import { useChatRead } from "@/hooks/useChats";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";
import { toast } from "sonner";
import { Calendar, Users, Trophy, MapPin, Gamepad2, Radio, Zap, Flag, MessageSquare, Send, Handshake, ExternalLink } from "lucide-react";
import { PrizeList } from "@/components/tls/PrizeList";
import { StreamEmbed } from "@/components/tls/StreamEmbed";
import { TournamentLiveStreams } from "@/components/tls/tournament/TournamentLiveStreams";
import { MentionTextarea } from "@/components/tls/MentionTextarea";
import { MentionText } from "@/components/tls/MentionText";
import { ChatAttachButton, ChatAttachmentDrafts, ChatMessageAttachments, useChatAttachmentDrafts } from "@/components/tls/ChatAttachments";
import { ChatMessageSticker, ChatStickerButton, ChatStickerPicker } from "@/components/tls/ChatStickers";
import { formatWhen, getRegistrationState } from "@/lib/datetime";
import { checkInState } from "@/lib/checkInTimes";
import { tournamentIsOver } from "@/lib/afterEnd";
import { renderMarkdownLite } from "@/lib/markdownLite";
import { seoTextPreview } from "@/lib/textPreview";
import { formatTeamMode, formatTournamentDisplay, hasBracketTree, runningMainView } from "@/lib/tournamentLabels";
import { gameLabel } from "@/lib/gameLabels";
import { formatCents, startFeeSummary } from "@/lib/pricing";
import { TournamentTabs } from "@/components/tls/tournament/TournamentTabs";
import { useLeagueTrail } from "@/hooks/useLeagueTrail";
import { tournamentCrumbs } from "@/lib/leagueTrail";
import { TournamentTimeline, stepCountdown, timelineSteps } from "@/components/tls/tournament/TournamentTimeline";
import { useCountdownDays } from "@/hooks/useCountdownDays";
import { MyStandCard } from "@/components/tls/tournament/MyStandCard";
import { isPublicLive } from "@/lib/publicPhase";
import { OnsiteTournamentView } from "@/components/tls/tournament/OnsiteTournamentView";
import { TournamentUnavailable } from "@/components/tls/tournament/TournamentUnavailable";
import { problemKind } from "@/lib/loadProblem";
import { RegistrationSheet } from "@/components/tls/tournament/RegistrationSheet";
import { FriendsAtEvent } from "@/components/tls/FriendsAtEvent";
import { offerFriendsHint } from "@/lib/friendsHint";
import { offerCalendarHint } from "@/lib/calendarHint";
import { useCanonicalSlugRedirect } from "@/hooks/useCanonicalSlugRedirect";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { GameDiscordTile } from "@/components/tls/DiscordServerTile";
import { viennaDateTime } from "@/lib/vienna";
import { ShareButton } from "@/components/tls/ShareButton";
import { Podium } from "@/components/tls/podium/Podium";
import { TournamentMapPools } from "@/components/tls/maps/TournamentMapPools";
import { markPlacementShown, placementFor, placementShown } from "@/lib/placementMoment";
import { ceremonyQueue } from "@/components/achievements/ceremony/queue";

// Eigener Stand je Turnier und Konto (#1047): ein Wechsel des Turniers oder ein echter Kontowechsel baut die Seite
// neu auf - Chat-Entwurf und Anhänge gehen weg, späte Antworten laufen ins Leere. Das erste Laden der Anmeldung
// zählt nicht als Wechsel.
export default function TournamentDetailPage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const accountGeneration = useAccountGeneration(user?.id);
  return <TournamentDetailView key={`${slug}:${accountGeneration}`} />;
}

function TournamentDetailView() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const accessToken = searchParams.get("access") || "";
  const nav = useNavigate();
  const { user } = useAuth();
  const [t, setT] = useState(null);
  const [regs, setRegs] = useState([]);
  const [standings, setStandings] = useState([]);
  const [myReg, setMyReg] = useState(null);
  const [myTeams, setMyTeams] = useState([]);
  const { submitting: loading, submitOnce } = useSubmissionGuard();
  const [actionError, setActionError] = useState("");
  const [registerModal, setRegisterModal] = useState(false);
  const [loadedFor, setLoadedFor] = useState("");
  const confirm = useConfirm();
  const seoDescription = seoTextPreview(t?.description || t?.rules, "eSports Turnier von THE LION SQUAD mit Anmeldung, Check-in, Bracket und Rangliste.");
  useDocumentTitle(t?.title || "Turnier", seoDescription, {
    image: t?.banner_url,
    canonical: t?.slug ? `${window.location.origin}/tournaments/${t.slug}` : undefined,
  });
  useCanonicalSlugRedirect(slug, t?.slug, "/tournaments");
  // Liga-Staffel (#2110): Brotkrumen über die Ligaseite statt „Turniere“ - dort sind Staffeln ausgefiltert.
  const trail = useLeagueTrail(t);

  const load = useCallback(async () => {
    const accessConfig = { params: accessToken ? { access: accessToken } : undefined };
    const { data } = await api.get(`/tournaments/${slug}`, accessConfig);
    if (data?.onsite_view) {
      // Vor-Ort-Zugang (#1592): nur die schlanke Ansicht - Teilnehmerliste, Baum und Tabelle gibt es erst nach der
      // Anmeldung. Die eigenen Teams braucht die Team-Anmeldung.
      const teamsResponse = user ? await api.get("/teams/my").catch(() => ({ data: [] })) : { data: [] };
      setT(data);
      setRegs([]);
      setStandings([]);
      setMyTeams(teamsResponse.data || []);
      setMyReg(null);
      return;
    }
    setT(data);
    const [{ data: r }, teamsResponse] = await Promise.all([
      api.get(`/tournaments/${data.id}/registrations`, accessConfig),
      user ? api.get("/teams/my").catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
    ]);
    const teams = teamsResponse.data || [];
    setRegs(r);
    setMyTeams(teams);
    if (["completed", "results_published", "archived"].includes(data.status)) {
      try {
        const { data: rows } = await api.get(`/tournaments/${data.id}/standings`, accessConfig);
        setStandings(rows || []);
      } catch {
        setStandings([]);
      }
    } else {
      setStandings([]);
    }
    const teamIds = new Set(teams.map((team) => team.id));
    setMyReg(user ? r.find((x) => x.user_id === user.id || x.is_mine || (x.team_id && teamIds.has(x.team_id))) || null : null);
    // Erst wenn die Anmeldung geklärt ist (user undefined = lädt noch), darf ?anmelden=1 handeln.
    if (user !== undefined) setLoadedFor(`${slug}:${user?.id || "guest"}`);
  }, [slug, user, accessToken]);

  // Ohne Turnier eine Meldung statt ewig „Lade Turnier“ (#1939): 404, 403 oder ohne Netz. Die Meldung gehört zu genau
  // diesem Abruf (Turnier, Konto, Zugang) - solange die Anmeldung noch lädt, bleibt das Skelett.
  const loadKey = `${slug}:${user === undefined ? "pending" : user?.id || "guest"}:${accessToken}`;
  const [loadProblem, setLoadProblem] = useState(null);
  const refresh = useCallback(async () => {
    try {
      await load();
      setLoadProblem(null);
    } catch (error) {
      setLoadProblem({ key: loadKey, kind: problemKind(error) });
    }
  }, [load, loadKey]);
  const retry = () => {
    setLoadProblem(null);
    refresh();
  };

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Aus der News (#1266): ?anmelden=1 führt zur Anmeldung - braucht sie Angaben (Team, Spieler-IDs, Kosten), öffnet
  // sich das Formular; sonst rückt der Anmelde-Knopf ins Bild und bekommt den Fokus, damit niemand ungefragt angemeldet
  // ist. Wer schon angemeldet ist oder es nicht kann, sieht einfach die Seite. Nur einmal je Aufruf.
  const wantsSignup = searchParams.get("anmelden") === "1";
  const signupHandled = useRef(false);
  useEffect(() => {
    if (!wantsSignup || signupHandled.current || !t || !loadedFor.startsWith(`${slug}:`)) return;
    signupHandled.current = true;
    if (myReg || t.onsite_view) return;
    const needsForm = (t.team_mode || "solo") !== "solo" || t.offer || (t.game?.effective_player_id_fields || t.game?.player_id_fields || []).length;
    if (user && needsForm && getRegistrationState(t, "Anmeldung").canRegister) {
      setRegisterModal(true);
      return;
    }
    window.requestAnimationFrame?.(() => {
      const button = document.querySelector("[data-testid='tournament-register-btn'], [data-testid='tournament-event-first']");
      button?.scrollIntoView?.({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
      button?.focus?.({ preventScroll: true });
    });
  }, [wantsSignup, t, loadedFor, slug, myReg, user]);

  // Nur Änderungen dieses Turniers (#1801) - bis es geladen ist, jede.
  useLiveRefresh(refresh, ["tournaments"], { fallbackMs: 10000, tournamentId: t?.id });
  const countdownDays = useCountdownDays();

  // Sieger-Moment (#1180): wer Platz 1 bis 3 belegt hat, bekommt nach dem Ende einmal je Browser seine Karte - über die
  // Zeremonie-Warteschlange, also nie zugleich mit einem Erfolg.
  useEffect(() => {
    const placement = placementFor(t, standings);
    if (!placement || placementShown(placement)) return;
    markPlacementShown(placement);
    ceremonyQueue.enqueue({ id: `placement-${placement.key}`, placement });
  }, [t, standings]);

  const runAction = async (task, fallback) => {
    setActionError("");
    const attempt = await submitOnce(task);
    if (!attempt.started || !attempt.error) return attempt.started;
    const message = formatApiError(attempt.error.response?.data?.detail) || fallback;
    setActionError(message);
    toast.error(message);
    return false;
  };

  const submitRegistration = async ({ playerIds = {}, teamId = null, acceptCosts = false, selectedPositions = [] } = {}) => {
    if (!user) { nav(`/login?next=${encodeURIComponent(`/tournaments/${slug}${accessToken ? `?access=${accessToken}` : ""}`)}`); return; }
    await runAction(async () => {
      await api.post(`/tournaments/${t.id}/register`, {
        team_id: teamId,
        ingame_name: user.display_name || user.username,
        discord: user.discord_name,
        player_ids: playerIds,
        accept_rules: true, accept_privacy: true,
        // Startgeld (#319): wer anmeldet, übernimmt es - der Server verlangt die Bestätigung.
        accept_costs: Boolean(acceptCosts),
        selected_positions: selectedPositions,
      }, { params: accessToken ? { access: accessToken } : undefined });
      toast.success("Erfolgreich angemeldet!");
      setRegisterModal(false);
      await load();
      // Der einmalige Hinweis direkt nach der ersten Anmeldung (#1188), nicht erst auf der Event-Seite.
      void offerFriendsHint();
      // Der Abo-Hinweis (#1788): nur ohne aktives Abo und nur einmal - der Server entscheidet.
      void offerCalendarHint();
    }, "Anmeldung konnte nicht gespeichert werden.");
  };

  // Bestätigungs-Blatt (#1261): jede Anmeldung öffnet zuerst das Blatt - auch Einzel ohne Startgeld und Kennungen. Erst
  // „Verbindlich anmelden“ darin meldet an; ein versehentlicher Tipp ist keine Anmeldung mehr.
  const handleRegister = () => {
    if (!user) { nav(`/login?next=${encodeURIComponent(`/tournaments/${slug}${accessToken ? `?access=${accessToken}` : ""}`)}`); return; }
    setActionError("");
    setRegisterModal(true);
  };

  const handleCheckin = async () => {
    await runAction(async () => {
      await api.post(`/tournaments/${t.id}/checkin`);
      toast.success("Check-in erfolgt.");
      await load();
    }, "Check-in konnte nicht gespeichert werden.");
  };

  const handleUnregister = async () => {
    if (!myReg) return;
    await runAction(async () => {
      const ok = await confirm({
        title: "Vom Turnier abmelden?",
        description: "Deine Anmeldung wird entfernt und dein Platz wird im Vorschau-Turnierbaum wieder frei.",
        confirmLabel: "Abmelden",
        tone: "danger",
      });
      if (!ok) return;
      await api.delete(`/tournaments/${t.id}/registrations/${myReg.id}`);
      toast.success("Du bist vom Turnier abgemeldet.");
      await load();
    }, "Abmeldung fehlgeschlagen.");
  };

  if (!t) {
    const problem = user !== undefined && loadProblem?.key === loadKey ? loadProblem.kind : null;
    if (!problem) return <PublicLayout><PublicLoadingState label="Lade Turnier" /></PublicLayout>;
    const loginHref = `/login?next=${encodeURIComponent(`/tournaments/${slug}${accessToken ? `?access=${accessToken}` : ""}`)}`;
    return (
      <PublicLayout>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14" data-testid="tournament-unavailable">
          <TournamentUnavailable kind={problem} user={user} loginHref={loginHref} onRetry={retry} />
        </div>
      </PublicLayout>
    );
  }
  if (t.onsite_view) {
    return (
      <PublicLayout>
        <OnsiteTournamentView tournament={t} user={user} loading={loading} error={registerModal ? "" : actionError} onRegister={handleRegister} />
        {registerModal && (
          <RegistrationSheet
            tournament={t}
            user={user}
            myTeams={myTeams}
            loading={loading}
            error={actionError}
            onClose={() => setRegisterModal(false)}
            onSubmit={submitRegistration}
          />
        )}
      </PublicLayout>
    );
  }

  const registration = getRegistrationState(t, "Anmeldung");
  const isTeamTournament = (t.team_mode || "solo") !== "solo";
  const myRegTeam = myReg?.team_id ? myTeams.find((team) => team.id === myReg.team_id) : null;
  const staffOnlyCheckIn = (t.event_mode || "online") === "local";
  const canCheckIn = !staffOnlyCheckIn && !!myReg && (!myReg.team_id || myReg.user_id === user?.id || myRegTeam?.can_manage || ["leader", "co_leader"].includes(myRegTeam?.my_role));
  const clubMemberBlocked = !!user?.is_club_member && !!t.block_club_member_registration;
  // Turnier nur mit Event-Anmeldung (#875): wer einzeln antritt, sieht den Weg über das Event, bevor er scheitert. Bei
  // Teams prüft der Server die Mitglieder und nennt, wer fehlt.
  const eventGate = t.event_gate || null;
  // Mit ?turnier=… führt die Event-Seite nach der Anmeldung und „Spielst du auch mit?“ (#1184) hierher zurück.
  const eventHref = eventGate?.event ? `/events/${eventGate.event.slug || eventGate.event.id}?turnier=${encodeURIComponent(t.slug || t.id)}` : "";
  const eventBlocked = !!eventGate && !isTeamTournament && !eventGate.registered;
  const hasRegisterAccess = t.access_link?.grants?.includes("register");
  const canSelfRegister = (registration.canRegister || hasRegisterAccess) && !clubMemberBlocked && !eventBlocked;
  // Ein zugeteiltes Co-Team (#1649, #2110) nimmt nur die Turnierleitung heraus - statt „Abmelden“ steht der Hinweis.
  const leagueSquad = Boolean(myReg?.squad_id);
  const canSelfUnregister = !leagueSquad && !!myReg && (myReg.user_id === user?.id || myRegTeam?.can_manage || ["leader", "co_leader"].includes(myRegTeam?.my_role)) && !["checked_in", "no_show", "rejected"].includes(myReg.status) && !["live", "paused", "completed", "results_published", "archived"].includes(t.status);
  const podiumRows = standings.filter((row) => row && !Array.isArray(row.standings) && Number(row.rank) >= 1 && Number(row.rank) <= 3);
  const nextStep = timelineSteps(t).find((step) => step.next) || null;
  const finished = ["completed", "results_published", "archived"].includes(t.status);
  const subPage = (part) => `/tournaments/${t.slug || t.id}/${part}${accessToken ? `?access=${encodeURIComponent(accessToken)}` : ""}`;
  // Check-in-Ende (#2124): dieselbe Regel wie „Dein Stand“, die App und der Server - danach kein Knopf mehr.
  const checkIn = checkInState(t);
  const checkinNow = !!myReg && canCheckIn && myReg.status === "approved" && checkIn.open;
  // Vor Ort checkt die Turnierleitung ein (#2124, Review O4): bis zum Start bleibt dort „Check-in vor Ort“ stehen.
  const checkinOver = !!myReg && myReg.status === "approved" && t.status === "check_in" && checkIn.over && !(staffOnlyCheckIn && !t.started);
  // Die eine Hauptaktion je Phase (#401).
  let primaryKey;
  let primaryAction = null;
  const primaryClass = "px-6 py-3 font-bold uppercase tracking-wider rounded-sm disabled:opacity-50";
  if (canSelfRegister && !myReg) {
    primaryKey = "register";
    primaryAction = <button data-testid="tournament-register-btn" onClick={handleRegister} disabled={loading} className={`${primaryClass} tls-btn tls-btn--primary`}>{loading ? "Wird gesendet…" : (isTeamTournament ? "Team anmelden" : "Jetzt anmelden")}</button>;
  } else if (eventBlocked && !myReg && (registration.canRegister || hasRegisterAccess)) {
    primaryKey = "event_first";
    primaryAction = <Link to={eventHref} data-testid="tournament-event-first" className={`${primaryClass} tls-btn tls-btn--primary`}>Zuerst beim Event anmelden</Link>;
  } else if (clubMemberBlocked && !myReg) {
    primaryKey = "blocked";
    primaryAction = <button type="button" disabled data-testid="tournament-blocked-btn" className={`${primaryClass} tls-btn tls-btn--quiet cursor-not-allowed`}>Externe Anmeldung</button>;
  } else if (checkinNow) {
    primaryKey = "checkin";
    primaryAction = <button onClick={handleCheckin} disabled={loading} data-testid="tournament-checkin-btn" className={`${primaryClass} tls-btn tls-btn--primary`}>Check-in</button>;
  } else if (checkinOver) {
    primaryKey = "checkin_over";
    primaryAction = <button type="button" disabled data-testid="tournament-checkin-over" className={`${primaryClass} tls-btn tls-btn--quiet cursor-not-allowed`}>Check-in vorbei</button>;
  } else if (staffOnlyCheckIn && myReg?.status === "approved" && t.status === "check_in") {
    primaryKey = "checkin_local";
    primaryAction = <button type="button" disabled data-testid="tournament-checkin-local" className={`${primaryClass} tls-btn tls-btn--quiet cursor-not-allowed`}>Check-in vor Ort</button>;
  } else if (finished) {
    primaryKey = "standings";
    primaryAction = <Link to={subPage("standings")} data-testid="tournament-standings-link" className={`${primaryClass} tls-btn tls-btn--primary`}>Rangliste</Link>;
  } else if (t.started && runningMainView(t) === "standings") {
    // Ohne Baum oder mit Tabelle zuerst (#2124): im laufenden Turnier ist die Rangliste die Hauptaktion.
    primaryKey = "standings";
    primaryAction = <Link to={subPage("standings")} data-testid="tournament-standings-link" className={`${primaryClass} tls-btn tls-btn--primary`}>Rangliste</Link>;
  } else if (t.started) {
    primaryKey = "bracket";
    primaryAction = <Link to={subPage("bracket")} data-testid="tournament-bracket-link" className={`${primaryClass} tls-btn tls-btn--primary`}>Turnierbaum</Link>;
  } else if (myReg) {
    primaryKey = "schedule";
    primaryAction = <Link to={subPage("matches")} data-testid="tournament-schedule-link" className={`${primaryClass} tls-btn tls-btn--secondary`}>Spielplan</Link>;
  } else {
    primaryKey = "closed";
    primaryAction = <button type="button" disabled data-testid="tournament-closed-btn" className={`${primaryClass} border border-white/10 text-white/35 cursor-not-allowed`}>{registration.label}</button>;
  }
  const STATUS_ORDER = { checked_in: 0, approved: 1, pending: 2, waitlist: 3, rejected: 4, no_show: 5 };
  // Nach dem Ende stehen die Teilnehmer nach ihrem Endplatz (geteilte Plätze gleich), sonst nach Status und Setzplatz -
  // nie nach der Reihenfolge der Anmeldung, die man mit dem Podest verwechseln könnte (Abnahme #1593).
  // Ein Endplatz erst nach dem Ende (#2121) - solange es läuft, ist ein Zwischenstand kein Endplatz.
  const finalRank = new Map(finished ? standings.filter((row) => row && !Array.isArray(row.standings) && row.registration_id && Number(row.rank) > 0).map((row) => [row.registration_id, Number(row.rank)]) : []);
  const sortedRegs = [...regs].sort((a, b) => ((finalRank.get(a.id) ?? 9999) - (finalRank.get(b.id) ?? 9999)) || ((STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)) || ((a.seed ?? 999) - (b.seed ?? 999)));
  const calendarItem = {
    id: t.id, slug: t.slug, kind: "tournament", title: t.title, start: t.start_date, end: t.end_date,
    location: t.location || null, detail: [t.game ? gameLabel(t.game) : null, formatTournamentDisplay(t)].filter(Boolean).join(" · "),
    url: typeof window !== "undefined" && t.slug ? `${window.location.origin}/tournaments/${t.slug}` : null,
  };

  return (
    <PublicLayout>
      <div className="relative border-b border-white/10 bg-grid-dense">
        {t.banner_url && (
          <div className="absolute inset-0">
            <img src={resolveMediaUrl(t.banner_url)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover opacity-20" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0A0A0A]" />
          </div>
        )}
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <Breadcrumbs items={tournamentCrumbs(t, trail)} className="mb-4" />
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <PhaseBadge phase={t.public_phase} status={t.status} size="lg" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8] border border-[#29B6E8]/30 rounded-sm px-2 py-1">{formatTournamentDisplay(t)}</span>
            {t.game && <span className="text-white/60 text-sm">· {gameLabel(t.game)}</span>}
            {(t.partners || []).map((p) => (
              <Link key={p.id} to={`/partners/${p.slug || p.id}`} data-testid={`tournament-partner-${p.slug || p.id}`} className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#29B6E8] border border-[#29B6E8]/30 rounded-sm px-2 py-1 hover:bg-[#29B6E8]/10">
                <Handshake className="w-3 h-3" /> mit {p.name}
              </Link>
            ))}
          </div>
          <div className="flex items-start justify-between gap-3">
            <h1 data-testid="tournament-title" className="font-heading text-4xl md:text-6xl font-black uppercase leading-tight min-w-0 break-words">{t.title}</h1>
            {/* Teilen (#1154): oben rechts neben dem Titel. */}
            <ShareButton kind="tournament" id={t.slug || t.id} title={t.title} start={t.start_date} end={t.end_date} className="shrink-0 mt-1" />
          </div>
          {t.description && <div className="mt-4 max-w-2xl prose-cms" dangerouslySetInnerHTML={{ __html: renderMarkdownLite(t.description) }} />}

          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl">
            {/* Datum ganz (#1220): „Sa 23. Mai · 21:00“, ohne Abschneiden. */}
            <InfoTile icon={Calendar} label="Start" value={formatWhen(t.start_date, { fallback: "—" })} wrap testId="tournament-start-tile" />
            <InfoTile icon={Users} label={isTeamTournament ? "Teams" : "Teilnehmer"} value={`${t.participant_count}/${t.max_participants}`} />
            <InfoTile icon={Gamepad2} label="Plattform" value={t.platform || "—"} />
            {/* Format ganz (#401): kein Abschneiden, dazu der Tooltip mit Modus und Best-of */}
            <InfoTile icon={Trophy} label="Format" value={formatTournamentDisplay(t)} wrap title={[formatTournamentDisplay(t), formatTeamMode(t.team_mode), t.best_of > 1 ? `Best of ${t.best_of}` : null].filter(Boolean).join(" · ")} testId="tournament-format-tile" />
          </div>

          <div className={`mt-5 border rounded-sm px-4 py-3 text-sm max-w-3xl ${
            registration.canRegister
              ? "border-[#00FF88]/30 bg-[#00FF88]/5 text-[#00FF88]"
              : registration.state === "scheduled"
                ? "border-[#29B6E8]/30 bg-[#29B6E8]/5 text-[#29B6E8]"
                : "border-white/10 bg-[#121212] text-white/60"
          }`} data-testid="tournament-registration-state">
            <div className="font-bold uppercase tracking-wider text-xs">{registration.label}</div>
            {nextStep && <div className="mt-1 text-white/55">{stepCountdown(nextStep, Date.now(), countdownDays)} – alle Termine unten in der Zeitleiste.</div>}
            {!nextStep && !t.registration_open_from && !t.registration_open_until && <div className="mt-1 text-white/55">Status wird vom Admin gesteuert.</div>}
            {clubMemberBlocked && <div className="mt-1 text-[#FFD700]/75">Dieses Turnier ist für externe Teilnehmer vorgesehen. Vereinsmitglieder können sich hier nicht selbst anmelden.</div>}
            {eventGate && !myReg && (
              <div className="mt-1 text-[#29B6E8]/90" data-testid="tournament-event-gate">
                {isTeamTournament
                  ? `Anmeldung nur mit Event-Anmeldung: Mindestens ${eventGate.team_need} Spieler deines Teams müssen beim Event „${eventGate.event.name}“ angemeldet sein.`
                  : eventGate.registered
                    ? `Du bist beim Event „${eventGate.event.name}“ angemeldet – die Turnieranmeldung ist frei.`
                    : `Anmeldung nur mit Event-Anmeldung: Melde dich zuerst beim Event „${eventGate.event.name}“ an.`}
                {" "}<Link to={eventHref} className="underline hover:text-white">Zum Event</Link>
              </div>
            )}
          </div>

          {t.offer && (
            <div className="mt-3 border border-[#FFD700]/30 bg-[#FFD700]/5 rounded-sm px-4 py-3 text-sm max-w-3xl" data-testid="tournament-offer">
              <div className="text-[11px] uppercase tracking-widest font-bold text-[#FFD700]">Startgeld</div>
              <div className="mt-1 text-white">{startFeeSummary(t.offer, { teamMode: t.team_mode || "solo", teamSize: t.team_size })}</div>
              <ul className="mt-1 space-y-0.5 text-xs text-white/60">
                {t.offer.positions.filter((position) => !position.optional).map((position) => (
                  <li key={position.key}>{position.label}: {formatCents(position.amount_cents, t.offer.currency)} {position.basis === "per_person" ? "je Spieler" : position.basis === "per_team" ? "je Team" : ""}</li>
                ))}
              </ul>
              <div className="mt-1 text-xs text-white/45">{isTeamTournament ? "Die Teamleitung übernimmt das Startgeld für das Team und bekommt die Rechnung." : "Die Rechnung geht an dich."} Bezahlt wird erst, wenn die Teilnahme bestätigt ist.</div>
            </div>
          )}

          {/* Eine Hauptaktion je Phase (#401): Anmelden, Check-in, Turnierbaum oder Rangliste - der Rest als Textlinks. */}
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3" data-testid="tournament-actions">
            {primaryAction}
            <div className="flex flex-wrap items-center gap-4 text-xs font-bold uppercase tracking-wider">
              {primaryKey !== "bracket" && hasBracketTree(t) && <Link to={subPage("bracket")} data-testid="tournament-bracket-link" className="tls-hit text-white/70 hover:text-[#29B6E8]">Turnierbaum</Link>}
              {primaryKey !== "schedule" && <Link to={subPage("matches")} data-testid="tournament-schedule-link" className="tls-hit text-white/70 hover:text-[#29B6E8]">Spielplan</Link>}
              {primaryKey !== "standings" && <Link to={subPage("standings")} data-testid="tournament-standings-link" className="tls-hit text-white/70 hover:text-[#29B6E8]">Rangliste</Link>}
              {t.stream_link && <a href={t.stream_link} target="_blank" rel="noreferrer" data-testid="tournament-stream-link" className="inline-flex items-center gap-1 text-[#FF3B30] hover:text-white"><Radio className="w-3.5 h-3.5" /> Stream</a>}
              {/* Turnierleitung am Handy (#1156): die Live-Werkzeuge - Ergebnisse, was fehlt, Streitfälle. */}
              {t.can_manage_results && <Link to={`/tournaments/${t.slug || t.id}/leitung`} data-testid="tournament-result-entry-link" className="inline-flex items-center gap-1 text-[#FFD700] hover:text-white"><ExternalLink className="w-3.5 h-3.5" /> Turnierleitung</Link>}
            </div>
          </div>
          {!registerModal && actionError && <div className="mt-4 max-w-3xl"><AuthFormAlert id="tournament-action-error">{actionError}</AuthFormAlert></div>}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        <TournamentTabs tournament={t} accessToken={accessToken} participantCount={regs.length} />
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8 min-w-0">
          <MyStandCard tournament={t} registration={myReg} team={myRegTeam} isTeamTournament={isTeamTournament} canCheckIn={false} staffOnlyCheckIn={staffOnlyCheckIn}
            canUnregister={canSelfUnregister} leagueSquad={leagueSquad} onUnregister={handleUnregister} busy={loading} scheduleTo={subPage("matches")} />
          {/* Nach dem Ende (#1221) kein Kalender-Knopf mehr. */}
          <TournamentTimeline tournament={t} calendarItem={tournamentIsOver(t) ? null : calendarItem} />
          {/* Freunde beim Turnier (#1188 Teil 2): nur mit Konto, nur bestätigte Freunde, die es erlauben. */}
          <FriendsAtEvent user={user} path={`/tournaments/${t.slug || t.id}/friends`} scope="tournament" over={tournamentIsOver(t)} accessToken={accessToken} />
          {t.rules && (
            <section>
              <h2 className="font-heading text-2xl font-bold uppercase mb-3 flex items-center gap-2"><Zap className="w-4 h-4 text-[#29B6E8]" /> Regeln</h2>
              <div className="prose-cms border border-white/10 rounded-sm p-5 bg-[#121212]" dangerouslySetInnerHTML={{ __html: renderMarkdownLite(t.rules) }} />
            </section>
          )}
          {(t.prize_places?.length || t.prize_pool) && (
            <section>
              <h2 className="font-heading text-2xl font-bold uppercase mb-3 flex items-center gap-2"><Trophy className="w-4 h-4 text-[#FFD700]" /> Preise</h2>
              <PrizeList prizePlaces={t.prize_places} prizePool={t.prize_pool} />
            </section>
          )}
          {/* Map-Pool (#1616): nur mit Spiel - ein Cup ohne Maps fragt gar nicht danach. */}
          {t.game_id ? <TournamentMapPools tournamentId={t.id} /> : null}
          {podiumRows.length > 0 && (
            <section>
              <h2 className="font-heading text-2xl font-bold uppercase mb-8 flex items-center gap-2"><Trophy className="w-4 h-4 text-[#FFD700]" /> Podest</h2>
              {/* Das Treppchen (#1339) - das Bild, das nach dem Sieger-Moment stehen bleibt. Vor „Ergebnisse
                  veröffentlicht“ ist der Stand noch nicht bestätigt: dann steht es als „vorläufig“ da. */}
              {t.status === "completed" && (
                <p className="-mt-5 mb-6 text-sm text-white/55" data-testid="podium-provisional">Stand vorläufig – die Turnierleitung bestätigt die Ergebnisse noch.</p>
              )}
              <Podium rows={podiumRows} registrations={regs} />
            </section>
          )}
          {/* Die Livestream-Karte folgt der öffentlichen Phase (#1888): nach dem Ende keine, auch wenn der Status noch „live“ ist. */}
          {isPublicLive(t) && <TournamentLiveStreams tournament={t} />}
          {(t.has_live_stream || (t.twitch_enabled && t.twitch_channel)) && (
            <section data-testid="tournament-stream"><StreamEmbed source={t} /></section>
          )}
          {!!t.related_f1_challenges?.length && (
            <section>
              <h2 className="font-heading text-2xl font-bold uppercase mb-3 flex items-center gap-2"><Flag className="w-4 h-4 text-[#29B6E8]" /> Fast-Lap Challenges beim Event</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {t.related_f1_challenges.map((c) => (
                  <Link key={c.id} to={`/fastlap/${c.slug || c.id}`} className="tls-card border border-white/10 rounded-sm bg-[#121212] p-4">
                    <PhaseBadge phase={c.public_phase} status={c.status} />
                    <div className="mt-2 font-heading font-bold">{c.title}</div>
                    {c.start_date && <div className="mt-1 text-xs text-white/50">{formatWhen(c.start_date)}</div>}
                  </Link>
                ))}
              </div>
            </section>
          )}
          {/* Eigener Stand je Turnier (#1047); den Kontowechsel übernimmt die Hülle oben. */}
          {t.show_chat && <TournamentChat key={t.id} tournament={t} user={user} />}
          <section id="teilnehmer" data-testid="tournament-participants">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-heading text-2xl font-bold uppercase">Teilnehmer ({regs.length})</h2>
              {/* Druckansicht (#1283): Check-in-Liste mit Kästchen - nur mit Check-in-Recht (der Server prüft es selbst). */}
              {t.can_check_in ? <PrintLink slug={t.slug || t.id} parts="liste" from="teilnehmer" accessToken={accessToken} testId="participants-print-link" /> : null}
            </div>
            <div className="border border-white/10 rounded-sm divide-y divide-white/5 bg-[#121212]">
              {sortedRegs.map((r) => {
                const mine = !!user && (r.user_id === user.id || r.is_mine);
                return (
                  <div key={r.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${mine ? "bg-[#FFD700]/5" : ""}`} data-testid={`tournament-participant-${r.id}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      {finalRank.size ? (
                        <span className="font-display font-bold text-white/80 w-7 tabular-nums" title="Endplatz" data-testid={`tournament-participant-rank-${r.id}`}>{finalRank.has(r.id) ? `${finalRank.get(r.id)}.` : "–"}</span>
                      ) : (
                        <span className="font-display font-bold text-[#29B6E8] w-7" title="Setzplatz">{r.seed ? `#${r.seed}` : ""}</span>
                      )}
                      <span className="text-white truncate">{r.display_name || r.ingame_name || r.user?.display_name || "—"}</span>
                      {r.team && <span className="text-white/45 text-xs truncate">[{r.team.tag || r.team.name}]{Number(r.team.member_count) > 0 ? ` · ${r.team.member_count} Spieler` : ""}</span>}
                      {mine && <span className="text-[10px] font-bold uppercase tracking-wider text-[#FFD700] border border-[#FFD700]/50 rounded-sm px-1.5 py-0.5" data-testid={`tournament-participant-me-${r.id}`}>du</span>}
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                );
              })}
              {regs.length === 0 && <div className="p-6 text-white/40 text-sm text-center">Noch keine Teilnehmer</div>}
            </div>
          </section>
        </div>
        <aside className="space-y-4 min-w-0">
          {t.location && <InfoRow icon={MapPin} label="Ort" value={t.location} />}
          {t.best_of > 1 && <InfoRow icon={Trophy} label="Best of" value={t.best_of} />}
          <InfoRow icon={Users} label="Modus" value={formatTeamMode(t.team_mode)} />
          {/* Der Discord-Server zum Spiel (#626): eigener, der des Hauptspiels oder der Hauptserver. */}
          <GameDiscordTile gameId={t.game?.id || t.game_id} gameName={gameLabel(t.game)} />
          {t.discord_link && <a href={t.discord_link} target="_blank" rel="noreferrer" className="tls-btn tls-btn--quiet block px-4 py-3 rounded-sm text-center text-sm font-bold uppercase tracking-wider">Discord</a>}
        </aside>
      </div>
      {registerModal && (
        <RegistrationSheet
          tournament={t}
          user={user}
          myTeams={myTeams}
          loading={loading}
          error={actionError}
          onClose={() => setRegisterModal(false)}
          onSubmit={submitRegistration}
        />
      )}
    </PublicLayout>
  );
}

function TournamentChat({ tournament, user }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const { submitting: loading, submitOnce } = useSubmissionGuard();
  const [blocked, setBlocked] = useState("");
  const [sendError, setSendError] = useState("");
  const scrollRef = useRef(null);
  const attachments = useChatAttachmentDrafts();
  const [stickersOpen, setStickersOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await api.get(`/tournaments/${tournament.id}/chat`);
      setMessages(data || []);
      setBlocked("");
    } catch (err) {
      setBlocked(err.response?.status === 403 ? "Chat nur für angemeldete Teilnehmer und Turnierleitung." : "Chat konnte nicht geladen werden.");
    }
  }, [tournament.id, user]);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ["tournaments"], { fallbackMs: 6000, enabled: Boolean(user), tournamentId: tournament.id });
  // Gelesen (#1148): beim Öffnen und bei jeder neuen Nachricht.
  useChatRead("tournament", tournament.id, messages, Boolean(user) && !blocked);

  useEffect(() => {
    const box = scrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages.length]);

  const send = async (event) => {
    event.preventDefault();
    const message = text.trim();
    if (!attachments.canSend(message)) return;
    setSendError("");
    const attempt = await submitOnce(async () => {
      const { data } = await api.post(`/tournaments/${tournament.id}/chat`, { message, attachment_ids: attachments.attachmentIds });
      setMessages((rows) => [...rows, data]);
      setText("");
      setBlocked("");
      attachments.reset();
    });
    if (attempt.started && attempt.error) {
      const messageText = formatApiError(attempt.error.response?.data?.detail) || "Nachricht konnte nicht gesendet werden.";
      setSendError(messageText);
      toast.error(messageText);
    }
  };

  const sendSticker = async (sticker) => {
    setSendError("");
    const attempt = await submitOnce(async () => {
      const { data } = await api.post(`/tournaments/${tournament.id}/chat`, { sticker_id: sticker.id });
      setMessages((rows) => [...rows, data]);
      setStickersOpen(false);
    });
    if (attempt.started && attempt.error) {
      const messageText = formatApiError(attempt.error.response?.data?.detail) || "Sticker konnte nicht gesendet werden.";
      setSendError(messageText);
      toast.error(messageText);
    }
  };

  return (
    <section data-testid="tournament-chat">
      <h2 className="font-heading text-2xl font-bold uppercase mb-3 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-[#29B6E8]" /> Turnier-Chat
      </h2>
      <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
        {!user ? (
          <div className="p-5 text-sm text-white/55">
            <Link to={`/login?next=/tournaments/${tournament.slug || tournament.id}`} className="text-[#29B6E8] font-bold hover:text-white">Einloggen</Link>, um den Chat als Teilnehmer zu nutzen.
          </div>
        ) : blocked ? (
          <div className="p-5 text-sm text-white/45">{blocked}</div>
        ) : (
          <>
            <div ref={scrollRef} className="max-h-80 overflow-y-auto p-4 space-y-3">
              {messages.map((message) => {
                const mine = message.user_id === user.id;
                return (
                  <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] border rounded-sm px-3 py-2 ${mine ? "border-[#29B6E8]/40 bg-[#29B6E8]/10" : "border-white/10 bg-[#0A0A0A]"}`}>
                      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/40">
                        <span className={mine ? "text-[#29B6E8]" : "text-white/55"}>{message.author?.display_name || message.author?.username || "Benutzer"}</span>
                        {message.created_at && <span>{viennaDateTime(message.created_at, { dateStyle: "short", timeStyle: "short" })}</span>}
                      </div>
                      {message.message && <div className="mt-1 whitespace-pre-wrap break-words text-sm text-white/85"><MentionText text={message.message} /></div>}
                      <ChatMessageAttachments attachments={message.attachments} />
                      <ChatMessageSticker sticker={message.sticker} />
                      <ModerationStateBadge moderation={message.moderation} />
                    </div>
                  </div>
                );
              })}
              {messages.length === 0 && <div className="text-center py-8 text-sm text-white/35">Noch keine Nachrichten.</div>}
            </div>
            <ChatAttachmentDrafts drafts={attachments.drafts} onRemove={attachments.remove} />
            <ChatStickerPicker open={stickersOpen} onClose={() => setStickersOpen(false)} onPick={sendSticker} disabled={loading} />
            <form onSubmit={send} onPaste={attachments.onPaste} className="border-t border-white/10 p-3 flex gap-2">
              <ChatAttachButton onFiles={attachments.addFiles} disabled={loading} testId="tournament-chat-attach" />
              <ChatStickerButton open={stickersOpen} onToggle={() => setStickersOpen((value) => !value)} disabled={loading} testId="tournament-chat-stickers" />
              <MentionTextarea
                value={text}
                onValueChange={(value) => { setText(value); setSendError(""); }}
                scope="tournament"
                scopeId={tournament.id}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send(event);
                  }
                }}
                rows={1}
                maxLength={1000}
                placeholder="Spielcode, Lobbycode oder Absprache schreiben..."
                className="flex-1 min-w-0"
                textareaClassName="h-10 max-h-28 w-full resize-none bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm focus:outline-none focus:border-[#29B6E8]"
              />
              <button disabled={loading || !attachments.canSend(text)} className="tls-btn tls-btn--primary inline-flex items-center gap-2 px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-45">
                <Send className="w-3.5 h-3.5" /> Senden
              </button>
            </form>
            {sendError && <div className="border-t border-white/10 p-3"><AuthFormAlert id="tournament-chat-error">{sendError}</AuthFormAlert></div>}
          </>
        )}
      </div>
    </section>
  );
}

function InfoTile({ icon: Icon, label, value, wrap = false, title = "", testId = "" }) {
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212]/80 px-4 py-3" title={title || undefined} data-testid={testId || undefined}>
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/50"><Icon className="w-3.5 h-3.5" /> {label}</div>
      <div className={`mt-1 font-heading font-bold text-lg ${wrap ? "break-words leading-tight" : "truncate"}`}>{value}</div>
    </div>
  );
}
function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="border border-white/10 rounded-sm p-4 bg-[#121212]">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-white/50"><Icon className="w-3.5 h-3.5" /> {label}</div>
      <div className="mt-1 text-white">{value}</div>
    </div>
  );
}
