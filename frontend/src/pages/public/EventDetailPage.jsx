import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, formatRequestError, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { PrintLink } from "@/components/tls/print/PrintLink";
import { PublicLoadingState } from "@/components/tls/PublicLoadingState";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { StepBar, eventStep, eventSteps } from "@/components/tls/StepBar";
import { PhaseBadge } from "@/components/tls/PhaseBadge";
import { RichContent } from "@/components/tls/RichContent";
import { useCookieConsent } from "@/components/tls/CookieConsent";
import { ExternalMediaNotice } from "@/components/tls/ExternalMediaNotice";
import { AuthFormAlert } from "@/components/tls/AuthFormFields";
import { FactsBox } from "@/components/tls/FactsBox";
import { EventRecap } from "@/components/tls/EventRecap";
import { FriendsAtEvent } from "@/components/tls/FriendsAtEvent";
import { offerFriendsHint } from "@/lib/friendsHint";
import { offerCalendarHint } from "@/lib/calendarHint";
import { EventBanner } from "@/components/tls/EventBanner";
import { PlayAlongSheet } from "@/components/tls/PlayAlongSheet";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { prefersReducedMotion } from "@/hooks/useLiveChanges";
import { useCanonicalSlugRedirect } from "@/hooks/useCanonicalSlugRedirect";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";
import { renderMarkdownLite } from "@/lib/markdownLite";
import { seoTextPreview } from "@/lib/textPreview";
import { formatWhen } from "@/lib/datetime";
import { eventIsOver, photosComingWindow } from "@/lib/afterEnd";
import { countText, ownSeatsSentence, seatsLabel } from "@/lib/eventSeats";
import { cancelledNotice, eventFacts, eventTabs, stripHeadingEmoji, visibilityChip, whatsOnRows } from "@/lib/eventPage";
import { RETURN_PARAM, offersPlayAlong, returnTournamentPath } from "@/lib/playAlong";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { hasArea } from "@/lib/permissions";
import { eventTypeLabel, normalizeEventType } from "@/lib/eventTypes";
import { formatCents, offerSummary, previewQuote } from "@/lib/pricing";
import { AddToCalendar } from "@/components/tls/AddToCalendar";
import { EventLiveBoard } from "@/pages/public/EventLivePage";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import {
  Calendar, Camera, CheckCircle, Clock, CupSoda, ExternalLink, Flag, Gamepad2, Gift, Glasses, Handshake, Image as ImageIcon, Joystick, Mail, MapPin,
  Monitor, Music, Newspaper, Pizza, Radio, Star, Trophy, UserPlus, Users, Wifi, XCircle,
} from "lucide-react";
import { viennaDate, viennaDateTime, viennaTime } from "@/lib/vienna";
import { ShareButton } from "@/components/tls/ShareButton";

// Die Event-Seite als Startpunkt (#1183) mit Kopf und Bild (#1273) und Fakten-Kasten (#1346). Feste Reihenfolge, gleich in
// der App (EventDetailScreen): 1. Dein Event, 2. Was läuft beim Event, 3. Live verfolgen, 4. Fotos, 5. News, 6. Infos
// (Beschreibung mit Highlights, die Tage, Standorte, Programm), 7. Sponsoren. Der Fakten-Kasten steht am Handy direkt unter
// dem Titel, am PC rechts und bleibt beim Scrollen stehen. „Live“ ist ein Reiter; /events/<slug>/live führt dorthin.

// Der Standardtyp "general" sagt nichts; im Kopf steht dann schlicht "Event".
function eventKindLabel(value) {
  const key = normalizeEventType(value);
  return key && key !== "general" ? eventTypeLabel(key) : "Event";
}

function fullAddress(e) {
  const cityLine = [e.postal_code, e.city].filter(Boolean).join(" ");
  return [e.address, cityLine, e.country].filter(Boolean).join(", ");
}

// Die Karte sucht nur die Adresse; der Name des Veranstaltungsorts steht daneben (#204).
// Der Server liefert `map_query` je Event und je Standort; ältere Antworten fallen auf die Adresse zurück.
function mapQuery(e) {
  return e.map_query || fullAddress(e) || e.location || "";
}

function mapEmbedUrl(e) {
  const query = mapQuery(e);
  return query ? `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed` : "";
}

function mapLinkUrl(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// Highlights (#1346): die feste Liste der Symbole (lib/eventPage.js → HIGHLIGHT_ICONS) mit ihrem Bild.
const HIGHLIGHT_ICON_COMPONENTS = {
  gamepad: Gamepad2, trophy: Trophy, flag: Flag, monitor: Monitor, vr: Glasses, retro: Joystick, music: Music, food: Pizza,
  drink: CupSoda, wifi: Wifi, gift: Gift, users: Users, camera: Camera, star: Star,
};

// Mehrtägig (#884): je Tag eine Karte - der laufende Tag mit LIVE-Punkt, der nächste markiert, vergangene gedimmt.
// Die Texte (Wochentag, Zeiten, Einlass) kommen fertig vom Server, damit Website, App und Discord dasselbe sagen.
function EventDaysBlock({ schedule }) {
  const days = schedule?.days || [];
  const columns = days.length <= 2 ? "md:grid-cols-2" : days.length === 4 ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-3";
  return (
    <div data-testid="event-days">
      <h3 className="font-heading text-xl font-black uppercase mb-1">Die Tage</h3>
      {schedule.now?.text && <p className="text-sm text-white/60 mb-4" data-testid="event-days-now">{schedule.now.text}</p>}
      <ol className={`grid gap-4 ${columns}`}>
        {days.map((day) => {
          const frame = day.state === "running" ? "border-[#FF3B30]/60 bg-[#FF3B30]/5" : day.state === "next" ? "border-[#9F7AEA]/60 bg-[#9F7AEA]/5" : "border-white/10 bg-[#121212]";
          return (
            <li key={day.index} className={`tls-card border rounded-sm p-5 min-w-0 ${frame} ${day.state === "past" ? "opacity-60" : ""}`} data-testid={`event-day-${day.index}`} data-state={day.state}>
              <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-widest font-bold text-[#9F7AEA]">
                <span>Tag {day.index}/{schedule.count}</span>
                {day.state === "running" && <span className="inline-flex items-center gap-1.5 text-[#FF3B30]"><span className="tls-live-dot" aria-hidden="true" /> Läuft</span>}
                {day.state === "next" && <span className="text-white/60">Als Nächstes</span>}
                {day.state === "past" && <span className="text-white/40">Vorbei</span>}
              </div>
              <div className="mt-1 font-heading text-xl font-black uppercase">{day.label}</div>
              <div className="text-sm text-white/80 inline-flex items-center gap-2"><Clock className="w-4 h-4 text-[#9F7AEA] shrink-0" /> {day.time_label}{day.ends_next_day ? " (bis in den nächsten Morgen)" : ""}</div>
              {day.door && <div className="text-xs text-white/50">Einlass {day.door}</div>}
              {day.title && <div className="mt-2 text-sm text-white/90 break-words">{day.title}</div>}
              {day.location_name && <div className="mt-1 text-xs text-white/55 inline-flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 shrink-0" /> {day.location_name}</div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function placeTimeLine(place) {
  if (!place.start_date) return "";
  const start = viennaDateTime(place.start_date, { dateStyle: "medium", timeStyle: "short" });
  const end = place.end_date ? viennaDateTime(place.end_date, { dateStyle: "medium", timeStyle: "short" }) : "";
  return end ? `${start} – ${end}` : start;
}

function sponsorKey(sponsor) {
  const logo = String(sponsor.logo_url || "").trim().toLowerCase();
  if (logo) return `logo:${logo}`;
  const id = String(sponsor.id || "").trim().toLowerCase();
  if (id) return `id:${id}`;
  return `${sponsor.link || ""}|${sponsor.name || ""}`.toLowerCase();
}

function uniqueLogoSponsors(sponsors = []) {
  const seen = new Set();
  return sponsors.filter((sponsor) => {
    if (!sponsor.logo_url) return false;
    const key = sponsorKey(sponsor);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function SectionTitle({ icon: Icon, accent = "#9F7AEA", children }) {
  return (
    <h2 className="font-heading text-2xl font-black uppercase mb-4 inline-flex items-center gap-2">
      {Icon ? <Icon className="w-5 h-5" style={{ color: accent }} aria-hidden="true" /> : null}{children}
    </h2>
  );
}

export default function EventDetailPage() {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const accessToken = searchParams.get("access") || "";
  const { user } = useAuth();
  const [e, setE] = useState(null);
  const [error, setError] = useState(null);
  // „Anmelden“ im Fakten-Kasten öffnet das Formular unter „Dein Event“ und springt dorthin.
  const [registerOpen, setRegisterOpen] = useState(false);
  const yoursRef = useRef(null);
  // „Spielst du auch mit?“ (#1184): nach der Event-Anmeldung die Turniere des Events. Kam man von einem Turnier mit
  // Event-Pflicht (#875, ?turnier=…), geht es danach dorthin zurück.
  const [playAlong, setPlayAlong] = useState(false);
  const returnFrom = searchParams.get(RETURN_PARAM) || "";
  const navigate = useNavigate();
  const { hasConsent } = useCookieConsent();
  const seoDescription = seoTextPreview(e?.description || e?.program, "Gaming Event von THE LION SQUAD eSports in Tirol.");
  useDocumentTitle(e?.name || "Event", seoDescription, {
    image: e?.banner_url,
    type: "event",
    canonical: e?.slug ? `${window.location.origin}/events/${e.slug}` : undefined,
  });
  useCanonicalSlugRedirect(slug, e?.slug, "/events");

  const load = useCallback(() => {
    return api.get(`/events/${slug}`, { params: accessToken ? { access: accessToken } : undefined }).then(({ data }) => {
      setE(data);
      setError(null);
    }).catch((err) => {
      setError(err.response?.status === 403 ? "Dieses Event ist nicht öffentlich zugänglich." : "Event nicht gefunden.");
    });
  }, [slug, accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  useApiInvalidation(load, ["events", "tournaments", "f1", "gallery", "news"]);

  // Aus der News (#1266): ?anmelden=1 öffnet das Anmeldeformular unter „Dein Event“ und springt dorthin - wie der
  // Knopf im Fakten-Kasten. Gäste sehen dort den Weg zur Anmeldung mit Rückweg. Nur einmal je Aufruf.
  const wantsSignup = searchParams.get("anmelden") === "1";
  const signupHandled = useRef(false);
  useEffect(() => {
    if (!wantsSignup || signupHandled.current || !e) return;
    signupHandled.current = true;
    setRegisterOpen(true);
    window.requestAnimationFrame?.(() => yoursRef.current?.scrollIntoView?.({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" }));
  }, [wantsSignup, e]);

  if (error) return (
    <PublicLayout>
      <div className="max-w-2xl mx-auto px-6 py-20 text-center">
        <h1 className="font-heading text-3xl font-black">{error}</h1>
        <Link to="/events" className="mt-6 inline-flex text-[#9F7AEA]">← Zurück zu Events</Link>
      </div>
    </PublicLayout>
  );
  if (!e) return <PublicLayout><PublicLoadingState label="Lade Event" /></PublicLayout>;

  const over = eventIsOver(e);
  const tabs = eventTabs(e, { over });
  const tabParam = searchParams.get("tab");
  const tab = tabs.some((entry) => entry.key === tabParam) ? tabParam : "overview";
  const selectTab = (key) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (key === "overview") next.delete("tab");
      else next.set("tab", key);
      return next;
    }, { replace: true });
  };
  const finishPlayAlong = () => {
    setPlayAlong(false);
    const back = returnTournamentPath(returnFrom);
    if (back) navigate(back);
  };
  const afterRegistration = () => {
    if (offersPlayAlong(e, user)) setPlayAlong(true);
    else finishPlayAlong();
  };
  const openRegistration = () => {
    setRegisterOpen(true);
    if (tab !== "overview") selectTab("overview");
    window.requestAnimationFrame?.(() => yoursRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
  };

  return (
    <PublicLayout>
      <EventHeader e={e} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start min-w-0">
        <aside className="min-w-0 lg:col-start-2 lg:row-start-1 lg:sticky lg:top-24" data-testid="event-facts-column">
          <EventFactsBox e={e} user={user} over={over} onRegister={openRegistration} />
        </aside>
        <div className="min-w-0 lg:col-start-1 lg:row-start-1 space-y-10">
          {tabs.length > 1 && <EventTabs tabs={tabs} value={tab} onChange={selectTab} />}
          {tab === "live" ? (
            <EventLiveBoard event={e} accessToken={accessToken} />
          ) : (
            <EventOverview
              e={e} user={user} over={over} accessToken={accessToken} hasConsent={hasConsent} onChanged={load}
              registerOpen={registerOpen} yoursRef={yoursRef} onLive={() => selectTab("live")} onRegistered={afterRegistration}
            />
          )}
        </div>
      </div>
      {playAlong && <PlayAlongSheet event={e} from={returnFrom} onClose={finishPlayAlong} />}
    </PublicLayout>
  );
}

// Kopf mit Bild (#1273): das Bild als Banner (am Handy im Breitformat über dem Titel, am PC rechts daneben), darunter bzw.
// daneben Titel, Datum, Ort und Status. Die Beschreibung beginnt erst nach dem Kopf (unter „Infos“).
function EventHeader({ e }) {
  const chip = e.visibility && e.visibility !== "public" ? visibilityChip(e.visibility) : "";
  return (
    <header className="border-b border-white/10 bg-[#0A0A0A]" data-testid="event-header">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-8 lg:pt-10 lg:pb-12 min-w-0">
        <Breadcrumbs items={[{ label: "Start", to: "/" }, { label: "Events", to: "/events" }, { label: e.name }]} className="mb-4" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-center min-w-0">
          <EventBanner event={e} eager className="w-full lg:order-2" />
          <div className="min-w-0 lg:order-1">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#9F7AEA]" data-testid="event-kind">{eventKindLabel(e.event_type)}</span>
              <PhaseBadge phase={e.public_phase || e.event_phase} status={e.status || "draft"} size="md" />
              {chip && <span className={`text-[11px] font-bold ${e.visibility === "members" ? "text-[#FFD700]" : "text-white/60"}`} data-testid="event-visibility">{chip}</span>}
              {/* Teilen (#1154): oben rechts; interne Events öffnen sich nur für Mitglieder. */}
              <ShareButton kind="event" id={e.slug || e.id} title={e.name} start={e.start_date} end={e.end_date} className="ml-auto" />
            </div>
            <h1 className="mt-3 font-heading text-4xl md:text-5xl xl:text-6xl font-black uppercase leading-tight break-words">{e.name}</h1>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/70 min-w-0">
              {e.schedule?.multi_day
                ? <span className="inline-flex min-w-0 items-center gap-2" data-testid="event-days-summary"><Calendar className="w-4 h-4 text-[#9F7AEA] shrink-0" /><span className="min-w-0 break-words">{[e.schedule.label, e.schedule.now?.state !== "after" && e.schedule.now?.text].filter(Boolean).join(" · ")}</span></span>
                : e.start_date && <span className="inline-flex min-w-0 items-center gap-2"><Calendar className="w-4 h-4 text-[#9F7AEA] shrink-0" /><span className="min-w-0 break-words">{formatWhen(e.start_date)}</span></span>}
              {(e.locations?.length || 0) > 1
                ? <span className="inline-flex min-w-0 items-center gap-2" data-testid="event-location-count"><MapPin className="w-4 h-4 text-[#9F7AEA] shrink-0" /><span>{e.locations.length} Standorte</span></span>
                : (e.location || e.city) && <span className="inline-flex min-w-0 items-center gap-2"><MapPin className="w-4 h-4 text-[#9F7AEA] shrink-0" /><span className="min-w-0 break-words">{e.location || e.city}</span></span>}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function EventTabs({ tabs, value, onChange }) {
  return (
    <div role="tablist" aria-label="Ansicht" className="flex gap-1 border-b border-white/10" data-testid="event-tabs">
      {tabs.map((entry) => (
        <button
          key={entry.key}
          type="button"
          role="tab"
          aria-selected={value === entry.key}
          onClick={() => onChange(entry.key)}
          data-testid={`event-tab-${entry.key}`}
          className={`-mb-px min-h-11 border-b-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition ${value === entry.key ? "border-[#9F7AEA] text-white" : "border-transparent text-white/50 hover:text-white"}`}
        >
          {entry.key === "live" ? <Radio className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5 text-[#FF3B30]" aria-hidden="true" /> : null}{entry.label}
        </button>
      ))}
    </div>
  );
}

// Der Fakten-Kasten (#1346): Wann, Wo, Eintritt, Mitbringen; darunter „Anmelden“ (wichtig) bzw. der eigene Stand und
// „In den Kalender“ (#1272). Nach dem Ende gibt es keinen Kalender-Knopf mehr (#1221).
function EventFactsBox({ e, user, over, onRegister }) {
  const own = e.own_registration;
  const recap = over && e.status !== "cancelled";
  // Nach dem Event (#1187): „Du warst dabei“ führt zum Rückblick; eine Warteliste von damals steht nicht mehr da.
  // Abgesagt (#2118): kein „Du bist dabei“ mehr - auch nicht für Anmeldungen aus der Zeit vor der Absage-Automatik.
  const activeOwn = own && !["cancelled", "no_show"].includes(own.status) && !(recap && own.status === "waitlist") && e.status !== "cancelled";
  const phaseState = e.public_phase?.state || e.event_phase?.state || e.status;
  const canRegister = e.has_registration && !e.registration_url && !activeOwn && !over
    && (phaseState === "registration_open" || e.access_link?.grants?.includes("register"));
  const loginTarget = typeof window !== "undefined" ? `/login?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}` : "/login";
  const calendarItem = {
    id: e.id, slug: e.slug, kind: "event", title: e.name, start: e.start_date, end: e.end_date,
    location: [e.location, fullAddress(e)].filter(Boolean).join(", ") || null,
    detail: eventKindLabel(e.event_type), url: typeof window !== "undefined" && e.slug ? `${window.location.origin}/events/${e.slug}` : null,
  };
  return (
    <FactsBox rows={eventFacts(e)} testId="event-facts">
      {e.has_registration && e.registration_url && !over ? (
        <a href={e.registration_url} target="_blank" rel="noreferrer" className="tls-btn tls-btn--primary inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs uppercase tracking-wider font-bold rounded-sm" data-testid="event-facts-register">
          Anmelden <ExternalLink className="w-3.5 h-3.5" />
        </a>
      ) : null}
      {activeOwn ? (
        <a href={recap ? "#rueckblick" : "#dein-event"} className="tls-btn tls-btn--secondary inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-sm" data-testid="event-facts-own">
          <CheckCircle className="w-4 h-4" /> {own.status === "waitlist" ? "Warteliste" : recap ? "Du warst dabei" : "Du bist dabei"}
        </a>
      ) : null}
      {canRegister && user ? (
        <button type="button" onClick={onRegister} className="tls-btn tls-btn--primary inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs uppercase tracking-wider font-bold rounded-sm" data-testid="event-facts-register">
          <UserPlus className="w-4 h-4" /> Anmelden
        </button>
      ) : null}
      {canRegister && !user ? (
        <Link to={loginTarget} className="tls-btn tls-btn--primary inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs uppercase tracking-wider font-bold rounded-sm" data-testid="event-facts-register">
          Einloggen zum Anmelden
        </Link>
      ) : null}
      {!over ? <AddToCalendar block days={e.schedule?.multi_day ? e.schedule.days : null} item={calendarItem} /> : null}
    </FactsBox>
  );
}

function EventOverview({ e, user, over, accessToken, hasConsent, onChanged, registerOpen, yoursRef, onLive, onRegistered }) {
  const eventSponsors = uniqueLogoSponsors(e.sponsors || []);
  const organizerName = e.organizer_name || (e.owned_by_club ? "THE LION SQUAD - eSports" : "");
  const photosComing = Boolean(e.photos_coming) && (e.albums || []).every((album) => album.is_empty) && photosComingWindow(e);
  const rows = whatsOnRows(e);
  // Rückblick (#1187): nach dem letzten Event-Tag (nicht bei Absage) statt Anmeldung und „Was läuft“.
  const recap = over && e.status !== "cancelled";
  const cancelled = cancelledNotice(e);
  const singleMap = (e.locations?.length || 0) <= 1 && e.show_map && mapEmbedUrl(e);
  return (
    <div className="space-y-12" data-testid="event-overview">
      {/* Abgesagt (#2118): oben und deutlich - statt Anmeldung oder „Du bist dabei“. */}
      {cancelled && (
        <div role="status" className="border border-[#FF6B6B]/35 bg-[#FF6B6B]/10 rounded-sm px-4 py-3 min-w-0" data-testid="event-cancelled">
          <div className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-wider text-[#FF6B6B]">
            <XCircle className="w-4 h-4 shrink-0" aria-hidden="true" /> Event abgesagt
          </div>
          <p className="mt-1 text-sm text-white/80 break-words">{cancelled}</p>
        </div>
      )}

      {/* Nach dem Ende (#1221): kein Kalender, kein „Live verfolgen“, kein „Display“. Der Rückblick (#1187) steht oben;
          solange seine Daten fehlen, der Satz, wo die Ergebnisse stehen. */}
      {recap && (
        <EventRecap event={e} accessToken={accessToken} fallback={(
          <div className="border border-[#FFD700]/30 bg-[#FFD700]/5 rounded-sm px-4 py-3" data-testid="event-over">
            <div className="text-sm text-white/85">{e.tournaments?.length ? "Das Event ist vorbei – die Ergebnisse stehen bei den Turnieren:" : "Das Event ist vorbei."}</div>
            {!!e.tournaments?.length && (
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                {e.tournaments.map((t) => (
                  <Link key={t.id} to={`/tournaments/${t.slug || t.id}${t.access_link ? accessSuffix(accessToken) : ""}`} className="inline-flex items-center gap-1.5 text-sm font-bold text-[#FFD700] hover:text-white">
                    <Trophy className="w-3.5 h-3.5" /> {t.title}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )} />
      )}

      {/* 1. Dein Event: der eigene Stand (später mit Ticket) - oder die Anmeldung, solange sie offen ist. */}
      {e.has_registration && !recap && !cancelled && (
        <section id="dein-event" ref={yoursRef} className="scroll-mt-24" data-section="yours" data-testid="event-yours">
          <EventRegistrationPanel event={e} user={user} accessToken={accessToken} onChanged={onChanged} open={registerOpen} onRegistered={onRegistered} />
        </section>
      )}

      {/* Freunde beim Event (#1188): nur mit Konto, nur bestätigte Freunde, die es erlauben. */}
      <FriendsAtEvent event={e} user={user} over={over} accessToken={accessToken} />

      {/* 2. Was läuft beim Event: jedes Turnier und jede Fast Lap mit Tag, Uhrzeit, Spielart und dem eigenen Stand. */}
      {!recap && !!rows.length && (
        <section data-section="whatson" data-testid="event-whatson">
          <SectionTitle icon={Trophy} accent="#29B6E8">Was läuft beim Event</SectionTitle>
          <ul className="space-y-2">
            {rows.map((row) => <WhatsOnRow key={`${row.kind}-${row.id}`} row={row} accessToken={accessToken} />)}
          </ul>
        </section>
      )}

      {/* 3. Live verfolgen: führt in den Reiter „Live“; „Display“ nur für die Turnierleitung. */}
      {!over && !!rows.length && (
        <section className="flex flex-wrap gap-3" data-section="live" data-testid="event-live-links">
          <button type="button" onClick={onLive} className="tls-btn tls-btn--secondary inline-flex min-h-11 items-center gap-2 px-4 py-2 text-xs uppercase tracking-wider font-bold rounded-sm" data-testid="event-live-follow">
            <Radio className="w-4 h-4" /> Live verfolgen
          </button>
          {/* Druckansicht (#1283): Tagesplan auf Papier - mit Turnier-Recht auch die Anmeldeliste. */}
          <PrintLink scope="event" slug={e.slug || e.id} parts="tagesplan" accessToken={accessToken} testId="event-print-link" />
          {hasArea(user, "tournaments") && (
            <Link to={`/display/event/${e.id}`} data-testid="event-display-link" className="tls-btn tls-btn--quiet inline-flex items-center gap-2 px-4 py-2 text-xs uppercase tracking-wider font-bold rounded-sm">
              <ExternalLink className="w-4 h-4" /> Display
            </Link>
          )}
        </section>
      )}

      {/* 4. Fotos. Leere Alben (#1224): Besucher sehen nur Alben mit Fotos; ist eines angelegt, aber noch leer, steht bis
          14 Tage nach dem Event „Fotos folgen in den nächsten Tagen“. Die Verwaltung sieht leere Alben mit Hinweis. */}
      {(!!e.albums?.length || photosComing) && (
        <section data-section="photos" data-testid="event-gallery">
          <SectionTitle icon={ImageIcon} accent="#29B6E8">Fotos</SectionTitle>
          {photosComing && (
            <div className="mb-4 border border-[#29B6E8]/30 bg-[#29B6E8]/5 rounded-sm px-4 py-3 text-sm text-white/80" data-testid="event-photos-coming">
              Fotos folgen in den nächsten Tagen.
            </div>
          )}
          {!!e.albums?.length && (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {e.albums.map((a) => (
                <Link key={a.id} to={`/galerie/${a.slug}`} className="tls-card border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
                  <div className="aspect-video bg-[#0A0A0A] overflow-hidden">
                    {a.cover_url ? <img src={resolveMediaUrl(a.cover_url)} alt={a.title} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-8 h-8 text-white/15" /></div>}
                  </div>
                  <div className="p-4">
                    <div className="font-heading font-bold">{a.title}</div>
                    {a.is_empty && <div className="mt-1 text-[10px] uppercase tracking-widest font-bold text-[#FFD700]" data-testid={`event-album-empty-${a.id}`}>leer – für Besucher unsichtbar</div>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 5. News zum Event. */}
      {!!e.news?.length && (
        <section data-section="news" data-testid="event-news">
          <SectionTitle icon={Newspaper} accent="#29B6E8">News zum Event</SectionTitle>
          <div className="grid sm:grid-cols-2 gap-4">
            {e.news.map((n) => (
              <Link key={n.id} to={`/news/${n.slug}`} className="tls-card border border-white/10 rounded-sm bg-[#121212] p-4">
                <div className="text-[10px] uppercase tracking-widest text-white/40">{viennaDate(n.published_at || n.created_at)}</div>
                <div className="font-heading font-bold mt-1">{n.title}</div>
                {n.excerpt && <div className="text-xs text-white/60 mt-1 line-clamp-2">{n.excerpt}</div>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 6. Infos: Beschreibung mit Highlight-Kacheln (statt Emoji-Zwischentiteln), die Tage, Standorte, Programm. */}
      <section className="space-y-8" data-section="infos" data-testid="event-infos">
        <SectionTitle>Infos</SectionTitle>
        {!!e.highlights?.length && (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="event-highlights">
            {e.highlights.map((highlight) => {
              const Icon = HIGHLIGHT_ICON_COMPONENTS[highlight.icon] || Star;
              return (
                <li key={`${highlight.icon}-${highlight.text}`} className="flex items-center gap-2.5 rounded-sm bg-white/[0.04] px-3 py-2.5 min-w-0">
                  <Icon className="w-4 h-4 text-[#9F7AEA] shrink-0" aria-hidden="true" />
                  <span className="text-sm font-bold text-white/90 break-words">{highlight.text}</span>
                </li>
              );
            })}
          </ul>
        )}
        {e.description && <div className="max-w-3xl prose-cms" data-testid="event-description" dangerouslySetInnerHTML={{ __html: renderMarkdownLite(stripHeadingEmoji(e.description)) }} />}
        {e.schedule?.multi_day && <EventDaysBlock schedule={e.schedule} />}
        {(e.locations?.length || 0) > 1 && (
          <div data-testid="event-locations">
            <h3 className="font-heading text-xl font-black uppercase mb-4">Standorte</h3>
            <div className="grid md:grid-cols-2 gap-5">
              {e.locations.map((place, index) => (
                <div key={place.key || index} className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden flex flex-col" data-testid={`event-location-${index}`}>
                  <div className="p-5 space-y-1.5">
                    <div className="text-[11px] uppercase tracking-widest font-bold text-[#9F7AEA]">Standort {index + 1}</div>
                    {place.name && <div className="font-heading text-xl font-black uppercase">{place.name}</div>}
                    {placeTimeLine(place) && <div className="text-sm text-white/75 inline-flex items-center gap-2"><Calendar className="w-4 h-4 text-[#9F7AEA]" /> {placeTimeLine(place)}</div>}
                    {place.door_time && <div className="text-xs text-white/50">Einlass {viennaTime(place.door_time, { timeStyle: "short" })}</div>}
                    {place.address_line && <div className="text-sm text-white/65 inline-flex items-start gap-2"><MapPin className="w-4 h-4 text-[#9F7AEA] shrink-0 mt-0.5" /> <span>{place.address_line}</span></div>}
                    {place.max_participants != null && <div className="text-xs text-white/50 inline-flex items-center gap-2"><Users className="w-3.5 h-3.5" /> {place.max_participants} Plätze</div>}
                    {place.note && <div className="text-sm text-white/60">{place.note}</div>}
                  </div>
                  {e.show_map && place.map_query && hasConsent("external_media") && (
                    <iframe title={`Karte ${place.name || `Standort ${index + 1}`}`} src={`https://www.google.com/maps?q=${encodeURIComponent(place.map_query)}&output=embed`} className="w-full h-56 border-0 border-t border-white/10" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
                  )}
                  {e.show_map && place.map_query && !hasConsent("external_media") && (
                    <div className="p-3 border-t border-white/10">
                      <ExternalMediaNotice service="Google Maps" reason="Die Karte wird erst nach Zustimmung zu externen Medien geladen." url={mapLinkUrl(place.map_query)} accent="#9F7AEA" testId={`event-map-consent-notice-${index}`} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {singleMap && hasConsent("external_media") && (
          <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
            <iframe title={`Karte ${e.name}`} src={mapEmbedUrl(e)} className="w-full h-72 border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
          </div>
        )}
        {singleMap && !hasConsent("external_media") && (
          <ExternalMediaNotice
            service="Google Maps"
            reason="Die Karte wird erst nach Zustimmung zu externen Medien geladen, weil dabei Daten an Google übertragen werden können."
            url={mapLinkUrl(mapQuery(e))}
            accent="#9F7AEA"
            testId="event-map-consent-notice"
          />
        )}
        {e.program && (
          <div>
            <h3 className="font-heading text-xl font-black uppercase mb-4">Programm</h3>
            <RichContent text={e.program} embeds={e.content_embeds || []} className="border border-white/10 bg-[#121212] p-6 rounded-sm text-white/85" />
          </div>
        )}
        {(e.contact || organizerName) && (
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/65" data-testid="event-contact">
            {e.contact && <span className="inline-flex min-w-0 items-center gap-2"><Mail className="w-4 h-4 text-[#9F7AEA] shrink-0" /><span className="min-w-0 break-all">{e.contact}</span></span>}
            {organizerName && (e.organizer_url ? (
              <a href={e.organizer_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-[#29B6E8] hover:underline">
                <ExternalLink className="w-4 h-4" /> {organizerName}
              </a>
            ) : <span className="inline-flex items-center gap-2">Veranstalter: {organizerName}</span>)}
          </div>
        )}
      </section>

      {/* 7. Sponsoren und Partner. */}
      {(!!(e.partners || []).length || !!eventSponsors.length) && (
        <section className="space-y-8" data-section="sponsors" data-testid="event-sponsors">
          {!!(e.partners || []).length && (
            <div data-testid="event-partners">
              <SectionTitle icon={Handshake} accent="#29B6E8">Gemeinsam mit</SectionTitle>
              <div className="flex flex-wrap gap-3">
                {e.partners.map((p) => (
                  <Link key={p.id} to={`/partners/${p.slug || p.id}`} data-testid={`event-partner-${p.slug || p.id}`} className="inline-flex items-center gap-3 border border-white/10 bg-[#101010] rounded-sm px-3 py-2 hover:border-[#29B6E8]/60 transition">
                    {p.logo_url ? <img src={resolveMediaUrl(p.logo_url)} alt="" className="h-8 w-8 object-contain" /> : <Handshake className="h-5 w-5 text-[#29B6E8]" />}
                    <span className="font-heading font-bold uppercase text-sm">{p.name}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {!!eventSponsors.length && (
            <div>
              <SectionTitle>Unterstützt von</SectionTitle>
              <div className="flex flex-wrap items-center gap-8 border-y border-white/10 py-6 min-w-0">
                {eventSponsors.map((s) => (
                  <a key={sponsorKey(s)} href={s.link || "#"} target={s.link ? "_blank" : undefined} rel="noreferrer" aria-label={s.name} className="group inline-flex items-center justify-center min-w-32">
                    <img src={resolveMediaUrl(s.logo_url)} alt="" className="max-h-14 max-w-44 object-contain opacity-80 group-hover:opacity-100 transition" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// Eine Zeile „Was läuft“ (#1183): links Tag und Uhrzeit, dann Titel mit Spielart, rechts der eigene Stand - oder „Anmelden“,
// solange die Anmeldung offen ist, sonst der Zustand. Die ganze Zeile führt auf das Turnier bzw. die Fast Lap.
function WhatsOnRow({ row, accessToken }) {
  const Icon = row.kind === "fastlap" ? Flag : Trophy;
  return (
    <li data-testid={`event-row-${row.kind}-${row.id}`}>
      <Link to={`${row.path}${row.accessLink ? accessSuffix(accessToken) : ""}`} className="tls-card flex items-center gap-3 rounded-sm border border-white/10 bg-[#121212] px-3 py-3 min-w-0">
        <span className="w-16 shrink-0 text-center">
          {row.dayLabel ? <span className="block text-[10px] font-bold uppercase tracking-widest text-[#9F7AEA]" data-testid="embed-event-day">{row.dayLabel}</span> : null}
          <span className="block text-sm font-bold tabular-nums text-white/85">{row.timeLabel || "–"}</span>
        </span>
        <Icon className={`w-4 h-4 shrink-0 ${row.kind === "fastlap" ? "text-[#2DD4BF]" : "text-[#29B6E8]"}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="tls-card__title block font-heading font-bold leading-tight break-words">{row.title}</span>
          <span className="block text-xs text-white/55 truncate">{[row.mode, row.detail].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="shrink-0">
          {row.mine ? (
            <span className="inline-flex items-center gap-1 rounded-sm bg-[#29B6E8]/15 px-2 py-1 text-[11px] font-bold text-[#29B6E8]" data-testid="event-row-mine">
              <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" /> {row.mine.label}{row.mine.team ? ` · ${row.mine.team}` : ""}
            </span>
          ) : row.action === "register" ? (
            <span className="tls-btn tls-btn--primary inline-flex items-center px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm" data-testid="event-row-register">Anmelden</span>
          ) : (
            <PhaseBadge phase={row.phase} status={row.status} />
          )}
        </span>
      </Link>
    </li>
  );
}

const EVENT_REGISTRATION_LABELS = {
  registered: "Angemeldet",
  waitlist: "Warteliste",
  checked_in: "Eingecheckt",
  cancelled: "Storniert",
  no_show: "Nicht erschienen",
};

function EventRegistrationPanel({ event, user, accessToken = "", onChanged, open = false, onRegistered }) {
  const [companionCount, setCompanionCount] = useState(0);
  const [note, setNote] = useState("");
  // Kosten (#318): Positionen und Summe vor dem Absenden; wählbare Positionen als Haken.
  const [selectedPositions, setSelectedPositions] = useState([]);
  const offer = event.offer;
  const quote = offer ? previewQuote(offer, { seats: 1 + Number(companionCount || 0), selected: selectedPositions }) : null;
  const { submitting: saving, submitOnce } = useSubmissionGuard();
  const confirm = useConfirm();
  const [actionError, setActionError] = useState("");
  const summary = event.registration_summary || {};
  const own = event.own_registration;
  const activeOwn = own && !["cancelled", "no_show"].includes(own.status);
  const phaseState = event.public_phase?.state || event.event_phase?.state || event.status;
  const registrationOpen = phaseState === "registration_open";
  const maxCompanions = event.allow_companions ? Number(event.max_companions_per_registration || 0) : 0;
  const loginTarget = typeof window !== "undefined" ? `/login?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}` : "/login";
  const hasRegisterAccess = event.access_link?.grants?.includes("register");
  // Wo die Anmeldung steht (#1081) - nur bei Kosten, ohne sie ist es ein einziger Schritt.
  const steps = eventSteps(event, activeOwn ? own : null);
  const step = eventStep(steps, activeOwn ? own : null);
  const showSteps = !event.registration_url && step >= 0 && (activeOwn || (user && (registrationOpen || hasRegisterAccess)));
  const formRef = useRef(null);

  useEffect(() => {
    setCompanionCount(0);
    setNote("");
    setSelectedPositions([]);
    setActionError("");
  }, [event.id]);

  // „Anmelden“ im Fakten-Kasten: das Formular bekommt den Fokus.
  useEffect(() => {
    if (open) formRef.current?.querySelector("input, textarea, button")?.focus?.({ preventScroll: true });
  }, [open]);

  const register = async (ev) => {
    ev.preventDefault();
    setActionError("");
    const attempt = await submitOnce(async () => {
      await api.post(`/events/${event.id}/registrations`, {
        companion_count: Number(companionCount || 0),
        note: note.trim() || null,
        selected_positions: selectedPositions,
      }, { params: accessToken ? { access: accessToken } : undefined });
      toast.success("Anmeldung gespeichert.");
      await onChanged();
      onRegistered?.();
      // Der einmalige Hinweis direkt nach der ersten Anmeldung (#1188 Teil 2).
      void offerFriendsHint();
      // Der Abo-Hinweis (#1788): nur ohne aktives Abo und nur einmal - der Server entscheidet.
      void offerCalendarHint();
    });
    if (attempt.started && attempt.error) {
      const message = formatRequestError(attempt.error, "Anmeldung konnte nicht gespeichert werden.");
      setActionError(message);
      toast.error(message);
    }
  };

  // Stornieren (#1223): ein leiser Link mit Rückfrage - nur, solange der Server es erlaubt (bis zum Beginn, nicht nach
  // dem Check-in). Der Server prüft beim Stornieren selbst noch einmal.
  const cancel = async () => {
    setActionError("");
    const ok = await confirm({
      title: "Event-Anmeldung stornieren?",
      description: own?.price ? "Deine Anmeldung und dein Kostenbeitrag werden storniert, dein Platz wird frei." : "Deine Anmeldung wird storniert, dein Platz wird frei.",
      confirmLabel: "Stornieren",
      cancelLabel: "Behalten",
      tone: "danger",
    });
    if (!ok) return;
    const attempt = await submitOnce(async () => {
      await api.delete(`/events/${event.id}/registrations/me`);
      toast.success("Anmeldung storniert.");
      await onChanged();
    });
    if (attempt.started && attempt.error) {
      const message = formatRequestError(attempt.error, "Anmeldung konnte nicht storniert werden.");
      setActionError(message);
      toast.error(message);
    }
  };

  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5">
      <div className="text-[11px] uppercase tracking-widest font-bold text-[#9F7AEA]">{activeOwn ? "Dein Event" : "Anmeldung"}</div>
      <h2 className="mt-2 font-heading text-2xl font-black uppercase">{activeOwn ? "Du bist angemeldet" : event.registration_url ? "Registrierung möglich" : "Event-Anmeldung"}</h2>
      {showSteps ? <StepBar steps={steps} current={step} className="mt-3" testId="event-register-steps" /> : null}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniStat label="Reserviert" value={`${summary.reserved_seats || 0}${event.max_participants ? `/${event.max_participants}` : ""}`} />
        <MiniStat label="Anmeldungen" value={summary.registered_count || 0} />
        <MiniStat label="Begleitp." value={summary.companion_count || 0} />
      </div>
      {!!summary.waitlist_count && (
        <div className="mt-2 text-xs text-[#FFD700]">{countText(summary.waitlist_count, "Anmeldung", "Anmeldungen")} auf der Warteliste.</div>
      )}
      {offer && (
        <div className="mt-4 border border-[#FFD700]/30 bg-[#FFD700]/5 rounded-sm p-3 text-sm" data-testid="event-offer">
          <div className="text-[11px] uppercase tracking-widest font-bold text-[#FFD700]">Kosten</div>
          <div className="mt-1 text-white">{offerSummary(offer, 1 + Number(companionCount || 0))}</div>
          <ul className="mt-2 space-y-0.5 text-xs text-white/60">
            {offer.positions.filter((position) => !position.optional).map((position) => (
              <li key={position.key}>{position.label}: {formatCents(position.amount_cents, offer.currency)} {position.basis === "per_person" ? "je Person" : "je Anmeldung"}{position.description ? ` – ${position.description}` : ""}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4 space-y-1 text-sm text-white/65">
        {event.registration_opens_at && <div>Öffnet: {viennaDateTime(event.registration_opens_at, { dateStyle: "medium", timeStyle: "short" })}</div>}
        {event.registration_closes_at && <div>Schließt: {viennaDateTime(event.registration_closes_at, { dateStyle: "medium", timeStyle: "short" })}</div>}
        {summary.spots_left != null && <div>Freie Plätze: {summary.spots_left}</div>}
      </div>
      {event.registration_url ? (
        <a href={event.registration_url} target="_blank" rel="noreferrer" className="tls-btn tls-btn--primary mt-5 inline-flex items-center gap-2 px-4 py-2 text-xs uppercase tracking-wider font-bold rounded-sm">
          Anmelden <ExternalLink className="w-3.5 h-3.5" />
        </a>
      ) : activeOwn ? (
        // Die eigene Anmeldung (#1223): „Du bist dabei“ (oder Warteliste) mit Plätzen in Einzahl und Mehrzahl; „Stornieren“
        // als leiser Link - am Handy unter dem Kasten, ab 640 px rechts im Kasten.
        <div className="mt-5 relative" data-testid="event-own-registration">
        <div className={`border border-[#10B981]/30 bg-[#10B981]/10 rounded-sm p-4 ${own.can_cancel ? "sm:pr-32" : ""}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 text-[#10B981] text-sm font-bold uppercase tracking-wider" data-testid="event-own-status">
              <CheckCircle className="w-4 h-4" /> {own.status === "waitlist" ? EVENT_REGISTRATION_LABELS.waitlist : "Du bist dabei"}
            </span>
          </div>
          <div className="mt-2 text-sm text-white/65" data-testid="event-own-seats">{ownSeatsSentence(own)}</div>
          {own.price && (
            <div className="mt-2 text-sm" data-testid="event-own-price">
              <span className="text-white/65">Dein Kostenbeitrag: </span>
              <strong className="text-white">{formatCents(own.price.total_cents, own.price.currency)}</strong>
              <span className="text-white/45">
                {" · "}
                {own.price.billing_status === "cancelled" ? "storniert"
                  : own.price.billing_status === "paid" ? `Rechnung ${own.price.invoice_ref || ""} bezahlt – danke!`
                    : own.price.invoice_ref && own.price.invoice_status !== "draft" ? `Rechnung ${own.price.invoice_ref} offen – du findest sie unter „Meine Rechnungen“`
                      : "die Rechnung kommt in dein Konto unter „Meine Rechnungen“"}
              </span>
            </div>
          )}
          {own.status === "waitlist" && offer && <div className="mt-1 text-xs text-white/45">Bezahlt wird erst, wenn du nachrückst.</div>}
        </div>
        {own.can_cancel && (
          <button type="button" disabled={saving} onClick={cancel} data-testid="event-cancel-link"
            className="mt-2 sm:mt-0 sm:absolute sm:top-4 sm:right-4 inline-flex items-center gap-1.5 text-xs font-bold text-white/55 underline-offset-4 hover:text-[#FF6B6B] hover:underline disabled:opacity-50">
            <XCircle className="w-3.5 h-3.5" /> Stornieren
          </button>
        )}
        </div>
      ) : !registrationOpen && !hasRegisterAccess ? (
        <div className="mt-5 border border-white/10 rounded-sm p-4 text-sm text-white/55">Die Anmeldung ist aktuell nicht offen.</div>
      ) : !user ? (
        <Link to={loginTarget} className="tls-btn tls-btn--primary mt-5 inline-flex items-center gap-2 px-4 py-2 text-xs uppercase tracking-wider font-bold rounded-sm">
          Einloggen zum Anmelden
        </Link>
      ) : (
        <form ref={formRef} onSubmit={register} className="mt-5 space-y-3" data-testid="event-register-form">
          {event.allow_companions && (
            <label className="block">
              <div className="text-[11px] uppercase tracking-widest text-white/50 font-bold mb-1.5">Begleitpersonen</div>
              <input type="number" min="0" max={maxCompanions} value={companionCount} onChange={(ev) => { setCompanionCount(ev.target.value); setActionError(""); }} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />
              <div className="mt-1 text-xs text-white/40">Maximal {maxCompanions} pro Anmeldung.</div>
            </label>
          )}
          {offer?.positions.some((position) => position.optional) && (
            <fieldset className="border border-white/10 rounded-sm p-3">
              <legend className="text-[11px] uppercase tracking-widest text-white/50 font-bold px-1">Zusätzlich wählbar</legend>
              {offer.positions.filter((position) => position.optional).map((position) => (
                <label key={position.key} className="flex items-center gap-2 text-sm py-1">
                  <input type="checkbox" checked={selectedPositions.includes(position.key)} onChange={(ev) => setSelectedPositions((current) => (ev.target.checked ? [...current, position.key] : current.filter((key) => key !== position.key)))} data-testid={`event-offer-option-${position.key}`} />
                  <span>{position.label} <span className="text-white/50">{formatCents(position.amount_cents, offer.currency)} {position.basis === "per_person" ? "je Person" : "je Anmeldung"}</span></span>
                </label>
              ))}
            </fieldset>
          )}
          {quote && !quote.free && (
            <div className="border border-[#FFD700]/40 rounded-sm p-3 text-sm flex items-baseline justify-between gap-3" data-testid="event-quote">
              <span className="text-white/65">Summe für {1 + Number(companionCount || 0)} Person{1 + Number(companionCount || 0) === 1 ? "" : "en"}</span>
              <strong className="font-heading text-xl text-white">{formatCents(quote.total_cents, quote.currency)}</strong>
            </div>
          )}
          <label className="block">
            <div className="text-[11px] uppercase tracking-widest text-white/50 font-bold mb-1.5">Hinweis optional</div>
            <textarea value={note} onChange={(ev) => { setNote(ev.target.value); setActionError(""); }} rows={3} maxLength={500} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="z.B. komme etwas später" />
          </label>
          <button disabled={saving} data-testid="event-register-submit" className="tls-btn tls-btn--primary inline-flex items-center gap-2 px-4 py-2 text-xs uppercase tracking-wider font-bold rounded-sm disabled:opacity-50">
            <UserPlus className="w-3.5 h-3.5" /> {saving ? "Speichere..." : quote && !quote.free ? `Verbindlich anmelden · ${formatCents(quote.total_cents, quote.currency)}` : "Anmelden"}
          </button>
        </form>
      )}
      {actionError && <div className="mt-4"><AuthFormAlert id="event-registration-error">{actionError}</AuthFormAlert></div>}
      {/* Die Arbeitsseite der Turnierleitung (#1372): Suche, Einlass, Nachricht an alle. */}
      {event.can_check_in && (
        <Link to={`/events/${event.slug || event.id}/leitung`} className="tls-btn tls-btn--secondary mt-4 inline-flex min-h-11 items-center gap-2 px-4 py-2 text-xs uppercase tracking-wider font-bold rounded-sm" data-testid="event-lead-link">
          Anmeldungen &amp; Einlass
        </Link>
      )}
      {!!event.registrations?.length && (
        <div className="mt-6 border-t border-white/10 pt-4">
          <div className="text-[11px] uppercase tracking-widest font-bold text-white/45 mb-2">Angemeldet</div>
          <div className="space-y-1.5">
            {event.registrations.slice(0, 12).map((registration) => (
              <div key={registration.id} className="flex items-center justify-between gap-3 text-sm border border-white/5 bg-black/15 rounded-sm px-3 py-2">
                <span className="truncate">{registration.display_name || "Teilnehmer"}</span>
                <span className="text-xs text-white/45 shrink-0">{seatsLabel(registration)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3">
      <div className="text-[10px] uppercase tracking-widest text-white/40">{label}</div>
      <div className="mt-1 font-heading text-xl font-black">{value}</div>
    </div>
  );
}

function accessSuffix(accessToken) {
  return accessToken ? `?access=${encodeURIComponent(accessToken)}` : "";
}
