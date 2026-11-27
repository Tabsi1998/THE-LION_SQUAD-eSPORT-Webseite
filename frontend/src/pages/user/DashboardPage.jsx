import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { missingLabels } from "@/lib/profileCompleteness";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { AdventHint } from "@/advent/AdventHint";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { ModerationStandingCard } from "@/components/tls/ModerationStandingCard";
import { AchievementsTile } from "@/components/tls/AchievementsTile";
import { DashboardNotifications } from "./DashboardNotifications";
import { dashboardActions, formatVienna, registrationLabel, seasonLine, splitHomeTimeline, timelineItems } from "@/lib/dashboard";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { Trophy, Crown, Gift, AlertTriangle, UserCheck, CalendarClock, CalendarDays, ClipboardCheck, Shield, ChevronRight, Award, Swords, ListChecks, ScrollText, Star, Users } from "lucide-react";
import { viennaDateTime } from "@/lib/vienna";
import { stationText } from "@/lib/tournamentLabels";
import { FeedbackDialog } from "@/components/tls/FeedbackDialog";
import { YearReviewBanner } from "@/components/tls/YearReviewBanner";
import { dashboardRegistrationKeys, dashboardTeamKeys, noteWebPushRegistrations, offerWebPush } from "@/lib/webPush";
import { noteOwnMatches } from "@/lib/liveQueue";
import { BEREICH, gruppenFuer } from "@/lib/meinBereich";
import { isAnyAdmin } from "@/lib/permissions";
import { BereichListe } from "./meinBereich/BereichNav";

// Das Dashboard ist die persönliche Startseite, wie die App-Startseite seit
// #237 (#256): Kopf, offene Aktionen, nächste Termine, Jahreswertung,
// Benachrichtigungen. Kacheln nur für das, was sonst nirgends direkt steht.
// Die Daten kommen aus /api/mobile/dashboard - derselbe Endpunkt wie in der
// App, damit beide dieselbe Logik haben (_still_relevant, Wiener Zeit).

// Ein Spiel in Klärung (#1134) bleibt sichtbar - beim Spieler als „In Klärung“, bei der Turnierleitung ganz oben.
const OPEN_MATCH_STATUSES = new Set(["ready", "scheduled", "in_progress", "waiting_result", "disputed"]);

function DashboardAvatar({ user, isClubMember }) {
  const [imageFailed, setImageFailed] = useState(false);
  const avatarUrl = user?.avatar_url ? resolveMediaUrl(user.avatar_url) : "";
  const label = user?.display_name || user?.username || "Profil";
  const initials = (label || "TLS").slice(0, 2).toUpperCase();

  useEffect(() => {
    setImageFailed(false);
  }, [avatarUrl]);

  return (
    <div
      className={`tls-type-section w-16 h-16 md:w-20 md:h-20 shrink-0 overflow-hidden border-2 ${
        isClubMember ? "border-honor/70 shadow-[0_0_28px_rgba(255,215,0,0.14)]" : "border-[#29B6E8]/60 shadow-[0_0_28px_rgba(41,182,232,0.12)]"
      } rounded-sm bg-[#0A0A0A] flex items-center justify-center ${
        isClubMember ? "text-honor" : "text-[#29B6E8]"
      }`}
    >
      {avatarUrl && !imageFailed ? (
        <img src={avatarUrl} alt="" className="w-full h-full object-cover" onError={() => setImageFailed(true)} />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}

function Pill({ children, tone = "cyan", testId }) {
  const tones = {
    cyan: "border-[#29B6E8]/50 text-[#29B6E8] bg-[#29B6E8]/10",
    gold: "border-honor/50 text-honor bg-honor/10",
    grey: "border-white/15 text-white/60 bg-white/5",
  };
  return <span data-testid={testId} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border tls-type-label ${tones[tone] || tones.cyan}`}>{children}</span>;
}

function actionIcon(type) {
  // Liga (#2110, #2202): Terminvorschlag beantworten, Aufstellung nachtragen, Kader auffüllen.
  if (type === "match_schedule" || type === "match_reschedule") return CalendarClock;
  if (type === "match_lineup" || type === "squad_short") return Users;
  if (type === "rules_consent") return ScrollText;
  if (String(type || "").includes("checkin")) return ClipboardCheck;
  if (String(type || "").includes("prize")) return Gift;
  if (String(type || "").includes("match")) return Swords;
  return ClipboardCheck;
}

function TimelineRow({ item, live = false }) {
  const status = registrationLabel(item.registrationStatus);
  return (
    <Link
      to={item.href}
      data-testid={`dashboard-timeline-${item.id}`}
      className={`flex flex-wrap items-center gap-3 px-3 py-3 border-b border-white/5 last:border-b-0 transition hover:bg-white/[0.03] ${live ? "bg-[#29B6E8]/5" : ""}`}
    >
      <div className="shrink-0 w-14 text-center">
        <div className="tls-type-label text-quiet">{item.kind === "event" ? "Event" : "Turnier"}</div>
        <div className="tls-type-small text-white/80 mt-0.5">{formatVienna(item.date, { withTime: false })}</div>
      </div>
      {/* Titel und Zeit brechen um (#1155); mit großer Schrift rutschen Status und Pfeil in die nächste Zeile. */}
      <div className="min-w-0 flex-1 basis-32">
        <div className="font-bold tls-type-small text-white break-words">{item.title}</div>
        <div className="tls-type-small text-white/50 break-words">
          {[item.date ? `${formatVienna(item.date)} Uhr` : "", item.detail].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        {live && item.phaseLabel ? <Pill tone="cyan">{item.phaseLabel}</Pill> : null}
        {status ? <Pill tone={["pending", "waitlist", "waitlisted"].includes(item.registrationStatus) ? "grey" : "cyan"}>{status}</Pill> : null}
      </div>
      <ChevronRight className="w-4 h-4 text-white/30 shrink-0" />
    </Link>
  );
}

export default function DashboardPage() {
  const { user, isClubMember, isModerator } = useAuth();
  const userId = user?.id || null;
  const [dashboard, setDashboard] = useState(null);
  const [openPrizes, setOpenPrizes] = useState(0);
  const [completeness, setCompleteness] = useState(null);
  const [penaltyCount, setPenaltyCount] = useState(0);
  // Rückmeldung (#1196): „Wie war …?“ als Zeile unter den offenen Aktionen; die Meldung führt mit ?bewerten=… hierher.
  const [searchParams, setSearchParams] = useSearchParams();
  const [feedbackTarget, setFeedbackTarget] = useState(() => searchParams.get("bewerten") || null);
  const closeFeedback = useCallback(() => {
    setFeedbackTarget(null);
    if (searchParams.get("bewerten")) {
      const next = new URLSearchParams(searchParams);
      next.delete("bewerten");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const load = useCallback(async () => {
    const [home, p, c, pen] = await Promise.allSettled([
      api.get("/mobile/dashboard"),
      api.get("/prizes/me/open-count"),
      api.get("/users/me/profile-completeness"),
      api.get("/penalties/me"),
    ]);
    if (home.status === "fulfilled") {
      const data = home.value.data && typeof home.value.data === "object" ? home.value.data : null;
      setDashboard(data);
      // Turniertag (#1169): Läuft ein eigenes Spiel oder ist es aufgerufen, pausiert die Saison-Deko überall.
      if (Array.isArray(data?.me?.matches)) noteOwnMatches(data.me.matches, "dashboard");
      // Neu angemeldet - etwa durchs Team (#1208): jetzt die Frage nach Browser-Benachrichtigungen. Die erste Übersicht
      // nach dem Login ist nur der Ausgangsstand.
      const reason = data ? noteWebPushRegistrations(userId, dashboardRegistrationKeys(data.me), { teamKeys: dashboardTeamKeys(data.me) }) : null;
      if (reason) void offerWebPush(undefined, { reason });
    }
    if (p.status === "fulfilled") setOpenPrizes(p.value.data?.count || 0);
    if (c.status === "fulfilled") setCompleteness(c.value.data);
    if (pen.status === "fulfilled") setPenaltyCount(pen.value.data?.count || 0);
  }, [userId]);
  useEffect(() => {
    const refreshVisible = () => {
      // `load` wirft nicht (allSettled): was nicht kam, behält seinen letzten Stand.
      if (typeof document === "undefined" || !document.hidden) load();
    };
    refreshVisible();
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [load]);
  useLiveRefresh(load, ["matches", "prizes", "users", "penalties", "achievements", "membership", "tournaments", "events", "f1"], { fallbackMs: 10000 });

  const me = dashboard?.me || {};
  const matches = useMemo(() => (Array.isArray(me.matches) ? me.matches : []).filter((match) => OPEN_MATCH_STATUSES.has(String(match.status || ""))), [me.matches]);
  const staffMatches = useMemo(() => {
    const ownIds = new Set(matches.map((match) => match.id));
    return (Array.isArray(me.staff_matches) ? me.staff_matches : []).filter((match) => !ownIds.has(match.id) && OPEN_MATCH_STATUSES.has(String(match.status || "")));
  }, [matches, me.staff_matches]);
  const timeline = useMemo(() => splitHomeTimeline(timelineItems(dashboard)), [dashboard]);
  const actions = useMemo(() => dashboardActions(dashboard, { openPrizes }), [dashboard, openPrizes]);
  const season = dashboard?.season || null;


  const hasDates = timeline.live.length + timeline.next.length > 0;

  return (
    <PublicLayout>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12">
        <div className="flex flex-wrap items-center gap-4 mb-8" data-testid="dashboard-header">
          <DashboardAvatar user={user} isClubMember={isClubMember} />
          {/* Mit großer Schrift rutscht der Name unter das Bild, statt zu einem Strich zusammengedrückt zu werden (#1155). */}
          <div className="min-w-0 flex-1 basis-40">
            {/* Der Name bricht um (#1155, wie im Profilkopf): höchstens zwei Zeilen statt „…“ bei großer Schrift. */}
            <h1 className="tls-head-name tls-type-title">{user?.display_name || user?.username}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {isClubMember ? <Pill tone="gold" testId="dashboard-pill-member"><Crown className="w-3 h-3" /> Vereinsmitglied</Pill> : <Pill tone="grey" testId="dashboard-pill-community">Community</Pill>}
              {isModerator ? <Pill tone="cyan" testId="dashboard-pill-staff"><Shield className="w-3 h-3" /> Staff</Pill> : null}
              {isClubMember && user?.membership?.member_number ? <span className="tls-type-small text-white/50 font-mono">{user.membership.member_number}</span> : null}
              {!isClubMember ? <Link to="/membership/join" data-testid="dashboard-join-cta" className="tls-type-small font-bold text-honor hover:underline">Mitglied werden</Link> : null}
            </div>
          </div>
          {/* „Mein Bereich“ (#2059): Profil, Mitgliedschaft, Rechnungen, Konto und Datenschutz an einem Ort - unten als Liste. */}
          <Link to={BEREICH} data-testid="dashboard-mein-bereich" className="tls-btn tls-btn--secondary shrink-0 inline-flex min-h-11 items-center gap-1.5 px-4 py-2 rounded-sm tls-type-label">
            <ListChecks className="w-3.5 h-3.5" aria-hidden="true" /> Mein Bereich
          </Link>
        </div>

        <AdventHint />
        {/* Jahresrückblick (#1195): ab Mitte Dezember, nur mit Aktivität im Jahr. */}
        <YearReviewBanner />

        {completeness && completeness.score < 100 && (
          <div className="mb-8 border border-[#A855F7]/30 bg-gradient-to-r from-[#A855F7]/10 via-transparent to-transparent rounded-sm p-5 flex flex-wrap items-center gap-4" data-testid="profile-completeness-banner">
            <div className="relative w-14 h-14 shrink-0">
              <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                <circle cx="18" cy="18" r="16" fill="none" stroke="#A855F7" strokeWidth="3" strokeDasharray={`${completeness.score} 100`} pathLength="100" strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="tls-type-small tls-type-num">{completeness.score}%</span>
              </div>
            </div>
            <div className="flex-1 min-w-0 basis-48">
              <div className="flex items-center gap-2 tls-type-label text-[#A855F7]">
                <UserCheck className="w-3.5 h-3.5" /> Profil-Pflege
              </div>
              <h3 className="tls-type-card mt-0.5">Profil zu {completeness.score}% komplett</h3>
              {missingLabels(completeness.missing).length > 0 && (
                <p className="tls-type-small text-white/55 mt-1" data-testid="profile-completeness-missing">Fehlt: <span className="text-white/75">{missingLabels(completeness.missing, 4).join(", ")}{missingLabels(completeness.missing).length > 4 ? "…" : ""}</span></p>
              )}
            </div>
            <Link to={`${BEREICH}/profil`} data-testid="profile-completeness-cta" className="inline-flex min-h-11 items-center px-4 py-2 border border-[#A855F7]/40 text-[#A855F7] hover:bg-[#A855F7]/10 rounded-sm tls-type-label">Vervoll&shy;ständigen</Link>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 space-y-6 min-w-0">
            {/* Nur, wenn die Moderation etwas festgehalten hat (#416) - sonst bleibt das Dashboard, wie es ist. */}
            <ModerationStandingCard compact />
            {actions.length > 0 && (
              <section className="border border-brand/30 rounded-sm bg-[#121212] p-5" data-testid="dashboard-actions">
                <h2 className="tls-type-section mb-3 flex items-center gap-2"><ClipboardCheck className="w-4 h-4 text-brand" /> Offene Aktionen</h2>
                <div className="border border-white/5 rounded-sm bg-[#0F0F10] overflow-hidden">
                  {actions.map((action) => {
                    const Icon = actionIcon(action.type);
                    if (action.type === "feedback") {
                      return (
                        <button key={action.id} type="button" onClick={() => setFeedbackTarget(action.target_id)} data-testid={`dashboard-action-${action.id}`} className="w-full text-left flex items-center gap-3 px-3 py-3 border-b border-white/5 last:border-b-0 hover:bg-white/[0.03] transition">
                          <span className="w-9 h-9 rounded-sm border border-brand/40 bg-brand/10 text-brand inline-flex items-center justify-center shrink-0"><Star className="w-4 h-4" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-bold tls-type-small text-white">{action.label}</span>
                            {action.detail ? <span className="block tls-type-small text-white/50 break-words">{action.detail}</span> : null}
                          </span>
                          <ChevronRight className="w-4 h-4 text-white/30 shrink-0" />
                        </button>
                      );
                    }
                    return (
                      <Link key={action.id} to={action.href || "/dashboard"} data-testid={`dashboard-action-${action.id}`} className="flex items-center gap-3 px-3 py-3 border-b border-white/5 last:border-b-0 hover:bg-white/[0.03] transition">
                        <span className="w-9 h-9 rounded-sm border border-brand/40 bg-brand/10 text-brand inline-flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-bold tls-type-small text-white">{action.label}</span>
                          {action.detail ? <span className="block tls-type-small text-white/50 break-words">{action.detail}</span> : null}
                        </span>
                        <ChevronRight className="w-4 h-4 text-white/30 shrink-0" />
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="dashboard-timeline">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-3">
                <h2 className="tls-type-section flex items-center gap-2"><CalendarDays className="w-4 h-4 text-[#29B6E8]" /> Nächste Termine</h2>
                {hasDates ? (
                  <div className="flex items-center gap-3 tls-type-label">
                    <Link to="/tournaments" className="tls-hit text-[#29B6E8] hover:underline">Turniere</Link>
                    <Link to="/events" className="tls-hit text-[#29B6E8] hover:underline">Events</Link>
                  </div>
                ) : null}
              </div>
              {hasDates ? (
                <div className="border border-white/5 rounded-sm bg-[#0F0F10] overflow-hidden">
                  {timeline.live.map((item) => <TimelineRow key={`live-${item.kind}-${item.id}`} item={item} live />)}
                  {timeline.next.map((item) => <TimelineRow key={`${item.kind}-${item.id}`} item={item} />)}
                </div>
              ) : (
                <div className="tls-type-small text-white/50">
                  Keine Termine – <Link to="/events" className="text-[#29B6E8] hover:underline">zu den Events</Link> oder <Link to="/tournaments" className="text-[#29B6E8] hover:underline">zu den Turnieren</Link>.
                </div>
              )}
              {timeline.moreCount > 0 ? <div className="mt-2 tls-type-small text-quiet">{timeline.moreCount} weitere unter Turniere und Events.</div> : null}
            </section>

            {matches.length > 0 && (
              <section className="border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="dashboard-matches">
                <h2 className="tls-type-section mb-4 flex items-center gap-2"><Trophy className="w-4 h-4 text-[#29B6E8]" /> Meine aktiven Matches</h2>
                <div className="space-y-3">
                  {matches.map((m) => <DashboardMatchCard key={m.id} match={m} testId={`dashboard-match-${m.id}`} />)}
                </div>
              </section>
            )}

            {staffMatches.length > 0 && (
              <section className="border border-brand/25 rounded-sm bg-[#121212] p-5" data-testid="dashboard-staff-matches">
                <h2 className="tls-type-section mb-4 flex items-center gap-2"><Trophy className="w-4 h-4 text-brand" /> Turnierleitung · Ergebnisse</h2>
                <div className="grid md:grid-cols-2 gap-3">
                  {staffMatches.map((match) => <DashboardMatchCard key={match.id} match={match} staff />)}
                </div>
              </section>
            )}
          </div>

          <div className="space-y-6 min-w-0">
            {season ? (
              <Link to={`/seasons/${season.slug || "current"}`} data-testid="dashboard-season" className="block border border-honor/30 hover:border-honor/70 rounded-sm bg-gradient-to-br from-honor/10 to-transparent p-5 transition">
                <div className="flex items-center justify-between">
                  <div className="tls-type-label text-honor">Jahreswertung</div>
                  <Award className="w-4 h-4 text-honor" />
                </div>
                <div className="mt-2 tls-type-card">{season.name || "Jahreswertung"}</div>
                <div className="mt-1 tls-type-small text-white/70">{seasonLine(season)}</div>
                {season.my_rank && season.leader?.display_name && season.my_rank > 1 ? (
                  <div className="mt-1 tls-type-small text-white/45">Vorn: {season.leader.display_name} · {season.leader.points ?? 0} Punkte</div>
                ) : null}
              </Link>
            ) : null}

            {/* Benachrichtigungen (#255): eigener Abruf über den Baustein von Glocke und Seite - Fehler statt leer (#984), abgelehntes „gelesen“ wird zurückgenommen (#987). */}
            <DashboardNotifications />
          </div>
        </div>

        {/* Mein Bereich (#2059): jede Gruppe ein Tipp weit - von hier aus ist jede Funktion höchstens zwei Klicks entfernt. */}
        <section className="mt-8" aria-labelledby="dashboard-mein-bereich-title" data-testid="dashboard-bereich">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 id="dashboard-mein-bereich-title" className="tls-type-section">Mein Bereich</h2>
          </div>
          <BereichListe gruppen={gruppenFuer({ mitglied: Boolean(user?.is_club_member) || isAnyAdmin(user) }).filter((item) => item.key !== "start")} testId="dashboard-bereich-liste" />
        </section>

        <div className="mt-8 grid sm:grid-cols-2 md:grid-cols-3 gap-4" data-testid="dashboard-tiles">
          <AchievementsTile />
          {/* Mitgliedervorteile stehen im Mitgliederbereich (#1150) - keine zweite Kachel hier. */}
          <Link
            to={`${BEREICH}/rechnungen?tab=strafen`}
            data-testid="dashboard-penalties-link"
            className={`border rounded-sm p-5 transition ${
              penaltyCount > 0
                ? "border-warn/50 hover:border-warn bg-gradient-to-br from-warn/10 to-transparent"
                : "border-white/10 hover:border-white/30 bg-[#121212]"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className={`tls-type-label ${penaltyCount > 0 ? "text-warn" : "text-white/50"}`}>
                Transparenz
              </div>
              <AlertTriangle className={`w-4 h-4 ${penaltyCount > 0 ? "text-warn" : "text-white/40"}`} />
            </div>
            <div className="mt-2 tls-type-card">
              Meine Strafen {penaltyCount > 0 && <span className="text-warn">({penaltyCount})</span>}
            </div>
          </Link>
        </div>
      </div>
      {feedbackTarget ? <FeedbackDialog target={feedbackTarget} onClose={closeFeedback} onDone={() => { closeFeedback(); load(); }} /> : null}
    </PublicLayout>
  );
}

function DashboardMatchCard({ match, staff = false, testId }) {
  const details = [
    match.opponent_name || (match.participant_names || []).join(" · "),
    match.round_name || (match.round ? `Runde ${match.round}` : ""),
    // Station im Klartext (#1220) - nie doppelt „Station“.
    stationText(match),
  ].filter(Boolean);
  const attention = Boolean(match.needs_result);
  // In Klärung (#1134): bei der Turnierleitung rot und ganz oben, beim Spieler „Wartet auf Entscheidung“.
  const disputed = Boolean(match.disputed || match.status === "disputed");
  const action = disputed
    ? (staff ? "Dispute prüfen" : "Wartet auf Entscheidung")
    : staff && match.can_submit_result
      ? "Ergebnis erfassen"
      : attention
        ? "Ergebnis öffnen"
        : "Match öffnen";
  const tone = disputed
    ? "border-warn/50 bg-warn/5 hover:border-warn"
    : attention ? "border-warn/45 bg-warn/5 hover:border-warn" : "border-white/10 hover:border-[#29B6E8]/60";
  return (
    <Link
      to={`/matches/${match.id}`}
      data-testid={testId}
      data-disputed={disputed ? "1" : undefined}
      className={`block border rounded-sm p-3 transition ${tone}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="tls-type-small text-white font-bold">{match.tournament_title || "Turniermatch"}</div>
        <StatusBadge status={match.status} />
      </div>
      {details.length > 0 && <div className="tls-type-small text-white/50 mt-1">{details.join(" · ")}</div>}
      {match.scheduled_at && <div className="tls-type-small text-white/45 mt-1">{viennaDateTime(match.scheduled_at)}</div>}
      <div className={`mt-2 tls-type-label ${disputed ? "text-[#FF6B60]" : attention ? "text-warn" : "text-[#29B6E8]"}`}>{action}</div>
    </Link>
  );
}
