import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

export function ProtectedRoute({ children, requireAdmin = false, requireMember = false, requireModerator = false }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (user === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A]">
        <div className="font-display text-[#29B6E8] tracking-widest text-sm">LADE …</div>
      </div>
    );
  }
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (requireAdmin && !["tournament_admin", "club_admin", "superadmin"].includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  if (requireModerator && !user.is_tournament_staff && !["moderator", "tournament_admin", "club_admin", "superadmin"].includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  if (requireMember && !user.is_club_member && !["tournament_admin", "club_admin", "superadmin"].includes(user.role)) {
    return <Navigate to="/membership/join" replace />;
  }
  return children;
}
