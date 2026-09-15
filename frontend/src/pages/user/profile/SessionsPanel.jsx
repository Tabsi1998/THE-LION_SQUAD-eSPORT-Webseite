import { useCallback, useEffect, useState } from "react";
import { api, formatRequestError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { toast } from "sonner";
import { Laptop, LogOut, ShieldCheck, Smartphone } from "lucide-react";

function parseSessionDevice(userAgent = "", client = "web") {
  if (client === "mobile") return { browser: "Lion Squad App", os: "Mobile", mobile: true };
  const ua = userAgent || "";
  const browser = /edg\//i.test(ua) ? "Edge"
    : /opr\/|opera/i.test(ua) ? "Opera"
    : /firefox|fxios/i.test(ua) ? "Firefox"
    : /chrome|crios/i.test(ua) ? "Chrome"
    : /safari/i.test(ua) ? "Safari"
    : "Browser";
  const os = /windows/i.test(ua) ? "Windows"
    : /iphone|ipad|ios/i.test(ua) ? "iOS"
    : /android/i.test(ua) ? "Android"
    : /mac os|macintosh/i.test(ua) ? "macOS"
    : /linux/i.test(ua) ? "Linux"
    : "Unbekannt";
  return { browser, os, mobile: /iphone|ipad|android|mobile/i.test(ua) };
}

function formatSessionTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function SessionsPanel() {
  const [sessions, setSessions] = useState(null);
  const [busy, setBusy] = useState(false);
  const confirmSession = useConfirm();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/sessions");
      setSessions(Array.isArray(data) ? data : []);
    } catch {
      setSessions([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const revoke = async (session) => {
    const ok = await confirmSession({
      title: session.current ? "Aktuelle Sitzung abmelden?" : "Gerät abmelden?",
      description: session.current
        ? "Du meldest damit dieses Gerät ab und musst dich neu einloggen."
        : "Dieses Gerät wird sofort abgemeldet.",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`/auth/sessions/${session.id}`);
      toast.success("Sitzung abgemeldet.");
      await load();
    } catch (err) {
      toast.error(formatRequestError(err, "Sitzung konnte nicht abgemeldet werden."));
    } finally {
      setBusy(false);
    }
  };

  const logoutAll = async () => {
    const ok = await confirmSession({
      title: "Überall abmelden?",
      description: "Alle anderen Geräte werden sofort abgemeldet. Deine aktuelle Sitzung bleibt aktiv.",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { data } = await api.post("/auth/sessions/logout-all");
      toast.success(`${data?.revoked_sessions ?? 0} andere Sitzung(en) abgemeldet.`);
      await load();
    } catch (err) {
      toast.error(formatRequestError(err, "Abmelden fehlgeschlagen."));
    } finally {
      setBusy(false);
    }
  };

  const otherCount = (sessions || []).filter((s) => !s.current).length;

  return (
    <div className="space-y-5" data-testid="profile-sessions-panel">
      <div className="border border-white/10 rounded-sm p-5 bg-[#0A0A0A]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-[#29B6E8] mt-1 shrink-0" />
            <div>
              <h3 className="font-heading font-black uppercase mb-1">Aktive Sitzungen & Geräte</h3>
              <p className="text-xs text-white/50">
                Hier siehst du, wo dein Account angemeldet ist. Melde einzelne Geräte oder alle anderen Sitzungen mit einem Klick ab.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={logoutAll}
            disabled={busy || otherCount === 0}
            data-testid="sessions-logout-all"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-sm border border-[#FF3B30]/45 text-[#FF3B30] text-xs font-bold uppercase tracking-wider hover:bg-[#FF3B30]/10 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" /> Überall abmelden{otherCount > 0 ? ` (${otherCount})` : ""}
          </button>
        </div>
      </div>

      {sessions === null && (
        <div className="text-sm text-white/45 border border-white/10 rounded-sm p-6 bg-[#0A0A0A] text-center">Lade Sitzungen …</div>
      )}
      {sessions !== null && sessions.length === 0 && (
        <div className="text-sm text-white/45 border border-white/10 rounded-sm p-6 bg-[#0A0A0A] text-center" data-testid="sessions-empty">
          Keine aktiven Sitzungen gefunden.
        </div>
      )}
      {(sessions || []).map((session) => {
        const device = parseSessionDevice(session.user_agent, session.client);
        const DeviceIcon = device.mobile ? Smartphone : Laptop;
        return (
          <div
            key={session.id}
            data-testid={`session-row-${session.id}`}
            className={`border rounded-sm p-4 bg-[#0A0A0A] flex flex-col sm:flex-row sm:items-center gap-4 ${session.current ? "border-[#29B6E8]/50" : "border-white/10"}`}
          >
            <div className={`w-11 h-11 rounded-sm border flex items-center justify-center shrink-0 ${session.current ? "border-[#29B6E8]/50 text-[#29B6E8] bg-[#29B6E8]/10" : "border-white/15 text-white/50 bg-[#121212]"}`}>
              <DeviceIcon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-white text-sm">{device.browser} · {device.os}</span>
                {session.current && (
                  <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-sm border border-[#29B6E8]/50 text-[#29B6E8] bg-[#29B6E8]/10" data-testid="session-current-badge">
                    Dieses Gerät
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-white/45 flex flex-wrap gap-x-4 gap-y-0.5">
                <span>Angemeldet: {formatSessionTime(session.created_at)}</span>
                <span>Zuletzt aktiv: {formatSessionTime(session.last_active)}</span>
                {session.ip && <span>IP: {session.ip}</span>}
              </div>
            </div>
            <button
              type="button"
              onClick={() => revoke(session)}
              disabled={busy}
              data-testid={`session-revoke-${session.id}`}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-sm border border-white/15 text-white/60 text-[11px] font-bold uppercase tracking-wider hover:border-[#FF3B30]/50 hover:text-[#FF3B30] disabled:opacity-40 shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" /> Abmelden
            </button>
          </div>
        );
      })}
    </div>
  );
}

