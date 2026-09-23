import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { boardContacts } from "@/lib/memberArea";
import { formatDate } from "@/lib/datetime";
import { useCountUp } from "@/hooks/useCountUp";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { LazyImg } from "@/components/tls/LazyImg";
import { SkeletonDetailHeader } from "@/components/tls/Skeleton";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { ArrowRight, Heart, Users, Trophy, Gamepad2, Mountain, Landmark, Medal, CalendarDays, Star } from "lucide-react";

// Über den Verein (#406): keine Seite mehr aus festem Text. Gründung, Zweck und gemeinnützig
// kommen aus Dolibarr (über den Schalter der Vereinsdaten) oder aus den Handfeldern, die Zahlen
// werden gezählt, die Spiele kommen aus der Verwaltung, die Ansprechpartner aus dem Vorstand,
// „Auch offline“ aus den letzten Vereinsevents - und die Leitbild-Texte pflegt die Redaktion unter
// Admin → Verein → Über uns. Was leer ist, bleibt weg: kein Block mit Platzhaltern.

const PILLAR_ICONS = [Heart, Users, Trophy, Gamepad2];
const NUMBER_LABELS = [["members", "Mitglieder"], ["tournaments", "Veranstaltete Turniere"], ["events", "Veranstaltete Events"], ["participations", "Turnierteilnahmen"], ["achievements", "Vergebene Auszeichnungen"]];

export default function AboutPage() {
  useDocumentTitle(
    "eSports Verein in Tirol",
    "THE LION SQUAD ist ein österreichischer eSports und Gaming Verein aus Tirol mit Community, Events, Turnieren und echtem Zusammenhalt."
  );
  const [about, setAbout] = useState(null);
  const [board, setBoard] = useState([]);
  useEffect(() => {
    api.get("/home/about").then(({ data }) => setAbout(data)).catch(() => setAbout({ texts: {}, organization: {}, numbers: {}, games: [], offline_events: [] }));
    api.get("/board?active_only=true").then(({ data }) => setBoard(boardContacts(data, 4))).catch(() => setBoard([]));
  }, []);

  if (!about) {
    return <PublicLayout><div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20"><SkeletonDetailHeader label="Lade Verein" /></div></PublicLayout>;
  }
  const texts = about.texts || {};
  const organization = about.organization || {};
  const games = Array.isArray(about.games) ? about.games : [];
  const offlineEvents = Array.isArray(about.offline_events) ? about.offline_events : [];
  const facts = organizationFacts(organization);

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-white/10" data-testid="about-hero">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(41,182,232,0.18),transparent_55%)]" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28">
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">{texts.hero_eyebrow || "Der Verein"}</span>
          <h1 className="mt-3 font-heading text-5xl md:text-7xl font-black uppercase leading-[0.95] whitespace-pre-line">{texts.hero_title || organization.name || "THE LION SQUAD"}</h1>
          <Paragraphs text={texts.hero_text} className="mt-6 text-white/70 max-w-3xl text-lg" />
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
      </section>

      <ClubNumbers numbers={about.numbers} />

      {/* Was uns ausmacht */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid md:grid-cols-2 gap-12 items-start">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">WAS UNS AUSMACHT</span>
            <h2 className="mt-3 font-heading text-3xl md:text-4xl font-black uppercase">{texts.values_title}</h2>
            <Paragraphs text={texts.values_text} className="mt-5 text-white/70 leading-relaxed" />
          </div>
          {(texts.pillars || []).length > 0 && (
            <div className="grid grid-cols-2 gap-3" data-testid="about-pillars">
              {(texts.pillars || []).map((label, index) => <Pillar key={label} icon={PILLAR_ICONS[index % PILLAR_ICONS.length]} label={label} />)}
            </div>
          )}
        </div>
      </section>

      {/* Was wird gespielt */}
      <section className="border-t border-white/10 bg-[#0F0F0F]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">WAS WIR SPIELEN</span>
          <h2 className="mt-3 font-heading text-3xl md:text-4xl font-black uppercase">{texts.games_title}</h2>
          <Paragraphs text={texts.games_text} className="mt-4 text-white/70 max-w-3xl leading-relaxed" />
          {games.length > 0 && (
            <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" data-testid="about-games">
              {games.map((game) => (
                <Link key={game.id} to={game.tournaments > 0 ? "/tournaments" : "/esports"} data-testid={`about-game-${game.id}`} className="group border border-white/10 hover:border-[#29B6E8]/50 rounded-sm bg-[#121212] p-4 flex items-center gap-3 min-w-0 transition">
                  {game.logo_url ? (
                    <LazyImg src={game.logo_url} alt="" className="w-12 h-12 rounded-sm object-cover shrink-0" />
                  ) : (
                    <span className="w-12 h-12 rounded-sm bg-[#29B6E8]/10 text-[#29B6E8] inline-flex items-center justify-center shrink-0"><Gamepad2 className="w-5 h-5" /></span>
                  )}
                  <span className="min-w-0">
                    <span className="block font-heading font-black uppercase text-sm truncate group-hover:text-[#29B6E8] transition">{game.name}</span>
                    <span className="block text-[10px] uppercase tracking-widest text-white/40 font-bold">{gameLine(game)}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Ansprechpartner */}
      {board.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16" data-testid="about-board">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">ANSPRECHPARTNER</span>
              <h2 className="mt-3 font-heading text-3xl md:text-4xl font-black uppercase">Wer hinter dem Rudel steht</h2>
            </div>
            <Link to="/board" className="inline-flex items-center gap-2 text-xs uppercase tracking-wider font-bold text-white/60 hover:text-[#FFD700] transition">Ganzer Vorstand <ArrowRight className="w-3 h-3" /></Link>
          </div>
          <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {board.map((contact) => (
              <Link key={contact.id} to={contact.profileUrl || "/board"} data-testid={`about-board-${contact.id}`} className="group flex items-center gap-4 border border-white/10 hover:border-[#FFD700]/50 rounded-sm bg-[#111] p-4 transition min-w-0">
                {contact.avatar ? (
                  <LazyImg src={contact.avatar} alt="" className="w-16 h-16 rounded-sm object-cover shrink-0" />
                ) : (
                  <span className="w-16 h-16 rounded-sm bg-[#FFD700]/15 text-[#FFD700] font-heading font-black text-2xl inline-flex items-center justify-center shrink-0">{(contact.name || "?").slice(0, 1).toUpperCase()}</span>
                )}
                <span className="min-w-0">
                  <span className="block text-[11px] uppercase tracking-widest font-bold text-[#FFD700] truncate">{contact.title}</span>
                  <span className="block font-heading text-lg font-black uppercase leading-tight break-words group-hover:text-[#FFD700] transition">{contact.name}</span>
                </span>
              </Link>
            ))}
          </div>
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
            <div className="mt-5 grid grid-cols-2 md:grid-cols-3 gap-3">
              {offlineEvents.map((event) => (
                <Link key={event.id} to={`/events/${event.slug || event.id}`} data-testid={`about-offline-event-${event.id}`} className="group relative overflow-hidden rounded-sm border border-white/10 hover:border-[#29B6E8]/50 bg-[#111] aspect-[16/10] transition">
                  <LazyImg src={event.banner_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-[1.02] transition duration-500" />
                  <span className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/90 to-transparent">
                    <span className="block text-[10px] uppercase tracking-widest font-bold text-[#29B6E8]">{formatDate(event.start_date)}</span>
                    <span className="block font-heading font-black uppercase text-sm leading-tight truncate">{event.name}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* CTA */}
      <section className="border-t border-white/10 bg-gradient-to-b from-[#0F0F0F] to-black">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
          <h2 className="font-heading text-3xl md:text-5xl font-black uppercase">{texts.cta_title}</h2>
          <Paragraphs text={texts.cta_text} className="mt-4 text-white/70 max-w-2xl mx-auto" />
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/register" data-testid="about-cta-register" className="px-7 py-3.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] transition">
              Account erstellen
            </Link>
            <Link to="/membership/join" data-testid="about-cta-join" className="px-7 py-3.5 border-2 border-[#FFD700] text-[#FFD700] font-bold uppercase tracking-wider rounded-sm hover:bg-[#FFD700] hover:text-black transition">
              Mitglied werden
            </Link>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
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

export function gameLine(game) {
  const parts = [];
  if (game.tournaments > 0) parts.push(`${game.tournaments} ${game.tournaments === 1 ? "Turnier" : "Turniere"}`);
  if (game.references > 0) parts.push(`${game.references} ${game.references === 1 ? "Teilnahme" : "Teilnahmen"}`);
  return parts.length ? parts.join(" · ") : "Casual & Community";
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

function ClubNumbers({ numbers }) {
  const items = NUMBER_LABELS.map(([key, label]) => [key, label, Number(numbers?.[key] || 0)]).filter(([, , value]) => value > 0);
  if (!items.length) return null;
  return (
    <section className="border-b border-white/10 bg-[#080808]/35" data-testid="about-numbers">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-[11px] uppercase tracking-[0.3em] font-bold flex items-center gap-2 text-[#FFD700]"><Medal className="w-3.5 h-3.5" /> Der Verein in Zahlen</div>
        <div className="mt-5 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {items.map(([key, label, value]) => <NumberTile key={key} id={key} label={label} value={value} />)}
        </div>
      </div>
    </section>
  );
}

function NumberTile({ id, label, value }) {
  const [shown, ref] = useCountUp(value);
  return (
    <div ref={ref} data-testid={`about-number-${id}`}>
      <div className="font-heading text-3xl md:text-4xl font-black text-white tabular-nums" aria-label={`${value.toLocaleString("de-AT")} ${label}`}>{shown.toLocaleString("de-AT")}</div>
      <div className="text-[10px] uppercase tracking-widest font-bold text-white/45">{label}</div>
    </div>
  );
}

function Pillar({ icon: Icon, label }) {
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] p-5 hover:border-[#29B6E8]/50 transition">
      {Icon ? <Icon className="w-6 h-6 text-[#29B6E8] mb-3" /> : <Star className="w-6 h-6 text-[#29B6E8] mb-3" />}
      <div className="font-heading font-black uppercase text-sm">{label}</div>
    </div>
  );
}
