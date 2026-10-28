import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { eventTypeLabel } from "@/lib/eventTypes";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Reveal } from "@/components/tls/Reveal";
import { PhaseBadge } from "@/components/tls/PhaseBadge";
import { PublicEmptyState } from "@/components/tls/PublicEmptyState";
import { PublicLoadingState } from "@/components/tls/PublicLoadingState";
import { LazyImg } from "@/components/tls/LazyImg";
import { useOptionalAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { plainTextPreview } from "@/lib/textPreview";
import { FILTERS, LIST_MODES, LIST_MODE_STORAGE_KEY, buildCards, childSummary, isPast, listMode, playLabel } from "@/lib/eventGroups";
import { Calendar, ChevronDown, Flag, MapPin, Trophy, Users as UsersIcon, Crown, Lock } from "lucide-react";
import { formatWhen } from "@/lib/datetime";
import { KIND_COLORS } from "@/lib/categoryColors";
import { scheduleLine } from "@/lib/eventDays";

// Events (#1182): das Event als Klammer um seine Turniere und Fast Laps - eine Karte für die Herbst-LAN, darin jedes
// Turnier mit Tag, Uhrzeit, Spielart und dem eigenen Stand (aufklappbar). Turniere und Fast Laps ohne Event stehen für
// sich. Eine Filterzeile mit „Nur meine“ (#1189); „Turniere im Event“ oder „zusätzlich einzeln“ merkt sich das Gerät.

const VIS_ICON = { members: Crown, internal: Lock };

function storedMode() {
  try {
    return listMode(window.localStorage.getItem(LIST_MODE_STORAGE_KEY));
  } catch {
    return "nested";
  }
}

function rememberMode(mode) {
  try {
    window.localStorage.setItem(LIST_MODE_STORAGE_KEY, mode);
  } catch {
    // Ohne Speicher gilt die Wahl nur bis zum Neuladen.
  }
}

const asList = (data) => (Array.isArray(data) ? data : data?.items || []);

export default function EventsPage() {
  useDocumentTitle("Events", "Gaming Events, Vereinsabende, LAN-Partys, Messen und öffentliche Termine von THE LION SQUAD eSports in Tirol.");
  const auth = useOptionalAuth();
  const signedIn = Boolean(auth?.user);
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState({ events: [], tournaments: [], fastlaps: [] });
  const [mine, setMine] = useState(null);
  const [meta, setMeta] = useState({ types: [], statuses: [] });
  const [typeFilter, setTypeFilter] = useState(searchParams.get("type") || "");
  const [tab, setTab] = useState(searchParams.get("view") === "past" ? "past" : "upcoming"); // upcoming | past
  const [filter, setFilter] = useState(() => (FILTERS.some((f) => f.key === searchParams.get("show")) ? searchParams.get("show") : "all"));
  const [onlyMine, setOnlyMine] = useState(false);
  const [mode, setMode] = useState(storedMode);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.get("/events/meta").then(({ data: body }) => setMeta(body)).catch(() => {}); }, []);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ compact: "true", limit: "90" });
    if (tab === "upcoming") params.set("upcoming", "true");
    Promise.all([
      api.get(`/events?${params.toString()}`).then(({ data: body }) => asList(body)).catch(() => []),
      api.get("/tournaments?compact=true&limit=200&league=exclude").then(({ data: body }) => asList(body)).catch(() => []),
      api.get("/f1/challenges?compact=true&limit=200").then(({ data: body }) => asList(body)).catch(() => []),
    ])
      .then(([events, tournaments, fastlaps]) => setData({ events, tournaments, fastlaps }))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  // Der eigene Stand (#1189) - nur mit Konto, und nur für die Person selbst.
  const loadMine = useCallback(() => {
    if (!signedIn) {
      setMine(null);
      return;
    }
    api.get("/calendar/mine").then(({ data: body }) => setMine(body && typeof body === "object" ? body : null)).catch(() => setMine(null));
  }, [signedIn]);
  useEffect(() => { loadMine(); }, [loadMine]);

  useApiInvalidation(load, ["events", "tournaments", "f1"]);

  useEffect(() => {
    const nextTab = searchParams.get("view") === "past" ? "past" : "upcoming";
    const nextType = searchParams.get("type") || "";
    if (nextTab !== tab) setTab(nextTab);
    if (nextType !== typeFilter) setTypeFilter(nextType);
  }, [searchParams, tab, typeFilter]);

  const updateEventFilters = (patch) => {
    const nextTab = Object.prototype.hasOwnProperty.call(patch, "view") ? patch.view : tab;
    const nextType = Object.prototype.hasOwnProperty.call(patch, "type") ? patch.type : typeFilter;
    const nextShow = Object.prototype.hasOwnProperty.call(patch, "show") ? patch.show : filter;
    setTab(nextTab);
    setTypeFilter(nextType);
    setFilter(nextShow);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (nextTab === "past") params.set("view", "past");
      else params.delete("view");
      if (nextType) params.set("type", nextType);
      else params.delete("type");
      if (nextShow && nextShow !== "all") params.set("show", nextShow);
      else params.delete("show");
      return params;
    }, { replace: true });
  };

  const chooseMode = (value) => {
    setMode(value);
    rememberMode(value);
  };

  const cards = useMemo(() => {
    const events = data.events.filter((e) => {
      if (typeFilter && e.event_type !== typeFilter) return false;
      const phaseState = e.public_phase?.state || e.event_phase?.state || e.status;
      if (tab === "past" && !["completed", "archived", "results_published"].includes(phaseState)) return false;
      return true;
    });
    // Eine Event-Art gewählt: dann geht es um Events - Turniere und Fast Laps ohne Event treten zurück.
    const keep = (item) => !typeFilter && (tab === "past" ? isPast(item) : !isPast(item));
    return buildCards({ events, tournaments: data.tournaments, fastlaps: data.fastlaps }, { mode, filter, onlyMine: signedIn && onlyMine, mine, keep });
  }, [data, filter, mine, mode, onlyMine, signedIn, tab, typeFilter]);
  const filterTypes = (meta.types || []).filter((t) => !meta.primary_types || meta.primary_types.includes(t.k));

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#9F7AEA]">VEREINSEVENTS</span>
        <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase break-words">Events</h1>
        <p className="mt-3 text-white/60 max-w-2xl">
          LAN-Partys, Vereinsabende, Messen, Turniere und Fast Laps. Was zu einem Event gehört, steht in seiner Karte.
        </p>

        <div className="mt-8 flex flex-col md:flex-row gap-3 md:items-center md:justify-between min-w-0">
          <div className="flex flex-wrap gap-2 min-w-0">
            <button onClick={() => updateEventFilters({ view: "upcoming" })} data-testid="events-tab-upcoming" className={`px-4 py-2 text-xs uppercase tracking-wider font-bold rounded-sm transition ${tab === "upcoming" ? "bg-[#9F7AEA] text-black" : "border border-white/10 text-white/60 hover:text-white"}`}>Kommend</button>
            <button onClick={() => updateEventFilters({ view: "past" })} data-testid="events-tab-past" className={`px-4 py-2 text-xs uppercase tracking-wider font-bold rounded-sm transition ${tab === "past" ? "bg-white/15 text-white" : "border border-white/10 text-white/60 hover:text-white"}`}>Vergangen</button>
            <Link to="/calendar" data-testid="events-tab-calendar" aria-label="Kalender" title="Kalender" className="tls-btn tls-btn--quiet px-3 py-2 text-xs uppercase tracking-wider font-bold rounded-sm inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Kalender</span></Link>
          </div>
          <select value={typeFilter} onChange={(e) => updateEventFilters({ type: e.target.value })} data-testid="events-type-filter" className="bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm max-w-full">
            <option value="">Alle Typen</option>
            {filterTypes.map((t) => <option key={t.k} value={t.k}>{t.l}</option>)}
          </select>
        </div>

        {/* Eine Filterzeile (#1182): Alle · Events · Turniere · Fast Laps · Nur meine. */}
        <div className="mt-4 flex flex-wrap items-center gap-2 min-w-0" role="group" aria-label="Was zeigen" data-testid="events-filter">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => updateEventFilters({ show: f.key })} aria-pressed={filter === f.key} data-testid={`events-filter-${f.key}`} className={`tls-btn ${filter === f.key ? "tls-btn--secondary" : "tls-btn--quiet"} px-3 py-1.5 rounded-sm text-xs font-bold uppercase tracking-wider`}>
              {f.label}
            </button>
          ))}
          {signedIn && (
            <button type="button" onClick={() => setOnlyMine((value) => !value)} aria-pressed={onlyMine} data-testid="events-only-mine" className={`tls-btn ${onlyMine ? "tls-btn--honor" : "tls-btn--quiet"} px-3 py-1.5 rounded-sm text-xs font-bold uppercase tracking-wider`}>
              Nur meine
            </button>
          )}
          {filter === "all" && (
            <div role="group" aria-label="Turniere eines Events" className="inline-flex gap-1 sm:ml-auto" data-testid="events-mode">
              {LIST_MODES.map((m) => (
                <button key={m.key} type="button" onClick={() => chooseMode(m.key)} aria-pressed={mode === m.key} data-testid={`events-mode-${m.key}`} className={`tls-btn ${mode === m.key ? "tls-btn--secondary" : "tls-btn--quiet"} px-2.5 py-1.5 rounded-sm text-[11px] font-bold`}>
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <PublicLoadingState cards={6} className="mt-10" />
        ) : cards.length === 0 ? (
          onlyMine && signedIn ? (
            <PublicEmptyState
              title="Hier bist du nirgends dabei"
              description="„Nur meine“ zeigt, wofür du selbst oder dein Team angemeldet bist."
              primaryAction={{ label: "Alle zeigen", onClick: () => setOnlyMine(false) }}
              className="mt-10"
            />
          ) : (
            <PublicEmptyState
              title={tab === "upcoming" ? "Aktuell nichts geplant" : "Nichts Vergangenes in dieser Auswahl"}
              description={tab === "upcoming" ? "Sobald neue Vereinsabende, LANs, Turniere oder Messe-Termine geplant sind, landen sie hier automatisch." : "Ändere die Auswahl oder wechsle zur kommenden Ansicht."}
              primaryAction={tab === "upcoming" ? { to: "/tournaments", label: "Turniere ansehen" } : { label: "Kommende Events", onClick: () => updateEventFilters({ view: "upcoming" }) }}
              secondaryAction={{ to: "/news", label: "News lesen" }}
              className="mt-10"
            />
          )
        ) : (
          <Reveal className="tls-reveal-grid mt-8 grid sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5 items-start min-w-0" data-testid="events-list">
            {cards.map((card) => (card.kind === "event"
              ? <EventCard key={card.key} card={card} meta={meta} />
              : <SingleCard key={card.key} card={card} />))}
          </Reveal>
        )}
      </section>
    </PublicLayout>
  );
}

function MineChip({ state, testId }) {
  if (!state) return null;
  const text = [state.label || "Dabei", state.team_name].filter(Boolean).join(" · ");
  return <span data-testid={testId} className="inline-flex max-w-full truncate rounded-sm border border-brand/50 bg-brand/10 px-1.5 py-0.5 text-[10px] font-bold text-brand">{text}</span>;
}

// Ein Datumsformat (#1307): „Sa 23. Mai · 18:00“, „heute 18:00“.
function whenLine(item) {
  return formatWhen(item.start_date, { fallback: "Termin folgt" });
}

function EventCard({ card, meta }) {
  const e = card.item;
  const [open, setOpen] = useState(false);
  const VIcon = VIS_ICON[e.visibility];
  const typeLabel = eventTypeLabel(e.event_type, meta.types);
  const descriptionPreview = plainTextPreview(e.description);
  const ownChild = card.children.some((row) => row.mine);
  // Die Saison-Deko an Karten (Ketten, Eier) braucht unten ein freies Band: ein Link über die ganze Karte zählt dort als
  // Bedienung. Ohne Turniere ist die Karte darum selbst der Link (wie bisher), mit Turnieren hält sie Link und Knopf.
  const shell = {
    "data-testid": `event-card-${e.slug}`,
    "data-season-perch": "card",
    "data-live": e.public_phase?.state === "live" ? "1" : undefined,
    className: `tls-card tls-reveal-item tls-card--purple group min-w-0 border border-white/10 rounded-sm bg-[#121212] overflow-hidden flex flex-col ${e.public_phase?.state === "live" ? "tls-live-frame" : ""}`,
  };
  const content = (
    <>
      {e.banner_url ? (
        <div className="aspect-video bg-[#0A0A0A] overflow-hidden">
          <LazyImg src={e.banner_url} alt="" sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="w-full h-full object-contain group-hover:scale-[1.02] transition duration-500" />
        </div>
      ) : (
        <div className="aspect-video bg-gradient-to-br from-[#9F7AEA]/20 via-[#0A0A0A] to-[#0A0A0A] flex items-center justify-center">
          <Calendar className="w-10 h-10 text-[#9F7AEA]/40" />
        </div>
      )}
      <div className="p-5 flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 flex-wrap text-[10px] uppercase tracking-widest font-bold">
          <span className="text-[#9F7AEA]">{typeLabel}</span>
          <PhaseBadge phase={e.public_phase || e.event_phase} status={e.status} />
          {VIcon && <VIcon className="w-3 h-3 text-honor" />}
        </div>
        <h3 className="tls-card__title mt-2 font-heading font-black text-lg break-words">{e.name}</h3>
        {card.mine && <div className="mt-2"><MineChip state={card.mine} testId={`event-card-mine-${e.slug}`} /></div>}
        {e.start_date && (
          <div className="mt-2 inline-flex min-w-0 items-center gap-1.5 text-xs text-white/60">
            <Calendar className="w-3 h-3" />
            <span className="min-w-0 truncate" data-testid={e.schedule?.multi_day ? "event-card-days" : undefined}>{scheduleLine(e.schedule) || formatWhen(e.start_date)}</span>
          </div>
        )}
        {e.location && (
          <div className="mt-1 inline-flex min-w-0 items-center gap-1.5 text-xs text-white/60">
            <MapPin className="w-3 h-3 shrink-0" /> <span className="min-w-0 truncate">{e.location}</span>
          </div>
        )}
        {e.max_participants && (
          <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-white/50">
            <UsersIcon className="w-3 h-3" /> {e.registration_summary?.reserved_seats || 0}/{e.max_participants} Plätze
          </div>
        )}
        {e.has_registration && !e.max_participants && (
          <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-white/50">
            <UsersIcon className="w-3 h-3" /> {e.registration_summary?.registered_count || 0} angemeldet
          </div>
        )}
        {descriptionPreview && <p className="mt-3 text-sm text-white/65 line-clamp-2 flex-1">{descriptionPreview}</p>}
      </div>
    </>
  );
  if (!card.children.length) return <Link to={`/events/${e.slug}`} {...shell}>{content}</Link>;
  return (
    <article {...shell}>
      <Link to={`/events/${e.slug}`} data-testid={`event-card-link-${e.slug}`} className="flex flex-col min-w-0 flex-1">
        {content}
      </Link>
      {card.children.length > 0 && (
        <div className="border-t border-white/10">
          <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} data-testid={`event-card-toggle-${e.slug}`} className="tls-btn tls-btn--quiet w-full rounded-none border-0 px-5 py-3 flex items-center justify-between gap-2 text-xs font-bold">
            <span className="min-w-0 truncate">{childSummary(card.children)}</span>
            <span className="inline-flex items-center gap-2 shrink-0">
              {ownChild && !open && <span className="text-brand">Du bist dabei</span>}
              <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
            </span>
          </button>
          {open && (
            <ul className="px-3 pb-3 space-y-1.5" data-testid={`event-card-children-${e.slug}`}>
              {card.children.map((row) => <li key={row.key}><ChildRow row={row} /></li>)}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

function ChildRow({ row }) {
  const item = row.item;
  const Icon = row.kind === "fastlap" ? Flag : Trophy;
  const path = row.kind === "fastlap" ? `/fastlap/${item.slug || item.id}` : `/tournaments/${item.slug || item.id}`;
  const play = playLabel(row);
  return (
    <Link to={path} data-testid={`event-child-${row.kind}-${item.id}`} className="flex items-start gap-2.5 rounded-sm border border-white/5 bg-black/20 hover:border-white/25 px-3 py-2 transition min-w-0">
      <Icon className="mt-0.5 w-3.5 h-3.5 shrink-0" style={{ color: KIND_COLORS[row.kind === "fastlap" ? "fastlap" : "tournament"] }} />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] uppercase tracking-widest text-white/45 font-bold truncate">{[whenLine(item), play].filter(Boolean).join(" · ")}</span>
        <span className="block text-sm font-bold truncate">{item.title}</span>
        {row.mine && <span className="mt-1 block"><MineChip state={row.mine} testId={`event-child-mine-${item.id}`} /></span>}
      </span>
    </Link>
  );
}

function SingleCard({ card }) {
  const item = card.item;
  const isLap = card.kind === "fastlap";
  const Icon = isLap ? Flag : Trophy;
  const path = isLap ? `/fastlap/${item.slug || item.id}` : `/tournaments/${item.slug || item.id}`;
  const play = playLabel(card);
  return (
    <Link
      to={path}
      data-testid={`${card.kind}-card-${item.slug || item.id}`}
      data-season-perch="card"
      className={`tls-card tls-reveal-item ${isLap ? "" : "tls-card--gold"} group min-w-0 border border-white/10 rounded-sm bg-[#121212] overflow-hidden flex flex-col p-5`}
    >
      <div className="flex items-center gap-2 flex-wrap text-[10px] uppercase tracking-widest font-bold">
        <span className="inline-flex items-center gap-1" style={{ color: KIND_COLORS[isLap ? "fastlap" : "tournament"] }}><Icon className="w-3 h-3" /> {isLap ? "Fast Lap" : "Turnier"}</span>
        <PhaseBadge phase={item.public_phase} status={item.status} />
      </div>
      <h3 className="tls-card__title mt-2 font-heading font-black text-lg break-words">{item.title}</h3>
      {card.mine && <div className="mt-2"><MineChip state={card.mine} testId={`${card.kind}-card-mine-${item.id}`} /></div>}
      <div className="mt-2 inline-flex min-w-0 items-center gap-1.5 text-xs text-white/60">
        <Calendar className="w-3 h-3 shrink-0" /> <span className="min-w-0 truncate">{[whenLine(item), play].filter(Boolean).join(" · ")}</span>
      </div>
      {card.event && (
        <div className="mt-1 text-xs text-white/50 truncate" data-testid={`${card.kind}-card-event-${item.id}`}>gehört zu {card.event.name}</div>
      )}
    </Link>
  );
}
