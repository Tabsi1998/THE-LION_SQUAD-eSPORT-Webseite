import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, ClipboardCheck, Clock, MonitorPlay, Radio, Shuffle } from "lucide-react";
import { toast } from "sonner";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { useLeagueTrail } from "@/hooks/useLeagueTrail";
import { tournamentCrumbs } from "@/lib/leagueTrail";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatWhen } from "@/lib/datetime";
import { leadFilter, leadLine, leadNames } from "@/lib/tournamentLead";
import { ResultWindow } from "@/components/tls/results/ResultWindow";
import { ResultUndoBar, useResultUndo } from "@/components/tls/results/ResultUndoBar";
import { DisputeCard } from "@/components/tls/results/DisputeCard";
import { StationQueueBoard } from "@/components/tls/live/StationQueueBoard";

// Turnierleitung am Handy (#1156): /tournaments/<slug>/leitung - nur für die Turnierleitung dieses Turniers. Erster
// Reiter „Braucht Aufmerksamkeit“ (#1160): was hängt, mit dem passenden Knopf - Erledigtes verschwindet von selbst; jeder
// Fall hat eine eigene Adresse (?fall=…). Reiter „Ergebnisse“: alle offenen Spiele, zuerst was fehlt, dann nach
// Station; Filter „Läuft“ und „Ergebnis fehlt“.
// „Eintragen“ öffnet das Ergebnis-Fenster (#1370), danach 10 Sekunden „Rückgängig“. Die Verwaltung bleibt zum
// Vorbereiten - die Live-Werkzeuge stehen hier.
// Reiter „Stationen“ (#1556, nur vor Ort): die Warteschlange je Station - läuft mit Spielzeit-Uhr, als Nächstes mit
// „Aufrufen“ und „Gestartet“, danach. Die Reihenfolge und den Verzug rechnet der Server (GET …/live-queue).

const FILTERS = [
  ["all", "Alle offenen", "open"],
  ["running", "Läuft", "running"],
  ["missing", "Ergebnis fehlt", "missing"],
];

export default function TournamentLeadPage() {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const trail = useLeagueTrail(data?.tournament);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [openId, setOpenId] = useState(searchParams.get("spiel") || "");
  const [deciding, setDeciding] = useState(false);
  const [tab, setTab] = useState(null);
  const [movingId, setMovingId] = useState("");
  const [queue, setQueue] = useState(null);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [busyStation, setBusyStation] = useState("");
  // Eigene Adresse je Fall (#1158, #1160): ?fall=<id> springt zum Fall.
  const fall = searchParams.get("fall") || "";
  const scrolledTo = useRef("");

  const load = useCallback(async () => {
    try {
      const { data: view } = await api.get(`/tournaments/${encodeURIComponent(slug)}/lead`);
      setData(view);
      setError(null);
    } catch (err) {
      setError({ status: err.response?.status || 0, detail: formatApiError(err.response?.data?.detail) });
    }
  }, [slug]);

  // Die Warteschlange vor Ort (#1556) - online gibt es sie nicht (`applies: false`), dann fehlt der Reiter.
  const loadQueue = useCallback(async () => {
    try {
      const { data: view } = await api.get(`/tournaments/${encodeURIComponent(slug)}/live-queue`);
      setQueue(view?.applies ? view : null);
    } catch {
      setQueue(null);
    } finally {
      setQueueLoaded(true);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadQueue(); }, [loadQueue]);
  // Nur Änderungen dieses Turniers und - wegen der geteilten Stationen - der anderen Turniere seines Events (#1801). Bis
  // das Turnier geladen ist, jede; ohne sichtbares Event jede eines Turniers mit Event.
  const tournamentId = data?.tournament?.id;
  const eventId = data?.tournament?.event_id;
  useLiveRefresh(load, ["matches", "matches-v2", "tournaments", "stations"], { fallbackMs: 15000, tournamentId, eventId });
  // Die Prognose wandert auch ohne Ereignis mit der Zeit - einmal je Minute nachfragen.
  useLiveRefresh(loadQueue, ["matches", "matches-v2", "tournaments", "stations"], { fallbackMs: 15000, pollMs: 60000, tournamentId, eventId });
  const undo = useResultUndo({ onDone: load });
  useDocumentTitle(data?.tournament?.title ? `Turnierleitung · ${data.tournament.title}` : "Turnierleitung", "Turnierleitung: Ergebnisse eintragen und offene Spiele im Blick.", { robots: "noindex, nofollow" });

  const matches = useMemo(() => data?.matches || [], [data]);
  const shown = useMemo(() => matches.filter((item) => leadFilter(item, filter)), [matches, filter]);
  const everyone = useMemo(() => [...matches, ...(data?.recent || [])], [matches, data]);
  const opened = everyone.find((item) => item.id === openId) || null;
  const attention = useMemo(() => data?.attention || [], [data]);
  // Show-Auslosung (#1590): „Auslosung bereit · N Namen“ - ein Fall wie jeder andere, mit „Jetzt auslosen“.
  const draws = useMemo(() => data?.draws || [], [data]);
  const byId = useMemo(() => Object.fromEntries(matches.map((item) => [item.id, item])), [matches]);
  const cases = attention.length + draws.length;
  // Erst entscheiden, wenn klar ist, ob es vor Ort eine Warteschlange gibt - sonst springt der Reiter nach dem Laden.
  const activeTab = tab || (fall || cases ? "attention" : queue ? "stations" : queueLoaded ? "results" : "");
  const freeStations = (data?.stations || []).filter((station) => station.status !== "broken" && !station.busy);

  const drawNow = async (card) => {
    setDeciding(true);
    try {
      await api.post(`/tournaments/${encodeURIComponent(slug)}/stages/${card.stage_id}/draw`, { group: card.group });
      toast.success(`${card.label}: ausgelost.`);
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Auslosen hat nicht geklappt.");
    } finally {
      setDeciding(false);
    }
  };

  // Umlegen (#1160): die wartenden Spiele einer defekten Station auf eine freie Station legen.
  const moveTo = async (item, stationId) => {
    setDeciding(true);
    try {
      for (const matchId of item.match_ids || []) await api.patch(`/matches/${matchId}`, { station_id: stationId });
      toast.success("Umgelegt.");
      setMovingId("");
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Umlegen hat nicht geklappt.");
    } finally {
      setDeciding(false);
    }
  };

  useEffect(() => {
    if (!fall || !data || scrolledTo.current === fall) return;
    const target = document.getElementById(`fall-${fall}`);
    if (target) {
      scrolledTo.current = fall;
      target.scrollIntoView?.({ block: "center" });
    }
  }, [fall, data]);

  // Aufrufen und Gestartet (#1556): zwei Helfer zugleich - der Server nimmt genau einen, der andere sieht den neuen Stand.
  const operateStation = async (kind, station, entry) => {
    setBusyStation(station.id);
    try {
      const { data: done } = await api.post(`/tournaments/${encodeURIComponent(slug)}/live-queue/${kind}`, { station_id: station.id, match_id: entry.match_id });
      const where = station.station_text || station.name;
      if (kind === "call") toast.success(done?.idempotent_replay ? `War schon an ${where} aufgerufen.` : `Aufgerufen an ${where} – die Spieler bekommen Bescheid.`);
      else toast.success(done?.idempotent_replay ? "Läuft bereits." : `Gestartet an ${where} – die Uhr läuft.`);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Das hat nicht geklappt. Bitte neu laden.");
    } finally {
      setBusyStation("");
      await Promise.all([loadQueue(), load()]);
    }
  };

  // Streitfall entscheiden (#1158): „Ergebnis bleibt“ mit einem Tipp - beide Seiten bekommen die Entscheidung.
  const keepResult = async (item, note) => {
    setDeciding(true);
    try {
      await api.post(`/matches/${item.id}/dispute/decision`, { decision: "keep", note });
      toast.success("Entschieden – beide Seiten bekommen Bescheid.");
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Entscheidung konnte nicht gespeichert werden.");
    } finally {
      setDeciding(false);
    }
  };

  // „Nicht erschienen?“ (#1551): Frist um - die fehlende Seite verliert dieses Spiel kampflos, oder die Frist läuft weiter.
  // Im Lauf mit mehr als zwei Spielern (#1823) wird nur die Person markiert - der Lauf bleibt offen (Stand nicht „forfeit“).
  const decideNoShow = async (item, body) => {
    setDeciding(true);
    try {
      const { data } = await api.post(`/tournaments/${encodeURIComponent(slug)}/lead/no-show/${item.match_id}`, body);
      const heatOpen = Boolean(data?.status) && data.status !== "forfeit";
      toast.success(body.action === "extend" ? `Frist um ${body.minutes} Minuten verlängert.`
        : heatOpen ? "Als nicht erschienen markiert – der Lauf bleibt offen." : "Kampflos gewertet – beide Seiten bekommen Bescheid.");
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Das hat nicht geklappt.");
    } finally {
      setDeciding(false);
    }
  };

  const openEntry = (id) => {
    setOpenId(id);
    const next = new URLSearchParams(searchParams);
    next.set("spiel", id);
    setSearchParams(next, { replace: true });
  };
  const closeEntry = () => {
    setOpenId("");
    const next = new URLSearchParams(searchParams);
    next.delete("spiel");
    setSearchParams(next, { replace: true });
  };

  const tournamentUrl = `/tournaments/${data?.tournament?.slug || slug}`;
  if (error) {
    return (
      <PublicLayout>
        <section className="max-w-3xl mx-auto px-4 py-16 text-center" data-testid="lead-denied">
          <h1 className="font-heading text-2xl font-black uppercase">Turnierleitung</h1>
          <p className="mt-3 text-white/60">{error.status === 401 || !user ? "Bitte melde dich an – diese Ansicht ist für die Turnierleitung." : error.detail || "Diese Ansicht ist nur für die Turnierleitung dieses Turniers."}</p>
          {!user ? <Link to={`/login?next=/tournaments/${slug}/leitung`} className="tls-btn tls-btn--primary mt-6 inline-flex px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold">Anmelden</Link> : <Link to={tournamentUrl} className="tls-btn tls-btn--secondary mt-6 inline-flex px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold">Zum Turnier</Link>}
        </section>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-8 pb-28" data-testid="lead-page">
        <Breadcrumbs items={tournamentCrumbs(data?.tournament, trail, { tournamentUrl, current: { label: "Turnierleitung" } })} className="mb-4" />
        <div className="text-[11px] uppercase tracking-[0.3em] text-[#FFD700] font-bold">Turnierleitung</div>
        <h1 className="mt-1 font-heading text-2xl md:text-4xl font-black uppercase [overflow-wrap:anywhere]">{data?.tournament?.title || "…"}</h1>

        <div className="mt-6 flex items-center gap-1 tls-swipe pb-0 border-b border-white/10" role="tablist" aria-label="Turnierleitung">
          {[["attention", <><span className={queue ? "hidden sm:inline" : ""}>Braucht </span>Aufmerksamkeit ({cases})</>, AlertTriangle], ...(queue ? [["stations", "Stationen", MonitorPlay]] : []), ["results", "Ergebnisse", ClipboardCheck]].map(([key, label, Icon]) => (
            <button key={key} type="button" role="tab" aria-selected={activeTab === key} onClick={() => setTab(key)} className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 sm:gap-2 whitespace-nowrap border-b-2 px-2 sm:px-3 text-xs sm:text-sm font-bold uppercase tracking-wider ${activeTab === key ? "border-[#29B6E8] text-white" : "border-transparent text-white/50"}`} data-testid={`lead-tab-${key}`}>
              <Icon className={`${queue ? "hidden sm:block" : ""} w-4 h-4 shrink-0 ${key === "attention" && cases ? "text-[#FFD700]" : "text-[#29B6E8]"}`} /> {label}
            </button>
          ))}
        </div>

        {activeTab === "stations" && queue ? (
          <div className="mt-5" data-testid="lead-stations">
            <StationQueueBoard queue={queue} busyKey={busyStation} onCall={(station, entry) => operateStation("call", station, entry)} onStart={(station, entry) => operateStation("start", station, entry)} />
            <p className="mt-4 text-xs text-white/40">Die Reihenfolge rechnet der Server aus Plan, Linien und Stationen – wird eine Station frei, rückt das nächste bereite Spiel nach. „Aufrufen“ schickt den Spielern „Du bist dran“; „nicht erschienen“ greift nach der Frist ab dem Aufruf.</p>
          </div>
        ) : null}

        {!activeTab ? <div className="py-10 text-center text-white/40">Wird geladen …</div> : null}

        {activeTab === "attention" ? (
          <div className="mt-5 space-y-3" data-testid="lead-attention">
            {data && cases === 0 ? <div className="rounded-sm border border-white/10 bg-[#121212] p-6 text-center text-white/50" data-testid="lead-attention-empty">Gerade hängt nichts.</div> : null}
            {draws.map((card) => <DrawCard key={card.id} card={card} now={data?.now} highlighted={fall === card.id} busy={deciding} onDraw={() => drawNow(card)} />)}
            {attention.map((item) => (item.kind === "dispute" && byId[item.match_id]?.dispute ? (
              <DisputeCard key={item.id} item={byId[item.match_id]} busy={deciding} highlighted={fall === item.id} onKeep={(note) => keepResult(byId[item.match_id], note)} onChange={() => openEntry(item.match_id)} />
            ) : (
              <AttentionRow
                key={item.id}
                item={item}
                highlighted={fall === item.id}
                busy={deciding}
                canEnter={Boolean(byId[item.match_id]?.can_enter)}
                moving={movingId === item.id}
                stations={freeStations}
                onEnter={() => openEntry(item.match_id)}
                onMove={() => setMovingId(movingId === item.id ? "" : item.id)}
                onMoveTo={(stationId) => moveTo(item, stationId)}
                onNoShow={(body) => decideNoShow(item, body)}
              />
            )))}
            <p className="text-xs text-white/40">Erledigtes verschwindet von selbst. Bei neuen Fällen kommt eine Benachrichtigung.</p>
          </div>
        ) : null}

        {activeTab === "results" ? (<>
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-sm border border-white/10 bg-white/5 p-1" role="group" aria-label="Filter" data-testid="lead-filters">
          {FILTERS.map(([key, label, count]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={`min-h-[40px] rounded-sm text-[11px] sm:text-xs font-bold uppercase tracking-wider ${filter === key ? "bg-[#29B6E8] text-black" : "text-white/60"}`} data-testid={`lead-filter-${key}`}>
              {label} ({data?.counts?.[count] ?? 0})
            </button>
          ))}
        </div>
        <div className="mt-4 text-[11px] font-bold uppercase tracking-widest text-white/40">Zuerst, was fehlt · dann nach Station</div>

        <div className="mt-2 space-y-2" data-testid="lead-list">
          {!data ? <div className="py-10 text-center text-white/40">Wird geladen …</div> : null}
          {data && shown.length === 0 ? <div className="rounded-sm border border-white/10 bg-[#121212] p-6 text-center text-white/50" data-testid="lead-empty">Hier ist gerade nichts offen.</div> : null}
          {shown.map((item) => <LeadRow key={item.id} item={item} onEnter={() => openEntry(item.id)} />)}
        </div>

        {(data?.recent || []).length ? (
          <div className="mt-8">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/40">Zuletzt eingetragen</div>
            <div className="mt-2 space-y-2" data-testid="lead-recent">
              {data.recent.map((item) => (
                <div key={item.id} className="flex items-center gap-3 rounded-sm border border-white/10 bg-[#121212] p-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-white/45 truncate">{item.stage_name ? `${item.stage_name} · ` : ""}{item.label}</div>
                    <div className="text-sm font-bold text-white truncate">{item.result_summary || leadNames(item)}</div>
                  </div>
                  {item.can_enter ? (
                    <button type="button" onClick={() => openEntry(item.id)} className="tls-btn tls-btn--quiet shrink-0 min-h-[40px] px-3 py-2 rounded-sm text-[11px] uppercase tracking-wider font-bold" data-testid={`lead-correct-${item.id}`}>Korrigieren</button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        </>) : null}
        <p className="mt-6 text-xs text-white/40">Hier stehen nur Spiele, für die du eingeteilt bist. Jede Eingabe steht im Protokoll (wer, wann, was).</p>
      </section>

      {opened && opened.can_enter ? <ResultWindow key={opened.id} entry={opened} onClose={closeEntry} onSaved={undo.start} /> : null}
      <ResultUndoBar undo={undo} />
    </PublicLayout>
  );
}

/** Restzeit bis zum automatischen Los: ganze Minuten, aus der Server-Uhr (`now`) weitergezählt. */
export function drawCountdown(card, serverNow, clientNow = Date.now()) {
  const due = card?.due_at ? new Date(card.due_at).getTime() : NaN;
  const base = serverNow ? new Date(serverNow).getTime() : NaN;
  if (Number.isNaN(due)) return "";
  // Die Server-Uhr gilt; was seit dem Laden vergangen ist, zählt der Browser dazu.
  const elapsed = Number.isNaN(base) ? 0 : Math.max(0, clientNow - Math.min(base, clientNow));
  const left = Math.ceil((due - (Number.isNaN(base) ? clientNow : base + elapsed)) / 60000);
  if (left <= 0) return "der Server lost jeden Moment selbst";
  return `automatisch in ${left} Min.`;
}

/** Wohin gelost wird (#1829): „nach Runde 1 → Loser Runde 1 (LA, LB)“ - die Zielrunde heißt wie im Baum. */
export function drawTargetText(card) {
  const keys = (card?.match_keys || []).join(", ");
  return `nach ${card?.label} → ${card?.round_label ? `${card.round_label} (${keys})` : keys}`;
}

/** Show-Auslosung (#1590): der Topf steht - die Leitung lost mit einem Tipp, sonst der Server nach der Frist. */
function DrawCard({ card, now, highlighted, busy, onDraw }) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const names = card.pot || [];
  return (
    <div id={`fall-${card.id}`} className={`rounded-sm border bg-surface-1 p-3 ${highlighted ? "border-honor/70 ring-2 ring-honor/40" : "border-brand/45"}`} data-testid={`lead-draw-${card.group}`}>
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-14 shrink-0 items-center justify-center rounded-sm border border-brand/40 text-brand" aria-hidden="true">
          <Shuffle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-white">Auslosung bereit · {card.pot_size} {card.pot_size === 1 ? "Name" : "Namen"}</div>
          <div className="text-xs text-white/55 [overflow-wrap:anywhere]">{card.stage_name ? `${card.stage_name} · ` : ""}{drawTargetText(card)}</div>
          <div className="text-[11px] text-brand" data-testid={`lead-draw-countdown-${card.group}`}>{drawCountdown(card, now, tick)}</div>
        </div>
        {card.can_draw ? (
          <button type="button" disabled={busy} onClick={onDraw} className="tls-btn tls-btn--primary shrink-0 min-h-[44px] px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold" data-testid={`lead-draw-now-${card.group}`}>Jetzt auslosen</button>
        ) : null}
      </div>
      {names.length ? (
        <ul className="mt-3 flex flex-wrap gap-1.5 border-t border-white/10 pt-3" aria-label="Im Topf" data-testid={`lead-draw-pot-${card.group}`}>
          {names.map((name, index) => (
            <li key={`${name}-${index}`} className="max-w-full rounded-sm border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-white/85 [overflow-wrap:anywhere]">{name}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function AttentionRow({ item, highlighted, busy, canEnter, moving, stations, onEnter, onMove, onMoveTo, onNoShow }) {
  const bad = item.kind === "station_broken";
  return (
    <div id={`fall-${item.id}`} className={`rounded-sm border bg-[#121212] p-3 ${highlighted ? "border-[#FFD700]/70 ring-2 ring-[#FFD700]/40" : bad ? "border-[#FF3B30]/45" : "border-[#FFD700]/45"}`} data-testid={`lead-case-${item.id}`}>
      <div className="flex items-center gap-3">
        <div className={`flex h-12 w-14 shrink-0 items-center justify-center rounded-sm border text-center text-[10px] font-bold uppercase leading-tight ${bad ? "border-[#FF3B30]/50 text-[#FF6B60]" : "border-[#29B6E8]/40 text-[#29B6E8]"}`}>
          {item.station_text ? item.station_text.split(" · ")[0] : "ohne Station"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-white">{item.title}</div>
          <div className="text-xs text-white/55 truncate">{item.label} · {item.names}</div>
          <div className={`text-[11px] ${bad ? "text-[#FF6B60]" : "text-[#FFD700]"}`}>{item.detail}</div>
        </div>
        {item.action === "move" ? (
          <button type="button" disabled={busy} onClick={onMove} className="tls-btn tls-btn--secondary shrink-0 min-h-[44px] px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold" data-testid={`lead-case-move-${item.id}`}>Umlegen</button>
        ) : item.action === "no_show" ? null : canEnter ? (
          <button type="button" disabled={busy} onClick={onEnter} className="tls-btn tls-btn--primary shrink-0 min-h-[44px] px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold" data-testid={`lead-case-enter-${item.id}`}>Eintragen</button>
        ) : null}
      </div>
      {item.action === "no_show" ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-white/10 pt-3" data-testid={`lead-no-show-${item.id}`}>
          {(item.participants || []).map((side) => (
            <button key={side.registration_id} type="button" disabled={busy} onClick={() => onNoShow({ action: "confirm", registration_id: side.registration_id })} className="tls-btn tls-btn--secondary min-h-[44px] min-w-0 max-w-full px-3 py-2 rounded-sm text-left text-xs font-bold [overflow-wrap:anywhere]" data-testid={`lead-no-show-${side.registration_id}`}>
              {side.name} nicht erschienen
            </button>
          ))}
          <button type="button" disabled={busy} onClick={() => onNoShow({ action: "extend", minutes: 5 })} className="tls-btn tls-btn--quiet min-h-[44px] shrink-0 px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold" data-testid={`lead-no-show-extend-${item.id}`}>+5 Min. verlängern</button>
        </div>
      ) : null}
      {moving ? (
        <div className="mt-3 border-t border-white/10 pt-3" data-testid={`lead-case-stations-${item.id}`}>
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/50">Auf welche Station?</div>
          {stations.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {stations.map((station) => (
                <button key={station.id} type="button" disabled={busy} onClick={() => onMoveTo(station.id)} className="tls-btn tls-btn--secondary min-h-[44px] px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold" data-testid={`lead-move-to-${station.id}`}>{station.name}</button>
              ))}
            </div>
          ) : <p className="mt-2 text-xs text-white/50">Gerade ist keine Station frei.</p>}
        </div>
      ) : null}
    </div>
  );
}

function LeadRow({ item, onEnter }) {
  const missing = Boolean(item.timing?.missing);
  const held = item.hold;
  return (
    <div className={`flex items-center gap-3 rounded-sm border p-3 ${missing ? "border-[#FFD700]/45 bg-[#FFD700]/5" : "border-white/10 bg-[#121212]"}`} data-testid={`lead-row-${item.id}`} data-missing={missing ? "true" : "false"}>
      <div className={`flex h-12 w-14 shrink-0 flex-col items-center justify-center rounded-sm border text-center text-[10px] font-bold uppercase leading-tight ${item.station_text ? "border-[#29B6E8]/40 text-[#29B6E8]" : "border-white/10 text-white/40"}`}>
        {item.station_text ? item.station_text.split(" · ")[0] : "ohne Station"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-white truncate">{item.stage_name ? `${item.stage_name} · ` : ""}{item.label}</div>
        <div className="text-xs text-white/55 truncate">{leadNames(item)}</div>
        <div className={`mt-0.5 flex items-center gap-1 text-[11px] ${missing ? "text-[#FFD700]" : "text-white/45"}`} data-testid={`lead-line-${item.id}`}>
          {item.timing?.running_minutes != null ? <Radio className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
          {leadLine(item, (value) => formatWhen(value))}
        </div>
      </div>
      {held ? (
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-[#29B6E8]" data-testid={`lead-held-${item.id}`}>{held.mine ? "gespeichert" : `${held.actor_name} trägt ein`}</span>
      ) : item.can_enter ? (
        <button type="button" onClick={onEnter} className="tls-btn tls-btn--primary shrink-0 min-h-[44px] px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold" data-testid={`lead-enter-${item.id}`}>Eintragen</button>
      ) : null}
    </div>
  );
}
