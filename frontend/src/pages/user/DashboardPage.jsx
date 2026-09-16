import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { NotificationRow } from "@/components/tls/NotificationRow";
import { bundleNotifications } from "@/lib/notifications";
import { dashboardActions, formatVienna, registrationLabel, seasonLine, splitHomeTimeline, timelineItems } from "@/lib/dashboard";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { Trophy, Bell, Crown, Gift, AlertTriangle, UserCheck, CalendarDays, ClipboardCheck, Shield, ChevronRight, Award, Swords, Settings } from "lucide-react";

// Das Dashboard ist die persönliche Startseite, wie die App-Startseite seit
// #237 (#256): Kopf, offene Aktionen, nächste Termine, Jahreswertung,
// Benachrichtigungen. Kacheln nur für das, was sonst nirgends direkt steht.
// Die Daten kommen aus /api/mobile/dashboard - derselbe Endpunkt wie in der
// App, damit beide dieselbe Logik haben (_still_relevant, Wiener Zeit).

const OPEN_MATCH_STATUSES = new Set(["ready", "scheduled", "in_progress", "waiting_result"]);

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
      className={`w-16 h-16 md:w-20 md:h-20 shrink-0 overflow-hidden border-2 ${
        isClubMember ? "border-[#FFD700]/70 shadow-[0_0_28px_rgba(255,215,0,0.14)]" : "border-[#29B6E8]/60 shadow-[0_0_28px_rgba(41,182,232,0.12)]"
      } rounded-sm bg-[#0A0A0A] flex items-center justify-center font-heading font-black text-2xl ${
        isClubMember ? "text-[#FFD700]" : "text-[#29B6E8]"
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
    gold: "border-[#FFD700]/50 text-[#FFD700] bg-[#FFD700]/10",
    grey: "border-white/15 text-white/60 bg-white/5",
  };
  return <span data-testid={testId} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border text-[10px] font-bold uppercase tracking-widest ${tones[tone] || tones.cyan}`}>{children}</span>;
}

function actionIcon(type) {
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
      className={`flex items-center gap-3 px-3 py-3 border-b border-white/5 last:border-b-0 transition hover:bg-white/[0.03] ${live ? "bg-[#29B6E8]/5" : ""}`}
    >
      <div className="shrink-0 w-14 text-center">
        <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{item.kind === "event" ? "Event" : "Turnier"}</div>
        <div className="text-xs text-white/80 mt-0.5">{formatVienna(item.date, { withTime: false })}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-bold text-sm text-white truncate">{item.title}</div>
        <div className="text-xs text-white/50 truncate">
          {[item.date ? `${formatVienna(item.date)} Uhr` : "", item.detail].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        {live && item.phaseLabel ? <Pill tone="cyan">{item.phaseLabel}</Pill> : null}
        {status ? <Pill tone={item.registrationStatus === "pending" ? "grey" : "gold"}>{status}</Pill> : null}
      </div>
      <ChevronRight className="w-4 h-4 text-white/30 shrink-0" />
    </Link>
  );
}

export default function DashboardPage() {
  const { user, isClubMember, isModerator } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [openPrizes, setOpenPrizes] = useState(0);
  const [completeness, setCompleteness] = useState(null);
  const [penaltyCount, setPenaltyCount] = useState(0);

  const load = useCallback(async () => {
    const [home, n, p, c, pen] = await Promise.allSettled([
      api.get("/mobile/dashboard"),
      api.get("/notifications/me"),
      api.get("/prizes/me/open-count"),
      api.get("/users/me/profile-completeness"),
      api.get("/penalties/me"),
    ]);
    if (home.status === "fulfilled") setDashboard(home.value.data && typeof home.value.data === "object" ? home.value.data : null);
    if (n.status === "fulfilled") setNotifications(Array.isArray(n.value.data) ? n.value.data : (n.value.data?.items || []));
    if (p.status === "fulfilled") setOpenPrizes(p.value.data?.count || 0);
    if (c.status === "fulfilled") setCompleteness(c.value.data);
    if (pen.status === "fulfilled") setPenaltyCount(pen.value.data?.count || 0);
  }, []);
  useEffect(() => {
    const refreshVisible = () => {
      if (typeof document === "undefined" || !document.hidden) load().catch(() => {});
    };
    refreshVisible();
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [load]);
  useLiveRefresh(load, ["matches", "prizes", "users", "penalties", "achievements", "membership", "tournaments", "events", "f1", "admin/notifications"], { fallbackMs: 10000 });

  const me = dashboard?.me || {};
  const matches = useMemo(() => (Array.isArray(me.matches) ? me.matches : []).filter((match) => OPEN_MATCH_STATUSES.has(String(match.status || ""))), [me.matches]);
  const staffMatches = useMemo(() => {
    const ownIds = new Set(matches.map((match) => match.id));
    return (Array.isArray(me.staff_matches) ? me.staff_matches : []).filter((match) => !ownIds.has(match.id) && OPEN_MATCH_STATUSES.has(String(match.status || "")));
  }, [matches, me.staff_matches]);
  const timeline = useMemo(() => splitHomeTimeline(timelineItems(dashboard)), [dashboard]);
  const actions = useMemo(() => dashboardActions(dashboard, { openPrizes }), [dashboard, openPrizes]);
  const season = dashboard?.season || null;

  // Die fünf neuesten, gebündelt und anklickbar (#255); „Alle N anzeigen“
  // führt auf die Benachrichtigungsseite. Ein Klick markiert das Bündel als
  // gelesen, die Zeile selbst führt ans Ziel.
  const notificationBundles = useMemo(() => bundleNotifications(notifications).slice(0, 5), [notifications]);
  const openNotification = useCallback(async (bundle) => {
    const ids = (bundle.ids || []).filter((id) => notifications.some((row) => row.id === id && !row.read));
    if (!ids.length) return;
    setNotifications((rows) => rows.map((row) => (ids.includes(row.id) ? { ...row, read: true } : row)));
    await Promise.allSettled(ids.map((id) => api.post(`/admin/notifications/${id}/read`)));
  }, [notifications]);

  const hasDates = timeline.live.length + timeline.next.length > 0;

  return (
    <PublicLayout>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12">
        <div className="flex items-center gap-4 mb-8" data-testid="dashboard-header">
          <DashboardAvatar user={user} isClubMember={isClubMember} />
          <div className="min-w-0 flex-1">
            <h1 className="font-heading text-2xl md:text-4xl font-black uppercase truncate">{user?.display_name || user?.username}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {isClubMember ? <Pill tone="gold" testId="dashboard-pill-member"><Crown className="w-3 h-3" /> Vereinsmitglied</Pill> : <Pill tone="grey" testId="dashboard-pill-community">Community</Pill>}
              {isModerator ? <Pill tone="cyan" testId="dashboard-pill-staff"><Shield className="w-3 h-3" /> Staff</Pill> : null}
              {isClubMember && user?.membership?.member_number ? <span className="text-xs text-white/50 font-mono">{user.membership.member_number}</span> : null}
              {!isClubMember ? <Link to="/membership/join" data-testid="dashboard-join-cta" className="text-xs font-bold text-[#FFD700] hover:underline">Mitglied werden</Link> : null}
            </div>
          </div>
          <Link to="/profile" data-testid="dashboard-edit-profile" aria-label="Profil bearbeiten" title="Profil bearbeiten" className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 border border-white/15 text-white/70 hover:text-[#29B6E8] hover:border-[#29B6E8]/40 rounded-sm text-[11px] font-bold uppercase tracking-wider transition">
            <Settings className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Profil bearbeiten</span>
          </Link>
        </div>

        {completeness && completeness.score < 100 && (
          <div className="mb-8 border border-[#A855F7]/30 bg-gradient-to-r from-[#A855F7]/10 via-transparent to-transparent rounded-sm p-5 flex items-center gap-4" data-testid="profile-completeness-banner">
            <div className="relative w-14 h-14 shrink-0">
              <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                <circle cx="18" cy="18" r="16" fill="none" stroke="#A855F7" strokeWidth="3" strokeDasharray={`${completeness.score} 100`} pathLength="100" strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="font-heading font-black text-sm">{completeness.score}%</span>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.3em] text-[#A855F7]">
                <UserCheck className="w-3.5 h-3.5" /> Profil-Pflege
              </div>
              <h3 className="font-heading text-lg md:text-xl font-bold uppercase mt-0.5">Profil zu {completeness.score}% komplett</h3>
              {completeness.missing?.length > 0 && (
                <p className="text-xs text-white/55 mt-1">Fehlt: <span className="text-white/75">{completeness.missing.slice(0, 4).join(", ")}{completeness.missing.length > 4 ? "…" : ""}</span></p>
              )}
            </div>
            <Link to="/profile" data-testid="profile-completeness-cta" className="px-4 py-2 border border-[#A855F7]/40 text-[#A855F7] hover:bg-[#A855F7]/10 rounded-sm text-xs font-bold uppercase tracking-wider whitespace-nowrap">Vervollständigen</Link>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 space-y-6 min-w-0">
            {actions.length > 0 && (
              <section className="border border-[#FFD700]/30 rounded-sm bg-[#121212] p-5" data-testid="dashboard-actions">
                <h2 className="font-heading text-xl font-bold uppercase mb-3 flex items-center gap-2"><ClipboardCheck className="w-4 h-4 text-[#FFD700]" /> Offene Aktionen</h2>
                <div className="border border-white/5 rounded-sm bg-[#0F0F10] overflow-hidden">
                  {actions.map((action) => {
                    const Icon = actionIcon(action.type);
                    return (
                      <Link key={action.id} to={action.href || "/dashboard"} data-testid={`dashboard-action-${action.id}`} className="flex items-center gap-3 px-3 py-3 border-b border-white/5 last:border-b-0 hover:bg-white/[0.03] transition">
                        <span className="w-9 h-9 rounded-sm border border-[#FFD700]/40 bg-[#FFD700]/10 text-[#FFD700] inline-flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-bold text-sm text-white">{action.label}</span>
                          {action.detail ? <span className="block text-xs text-white/50 truncate">{action.detail}</span> : null}
                        </span>
                        <ChevronRight className="w-4 h-4 text-white/30 shrink-0" />
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="dashboard-timeline">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="font-heading text-xl font-bold uppercase flex items-center gap-2"><CalendarDays className="w-4 h-4 text-[#29B6E8]" /> Nächste Termine</h2>
                {hasDates ? (
                  <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-wider">
                    <Link to="/tournaments" className="text-[#29B6E8] hover:underline">Turniere</Link>
                    <Link to="/events" className="text-[#29B6E8] hover:underline">Events</Link>
                  </div>
                ) : null}
              </div>
              {hasDates ? (
                <div className="border border-white/5 rounded-sm bg-[#0F0F10] overflow-hidden">
                  {timeline.live.map((item) => <TimelineRow key={`live-${item.kind}-${item.id}`} item={item} live />)}
                  {timeline.next.map((item) => <TimelineRow key={`${item.kind}-${item.id}`} item={item} />)}
                </div>
              ) : (
                <div className="text-sm text-white/50">
                  Keine Termine – <Link to="/events" className="text-[#29B6E8] hover:underline">zu den Events</Link> oder <Link to="/tournaments" className="text-[#29B6E8] hover:underline">zu den Turnieren</Link>.
                </div>
              )}
              {timeline.moreCount > 0 ? <div className="mt-2 text-xs text-white/40">{timeline.moreCount} weitere unter Turniere und Events.</div> : null}
            </section>

            {matches.length > 0 && (
              <section className="border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="dashboard-matches">
                <h2 className="font-heading text-xl font-bold uppercase mb-4 flex items-center gap-2"><Trophy className="w-4 h-4 text-[#29B6E8]" /> Meine aktiven Matches</h2>
                <div className="space-y-3">
                  {matches.map((m) => <DashboardMatchCard key={m.id} match={m} testId={`dashboard-match-${m.id}`} />)}
                </div>
              </section>
            )}

            {staffMatches.length > 0 && (
              <section className="border border-[#FFD700]/25 rounded-sm bg-[#121212] p-5" data-testid="dashboard-staff-matches">
                <h2 className="font-heading text-xl font-bold uppercase mb-4 flex items-center gap-2"><Trophy className="w-4 h-4 text-[#FFD700]" /> Turnierleitung · Ergebnisse</h2>
                <div className="grid md:grid-cols-2 gap-3">
                  {staffMatches.map((match) => <DashboardMatchCard key={match.id} match={match} staff />)}
                </div>
              </section>
            )}
          </div>

          <div className="space-y-6 min-w-0">
            {season ? (
              <Link to={`/seasons/${season.slug || "current"}`} data-testid="dashboard-season" className="block border border-[#FFD700]/30 hover:border-[#FFD700]/70 rounded-sm bg-gradient-to-br from-[#FFD700]/10 to-transparent p-5 transition">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] uppercase tracking-widest text-[#FFD700] font-bold">Jahreswertung</div>
                  <Award className="w-4 h-4 text-[#FFD700]" />
                </div>
                <div className="mt-2 font-heading text-lg font-bold">{season.name || "Jahreswertung"}</div>
                <div className="mt-1 text-sm text-white/70">{seasonLine(season)}</div>
                {season.my_rank && season.leader?.display_name && season.my_rank > 1 ? (
                  <div className="mt-1 text-xs text-white/45">Vorn: {season.leader.display_name} · {season.leader.points ?? 0} Punkte</div>
                ) : null}
              </Link>
            ) : null}

            <div className="border border-white/10 rounded-sm bg-[#121212] p-5 min-w-0" data-testid="dashboard-notifications">
              <h2 className="font-heading text-xl font-bold uppercase mb-4 flex items-center gap-2"><Bell className="w-4 h-4 text-[#29B6E8]" /> Benachrichtigungen</h2>
              <div id="dashboard-notification-list" className="-mx-2 border border-white/5 rounded-sm bg-[#0F0F10] overflow-hidden">
                {notifications.length === 0 && <div className="p-3 text-sm text-white/40">Keine Benachrichtigungen.</div>}
                {notificationBundles.map((bundle) => (
                  <NotificationRow key={bundle.id} bundle={bundle} onOpen={openNotification} compact testIdPrefix="dashboard-notification" />
                ))}
              </div>
              {notifications.length > notificationBundles.length && (
                <Link to="/notifications" data-testid="dashboard-notifications-all" className="mt-4 min-h-11 w-full inline-flex items-center justify-center border border-[#29B6E8]/40 rounded-sm px-3 py-2 text-sm font-bold text-[#29B6E8] hover:bg-[#29B6E8]/10">
                  {`Alle ${notifications.length} anzeigen`}
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 grid sm:grid-cols-2 md:grid-cols-3 gap-4" data-testid="dashboard-tiles">
          {isClubMember && (
            <Link to="/members/benefits" data-testid="dashboard-benefits" className="border border-[#FFD700]/30 hover:border-[#FFD700]/60 rounded-sm p-5 bg-[#121212] transition">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-widest text-[#FFD700] font-bold">Exklusiv</div>
                <Gift className="w-4 h-4 text-[#FFD700]" />
              </div>
              <div className="mt-2 font-heading text-lg font-bold">Mitgliedervorteile</div>
            </Link>
          )}
          <Link
            to="/my/penalties"
            data-testid="dashboard-penalties-link"
            className={`border rounded-sm p-5 transition ${
              penaltyCount > 0
                ? "border-[#FF3B30]/50 hover:border-[#FF3B30] bg-gradient-to-br from-[#FF3B30]/10 to-transparent"
                : "border-white/10 hover:border-white/30 bg-[#121212]"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className={`text-[11px] uppercase tracking-widest font-bold ${penaltyCount > 0 ? "text-[#FF3B30]" : "text-white/50"}`}>
                Transparenz
              </div>
              <AlertTriangle className={`w-4 h-4 ${penaltyCount > 0 ? "text-[#FF3B30]" : "text-white/40"}`} />
            </div>
            <div className="mt-2 font-heading text-lg font-bold">
              Meine Strafen {penaltyCount > 0 && <span className="text-[#FF3B30]">({penaltyCount})</span>}
            </div>
          </Link>
          <Link to="/privacy-account" data-testid="dashboard-privacy-link" className="border border-white/10 hover:border-[#29B6E8]/60 rounded-sm p-5 bg-[#121212] transition">
            <div className="text-[11px] uppercase tracking-widest text-[#29B6E8] font-bold">DSGVO</div>
            <div className="mt-2 font-heading text-lg font-bold">Meine Daten</div>
          </Link>
        </div>
      </div>
    </PublicLayout>
  );
}

function DashboardMatchCard({ match, staff = false, testId }) {
  const details = [
    match.opponent_name || (match.participant_names || []).join(" · "),
    match.round_name || (match.round ? `Runde ${match.round}` : ""),
    match.station_label ? `Station ${match.station_label}` : "",
  ].filter(Boolean);
  const attention = Boolean(match.needs_result);
  const action = staff && match.can_submit_result
    ? "Ergebnis erfassen"
    : attention
      ? "Ergebnis öffnen"
      : "Match öffnen";
  return (
    <Link
      to={`/matches/${match.id}`}
      data-testid={testId}
      className={`block border rounded-sm p-3 transition ${attention ? "border-[#FFD700]/45 bg-[#FFD700]/5 hover:border-[#FFD700]" : "border-white/10 hover:border-[#29B6E8]/60"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-white font-bold">{match.tournament_title || "Turniermatch"}</div>
        <StatusBadge status={match.status} />
      </div>
      {details.length > 0 && <div className="text-xs text-white/50 mt-1">{details.join(" · ")}</div>}
      {match.scheduled_at && <div className="text-xs text-white/45 mt-1">{new Date(match.scheduled_at).toLocaleString("de-DE")}</div>}
      <div className={`mt-2 text-[10px] font-bold uppercase tracking-wider ${attention ? "text-[#FFD700]" : "text-[#29B6E8]"}`}>{action}</div>
    </Link>
  );
}
