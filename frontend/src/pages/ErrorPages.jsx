import { Link, useRouteError } from "react-router-dom";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { AlertTriangle, Home, ArrowLeft, ShieldOff, Search, Calendar, Trophy, Newspaper, Medal } from "lucide-react";

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
  return (
    <PublicLayout>
      <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
        <div className="text-center max-w-2xl">
          <div className="relative inline-block mb-6">
            <span className="font-display text-[160px] md:text-[200px] font-black leading-none" style={{ color: def.accent, opacity: 0.15 }}>
              {def.code}
            </span>
            <Icn className="w-20 h-20 absolute inset-0 m-auto" style={{ color: def.accent }} />
          </div>
          <h1 className="font-heading text-3xl md:text-5xl font-black uppercase mb-3" data-testid={`error-title-${code}`}>
            {def.title}
          </h1>
          <p className="text-white/60 mb-8">{def.desc}</p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link to="/" data-testid="error-home-btn" className="px-5 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2">
              <Home className="w-4 h-4" /> Zur Startseite
            </Link>
            <button onClick={() => window.history.back()} data-testid="error-back-btn" className="px-5 py-2.5 border border-white/20 text-white font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 hover:border-white/40">
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
        </div>
      </div>
    </PublicLayout>
  );
}

export function NotFoundPage() { return <ErrorPage code="404" />; }
export function ForbiddenPage() { return <ErrorPage code="403" />; }
export function ServerErrorPage() {
  const error = useRouteError();
  // log to console for debugging
  if (error) console.error("[TLS] route error:", error);
  return <ErrorPage code="500" />;
}
