import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

export function ProtectedRoute({ children, requireAdmin = false }) {
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
  return children;
}
