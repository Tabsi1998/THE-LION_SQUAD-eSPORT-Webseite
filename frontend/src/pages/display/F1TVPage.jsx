import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api, resolveMediaUrl } from "@/lib/api";
import { DisplayStatusBanner } from "@/components/tls/DisplayStatusBanner";
import { TvScreen, useTv, useTvArea } from "@/components/tv/TvScreen";
import { TvFooter, TvHeader } from "@/components/tv/TvParts";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { charsPerLine, fitItems, TV_LINE, wrapLines } from "@/lib/tvType";

// Fast-Lap-TV: Podium, Rangliste und Vereins-Referenz. Größen aus tv.css (#1111); die Rangliste zeigt so viele
// Zeilen, wie ohne Abschneiden Platz haben - nichts liegt mehr unter der Fußleiste.

const medalColors = ["#FFD700", "#C0C0C0", "#CD7F32"];
const TRACK_MS = 45000;
const DEFAULT_AREA = { w: 170, h: 60 };

export default function F1TVPage() {
  return (
    <TvScreen>
      <FastLapTv />
    </TvScreen>
  );
}

function FastLapTv() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { motionOn, scale, box } = useTv();
  const [challenge, setChallenge] = useState(null);
  const [activeTrackIdx, setActiveTrackIdx] = useState(0);
  const [board, setBoard] = useState(null);
  const [challengeError, setChallengeError] = useState(null);
  const [boardError, setBoardError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [listRef, listMeasured, listTrim] = useTvArea(board ? `${board.track?.id || ""}:${(board.entries || []).length}` : "");
  const listArea = listMeasured || DEFAULT_AREA;
  const trackParam = searchParams.get("track");

  const loadChallenge = useCallback(async () => {
    try {
      const { data } = await api.get(`/f1/challenges/${id}`);
      setChallenge(data);
      setChallengeError(null);
      if (trackParam && data.tracks) {
        const idx = data.tracks.findIndex((t) => t.id === trackParam || t.slug === trackParam);
        if (idx >= 0) setActiveTrackIdx(idx);
      }
    } catch (error) {
      setChallengeError(error);
    }
  }, [id, trackParam]);

  useEffect(() => {
    loadChallenge();
  }, [loadChallenge]);

  useApiInvalidation(loadChallenge, ["f1"]);

  const activeTrack = challenge?.tracks?.length ? challenge.tracks[activeTrackIdx % challenge.tracks.length] : null;
  const fetchLB = useCallback(async () => {
    if (!activeTrack) return;
    try {
      const { data } = await api.get(`/f1/challenges/${id}/leaderboard?track_id=${activeTrack.id}`);
      setBoard(data);
      setBoardError(null);
      setLastUpdated(Date.now());
    } catch (error) {
      setBoardError(error);
    }
  }, [activeTrack, id]);
  useEffect(() => {
    fetchLB();
  }, [fetchLB]);
  // Die TV-Anzeige läuft stundenlang: ohne Strom alle 7 s nachfragen.
  useLiveRefresh(fetchLB, ["f1"], { fallbackMs: 7000 });

  // Strecken wechseln alle 45 s bei Meisterschaften - außer der Link hält eine Strecke fest (?track=).
  useEffect(() => {
    if (!challenge?.is_championship || !challenge.tracks?.length) return undefined;
    if (searchParams.get("track")) return undefined;
    const iv = setInterval(() => setActiveTrackIdx((i) => (i + 1) % challenge.tracks.length), TRACK_MS);
    return () => clearInterval(iv);
  }, [challenge, searchParams]);

  // Pfeiltasten: Strecke vor und zurück
  useEffect(() => {
    if (!challenge?.tracks?.length) return undefined;
    const onKey = (e) => {
      if (e.key === "ArrowRight") setActiveTrackIdx((i) => (i + 1) % challenge.tracks.length);
      else if (e.key === "ArrowLeft") setActiveTrackIdx((i) => (i - 1 + challenge.tracks.length) % challenge.tracks.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [challenge]);

  const entries = useMemo(() => board?.entries || [], [board]);
  const references = board?.club_reference_entries || [];
  // Die Rangliste ab Platz 4: so viele Zeilen, wie Platz haben (#1111).
  const restFit = useMemo(() => {
    const rest = entries.slice(3);
    const nameWidth = listArea.w * 0.55 - 2 * box.padX;
    const rowHeight = (entry) => {
      const lines = Math.max(1, wrapLines(entry.display_name || "", charsPerLine(nameWidth, scale.name)));
      return 2 * 0.6 + Math.max(lines * scale.name * TV_LINE.name, scale.num * TV_LINE.num) + 0.35;
    };
    const fit = fitItems(rest, listArea.h, rowHeight, 0.5, scale.meta * TV_LINE.meta);
    // Läuft die Liste am TV trotzdem über (andere Schrift), fallen hinten Zeilen weg - nie abgeschnitten.
    if (!listTrim) return fit;
    const shown = fit.shown.slice(0, Math.max(0, fit.shown.length - listTrim));
    return { shown, hidden: rest.length - shown.length };
  }, [entries, listArea, box, scale, listTrim]);

  if (!challenge) {
    return (
      <div className="tv-page">
        <DisplayStatusBanner error={challengeError} label="Fast-Lap Challenge" onRetry={loadChallenge} />
        <div className="tv-main">
          <div className="tv-empty tv-t-head font-display">{challengeError ? "Fast-Lap-Ansicht konnte nicht geladen werden" : "Lade …"}</div>
        </div>
      </div>
    );
  }

  const track = board?.track;
  const top3 = entries.slice(0, 3);
  const publicUrl = `${window.location.origin}/fastlap/${challenge.slug || challenge.id}`;
  const trackCount = challenge.tracks?.length || 1;
  const prevTrack = () => challenge.tracks?.length && setActiveTrackIdx((i) => (i - 1 + challenge.tracks.length) % challenge.tracks.length);
  const nextTrack = () => challenge.tracks?.length && setActiveTrackIdx((i) => (i + 1) % challenge.tracks.length);

  return (
    <div className="tv-page" data-testid="fastlap-tv">
      <TvHeader
        kicker="THE LION SQUAD · FAST LAP"
        title={challenge.title}
        aside={(
          <div className="flex items-center gap-[calc(var(--tv-u)*1.6)]">
            {track?.image_url ? (
              <div className="w-[calc(var(--tv-u)*16)] h-[calc(var(--tv-u)*8.5)] border border-[color:var(--tv-line)] bg-black/50 rounded-sm overflow-hidden flex items-center justify-center shrink-0">
                <img src={resolveMediaUrl(track.image_url)} alt="" className="w-full h-full object-contain" />
              </div>
            ) : null}
            <div className="text-right min-w-0">
              <div className="tv-kicker tv-t-meta tv-faint">Strecke {activeTrackIdx + 1} / {trackCount}</div>
              <div className="tv-t-title font-heading font-black uppercase tv-accent">{track?.name || activeTrack?.name || "—"}</div>
              {track?.country ? <div className="tv-t-info tv-muted">{track.country}</div> : null}
              {trackCount > 1 ? (
                <div className="mt-[calc(var(--tv-u)*0.6)] flex items-center justify-end gap-[calc(var(--tv-u)*0.6)]">
                  <button type="button" onClick={prevTrack} data-testid="f1-tv-prev-track" className="tv-pill tv-t-meta" title="Vorherige Strecke (←)" aria-label="Vorherige Strecke">
                    <ChevronLeft className="tv-icon" />
                  </button>
                  <select
                    value={activeTrackIdx}
                    onChange={(e) => setActiveTrackIdx(Number(e.target.value))}
                    data-testid="f1-tv-track-select"
                    aria-label="Strecke wählen"
                    className="tv-t-meta bg-black border border-[color:var(--tv-line)] px-[0.6em] py-[0.3em] rounded-sm"
                  >
                    {challenge.tracks.map((tr, i) => <option key={tr.id} value={i}>{tr.name}</option>)}
                  </select>
                  <button type="button" onClick={nextTrack} data-testid="f1-tv-next-track" className="tv-pill tv-t-meta" title="Nächste Strecke (→)" aria-label="Nächste Strecke">
                    <ChevronRight className="tv-icon" />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}
      />
      <DisplayStatusBanner error={boardError} lastUpdated={lastUpdated} label="Rangliste" onRetry={loadChallenge} />

      <main className="tv-main flex flex-col gap-[calc(var(--tv-u)*1.4)]">
        <div className="grid grid-cols-3 gap-[calc(var(--tv-u)*2)] shrink-0 pt-[calc(var(--tv-u)*2.4)]">
          {top3.map((entry, i) => (
            <motion.div
              key={entry.user_id}
              initial={motionOn ? { y: 30, opacity: 0 } : false}
              animate={{ y: 0, opacity: 1 }}
              transition={motionOn ? { delay: i * 0.15 } : { duration: 0 }}
              className="tv-card tv-podium relative px-[calc(var(--tv-u)*2)] pt-[calc(var(--tv-u)*2.6)] pb-[calc(var(--tv-u)*1.4)]"
              style={{ borderColor: `${medalColors[i]}99`, borderWidth: "max(2px, calc(var(--tv-u) * 0.2))" }}
              data-testid="tv-podium"
            >
              <div className="absolute top-0 left-[calc(var(--tv-u)*2)] -translate-y-1/2 px-[0.6em] py-[0.15em] tv-t-num font-display font-black" style={{ backgroundColor: medalColors[i], color: "#000" }}>
                P{i + 1}
              </div>
              <div className="tv-t-name font-heading font-black uppercase" data-tv-name="1" data-fit={(entry.display_name || "").length > 20 ? "small" : undefined}>{entry.display_name}</div>
              <div className="tv-t-hero font-display font-bold" style={{ color: medalColors[i] }}>{entry.time_str}</div>
              <div className="tv-t-info tv-muted">{entry.gap_str || "Leader"} · {entry.attempts} Versuche</div>
            </motion.div>
          ))}
          {top3.length === 0 && (
            <div className="col-span-3 tv-empty tv-t-head font-display">Noch keine Zeiten</div>
          )}
        </div>

        <div ref={listRef} className="flex-1 min-h-0 overflow-hidden flex flex-col gap-[calc(var(--tv-u)*0.5)]" data-testid="tv-lap-list">
          {/* Ohne Ausblenden beim Wegfallen: eine Zeile, die gerade ausblendet, belegte noch Platz - die Liste liefe kurz über. */}
          {restFit.shown.map((entry, i) => (
              <motion.div
                key={entry.user_id}
                initial={motionOn ? { x: -20, opacity: 0 } : false}
                animate={{ x: 0, opacity: 1 }}
                transition={motionOn ? { delay: i * 0.03 } : { duration: 0 }}
                className="tv-card grid grid-cols-12 items-center gap-[var(--tv-gap)] px-[calc(var(--tv-u)*1.6)] py-[calc(var(--tv-u)*0.6)]"
                data-testid="tv-lap-row"
              >
                <div className="col-span-1 tv-t-num font-display font-bold tv-accent">{entry.rank}</div>
                <div className="col-span-7 tv-t-name font-heading font-bold uppercase" data-tv-name="1">{entry.display_name}</div>
                <div className="col-span-2 text-right tv-t-num font-display font-bold">{entry.time_str}</div>
                <div className="col-span-2 text-right tv-t-info tv-muted tabular-nums">{entry.gap_str}</div>
              </motion.div>
          ))}
          {restFit.hidden > 0 ? <div className="tv-t-meta tv-faint text-center uppercase tracking-[0.18em]">+ {restFit.hidden} weitere Zeiten</div> : null}
        </div>

        {references.length > 0 && (
          <div className="shrink-0 border border-[color:var(--tv-gold)] bg-[color:var(--tv-gold-soft)] rounded-sm px-[calc(var(--tv-u)*1.6)] py-[calc(var(--tv-u)*1)]" data-testid="tv-references">
            <div className="tv-kicker tv-t-meta tv-gold">Vereins-Referenz · außer Wertung</div>
            <div className="tv-t-meta tv-muted">Zielzeiten zum Schlagen, nicht Teil der offiziellen Rangliste.</div>
            <div className="mt-[calc(var(--tv-u)*0.8)] grid grid-cols-3 gap-[var(--tv-gap)]">
              {references.slice(0, 3).map((entry) => (
                <div key={entry.user_id} className="tv-card px-[calc(var(--tv-u)*1.2)] py-[calc(var(--tv-u)*0.6)]">
                  <div className="flex items-center justify-between gap-[var(--tv-gap)]">
                    <span className="tv-t-num font-display font-bold tv-gold">#{entry.rank}</span>
                    <span className="tv-t-num font-display font-bold tabular-nums">{entry.time_str}</span>
                  </div>
                  <div className="tv-t-name font-heading font-bold uppercase" data-tv-name="1">{entry.display_name}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <TvFooter qrValue={publicUrl} kicker="Join The Race" text="QR scannen und mitfahren" sponsorMax={3} />
    </div>
  );
}
