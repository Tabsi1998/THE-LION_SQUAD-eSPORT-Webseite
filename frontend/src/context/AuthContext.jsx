import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { api, formatApiError } from "@/lib/api";
import { normalizeApiPath } from "@/lib/apiInvalidation";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";

const AuthContext = createContext(null);

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
export function startGoogleLogin(returnPath = "/profile") {
  const redirectUrl = window.location.origin + returnPath;
  window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  const [error, setError] = useState(null);
  const [googleProcessing, setGoogleProcessing] = useState(
    () => typeof window !== "undefined" && window.location.hash.includes("session_id=")
  );
  const googleHandled = useRef(false);

  const fetchMe = useCallback(async () => {
    try {
      let response = await api.get("/auth/me");
      if (response.headers?.["x-session-refresh"] === "required") {
        await api.post("/auth/refresh", null, { skipInvalidation: true });
        response = await api.get("/auth/me");
      }
      setUser(response.data || null);
    } catch {
      setUser(null);
    }
  }, []);

  // Handle Emergent Google-OAuth callback (#session_id=...) BEFORE the normal /auth/me check.
  useEffect(() => {
    const hash = window.location.hash || "";
    if (hash.includes("session_id=")) {
      if (googleHandled.current) return;
      googleHandled.current = true;
      const sessionId = new URLSearchParams(hash.replace(/^#/, "")).get("session_id");
      (async () => {
        try {
          const { data } = await api.post("/auth/google/session", { session_id: sessionId });
          setUser(data);
          toast.success(data?._created ? "Willkommen im Rudel! Account erstellt." : "Erfolgreich angemeldet.");
        } catch (e) {
          setUser(null);
          toast.error(formatApiError(e.response?.data?.detail) || "Google-Anmeldung fehlgeschlagen.");
        } finally {
          // Strip the session_id fragment from the URL.
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
          setGoogleProcessing(false);
        }
      })();
      return;
    }
    fetchMe();
  }, [fetchMe]);
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
    try {
      await api.post("/auth/logout");
      setUser(null);
      return true;
    } catch (e) {
      const msg = formatApiError(e.response?.data?.detail) || "Logout fehlgeschlagen.";
      setError(msg);
      toast.error(msg);
      return false;
    }
  };

  const isAdmin = user && ["tournament_admin", "club_admin", "superadmin"].includes(user.role);
  const isModerator = user && (user.is_tournament_staff || ["moderator", "tournament_admin", "club_admin", "superadmin"].includes(user.role));
  const isSuperAdmin = user?.role === "superadmin";
  const isClubMember = !!user?.is_club_member;
  const userType = user?.user_type || (user ? "community_user" : "guest");

  return (
    <AuthContext.Provider value={{ user, setUser, login, register, logout, error, isAdmin, isModerator, isSuperAdmin, isClubMember, userType, refresh: fetchMe, startGoogleLogin, googleProcessing }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
