import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { adminHome, areaList } from "@/lib/permissions";
import { useOptionalAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Home, ArrowLeft, Calendar, Trophy, Newspaper, Medal, LogIn, RefreshCw, ClipboardList, Mail } from "lucide-react";
import { LionArt } from "@/components/tls/LionArt";
import { LION_ART_SIZE } from "@/components/tls/PublicEmptyState";

// Fehlerseiten mit dem Löwen (#1325): 404 mit Lupe, 403 schlafend, 500 mit Stecker. Ein Satz für Gäste, ein Knopf, der
// weiterhilft; die Nummer steht nur noch klein darunter.
const ERROR_DEFS = {
  "404": { code: "404", art: "search", title: "Hier ist kein Rudel", desc: "Diese Seite gibt es nicht (mehr). Vielleicht hilft die Suche oder einer der Wege unten." },
  "403": { code: "403", art: "sleep", title: "Nur für Mitglieder", desc: "Du bist nicht berechtigt, diese Seite zu sehen. Melde dich an - manche Seiten sind nur für Mitglieder." },
  "500": { code: "500", art: "offline", title: "Da ist uns ein Kabel rausgerutscht", desc: "Das liegt nicht an dir. Versuch es gleich noch einmal." },
};

const QUICK_LINKS = [
  { to: "/", label: "Start", icon: Home },
  { to: "/events", label: "Events", icon: Calendar },
  { to: "/tournaments", label: "Turniere", icon: Trophy },
  { to: "/news", label: "News", icon: Newspaper },
  { to: "/seasons/current", label: "Jahreswertung", icon: Medal },
];

// `title` und `primary` ersetzen Überschrift und ersten Knopf - für Angemeldete auf „Kein Zugriff“ (#1352), die keinen
// „Anmelden“-Knopf brauchen. `primary={null}` heißt: kein erster Knopf.
export function ErrorPage({ code = "404", detail = "", title = "", primary }) {
  const base = ERROR_DEFS[code] || ERROR_DEFS["404"];
  const def = title ? { ...base, title } : base;
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
        <section className="max-w-3xl w-full" aria-labelledby={`error-heading-${def.code}`}>
          <div className="flex flex-col items-center gap-6 text-center lg:flex-row lg:items-center lg:gap-10 lg:text-left">
            <LionArt art={def.art} className={`shrink-0 text-white/90 ${LION_ART_SIZE}`} />
            <div className="min-w-0">
              <h1 id={`error-heading-${def.code}`} className="font-heading text-3xl md:text-4xl font-black mb-3" data-testid={`error-title-${def.code}`}>
                {def.title}
              </h1>
              <p className="text-base text-white/65" data-testid={`error-detail-${def.code}`}>{detail || def.desc}</p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 lg:justify-start">
                {primary !== undefined ? primary : def.code === "403" ? (
                  <Link to="/login" data-testid="error-login-btn" className="tls-btn tls-btn--primary inline-flex min-h-11 items-center gap-2 px-5 py-2.5 rounded-sm font-bold uppercase tracking-wider text-sm">
                    <LogIn className="w-4 h-4" aria-hidden="true" /> Anmelden
                  </Link>
                ) : def.code === "500" ? (
                  <button type="button" onClick={() => window.location.reload()} data-testid="error-retry-btn" className="tls-btn tls-btn--primary inline-flex min-h-11 items-center gap-2 px-5 py-2.5 rounded-sm font-bold uppercase tracking-wider text-sm">
                    <RefreshCw className="w-4 h-4" aria-hidden="true" /> Nochmal versuchen
                  </button>
                ) : null}
                <Link to="/" data-testid="error-home-btn" className={def.code === "404" ? "tls-btn tls-btn--primary inline-flex min-h-11 items-center gap-2 px-5 py-2.5 rounded-sm font-bold uppercase tracking-wider text-sm" : "tls-hit inline-flex items-center gap-2 text-sm font-semibold text-[#29B6E8] hover:text-white"}>
                  <Home className="w-4 h-4" aria-hidden="true" /> Zur Startseite
                </Link>
                <button type="button" onClick={goBack} data-testid="error-back-btn" className="tls-hit inline-flex items-center gap-2 text-sm font-semibold text-white/60 hover:text-white">
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Zurück
                </button>
              </div>
              <p className="mt-6 text-xs text-white/40" data-testid="error-code">Fehler {def.code}</p>
            </div>
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
const PRIMARY_BTN = "tls-btn tls-btn--primary inline-flex min-h-11 items-center gap-2 px-5 py-2.5 rounded-sm font-bold uppercase tracking-wider text-sm";

// Rechte nach Bereichen (#292): die Seite sagt, welcher Bereich fehlt und wer ihn vergibt. Angemeldete (#1352) sehen
// keinen „Anmelden“-Knopf: wer einen Dienst hat, liest genau den Bereich dieser Seite und kommt mit einem Tipp zu seiner
// Arbeit; wer gar keinen Dienst hat, liest statt einer Bereichsliste, wofür die Verwaltung da ist.
export function ForbiddenPage() {
  const state = useLocation().state || {};
  const user = useOptionalAuth()?.user || null;
  const areas = Array.isArray(state.areas) && state.areas.length ? state.areas : null;
  const areaText = areas ? `Dafür fehlt dir der Bereich ${areaList(areas)}. Vergeben kann ihn der Superadmin unter Admin → Alle Benutzer.` : "";
  if (!user) return <ErrorPage code="403" detail={areaText} />;

  const home = adminHome(user);
  if (state.noDuty || home === "none") {
    const detail = (
      <>
        Die Verwaltung ist für Vereinsdienste. Du möchtest mithelfen?{" "}
        <Link to="/contact" data-testid="error-contact-link" className="font-semibold text-[#29B6E8] hover:text-white underline underline-offset-2">Schreib uns.</Link>
      </>
    );
    const primary = (
      <Link to="/contact" data-testid="error-contact-btn" className={PRIMARY_BTN}>
        <Mail className="w-4 h-4" aria-hidden="true" /> Schreib uns
      </Link>
    );
    return <ErrorPage code="403" title="Nur für Vereinsdienste" detail={detail} primary={primary} />;
  }
  const primary = (
    <Link to="/admin" data-testid="error-duty-btn" className={PRIMARY_BTN}>
      <ClipboardList className="w-4 h-4" aria-hidden="true" /> {home === "dashboard" ? "Zur Verwaltung" : "Zu meinem Dienst"}
    </Link>
  );
  return <ErrorPage code="403" title="Nicht dein Bereich" detail={areaText || "Für diese Seite fehlt dir ein Recht."} primary={primary} />;
}
export function ServerErrorPage() { return <ErrorPage code="500" />; }
