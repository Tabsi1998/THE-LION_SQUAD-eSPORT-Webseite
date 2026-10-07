// Was die Hallen-Tafel (#1126) und die Aufruf-Tafel eines Events (#1122) laden: das Event mit Turnieren, Fast Laps und
// Tagen, alle Stationen (des Events und seiner Turniere) und die Spiele aller Turniere - für die Turnierleitung mit allen
// Daten, sonst die öffentliche Ansicht. Neu geladen, sobald sich etwas ändert (ohne Verbindung alle 15 Sekunden).
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { sortByNearestDate } from "@/lib/contentSort";
import { describeSlot, finderFor, isMatchDone } from "@/lib/slotSource";
import { matchName } from "@/lib/tvLive";

async function loadTournamentBracketForDisplay(tournamentId) {
  const encoded = encodeURIComponent(tournamentId);
  try {
    return await api.get(`/tournaments/${encoded}/bracket/display`);
  } catch {
    return api.get(`/tournaments/${encoded}/bracket`);
  }
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

export function useEventHall(id) {
  const [event, setEvent] = useState(null);
  const [stations, setStations] = useState([]);
  const [payloads, setPayloads] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/events/${id}`);
      const tournaments = sortByNearestDate(data?.tournaments || []);
      const stationResponses = await Promise.allSettled([
        api.get(`/stations?event_id=${encodeURIComponent(data.id)}`),
        ...tournaments.map((tournament) => api.get(`/stations?tournament_id=${encodeURIComponent(tournament.id)}`)),
      ]);
      const stationRows = stationResponses.filter((result) => result.status === "fulfilled").flatMap((result) => result.value.data || []);
      const bracketResponses = await Promise.allSettled(tournaments.map((tournament) => loadTournamentBracketForDisplay(tournament.id)));
      setEvent({ ...data, tournaments });
      setStations(Array.from(new Map(stationRows.map((station) => [station.id, station])).values()));
      setPayloads(bracketResponses.filter((result) => result.status === "fulfilled").map((result) => result.value.data).filter(Boolean));
      setLoadError(null);
      setLastUpdated(Date.now());
    } catch (error) {
      setLoadError(error);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);
  // Die TV-Anzeige läuft stundenlang: ohne Strom alle 15 s nachfragen.
  useLiveRefresh(load, ["events", "tournaments", "matches", "matches-v2", "stations", "f1"], { fallbackMs: 15000 });

  const lookup = useMemo(() => stationMatchLookup(payloads), [payloads]);
  const matches = useMemo(() => payloads.flatMap((payload) => payload?.matches_v2 || []), [payloads]);
  const registrations = useMemo(() => payloads.flatMap((payload) => payload?.registrations || []), [payloads]);
  const tournamentOfMatch = useMemo(() => {
    const titles = new Map();
    for (const payload of payloads) for (const match of payload?.matches_v2 || []) titles.set(match.id, payload?.tournament?.title || "");
    return (match) => titles.get(match?.id) || "";
  }, [payloads]);
  return { event, stations, payloads, matches, registrations, lookup, tournamentOfMatch, loadError, lastUpdated, load };
}
