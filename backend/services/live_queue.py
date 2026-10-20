"""Live vor Ort (#1556): die Warteschlange je Station - was läuft, was als Nächstes kommt, was danach.

Entscheidung E1 (Fabian, 14.10.2026): Vor Ort ist der Plan die Prognose, die Warteschlange entscheidet. Wird eine
Station frei, bekommt sie das nächste bereite Spiel; jede spätere Zeit rückt nach.

Gerechnet wird mit dem Spielplaner selbst (``match_scheduler.plan_schedule``) ab jetzt - es gibt keine zweite
Planlogik. Was läuft, hält seine Station bis zum Ende der Dauer (überzieht es, bis jetzt); was aufgerufen ist, bleibt
an seiner Station; ein von Hand gesetzter Termin, der vorbei ist, gilt ab jetzt. Alles andere verteilt der Planer neu,
abhängig nur von den eigenen Linien (``prerequisite_ids``/Platz-Herkunft), nicht von „allen Spielen der Runde“.

Geschrieben wird hier nichts: die geplante Zeit (``scheduled_at``) bleibt, wie „Übernehmen“ sie geschrieben hat - der
Verzug ist der Abstand der Prognose zu ihr. Online und ohne Stationen gibt es keine Warteschlange; dort gelten die
Fristen (``match_deadlines``).

``build_live_queue`` ist reine Rechnung auf Dicts; ``load_live_queue`` lädt dazu. Die Antwort trägt nur, was eine
öffentliche Seite zeigen darf: Namen der Anmeldungen, Station im Klartext, Zeiten - keine Konto-Kennungen, keine
Notizen der Stationen oder der Turnierleitung.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from services.match_calls import report_by, report_minutes
from services.match_deadlines import no_show_deadline
from services.match_duration import effective_match_duration
from services.match_scheduler import (
    KEPT_SOURCES,
    RUNNING_STATUSES,
    _usable_stations,
    load_plan_inputs,
    plan_schedule,
    playable,
)
from services.round_labels import attach_round_labels
from services.station_labels import station_text
from services.tournament_rules import match_policy

# Reihenfolge in der Warteschlange einer Station: was läuft, dann der Aufruf, dann nach Prognose.
_STATE_ORDER = {"running": 0, "called": 1, "queued": 2}
OFFLINE_REASON = "Online-Turnier: keine Stationen, keine Warteschlange - es gelten die Fristen."
NO_STATION_REASON = "Für dieses Turnier gibt es keine nutzbare Station."


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _parse(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return _aware(value)
    try:
        return _aware(datetime.fromisoformat(str(value).replace("Z", "+00:00")))
    except ValueError:
        return None


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _minutes_between(later: datetime | None, earlier: datetime | None) -> int | None:
    if later is None or earlier is None:
        return None
    return int(round((later - earlier).total_seconds() / 60))


def _natural(text: str) -> tuple:
    """„Station 2“ vor „Station 10“."""
    return tuple(int(part) if part.isdigit() else part for part in re.split(r"(\d+)", (text or "").lower()))


def _station_text(station: dict | None) -> str:
    station = station or {}
    return station_text(station.get("name") or station.get("label"), station.get("device_type")) or ""


def _filled(match: dict) -> list[str]:
    return [slot["registration_id"] for slot in match.get("slots") or [] if slot.get("registration_id")]


def _open_slots(match: dict) -> int:
    return sum(
        1
        for slot in match.get("slots") or []
        if not slot.get("registration_id")
        and (slot.get("source") or {}).get("type") != "bye"
        and slot.get("status") != "bye"
    )


def _is_heat(match: dict) -> bool:
    return str(match.get("match_type") or "duel") != "duel" or len(match.get("slots") or []) > 2


def _live_copy(match: dict, now: datetime) -> dict:
    """Ein von Hand gesetzter oder vereinbarter Termin, der vorbei ist, ohne dass das Spiel begann, gilt ab jetzt -
    sonst stünde die Prognose in der Vergangenheit."""
    if match.get("started_at") or str(match.get("status") or "") in RUNNING_STATUSES:
        return match
    scheduled = _parse(match.get("scheduled_at"))
    if match.get("schedule_source") in KEPT_SOURCES and scheduled and scheduled < now:
        return {**match, "scheduled_at": now.isoformat()}
    return match


def _empty(now: datetime, reason: str) -> dict:
    return {
        "applies": False,
        "reason": reason,
        "now": now.isoformat(),
        "stations": [],
        "matches": {},
        "unplaced": [],
        "summary": None,
    }


def _rows(plan: dict) -> list[dict]:
    """Was der Planer festhält (läuft, aufgerufen, fester Termin) und was er neu verteilt, in einer Form."""
    rows = []
    for item in plan.get("held") or []:
        rows.append(
            {
                "match_id": item["match_id"],
                "station_id": item.get("station_id"),
                "start": _parse(item["start"]),
                "minutes": int(item["minutes"]),
                "state": "queued" if item["kind"] == "kept" else item["kind"],
                "forecast": False,
                "waiting_for": item.get("waiting_for"),
            }
        )
    for item in plan.get("assignments") or []:
        rows.append(
            {
                "match_id": item["match_id"],
                "station_id": item.get("station_id"),
                "start": _parse(item["scheduled_at"]),
                "minutes": int(item.get("duration_minutes") or 0),
                "state": "queued",
                "forecast": bool(item.get("forecast")),
                "waiting_for": item.get("waiting_for"),
            }
        )
    return rows


def build_live_queue(
    tournament: dict,
    matches,
    stations,
    *,
    now: datetime,
    stages=(),
    busy_elsewhere=(),
    participant_keys: dict[str, set[str]] | None = None,
    game: dict | None = None,
    names: dict[str, str] | None = None,
    report_minutes: int = 2,
) -> dict:
    """Die Warteschlange eines Turniers vor Ort: je Station läuft/als Nächstes/danach, je Spiel Prognose und Verzug."""
    now = _aware(now)
    names = names or {}
    # Eine Station, die gerade gelöscht wird (Markierung ``deleting``), bekommt nichts mehr und steht nicht da.
    stations = [station for station in stations or [] if not station.get("deleting")]
    stage_by_id = {(stage or {}).get("id"): stage for stage in stages or []}
    local = [
        match
        for match in matches or []
        if not match.get("is_preview")
        and match_policy(match, tournament, stage_by_id.get(match.get("stage_id")))["event_mode"] == "local"
    ]
    if not local:
        return _empty(now, OFFLINE_REASON)
    usable = _usable_stations(tournament, stations, game)
    if not usable:
        return _empty(now, NO_STATION_REASON)

    plan = plan_schedule(
        tournament,
        [_live_copy(match, now) for match in local],
        usable,
        stages=stages,
        now=now,
        busy_elsewhere=busy_elsewhere,
        participant_keys=participant_keys,
        game=game,
    )
    by_id = {match["id"]: match for match in local}
    station_by_id = {station["id"]: station for station in stations or [] if station.get("id")}

    entries: dict[str, dict] = {}
    for row in _rows(plan):
        match = by_id.get(row["match_id"])
        if not match or row["start"] is None:
            continue
        stage = stage_by_id.get(match.get("stage_id"))
        planned = _parse(match.get("scheduled_at"))
        minutes = row["minutes"] or effective_match_duration(match, stage=stage, tournament=tournament, game=game)
        called = row["state"] == "called"
        due = report_by(match, match.get("called_at"), report_minutes) if called else None
        no_show = no_show_deadline(match, tournament, stage) if called else None
        filled = _filled(match)
        ready = playable(match)
        entries[match["id"]] = {
            "match_id": match["id"],
            "match_key": match.get("match_key"),
            "label": match.get("round_label") or match.get("round_name") or match.get("match_key") or "Spiel",
            "stage_name": (stage or {}).get("name"),
            "status": match.get("status"),
            "state": row["state"],
            "position": None,
            "station_id": row["station_id"],
            "station_text": _station_text(station_by_id.get(row["station_id"])) if row["station_id"] else "",
            "names": [names.get(registration_id) or "Teilnehmer" for registration_id in filled],
            "open_slots": _open_slots(match),
            # Lauf (mehr als zwei Plätze): die Stationen nennen dann den Durchgang und die Namen (#1824).
            "heat": _is_heat(match),
            # Aufrufbar - dieselbe Regel wie im Planer und bei „Aufrufen“ (#1858). Sonst, worauf es wartet: ``draw`` (das
            # Los je Runde, etwa die Show-Auslosung) oder ``previous`` (ein Vorspiel ist offen).
            "ready": ready,
            "waiting_for": None if ready else row.get("waiting_for") or "previous",
            "forecast": row["forecast"],
            "planned_at": _iso(planned),
            "forecast_at": _iso(row["start"]),
            "delay_minutes": _minutes_between(row["start"], planned),
            "duration_minutes": minutes,
            "ends_at": _iso(row["start"] + timedelta(minutes=minutes)),
            "called_at": match.get("called_at") if called else None,
            "report_by": _iso(due),
            "no_show_due_at": _iso(no_show["due_at"]) if no_show else None,
            # Im Lauf als nicht erschienen markiert (#1823): wer fehlt - statt der Frist.
            "no_show_names": [names.get(registration_id) or "Teilnehmer"
                              for registration_id in match.get("no_show_registration_ids") or [] if registration_id in filled],
            "started_at": match.get("started_at") if row["state"] == "running" else None,
        }

    lanes: dict[str, list[dict]] = {}
    unplaced: list[str] = []
    for entry in entries.values():
        if entry["station_id"]:
            lanes.setdefault(entry["station_id"], []).append(entry)
        else:
            unplaced.append(entry["match_id"])
    for lane in lanes.values():
        # Bereite vor wartenden (#1858): „Als Nächstes“ ist ein aufrufbares Spiel, solange an der Station eines ansteht -
        # auch wenn ein fester Termin eines wartenden früher läge.
        lane.sort(key=lambda entry: (_STATE_ORDER[entry["state"]], not entry["ready"], entry["forecast_at"],
                                     str(entry["match_key"] or "")))
        position = 0
        for entry in lane:
            if entry["state"] == "running":
                entry["position"] = 0
                continue
            position += 1
            entry["position"] = position

    usable_ids = {station["id"] for station in usable}
    station_rows = []
    for station in sorted(stations or [], key=lambda row: _natural(row.get("name") or row.get("label") or "")):
        # Defekte Stationen bleiben sichtbar (ohne Warteschlange); Stationen eines anderen Spiels nicht.
        if station.get("id") not in usable_ids and station.get("status") != "broken":
            continue
        lane = lanes.get(station["id"], [])
        waiting = [entry for entry in lane if entry["state"] != "running"]
        station_rows.append(
            {
                "id": station["id"],
                "name": station.get("name") or station.get("label") or "Station",
                "station_text": _station_text(station),
                "status": station.get("status") or "free",
                "running": next((entry for entry in lane if entry["state"] == "running"), None),
                "next": waiting[0] if waiting else None,
                "after": waiting[1] if len(waiting) > 1 else None,
                "waiting": len(waiting),
            }
        )

    summary = None
    if entries:
        last = max(entries.values(), key=lambda entry: (entry["forecast_at"], entry["planned_at"] or ""))
        summary = {
            "delay_minutes": last["delay_minutes"],
            "last": {
                "match_id": last["match_id"],
                "label": last["label"],
                "planned_at": last["planned_at"],
                "forecast_at": last["forecast_at"],
            },
            "ends_at": max(entry["ends_at"] for entry in entries.values()),
        }
    return {
        "applies": True,
        "reason": None,
        "now": now.isoformat(),
        "stations": station_rows,
        "matches": entries,
        "unplaced": unplaced,
        "summary": summary,
    }


def my_entries(view: dict, participant_keys: dict[str, set[str]], user_id: str | None) -> list[dict]:
    """Die Spiele dieser Person in der Warteschlange - bei Teams mit Aufstellung nur, wenn sie aufgestellt ist."""
    if not user_id:
        return []
    key = f"user:{user_id}"
    mine = [
        entry
        for match_id, entry in (view.get("matches") or {}).items()
        if key in (participant_keys.get(match_id) or set())
    ]
    return sorted(mine, key=lambda entry: (_STATE_ORDER[entry["state"]], entry["forecast_at"]))


async def load_live_queue(db, tournament: dict, now: datetime | None = None) -> tuple[dict, dict[str, set[str]]]:
    """Die Warteschlange mit allem, was der Planer liest - dazu die Beteiligten je Spiel (nur für ``my_entries``)."""
    now = _aware(now or datetime.now(timezone.utc))
    inputs = await load_plan_inputs(db, tournament)
    attach_round_labels(inputs["matches"], inputs["stages"], tournament)
    registrations = await db.tournament_registrations.find(
        {"tournament_id": tournament["id"]},
        {"_id": 0, "id": 1, "display_name": 1, "ingame_name": 1, "team_name": 1},
    ).to_list(3000)
    names = {
        row["id"]: row.get("display_name") or row.get("ingame_name") or row.get("team_name") or "Teilnehmer"
        for row in registrations
        if row.get("id")
    }
    view = build_live_queue(
        tournament,
        inputs["matches"],
        inputs["stations"],
        now=now,
        stages=inputs["stages"],
        busy_elsewhere=inputs["busy_elsewhere"],
        participant_keys=inputs["participant_keys"],
        game=inputs["game"],
        names=names,
        report_minutes=await report_minutes(db),
    )
    return view, inputs["participant_keys"]
