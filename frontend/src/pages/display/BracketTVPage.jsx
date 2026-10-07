import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { DisplayStatusBanner } from "@/components/tls/DisplayStatusBanner";
import { statusBadgeLabel } from "@/components/tls/StatusBadge";
import { TvScreen, useTv } from "@/components/tv/TvScreen";
import { TvFooter, TvHeader, TvPill, toneFor } from "@/components/tv/TvParts";
import { TvBracketStage } from "@/components/tv/TvBracketStage";
import { TvChampionCard } from "@/components/tv/TvMoments";
import { bracketChanges } from "@/lib/tvLive";
import { advancementsOf } from "@/lib/tvTravel";
import { championKey, championOf } from "@/lib/tvChampion";
import { COLLECT_AFTER, createMomentQueue } from "@/lib/tvMoments";
import { createGong, pageActivated } from "@/lib/tvGong";

// Turnierbaum-TV (#1110, #1115-#1119): derselbe Baum wie auf der Turnierseite, mit Linien, auf einer festen Bühne. Passt
// er, steht er still; sonst fährt eine Kamera ruhig darüber. Kommt ein Ergebnis, liegt es groß über dem Baum, dann
// fahren die Spieler ihre Linie entlang; startet ein Spiel, zoomt der Baum kurz hin; steht der Sieger fest, leuchtet sein
// Weg golden und die Siegerkarte kommt. Immer nur ein Moment. Nach dem Neuladen steht gleich der aktuelle Stand - ohne
// Fahrten, Zoom oder Konfetti. Mit Anzeige-Schlüssel im Link läuft die Seite ohne Anmeldung.

const EMPTY = new Set();

export default function BracketTVPage() {
  return (
    <TvScreen>
      <BracketTv />
    </TvScreen>
  );
}

/** Ton beim Ergebnis (#1118): nur mit Einstellung; bis zum ersten Klick sagt der TV klein „Für Ton einmal klicken“. */
function useResultSound(enabled) {
  const gong = useMemo(() => createGong(), []);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!enabled || ready || !gong.supported) return undefined;
    let active = true;
    const unlock = () => {
      gong.unlock().then((ok) => {
        if (active && ok) setReady(true);
      });
    };
    if (pageActivated()) unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      active = false;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [enabled, ready, gong]);
  return { gong: enabled ? gong : null, needsClick: enabled && gong.supported && !ready };
}

function BracketTv() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const displayKey = params.get("key") || "";
  const { motionOn, settings } = useTv();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [keyRefused, setKeyRefused] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: br } = await api.get(`/tournaments/${id}/bracket/display`, displayKey ? { params: { key: displayKey } } : undefined);
      setData(br);
      setLoadError(null);
      setKeyRefused(false);
      setLastUpdated(Date.now());
    } catch (error) {
      const status = error?.response?.status;
      // Widerrufen oder falsch: der Bildschirm zeigt nichts mehr vom Turnier, nur wie es weitergeht.
      if (displayKey && (status === 401 || status === 403)) {
        setKeyRefused(true);
        setData(null);
      }
      setLoadError(error);
    }
  }, [id, displayKey]);

  useEffect(() => {
    load();
  }, [load]);
  // Die TV-Anzeige läuft stundenlang: ohne Strom alle 15 s nachfragen. „tv“: ein widerrufener Schlüssel wirkt sofort.
  useLiveRefresh(load, ["tournaments", "matches", "stations", "tv"], { fallbackMs: 15000 });

  // ------------------------------------------------------------ Momente
  const queue = useMemo(() => createMomentQueue(), []);
  useSyncExternalStore(queue.subscribe, queue.getVersion, queue.getVersion);
  const moment = queue.getCurrent();
  const [hidden, setHidden] = useState(EMPTY);
  const [championState, setChampionState] = useState({ key: "", parked: false });
  const [parkSpot, setParkSpot] = useState("");
  const snapshotRef = useRef(null);
  const championKeyRef = useRef(null);
  const matches = useMemo(() => data?.matches_v2 || [], [data?.matches_v2]);
  const champion = useMemo(() => (data ? championOf(matches, data.stages || []) : null), [data, matches]);

  useEffect(() => {
    if (!data) return;
    const { started, decided, snapshot } = bracketChanges(snapshotRef.current, matches);
    const first = snapshotRef.current === null;
    snapshotRef.current = snapshot;
    const key = championKey(champion);
    // Beim ersten Laden ist nichts neu: steht der Sieger schon fest, gleich das Endbild - ohne Konfetti.
    if (first) {
      championKeyRef.current = key;
      setChampionState({ key, parked: Boolean(champion) });
      return;
    }
    if (key !== championKeyRef.current) {
      championKeyRef.current = key;
      setChampionState({ key, parked: false });
      if (champion) queue.enqueue({ type: "champion", key });
    }
    // Das Finale bekommt den Champion-Moment statt einer Ergebnis-Karte.
    const results = decided.filter((matchId) => !champion || matchId !== champion.finalMatchId);
    if (results.length) {
      if (motionOn) {
        // Bis die Fahrt ankommt, zeigen die Ziel-Plätze noch, wer kommt - dann landet der Name dort.
        const keys = [];
        for (const matchId of results) {
          const match = matches.find((row) => row.id === matchId);
          for (const move of advancementsOf(match, matches)) {
            if (move.target && ["win", "drop"].includes(move.kind)) keys.push(`${move.target.matchId}:${move.target.slotIndex}`);
          }
        }
        if (keys.length) setHidden((current) => new Set([...current, ...keys]));
      }
      if (results.length > COLLECT_AFTER) queue.enqueue({ type: "result", items: results });
      else results.forEach((matchId) => queue.enqueue({ type: "result", items: [matchId] }));
    }
    if (started.length) queue.enqueue({ type: "live", matchIds: started });
    queue.next();
  }, [data, matches, champion, queue, motionOn]);

  const onMomentDone = useCallback((momentId) => {
    queue.finish(momentId);
    queue.next();
  }, [queue]);
  const onReveal = useCallback((keys) => {
    if (!keys?.length) return;
    setHidden((current) => {
      if (!keys.some((key) => current.has(key))) return current;
      const next = new Set(current);
      keys.forEach((key) => next.delete(key));
      return next.size ? next : EMPTY;
    });
  }, []);
  const onChampionParked = useCallback(() => setChampionState((current) => ({ ...current, parked: true })), []);
  // Ohne Bewegung landen Namen sofort - es gibt nichts zu verstecken.
  const hiddenSlots = motionOn ? hidden : EMPTY;
  const { gong, needsClick } = useResultSound(Boolean(settings.result_sound));

  if (keyRefused) {
    return (
      <div className="tv-page" data-testid="tv-key-refused">
        <div className="flex-1 flex flex-col items-center justify-center gap-[calc(var(--tv-u)*1.5)] px-[var(--tv-edge)] text-center">
          <div className="tv-t-head font-heading font-black uppercase">Dieser TV-Link gilt nicht mehr</div>
          <div className="tv-t-info tv-muted">Im Admin unter eSports → TV &amp; Beamer einen neuen Link erstellen und hier öffnen.</div>
        </div>
      </div>
    );
  }

  const t = data?.tournament;
  const hasMatches = matches.length > 0;
  const publicUrl = t ? `${window.location.origin}/tournaments/${t.slug || t.id}/bracket` : window.location.origin;
  const parked = Boolean(champion) && championState.parked && championState.key === championKey(champion);

  return (
    <div className="tv-page" data-testid="bracket-tv">
      {t ? (
        <TvHeader
          className="tls-header-sweep"
          // Rot heißt „läuft gerade“ (#1116): der Punkt in der Kopfleiste nur, solange das Turnier läuft.
          kicker={toneFor(t.status) === "live" ? "THE LION SQUAD · LIVE" : "THE LION SQUAD · TURNIERBAUM"}
          live={toneFor(t.status) === "live"}
          title={t.title}
          subtitle={hasMatches ? (parked ? "Turnier entschieden" : "Turnierbaum") : null}
          aside={(
            <>
              {parked && parkSpot === "header" ? (
                <TvChampionCard champion={champion} registrations={data?.registrations || []} parked spot="header" testId="tv-champion-parked" />
              ) : null}
              <TvPill tone={toneFor(t.status)} live={toneFor(t.status) === "live"} testId={`status-${t.status}`}>{statusBadgeLabel(t.status)}</TvPill>
            </>
          )}
        />
      ) : null}
      <DisplayStatusBanner error={loadError} lastUpdated={lastUpdated} label="Turnierbaum" onRetry={load} />

      <main className="tv-main" data-testid="tv-main">
        <div className="h-full min-h-0" data-testid="tv-board-area">
          {!data ? (
            <div className="tv-empty tv-t-head font-display">{loadError ? "Turnierbaum konnte nicht geladen werden" : "Lade Turnierbaum …"}</div>
          ) : !hasMatches ? (
            <div className="tv-empty tv-t-head font-display">Turnierbaum wurde noch nicht generiert</div>
          ) : (
            <TvBracketStage
              data={data}
              moment={moment}
              onMomentDone={onMomentDone}
              hiddenSlots={hiddenSlots}
              onReveal={onReveal}
              champion={champion}
              championParked={parked}
              onChampionParked={onChampionParked}
              onParkSpot={setParkSpot}
              gong={gong}
            />
          )}
        </div>
      </main>

      <TvFooter qrValue={publicUrl} kicker="Jetzt mitfiebern" text="QR scannen und Turnierbaum öffnen" />
      {needsClick ? <div className="tv-hint tv-t-meta" role="status" data-testid="tv-sound-hint">Für Ton einmal klicken</div> : null}
    </div>
  );
}
