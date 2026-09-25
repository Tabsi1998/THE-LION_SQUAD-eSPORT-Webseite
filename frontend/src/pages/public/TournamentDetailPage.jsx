import { useCallback, useEffect, useRef, useState } from "react";
import { ModerationStateBadge } from "@/components/tls/ModerationStateBadge";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, formatApiError, resolveMediaUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { PublicLoadingState } from "@/components/tls/PublicLoadingState";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { PhaseBadge } from "@/components/tls/PhaseBadge";
import { AuthFormAlert } from "@/components/tls/AuthFormFields";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";
import { toast } from "sonner";
import { Calendar, Users, Trophy, MapPin, Gamepad2, Radio, Zap, X, Flag, MessageSquare, Send, Handshake, ExternalLink } from "lucide-react";
import { PrizeList } from "@/components/tls/PrizeList";
import { StreamEmbed } from "@/components/tls/StreamEmbed";
import { TournamentLiveStreams } from "@/components/tls/tournament/TournamentLiveStreams";
import { MentionTextarea } from "@/components/tls/MentionTextarea";
import { MentionText } from "@/components/tls/MentionText";
import { ChatAttachButton, ChatAttachmentDrafts, ChatMessageAttachments, useChatAttachmentDrafts } from "@/components/tls/ChatAttachments";
import { ChatMessageSticker, ChatStickerButton, ChatStickerPicker } from "@/components/tls/ChatStickers";
import { formatDateTime, getRegistrationState } from "@/lib/datetime";
import { renderMarkdownLite } from "@/lib/markdownLite";
import { seoTextPreview } from "@/lib/textPreview";
import { formatTeamMode, formatTournamentDisplay } from "@/lib/tournamentLabels";
import { gameLabel } from "@/lib/gameLabels";
import { formatCents, previewQuote, startFeeSummary } from "@/lib/pricing";
import { TournamentTabs } from "@/components/tls/tournament/TournamentTabs";
import { TournamentTimeline, countdownText, timelineSteps } from "@/components/tls/tournament/TournamentTimeline";
import { MyStandCard } from "@/components/tls/tournament/MyStandCard";
import { useCanonicalSlugRedirect } from "@/hooks/useCanonicalSlugRedirect";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useConfirm } from "@/components/tls/ConfirmDialog";

export default function TournamentDetailPage() {
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
  const confirm = useConfirm();
  const seoDescription = seoTextPreview(t?.description || t?.rules, "eSports Turnier von THE LION SQUAD mit Anmeldung, Check-in, Bracket und Rangliste.");
  useDocumentTitle(t?.title || "Turnier", seoDescription, {
    image: t?.banner_url,
    canonical: t?.slug ? `${window.location.origin}/tournaments/${t.slug}` : undefined,
  });
  useCanonicalSlugRedirect(slug, t?.slug, "/tournaments");

  const load = useCallback(async () => {
    const accessConfig = { params: accessToken ? { access: accessToken } : undefined };
    const { data } = await api.get(`/tournaments/${slug}`, accessConfig);
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
  }, [slug, user, accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  useLiveRefresh(load, ["tournaments"], { fallbackMs: 10000 });

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
    }, "Anmeldung konnte nicht gespeichert werden.");
  };

  const handleRegister = async () => {
    if (!user) { nav(`/login?next=${encodeURIComponent(`/tournaments/${slug}${accessToken ? `?access=${accessToken}` : ""}`)}`); return; }
    const needsTeam = (t.team_mode || "solo") !== "solo";
    if (needsTeam || t.offer || (t.game?.effective_player_id_fields || t.game?.player_id_fields || []).length) {
      setRegisterModal(true);
      return;
    }
    await submitRegistration({});
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

  if (!t) return <PublicLayout><PublicLoadingState label="Lade Turnier" /></PublicLayout>;

  const registration = getRegistrationState(t, "Anmeldung");
  const isTeamTournament = (t.team_mode || "solo") !== "solo";
  const myRegTeam = myReg?.team_id ? myTeams.find((team) => team.id === myReg.team_id) : null;
  const staffOnlyCheckIn = (t.event_mode || "online") === "local";
  const canCheckIn = !staffOnlyCheckIn && !!myReg && (!myReg.team_id || myReg.user_id === user?.id || myRegTeam?.can_manage || ["leader", "co_leader"].includes(myRegTeam?.my_role));
  const clubMemberBlocked = !!user?.is_club_member && !!t.block_club_member_registration;
  const hasRegisterAccess = t.access_link?.grants?.includes("register");
  const canSelfRegister = (registration.canRegister || hasRegisterAccess) && !clubMemberBlocked;
  const canSelfUnregister = !!myReg && (myReg.user_id === user?.id || myRegTeam?.can_manage || ["leader", "co_leader"].includes(myRegTeam?.my_role)) && !["checked_in", "no_show", "rejected"].includes(myReg.status) && !["live", "paused", "completed", "results_published", "archived"].includes(t.status);
  const podiumRows = standings
    .filter((row) => Number(row.rank) >= 1 && Number(row.rank) <= 3)
    .sort((a, b) => Number(a.rank) - Number(b.rank))
    .slice(0, 3);
  const nextStep = timelineSteps(t).find((step) => step.next) || null;
  const finished = ["completed", "results_published", "archived"].includes(t.status);
  const subPage = (part) => `/tournaments/${t.slug || t.id}/${part}${accessToken ? `?access=${encodeURIComponent(accessToken)}` : ""}`;
  const checkinNow = !!myReg && canCheckIn && myReg.status === "approved" && t.status === "check_in";
  // Die eine Hauptaktion je Phase (#401).
  let primaryKey = "none";
  let primaryAction = null;
  const primaryClass = "px-6 py-3 font-bold uppercase tracking-wider rounded-sm transition disabled:opacity-50";
  if (canSelfRegister && !myReg) {
    primaryKey = "register";
    primaryAction = <button data-testid="tournament-register-btn" onClick={handleRegister} disabled={loading} className={`${primaryClass} bg-[#29B6E8] text-black hover:bg-[#1E95C2]`}>{loading ? "Wird gesendet…" : (isTeamTournament ? "Team anmelden" : "Jetzt anmelden")}</button>;
  } else if (clubMemberBlocked && !myReg) {
    primaryKey = "blocked";
    primaryAction = <button type="button" disabled data-testid="tournament-blocked-btn" className={`${primaryClass} border border-[#FFD700]/30 text-[#FFD700]/70 cursor-not-allowed`}>Externe Anmeldung</button>;
  } else if (checkinNow) {
    primaryKey = "checkin";
    primaryAction = <button onClick={handleCheckin} disabled={loading} data-testid="tournament-checkin-btn" className={`${primaryClass} bg-[#FFD700] text-black hover:bg-[#ffe45c]`}>Check-in</button>;
  } else if (staffOnlyCheckIn && myReg?.status === "approved" && t.status === "check_in") {
    primaryKey = "checkin_local";
    primaryAction = <button type="button" disabled data-testid="tournament-checkin-local" className={`${primaryClass} border border-[#FFD700]/35 text-[#FFD700]/75 cursor-not-allowed`}>Check-in vor Ort</button>;
  } else if (finished) {
    primaryKey = "standings";
    primaryAction = <Link to={subPage("standings")} data-testid="tournament-standings-link" className={`${primaryClass} bg-[#FFD700] text-black hover:bg-[#ffe45c]`}>Rangliste</Link>;
  } else if (t.started) {
    primaryKey = "bracket";
    primaryAction = <Link to={subPage("bracket")} data-testid="tournament-bracket-link" className={`${primaryClass} bg-[#29B6E8] text-black hover:bg-[#1E95C2]`}>Turnierbaum</Link>;
  } else if (myReg) {
    primaryKey = "schedule";
    primaryAction = <Link to={subPage("matches")} data-testid="tournament-schedule-link" className={`${primaryClass} border border-[#29B6E8]/50 text-[#29B6E8] hover:bg-[#29B6E8]/10`}>Spielplan</Link>;
  } else {
    primaryKey = "closed";
    primaryAction = <button type="button" disabled data-testid="tournament-closed-btn" className={`${primaryClass} border border-white/10 text-white/35 cursor-not-allowed`}>{registration.label}</button>;
  }
  const STATUS_ORDER = { checked_in: 0, approved: 1, pending: 2, waitlist: 3, rejected: 4, no_show: 5 };
  const sortedRegs = [...regs].sort((a, b) => ((STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)) || ((a.seed ?? 999) - (b.seed ?? 999)));
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
          <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "eSports", to: "/esports" }, { label: "Turniere", to: "/tournaments" }, { label: t.title }]} className="mb-4" />
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
          <h1 data-testid="tournament-title" className="font-heading text-4xl md:text-6xl font-black uppercase leading-tight">{t.title}</h1>
          {t.description && <div className="mt-4 max-w-2xl prose-cms" dangerouslySetInnerHTML={{ __html: renderMarkdownLite(t.description) }} />}

          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl">
            <InfoTile icon={Calendar} label="Start" value={formatDateTime(t.start_date)} />
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
            {nextStep && <div className="mt-1 text-white/55">{nextStep.label} {countdownText(nextStep.ms)} – alle Termine unten in der Zeitleiste.</div>}
            {!nextStep && !t.registration_open_from && !t.registration_open_until && <div className="mt-1 text-white/55">Status wird vom Admin gesteuert.</div>}
            {clubMemberBlocked && <div className="mt-1 text-[#FFD700]/75">Dieses Turnier ist für externe Teilnehmer vorgesehen. Vereinsmitglieder können sich hier nicht selbst anmelden.</div>}
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
              {primaryKey !== "bracket" && <Link to={subPage("bracket")} data-testid="tournament-bracket-link" className="text-white/70 hover:text-[#29B6E8]">Turnierbaum</Link>}
              {primaryKey !== "schedule" && <Link to={subPage("matches")} data-testid="tournament-schedule-link" className="text-white/70 hover:text-[#29B6E8]">Spielplan</Link>}
              {primaryKey !== "standings" && <Link to={subPage("standings")} data-testid="tournament-standings-link" className="text-white/70 hover:text-[#29B6E8]">Rangliste</Link>}
              {t.stream_link && <a href={t.stream_link} target="_blank" rel="noreferrer" data-testid="tournament-stream-link" className="inline-flex items-center gap-1 text-[#FF3B30] hover:text-white"><Radio className="w-3.5 h-3.5" /> Stream</a>}
              {t.can_manage_results && <Link to={`/admin/tournaments/${t.id}?tab=stages`} data-testid="tournament-result-entry-link" className="inline-flex items-center gap-1 text-[#FFD700] hover:text-white"><ExternalLink className="w-3.5 h-3.5" /> Ergebnisse eintragen</Link>}
            </div>
          </div>
          {!registerModal && actionError && <div className="mt-4 max-w-3xl"><AuthFormAlert id="tournament-action-error">{actionError}</AuthFormAlert></div>}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        <TournamentTabs tournament={t} accessToken={accessToken} participantCount={regs.length} />
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <MyStandCard tournament={t} registration={myReg} team={myRegTeam} isTeamTournament={isTeamTournament} canCheckIn={false} staffOnlyCheckIn={staffOnlyCheckIn}
            canUnregister={canSelfUnregister} onUnregister={handleUnregister} busy={loading} scheduleTo={subPage("matches")} />
          <TournamentTimeline tournament={t} calendarItem={calendarItem} />
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
          {podiumRows.length > 0 && (
            <section>
              <h2 className="font-heading text-2xl font-bold uppercase mb-3 flex items-center gap-2"><Trophy className="w-4 h-4 text-[#FFD700]" /> Podium</h2>
              <div className="grid sm:grid-cols-3 gap-3">
                {podiumRows.map((row) => <PodiumCard key={row.registration_id || row.display_name || row.rank} row={row} />)}
              </div>
            </section>
          )}
          {t.status === "live" && <TournamentLiveStreams tournament={t} />}
          {(t.has_live_stream || (t.twitch_enabled && t.twitch_channel)) && (
            <section data-testid="tournament-stream"><StreamEmbed source={t} /></section>
          )}
          {!!t.related_f1_challenges?.length && (
            <section>
              <h2 className="font-heading text-2xl font-bold uppercase mb-3 flex items-center gap-2"><Flag className="w-4 h-4 text-[#29B6E8]" /> Fast-Lap Challenges beim Event</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {t.related_f1_challenges.map((c) => (
                  <Link key={c.id} to={`/fastlap/${c.slug || c.id}`} className="border border-white/10 hover:border-[#29B6E8]/50 rounded-sm bg-[#121212] p-4 transition">
                    <PhaseBadge phase={c.public_phase} status={c.status} />
                    <div className="mt-2 font-heading font-bold">{c.title}</div>
                    {c.start_date && <div className="mt-1 text-xs text-white/50">{formatDateTime(c.start_date)}</div>}
                  </Link>
                ))}
              </div>
            </section>
          )}
          {t.show_chat && <TournamentChat tournament={t} user={user} />}
          <section id="teilnehmer" data-testid="tournament-participants">
            <h2 className="font-heading text-2xl font-bold uppercase mb-3">Teilnehmer ({regs.length})</h2>
            <div className="border border-white/10 rounded-sm divide-y divide-white/5 bg-[#121212]">
              {sortedRegs.map((r, i) => {
                const mine = !!user && (r.user_id === user.id || r.is_mine);
                return (
                  <div key={r.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${mine ? "bg-[#FFD700]/5" : ""}`} data-testid={`tournament-participant-${r.id}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-display font-bold text-[#29B6E8] w-6">{r.seed ? `#${r.seed}` : i + 1}</span>
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
        <aside className="space-y-4">
          {t.location && <InfoRow icon={MapPin} label="Ort" value={t.location} />}
          {t.best_of > 1 && <InfoRow icon={Trophy} label="Best of" value={t.best_of} />}
          <InfoRow icon={Users} label="Modus" value={formatTeamMode(t.team_mode)} />
          {t.discord_link && <a href={t.discord_link} target="_blank" rel="noreferrer" className="block px-4 py-3 border border-white/10 rounded-sm text-center text-sm font-bold uppercase tracking-wider hover:border-[#29B6E8]/60 hover:text-[#29B6E8]">Discord</a>}
        </aside>
      </div>
      {registerModal && (
        <RegistrationModal
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
  useLiveRefresh(load, ["tournaments"], { fallbackMs: 6000, enabled: Boolean(user) });

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
                        {message.created_at && <span>{new Date(message.created_at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</span>}
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
              <button disabled={loading || !attachments.canSend(text)} className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-45">
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

function PodiumCard({ row }) {
  const rank = Number(row.rank) || 0;
  const styles = {
    1: "border-[#FFD700]/60 bg-[#FFD700]/10 text-[#FFD700]",
    2: "border-white/35 bg-white/10 text-white",
    3: "border-[#CD7F32]/55 bg-[#CD7F32]/10 text-[#CD7F32]",
  };
  const label = rank === 1 ? "Gold" : rank === 2 ? "Silber" : rank === 3 ? "Bronze" : "Platz";
  return (
    <div className={`rounded-sm border p-4 ${styles[rank] || "border-white/10 bg-[#121212] text-white"}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-heading text-4xl font-black">#{rank}</span>
        <span className="min-w-0 truncate font-bold text-white">{row.display_name || row.ingame_name || row.user?.display_name || "Teilnehmer"}</span>
      </div>
      <div className="mt-2 text-xs text-white/50">
        {row.points != null ? `${row.points} Punkte` : row.wins != null ? `${row.wins} Siege` : "Finalplatzierung"}
      </div>
    </div>
  );
}

function RegistrationModal({ tournament, user, myTeams = [], loading, error, onClose, onSubmit }) {
  const game = tournament.game || {};
  const fields = game.effective_player_id_fields || game.player_id_fields || [];
  const sourceSlug = game.identity_game_slug || game.slug;
  const needsTeam = (tournament.team_mode || "solo") !== "solo";
  const manageableTeams = myTeams.filter((team) => team.can_manage || ["leader", "co_leader"].includes(team.my_role));
  const initial = {
    ...((user?.game_ids || {})[sourceSlug] || {}),
    ...((user?.game_ids || {})[game.slug] || {}),
  };
  const [playerIds, setPlayerIds] = useState(initial);
  const [teamId, setTeamId] = useState(manageableTeams[0]?.id || "");
  // Startgeld (#319): Summe vor dem Absenden, wählbare Positionen als Haken, Kostenübernahme als Pflicht.
  const offer = tournament.offer || null;
  const [acceptCosts, setAcceptCosts] = useState(false);
  const [selectedPositions, setSelectedPositions] = useState([]);
  const seats = needsTeam ? Math.max(1, Number(tournament.team_size) || 1) : 1;
  const quote = offer ? previewQuote(offer, { seats, selected: selectedPositions }) : null;
  const set = (key, value) => setPlayerIds((cur) => ({ ...cur, [key]: value }));
  const submit = (e) => {
    e.preventDefault();
    onSubmit({ playerIds, teamId: needsTeam ? teamId : null, acceptCosts, selectedPositions });
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} className="w-full max-w-lg bg-[#121212] border border-white/10 rounded-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-heading text-xl font-black uppercase">Turnier-Anmeldung</h3>
            <p className="text-xs text-white/50 mt-1">
              {needsTeam
                ? "Wähle das Team aus, das du als Leader oder Co-Leader anmelden möchtest."
                : fields.length
                  ? `${gameLabel(game)} benötigt Spieler-IDs${sourceSlug !== game.slug ? ` aus ${game.identity_game_name || "dem Hauptspiel"}` : ""}.`
                  : "Bitte bestätige das Startgeld, dann bist du dabei."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-white/45 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        {needsTeam && (
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Team *</div>
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              required
              className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"
            >
              {manageableTeams.map((team) => <option key={team.id} value={team.id}>[{team.tag}] {team.name}</option>)}
            </select>
            {manageableTeams.length === 0 && (
              <div className="mt-2 text-xs text-[#FF3B30]">Du bist aktuell bei keinem Team als Leader oder Co-Leader eingetragen.</div>
            )}
          </label>
        )}
        {fields.map((field) => (
          <label key={field.key} className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{field.label}{field.required !== false ? " *" : ""}</div>
            <input
              value={playerIds[field.key] || ""}
              onChange={(e) => set(field.key, e.target.value)}
              required={field.required !== false}
              placeholder={field.help_text || field.label}
              className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"
            />
          </label>
        ))}
        {offer && (
          <div className="border border-[#FFD700]/40 rounded-sm p-3 space-y-2" data-testid="tournament-register-costs">
            <div className="text-[11px] uppercase tracking-widest font-bold text-[#FFD700]">Startgeld</div>
            {offer.positions.some((position) => position.optional) && (
              <div className="space-y-1">
                {offer.positions.filter((position) => position.optional).map((position) => (
                  <label key={position.key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={selectedPositions.includes(position.key)} onChange={(e) => setSelectedPositions((current) => (e.target.checked ? [...current, position.key] : current.filter((key) => key !== position.key)))} data-testid={`tournament-offer-option-${position.key}`} />
                    <span>{position.label} <span className="text-white/50">{formatCents(position.amount_cents, offer.currency)} {position.basis === "per_person" ? "je Spieler" : position.basis === "per_team" ? "je Team" : "je Anmeldung"}</span></span>
                  </label>
                ))}
              </div>
            )}
            {quote && !quote.free && (
              <div className="flex items-baseline justify-between gap-3 text-sm" data-testid="tournament-quote">
                <span className="text-white/65">{needsTeam ? `Summe für ein Team mit ${seats} Spielern` : "Summe"}</span>
                <strong className="font-heading text-xl text-white">{formatCents(quote.total_cents, quote.currency)}</strong>
              </div>
            )}
            {needsTeam && offer.positions.some((position) => position.basis === "per_person") && (
              <div className="text-xs text-white/45">Gezählt wird der Roster bei der Freigabe – fehlen noch Spieler, gilt die Teamgröße.</div>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={acceptCosts} onChange={(e) => setAcceptCosts(e.target.checked)} className="mt-1" data-testid="tournament-accept-costs" />
              <span>{needsTeam ? "Ich übernehme das Startgeld für das Team (Rechnung an mich)." : "Ich übernehme das Startgeld (Rechnung an mich)."}<br /><span className="text-xs text-white/45">Bezahlt wird erst mit der verbindlichen Teilnahme; die Rechnung kommt in dein Konto unter „Meine Rechnungen“.</span></span>
            </label>
          </div>
        )}
        {error && <AuthFormAlert id="tournament-registration-error">{error}</AuthFormAlert>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-white/15 text-white/70 rounded-sm text-xs uppercase tracking-wider font-bold">Abbrechen</button>
          <button disabled={loading || (needsTeam && !teamId) || (offer && !acceptCosts)} data-testid="tournament-register-submit" className="px-5 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50">
            {loading ? "Sendet…" : quote && !quote.free ? `Verbindlich anmelden · ${formatCents(quote.total_cents, quote.currency)}` : "Anmelden"}
          </button>
        </div>
      </form>
    </div>
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
