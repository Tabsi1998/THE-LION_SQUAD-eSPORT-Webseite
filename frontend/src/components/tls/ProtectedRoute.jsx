import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { ADMIN_AREAS, MFA_AREAS, adminHome, hasArea, hasSeriesCaptain, isAnyAdmin, leadWithoutSecondFactor, mfaSetupPath, needsSecondFactor } from "@/lib/permissions";
import { SkeletonDetailHeader } from "@/components/tls/Skeleton";

// Rechte nach Bereichen (#287): `requireArea` verlangt einen der genannten
// Bereiche (Turnierleitung, Redaktion, Vereinsverwaltung, System, Moderation).
// `requireAdmin` heißt „irgendein Adminbereich“, `requireClubAdmin` bleibt als
// Kurzform für System. Zwei-Faktor ist Pflicht für alles außer Moderation.
// `requireTournamentStaff` öffnet die Turnierseiten (Turniere, Fast Lap, Stationen,
// Turnierbaum-TV) für die Turnierleitung und für Helfer mit Einsatz - Moderation oder ein anderer
// Adminbereich allein nicht. Die Turnierleitung braucht dafür, wie im Server, die bestätigte
// Zwei-Faktor-Anmeldung (#1028); Helfer nicht - auch eine Turnierleitung mit eigenem Einsatz
// (`has_staff_assignment`) kommt ohne Zwei-Faktor in diesen Einsatz, die Seiten zeigen ihr dann nur dessen Aktionen.
// `adminHome` ist der Eingang /admin (#1352): die Startseite für Verwaltungsbereiche, „Mein Dienst“ für Helfer, die
// Meldungen für Moderation, sonst „Kein Zugriff“ mit dem freundlichen Satz (`adminHome` in lib/permissions).
// `requireDuty` öffnet „Mein Dienst“ für alle mit einem Dienst - Helfer, Moderation oder Verwaltung.
// `allowSeriesCaptain` (#1749) öffnet eine Seite mit `requireArea` zusätzlich für Captains externer Serien - wie im
// Server nur mit bestätigter Zwei-Faktor-Anmeldung; welche Serie, prüft der Server bei jedem Aufruf.

export function ProtectedRoute({ children, requireArea = null, requireAdmin = false, requireClubAdmin = false, requireMember = false, requireTournamentStaff = false, adminHome: entrance = false, requireDuty = false, allowSeriesCaptain = false }) {
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
  if (entrance || requireDuty) {
    const home = adminHome(user);
    if (home === "none") return <Navigate to="/403" replace state={{ noDuty: true, from: loc.pathname }} />;
    if (home === "mfa") return <Navigate to={mfaSetupPath(loc.pathname)} replace />;
    if (entrance && home === "duty") return <Navigate to="/admin/dienst" replace />;
    if (entrance && home === "moderation") return <Navigate to="/admin/moderation" replace />;
    return children;
  }
  if (allowSeriesCaptain && hasSeriesCaptain(user) && !hasArea(user, ...wantedAreas)) {
    if (needsSecondFactor(user)) return <Navigate to={mfaSetupPath(loc.pathname)} replace />;
    return children;
  }
  if (wantedAreas.length && !hasArea(user, ...wantedAreas)) {
    return <Navigate to="/403" replace state={{ areas: wantedAreas, from: loc.pathname }} />;
  }
  const leadNeedsSecondFactor = requireTournamentStaff && leadWithoutSecondFactor(user) && !user.has_staff_assignment;
  if ((wantedAreas.some((area) => MFA_AREAS.has(area)) && needsSecondFactor(user)) || leadNeedsSecondFactor) {
    // Zwei-Faktor wohnt seit #258 unter „Sicherheit“ - dorthin, mit der Erklärung, warum (#348).
    return <Navigate to={mfaSetupPath(loc.pathname)} replace />;
  }
  if (requireTournamentStaff && !hasArea(user, "tournaments") && !user.is_tournament_staff) {
    return <Navigate to="/403" replace state={{ areas: ["tournaments"], from: loc.pathname }} />;
  }
  if (requireMember && !user.is_club_member && !isAnyAdmin(user)) {
    // Kein Mitglied: auf die Beitrittsseite, mit dem Grund - nicht stumm umgeleitet (#364).
    return <Navigate to="/membership/join?from=members" replace />;
  }
  return children;
}
