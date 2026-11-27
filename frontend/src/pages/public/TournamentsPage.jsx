import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Reveal } from "@/components/tls/Reveal";
import { TournamentCard } from "@/components/tls/TournamentCard";
import { PublicEmptyState } from "@/components/tls/PublicEmptyState";
import { PublicLoadingState } from "@/components/tls/PublicLoadingState";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useOptionalAuth } from "@/context/AuthContext";
import { sortByNearestDate } from "@/lib/contentSort";
import { ShortCaps } from "@/components/tls/ShortCaps";

const PAGE_SIZE = 24;
// Der Server gibt höchstens 200 je Abruf zurück (_page_items) - so weit lädt „Mehr laden“ nach.
const MAX_SHOWN = 200;
// Status-Gruppen (#2124, TP12): „Beendet“ sind auch veröffentlichte und archivierte Turniere, „Live“ auch pausierte. Die
// Adresse behält die bisherigen Werte (?status=completed, ?status=live) - Links von früher bleiben gültig.
const FILTER_QUERY = { completed: "finished", live: "running" };
// Online oder vor Ort (#1276) - ein hybrides Turnier steht unter beiden (der Server entscheidet).
const MODES = [
  { v: "online", label: "Online" },
  { v: "local", label: "Vor Ort" },
];

/** Ein Chip der zweiten Filterzeile: weich und rund, aktiv gefüllt (Cyan, „Nur meine“ in Gold wie bei den Events). */
function Chip({ testId, active, tone = "brand", onClick, children }) {
  const on = tone === "honor" ? "bg-[#FFD700] text-black" : "bg-[#29B6E8] text-black";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 tls-type-small font-bold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#29B6E8] ${
        active ? on : "bg-white/[0.05] text-white/65 hover:bg-white/[0.09] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

export default function TournamentsPage() {
  useDocumentTitle(
    "eSports Turniere",
    "Aktuelle eSports Turniere von THE LION SQUAD: Anmeldung, Check-in, Brackets, Spielpläne und Ranglisten für Gaming Events in Tirol."
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const auth = useOptionalAuth();
  const signedIn = Boolean(auth?.user);
  // Zweite Filterzeile (#1276): Spiel (`?game=<slug>`, so verlinkt das Spiele-Regal), online/vor Ort und „Nur meine“ -
  // alles steht in der Adresse, ein geteilter Link öffnet dieselbe Auswahl. „Nur meine“ gilt nur angemeldet.
  const gameFilter = searchParams.get("game") || "";
  const modeFilter = MODES.some((m) => m.v === searchParams.get("mode")) ? searchParams.get("mode") : "";
  const mineFilter = signedIn && searchParams.get("mine") === "1";
  // Ein geteilter Link mit „Nur meine“ wartet, bis die Anmeldung geklärt ist (`user` noch `undefined`) - sonst käme
  // erst die ganze Liste und dann die eigene (Review #1276).
  const waitForAuth = searchParams.get("mine") === "1" && Boolean(auth) && auth.user === undefined;
  // Nur die jüngste Anfrage zählt (Review #1276): eine späte Antwort auf einen alten Filter überschreibt nichts.
  const latestRequest = useRef(0);
  const [games, setGames] = useState([]);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "all");
  // „Mehr laden“ (#2124, TP13): Seiten zu 24 - die Live-Aktualisierung lädt so viele, wie schon zu sehen sind.
  const [shown, setShown] = useState(PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(async (count) => {
    // Liga-Staffeln haben ihre eigene Seite (docs/LIGA.md) - die Turnierliste fragt ohne sie.
    const params = new URLSearchParams({ compact: "true", paged: "true", limit: String(count), offset: "0", league: "exclude" });
    if (statusFilter !== "all") params.set("status", FILTER_QUERY[statusFilter] || statusFilter);
    if (gameFilter) params.set("game", gameFilter);
    if (modeFilter) params.set("mode", modeFilter);
    if (mineFilter) params.set("mine", "true");
    const { data } = await api.get(`/tournaments?${params.toString()}`);
    return data;
  }, [statusFilter, gameFilter, modeFilter, mineFilter]);

  const load = useCallback(async () => {
    if (waitForAuth) return;
    const ticket = ++latestRequest.current;
    let data;
    try {
      data = await fetchPage(shown);
    } catch {
      if (ticket !== latestRequest.current) return;
      setError(true);
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    if (ticket !== latestRequest.current) return;
    const items = Array.isArray(data) ? data : data?.items || [];
    setList(sortByNearestDate(items));
    setTotal(Array.isArray(data) ? items.length : Number(data?.total ?? items.length));
    if (Array.isArray(data?.games)) setGames(data.games);
    setError(false);
    setLoading(false);
    setLoadingMore(false);
  }, [fetchPage, shown, waitForAuth]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = () => {
    setLoadingMore(true);
    setShown((value) => Math.min(value + PAGE_SIZE, MAX_SHOWN));
  };
  const hasMore = total > list.length && shown < MAX_SHOWN;

  useLiveRefresh(load, ["tournaments"], { fallbackMs: 15000 });

  useEffect(() => {
    const nextStatus = searchParams.get("status") || "all";
    // Filterwechsel über die Adresse (#2124, Review O7: Zurück im Browser) - wieder ab der ersten Seite.
    if (nextStatus !== statusFilter) {
      setLoading(true);
      setShown(PAGE_SIZE);
      setStatusFilter(nextStatus);
    }
  }, [searchParams, statusFilter]);

  const selectStatusFilter = (value) => {
    if (value !== statusFilter) {
      setLoading(true);
      setShown(PAGE_SIZE);
    }
    setStatusFilter(value);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (value && value !== "all") params.set("status", value);
      else params.delete("status");
      return params;
    }, { replace: true });
  };

  // Ein Chip der zweiten Zeile: setzt seinen Wert, ein zweiter Tipp löst ihn wieder. Wieder ab der ersten Seite.
  const toggleParam = (key, value) => {
    setLoading(true);
    setShown(PAGE_SIZE);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (params.get(key) === value) params.delete(key);
      else params.set(key, value);
      return params;
    }, { replace: true });
  };
  // Ein Spiel aus einem fremden Link, das (noch) keine Turniere hat, bleibt als Chip sichtbar - sonst ließe es sich
  // nicht mehr abwählen.
  const gameChips = gameFilter && !games.some((game) => game.slug === gameFilter)
    ? [...games, { id: gameFilter, slug: gameFilter, name: gameFilter }]
    : games;
  const narrowed = Boolean(gameFilter || modeFilter || mineFilter);

  const filters = [
    { v: "all", label: "Alle" },
    { v: "registration_open", label: "Anmeldung" },
    { v: "check_in", label: "Check-in" },
    { v: "live", label: "Live" },
    { v: "completed", label: "Beendet" },
  ];

  return (
    <PublicLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
        <div className="mb-10">
          <span className="tls-type-label text-[#29B6E8]">Turniere</span>
          <h1 className="mt-2 tls-type-title"><ShortCaps>Alle Turniere</ShortCaps></h1>
          <p className="mt-3 text-white/60 max-w-xl">Online und vor Ort. Einzelspieler, Teams und Mehrspieler. Vom kleinen Pokal bis zur Saison-Liga.</p>
        </div>
        {/* Handy: beide Zeilen einzeilig zum Wischen; ab Tablet brechen sie um (#1276). */}
        <div className="flex flex-nowrap md:flex-wrap gap-2 tls-swipe md:overflow-visible md:[mask-image:none] min-w-0" role="group" aria-label="Phase" data-testid="tournament-filters">
          {filters.map((f) => (
            <button
              key={f.v}
              type="button"
              data-testid={`tournament-filter-${f.v}`}
              onClick={() => selectStatusFilter(f.v)}
              aria-pressed={statusFilter === f.v}
              className={`shrink-0 px-4 py-2 tls-type-label rounded-sm border transition ${
                statusFilter === f.v
                  ? "bg-[#29B6E8] text-black border-[#29B6E8]"
                  : "bg-transparent text-white/70 border-white/10 hover:border-[#29B6E8]/40"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="mt-2 mb-8 flex flex-nowrap md:flex-wrap items-center gap-2 tls-swipe md:overflow-visible md:[mask-image:none] min-w-0" role="group" aria-label="Spiel und Ort" data-testid="tournament-chips">
          {gameChips.map((game) => (
            <Chip key={game.slug} testId={`tournament-game-${game.slug}`} active={gameFilter === game.slug} onClick={() => toggleParam("game", game.slug)}>
              {game.name || game.slug}
            </Chip>
          ))}
          {gameChips.length > 0 && <span aria-hidden="true" className="shrink-0 mx-1 h-5 w-px bg-white/10" />}
          {MODES.map((m) => (
            <Chip key={m.v} testId={`tournament-mode-${m.v}`} active={modeFilter === m.v} onClick={() => toggleParam("mode", m.v)}>
              {m.label}
            </Chip>
          ))}
          {signedIn && (
            <Chip testId="tournament-only-mine" tone="honor" active={mineFilter} onClick={() => toggleParam("mine", "1")}>
              Nur meine
            </Chip>
          )}
        </div>
        {loading ? (
          <PublicLoadingState cards={6} />
        ) : error ? (
          <div className="col-span-full text-center py-20">
            <div className="text-[#FF3B30] tls-type-label">FEHLER BEIM LADEN</div>
            <p className="mt-2 text-quiet tls-type-small">Turniere konnten nicht geladen werden. Bitte Seite neu laden.</p>
            <button onClick={load} className="tls-btn tls-btn--secondary mt-4 px-4 py-2 rounded-sm tls-type-label">
              Erneut versuchen
            </button>
          </div>
        ) : (
          <Reveal className="tls-reveal-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-6">
            {list.map((t, i) => <TournamentCard key={t.id} tournament={t} index={i} />)}
            {list.length === 0 && (
              <PublicEmptyState
                title={mineFilter ? "Hier bist du nirgends dabei" : statusFilter === "all" && !narrowed ? "Noch keine Turniere sichtbar" : "Keine Turniere in diesem Filter"}
                description={mineFilter
                  ? "„Nur meine“ zeigt, wofür du selbst oder dein Team angemeldet bist."
                  : statusFilter === "all" && !narrowed
                    ? "Sobald neue Cups, Ligen oder Community-Turniere angelegt sind, erscheinen sie hier automatisch."
                    : "Wechsle auf alle Turniere oder schau später wieder rein, wenn sich der Status ändert."}
                primaryAction={statusFilter === "all" && !narrowed ? { to: "/events", label: "Events ansehen" } : { to: "/tournaments", label: "Alle Turniere" }}
                secondaryAction={{ to: "/fastlap", label: "Fast Lap" }}
                className="col-span-full"
              />
            )}
          </Reveal>
        )}
        {!loading && !error && hasMore ? (
          <div className="mt-10 flex justify-center">
            <button type="button" onClick={loadMore} disabled={loadingMore} data-testid="tournaments-load-more"
              className="tls-btn tls-btn--secondary min-h-11 px-6 py-2.5 rounded-sm tls-type-label disabled:opacity-50">
              {loadingMore ? "Lädt …" : "Mehr laden"}
            </button>
          </div>
        ) : null}
      </div>
    </PublicLayout>
  );
}
