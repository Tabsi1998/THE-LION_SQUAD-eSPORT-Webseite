import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { ADMIN_AREAS, hasArea, isAnyAdmin } from "@/lib/permissions";
import { SkeletonDetailHeader } from "@/components/tls/Skeleton";

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
      <div className="min-h-screen bg-[#0A0A0A] px-4 sm:px-6 lg:px-8 py-16 max-w-5xl mx-auto">
        <SkeletonDetailHeader label="Lade Anmeldung" />
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
    // Zwei-Faktor wohnt seit #258 unter „Sicherheit“ - dorthin, mit der Erklärung, warum (#348).
    return <Navigate to={`/profile?tab=security&mfa=required&next=${encodeURIComponent(loc.pathname)}`} replace />;
  }
  if (requireModerator && !user.is_tournament_staff && !hasArea(user, "moderation") && !isAnyAdmin(user)) {
    return <Navigate to="/403" replace state={{ areas: ["moderation"], from: loc.pathname }} />;
  }
  if (requireMember && !user.is_club_member && !isAnyAdmin(user)) {
    // Kein Mitglied: auf die Beitrittsseite, mit dem Grund - nicht stumm umgeleitet (#364).
    return <Navigate to="/membership/join?from=members" replace />;
  }
  return children;
}
