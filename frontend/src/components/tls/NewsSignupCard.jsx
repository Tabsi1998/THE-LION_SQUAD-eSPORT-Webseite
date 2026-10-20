import { Link } from "react-router-dom";
import { ArrowRight, Calendar, Trophy, Users } from "lucide-react";
import { formatDateTime } from "@/lib/datetime";
import { KIND_COLORS, ROLE_COLORS } from "@/lib/categoryColors";

// News führen direkt zur Anmeldung (#1266, Web-Idee 37): unter dem ersten Absatz je verknüpftem Turnier oder Event
// eine Karte mit Beginn, freien Plätzen und „Anmelden“ - ist die Anmeldung zu, steht dort der Stand. Den Stand
// rechnet der Server (`signup` an linked_tournaments / linked_events), die App liest dieselben Angaben.
// „Anmelden“ öffnet die Anmeldung auf der Turnier- bzw. Event-Seite (?anmelden=1); Gäste melden sich dort zuerst an
// und kommen zurück.

export const MAX_SIGNUP_CARDS = 3;

const STATE_TEXT = {
  open: { label: "Anmeldung offen", color: ROLE_COLORS.ok },
  full: { label: "Ausgebucht", color: ROLE_COLORS.warn },
  soon: { label: "Anmeldung öffnet bald", color: ROLE_COLORS.muted },
  closed: { label: "Anmeldung geschlossen", color: ROLE_COLORS.muted },
  live: { label: "Läuft", color: ROLE_COLORS.live },
  results: { label: "Ergebnisse", color: ROLE_COLORS.honor },
  finished: { label: "Vorbei", color: ROLE_COLORS.quiet },
  cancelled: { label: "Abgesagt", color: ROLE_COLORS.quiet },
  none: { label: "", color: ROLE_COLORS.muted },
};

const ACTION_TEXT = { live: "Live ansehen", results: "Ergebnisse ansehen" };

export function signupItems(post) {
  const tournaments = (post?.linked_tournaments || []).filter((t) => t?.signup).map((t) => ({
    key: `t-${t.id}`, slug: t.slug || t.id, kind: "tournament", title: t.title, to: `/tournaments/${t.slug || t.id}`, signup: t.signup,
  }));
  const events = (post?.linked_events || []).filter((e) => e?.signup).map((e) => ({
    key: `e-${e.id}`, slug: e.slug || e.id, kind: "event", title: e.name, to: `/events/${e.slug || e.id}`, signup: e.signup,
  }));
  return [...tournaments, ...events].slice(0, MAX_SIGNUP_CARDS);
}

function seatsLine(signup) {
  if (!["open", "full", "soon"].includes(signup.state)) return "";
  if (signup.max) {
    return signup.spots_left > 0 ? `Noch ${signup.spots_left} von ${signup.max} Plätzen frei` : `Alle ${signup.max} Plätze vergeben`;
  }
  return signup.taken ? `${signup.taken} angemeldet` : "";
}

function stateLine(signup) {
  if (signup.state === "soon" && signup.opens_at) return `Anmeldung ab ${formatDateTime(signup.opens_at)}`;
  return STATE_TEXT[signup.state]?.label || "";
}

function SignupCard({ item }) {
  const { signup } = item;
  const accent = item.kind === "event" ? KIND_COLORS.event : KIND_COLORS.tournament;
  const Icon = item.kind === "event" ? Calendar : Trophy;
  const open = signup.state === "open";
  const seats = seatsLine(signup);
  const state = stateLine(signup);
  const stateColor = (STATE_TEXT[signup.state] || STATE_TEXT.none).color;
  return (
    <div
      data-testid={`news-signup-${item.slug}`}
      data-state={signup.state}
      className="tls-news-signup relative flex flex-col sm:flex-row sm:items-center gap-4 border border-white/10 bg-[#121212] rounded-sm p-4 sm:p-5 overflow-hidden"
      style={{ boxShadow: `inset 3px 0 0 ${accent}` }}
    >
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm" style={{ backgroundColor: `${accent}1f` }}>
          <Icon className="w-4 h-4" style={{ color: accent }} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="font-heading font-black text-lg leading-tight break-words">{item.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/65">
            {signup.start_date && <span className="tabular-nums">{formatDateTime(signup.start_date)}</span>}
            {seats && <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5 text-white/40" aria-hidden="true" />{seats}</span>}
          </div>
          {state && !open && <div className="mt-1 text-xs font-bold uppercase tracking-wider" style={{ color: stateColor }}>{state}</div>}
        </div>
      </div>
      {open ? (
        <Link
          to={`${item.to}?anmelden=1`}
          className="tls-btn tls-btn--primary tls-news-signup__go group inline-flex shrink-0 items-center justify-center gap-2 rounded-sm px-5 py-2.5 text-sm font-bold uppercase tracking-wider"
        >
          Anmelden <ArrowRight className="tls-news-signup__arrow w-4 h-4" aria-hidden="true" />
        </Link>
      ) : (
        <Link
          to={item.to}
          className="tls-btn tls-btn--quiet inline-flex shrink-0 items-center justify-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider"
        >
          {ACTION_TEXT[signup.state] || (item.kind === "event" ? "Zum Event" : "Zum Turnier")}
        </Link>
      )}
    </div>
  );
}

export function NewsSignupCards({ post, className = "" }) {
  const items = signupItems(post);
  if (!items.length) return null;
  return (
    <div className={`not-prose grid gap-3 ${className}`} data-testid="news-signups">
      {items.map((item) => <SignupCard key={item.key} item={item} />)}
    </div>
  );
}
