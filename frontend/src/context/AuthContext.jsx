import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, formatApiError } from "@/lib/api";
import { normalizeApiPath } from "@/lib/apiInvalidation";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  const [error, setError] = useState(null);

  const fetchMe = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => { fetchMe(); }, [fetchMe]);
  const refreshCurrentUser = useCallback((event) => {
    const path = normalizeApiPath(event?.path);
    if (path === "auth/me" || path === "users/me" || path.startsWith("auth/")) {
      return fetchMe();
    }
    if (path.startsWith("membership/applications")) {
      return fetchMe();
    }
    if (user?.id && (path === `users/${user.id}` || path === `membership/user/${user.id}`)) {
      return fetchMe();
    }
    return undefined;
  }, [fetchMe, user?.id]);
  useApiInvalidation(refreshCurrentUser, ["auth", "users", "membership"]);

  const login = async (email, password) => {
    setError(null);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      setUser(data);
      return { ok: true };
    } catch (e) {
      const msg = formatApiError(e.response?.data?.detail) || e.message;
      setError(msg);
      return { ok: false, error: msg };
    }
  };

  const register = async (payload) => {
    setError(null);
    try {
      const { data } = await api.post("/auth/register", payload);
      setUser(data);
      return { ok: true };
    } catch (e) {
      const msg = formatApiError(e.response?.data?.detail) || e.message;
      setError(msg);
      return { ok: false, error: msg };
    }
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    setUser(null);
  };

  const isAdmin = user && ["tournament_admin", "club_admin", "superadmin"].includes(user.role);
  const isModerator = user && (user.is_tournament_staff || ["moderator", "tournament_admin", "club_admin", "superadmin"].includes(user.role));
  const isSuperAdmin = user?.role === "superadmin";
  const isClubMember = !!user?.is_club_member;
  const userType = user?.user_type || (user ? "community_user" : "guest");

  return (
    <AuthContext.Provider value={{ user, setUser, login, register, logout, error, isAdmin, isModerator, isSuperAdmin, isClubMember, userType, refresh: fetchMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
