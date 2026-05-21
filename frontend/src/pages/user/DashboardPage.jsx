import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { Trophy, Bell, Crown, Gift, Award, UserCheck, AlertTriangle, Medal, Users } from "lucide-react";

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
      className={`w-20 h-20 md:w-24 md:h-24 shrink-0 overflow-hidden border-2 ${
        isClubMember ? "border-[#FFD700]/70 shadow-[0_0_28px_rgba(255,215,0,0.14)]" : "border-[#29B6E8]/60 shadow-[0_0_28px_rgba(41,182,232,0.12)]"
      } rounded-sm bg-[#0A0A0A] flex items-center justify-center font-heading font-black text-2xl ${
        isClubMember ? "text-[#FFD700]" : "text-[#29B6E8]"
      }`}
    >
      {avatarUrl && !imageFailed ? (
        <img
          src={avatarUrl}
          alt={`${label} Profilbild`}
          className="w-full h-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { user, isClubMember } = useAuth();
  const [matches, setMatches] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [openPrizes, setOpenPrizes] = useState(0);
  const [completeness, setCompleteness] = useState(null);
  const [penaltyCount, setPenaltyCount] = useState(0);

  const load = useCallback(async () => {
    const [m, n, p, c, pen] = await Promise.allSettled([
      api.get("/matches/upcoming"),
      api.get("/notifications/me"),
      api.get("/prizes/me/open-count"),
      api.get("/users/me/profile-completeness"),
      api.get("/penalties/me"),
    ]);
    if (m.status === "fulfilled") setMatches(m.value.data);
    if (n.status === "fulfilled") setNotifications(Array.isArray(n.value.data) ? n.value.data : (n.value.data?.items || []));
    if (p.status === "fulfilled") setOpenPrizes(p.value.data?.count || 0);
    if (c.status === "fulfilled") setCompleteness(c.value.data);
    if (pen.status === "fulfilled") setPenaltyCount(pen.value.data?.count || 0);
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["matches", "prizes", "users", "penalties", "achievements", "membership", "tournaments", "f1", "admin/notifications"]);

  return (
    <PublicLayout>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center gap-4 mb-10">
          <DashboardAvatar user={user} isClubMember={isClubMember} />
          <div>
            <span className={`text-[11px] font-bold uppercase tracking-[0.3em] ${isClubMember ? "text-[#FFD700]" : "text-[#29B6E8]"}`}>{isClubMember ? "VEREINSMITGLIED" : "COMMUNITY"}</span>
            <h1 className="font-heading text-3xl md:text-4xl font-black uppercase">{user?.display_name || user?.username}</h1>
            {isClubMember && user?.membership?.member_number && (
              <div className="text-xs text-white/50 mt-0.5 font-mono">{user.membership.member_number}</div>
            )}
          </div>
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

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 border border-white/10 rounded-sm bg-[#121212] p-5">
            <h2 className="font-heading text-xl font-bold uppercase mb-4 flex items-center gap-2"><Trophy className="w-4 h-4 text-[#29B6E8]" /> Nächste Spiele</h2>
            <div className="space-y-3">
              {matches.length === 0 && <div className="text-sm text-white/40">Keine geplanten Spiele.</div>}
              {matches.map((m) => (
                <Link
                  key={m.id}
                  to={`/matches/${m.id}`}
                  data-testid={`dashboard-match-${m.id}`}
                  className="block border border-white/10 rounded-sm p-3 hover:border-[#29B6E8]/60 transition"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-white">{m.round_name || `Runde ${m.round}`}</div>
                    <StatusBadge status={m.status} />
                  </div>
                  {m.scheduled_at && <div className="text-xs text-white/50 mt-1">{new Date(m.scheduled_at).toLocaleString("de-DE")}</div>}
                </Link>
              ))}
            </div>
          </div>
          <div className="border border-white/10 rounded-sm bg-[#121212] p-5">
            <h2 className="font-heading text-xl font-bold uppercase mb-4 flex items-center gap-2"><Bell className="w-4 h-4 text-[#29B6E8]" /> Benachrichtigungen</h2>
            <div className="space-y-3">
              {notifications.length === 0 && <div className="text-sm text-white/40">Keine Benachrichtigungen.</div>}
              {notifications.map((n) => (
                <div key={n.id} className="border-l-2 border-[#29B6E8]/50 pl-3 text-sm">
                  <div className="text-white">{n.title}</div>
                  <div className="text-white/50 text-xs">{new Date(n.created_at).toLocaleString("de-DE")}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 grid sm:grid-cols-2 md:grid-cols-3 gap-4">
          {openPrizes > 0 && (
            <Link to="/my/prizes" data-testid="dashboard-prizes-cta" className="border border-[#FFD700]/60 hover:border-[#FFD700] rounded-sm p-5 bg-gradient-to-br from-[#FFD700]/15 to-transparent transition relative">
              <span className="absolute top-3 right-3 bg-[#FFD700] text-black text-[10px] font-black px-2 py-0.5 rounded-sm uppercase">{openPrizes} offen</span>
              <div className="text-[11px] uppercase tracking-widest text-[#FFD700] font-bold">Du hast gewonnen!</div>
              <div className="mt-2 font-heading text-lg font-bold flex items-center gap-2"><Award className="w-4 h-4 text-[#FFD700]" /> Meine Gewinne</div>
            </Link>
          )}
          {isClubMember && (
            <Link to="/members/area" data-testid="dashboard-member-area" className="border border-[#FFD700]/40 hover:border-[#FFD700]/80 rounded-sm p-5 bg-gradient-to-br from-[#FFD700]/10 to-transparent transition">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-widest text-[#FFD700] font-bold">Vereinsmitglieder</div>
                <Crown className="w-4 h-4 text-[#FFD700]" />
              </div>
              <div className="mt-2 font-heading text-lg font-bold">Mitgliederbereich</div>
            </Link>
          )}
          {isClubMember && (
            <Link to="/members/benefits" data-testid="dashboard-benefits" className="border border-[#FFD700]/30 hover:border-[#FFD700]/60 rounded-sm p-5 bg-[#121212] transition">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-widest text-[#FFD700] font-bold">Exklusiv</div>
                <Gift className="w-4 h-4 text-[#FFD700]" />
              </div>
              <div className="mt-2 font-heading text-lg font-bold">Mitgliedervorteile</div>
            </Link>
          )}
          <Link to="/profile" data-testid="dashboard-profile-link" className="border border-white/10 hover:border-[#29B6E8]/60 rounded-sm p-5 bg-[#121212] transition">
            <div className="text-[11px] uppercase tracking-widest text-[#29B6E8] font-bold">Profil</div>
            <div className="mt-2 font-heading text-lg font-bold">Einstellungen</div>
          </Link>
          <Link to="/profile?tab=teams" data-testid="dashboard-teams-link" className="border border-[#10B981]/30 hover:border-[#10B981]/70 rounded-sm p-5 bg-[#121212] transition">
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-widest text-[#10B981] font-bold">Teams</div>
              <Users className="w-4 h-4 text-[#10B981]" />
            </div>
            <div className="mt-2 font-heading text-lg font-bold">Teamverwaltung</div>
          </Link>
          <Link to="/profile?tab=achievements" data-testid="dashboard-achievements-link" className="border border-[#A855F7]/30 hover:border-[#A855F7]/70 rounded-sm p-5 bg-[#121212] transition">
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-widest text-[#A855F7] font-bold">Profil</div>
              <Medal className="w-4 h-4 text-[#A855F7]" />
            </div>
            <div className="mt-2 font-heading text-lg font-bold">Achievements</div>
          </Link>
          <Link to="/tournaments" data-testid="dashboard-tournaments-link" className="border border-white/10 hover:border-[#29B6E8]/60 rounded-sm p-5 bg-[#121212] transition">
            <div className="text-[11px] uppercase tracking-widest text-[#29B6E8] font-bold">Turniere</div>
            <div className="mt-2 font-heading text-lg font-bold">Jetzt anmelden</div>
          </Link>
          <Link to="/fastlap" data-testid="dashboard-f1-link" className="border border-white/10 hover:border-[#29B6E8]/60 rounded-sm p-5 bg-[#121212] transition">
            <div className="text-[11px] uppercase tracking-widest text-[#29B6E8] font-bold">Fast Lap</div>
            <div className="mt-2 font-heading text-lg font-bold">Ranglisten</div>
          </Link>
          {!isClubMember && (
            <Link to="/membership/join" data-testid="dashboard-join-cta" className="border border-[#FFD700]/30 hover:border-[#FFD700]/60 rounded-sm p-5 bg-[#121212] transition">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-widest text-[#FFD700] font-bold">Verein</div>
                <Crown className="w-4 h-4 text-[#FFD700]" />
              </div>
              <div className="mt-2 font-heading text-lg font-bold">Mitglied werden</div>
            </Link>
          )}
          <Link to="/privacy-account" data-testid="dashboard-privacy-link" className="border border-white/10 hover:border-[#29B6E8]/60 rounded-sm p-5 bg-[#121212] transition">
            <div className="text-[11px] uppercase tracking-widest text-[#29B6E8] font-bold">DSGVO</div>
            <div className="mt-2 font-heading text-lg font-bold">Meine Daten</div>
          </Link>
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
        </div>
      </div>
    </PublicLayout>
  );
}
