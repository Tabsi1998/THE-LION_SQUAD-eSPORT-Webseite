"""Fast Lap: die eine Rangfunktion (#1584) - Bestzeiten je Strecke und die Championship-Wertung einer Challenge.

Tabelle, TV, Gewinne, Gewinn-Erinnerung, Saisonpunkte, Event-Rückblick, Widget, Profil und Erfolge rechnen alle mit
``rank_laps``:

- Gewertet wird die wirksame Zeit: Rundenzeit plus Strafsekunden, auf Millisekunden gerundet (2,01 s sind 2010 ms).
  Fehlende Strafsekunden (``None``) sind keine Strafe.
- Ungültige Runden und Vereins-Referenzzeiten kommen nicht in die offizielle Wertung (Referenzzeiten haben ihre eigene).
- Bei gleicher wirksamer Zeit liegt die früher gefahrene vorn (Entscheidung 14.10.2026). Gefahren heißt eingetragen
  (``created_at``); eine Zeit ohne Zeitpunkt steht hinter einer mit.
- Versuche zählen alle Zeiten der Wertung, auch ungültige - wie die Versuchsgrenze beim Eintragen.
- Gäste ohne Konto (#1585) tragen ``guest_id`` statt ``user_id``. Sie kommen nur mit ``include_guests`` in die
  Rangfolge (Tabelle, TV, Urkunde) - Gewinne, Saisonpunkte, Erfolge, Profil und Rückblick rufen ohne und sehen nur
  Konten. Jeder Gast zählt für sich (``participant_id`` = ``guest-<Kennung>``).
"""
from __future__ import annotations

import math
from collections import Counter
from datetime import datetime, timezone

DEFAULT_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
REFERENCE_SCOPE = "club_reference"


def official_query(extra: dict | None = None) -> dict:
    return {
        **(extra or {}),
        "is_invalid": {"$ne": True},
        "$or": [{"score_scope": {"$exists": False}}, {"score_scope": {"$ne": REFERENCE_SCOPE}}],
    }


def penalty_ms(value) -> int:
    """Strafsekunden in Millisekunden, gerundet; ``None``, Unsinn und Gutschriften sind 0."""
    try:
        seconds = float(value or 0)
    except (TypeError, ValueError):
        return 0
    if not math.isfinite(seconds) or seconds <= 0:
        return 0
    return int(round(seconds * 1000))


def effective_ms(row: dict) -> int:
    return int(row.get("time_ms") or 0) + penalty_ms(row.get("penalty_seconds"))


def _driven_at(row: dict) -> float:
    value = row.get("created_at")
    if isinstance(value, datetime):
        stamp = value
    else:
        try:
            stamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return math.inf
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp.timestamp()


def _in_scope(row: dict, scope: str) -> bool:
    row_scope = row.get("score_scope") or "official"
    return row_scope == REFERENCE_SCOPE if scope == REFERENCE_SCOPE else row_scope != REFERENCE_SCOPE


GUEST_PREFIX = "guest-"


def participant_id(row: dict, include_guests: bool = True) -> str | None:
    """Wer eine Zeit gefahren ist: die Kennung des Kontos, bei einem Gast ``guest-<Kennung>``, sonst ``None``."""
    if row.get("user_id"):
        return row["user_id"]
    if include_guests and row.get("guest_id"):
        return f"{GUEST_PREFIX}{row['guest_id']}"
    return None


def _rankable(row: dict) -> bool:
    time_ms = row.get("time_ms")
    return not row.get("is_invalid") and isinstance(time_ms, (int, float)) and not isinstance(time_ms, bool)


def rank_laps(times: list[dict], scope: str = "official", *, include_guests: bool = False) -> list[dict]:
    """Die Rangfolge einer Strecke: je Person die beste wirksame Zeit, schnellste zuerst, Gleichstand früher vorn.

    Jede Zeile ist die beste Zeit der Person mit ``effective_ms``, ``rank`` (1, 2, 3 … ohne geteilte Plätze),
    ``attempts`` (alle Zeiten der Wertung, auch ungültige), ``participant_id`` und ``is_guest``. Gäste nur mit
    ``include_guests`` - und nie als Vereins-Referenz."""
    attempts: Counter = Counter()
    best: dict[str, tuple[tuple, dict]] = {}
    for row in times:
        uid = participant_id(row, include_guests)
        if not uid or not _in_scope(row, scope) or (scope == REFERENCE_SCOPE and not row.get("user_id")):
            continue
        attempts[uid] += 1
        if not _rankable(row):
            continue
        key = (effective_ms(row), _driven_at(row), str(row.get("id") or ""))
        if uid not in best or key < best[uid][0]:
            best[uid] = (key, row)
    ordered = sorted(best.items(), key=lambda item: (item[1][0], item[0]))
    return [
        {**row, "user_id": row.get("user_id") or None, "participant_id": uid, "is_guest": not row.get("user_id"),
         "effective_ms": key[0], "rank": index, "attempts": attempts[uid]}
        for index, (uid, (key, row)) in enumerate(ordered, start=1)
    ]


def best_per_user(times: list[dict]) -> dict[str, int]:
    """Die beste wirksame Zeit je Person."""
    return {row["user_id"]: row["effective_ms"] for row in rank_laps(times)}


def track_ranking(times: list[dict]) -> list[tuple[str, int]]:
    """Rangfolge einer Strecke: (Person, Zeit), schnellste zuerst, Gleichstand früher vorn."""
    return [(row["user_id"], row["effective_ms"]) for row in rank_laps(times)]


def championship_totals(tracks: list[dict], times_by_track: dict[str, list[dict]], points_system: list[int] | None = None) -> tuple[list[dict], dict]:
    """Punkte je Strecke nach Platz, aufsummiert; Reihenfolge nach Punkten, dann Siegen. Liefert (Wertung, je Strecke)."""
    points = list(points_system or DEFAULT_POINTS)
    totals: dict[str, dict] = {}
    per_track: dict[str, dict] = {}
    for track in tracks:
        results = []
        for pos, (uid, ms) in enumerate(track_ranking(times_by_track.get(track["id"]) or [])):
            pts = points[pos] if pos < len(points) else 0
            entry = totals.setdefault(uid, {"user_id": uid, "points": 0, "wins": 0, "races": 0})
            entry["points"] += pts
            entry["races"] += 1
            if pos == 0:
                entry["wins"] += 1
            results.append({"user_id": uid, "rank": pos + 1, "time_ms": ms, "points": pts})
        per_track[track["id"]] = {"track": track, "results": results}
    standings = sorted(totals.values(), key=lambda entry: (entry["points"], entry["wins"]), reverse=True)
    for index, entry in enumerate(standings):
        entry["rank"] = index + 1
    return standings, per_track


# Zeiten werden seitenweise geladen (#1584): keine stille Obergrenze - eine abgeschnittene Liste wäre eine falsche
# Rangfolge. Geblättert wird über ``_id``, damit neue Einträge während des Lesens nichts verschieben.
LAP_PAGE_SIZE = 2000


async def load_laps(db, query: dict) -> list[dict]:
    """Alle Zeiten zu ``query``, vollständig."""
    rows: list[dict] = []
    last_id = None
    while True:
        page_query = query if last_id is None else {**query, "_id": {"$gt": last_id}}
        page = await db.f1_lap_times.find(page_query).sort("_id", 1).limit(LAP_PAGE_SIZE).to_list(LAP_PAGE_SIZE)
        for row in page:
            last_id = row.pop("_id", None)
            rows.append(row)
        if len(page) < LAP_PAGE_SIZE or last_id is None:
            return rows


async def official_times(db, challenge_id: str, track_id: str) -> list[dict]:
    return await load_laps(db, official_query({"challenge_id": challenge_id, "track_id": track_id}))


async def challenge_standings(db, challenge: dict, tracks: list[dict] | None = None) -> tuple[list[dict], dict, list[dict]]:
    """Die Championship einer Challenge aus der Datenbank: (Wertung, je Strecke, Strecken) - alle Zeiten mit einer
    Abfrage, nach Strecke gruppiert."""
    cid = challenge["id"]
    if tracks is None:
        tracks = await db.f1_tracks.find({"challenge_id": cid}, {"_id": 0}).sort("order_index", 1).to_list(100)
    times_by_track: dict[str, list[dict]] = {track["id"]: [] for track in tracks}
    for row in await load_laps(db, official_query({"challenge_id": cid})):
        if row.get("track_id") in times_by_track:
            times_by_track[row["track_id"]].append(row)
    standings, per_track = championship_totals(tracks, times_by_track, challenge.get("points_per_position"))
    return standings, per_track, tracks
