import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { PublicLoadingState } from "@/components/tls/PublicLoadingState";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  KINDS, KIND_COLORS, KIND_LABELS, VIEW_STORAGE_KEY, WEEKDAY_LABELS, agenda, currentMonth, dayLabel, feedUrls, filterKinds, filterMine, itemsByDay,
  monthLabel, monthMatrix, nextAfter, parseDay, preferredView, shiftMonth, spanLabel, splitSpans, startPhrase, timeLabel, upcomingItems,
  weekBars,
} from "@/lib/calendar";
import { CalendarDays, ChevronLeft, ChevronRight, Copy, Check, ExternalLink, KeyRound, LogIn } from "lucide-react";
import { viennaDateTime, viennaDay } from "@/lib/vienna";

// Kalender (#402): dieselbe Monatsansicht wie in der App (#216) - Punkte je Tag in der Farbe der
// Art, ein blauer Rahmen um Tage mit eigener Anmeldung (#1305: Cyan heißt „du“), darunter die Termine des gewählten Tags.
// Was jemand sieht, entscheidet der Server (/api/calendar); der Abo-Feed ist die öffentliche Sicht.
// Seit #1271: öffnet im aktuellen Monat mit „Heute“, Mehrtägiges ist ein Balken über die Tage und in Listen eine Zeile,
// am Handy startet die Liste (letzte Wahl je Gerät). Seit #1190 stehen für Mitglieder Versammlungen und die eigenen
// Helferschichten in Vereinsgold dabei; ein Tipp führt in den Mitgliederbereich. Seit #1189 mit „Nur meine“ und dem persönlichen
// Abo-Link (nur eigene Termine; die Adresse gibt es nur beim Erzeugen, „neu erzeugen“ sperrt die alte).

const CLUB_LABELS = { meeting: "Versammlung", shift: "Helferschicht" };

function storedView() {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberView(view) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Ohne Speicher gilt die Wahl nur bis zum Neuladen.
  }
}

export default function CalendarPage() {
  useDocumentTitle("Kalender", "Alle Termine von THE LION SQUAD eSports auf einen Blick: Events, Turniere und Fast-Lap-Challenges im Monatskalender, mit Abo für deinen Kalender.");
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => currentMonth());
  const [selectedDay, setSelectedDay] = useState(null);
  const [kinds, setKinds] = useState(KINDS);
  const [onlyMine, setOnlyMine] = useState(false);
  const [view, setView] = useState(() => preferredView(storedView(), typeof window !== "undefined" ? window.innerWidth : 0));

  const load = useCallback(() => {
    api.get("/calendar")
      .then(({ data }) => setPayload(data && Array.isArray(data.items) ? data : { items: [], signed_in: false }))
      .catch(() => setPayload((current) => current || { items: [], signed_in: false, failed: true }))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["events", "tournaments", "f1"]);

  const allItems = useMemo(() => payload?.items || [], [payload]);
  const shownKinds = useMemo(() => KINDS.filter((kind) => kind !== "club" || allItems.some((item) => item.kind === "club")), [allItems]);
  const signedIn = Boolean(payload?.signed_in);
  const items = useMemo(() => filterMine(filterKinds(allItems, kinds), signedIn && onlyMine), [allItems, kinds, onlyMine, signedIn]);
  const byDay = useMemo(() => itemsByDay(items), [items]);
  const { spans, singles } = useMemo(() => splitSpans(items), [items]);
  const dotsByDay = useMemo(() => itemsByDay(singles), [singles]);
  const weeks = useMemo(() => monthMatrix(month.year, month.month), [month.year, month.month]);
  const todayKey = viennaDay(new Date());
  const dayItems = selectedDay ? byDay.get(selectedDay) || [] : [];
  const next = useMemo(() => upcomingItems(items), [items]);
  const groups = useMemo(() => agenda(items), [items]);
  const nextHint = useMemo(() => nextAfter(items, month.year, month.month), [items, month.year, month.month]);
  const feed = feedUrls(typeof window !== "undefined" ? window.location.origin : "https://lionsquad.at", payload?.feed_path);

  const selectDay = (key, toggle = true) => {
    setSelectedDay((current) => (toggle && current === key ? null : key));
    const date = parseDay(key);
    setMonth({ year: date.getFullYear(), month: date.getMonth() });
  };
  const goToday = () => {
    setMonth(currentMonth());
    setSelectedDay(todayKey);
  };
  const chooseView = (value) => {
    setView(value);
    rememberView(value);
  };
  // Die letzte sichtbare Art bleibt an - „Verein“ zählt nur, wenn es Vereinstermine gibt.
  const toggleKind = (kind) => setKinds((current) => {
    if (!current.includes(kind)) return [...current, kind];
    return current.filter((k) => shownKinds.includes(k)).length > 1 ? current.filter((k) => k !== kind) : current;
  });

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#9F7AEA]">TERMINE</span>
        <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase break-words">Kalender</h1>
        <p className="mt-3 text-white/60 max-w-2xl">
          Events, Turniere und Fast-Lap-Challenges als Liste oder Monat. Mehrtägiges ist ein Balken; ein blauer Rahmen heißt: du bist angemeldet.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
          <div role="group" aria-label="Ansicht" className="inline-flex gap-1" data-testid="calendar-view">
            {[["list", "Liste"], ["month", "Monat"]].map(([key, label]) => (
              <button key={key} type="button" onClick={() => chooseView(key)} aria-pressed={view === key} data-testid={`calendar-view-${key}`} className={`tls-btn ${view === key ? "tls-btn--secondary" : "tls-btn--quiet"} px-3 py-1.5 rounded-sm text-xs font-bold uppercase tracking-wider`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-white/55">
            {shownKinds.map((kind) => (
              <button key={kind} type="button" onClick={() => toggleKind(kind)} aria-pressed={kinds.includes(kind)} data-testid={`calendar-kind-${kind}`} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-sm border transition ${kinds.includes(kind) ? "border-white/15 text-white" : "border-transparent text-white/35 line-through"}`}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: KIND_COLORS[kind] }} /> {KIND_LABELS[kind]}
              </button>
            ))}
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm border-[1.5px] border-brand" /> angemeldet</span>
          </div>
          {signedIn && (
            <button type="button" onClick={() => setOnlyMine((value) => !value)} aria-pressed={onlyMine} data-testid="calendar-only-mine" className={`tls-btn ${onlyMine ? "tls-btn--honor" : "tls-btn--quiet"} px-3 py-1.5 rounded-sm text-xs font-bold uppercase tracking-wider`}>
              Nur meine
            </button>
          )}
        </div>

        {loading ? (
          <PublicLoadingState cards={3} className="mt-8" />
        ) : (
          <div className="mt-6 grid lg:grid-cols-3 gap-6 min-w-0">
            <div className="lg:col-span-2 min-w-0">
              {view === "list" ? (
                <div className="border border-white/10 bg-[#121212] rounded-sm p-4 sm:p-5" data-testid="calendar-list">
                  {groups.length ? groups.map((group) => (
                    <div key={group.key} className="mt-5 first:mt-0" data-testid={`calendar-list-month-${group.key}`}>
                      <h2 className="font-heading text-lg font-black uppercase">{group.label}</h2>
                      <ul className="mt-3 space-y-2">{group.items.map((item) => <li key={`${item.kind}-${item.id}`}><ItemRow item={item} withDate /></li>)}</ul>
                    </div>
                  )) : (
                    <p className="text-sm text-white/50">{payload?.failed ? "Die Termine konnten gerade nicht geladen werden." : onlyMine && signedIn ? "Du bist gerade bei nichts angemeldet." : "Aktuell steht nichts an."}</p>
                  )}
                </div>
              ) : (
                <>
                  <div className="border border-white/10 bg-[#121212] rounded-sm p-4 sm:p-5" data-testid="calendar-grid">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="font-heading text-xl sm:text-2xl font-black uppercase min-w-0" data-testid="calendar-title">{monthLabel(month.year, month.month)}</h2>
                      <div className="flex items-center gap-2 shrink-0">
                        <button type="button" onClick={() => setMonth(shiftMonth(month.year, month.month, -1))} aria-label="Vormonat" data-testid="calendar-prev" className="w-10 h-10 inline-flex items-center justify-center border border-white/10 rounded-sm hover:border-[#9F7AEA]/60 transition">
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={goToday} data-testid="calendar-today" className="tls-btn tls-btn--quiet h-10 px-3 rounded-sm text-xs font-bold uppercase tracking-wider">
                          Heute
                        </button>
                        <button type="button" onClick={() => setMonth(shiftMonth(month.year, month.month, 1))} aria-label="Folgemonat" data-testid="calendar-next" className="w-10 h-10 inline-flex items-center justify-center border border-white/10 rounded-sm hover:border-[#9F7AEA]/60 transition">
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-widest text-white/40 font-bold">
                      {WEEKDAY_LABELS.map((label) => <div key={label}>{label}</div>)}
                    </div>
                    <div className="mt-1 space-y-1">
                      {weeks.map((week) => (
                        <div key={week[0].key} className="grid grid-cols-7 gap-x-1 gap-y-0.5">
                          {week.map((cell) => {
                            const cellItems = byDay.get(cell.key) || [];
                            const cellKinds = Array.from(new Set((dotsByDay.get(cell.key) || []).map((item) => item.kind)));
                            const mine = cellItems.some((item) => item.mine);
                            const selected = cell.key === selectedDay;
                            return (
                              <button
                                key={cell.key}
                                type="button"
                                onClick={() => selectDay(cell.key)}
                                aria-label={`${cell.day}. ${monthLabel(cell.date.getFullYear(), cell.date.getMonth())}${cellItems.length ? `, ${cellItems.length} Termine` : ""}`}
                                aria-pressed={selected}
                                data-testid={`calendar-day-${cell.key}`}
                                style={{ gridRow: 1 }}
                                className={`min-h-12 sm:min-h-16 rounded-sm border-[1.5px] px-1 pt-1.5 pb-1 flex flex-col items-center gap-1 transition ${selected ? "border-[#9F7AEA] bg-[#9F7AEA]/15" : mine ? "border-brand" : "border-transparent hover:border-white/20"} ${cell.inMonth ? "" : "opacity-40"}`}
                              >
                                <span className={`text-xs sm:text-sm font-bold ${cell.key === todayKey ? "text-[#9F7AEA] underline underline-offset-4" : ""}`}>{cell.day}</span>
                                <span className="flex gap-0.5 min-h-1.5">
                                  {cellKinds.slice(0, 3).map((kind) => <span key={kind} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: KIND_COLORS[kind] }} data-testid={`calendar-dot-${cell.key}-${kind}`} />)}
                                </span>
                              </button>
                            );
                          })}
                          {weekBars(week, spans).map((bar) => <SpanBar key={`${bar.item.kind}-${bar.item.id}-${bar.from}`} bar={bar} />)}
                        </div>
                      ))}
                    </div>
                    {nextHint ? (
                      <button type="button" onClick={() => selectDay(viennaDay(nextHint.start), false)} data-testid="calendar-next-hint" className="tls-btn tls-btn--secondary mt-4 w-full px-3 py-2 rounded-sm text-xs font-bold text-left">
                        Nächster Termin: {startPhrase(nextHint)} – {nextHint.title}
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-5 border border-white/10 bg-[#121212] rounded-sm p-4 sm:p-5" data-testid="calendar-day-items">
                    {selectedDay ? (
                      <>
                        <h3 className="font-heading text-lg font-black uppercase">{dayLabel(selectedDay)}</h3>
                        {dayItems.length ? (
                          <ul className="mt-3 space-y-2">{dayItems.map((item) => <li key={`${item.kind}-${item.id}`}><ItemRow item={item} /></li>)}</ul>
                        ) : (
                          <p className="mt-2 text-sm text-white/50" data-testid="calendar-day-empty">An diesem Tag ist nichts geplant.</p>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-white/50">Tag antippen, um die Termine zu sehen. Punkte zeigen, was an einem Tag ist; Balken, was mehrere Tage dauert.</p>
                    )}
                  </div>
                </>
              )}
            </div>

            <aside className="space-y-5 min-w-0">
              {view === "month" ? (
                <div className="border border-white/10 bg-[#121212] rounded-sm p-5" data-testid="calendar-upcoming">
                  <div className="text-[11px] uppercase tracking-widest font-bold text-[#9F7AEA]">Als Nächstes</div>
                  {next.length ? (
                    <ul className="mt-3 space-y-2">{next.map((item) => <li key={`${item.kind}-${item.id}`}><ItemRow item={item} withDate /></li>)}</ul>
                  ) : (
                    <p className="mt-2 text-sm text-white/50">{payload?.failed ? "Die Termine konnten gerade nicht geladen werden." : "Aktuell steht nichts an."}</p>
                  )}
                </div>
              ) : null}

              <div className="border border-[#9F7AEA]/40 bg-[#9F7AEA]/5 rounded-sm p-5" data-testid="calendar-subscribe">
                <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-widest font-bold text-[#9F7AEA]"><CalendarDays className="w-3.5 h-3.5" /> Kalender abonnieren</div>
                <p className="mt-2 text-sm text-white/65">Alle öffentlichen Termine in deinem Kalender – Änderungen kommen von selbst nach. Ohne Personendaten, die Adresse darfst du weitergeben.</p>
                <FeedAddress url={feed.https} />
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <a href={feed.webcal} data-testid="calendar-webcal" className="tls-btn tls-btn--primary inline-flex items-center gap-1.5 px-3 py-2 font-bold uppercase tracking-wider rounded-sm">
                    <ExternalLink className="w-3.5 h-3.5" /> Im Kalender öffnen
                  </a>
                </div>
                <p className="mt-3 text-xs text-white/40">Google Kalender: „Weitere Kalender“ → „Per URL“ → Adresse einfügen. Apple, Outlook, Thunderbird: „Kalender abonnieren“ → Adresse einfügen.</p>
              </div>

              {signedIn && <PersonalFeed origin={typeof window !== "undefined" ? window.location.origin : "https://lionsquad.at"} />}

              {!payload?.signed_in && (
                <div className="border border-white/10 rounded-sm p-5 text-sm text-white/65" data-testid="calendar-login-hint">
                  <LogIn className="w-4 h-4 text-brand" />
                  <p className="mt-2">Nach dem Login siehst du auch Vereinstermine und deine eigenen Anmeldungen.</p>
                  <Link to="/login?next=%2Fcalendar" className="mt-3 inline-flex text-[#9F7AEA] font-bold uppercase tracking-wider text-xs">Einloggen</Link>
                </div>
              )}
            </aside>
          </div>
        )}
      </section>
    </PublicLayout>
  );
}

/** Ein mehrtägiger Termin als Balken über seine Tage einer Woche (#1271) - in der Farbe seiner Art, eigene mit Goldrand. */
function SpanBar({ bar }) {
  const { item, from, to, lane, continuesBefore, continuesAfter } = bar;
  return (
    <Link
      to={item.path}
      data-testid={`calendar-bar-${item.kind}-${item.id}`}
      aria-label={`${item.title}, ${spanLabel(item)}`}
      title={item.title}
      style={{
        gridColumn: `${from + 1} / ${to + 2}`,
        gridRow: lane + 2,
        backgroundColor: KIND_COLORS[item.kind],
        // Angemeldet (#1305: Cyan heißt „du“) - auf der farbigen Fläche als weißer Rand, Cyan verschwände auf Turnieren.
        boxShadow: item.mine ? "inset 0 0 0 1.5px #FFFFFF" : undefined,
      }}
      className={`block h-5 min-w-0 truncate px-1.5 text-[10px] leading-5 font-bold text-[#0A0A0A] hover:brightness-110 transition ${continuesBefore ? "rounded-l-none" : "rounded-l-sm"} ${continuesAfter ? "rounded-r-none" : "rounded-r-sm"}`}
    >
      {continuesBefore ? "… " : ""}{item.title}
    </Link>
  );
}

function kindLabel(item) {
  if (item.marker === "registration_close") return "Anmeldeschluss";
  if (item.kind === "club") return CLUB_LABELS[item.club_kind] || KIND_LABELS.club;
  return KIND_LABELS[item.kind];
}

function ItemRow({ item, withDate = false }) {
  const when = withDate ? spanLabel(item) : item.all_day ? "ganztägig" : timeLabel(item.start);
  return (
    <Link to={item.path} data-testid={`calendar-item-${item.kind}-${item.id}`} className="flex items-start gap-3 border border-white/5 bg-black/15 hover:border-[#9F7AEA]/50 rounded-sm px-3 py-2 transition min-w-0">
      <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: KIND_COLORS[item.kind] }} />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] uppercase tracking-widest text-white/40 font-bold">
          {kindLabel(item)}{when ? ` · ${when}` : ""}{item.location ? ` · ${item.location}` : ""}
        </span>
        <span className="block text-sm font-bold truncate">{item.title}</span>
        {(item.phase?.label || item.mine) && (
          <span className="block text-xs text-white/50">
            {item.phase?.label}{item.phase?.label && item.mine ? " · " : ""}{item.mine ? <span className="text-brand">Angemeldet</span> : null}
          </span>
        )}
      </span>
    </Link>
  );
}

function FeedAddress({ url, testId = "calendar-feed" }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="mt-3 flex gap-2 min-w-0">
      <input readOnly value={url} onFocus={(ev) => ev.target.select()} data-testid={`${testId}-url`} aria-label="Abo-Adresse" className="flex-1 min-w-0 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-xs font-mono" />
      <button type="button" onClick={copy} data-testid={`${testId}-copy`} className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
        {copied ? <Check className="w-3.5 h-3.5 text-[#10B981]" /> : <Copy className="w-3.5 h-3.5" />} {copied ? "Kopiert" : "Kopieren"}
      </button>
    </div>
  );
}

/**
 * Der persönliche Abo-Link (#1189): nur die eigenen Termine, für die Kalender-App. Gespeichert ist nur ein Hash - die
 * Adresse steht nur direkt nach dem Erzeugen da. „Neu erzeugen“ sperrt die alte Adresse, „Abschalten“ alle.
 */
function PersonalFeed({ origin }) {
  const [status, setStatus] = useState(null);
  const [fresh, setFresh] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    api.get("/calendar/personal")
      .then(({ data }) => setStatus({ active: Boolean(data?.active), created_at: data?.created_at || null, last_used_at: data?.last_used_at || null }))
      .catch(() => setStatus({ active: false }));
  }, []);

  const run = async (action) => {
    setBusy(true);
    setProblem("");
    try {
      await action();
      setConfirming(false);
    } catch {
      setProblem("Das hat gerade nicht geklappt. Bitte später noch einmal.");
    } finally {
      setBusy(false);
    }
  };
  const issue = () => run(async () => {
    const { data } = await api.post("/calendar/personal");
    setFresh(feedUrls(origin, data.path));
    setStatus({ active: true, created_at: data.created_at, last_used_at: null });
  });
  const revoke = () => run(async () => {
    await api.delete("/calendar/personal");
    setFresh(null);
    setStatus({ active: false });
  });

  if (!status) return null;
  return (
    <div className="border border-[#FFD700]/40 bg-[#FFD700]/5 rounded-sm p-5" data-testid="calendar-personal">
      <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-widest font-bold text-[#FFD700]"><KeyRound className="w-3.5 h-3.5" /> Mein persönlicher Link</div>
      <p className="mt-2 text-sm text-white/65">Nur deine Termine: Anmeldungen (auch mit deinem Team), gefahrene Fast Laps, zugesagte Versammlungen und deine Schichten. Die Adresse ist privat – gib sie nicht weiter.</p>
      {fresh ? (
        <>
          <FeedAddress url={fresh.https} testId="calendar-personal-feed" />
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <a href={fresh.webcal} data-testid="calendar-personal-webcal" className="tls-btn tls-btn--primary inline-flex items-center gap-1.5 px-3 py-2 font-bold uppercase tracking-wider rounded-sm">
              <ExternalLink className="w-3.5 h-3.5" /> Im Kalender öffnen
            </a>
          </div>
          <p className="mt-3 text-xs text-white/50" data-testid="calendar-personal-once">Kopier sie jetzt: Wir zeigen sie nur dieses eine Mal.</p>
        </>
      ) : status.active ? (
        <p className="mt-3 text-xs text-white/55" data-testid="calendar-personal-active">
          Dein Link ist aktiv{status.created_at ? ` seit ${viennaDateTime(status.created_at, { dateStyle: "medium" })}` : ""}{status.last_used_at ? `, zuletzt abgerufen ${viennaDateTime(status.last_used_at, { dateStyle: "medium", timeStyle: "short" })}` : ""}. Die Adresse zeigen wir nur beim Erzeugen – brauchst du sie wieder, erzeug eine neue.
        </p>
      ) : null}
      {problem && <p className="mt-3 text-xs text-[#FF3B30]" role="alert">{problem}</p>}
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {!status.active ? (
          <button type="button" onClick={issue} disabled={busy} data-testid="calendar-personal-create" className="tls-btn tls-btn--honor px-3 py-2 rounded-sm font-bold uppercase tracking-wider">Link erzeugen</button>
        ) : confirming ? (
          <>
            <button type="button" onClick={issue} disabled={busy} data-testid="calendar-personal-renew-confirm" className="tls-btn tls-btn--danger px-3 py-2 rounded-sm font-bold uppercase tracking-wider">Ja, neu erzeugen</button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm font-bold uppercase tracking-wider">Abbrechen</button>
            <span className="basis-full text-white/50">Die alte Adresse gilt danach nicht mehr – Kalender damit bekommen keine Termine mehr.</span>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setConfirming(true)} disabled={busy} data-testid="calendar-personal-renew" className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm font-bold uppercase tracking-wider">Neu erzeugen</button>
            <button type="button" onClick={revoke} disabled={busy} data-testid="calendar-personal-revoke" className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm font-bold uppercase tracking-wider">Abschalten</button>
          </>
        )}
      </div>
    </div>
  );
}
