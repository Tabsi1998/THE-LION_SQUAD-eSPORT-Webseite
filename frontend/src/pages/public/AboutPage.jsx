import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { useOptionalAuth } from "@/context/AuthContext";
import { boardContacts } from "@/lib/memberArea";
import { formatDate } from "@/lib/datetime";
import { useCountUp } from "@/hooks/useCountUp";
import { numberItems } from "@/lib/clubNumbers";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Reveal } from "@/components/tls/Reveal";
import { LazyImg } from "@/components/tls/LazyImg";
import { BoardAvatar } from "@/components/tls/BoardPortrait";
import { GamesShelf, gameCountLine } from "@/components/tls/GamesShelf";
import { TrophyShelf, trophiesOf } from "@/components/tls/TrophyShelf";
import { SkeletonDetailHeader } from "@/components/tls/Skeleton";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSeason } from "@/seasons/SeasonContext";
import { ArrowRight, Mountain, Landmark, Medal, CalendarDays, Cake, Target } from "lucide-react";

// Über den Verein (#406, #1253): keine Seite aus festem Text. Gründung, Zweck und gemeinnützig kommen aus Dolibarr (über
// den Schalter der Vereinsdaten) oder aus den Handfeldern, die Zahlen werden gezählt, die Spiele kommen aus der Verwaltung,
// die Ansprechpartner aus dem Vorstand, „Auch offline“ aus den letzten Vereinsevents. Seit #1253 erzählt die Seite die
// Geschichte: eigener Kopf (nicht der Satz der Startseite), das Vereinsfoto, ein Zeitstrahl, die Werte mit Satz und
// Beispiel samt den Zielen (früher /values) - alles unter Verwaltung → Über uns. Dazu das Spiele-Regal (#1333) und eine
// kleine Vitrine mit den drei neuesten Pokalen neben den Zahlen (#1334). Was leer ist, bleibt weg.

export default function AboutPage() {
  useDocumentTitle(
    "eSports Verein in Tirol",
    "THE LION SQUAD ist ein österreichischer eSports und Gaming Verein aus Tirol mit Community, Events, Turnieren und echtem Zusammenhalt."
  );
  const location = useLocation();
  const [about, setAbout] = useState(null);
  const [board, setBoard] = useState([]);
  const [trophies, setTrophies] = useState([]);
  const auth = useOptionalAuth();
  const signedIn = !!auth?.user;
  // „Du bist dabei“ je Spiel (#626) - nur angemeldet und nur der eigene Stand.
  const [joined, setJoined] = useState({});
  useEffect(() => {
    api.get("/home/about").then(({ data }) => setAbout(data)).catch(() => setAbout({ texts: {}, organization: {}, numbers: {}, games: [], offline_events: [] }));
    api.get("/board?active_only=true").then(({ data }) => setBoard(boardContacts(data, 4))).catch(() => setBoard([]));
    api.get("/references").then(({ data }) => setTrophies(trophiesOf(data?.items, { newest: true, limit: 3 }))).catch(() => setTrophies([]));
  }, []);
  const hasGameServers = (about?.games || []).some((game) => game.discord);
  useEffect(() => {
    if (!signedIn || !hasGameServers) return undefined;
    let alive = true;
    api.get("/membership/discord-servers").then(({ data }) => {
      if (!alive) return;
      setJoined(Object.fromEntries((data?.servers || []).map((server) => [server.guild_id, server.member])));
    }).catch(() => {});
    return () => { alive = false; };
  }, [signedIn, hasGameServers]);
  // /values leitet auf /about#werte (#1253): der Abschnitt steht erst nach dem Laden da - dann dorthin springen.
  useEffect(() => {
    if (!about || !location.hash) return;
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    target?.scrollIntoView?.({ block: "start" });
  }, [about, location.hash]);

  if (!about) {
    return <PublicLayout><div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20"><SkeletonDetailHeader label="Lade Verein" /></div></PublicLayout>;
  }
  const texts = about.texts || {};
  const organization = about.organization || {};
  const games = Array.isArray(about.games) ? about.games : [];
  const offlineEvents = Array.isArray(about.offline_events) ? about.offline_events : [];
  const facts = organizationFacts(organization);
  const photo = texts.club_photo?.url ? texts.club_photo : null;
  const values = Array.isArray(texts.values) ? texts.values.filter((value) => value?.title) : [];
  const goals = Array.isArray(texts.goals) ? texts.goals.filter(Boolean) : [];

  return (
    <PublicLayout>
      {/* Kopf: eigener Titel und das Vereinsfoto */}
      <section className="relative overflow-hidden border-b border-white/10" data-testid="about-hero">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(41,182,232,0.18),transparent_55%)]" />
        <div className={`relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14 md:py-20 grid gap-8 items-center ${photo ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : ""}`}>
          <div className="min-w-0">
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">{texts.hero_eyebrow || "Über uns"}</span>
            <h1 className="mt-3 font-heading text-4xl sm:text-5xl md:text-6xl font-black uppercase leading-[0.95] whitespace-pre-line break-words" data-testid="about-title">{heroTitle(texts, organization)}</h1>
            <Paragraphs text={texts.hero_text} className="mt-6 text-white/70 max-w-3xl text-lg" />
            <BirthdayLine />
            {facts.length > 0 && (
              <ul className="mt-8 flex flex-wrap gap-2" data-testid="about-facts">
                {facts.map((fact) => (
                  <li key={fact.key} data-testid={`about-fact-${fact.key}`} className="inline-flex items-center gap-2 border border-white/10 bg-black/40 rounded-sm px-3 py-1.5 text-xs text-white/75">
                    <Landmark className="w-3.5 h-3.5 text-[#29B6E8]" /> {fact.label}
                  </li>
                ))}
              </ul>
            )}
            {organization.purpose && (
              <p className="mt-6 text-sm text-white/55 max-w-3xl" data-testid="about-purpose"><span className="text-white/40 uppercase tracking-widest text-[10px] font-bold mr-2">Vereinszweck</span>{organization.purpose}</p>
            )}
          </div>
          {photo ? (
            <figure className="relative overflow-hidden rounded-sm border border-white/10 aspect-[4/3] bg-[#0F1418]" data-testid="about-photo">
              <img src={resolveMediaUrl(photo.url)} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: `${photo.focus_x ?? 50}% ${photo.focus_y ?? 50}%` }} />
            </figure>
          ) : null}
        </div>
      </section>

      {/* Der Verein in Zahlen - die Zahlen stehen nur hier - mit der kleinen Vitrine der neuesten Pokale */}
      <ClubNumbers numbers={about.numbers} shown={about.numbers_shown} trophies={trophies} />

      {/* Zeitstrahl: So sind wir gewachsen */}
      <Timeline entries={texts.timeline} />

      {/* Werte & Ziele (früher eine eigene Seite) */}
      {(values.length > 0 || goals.length > 0 || texts.values_title) && (
        <section id="werte" className="scroll-mt-24 border-t border-white/10" data-testid="about-values">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Werte &amp; Ziele</span>
            {texts.values_title ? <h2 className="mt-3 font-heading text-3xl md:text-4xl font-black uppercase">{texts.values_title}</h2> : null}
            <Paragraphs text={texts.values_text} className="mt-5 text-white/70 leading-relaxed max-w-3xl" />
            {values.length > 0 && (
              <Reveal className="tls-reveal-grid mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="about-value-list">
                {values.map((value, index) => (
                  <div key={`${value.title}-${index}`} className="tls-reveal-item border border-white/10 rounded-sm bg-[#121212] p-5" data-testid={`about-value-${index}`}>
                    <div className="font-heading text-lg font-black uppercase break-words">{value.title}</div>
                    {value.text ? <p className="mt-2 text-sm text-white/75 leading-relaxed">{value.text}</p> : null}
                    {value.example ? <p className="mt-3 border-l-2 border-[#29B6E8]/50 pl-3 text-sm text-white/60"><span className="text-white/45">Zum Beispiel: </span>{value.example}</p> : null}
                  </div>
                ))}
              </Reveal>
            )}
            {goals.length > 0 && (
              <div className="mt-10" data-testid="about-goals">
                <h3 className="font-heading text-xl font-black uppercase flex items-center gap-2"><Target className="w-5 h-5 text-[#29B6E8]" /> Unsere Ziele</h3>
                <ul className="mt-4 space-y-2.5 max-w-3xl">
                  {goals.map((goal, index) => (
                    <li key={index} className="flex gap-3 text-white/80"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#29B6E8]" /><Paragraphs text={goal} className="" /></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Was wir spielen: das Spiele-Regal */}
      <section className="border-t border-white/10 bg-[#0F0F0F]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">WAS WIR SPIELEN</span>
          <h2 className="mt-3 font-heading text-3xl md:text-4xl font-black uppercase">{texts.games_title}</h2>
          <Paragraphs text={texts.games_text} className="mt-4 text-white/70 max-w-3xl leading-relaxed" />
          {games.length > 0 && (
            <div className="mt-8">
              <GamesShelf games={games} joined={joined} testIdPrefix="about-game" />
            </div>
          )}
        </div>
      </section>

      {/* Ansprechpartner */}
      {board.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16" data-testid="about-board">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">ANSPRECHPARTNER</span>
              <h2 className="mt-3 font-heading text-3xl md:text-4xl font-black uppercase">Wer hinter dem Rudel steht</h2>
            </div>
            <Link to="/board" className="inline-flex items-center gap-2 text-xs uppercase tracking-wider font-bold text-[#29B6E8] hover:text-white transition">Ganzer Vorstand <ArrowRight className="w-3 h-3" /></Link>
          </div>
          {/* Kleine Porträts aus einem Guss (#1332): rund, freigestellt auf dem Vereins-Hintergrund, sonst Duoton; die Rolle
              steht ganz da (keine „…“), der Spielername klein darunter. */}
          <Reveal className="tls-reveal-grid mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {board.map((contact) => (
              <div key={contact.id} data-season-anchor="card" className="tls-card tls-reveal-item border border-white/10 rounded-sm bg-[#111] p-4 min-w-0">
                <BoardAvatar contact={{ ...contact, profileUrl: contact.profileUrl || "/board" }} testId={`about-board-${contact.id}`} />
              </div>
            ))}
          </Reveal>
        </section>
      )}

      {/* Offline */}
      <section className={`max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 ${board.length > 0 ? "border-t border-white/10" : ""}`}>
        <div className="grid md:grid-cols-3 gap-5">
          <div className="md:col-span-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">AUCH OFFLINE</span>
            <h2 className="mt-3 font-heading text-3xl md:text-4xl font-black uppercase">{texts.offline_title}</h2>
            <Paragraphs text={texts.offline_text} className="mt-5 text-white/70 leading-relaxed" />
          </div>
          {(texts.offline_items || []).length > 0 && (
            <div className="border border-white/10 rounded-sm bg-[#121212] p-6 self-center" data-testid="about-offline-items">
              <Mountain className="w-7 h-7 text-[#29B6E8] mb-3" />
              <h3 className="font-heading font-black uppercase text-lg">Off-Game Aktivitäten</h3>
              <ul className="mt-3 space-y-1.5 text-sm text-white/70">
                {(texts.offline_items || []).map((item) => <li key={item}>• {item}</li>)}
              </ul>
            </div>
          )}
        </div>
        {offlineEvents.length > 0 && (
          <div className="mt-10" data-testid="about-offline-events">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div className="text-[11px] uppercase tracking-[0.3em] font-bold flex items-center gap-2 text-[#29B6E8]"><CalendarDays className="w-3.5 h-3.5" /> So sah das zuletzt aus</div>
              <Link to="/events" className="inline-flex items-center gap-2 text-xs uppercase tracking-wider font-bold text-white/60 hover:text-[#29B6E8] transition">Alle Events <ArrowRight className="w-3 h-3" /></Link>
            </div>
            <Reveal className="tls-reveal-grid mt-5 grid grid-cols-2 md:grid-cols-3 gap-3">
              {offlineEvents.map((event) => (
                <Link key={event.id} to={`/events/${event.slug || event.id}`} data-testid={`about-offline-event-${event.id}`} className="tls-card tls-reveal-item group relative overflow-hidden rounded-sm border border-white/10 bg-[#111] aspect-[16/10]">
                  <LazyImg src={event.banner_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-[1.02] transition duration-500" />
                  <span className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/90 to-transparent">
                    <span className="block text-[10px] uppercase tracking-widest font-bold text-[#29B6E8]">{formatDate(event.start_date)}</span>
                    <span className="block font-heading font-black uppercase text-sm leading-tight break-words">{event.name}</span>
                  </span>
                </Link>
              ))}
            </Reveal>
          </div>
        )}
      </section>

      {/* CTA */}
      <section className="border-t border-white/10 bg-gradient-to-b from-[#0F0F0F] to-black">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
          <h2 className="font-heading text-3xl md:text-5xl font-black uppercase">{texts.cta_title}</h2>
          <Paragraphs text={texts.cta_text} className="mt-4 text-white/70 max-w-2xl mx-auto" />
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/register" data-testid="about-cta-register" className="tls-btn tls-btn--primary px-7 py-3.5 font-bold uppercase tracking-wider rounded-sm">
              Account erstellen
            </Link>
            <Link to="/membership/join" data-testid="about-cta-join" className="tls-btn tls-btn--primary px-7 py-3.5 font-bold uppercase tracking-wider rounded-sm">
              Mitglied werden
            </Link>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

/** Der Kopf: eigener Titel aus der Verwaltung - ohne ihn „Seit 2023 ein Rudel“ (Gründungsjahr) oder „Wer wir sind“. */
export function heroTitle(texts, organization) {
  const own = String(texts?.hero_title || "").trim();
  if (own) return own;
  return organization?.founded_year ? `Seit ${organization.founded_year} ein Rudel` : "Wer wir sind";
}

// Die Fakten aus den Vereinsdaten - nur, was belegt ist.
export function organizationFacts(organization) {
  const facts = [];
  if (organization?.founded_year) facts.push({ key: "founded", label: `Eingetragener Verein seit ${organization.founded_year}` });
  else if (organization?.legal_name) facts.push({ key: "registered", label: "Eingetragener Verein" });
  if (organization?.nonprofit) facts.push({ key: "nonprofit", label: "Gemeinnützig" });
  if (organization?.zvr_number) facts.push({ key: "zvr", label: `ZVR ${organization.zvr_number}` });
  if (organization?.registered_seat) facts.push({ key: "seat", label: `Sitz in ${organization.registered_seat}` });
  return facts;
}

/** „3 Turniere · 16 Teilnahmen“ - ohne beides „Casual & Community“. */
export function gameLine(game) {
  return gameCountLine(game) || "Casual & Community";
}

// Absätze durch Leerzeilen, **fett** als Hervorhebung - mehr Auszeichnung braucht die Seite nicht.
export function Paragraphs({ text, className = "" }) {
  const blocks = String(text || "").split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  if (!blocks.length) return null;
  return blocks.map((block, index) => (
    <p key={index} className={index === 0 ? className : `${className} mt-4`}>
      {block.split(/(\*\*[^*]+\*\*)/).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i} className="text-white">{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>))}
    </p>
  ));
}

/** Zeitstrahl (#1253): am Handy senkrecht, am PC abwechselnd links und rechts. */
export function Timeline({ entries }) {
  const list = (Array.isArray(entries) ? entries : []).filter((entry) => entry?.year && entry?.title);
  if (!list.length) return null;
  return (
    <section className="border-t border-white/10" data-testid="about-timeline">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Unsere Geschichte</span>
        <h2 className="mt-3 font-heading text-3xl md:text-4xl font-black uppercase">So sind wir gewachsen</h2>
        <ol className="tls-timeline mt-10">
          {list.map((entry, index) => (
            <li key={`${entry.year}-${index}`} className="tls-timeline__item" data-side={index % 2 ? "right" : "left"} data-testid={`about-timeline-${index}`}>
              <span className="tls-timeline__dot" aria-hidden="true" />
              <div className="tls-timeline__card border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
                {entry.image_url ? <LazyImg src={entry.image_url} alt="" className="w-full h-36 sm:h-44 object-cover" /> : null}
                <div className="p-4">
                  <span className="inline-flex rounded-sm bg-[#29B6E8]/15 px-2 py-0.5 text-xs font-black tabular-nums text-[#29B6E8]">{entry.year}</span>
                  <div className="mt-2 font-heading text-lg font-black uppercase leading-tight break-words">{entry.title}</div>
                  {entry.text ? <p className="mt-1 text-sm text-white/65">{entry.text}</p> : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function ClubNumbers({ numbers, shown, trophies }) {
  // Die Zähler, die der Betreiber gewählt hat (#621) - Einzahl, wenn es genau eins ist.
  const items = numberItems(numbers, shown);
  if (!items.length && !trophies.length) return null;
  return (
    <section className="border-b border-white/10 bg-[#080808]/35" data-testid="about-numbers">
      <div className={`max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid gap-8 items-end ${trophies.length ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]" : ""}`}>
        {items.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-[0.3em] font-bold flex items-center gap-2 text-white/60"><Medal className="w-3.5 h-3.5" /> Der Verein in Zahlen</div>
            <Reveal className="tls-reveal-grid mt-5 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {items.map(({ key, label, value }) => <NumberTile key={key} id={key} label={label} value={value} />)}
            </Reveal>
          </div>
        )}
        {trophies.length > 0 && (
          <div data-testid="about-trophies">
            <div className="flex items-end justify-between gap-3 text-[11px] uppercase tracking-[0.3em] font-bold text-white/60">
              <span>Zuletzt auf dem Podest</span>
              <Link to="/references" className="normal-case tracking-normal text-xs font-semibold text-[#29B6E8] hover:text-white inline-flex items-center gap-1">Alle Erfolge <ArrowRight className="w-3 h-3" /></Link>
            </div>
            <div className="mt-4"><TrophyShelf items={trophies} compact testId="about-trophy" /></div>
          </div>
        )}
      </div>
    </section>
  );
}

function NumberTile({ id, label, value }) {
  const [shown, ref] = useCountUp(value);
  return (
    <div ref={ref} className="tls-reveal-item" data-testid={`about-number-${id}`}>
      <div className="font-heading text-3xl md:text-4xl font-black text-white tabular-nums" aria-label={`${value.toLocaleString("de-AT")} ${label}`}>{shown.toLocaleString("de-AT")}</div>
      <div className="text-[10px] uppercase tracking-widest font-bold text-white/45">{label}</div>
    </div>
  );
}

/** Am Vereinsgeburtstag (#644): „Heute vor X Jahren gegründet“ - eine Zeile im Kopf, solange die Saison läuft. */
export function BirthdayLine() {
  const { seasons } = useSeason();
  const birthday = (seasons || []).find((season) => season.key === "club_birthday");
  if (!birthday) return null;
  const years = Number(birthday.data?.years);
  return (
    <p className="mt-6 inline-flex items-center gap-2 border border-[#FFD700]/40 bg-[#FFD700]/10 rounded-sm px-3 py-2 text-sm font-bold text-[#FFD700]" data-testid="about-birthday">
      <Cake className="w-4 h-4 shrink-0" aria-hidden="true" />
      {years > 0 ? `Heute vor ${years} ${years === 1 ? "Jahr" : "Jahren"} gegründet – danke, dass ihr dabei seid!` : "Heute hat der Verein Geburtstag – danke, dass ihr dabei seid!"}
    </p>
  );
}
