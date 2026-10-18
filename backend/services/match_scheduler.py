"""Der Spielplaner (#1552): eine Stelle, die Zeit und Station zusammen schreibt.

Bis hierher schrieben drei Stellen die Spielzeit (Stations-Planer, Spieltag-Lauf, Hand) und überschrieben sich
gegenseitig. Jetzt rechnet dieser Dienst den Plan und sagt je Spiel, woher der Termin stammt
(``schedule_source``): ``planner`` (von hier), ``live`` (an der Station gestartet), ``manual`` (Turnierleitung),
``accepted``/``home``/``default`` (Spielwochen online).

Regeln, wie der Betreiber sie gesetzt hat:

* **Ab jetzt.** Erledigtes und Laufendes bleibt; geplant wird ab ``max(jetzt, Turnierstart)``.
* **Abhängigkeiten aus dem Graph.** Ein Spiel kommt erst nach allen Spielen, aus denen seine Plätze stammen,
  plus Mindestpause. Stehen die Plätze noch nicht fest, ist die Zeit eine Prognose (``forecast``).
* **Kein Spieler zweimal gleichzeitig**, mit Mindestpause dazwischen - auch über die Turniere desselben Events,
  soweit deren Spiele schon Zeiten haben (``busy_elsewhere``).
* **Feste Termine bleiben.** Von Hand gesetzt oder vereinbart wird nie verschoben; ist es zu früh oder doppelt
  belegt, steht das rot in den Warnungen.
* **Reihenfolge:** von Hand → längste Kette bis zum Finale → längste Wartezeit (Runde, Reihenfolge).
* **Austragung:** Stationen nur vor Ort. Online und Liga bekommen nie Stationen; Spielwochen rechnet
  ``matchday_schedule`` (Liga-Modus), alles andere online wird abgestimmt.

Alles bis ``plan_schedule`` ist reine Rechnung auf Dicts - deshalb testbar ohne Datenbank. Laden und Schreiben
stehen unten.
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from pymongo import ReturnDocument

from services.advancement_draw import draw_group_of, match_mode, prerequisite_ids
from services.match_audience import playing_ids, teams_by_id
from services.match_v2_results import group_awaits_draw
from services.match_duration import effective_match_duration, load_duration_game, load_duration_games
from services.match_planning import restore_change, station_open_for_matches, written_state
from services.matchday_schedule import plays_in_matchdays, schedule_writes
from services.tournament_rules import match_policy

logger = logging.getLogger("tls.scheduler")

DEFAULT_BREAK_MINUTES = 5
# Uhrzeiten in Warnungen: so, wie die Turnierleitung in der Halle sie liest (#1557).
VIENNA = ZoneInfo("Europe/Vienna")
SCHEDULE_SOURCES = ("planner", "live", "manual", "accepted", "home", "default")
# Quellen, die der Planer nie anfasst: von Hand gesetzt und vereinbart.
KEPT_SOURCES = frozenset({"manual", "accepted"})
DONE_STATUSES = frozenset({"completed", "forfeit", "cancelled", "archived", "bye", "no_show", "disputed"})
RUNNING_STATUSES = frozenset({"in_progress", "running", "waiting_result"})
PLANNABLE_STATUSES = frozenset({"preview", "pending", "ready", "scheduled"})
TOURNAMENT_DONE_STATUSES = ("draft", "completed", "results_published", "archived", "cancelled")

Interval = tuple[datetime, datetime, str]


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _parse(value) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return _aware(value)
    try:
        return _aware(datetime.fromisoformat(str(value).replace("Z", "+00:00")))
    except ValueError:
        return None


def break_minutes(tournament: dict | None) -> int:
    try:
        value = int((tournament or {}).get("match_break_minutes"))
    except (TypeError, ValueError):
        return DEFAULT_BREAK_MINUTES
    return max(0, value)


def participants_of(match: dict, resolved: dict[str, set[str]] | None = None) -> set[str]:
    """Wer in diesem Spiel steht - Anmeldung und Konto, damit es auch über Turniere hinweg vergleichbar ist.

    ``resolved`` kommt vom Lader: je Spiel die Konten aller Beteiligten, bei Teams die Aufgestellten bzw. alle
    Mitglieder (``match_audience``). Ohne Lader zählen Anmeldung und das Konto am Platz.
    """
    if resolved and match.get("id") in resolved:
        return set(resolved[match["id"]])
    keys: set[str] = set()
    for slot in (match or {}).get("slots") or []:
        if slot.get("registration_id"):
            keys.add(f"reg:{slot['registration_id']}")
        if slot.get("user_id"):
            keys.add(f"user:{slot['user_id']}")
    for key in ("participant_a_id", "participant_b_id"):
        if (match or {}).get(key):
            keys.add(f"reg:{match[key]}")
    return keys


def _source(slot: dict) -> dict:
    source = (slot or {}).get("source")
    return source if isinstance(source, dict) else {}


def _min_players(match: dict) -> int:
    try:
        return max(1, int((match.get("settings") or {}).get("min_players") or 2))
    except (TypeError, ValueError):
        return 2


def _possible_players(match: dict) -> int:
    """Plätze, die noch besetzt werden können: gefüllt, aus einem Vorspiel oder noch offen - kein Freilos."""
    slots = match.get("slots") or []
    if not slots:
        return int(bool(match.get("participant_a_id"))) + int(bool(match.get("participant_b_id")))
    return sum(1 for slot in slots if slot.get("registration_id") or (_source(slot).get("type") != "bye" and slot.get("status") != "bye"))


def _unresolved(match: dict) -> bool:
    return any(not slot.get("registration_id") and _source(slot).get("type") != "bye" and slot.get("status") != "bye"
               for slot in match.get("slots") or [])


def _label(match: dict) -> str:
    return match.get("match_key") or match.get("round_name") or match.get("id") or "Spiel"


def _overlaps(start_a: datetime, end_a: datetime, start_b: datetime, end_b: datetime) -> bool:
    return start_a < end_b and start_b < end_a


@dataclass
class _Board:
    """Belegungen je Station und je Teilnehmer, dazu das Ende jedes gesetzten Spiels."""

    station_busy: dict[str, list[Interval]] = field(default_factory=dict)
    participant_busy: dict[str, list[Interval]] = field(default_factory=dict)
    ends: dict[str, datetime] = field(default_factory=dict)

    def block(self, match_id: str, station_id: str | None, participants: set[str], start: datetime, end: datetime) -> None:
        if station_id:
            self.station_busy.setdefault(station_id, []).append((start, end, match_id))
        for key in participants:
            self.participant_busy.setdefault(key, []).append((start, end, match_id))
        self.ends[match_id] = end

    def earliest(self, lower: datetime, minutes: int, station_id: str, participants: set[str], pause: int) -> datetime:
        """Der erste Zeitpunkt ab ``lower``, an dem Station und alle Spieler (mit Pause) frei sind."""
        duration = timedelta(minutes=minutes)
        gap = timedelta(minutes=pause)
        moment = lower
        for _ in range(10_000):
            end = moment + duration
            clash = next((busy_end for busy_start, busy_end, _ in self.station_busy.get(station_id, [])
                          if _overlaps(moment, end, busy_start, busy_end)), None)
            if clash is not None:
                moment = clash
                continue
            clash = next((busy_end + gap for key in participants for busy_start, busy_end, _ in self.participant_busy.get(key, [])
                          if _overlaps(moment, end + gap, busy_start, busy_end + gap)), None)
            if clash is not None:
                moment = clash
                continue
            return moment
        return moment


def _predecessors(match: dict, by_key: dict[tuple, dict]) -> list[dict]:
    """Die Vorspiele laut Platz-Herkunft (``slot.source``)."""
    found = []
    for slot in match.get("slots") or []:
        source = _source(slot)
        if source.get("type") == "rank" and source.get("match_key"):
            previous = by_key.get((match.get("stage_id"), source["match_key"]))
            if previous is not None and previous.get("id") != match.get("id"):
                found.append(previous)
    return found


def _predecessor_map(matches: list[dict], by_key: dict[tuple, dict]) -> dict[str, list[dict]]:
    """Worauf jedes Spiel wartet. Gemischt (#1548) wartet eine Folgerunde auf **alle** Spiele der Runde davor - die
    Auslosung passiert erst, wenn sie fertig ist (``advancement_draw.prerequisite_ids``); sonst die Platz-Herkunft.
    Sofort zufällig (#1590): je Zielspiel die Prognose-Regel (``advancement_draw.instant_prerequisites``) - die
    Zielspiele in Schlüssel-Reihenfolge füllen sich mit den Quellen in Schlüssel-Reihenfolge; die Platz-Herkunft aus dem
    Schema zählt dort nicht, denn der Platz wird erst beim Ergebnis gezogen."""
    by_id = {match["id"]: match for match in matches}
    direct = {match["id"]: _predecessors(match, by_key) for match in matches}
    groups: dict[tuple, list[dict]] = {}
    for match in matches:
        group = draw_group_of(match)
        if group:
            groups.setdefault((match.get("stage_id"), group), []).append(match)
    group_needs: dict[tuple, dict[str, dict]] = {}
    instant_needs: dict[str, dict[str, dict]] = {}
    for (stage_id, group), mates in groups.items():
        stage_rows = [row for row in matches if row.get("stage_id") == stage_id]
        if match_mode(mates[0]) == "instant":
            for mate in mates:
                instant_needs[mate["id"]] = {match_id: by_id[match_id] for match_id in prerequisite_ids(mate, stage_rows)
                                             if match_id in by_id}
            continue
        needed: dict[str, dict] = {}
        for match_id in prerequisite_ids(mates[0], stage_rows):
            if match_id in by_id:
                needed[match_id] = by_id[match_id]
        for mate in mates:
            for previous in direct[mate["id"]]:
                needed.setdefault(previous["id"], previous)
        group_needs[(stage_id, group)] = needed
    result: dict[str, list[dict]] = {}
    for match in matches:
        if match["id"] in instant_needs:
            found = dict(instant_needs[match["id"]])
        else:
            found = {previous["id"]: previous for previous in direct[match["id"]]}
            group = draw_group_of(match)
            if group:
                found.update(group_needs[(match.get("stage_id"), group)])
        found.pop(match["id"], None)
        result[match["id"]] = list(found.values())
    return result


def _draw_state(match: dict, matches: list[dict]) -> dict:
    """Für Matchplan und Prognose (#1590): wartet das Spiel auf ein Los je Runde - und steht der Topf schon (Show)?"""
    group = draw_group_of(match)
    if not group or match_mode(match) == "instant":
        return {"waiting_for_draw": False, "draw_ready": False}
    waiting = group_awaits_draw(matches, group, match.get("stage_id"))
    return {"waiting_for_draw": waiting, "draw_ready": waiting and isinstance(match.get("draw_ready"), dict)}


def _chain_lengths(matches: list[dict], predecessors: dict[str, list[dict]]) -> dict[str, int]:
    """Wie viele Spiele hängen noch an diesem - die längste Kette bis zum Finale geht zuerst."""
    successors: dict[str, list[str]] = {}
    for match in matches:
        for previous in predecessors.get(match["id"], []):
            successors.setdefault(previous["id"], []).append(match["id"])
    lengths: dict[str, int] = {}

    def length(match_id: str, trail: frozenset) -> int:
        if match_id in lengths:
            return lengths[match_id]
        if match_id in trail:
            return 0
        following = successors.get(match_id) or []
        value = 1 + max(length(item, trail | {match_id}) for item in following) if following else 0
        lengths[match_id] = value
        return value

    for match in matches:
        length(match["id"], frozenset())
    return lengths


def _device_fits(station: dict, game: dict | None) -> bool:
    """Gerät des Spiels (#1554): kennt das Game Geräte, nimmt der Planer nur Stationen mit einem davon. Eine Station ohne
    Gerät oder fest für dieses Spiel passt immer."""
    devices = (game or {}).get("station_devices") or []
    device = str(station.get("device_type") or "").strip().lower()
    return not devices or not device or bool(station.get("game_id")) or device in devices


def _usable_stations(tournament: dict, stations, game: dict | None = None) -> list[dict]:
    game_id = (tournament or {}).get("game_id")
    return [
        station for station in stations or []
        if station.get("status") != "broken" and (not station.get("game_id") or not game_id or station.get("game_id") == game_id)
        and _device_fits(station, game)
    ]


def _plan_stations(tournament: dict, matches: list[dict], stations, stage_by_id: dict, now: datetime, busy_elsewhere,
                   participant_keys: dict[str, set[str]] | None = None, game: dict | None = None) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    warnings: list[dict] = []
    # Spiele, die der Planer nicht mehr plant, aber früher selbst geplant hat (#1608): ihr Termin wird gelöst.
    releases: list[dict] = []

    def release(match: dict) -> None:
        releases.append({
            "match_id": match["id"], "match_key": match.get("match_key"), "label": _label(match),
            "stage_id": match.get("stage_id"),
            "previous": {"scheduled_at": match.get("scheduled_at"), "station_id": match.get("station_id"),
                         "schedule_source": match.get("schedule_source"), "status": match.get("status")},
        })

    def planner_time(match: dict) -> bool:
        return match.get("schedule_source") == "planner" and bool(match.get("scheduled_at") or match.get("station_id"))

    def players_of(match: dict) -> set[str]:
        return participants_of(match, participant_keys)
    usable = _usable_stations(tournament, stations, game)
    if not usable:
        # Ohne freie Station plant der Planer keine Zeiten - feste Termine prüft er trotzdem (Praxis 14.10.: ohne Station
        # standen von Hand gesetzte Spiele vor ihren Vorspielen, und nichts war rot).
        warnings.append({"type": "no_stations", "severity": "warning",
                         "message": "Keine freie Station für dieses Turnier - ohne Stationen plant der Planer keine Zeiten."})

    pause = break_minutes(tournament)
    horizon = max(now, _parse(tournament.get("start_date")) or now)
    by_id = {match["id"]: match for match in matches}
    by_key = {(match.get("stage_id"), match.get("match_key")): match for match in matches if match.get("match_key")}
    board = _Board()

    def duration(match: dict) -> int:
        return effective_match_duration(match, stage=stage_by_id.get(match.get("stage_id")), tournament=tournament, game=game)

    for entry in busy_elsewhere or []:
        start, end = _parse(entry.get("start")), _parse(entry.get("end"))
        if start and end:
            board.block(entry.get("match_id") or entry.get("label") or "anderes Turnier", None, set(entry.get("participants") or ()), start, end)

    station_by_id = {station["id"]: station for station in stations or [] if station.get("id")}
    for station in usable:
        current = station.get("current_match_id")
        if station.get("status") == "busy" and current and current not in by_id:
            # Ein anderes Turnier spielt gerade hier: bis auf Weiteres belegt.
            board.block(current, station["id"], set(), now, now + timedelta(minutes=effective_match_duration(tournament=tournament, game=game)))

    fixed: list[tuple[dict, datetime, datetime]] = []
    # Was der Planer nicht verschiebt, mit Zeit und Station - die Live-Warteschlange (#1556) liest es mit.
    held: list[dict] = []
    candidates: list[dict] = []
    for match in matches:
        status = str(match.get("status") or "")
        if status in DONE_STATUSES:
            # Kampflos entschieden (Freilos nach Austritt, `resolve_walkovers`, Codex zu #1608): nie gespielt - ein alter
            # Termin des Planers samt Station gehört nicht mehr dazu.
            if ((match.get("result_meta") or {}).get("source") == "auto_bye" and planner_time(match)
                    and not match.get("started_at") and not match.get("called_at")):
                release(match)
            continue
        running = status in RUNNING_STATUSES or bool(match.get("started_at"))
        kept = match.get("schedule_source") in KEPT_SOURCES and _parse(match.get("scheduled_at")) is not None
        # Aufgerufen (#1556): Station und Spieler sind schon unterwegs - das Spiel bleibt an seiner Station und beginnt
        # frühestens jetzt; kein „Planen“ verteilt einen Aufruf neu.
        called = not running and bool(match.get("called_at")) and bool(match.get("station_id"))
        if running or kept or called:
            if running:
                start = _parse(match.get("started_at")) or _parse(match.get("scheduled_at")) or now
            elif called:
                start = max(now, _parse(match.get("scheduled_at")) or now)
            else:
                start = _parse(match.get("scheduled_at")) or now
            end = start + timedelta(minutes=duration(match))
            if running:
                end = max(end, now)
            # Ein Aufruf hält Station und Spieler ab jetzt, auch wenn die geplante Zeit später liegt - sonst legt der
            # Planer davor noch etwas auf die schon reservierte Station (Codex zu #1595).
            board.block(match["id"], match.get("station_id"), players_of(match), now if called else start, end)
            fixed.append((match, start, end))
            held.append({"match_id": match["id"], "station_id": match.get("station_id"), "start": start.isoformat(),
                         "end": end.isoformat(), "minutes": duration(match),
                         "kind": "running" if running else "called" if called else "kept"})
            continue
        if status not in PLANNABLE_STATUSES:
            continue
        if _possible_players(match) < _min_players(match):
            # Nach einem Austritt kann ein späteres Spiel nur noch einen Spieler haben (Freilos, #1608): kein Zeitfenster,
            # keine Station. Ein alter Termin des Planers bleibt sonst stehen und meldet falsche Überschneidungen.
            # Von Hand gesetzte und vereinbarte Termine (KEPT_SOURCES) sind oben schon gehalten.
            if planner_time(match):
                release(match)
            continue
        candidates.append(match)

    # Spiele an einer Station, die es nicht mehr gibt (gelöscht, oder einem anderen Turnier zugeordnet): beim Namen nennen,
    # statt sie auf einer namenlosen Bahn zu zeigen - zuweisen kann man dort nichts mehr.
    orphans: dict[str, list[dict]] = {}
    for match in matches:
        station_id = match.get("station_id")
        if station_id and station_id not in station_by_id and str(match.get("status") or "") not in DONE_STATUSES:
            orphans.setdefault(station_id, []).append(match)
    for station_id, rows in orphans.items():
        labels = ", ".join(_label(row) for row in rows[:8]) + (" …" if len(rows) > 8 else "")
        count = f"{len(rows)} Spiel" if len(rows) == 1 else f"{len(rows)} Spiele"
        warnings.append({"type": "unknown_station", "severity": "error", "station_id": station_id,
                         "match_ids": [row["id"] for row in rows],
                         "message": f"{count} ({labels}) hängen an einer Station, die es nicht mehr gibt - bitte neu zuweisen "
                                    f"oder mit „Automatisch planen“ neu verteilen."})

    # Feste Termine gegeneinander: dieselbe Station oder derselbe Spieler zur selben Zeit.
    reported: set[tuple[str, str]] = set()
    for index, (match, start, end) in enumerate(fixed):
        for other, other_start, other_end in fixed[index + 1:]:
            if not _overlaps(start, end, other_start, other_end):
                continue
            pair = tuple(sorted((match["id"], other["id"])))
            if pair in reported:
                continue
            if match.get("station_id") and match.get("station_id") == other.get("station_id"):
                reported.add(pair)
                station = station_by_id.get(match["station_id"]) or {}
                warnings.append({"type": "station_overlap", "severity": "error", "match_id": match["id"], "other_match_id": other["id"],
                                 "station_id": match["station_id"],
                                 "message": f"{station.get('name') or 'Station'}: {_label(match)} überschneidet sich mit {_label(other)}."})
            elif players_of(match) & players_of(other):
                reported.add(pair)
                warnings.append({"type": "player_overlap", "severity": "error", "match_id": match["id"], "other_match_id": other["id"],
                                 "message": f"{_label(match)} und {_label(other)}: ein Spieler ist zur selben Zeit in beiden Spielen."})

    predecessors = _predecessor_map(matches, by_key)
    chains = _chain_lengths(matches, predecessors)
    assignments: list[dict] = []
    stage_floor = horizon
    stage_numbers = sorted({int(match.get("stage_number") or 0) for match in candidates}) if usable else []
    for stage_number in stage_numbers:
        remaining = {match["id"]: match for match in candidates if int(match.get("stage_number") or 0) == stage_number}
        stage_ends: list[datetime] = [end for match, _start, end in fixed if int(match.get("stage_number") or 0) == stage_number]
        while remaining:
            ready = [match for match in remaining.values()
                     if all(previous["id"] not in remaining for previous in predecessors.get(match["id"], []))]
            if not ready:
                for match in remaining.values():
                    warnings.append({"type": "unplaced", "severity": "error", "match_id": match["id"],
                                     "message": f"{_label(match)}: die Vorspiele lassen sich nicht auflösen."})
                break
            match = min(ready, key=lambda item: (-chains.get(item["id"], 0), int(item.get("round") or 0),
                                                 int(item.get("order") or item.get("position") or 0), str(item.get("match_key") or item["id"])))
            del remaining[match["id"]]
            lower = stage_floor
            # Vorschau: wer gegen wen spielt, kann sich bis zum Check-in-Ende noch ändern - nur voraussichtlich.
            forecast = _unresolved(match) or bool(match.get("is_preview"))
            for previous in predecessors.get(match["id"], []):
                if str(previous.get("status") or "") not in DONE_STATUSES:
                    forecast = True
                end = board.ends.get(previous["id"])
                if end is not None:
                    lower = max(lower, end + timedelta(minutes=pause))
            minutes = duration(match)
            players = players_of(match)
            best = None
            for station in usable:
                moment = board.earliest(lower, minutes, station["id"], players, pause)
                key = (moment, str(station.get("name") or ""), station["id"])
                if best is None or key < best[0]:
                    best = (key, station, moment)
            _key, station, moment = best
            end = moment + timedelta(minutes=minutes)
            board.block(match["id"], station["id"], players, moment, end)
            stage_ends.append(end)
            previous_at = _parse(match.get("scheduled_at"))
            assignments.append({
                "match_id": match["id"],
                "match_key": match.get("match_key"),
                "label": _label(match),
                "stage_id": match.get("stage_id"),
                "round": match.get("round"),
                "scheduled_at": moment.isoformat(),
                "station_id": station["id"],
                "station_name": station.get("name"),
                "duration_minutes": minutes,
                "forecast": forecast,
                **_draw_state(match, matches),
                "schedule_source": "planner",
                "changed": (previous_at != moment or match.get("station_id") != station["id"]
                            or match.get("schedule_source") != "planner" or bool(match.get("schedule_forecast")) != forecast),
                "previous": {"scheduled_at": match.get("scheduled_at"), "station_id": match.get("station_id"),
                             "schedule_source": match.get("schedule_source"), "status": match.get("status")},
            })
        if stage_ends:
            # Die nächste Phase beginnt frühestens nach dem letzten Spiel dieser Phase plus Pause.
            stage_floor = max([stage_floor, *[end + timedelta(minutes=pause) for end in stage_ends]])

    # Feste Termine, die vor dem Ende ihrer Vorspiele liegen: rot melden, nicht verschieben.
    for match, start, _end in fixed:
        if match.get("schedule_source") not in KEPT_SOURCES:
            continue
        for previous in predecessors.get(match["id"], []):
            end = board.ends.get(previous["id"])
            if end is not None and end + timedelta(minutes=pause) > start:
                warnings.append({"type": "too_early", "severity": "error", "match_id": match["id"], "other_match_id": previous["id"],
                                 "earliest_at": (end + timedelta(minutes=pause)).isoformat(),
                                 "message": f"{_label(match)} ist fest um {start.astimezone(VIENNA).strftime('%H:%M')}, "
                                            f"aber {_label(previous)} ist erst um {end.astimezone(VIENNA).strftime('%H:%M')} vorbei."})
                break
    return assignments, warnings, held, releases


def _fingerprint(assignments: list[dict], releases: list[dict] = ()) -> str:
    rows = sorted((item["match_id"], item.get("scheduled_at"), item.get("station_id"), item.get("schedule_source")) for item in assignments)
    if releases:
        rows += sorted(("release", item["match_id"], (item.get("previous") or {}).get("scheduled_at"),
                        (item.get("previous") or {}).get("station_id")) for item in releases)
    return hashlib.sha256(json.dumps(rows, sort_keys=True).encode("utf-8")).hexdigest()[:16]


def plan_schedule(tournament: dict, matches, stations=(), *, stages=(), proposals=(), now: datetime | None = None,
                  busy_elsewhere=(), participant_keys: dict[str, set[str]] | None = None, game: dict | None = None) -> dict:
    """Der Plan als Vorschau: Zuordnungen (Zeit und Station je Spiel) und Warnungen - geschrieben wird nichts.

    ``participant_keys``: je Spiel-Kennung die Schlüssel aller Beteiligten (``reg:…``/``user:…``), wenn der Aufrufer
    Teams aufgelöst hat; sonst gelten Anmeldung und Konto am Platz.
    """
    now = _aware(now or datetime.now(timezone.utc))
    stage_by_id = {(stage or {}).get("id"): stage for stage in stages or []}
    local: list[dict] = []
    weekly: list[dict] = []
    for match in matches or []:
        stage = stage_by_id.get(match.get("stage_id"))
        if match_policy(match, tournament, stage)["event_mode"] == "local":
            # Auch der Vorschau-Baum (bis Check-in-Ende): Vorplanen, damit sich jede Person schon einplanen kann (Fabian
            # live 14.10.). Dieselben Abhängigkeiten wie im fixen Baum; alles nur „voraussichtlich“ (siehe forecast).
            local.append(match)
        elif match.get("is_preview"):
            continue
        elif plays_in_matchdays(tournament, stage):
            weekly.append(match)

    assignments: list[dict] = []
    warnings: list[dict] = []
    held: list[dict] = []
    releases: list[dict] = []
    if local:
        planned, found, held, releases = _plan_stations(tournament, local, stations, stage_by_id, now, busy_elsewhere,
                                                        participant_keys, game)
        assignments.extend(planned)
        warnings.extend(found)
    if weekly:
        for write in schedule_writes(tournament, weekly, proposals, list(stages or [])):
            assignments.append({
                "match_id": write["match_id"],
                "label": next((_label(match) for match in weekly if match.get("id") == write["match_id"]), write["match_id"]),
                "matchday": write["matchday"],
                "scheduled_at": write["update"]["scheduled_at"],
                "station_id": None,
                "station_name": None,
                "forecast": False,
                "schedule_source": write["update"]["schedule_source"],
                "status": write["update"].get("status"),
                "changed": True,
                "previous": {**(write.get("expect") or {}), "station_id": None},
            })
    if local and weekly:
        mode = "mixed"
    elif local:
        mode = "stations"
    elif weekly:
        mode = "matchdays"
    else:
        mode = "none"
    reason = None
    if mode == "none":
        reason = ("Online-Turnier: Termine werden abgestimmt, Stationen gibt es nur vor Ort."
                  if any(not match.get("is_preview") for match in matches or []) else "Keine Spiele zum Planen.")
    # Die Stationen, die der Planer kennt (des Turniers und - ohne Turnier - des Events): eine Wahrheit für Kopf und
    # Zeitleiste der Matchplan-Seite, samt Herkunft und ob er sie nutzt (defekt, falsches Gerät, anderes Spiel: nein).
    usable_ids = {station["id"] for station in _usable_stations(tournament, stations, game)}
    known_stations = [{
        "id": station["id"], "name": station.get("name") or "Station", "status": station.get("status"),
        "device_type": station.get("device_type"), "scope": "tournament" if station.get("tournament_id") else "event",
        "usable": station["id"] in usable_ids,
    } for station in stations or [] if station.get("id")]
    return {
        "mode": mode,
        "reason": reason,
        "planned_at": now.isoformat(),
        "assignments": assignments,
        "warnings": warnings,
        "held": held,
        "releases": releases,
        "fingerprint": _fingerprint(assignments, releases),
        "stations": known_stations,
    }


# ---------------------------------------------------------------- Laden und Schreiben

async def resolve_participant_keys(db, matches) -> dict[str, set[str]]:
    """Je Spiel die Schlüssel aller Beteiligten: Anmeldung, Konto am Platz und - bei Teams - jedes Mitglied bzw. die
    Aufgestellten. So ist ein Mensch, der in zwei Teams oder zwei Turnieren steht, überall derselbe."""
    registration_ids = {slot.get("registration_id") for match in matches for slot in (match.get("slots") or []) if slot.get("registration_id")}
    registrations = await db.tournament_registrations.find({"id": {"$in": sorted(registration_ids)}}, {"_id": 0}).to_list(len(registration_ids) + 10) if registration_ids else []
    by_id = {reg["id"]: reg for reg in registrations if reg.get("id")}
    teams = await teams_by_id(db, registrations)
    keys: dict[str, set[str]] = {}
    for match in matches:
        found = participants_of(match)
        for slot in match.get("slots") or []:
            registration = by_id.get(slot.get("registration_id") or "")
            if registration:
                found.update(f"user:{user_id}" for user_id in playing_ids(registration, teams.get(registration.get("team_id") or "")))
        keys[match["id"]] = found
    return keys


def station_query(tournament: dict) -> dict:
    """Die Stationen, die ein Turnier nutzen darf: eigene und die des Events ohne Turnier. Eine Stelle für Planer und
    „Termine lösen“ - eine Station eines anderen Turniers/Events gilt für beide als unbekannt."""
    tid = tournament["id"]
    event_id = tournament.get("event_id")
    if event_id:
        return {"$or": [{"tournament_id": tid}, {"event_id": event_id, "tournament_id": {"$in": [None, ""]}}]}
    return {"tournament_id": tid}


async def load_plan_inputs(db, tournament: dict) -> dict:
    """Alles, was der Planer braucht: Spiele, Phasen, Stationen, Vorschläge - und was am selben Event sonst läuft."""
    tid = tournament["id"]
    matches = await db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)
    stages = await db.tournament_stages.find({"tournament_id": tid}, {"_id": 0}).to_list(200)
    proposals = await db.match_schedule_proposals.find({"tournament_id": tid}, {"_id": 0, "match_collection": 0}).to_list(3000)
    event_id = tournament.get("event_id")
    stations = await db.stations.find(station_query(tournament), {"_id": 0}).to_list(500)
    participant_keys = await resolve_participant_keys(db, matches)
    busy_elsewhere: list[dict] = []
    if event_id:
        others = await db.tournaments.find(
            {"event_id": event_id, "id": {"$ne": tid}, "status": {"$nin": list(TOURNAMENT_DONE_STATUSES)}},
            {"_id": 0, "id": 1, "title": 1, "game_id": 1, "game_mode": 1, "best_of": 1, "match_duration_minutes": 1},
        ).to_list(100)
        # Gesammelt laden: ein Zugriff für die Spiele aller anderen Turniere, einmal Anmeldungen und Teams auflösen.
        title_by_id = {other["id"]: other.get("title") or "Turnier" for other in others}
        other_matches = await db.matches_v2.find(
            {"tournament_id": {"$in": sorted(title_by_id)}, "is_preview": {"$ne": True}, "scheduled_at": {"$nin": [None, ""]},
             "status": {"$nin": list(DONE_STATUSES)}},
            {"_id": 0, "id": 1, "tournament_id": 1, "slots": 1, "scheduled_at": 1, "started_at": 1, "duration_minutes": 1,
             "settings": 1, "match_key": 1, "stage_id": 1, "best_of": 1},
        ).to_list(None) if title_by_id else []  # vollständig: ein stilles Kappen ließe Konflikte unbemerkt
        other_keys = await resolve_participant_keys(db, other_matches) if other_matches else {}
        # Die Dauer der fremden Spiele aus ihrer eigenen Kette (Phase, Turnier, Game) - nichts ist mehr eingefroren.
        other_by_id = {other["id"]: other for other in others}
        stage_ids = sorted({match.get("stage_id") for match in other_matches if match.get("stage_id")})
        other_stages = {stage["id"]: stage for stage in await db.tournament_stages.find(
            {"id": {"$in": stage_ids}}, {"_id": 0, "id": 1, "settings": 1}).to_list(len(stage_ids) + 5)} if stage_ids else {}
        other_games = await load_duration_games(db, others) if other_matches else {}
        for match in other_matches:
            start = _parse(match.get("started_at")) or _parse(match.get("scheduled_at"))
            if not start:
                continue
            participants = {key for key in participants_of(match, other_keys) if key.startswith("user:")}
            busy_elsewhere.append({
                "match_id": match["id"], "participants": participants, "start": start,
                "end": start + timedelta(minutes=effective_match_duration(
                    match, stage=other_stages.get(match.get("stage_id") or ""), tournament=other_by_id.get(match.get("tournament_id")),
                    game=other_games.get((other_by_id.get(match.get("tournament_id")) or {}).get("game_id") or ""))),
                "label": f"{title_by_id.get(match.get('tournament_id'), 'Turnier')} {match.get('match_key') or ''}".strip(),
            })
    return {"matches": matches, "stages": stages, "stations": stations, "proposals": proposals, "busy_elsewhere": busy_elsewhere,
            "participant_keys": participant_keys, "game": await load_duration_game(db, tournament, extra=("station_devices",))}


async def plan_for_tournament(db, tournament: dict, now: datetime | None = None) -> dict:
    inputs = await load_plan_inputs(db, tournament)
    return plan_schedule(tournament, inputs["matches"], inputs["stations"], stages=inputs["stages"], proposals=inputs["proposals"],
                         now=now, busy_elsewhere=inputs["busy_elsewhere"], participant_keys=inputs["participant_keys"],
                         game=inputs["game"])


async def apply_plan(db, tournament: dict, plan: dict) -> dict:
    """Alles auf einmal schreiben: Zeit, Station, Dauer und Quelle je Spiel.

    Jedes Spiel nur, wenn es noch so dasteht wie in der Vorschau (Compare-and-Set auf Zeit, Station, Quelle und
    Stand, und nicht gestartet): was inzwischen von Hand gesetzt, vereinbart, gestartet oder anders geplant wurde,
    bleibt - der Aufrufer plant dann neu.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    written = 0
    on_station: list[tuple[dict, dict]] = []
    for item in plan.get("assignments") or []:
        if not item.get("changed"):
            continue
        update = {
            "scheduled_at": item["scheduled_at"],
            "schedule_source": item["schedule_source"],
            "schedule_written_at": now_iso,
            "updated_at": now_iso,
        }
        previous = item.get("previous") or {}
        if item["schedule_source"] == "planner":
            update["station_id"] = item["station_id"]
            update["schedule_forecast"] = bool(item.get("forecast"))
            # Der Stand aus der Vorschau, nicht neu gelesen: der Filter unten stellt sicher, dass er noch gilt.
            if not item.get("forecast") and previous.get("status") in {"pending", "ready", "scheduled"}:
                update["status"] = "scheduled"
        elif item.get("status"):
            update["status"] = item["status"]
        guard = {
            "id": item["match_id"],
            "scheduled_at": previous.get("scheduled_at"),
            "schedule_source": previous.get("schedule_source"),
            "status": previous.get("status"),
            "started_at": None,
        }
        if item["schedule_source"] == "planner":
            guard["station_id"] = previous.get("station_id")
            # Inzwischen aufgerufen (#1556): Station und Spieler sind unterwegs - der Plan schreibt nicht darüber.
            guard["called_at"] = None
        if previous.get("schedule_source") in KEPT_SOURCES or previous.get("status") in RUNNING_STATUSES | DONE_STATUSES:
            continue
        before = await db.matches_v2.find_one_and_update(guard, {"$set": update}, projection={"_id": 0},
                                                         return_document=ReturnDocument.BEFORE)
        if before is not None:
            written += 1
            if update.get("station_id"):
                on_station.append((before, update))
    for item in plan.get("releases") or []:
        # Termin des Planers lösen (#1608): Compare-and-Set wie oben - nur, wenn das Spiel noch so dasteht wie in der
        # Vorschau, nicht aufgerufen und nicht begonnen. Was inzwischen von Hand gesetzt wurde, bleibt.
        previous = item.get("previous") or {}
        if previous.get("schedule_source") != "planner":
            continue
        guard = {"id": item["match_id"], "scheduled_at": previous.get("scheduled_at"), "station_id": previous.get("station_id"),
                 "schedule_source": "planner", "status": previous.get("status"), "started_at": None, "called_at": None}
        result = await db.matches_v2.update_one(guard, {"$set": {
            "scheduled_at": None, "station_id": None, "schedule_source": None, "schedule_forecast": False,
            "schedule_written_at": now_iso, "updated_at": now_iso,
        }})
        written += result.modified_count
    warnings = list(plan.get("warnings") or [])
    # Nachprüfen (Codex zu #1611): eine Station, die zwischen Vorschau und Schreiben gelöscht wurde, bekommt nichts.
    for station_id in {update["station_id"] for _item, update in on_station}:
        if await station_open_for_matches(db, station_id):
            continue
        for before, update in [row for row in on_station if row[1]["station_id"] == station_id]:
            # Alles, was der Plan gesetzt hat, exakt wie vorher (auch Prognose und Schreib-Metadaten) - nur, wenn das
            # Spiel noch so dasteht wie geschrieben.
            back = await db.matches_v2.update_one(written_state(before["id"], {"$set": update}), restore_change(before, update))
            if back.matched_count:
                written -= 1
            else:
                # Inzwischen fremd geändert: nicht überschreiben - die Warnung unten sagt, dass neu geplant werden muss.
                logger.warning("[scheduler] %s an gelöschter Station %s, inzwischen fremd geändert - nicht zurückgesetzt",
                               before["id"], station_id)
        warnings.append({"type": "station_gone", "severity": "error", "station_id": station_id,
                         "message": "Eine Station wurde beim Übernehmen gelöscht - ihre Spiele sind nicht geplant. Bitte neu planen."})
    if plan.get("assignments") or plan.get("releases"):
        # Neu geplant: der Hinweis vom Check-in-Ende („Baum hat sich geändert - neu planen“) ist erledigt.
        await db.tournament_stages.update_many({"tournament_id": tournament["id"], "schedule_hint": {"$exists": True}},
                                               {"$unset": {"schedule_hint": ""}})
    return {"written": written, "mode": plan.get("mode"), "warnings": warnings}


async def replan_after_heat_rebuild(db, tournament: dict, stage: dict | None) -> dict:
    """Nach einem Umbau der Phase (Läufe zusammengelegt, #1575): die noch nicht gestarteten Spiele der Phase vor Ort
    neu planen - mit denselben Regeln und Guards wie „Übernehmen“ (Quelle ``planner``, von Hand gesetzte und
    vereinbarte Termine bleiben, Compare-and-Set je Spiel). Online und Liga: nichts; dort gibt es keine Stationen.

    Bewusst ohne eigenen Turnier-Lock: der Umbau läuft bereits unter ``_serialized_tournament_write``, und die Sperre
    ist nicht wiedereintrittsfähig. Der Compare-and-Set in ``apply_plan`` schützt die Schreibvorgänge.
    """
    if stage is None or match_policy({}, tournament, stage)["event_mode"] != "local" or plays_in_matchdays(tournament, stage):
        return {"applies": False, "written": 0, "warnings": []}
    plan = await plan_for_tournament(db, tournament)
    stage_plan = {**plan, "assignments": [item for item in plan["assignments"] if item.get("stage_id") == stage.get("id")],
                  "releases": [item for item in plan.get("releases") or [] if item.get("stage_id") == stage.get("id")]}
    result = await apply_plan(db, tournament, stage_plan)
    return {"applies": True, "written": result["written"], "warnings": plan.get("warnings") or []}
