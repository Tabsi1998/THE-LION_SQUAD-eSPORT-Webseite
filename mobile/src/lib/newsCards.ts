import { formatDateTime } from "./format";
import { kindColorsDark, roles } from "../theme";

// News-Karten der App (#1912, App-Teil von #1343 und #1266) - dieselben Regeln wie im Web:
// frontend/src/lib/newsCards.js (Satz der Text-Karte), components/tls/NewsTextCard.jsx (Fläche, Sieger),
// components/tls/NewsSignupCard.jsx (Anmelde-Karten) und splitAfterFirstParagraph in pages/public/NewsDetailPage.jsx.
// Den Stand der Anmeldung (`signup`) und den Sieger (`result`) rechnet der Server (backend/services/news_cards.py).

export const TEXT_CARD_MAX_CHARS = 120;
export const MAX_SIGNUP_CARDS = 3;

export type NewsResult = { winner: string; tournament?: string | null };

export type SignupState = "open" | "full" | "soon" | "closed" | "live" | "results" | "finished" | "cancelled" | "none";

export type NewsSignup = {
  state: SignupState | string;
  start_date?: string | null;
  taken?: number | null;
  max?: number | null;
  spots_left?: number | null;
  opens_at?: string | null;
};

type LinkedWithSignup = { id: string; slug?: string | null; title?: string | null; name?: string | null; signup?: NewsSignup | null };

export type SignupItem = { key: string; id: string; kind: "tournament" | "event"; title: string; signup: NewsSignup };

// Tags weg, bis keine mehr übrig sind (wie im Web) - der Text wird ohnehin nur als Text ausgegeben.
function clean(value: unknown): string {
  let text = String(value || "");
  let previous;
  do {
    previous = text;
    text = text.replace(/<[^>]+>/g, " ");
  } while (text !== previous);
  return text.split(/\s+/).filter(Boolean).join(" ");
}

/** Der erste Satz des Anrisses (sonst der Titel), höchstens `max` Zeichen - gekürzt am Wortende mit „…“. */
export function textCardSentence(news: { excerpt?: string | null; summary?: string | null; title?: string | null } | null | undefined, max = TEXT_CARD_MAX_CHARS): string {
  const source = clean(news?.excerpt || news?.summary) || clean(news?.title);
  if (!source) return "";
  const end = source.search(/[.!?](\s|$)/);
  const sentence = end >= 0 ? source.slice(0, end + 1) : source;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:–-]+$/, "")}…`;
}

/** Dunkle Fläche je News-Kategorie (weiße Schrift darauf), Grau ohne eigene Farbe - wie NEWS_CATEGORY_COLORS_DARK. */
const CATEGORY_DARK: Record<string, string> = {
  tournaments: kindColorsDark.tournament,
  events: kindColorsDark.event,
  club: kindColorsDark.club,
  members: kindColorsDark.club,
};
export const NEWS_CATEGORY_DARK_FALLBACK = "#3A3A44";

export function newsCategoryColorDark(category?: string | null): string {
  return (category && CATEGORY_DARK[category]) || NEWS_CATEGORY_DARK_FALLBACK;
}

/** Sieger der Ergebnis-News - nur, wenn der Server ihn mitliefert (er prüft Sichtbarkeit und öffentliche Namen). */
export function newsResult(news: { result?: Partial<NewsResult> | null } | null | undefined): NewsResult | null {
  const result = news?.result;
  return result?.winner ? { winner: String(result.winner), tournament: result.tournament || null } : null;
}

/** Anmelde-Karten: je verknüpftem Turnier bzw. Event mit Stand eine, Turniere zuerst, höchstens drei. */
export function signupItems(post: { linked_tournaments?: LinkedWithSignup[] | null; linked_events?: LinkedWithSignup[] | null } | null | undefined): SignupItem[] {
  const tournaments = (post?.linked_tournaments || []).filter((t) => t?.signup).map((t) => ({
    key: `t-${t.id}`, id: t.slug || t.id, kind: "tournament" as const, title: t.title || t.name || "Turnier", signup: t.signup as NewsSignup,
  }));
  const events = (post?.linked_events || []).filter((e) => e?.signup).map((e) => ({
    key: `e-${e.id}`, id: e.slug || e.id, kind: "event" as const, title: e.name || e.title || "Event", signup: e.signup as NewsSignup,
  }));
  return [...tournaments, ...events].slice(0, MAX_SIGNUP_CARDS);
}

export const SIGNUP_STATE: Record<string, { label: string; color: string }> = {
  open: { label: "Anmeldung offen", color: roles.ok },
  full: { label: "Ausgebucht", color: roles.warn },
  soon: { label: "Anmeldung öffnet bald", color: roles.muted },
  closed: { label: "Anmeldung geschlossen", color: roles.muted },
  live: { label: "Läuft", color: roles.live },
  results: { label: "Ergebnisse", color: roles.honor },
  finished: { label: "Vorbei", color: roles.quiet },
  cancelled: { label: "Abgesagt", color: roles.quiet },
  none: { label: "", color: roles.muted },
};

const ACTION_TEXT: Record<string, string> = { live: "Live ansehen", results: "Ergebnisse ansehen" };

export function seatsLine(signup: NewsSignup): string {
  if (!["open", "full", "soon"].includes(signup.state)) return "";
  if (signup.max) {
    return (signup.spots_left || 0) > 0 ? `Noch ${signup.spots_left} von ${signup.max} Plätzen frei` : `Alle ${signup.max} Plätze vergeben`;
  }
  return signup.taken ? `${signup.taken} angemeldet` : "";
}

export function stateLine(signup: NewsSignup): string {
  if (signup.state === "soon" && signup.opens_at) return `Anmeldung ab ${formatDateTime(signup.opens_at)}`;
  return SIGNUP_STATE[signup.state]?.label || "";
}

/** Beschriftung des Knopfs: „Anmelden“ nur bei offener Anmeldung, sonst der Weg zur Seite. */
export function signupAction(item: SignupItem): string {
  if (item.signup.state === "open") return "Anmelden";
  return ACTION_TEXT[item.signup.state] || (item.kind === "event" ? "Zum Event" : "Zum Turnier");
}

/** Text bis nach dem ersten Absatz und der Rest: HTML bis zum ersten </p>, sonst bis zur ersten Leerzeile außerhalb von Code. */
export function splitAfterFirstParagraph(text: string | null | undefined): [string, string] {
  const source = String(text || "");
  const html = source.search(/<\/p>/i);
  if (html >= 0) {
    const end = html + "</p>".length;
    return [source.slice(0, end), source.slice(end).replace(/^\s+/, "")];
  }
  for (const match of source.matchAll(/\r?\n[ \t]*\r?\n/g)) {
    const head = source.slice(0, match.index);
    if (!head.trim()) continue;
    if ((head.match(/```/g) || []).length % 2 === 1) continue;
    return [head, source.slice((match.index || 0) + match[0].length).replace(/^\s+/, "")];
  }
  return [source, ""];
}
