import { useEffect } from "react";
import { Link } from "react-router-dom";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { AlertTriangle, Home, ArrowLeft, ShieldOff, Search, Calendar, Trophy, Newspaper, Medal, LogIn, RefreshCw } from "lucide-react";

const ERROR_DEFS = {
  "404": { code: "404", title: "Seite nicht gefunden", desc: "Diese Seite gibt es nicht (mehr) — vielleicht hast du dich verlaufen.", icon: Search, accent: "#29B6E8" },
  "403": { code: "403", title: "Kein Zugriff", desc: "Du bist nicht berechtigt, diese Seite zu sehen. Logge dich ein oder werde Vereinsmitglied.", icon: ShieldOff, accent: "#FFD700" },
  "500": { code: "500", title: "Etwas ist schiefgelaufen", desc: "Wir haben einen Fehler erhalten. Bitte versuche es später erneut.", icon: AlertTriangle, accent: "#FF3B30" },
};

const QUICK_LINKS = [
  { to: "/", label: "Start", icon: Home },
  { to: "/events", label: "Events", icon: Calendar },
  { to: "/tournaments", label: "Turniere", icon: Trophy },
  { to: "/news", label: "News", icon: Newspaper },
  { to: "/seasons/current", label: "Jahreswertung", icon: Medal },
];

export function ErrorPage({ code = "404" }) {
  const def = ERROR_DEFS[code] || ERROR_DEFS["404"];
  const Icn = def.icon;
  useEffect(() => {
    const previousTitle = document.title;
    let robots = document.head.querySelector('meta[name="robots"]');
    const createdRobots = !robots;
    const previousRobots = robots?.getAttribute("content");
    if (!robots) {
      robots = document.createElement("meta");
      robots.setAttribute("name", "robots");
      document.head.appendChild(robots);
    }
    robots.setAttribute("content", "noindex, nofollow");
    document.title = `${def.code} – ${def.title} | THE LION SQUAD`;

    return () => {
      document.title = previousTitle;
      if (createdRobots) robots.remove();
      else if (previousRobots == null) robots.removeAttribute("content");
      else robots.setAttribute("content", previousRobots);
    };
  }, [def.code, def.title]);

  const goBack = () => {
    if (Number(window.history.state?.idx || 0) > 0) window.history.back();
    else window.location.assign("/");
  };

  return (
    <PublicLayout>
      <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
        <section className="text-center max-w-2xl" aria-labelledby={`error-heading-${def.code}`}>
          <div className="relative inline-block mb-6">
            <span className="font-display text-[160px] md:text-[200px] font-black leading-none" style={{ color: def.accent, opacity: 0.15 }}>
              {def.code}
            </span>
            <Icn className="w-20 h-20 absolute inset-0 m-auto" style={{ color: def.accent }} />
          </div>
          <h1 id={`error-heading-${def.code}`} className="font-heading text-3xl md:text-5xl font-black uppercase mb-3" data-testid={`error-title-${def.code}`}>
            {def.title}
          </h1>
          <p className="text-white/60 mb-8">{def.desc}</p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link to="/" data-testid="error-home-btn" className="px-5 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2">
              <Home className="w-4 h-4" /> Zur Startseite
            </Link>
            {def.code === "403" && (
              <Link to="/login" data-testid="error-login-btn" className="px-5 py-2.5 border border-[#FFD700]/40 text-[#FFD700] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 hover:bg-[#FFD700]/10">
                <LogIn className="w-4 h-4" /> Einloggen
              </Link>
            )}
            {def.code === "500" && (
              <button type="button" onClick={() => window.location.reload()} data-testid="error-retry-btn" className="px-5 py-2.5 border border-[#FF3B30]/40 text-[#FF8A80] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 hover:bg-[#FF3B30]/10">
                <RefreshCw className="w-4 h-4" /> Erneut versuchen
              </button>
            )}
            <button type="button" onClick={goBack} data-testid="error-back-btn" className="px-5 py-2.5 border border-white/20 text-white font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 hover:border-white/40">
              <ArrowLeft className="w-4 h-4" /> Zurück
            </button>
          </div>
          <div className="mt-8 grid grid-cols-2 sm:grid-cols-5 gap-2">
            {QUICK_LINKS.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className="min-h-[70px] rounded-sm border border-white/10 bg-white/[0.04] px-3 py-3 flex flex-col items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider text-white/70 hover:border-[#29B6E8]/50 hover:text-[#29B6E8] transition"
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </PublicLayout>
  );
}

export function NotFoundPage() { return <ErrorPage code="404" />; }
export function ForbiddenPage() { return <ErrorPage code="403" />; }
export function ServerErrorPage() { return <ErrorPage code="500" />; }
