import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, ClipboardCheck, Clock, Gauge, Megaphone, MonitorPlay, Radio, Shuffle, UserCheck } from "lucide-react";
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
import { motionAllowed } from "@/lib/motion";
import { leadFilter, leadLine, leadNames } from "@/lib/tournamentLead";
import { COCKPIT_POLL_MS, cockpitProblems } from "@/lib/tournamentCockpit";
import { ResultWindow } from "@/components/tls/results/ResultWindow";
import { ResultUndoBar, useResultUndo } from "@/components/tls/results/ResultUndoBar";
import { DisputeCard } from "@/components/tls/results/DisputeCard";
import { StationQueueBoard } from "@/components/tls/live/StationQueueBoard";
import { MatchClock } from "@/components/tls/live/MatchClock";
import { CheckinBoard } from "@/components/tls/tournament/CheckinBoard";
import { NoticeComposer } from "@/components/tls/tournament/NoticeComposer";
import { TournamentCockpit } from "@/components/tls/tournament/TournamentCockpit";

// Turnierleitung am Handy (#1156): /tournaments/<slug>/leitung - nur für die Turnierleitung dieses Turniers. Erster
// Reiter „Braucht Aufmerksamkeit“ (#1160): was hängt, mit dem passenden Knopf - Erledigtes verschwindet von selbst; jeder
// Fall hat eine eigene Adresse (?fall=…). Reiter „Ergebnisse“: alle offenen Spiele, zuerst was fehlt, dann nach
// Station; Filter „Läuft“ und „Ergebnis fehlt“.
// „Eintragen“ öffnet das Ergebnis-Fenster (#1370), danach 10 Sekunden „Rückgängig“. Die Verwaltung bleibt zum
// Vorbereiten - die Live-Werkzeuge stehen hier.
// Reiter „Stationen“ (#1556, nur vor Ort): die Warteschlange je Station - läuft mit Spielzeit-Uhr, als Nächstes mit
// „Aufrufen“ und „Starten“, danach. Die Reihenfolge und den Verzug rechnet der Server (GET …/live-queue). Dazu je Kachel
// „Freigeben“, „Umlegen“ und „Defekt“ (#1162) - die Live-Knöpfe stehen nur hier, /admin/stations behält Anlegen und Planen.
// ?reiter=stationen öffnet direkt die Stationen (Link aus der Verwaltung).
// Reiter „Check-in“ (#1161, nur mit Check-in-Recht): wer da ist, mit einem Tipp - der eine Ort dafür; die Verwaltung
// verlinkt hierher (?reiter=checkin). Im Status „Check-in“ öffnet die Seite gleich dort.
// Reiter „Hinweis“ (#1166, nur wer Hinweise schreiben darf): ein Satz an alle im Turnier oder Event - Benachrichtigung,
// Banner, auf Wunsch TV; darunter das Protokoll (?reiter=hinweis).
// Reiter „Cockpit“ (#1653, nur vor Ort mit Warteschlange): der Einstieg am Turniertag - oben bzw. am Tablet quer links
// die „Probleme“ (Fälle, Auslosungen, Verzug je Station; ein Tipp führt zum Fall), daneben die Stationen mit denselben
// Knöpfen wie im Reiter „Stationen“. Die übrigen Reiter bleiben. ?reiter=cockpit öffnet ihn, ?station=<id> springt zur
// Station (aus „Verzug“). Solange er offen ist, fragen beide Abfragen zusätzlich kurz im Takt nach (COCKPIT_POLL_MS):
// „Ergebnis fehlt“ und Verzug entstehen mit der Zeit, ohne eigenes Ereignis.

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
  const [tab, setTab] = useState(() => ({ cockpit: "cockpit", checkin: "checkin", stationen: "stations", hinweis: "notice" })[searchParams.get("reiter")] || null);
  const [movingId, setMovingId] = useState("");
  const [queue, setQueue] = useState(null);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [busyStation, setBusyStation] = useState("");
  // Eigene Adresse je Fall (#1158, #1160): ?fall=<id> springt zum Fall.
  const fall = searchParams.get("fall") || "";
  const scrolledTo = useRef("");
  // Aus „Verzug“ im Cockpit (#1653): ?station=<id> - die Station leuchtet auf und rückt ins Bild.
  const stationParam = searchParams.get("station") || "";
  const stationScrolled = useRef("");
  const [stationJump, setStationJump] = useState(0);

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
  // Das Cockpit (#1653) fragt kurz im Takt nach - sonst wie bisher nur bei Änderungen.
  const cockpitOpen = tab === "cockpit" || (!tab && !fall && Boolean(queue));
  useLiveRefresh(load, ["matches", "matches-v2", "tournaments", "stations"], { fallbackMs: 15000, pollMs: cockpitOpen ? COCKPIT_POLL_MS : 0, tournamentId, eventId });
  // Die Prognose wandert auch ohne Ereignis mit der Zeit - einmal je Minute nachfragen, im Cockpit öfter.
  useLiveRefresh(loadQueue, ["matches", "matches-v2", "tournaments", "stations"], { fallbackMs: 15000, pollMs: cockpitOpen ? COCKPIT_POLL_MS : 60000, tournamentId, eventId });
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
  const canCheckIn = Boolean(data?.tournament?.can_check_in);
  // Von selbst nur, wo allein die Leitung eincheckt (vor Ort) - online checken die Spieler selbst (Review N7).
  const checkinPhase = canCheckIn && data?.tournament?.status === "check_in" && !data?.tournament?.self_checkin;
  const canNotice = Boolean(data?.tournament?.can_notice);
  // Ein gewählter Reiter gilt nur, wenn es ihn gibt: „Check-in“ mit Recht, „Stationen“ (auch über ?reiter=stationen) erst,
  // wenn es vor Ort eine Warteschlange gibt - bis die geladen ist, „Wird geladen …“, sonst die Vorgabe. „Hinweis“ (#1166)
  // nur mit Recht zum Schreiben - bis die Ansicht geladen ist, „Wird geladen …“.
  const chosenTab = tab === "checkin" && !canCheckIn ? null
    : (tab === "stations" || tab === "cockpit") && !queue ? (queueLoaded ? null : "")
      : tab === "notice" && !canNotice ? (data ? null : "") : tab;
  const activeTab = chosenTab === "" ? "" : chosenTab || defaultLeadTab({ fall, cases, checkinPhase, queue, ready: Boolean(data) && queueLoaded });
  // Die Probleme des Cockpits (#1653) - aus denselben Daten wie „Braucht Aufmerksamkeit“ und die Stationen.
  const problems = useMemo(() => cockpitProblems({ attention, draws, queue }), [attention, draws, queue]);
  // Viele Reiter am Handy: kurze Wörter, keine Symbole - sonst muss man wischen.
  const compactTabs = Boolean(queue) || canCheckIn || canNotice;
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
    if (!stationParam || activeTab !== "cockpit" || !queue || stationScrolled.current === stationParam) return;
    const target = [...document.querySelectorAll("[data-testid^='live-station-']")].find((node) => node.dataset.testid === `live-station-${stationParam}`);
    if (target) {
      stationScrolled.current = stationParam;
      target.scrollIntoView?.({ block: "center", behavior: motionAllowed() ? "smooth" : "auto" });
    }
  }, [stationParam, activeTab, queue, stationJump]);

  // Ein Tipp auf ein Problem (#1653): ein Fall öffnet „Braucht Aufmerksamkeit“ an genau dieser Karte, Verzug bleibt im
  // Cockpit und springt zur Station. Derselbe Fall ein zweites Mal springt wieder hin.
  const openProblem = (problem) => {
    if (problem.target === "station") {
      stationScrolled.current = "";
      setStationJump((value) => value + 1);
      return;
    }
    scrolledTo.current = "";
    setTab("attention");
  };

  useEffect(() => {
    if (!fall || !data || scrolledTo.current === fall) return;
    const target = document.getElementById(`fall-${fall}`);
    if (target) {
      scrolledTo.current = fall;
      target.scrollIntoView?.({ block: "center" });
    }
  }, [fall, data]);

  // Aufrufen, Starten, Freigeben, Defekt und Umlegen (#1556, #1162): zwei Helfer zugleich - der Server nimmt genau einen,
  // der andere bekommt die Meldung (409) und sieht danach den neuen Stand.
  const operateStation = async (kind, station, body, said) => {
    setBusyStation(station.id);
    try {
      const { data: done } = await api.post(`/tournaments/${encodeURIComponent(slug)}/live-queue/${kind}`, { station_id: station.id, ...body });
      toast.success(said(done || {}, station.station_text || station.name));
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Das hat nicht geklappt. Bitte neu laden.");
    } finally {
      setBusyStation("");
      await Promise.all([loadQueue(), load()]);
    }
  };

  // „Alle freien Stationen aufrufen“ (#1162): nacheinander über denselben Weg wie ein einzelner Aufruf - was schon ein
  // anderer aufgerufen hat, zählt der Server als Wiederholung; eine Absage nennt die Rückmeldung.
  const callAll = async (pairs) => {
    setBusyStation("all");
    let called = 0;
    const refused = [];
    for (const [station, entry] of pairs) {
      try {
        await api.post(`/tournaments/${encodeURIComponent(slug)}/live-queue/call`, { station_id: station.id, match_id: entry.match_id });
        called += 1;
      } catch (err) {
        refused.push(`${station.station_text || station.name}: ${formatApiError(err.response?.data?.detail) || "nicht aufgerufen"}`);
      }
    }
    setBusyStation("");
    if (called) toast.success(`${called === 1 ? "1 Station" : `${called} Stationen`} aufgerufen – die Spieler bekommen Bescheid.`);
    if (refused.length) toast.error(refused.join(" · "));
    await Promise.all([loadQueue(), load()]);
  };

  // Streitfall entscheiden (#1158): „Ergebnis bleibt“ mit einem Tipp - beide Seiten bekommen die Entscheidung.
  const keepResult = async (item, note, conflictReason) => {
    setDeciding(true);
    try {
      await api.post(`/matches/${item.id}/dispute/decision`, { decision: "keep", note, ...(conflictReason ? { conflict_reason: conflictReason } : {}) });
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

  // Die Knöpfe der Stationen (#1556, #1162) - im Reiter „Stationen“ und im Cockpit (#1653) dieselben Wege.
  const stationHandlers = {
    busyKey: busyStation,
    onCall: (station, entry) => operateStation("call", station, { match_id: entry.match_id }, (done, where) => (done.idempotent_replay ? `War schon an ${where} aufgerufen.` : `Aufgerufen an ${where} – die Spieler bekommen Bescheid.`)),
    onStart: (station, entry) => operateStation("start", station, { match_id: entry.match_id }, (done, where) => (done.idempotent_replay ? "Läuft bereits." : `Gestartet an ${where} – die Uhr läuft.`)),
    onRelease: (station, entry) => operateStation("release", station, { match_id: entry.match_id }, releasedText),
    onBroken: (station, value, extra) => operateStation("broken", station, { broken: value, ...extra }, value ? brokenText : (done, where) => (done.idempotent_replay ? `${where} war schon bereit.` : `${where} ist wieder bereit.`)),
    onMove: (station, entry, target) => operateStation("move", station, { match_id: entry.match_id, to_station_id: target.id }, movedText),
    onCallAll: callAll,
    onClear: (station) => operateStation("clear", station, {}, (done, where) => (done.idempotent_replay ? `${where} war schon frei.` : `${where} ist geräumt und wieder frei.`)),
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
      {/* Das Cockpit nutzt am Tablet quer die Breite für zwei Spalten (#1653); die übrigen Reiter bleiben schmal. */}
      <section className={`${activeTab === "cockpit" ? "max-w-3xl lg:max-w-6xl" : "max-w-3xl"} mx-auto px-4 sm:px-6 py-8 pb-28`} data-testid="lead-page">
        <Breadcrumbs items={tournamentCrumbs(data?.tournament, trail, { tournamentUrl, current: { label: "Turnierleitung" } })} className="mb-4" />
        <div className="text-[11px] uppercase tracking-[0.3em] text-[#FFD700] font-bold">Turnierleitung</div>
        <h1 className="mt-1 font-heading text-2xl md:text-4xl font-black uppercase [overflow-wrap:anywhere]">{data?.tournament?.title || "…"}</h1>

        <div className="mt-6 flex flex-wrap items-center gap-x-1 border-b border-white/10" role="tablist" aria-label="Turnierleitung" data-testid="lead-tabs">
          {[...(queue ? [["cockpit", "Cockpit", Gauge]] : []), ["attention", <><span className={compactTabs ? "hidden sm:inline" : ""}>Braucht </span>Aufmerksamkeit ({cases})</>, AlertTriangle], ...(canCheckIn ? [["checkin", "Check-in", UserCheck]] : []), ...(queue ? [["stations", "Stationen", MonitorPlay]] : []), ["results", "Ergebnisse", ClipboardCheck], ...(canNotice ? [["notice", "Hinweis", Megaphone]] : [])].map(([key, label, Icon]) => (
            <button key={key} type="button" role="tab" aria-selected={activeTab === key} onClick={() => setTab(key)} className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 sm:gap-2 whitespace-nowrap border-b-2 px-2 sm:px-3 text-xs sm:text-sm font-bold uppercase tracking-wider ${activeTab === key ? "border-[#29B6E8] text-white" : "border-transparent text-white/50"}`} data-testid={`lead-tab-${key}`}>
              <Icon className={`${compactTabs ? "hidden sm:block" : ""} w-4 h-4 shrink-0 ${key === "attention" && cases ? "text-[#FFD700]" : "text-[#29B6E8]"}`} />
              {/* Ein Textblock (Review N8): sonst setzt der Flex-Abstand zwischen „Braucht “ und „Aufmerksamkeit“ eine zweite Lücke. */}
              <span data-testid={`lead-tab-label-${key}`}>{label}</span>
            </button>
          ))}
        </div>

        {activeTab === "cockpit" && queue ? (
          <TournamentCockpit
            problems={problems}
            loaded={Boolean(data)}
            queue={queue}
            highlightStation={stationParam}
            onOpen={openProblem}
            board={stationHandlers}
          />
        ) : null}

        {activeTab === "checkin" && canCheckIn ? (
          <CheckinBoard slug={slug} tournamentId={tournamentId} eventId={eventId} />
        ) : null}

        {activeTab === "notice" && canNotice ? (
          <NoticeComposer slug={slug} tournament={data.tournament} stations={data.stations || []} />
        ) : null}

        {activeTab === "stations" && queue ? (
          <div className="mt-5" data-testid="lead-stations">
            <StationQueueBoard queue={queue} {...stationHandlers} />
            <p className="mt-4 text-xs text-white/40">Die Reihenfolge rechnet der Server aus Plan, Linien und Stationen – wird eine Station frei, rückt das nächste bereite Spiel nach. „Aufrufen“ schickt den Spielern „Du bist dran“; „nicht erschienen“ greift nach der Frist ab dem Aufruf. „Defekt“ nimmt die Station aus der Planung – was dort läuft oder aufgerufen ist, legst du mit „Umlegen“ auf eine freie Station.</p>
          </div>
        ) : null}

        {!activeTab ? <div className="py-10 text-center text-white/40">Wird geladen …</div> : null}

        {activeTab === "attention" ? (
          <div className="mt-5 space-y-3" data-testid="lead-attention">
            {data && cases === 0 ? <div className="rounded-sm border border-white/10 bg-[#121212] p-6 text-center text-white/50" data-testid="lead-attention-empty">Gerade hängt nichts.</div> : null}
            {draws.map((card) => <DrawCard key={card.id} card={card} now={data?.now} highlighted={fall === card.id} busy={deciding} onDraw={() => drawNow(card)} />)}
            {attention.map((item) => (item.kind === "dispute" && byId[item.match_id]?.dispute ? (
              <DisputeCard key={item.id} item={byId[item.match_id]} busy={deciding} highlighted={fall === item.id} onKeep={(note, conflictReason) => keepResult(byId[item.match_id], note, conflictReason)} onChange={() => openEntry(item.match_id)} />
            ) : (
              <AttentionRow
                key={item.id}
                item={item}
                highlighted={fall === item.id}
                busy={deciding}
                canEnter={Boolean(byId[item.match_id]?.can_enter)}
                conflict={Boolean(byId[item.match_id]?.conflict || byId[item.match_id]?.conflict_override)}
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
        {activeTab !== "checkin" && activeTab !== "notice" ? <p className="mt-6 text-xs text-white/40">Hier stehen nur Spiele, für die du eingeteilt bist. Jede Eingabe steht im Protokoll (wer, wann, was).</p> : null}
      </section>

      {opened && opened.can_enter ? <ResultWindow key={opened.id} entry={opened} onClose={closeEntry} onSaved={undo.start} /> : null}
      <ResultUndoBar undo={undo} />
    </PublicLayout>
  );
}

/**
 * Womit die Turnierleitung startet, wenn kein Reiter gewählt ist: ein Fall aus einem Link (?fall=) öffnet „Braucht
 * Aufmerksamkeit“. Vor Ort mit Warteschlange ist das Cockpit der Einstieg (#1653) - es zeigt die Fälle mit; nur im
 * Check-in ohne offene Fälle beginnt die Seite beim Check-in. Ohne Warteschlange wie bisher: Fälle, Check-in,
 * Ergebnisse. `ready`: Ansicht und Warteschlange sind geladen - bis dahin „Wird geladen …“ (sonst springt der Reiter).
 */
export function defaultLeadTab({ fall = "", cases = 0, checkinPhase = false, queue = null, ready = false } = {}) {
  if (fall) return "attention";
  if (!ready) return "";
  if (queue && (cases || !checkinPhase)) return "cockpit";
  if (cases) return "attention";
  if (checkinPhase) return "checkin";
  return "results";
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

// Rückmeldungen zu den Stations-Knöpfen (#1162) - nach „Defekt“ mit dem Hinweis, was mit dem Spiel an der Station passiert.
function releasedText(done, where) {
  if (done.idempotent_replay) return `${where} war schon frei.`;
  return done.state === "running" ? `${where} ist frei – das Ergebnis trägst du unter „Ergebnisse“ ein.` : `${where} ist frei – der Aufruf ist zurückgenommen, die Spieler bekommen Bescheid.`;
}

function brokenText(done, where) {
  // Geteilte Station (#1162): das Spiel gehört einem anderen Turnier - dessen Leitung hat Bescheid bekommen.
  const held = done.holds?.other_tournament ? `Dort spielt gerade „${done.holds.other_tournament}“ – dessen Leitung hat Bescheid bekommen.`
    : done.holds?.state === "running" ? "Das laufende Spiel steht noch dort – mit „Umlegen“ auf eine freie Station."
    : done.holds?.state === "called" ? "Der Aufruf steht noch dort – mit „Umlegen“ an einer freien Station neu aufrufen." : "";
  return [done.idempotent_replay ? `${where} war schon als defekt gemeldet.` : `${where} ist als defekt gemeldet.`, held].filter(Boolean).join(" ");
}

function movedText(done, where) {
  if (done.idempotent_replay) return `Schon an ${done.to}.`;
  return done.state === "running" ? `Von ${where} an ${done.to} umgelegt – die Uhr läuft weiter.` : `An ${done.to} neu aufgerufen – die Spieler bekommen Bescheid.`;
}

function AttentionRow({ item, highlighted, busy, canEnter, conflict = false, moving, stations, onEnter, onMove, onMoveTo, onNoShow }) {
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
        ) : item.action === "open" ? (
          // Liga-Verfahren (E.2, #1619): entschieden wird auf der Matchseite, an der Karte des Verfahrens.
          <a href={`/matches/${item.match_id}`} className="tls-btn tls-btn--secondary inline-flex shrink-0 min-h-[44px] items-center px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold" data-testid={`lead-case-open-${item.id}`}>Zum Spiel</a>
        ) : item.action === "no_show" ? null : canEnter ? (
          <button type="button" disabled={busy} onClick={onEnter} className="tls-btn tls-btn--primary shrink-0 min-h-[44px] px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold" data-testid={`lead-case-enter-${item.id}`}>Eintragen</button>
        ) : null}
      </div>
      {item.action === "no_show" && conflict ? (
        <p className="mt-3 border-t border-white/10 pt-3 text-xs text-white/60" data-testid={`lead-no-show-conflict-${item.id}`}>Du bist an diesem Spiel selbst beteiligt – das entscheidet eine zweite berechtigte Person.</p>
      ) : null}
      {item.action === "no_show" && !conflict ? (
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

// Ein laufendes Spiel trägt die Spielzeit-Uhr (#1167) - dieselbe wie an der Station, mit der Dauer, mit der der Server
// „über der Zeit“ rechnet. Sie ersetzt „läuft 12 Min.“; fehlt das Ergebnis schon, bleibt der Hinweis darunter stehen.
function LeadRow({ item, onEnter }) {
  const missing = Boolean(item.timing?.missing);
  const clocked = Boolean(item.started_at) && item.timing?.running_minutes != null && item.status !== "disputed";
  const held = item.hold;
  return (
    <div className={`flex items-center gap-3 rounded-sm border p-3 ${missing ? "border-[#FFD700]/45 bg-[#FFD700]/5" : "border-white/10 bg-[#121212]"}`} data-testid={`lead-row-${item.id}`} data-missing={missing ? "true" : "false"}>
      <div className={`flex h-12 w-14 shrink-0 flex-col items-center justify-center rounded-sm border text-center text-[10px] font-bold uppercase leading-tight ${item.station_text ? "border-[#29B6E8]/40 text-[#29B6E8]" : "border-white/10 text-white/40"}`}>
        {item.station_text ? item.station_text.split(" · ")[0] : "ohne Station"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-white truncate">{item.stage_name ? `${item.stage_name} · ` : ""}{item.label}</div>
        <div className="text-xs text-white/55 truncate">{leadNames(item)}</div>
        {clocked ? (
          <MatchClock size="sm" startedAt={item.started_at} durationMinutes={item.timing?.duration_minutes} pausedAt={item.paused_at} pausedSeconds={item.paused_seconds} testId={`lead-clock-${item.id}`} className="mt-1" />
        ) : null}
        {!clocked || missing ? (
          <div className={`mt-0.5 flex items-center gap-1 text-[11px] ${missing ? "text-[#FFD700]" : "text-white/45"}`} data-testid={`lead-line-${item.id}`}>
            {item.timing?.running_minutes != null ? <Radio className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
            {leadLine(item, (value) => formatWhen(value))}
          </div>
        ) : null}
      </div>
      {held ? (
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-[#29B6E8]" data-testid={`lead-held-${item.id}`}>{held.mine ? "gespeichert" : `${held.actor_name} trägt ein`}</span>
      ) : item.can_enter ? (
        <button type="button" onClick={onEnter} className="tls-btn tls-btn--primary shrink-0 min-h-[44px] px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold" data-testid={`lead-enter-${item.id}`}>Eintragen</button>
      ) : item.conflict ? (
        <span className="shrink-0 max-w-[9rem] text-right text-[11px] leading-snug text-white/55" data-testid={`lead-conflict-${item.id}`}>Selbst beteiligt – entscheidet jemand anderes</span>
      ) : null}
    </div>
  );
}
