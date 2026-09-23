import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { PublicLoadingState } from "@/components/tls/PublicLoadingState";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  KINDS, KIND_COLORS, KIND_LABELS, WEEKDAY_LABELS, dayKey, dayLabel, feedUrls, filterKinds, initialMonth, itemsByDay,
  monthLabel, monthMatrix, parseDay, shiftMonth, timeLabel, upcomingItems,
} from "@/lib/calendar";
import { CalendarDays, ChevronLeft, ChevronRight, Copy, Check, ExternalLink, LogIn } from "lucide-react";

// Kalender (#402): dieselbe Monatsansicht wie in der App (#216) - Punkte je Tag in der Farbe der
// Art, ein goldener Rahmen um Tage mit eigener Anmeldung, darunter die Termine des gewählten Tags.
// Was jemand sieht, entscheidet der Server (/api/calendar); der Abo-Feed ist die öffentliche Sicht.

export default function CalendarPage() {
  useDocumentTitle("Kalender", "Alle Termine von THE LION SQUAD eSports auf einen Blick: Events, Turniere und Fast-Lap-Challenges im Monatskalender, mit Abo für deinen Kalender.");
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [kinds, setKinds] = useState(KINDS);

  const load = useCallback(() => {
    api.get("/calendar")
      .then(({ data }) => setPayload(data && Array.isArray(data.items) ? data : { items: [], signed_in: false }))
      .catch(() => setPayload((current) => current || { items: [], signed_in: false, failed: true }))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["events", "tournaments", "f1"]);

  const items = useMemo(() => filterKinds(payload?.items || [], kinds), [payload, kinds]);
  const byDay = useMemo(() => itemsByDay(items), [items]);
  const shown = month || initialMonth(items);
  const weeks = useMemo(() => monthMatrix(shown.year, shown.month), [shown.year, shown.month]);
  const todayKey = dayKey(new Date());
  const dayItems = selectedDay ? byDay.get(selectedDay) || [] : [];
  const next = useMemo(() => upcomingItems(items), [items]);
  const feed = feedUrls(typeof window !== "undefined" ? window.location.origin : "https://lionsquad.at", payload?.feed_path);

  const selectDay = (key) => {
    setSelectedDay((current) => (current === key ? null : key));
    const date = parseDay(key);
    setMonth({ year: date.getFullYear(), month: date.getMonth() });
  };
  const toggleKind = (kind) => setKinds((current) => (current.includes(kind) ? (current.length > 1 ? current.filter((k) => k !== kind) : current) : [...current, kind]));

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#9F7AEA]">TERMINE</span>
        <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase break-words">Kalender</h1>
        <p className="mt-3 text-white/60 max-w-2xl">
          Events, Turniere und Fast-Lap-Challenges in einem Monat. Tag antippen zeigt die Termine; ein goldener Rahmen heißt: du bist angemeldet.
        </p>

        {loading ? (
          <PublicLoadingState cards={3} className="mt-10" />
        ) : (
          <div className="mt-8 grid lg:grid-cols-3 gap-6 min-w-0">
            <div className="lg:col-span-2 min-w-0">
              <div className="border border-white/10 bg-[#121212] rounded-sm p-4 sm:p-5" data-testid="calendar-grid">
                <div className="flex items-center justify-between gap-3">
                  <button type="button" onClick={() => setMonth(shiftMonth(shown.year, shown.month, -1))} aria-label="Vormonat" data-testid="calendar-prev" className="w-10 h-10 inline-flex items-center justify-center border border-white/10 rounded-sm hover:border-[#9F7AEA]/60 transition">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <h2 className="font-heading text-xl sm:text-2xl font-black uppercase" data-testid="calendar-title">{monthLabel(shown.year, shown.month)}</h2>
                  <button type="button" onClick={() => setMonth(shiftMonth(shown.year, shown.month, 1))} aria-label="Folgemonat" data-testid="calendar-next" className="w-10 h-10 inline-flex items-center justify-center border border-white/10 rounded-sm hover:border-[#9F7AEA]/60 transition">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-widest text-white/40 font-bold">
                  {WEEKDAY_LABELS.map((label) => <div key={label}>{label}</div>)}
                </div>
                <div className="mt-1 space-y-1">
                  {weeks.map((week) => (
                    <div key={week[0].key} className="grid grid-cols-7 gap-1">
                      {week.map((cell) => {
                        const cellItems = byDay.get(cell.key) || [];
                        const cellKinds = Array.from(new Set(cellItems.map((item) => item.kind)));
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
                            className={`min-h-12 sm:min-h-16 rounded-sm border-[1.5px] px-1 pt-1.5 pb-1 flex flex-col items-center gap-1 transition ${selected ? "border-[#9F7AEA] bg-[#9F7AEA]/15" : mine ? "border-[#FFD700]" : "border-transparent hover:border-white/20"} ${cell.inMonth ? "" : "opacity-40"}`}
                          >
                            <span className={`text-xs sm:text-sm font-bold ${cell.key === todayKey ? "text-[#9F7AEA] underline underline-offset-4" : ""}`}>{cell.day}</span>
                            <span className="flex gap-0.5 min-h-1.5">
                              {cellKinds.slice(0, 3).map((kind) => <span key={kind} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: KIND_COLORS[kind] }} data-testid={`calendar-dot-${cell.key}-${kind}`} />)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-white/55">
                  {KINDS.map((kind) => (
                    <button key={kind} type="button" onClick={() => toggleKind(kind)} aria-pressed={kinds.includes(kind)} data-testid={`calendar-kind-${kind}`} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-sm border transition ${kinds.includes(kind) ? "border-white/15 text-white" : "border-transparent text-white/35 line-through"}`}>
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: KIND_COLORS[kind] }} /> {KIND_LABELS[kind]}
                    </button>
                  ))}
                  <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm border-[1.5px] border-[#FFD700]" /> angemeldet</span>
                </div>
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
                  <p className="text-sm text-white/50">Tag antippen, um die Termine zu sehen. Punkte zeigen, was an einem Tag ist.</p>
                )}
              </div>
            </div>

            <aside className="space-y-5 min-w-0">
              <div className="border border-white/10 bg-[#121212] rounded-sm p-5" data-testid="calendar-upcoming">
                <div className="text-[11px] uppercase tracking-widest font-bold text-[#9F7AEA]">Als Nächstes</div>
                {next.length ? (
                  <ul className="mt-3 space-y-2">{next.map((item) => <li key={`${item.kind}-${item.id}`}><ItemRow item={item} withDate /></li>)}</ul>
                ) : (
                  <p className="mt-2 text-sm text-white/50">{payload?.failed ? "Die Termine konnten gerade nicht geladen werden." : "Aktuell steht nichts an."}</p>
                )}
              </div>

              <div className="border border-[#9F7AEA]/40 bg-[#9F7AEA]/5 rounded-sm p-5" data-testid="calendar-subscribe">
                <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-widest font-bold text-[#9F7AEA]"><CalendarDays className="w-3.5 h-3.5" /> Kalender abonnieren</div>
                <p className="mt-2 text-sm text-white/65">Alle öffentlichen Termine in deinem Kalender – Änderungen kommen von selbst nach. Ohne Personendaten, die Adresse darfst du weitergeben.</p>
                <FeedAddress url={feed.https} />
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <a href={feed.webcal} data-testid="calendar-webcal" className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#9F7AEA] text-black font-bold uppercase tracking-wider rounded-sm">
                    <ExternalLink className="w-3.5 h-3.5" /> Im Kalender öffnen
                  </a>
                </div>
                <p className="mt-3 text-xs text-white/40">Google Kalender: „Weitere Kalender“ → „Per URL“ → Adresse einfügen. Apple, Outlook, Thunderbird: „Kalender abonnieren“ → Adresse einfügen.</p>
              </div>

              {!payload?.signed_in && (
                <div className="border border-white/10 rounded-sm p-5 text-sm text-white/65" data-testid="calendar-login-hint">
                  <LogIn className="w-4 h-4 text-[#FFD700]" />
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

function ItemRow({ item, withDate = false }) {
  const when = withDate
    ? new Date(item.start).toLocaleString("de-AT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : timeLabel(item.start);
  return (
    <Link to={item.path} data-testid={`calendar-item-${item.kind}-${item.id}`} className="flex items-start gap-3 border border-white/5 bg-black/15 hover:border-[#9F7AEA]/50 rounded-sm px-3 py-2 transition min-w-0">
      <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: KIND_COLORS[item.kind] }} />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] uppercase tracking-widest text-white/40 font-bold">
          {item.marker === "registration_close" ? "Anmeldeschluss" : KIND_LABELS[item.kind]}{when ? ` · ${when}` : ""}{item.location ? ` · ${item.location}` : ""}
        </span>
        <span className="block text-sm font-bold truncate">{item.title}</span>
        {(item.phase?.label || item.mine) && (
          <span className="block text-xs text-white/50">
            {item.phase?.label}{item.phase?.label && item.mine ? " · " : ""}{item.mine ? <span className="text-[#FFD700]">Angemeldet</span> : null}
          </span>
        )}
      </span>
    </Link>
  );
}

function FeedAddress({ url }) {
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
      <input readOnly value={url} onFocus={(ev) => ev.target.select()} data-testid="calendar-feed-url" className="flex-1 min-w-0 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-xs font-mono" />
      <button type="button" onClick={copy} data-testid="calendar-feed-copy" className="px-3 py-2 border border-white/15 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5 hover:border-[#9F7AEA]/60 transition">
        {copied ? <Check className="w-3.5 h-3.5 text-[#10B981]" /> : <Copy className="w-3.5 h-3.5" />} {copied ? "Kopiert" : "Kopieren"}
      </button>
    </div>
  );
}
