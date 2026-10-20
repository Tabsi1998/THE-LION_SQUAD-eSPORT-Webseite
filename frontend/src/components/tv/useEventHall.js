// Was die Hallen-Tafel (#1126) und die Aufruf-Tafel eines Events (#1122) laden: das Event mit Turnieren, Fast Laps und
// Tagen, alle Stationen (des Events und seiner Turniere) und die Spiele aller Turniere - für die Turnierleitung mit allen
// Daten, sonst die öffentliche Ansicht. Neu geladen, sobald sich etwas ändert (ohne Verbindung alle 15 Sekunden).
//
// Mit Anzeige-Schlüssel im Link (#1822, TV & Beamer): alles in einer Abfrage, auch Turniere „Nur Mitglieder“ - am
// Hallen-TV ohne Anmeldung. Ohne Schlüssel bleibt es öffentlich, aber ohne absehbare 401: Gäste fragen die Daten der
// Turnierleitung gar nicht erst an, und wer angemeldet ist, aber nicht leitet, fragt nach der ersten Absage nicht mehr.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useOptionalAuth } from "@/context/AuthContext";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { sortByNearestDate } from "@/lib/contentSort";
import { describeSlot, finderFor, isMatchDone } from "@/lib/slotSource";
import { matchName } from "@/lib/tvLive";

const HALL_RESOURCES = ["events", "tournaments", "matches", "matches-v2", "stations", "f1"];
// Mit Schlüssel dazu „tv“: ein widerrufener Schlüssel wirkt sofort.
const KEYED_RESOURCES = [...HALL_RESOURCES, "tv"];

const isRefusal = (error) => [401, 403].includes(error?.response?.status);

/** Der Baum eines Turniers: für die Turnierleitung die Daten der Leitung, sonst (und nach einer Absage) öffentlich. */
async function loadTournamentBracketForDisplay(tournamentId, display) {
  const encoded = encodeURIComponent(tournamentId);
  if (display.ask()) {
    try {
      return await api.get(`/tournaments/${encoded}/bracket/display`);
    } catch (error) {
      if (isRefusal(error)) display.refused();
    }
  }
  return api.get(`/tournaments/${encoded}/bracket`);
}

function stationMatchSort(a, b) {
  const statusRank = { in_progress: 0, running: 0, live: 0, ready: 1, scheduled: 2, pending: 3, preview: 4 };
  const aTime = Date.parse(a.scheduled_at || "") || Number.MAX_SAFE_INTEGER;
  const bTime = Date.parse(b.scheduled_at || "") || Number.MAX_SAFE_INTEGER;
  return (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9)
    || aTime - bTime
    || (Number(a.round || 0) - Number(b.round || 0))
    || ((a.order ?? a.match_index ?? 0) - (b.order ?? b.match_index ?? 0));
}

/** Je Spiel der Klartext für die Stationen: Turnier, „Spiel C“, die Namen („Sieger aus A“ für leere Plätze, #1113). */
export function stationMatchLookup(payloads = []) {
  const entries = [];
  for (const payload of payloads) {
    const registrations = new Map((payload?.registrations || []).map((registration) => [registration.id, registration]));
    const nameOf = (registrationId) => {
      const registration = registrations.get(registrationId) || {};
      return registration.display_name || registration.ingame_name || registration.user?.display_name || "";
    };
    const finder = finderFor(payload?.matches_v2 || []);
    const tournamentTitle = payload?.tournament?.title || "Turnier";
    for (const match of payload?.matches_v2 || []) {
      if (!match?.id || isMatchDone(match)) continue;
      const labels = (match.slots || []).map((slot) => describeSlot(slot, nameOf, finder(match)).label).filter(Boolean);
      entries.push({
        id: match.id,
        stationId: match.station_id || "",
        key: matchName(match),
        kind: tournamentTitle,
        participants: labels.slice(0, 4).join(labels.length > 2 ? " · " : " vs. ") || "Teilnehmer offen",
        match,
      });
    }
  }
  entries.sort((a, b) => stationMatchSort(a.match, b.match));
  const byId = new Map();
  const byStation = new Map();
  for (const detail of entries) {
    byId.set(detail.id, detail);
    if (detail.stationId && !byStation.has(detail.stationId)) byStation.set(detail.stationId, detail);
  }
  return { byId, byStation };
}

/**
 * Die Daten der Tafeln. `displayKey`: der Anzeige-Schlüssel aus dem Link (#1822) - dann zählt nur er, auch für
 * Angemeldete (wie beim Turnierbaum-TV); `keyRefused` sagt, dass er nicht (mehr) gilt.
 */
export function useEventHall(id, { displayKey = "" } = {}) {
  const [event, setEvent] = useState(null);
  const [stations, setStations] = useState([]);
  const [payloads, setPayloads] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [keyRefused, setKeyRefused] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  // Die Daten der Turnierleitung fragt nur, wer angemeldet ist - und nur, bis der Server einmal absagt (diese Sitzung).
  const signedIn = Boolean(useOptionalAuth()?.user);
  const leadRefusedRef = useRef(false);

  const load = useCallback(async () => {
    if (displayKey) {
      try {
        const { data } = await api.get(`/events/${encodeURIComponent(id)}/display`, { params: { key: displayKey } });
        setEvent({ ...data?.event, tournaments: sortByNearestDate(data?.event?.tournaments || []) });
        setStations(Array.isArray(data?.stations) ? data.stations : []);
        setPayloads((data?.brackets || []).filter(Boolean));
        setKeyRefused(false);
        setLoadError(null);
        setLastUpdated(Date.now());
      } catch (error) {
        // Widerrufen, abgelaufen oder falsch: die Tafel zeigt nichts mehr vom Event, nur wie es weitergeht.
        if (isRefusal(error)) {
          setKeyRefused(true);
          setEvent(null);
        }
        setLoadError(error);
      }
      return;
    }
    const display = {
      ask: () => signedIn && !leadRefusedRef.current,
      refused: () => {
        leadRefusedRef.current = true;
      },
    };
    try {
      const { data } = await api.get(`/events/${id}`);
      const tournaments = sortByNearestDate(data?.tournaments || []);
      const stationResponses = await Promise.allSettled([
        api.get(`/stations?event_id=${encodeURIComponent(data.id)}`),
        ...tournaments.map((tournament) => api.get(`/stations?tournament_id=${encodeURIComponent(tournament.id)}`)),
      ]);
      const stationRows = stationResponses.filter((result) => result.status === "fulfilled").flatMap((result) => result.value.data || []);
      const bracketResponses = await Promise.allSettled(tournaments.map((tournament) => loadTournamentBracketForDisplay(tournament.id, display)));
      setEvent({ ...data, tournaments });
      setStations(Array.from(new Map(stationRows.map((station) => [station.id, station])).values()));
      setPayloads(bracketResponses.filter((result) => result.status === "fulfilled").map((result) => result.value.data).filter(Boolean));
      setLoadError(null);
      setLastUpdated(Date.now());
    } catch (error) {
      setLoadError(error);
    }
  }, [id, displayKey, signedIn]);

  useEffect(() => {
    load();
  }, [load]);
  // Die TV-Anzeige läuft stundenlang: ohne Strom alle 15 s nachfragen.
  useLiveRefresh(load, displayKey ? KEYED_RESOURCES : HALL_RESOURCES, { fallbackMs: 15000 });

  const lookup = useMemo(() => stationMatchLookup(payloads), [payloads]);
  const matches = useMemo(() => payloads.flatMap((payload) => payload?.matches_v2 || []), [payloads]);
  const registrations = useMemo(() => payloads.flatMap((payload) => payload?.registrations || []), [payloads]);
  const tournamentOfMatch = useMemo(() => {
    const titles = new Map();
    for (const payload of payloads) for (const match of payload?.matches_v2 || []) titles.set(match.id, payload?.tournament?.title || "");
    return (match) => titles.get(match?.id) || "";
  }, [payloads]);
  return { event, stations, payloads, matches, registrations, lookup, tournamentOfMatch, loadError, keyRefused, lastUpdated, load };
}
