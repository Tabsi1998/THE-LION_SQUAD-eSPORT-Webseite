import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { ADMIN_AREAS, hasArea, isAnyAdmin } from "@/lib/permissions";

// Rechte nach Bereichen (#287): `requireArea` verlangt einen der genannten
// Bereiche (Turnierleitung, Redaktion, Vereinsverwaltung, System, Moderation).
// `requireAdmin` heißt „irgendein Adminbereich“, `requireClubAdmin` bleibt als
// Kurzform für System. Zwei-Faktor ist Pflicht für alles außer Moderation.
const MFA_AREAS = new Set(ADMIN_AREAS);

export function ProtectedRoute({ children, requireArea = null, requireAdmin = false, requireClubAdmin = false, requireMember = false, requireModerator = false }) {
  const { user } = useAuth();
  const loc = useLocation();
  const wantedAreas = requireArea ? [requireArea].flat() : requireClubAdmin ? ["system"] : requireAdmin ? ADMIN_AREAS : [];
  if (user === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A]">
        <div className="font-display text-[#29B6E8] tracking-widest text-sm">LADE …</div>
      </div>
    );
  }
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (user.consent_required && loc.pathname !== "/consent") {
    return <Navigate to="/consent" replace />;
  }
  if (wantedAreas.length && !hasArea(user, ...wantedAreas)) {
    return <Navigate to="/403" replace state={{ areas: wantedAreas, from: loc.pathname }} />;
  }
  if (wantedAreas.some((area) => MFA_AREAS.has(area)) && (!user.mfa_enabled || !user.auth_mfa_verified)) {
    return <Navigate to="/profile?tab=basic&mfa=required" replace />;
  }
  if (requireModerator && !user.is_tournament_staff && !hasArea(user, "moderation") && !isAnyAdmin(user)) {
    return <Navigate to="/403" replace state={{ areas: ["moderation"], from: loc.pathname }} />;
  }
  if (requireMember && !user.is_club_member && !isAnyAdmin(user)) {
    return <Navigate to="/membership/join" replace />;
  }
  return children;
}
