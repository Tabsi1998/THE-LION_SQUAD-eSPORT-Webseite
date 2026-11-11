import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useVetoPolling } from "@/hooks/useVetoPolling";
import { DisplayStatusBanner } from "@/components/tls/DisplayStatusBanner";
import { LazyImg } from "@/components/tls/LazyImg";
import { TvScreen } from "@/components/tv/TvScreen";
import { TvFooter, TvHeader, TvKeyRefused, TvPill } from "@/components/tv/TvParts";
import { useFreshCards, useServerOffset, VetoBoard, VetoCountdown, VetoTimeline } from "@/components/tls/league/VetoLive";
import { isOlderVeto, plannedRoleLabel, sideName, sideTone, VETO_STATUS_LABELS } from "@/lib/leagueVeto";

// Map-Veto am TV (D.4, #1651): ein laufendes Liga-Spiel für 1920 px - großer Countdown, wer am Zug ist, das Brett aus Map-Karten und der
// Ablauf. Nur lesend und öffentlich wie die übrigen TV-Ansichten: Der Server liefert hier immer die Sicht für Zuschauer (`display=1`),
// ohne Wahl, Eingriff, Bereit-Stand oder Grund einer Pause; Sichtbarkeit wie die Matchseite, mit Anzeige-Schlüssel des Turniers (`key`)
// auch für Staffeln „Nur Mitglieder“. Live per kurzem Abruf (läuft: alle 2 Sekunden, sonst alle 10) und über den Änderungsstrom.

const IDLE_MS = 10000;
const PILL = { running: "live", paused: "gold", done: "green", waiting: "accent", skipped: "muted" };

export default function VetoTVPage() {
  return (
    <TvScreen>
      <VetoTv />
    </TvScreen>
  );
}

function TurnPanel({ block, offset }) {
  const current = block.current;
  const side = (block.plan || []).find((row) => row.state === "current")?.side || null;
  const what = !current ? "" : current.kind === "ban" ? `sperrt eine Map · ${current.mode_label}`
    : current.kind === "pick" ? `wählt Map ${current.position} · ${current.mode_label}`
      : current.kind === "decider" ? `Decider für Map ${current.position} · ${current.mode_label}` : `Vorgabe der Woche · Map ${current.position}`;
  return (
    <section className="tv-veto__turn" data-tone={sideTone(side)} data-testid="veto-tv-turn">
      <div className="tv-kicker tv-t-meta">{block.status === "paused" ? "Pausiert" : current ? `Schritt ${current.number} von ${current.total}` : ""}</div>
      <VetoCountdown block={block} offset={offset} size={240} className="tv-veto__clock" tv />
      <div className="tv-veto__who tv-t-head font-heading font-black uppercase" data-testid="veto-tv-who">
        {side ? sideName(block, side) : current ? "System" : ""}
      </div>
      <div className="tv-t-info tv-muted">{block.status === "paused" ? "Die Liga-Leitung hat das Veto angehalten." : what}</div>
    </section>
  );
}

function PlannedRow({ games }) {
  return (
    <ol className="tv-veto__planned" aria-label="Spielreihenfolge" data-testid="veto-tv-planned">
      {games.map((game) => (
        <li key={game.position} className="tv-veto__game">
          <span className="tv-veto__game-media">
            {game.map_image_url ? <LazyImg src={game.map_image_url} alt="" sizes="360px" widths={[320, 640]} className="tv-veto__game-img" /> : null}
          </span>
          <span className="tv-kicker tv-t-meta">Map {game.position}{plannedRoleLabel(game.role) ? ` · ${plannedRoleLabel(game.role)}` : ""}</span>
          <span className="tv-t-head font-heading font-black uppercase">{game.map_name}</span>
          <span className="tv-t-info tv-muted">{game.mode_label}</span>
        </li>
      ))}
    </ol>
  );
}

function VetoTv() {
  const { matchId } = useParams();
  const [params] = useSearchParams();
  const displayKey = params.get("key") || "";
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [keyRefused, setKeyRefused] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: answer } = await api.get(`/matches/${encodeURIComponent(matchId)}/veto`, { params: { display: 1, ...(displayKey ? { key: displayKey } : {}) } });
      // Abruf, Änderungsstrom und Frist können sich überholen: Eine ältere Antwort überschreibt nie eine neuere.
      setData((current) => (isOlderVeto(current?.veto, answer?.veto) ? current : answer));
      setLoadError(null);
      setKeyRefused(false);
      setLastUpdated(Date.now());
    } catch (error) {
      const status = error?.response?.status;
      if (displayKey && (status === 401 || status === 403)) {
        setKeyRefused(true);
        setData(null);
      }
      setLoadError(error);
    }
  }, [matchId, displayKey]);

  useEffect(() => {
    load();
  }, [load]);
  const block = data?.veto || null;
  const offset = useServerOffset(block?.server_now);
  // Kurzer Abruf im Takt des Vetos, vor dem Start und danach ruhig - dazu sofort, wenn der Änderungsstrom einen Zug meldet.
  useVetoPolling(block, load, { offset, idleMs: IDLE_MS });
  useLiveRefresh(load, ["matches", "matches-v2"], { fallbackMs: 0, tournamentId: data?.match?.tournament_id || null });
  const fresh = useFreshCards(block);

  if (keyRefused) return <TvKeyRefused />;
  const head = data?.match;
  const title = head?.sides?.length ? head.sides.join(" vs ") : "Map-Veto";
  const live = block && (block.status === "running" || block.status === "paused");
  const matchUrl = `${window.location.origin}/matches/${matchId}`;
  return (
    <div className="tv-page" data-testid="veto-tv" data-status={block?.status || "none"}>
      <TvHeader
        kicker="THE LION SQUAD · MAP-VETO"
        live={block?.status === "running"}
        title={title}
        subtitle={[head?.tournament_title, head?.matchday_label].filter(Boolean).join(" · ") || null}
        aside={block ? <TvPill tone={PILL[block.status] || "muted"} live={block.status === "running"} testId="veto-tv-state">{VETO_STATUS_LABELS[block.status] || "Veto"}</TvPill> : null}
      />
      <DisplayStatusBanner error={loadError} lastUpdated={lastUpdated} label="Veto" onRetry={load} />
      <main className="tv-main tv-veto" data-testid="tv-main">
        {!data ? (
          <div className="tv-empty tv-t-head font-display">{loadError ? "Veto konnte nicht geladen werden" : "Lade Veto …"}</div>
        ) : !block ? (
          <div className="tv-empty tv-t-head font-display" data-testid="veto-tv-none">In diesem Spiel gibt es kein Map-Veto</div>
        ) : block.status === "waiting" || block.status === "skipped" ? (
          <div className="tv-empty tv-t-head font-display" data-testid="veto-tv-waiting">
            {block.status === "skipped" ? "In diesem Spiel läuft kein Veto" : "Das Veto beginnt nach dem Check-in beider Seiten"}
          </div>
        ) : (
          <div className="tv-veto__grid" data-testid="veto-tv-grid">
            {live ? <TurnPanel block={block} offset={offset} /> : (
              <section className="tv-veto__turn" data-tone="done">
                <div className="tv-kicker tv-t-meta">Veto abgeschlossen</div>
                <div className="tv-t-title font-heading font-black uppercase">Spielreihenfolge steht</div>
              </section>
            )}
            <section className="tv-veto__stage">
              {live ? <VetoBoard block={block} fresh={fresh} tv /> : <PlannedRow games={block.planned_games || []} />}
            </section>
            <VetoTimeline block={block} tv className="tv-veto__flow" />
          </div>
        )}
      </main>
      <TvFooter qrValue={matchUrl} kicker="Live mitverfolgen" text="QR scannen und Matchseite öffnen" />
    </div>
  );
}
