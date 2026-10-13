"""Rückblick nach dem Event (#1187): Sieger je Turnier und Fast Lap, ein paar Zahlen, der Bericht und „Du warst dabei“.

- Erst nach dem Event: ab dem Tag nach dem letzten Event-Tag (Wiener Tage) oder wenn das Event beendet bzw. archiviert
  ist - dieselbe Regel wie ``eventIsOver`` in Web und App (``lib/afterEnd``). Vorher liefert der Server nichts außer
  ``available: false``; ein abgesagtes Event bekommt keinen Rückblick.
- Nur veröffentlichte Ergebnisse: ein Turnier zählt erst, wenn es beendet ist oder seine Ergebnisse veröffentlicht sind
  (auch archiviert). Laufende, pausierte, abgesagte und Entwurfs-Turniere fehlen in Siegern und Zahlen. Bei Fast Laps
  zählen nur gültige Zeiten (keine ungültigen, keine Vereins-Referenzzeiten) einer Challenge, die vorbei ist.
- Sichtbarkeit wie auf der Event-Seite: was die Person dort nicht sieht (nicht öffentliche Turniere, „Nur Mitglieder“),
  steht auch hier nicht.
- Zahlen ohne Personen: Teilnehmer, Spiele, Turniere, Fast Laps, Fotos - nur Summen.
- „Du warst dabei“ nur für die Person selbst und nur mit echter Teilnahme: Event-Anmeldung (angemeldet oder
  eingecheckt, nicht Warteliste, nicht „nicht erschienen“), Turnier-Anmeldung (selbst oder mit dem eigenen Team) oder
  eine gefahrene Zeit. Dazu der eigene Platz je Turnier und die beste Runde je Fast Lap.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from services import event_days
from services.competition_read import load_competition_read_model, observe_structure_read
from services.competition_standings import standings_for_structure
from services.event_facts import team_ids
from services.fastlap_standings import challenge_standings, effective_ms, official_query
from services.visibility import lead_can_see, user_can_see

VIENNA = ZoneInfo("Europe/Vienna")

ENDED_EVENT_STATUSES = {"completed", "results_published", "archived"}
# Ergebnisse, die öffentlich gelten: beendet, veröffentlicht oder archiviert.
RESULT_STATUSES = {"completed", "results_published", "archived"}
HIDDEN_STATUSES = {"draft", "cancelled"}
PARTICIPANT_STATUSES = ("approved", "checked_in")
EVENT_PRESENT_STATUSES = ("registered", "checked_in")
PLAYED_MATCH_STATUSES = {"completed", "forfeit"}
PODIUM_SIZE = 3


# ---------------------------------------------------------------- Wann es einen Rückblick gibt

def _instant(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def vienna_day(value) -> date | None:
    instant = _instant(value)
    return instant.astimezone(VIENNA).date() if instant else None


def last_day(event: dict) -> date | None:
    """Der letzte Tag des Events in Wien: das Ende, sonst der letzte Programmtag, sonst der Beginn."""
    days = event_days.stored_days(event)
    return vienna_day(event.get("end_date") or (days[-1]["end_at"] if days else None) or event.get("start_date"))


def is_over(event: dict, now: datetime | None = None) -> bool:
    """Vorbei: beendet oder archiviert - oder der letzte Tag (Wiener Zeit) ist vorüber. Abgesagt zählt nicht."""
    if event.get("status") == "cancelled":
        return False
    if event.get("status") in ENDED_EVENT_STATUSES:
        return True
    end = last_day(event)
    today = (now or datetime.now(timezone.utc)).astimezone(VIENNA).date()
    return bool(end) and today > end


# ---------------------------------------------------------------- Was die Person sieht

async def visible_items(items: list[dict], user: dict | None, *, tournament: bool) -> list[dict]:
    """Turniere bzw. Fast Laps des Events, die die Person auf der Event-Seite sähe (ohne Zugangslink)."""
    out = []
    for item in items:
        if item.get("status") in HIDDEN_STATUSES:
            continue
        if tournament and item.get("is_public") is False:
            continue
        if await lead_can_see(user, item.get("visibility") or "public"):
            out.append(item)
    return out


def challenge_over(challenge: dict, now: datetime) -> bool:
    if challenge.get("status") in RESULT_STATUSES:
        return True
    if challenge.get("status") in {"paused", *HIDDEN_STATUSES}:
        return False
    end = _instant(challenge.get("end_date"))
    return not end or end <= now


# ---------------------------------------------------------------- Turniere

def _name(registration: dict | None) -> str:
    registration = registration or {}
    return registration.get("display_name") or registration.get("ingame_name") or "Teilnehmer"


def _counts(row: dict) -> bool:
    return bool(row.get("played") or row.get("furthest_round") or row.get("wins") or row.get("won") or row.get("losses"))


async def tournament_table(db, tournament: dict) -> dict:
    """Tabelle, Anmeldungen und gespielte Spiele eines Turniers - aus demselben Lesemodell wie die Turnierseite."""
    regs = await db.tournament_registrations.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(2000)
    read_model = await load_competition_read_model(db, tournament["id"])
    structure = read_model.structure_snapshot()
    observe_structure_read(structure, surface="event_recap_page")
    groups = []
    if tournament.get("format") == "groups":
        groups = await db.tournament_groups.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(100)
    rows = standings_for_structure(tournament, structure, regs, groups=groups)
    if tournament.get("format") == "groups":
        rows = [row for group in rows for row in group.get("standings") or []]
    rows = [row for row in rows if _counts(row)]
    played = sum(
        1 for match in structure.get("matches") or []
        if match.get("status") in PLAYED_MATCH_STATUSES
        and len([slot for slot in match.get("slots") or [] if slot.get("registration_id")]) >= 2
    )
    return {"rows": rows, "registrations": {reg["id"]: reg for reg in regs}, "played": played}


def _row_rank(row: dict, index: int) -> int:
    try:
        return int(row.get("rank") or index)
    except (TypeError, ValueError):
        return index


def podium_from(table: dict) -> list[dict]:
    podium = []
    for index, row in enumerate(table["rows"][:PODIUM_SIZE], start=1):
        reg = table["registrations"].get(row.get("registration_id"))
        if not reg:
            continue
        wins = row.get("wins") if row.get("wins") is not None else row.get("won")
        points = row.get("points")
        detail = []
        if wins:
            detail.append(f"{wins} {'Sieg' if wins == 1 else 'Siege'}")
        if points:
            detail.append(f"{points} {'Punkt' if points == 1 else 'Punkte'}")
        podium.append({"rank": _row_rank(row, index), "name": _name(reg), "team": bool(reg.get("team_id")), "detail": ", ".join(detail) or None})
    return podium


def own_place(table: dict, user_id: str, teams: list[str]) -> dict | None:
    """Der eigene Platz - die eigene Anmeldung oder die des eigenen Teams; nur mit gültigem Status."""
    mine = {
        reg_id for reg_id, reg in table["registrations"].items()
        if reg.get("status") in PARTICIPANT_STATUSES
        and (reg.get("team_id") in teams if reg.get("team_id") else reg.get("user_id") == user_id)
    }
    if not mine:
        return None
    for index, row in enumerate(table["rows"], start=1):
        if row.get("registration_id") in mine:
            reg = table["registrations"][row["registration_id"]]
            return {"rank": _row_rank(row, index), "of": len(table["rows"]), "team_name": _name(reg) if reg.get("team_id") else None}
    reg = table["registrations"][next(iter(mine))]
    return {"rank": None, "of": len(table["rows"]), "team_name": _name(reg) if reg.get("team_id") else None}


# ---------------------------------------------------------------- Fast Laps

def lap_label(ms: int | None) -> str:
    if ms is None or ms < 0:
        return ""
    minutes, rest = divmod(int(round(ms)), 60000)
    seconds, millis = divmod(rest, 1000)
    return f"{minutes}:{seconds:02d}.{millis:03d}"


async def _names(db, user_ids: list[str]) -> dict[str, str]:
    users = await db.users.find({"id": {"$in": list(user_ids)}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1}).to_list(len(user_ids) + 1)
    return {user["id"]: user.get("display_name") or user.get("username") or "Teilnehmer" for user in users}


async def fastlap_summary(db, challenge: dict) -> dict:
    """Podest einer Fast Lap: mit einer Strecke die schnellsten Zeiten, mit mehreren die Wertung über alle Strecken."""
    standings, per_track, tracks = await challenge_standings(db, challenge)
    drivers = {entry["user_id"] for entry in standings}
    if len(tracks) == 1:
        results = per_track[tracks[0]["id"]]["results"][:PODIUM_SIZE]
        names = await _names(db, [row["user_id"] for row in results])
        podium = [{"rank": row["rank"], "name": names.get(row["user_id"], "Teilnehmer"), "time_ms": row["time_ms"],
                   "detail": lap_label(row["time_ms"])} for row in results]
        track_name = tracks[0].get("name")
    else:
        top = standings[:PODIUM_SIZE]
        names = await _names(db, [row["user_id"] for row in top])
        podium = [{"rank": row["rank"], "name": names.get(row["user_id"], "Teilnehmer"), "time_ms": None,
                   "detail": f"{row['points']} {'Punkt' if row['points'] == 1 else 'Punkte'}"} for row in top]
        track_name = None
    return {"podium": podium, "drivers": drivers, "track": track_name, "tracks": len(tracks), "per_track": per_track}


async def own_best_lap(db, challenge: dict, user_id: str, per_track: dict) -> dict | None:
    """Die eigene beste Runde (wirksame Zeit) über alle Strecken, mit dem Platz auf dieser Strecke."""
    rows = await db.f1_lap_times.find(official_query({"challenge_id": challenge["id"], "user_id": user_id}), {"_id": 0}).to_list(500)
    if not rows:
        return None
    best = min(rows, key=effective_ms)
    track = per_track.get(best.get("track_id")) or {}
    place = next((row for row in track.get("results") or [] if row["user_id"] == user_id), None)
    return {"best_lap_ms": effective_ms(best), "best_lap": lap_label(effective_ms(best)), "rank": place["rank"] if place else None,
            "of": len(track.get("results") or []) or None, "track": (track.get("track") or {}).get("name")}


# ---------------------------------------------------------------- Bericht und Fotos

async def report_for(db, event: dict, user: dict | None) -> dict | None:
    """Der Bericht: die neueste veröffentlichte News zum Event mit Kategorie „Rückblick“, die die Person sehen darf."""
    now = datetime.now(timezone.utc)
    posts = await db.news_posts.find(
        {"linked_event_ids": event["id"], "published": True, "category": "recap"},
        {"_id": 0, "id": 1, "title": 1, "slug": 1, "excerpt": 1, "banner_url": 1, "published_at": 1, "created_at": 1, "visibility": 1},
    ).sort([("published_at", -1), ("created_at", -1)]).to_list(10)
    for post in posts:
        published = _instant(post.get("published_at"))
        if published and published > now:
            continue
        if await user_can_see(user, post.get("visibility") or "public"):
            return {key: post.get(key) for key in ("id", "title", "slug", "excerpt", "banner_url", "published_at")}
    return None


async def photo_count(db, event: dict, user: dict | None) -> int:
    total = 0
    async for album in db.gallery_albums.find({"event_id": event["id"], "published": True}, {"_id": 0, "id": 1, "visibility": 1}):
        if await user_can_see(user, album.get("visibility") or "public"):
            total += await db.gallery_photos.count_documents({"album_id": album["id"]})
    return total


# ---------------------------------------------------------------- Der Rückblick

async def _event_people(db, event: dict) -> set[str]:
    rows = await db.event_registrations.find({"event_id": event["id"], "status": {"$in": list(EVENT_PRESENT_STATUSES)}},
                                             {"_id": 0, "id": 1, "user_id": 1}).to_list(5000)
    return {row.get("user_id") or f"anmeldung:{row.get('id')}" for row in rows}


async def _tournament_people(db, table: dict) -> set[str]:
    people: set[str] = set()
    teams: set[str] = set()
    for reg in table["registrations"].values():
        if reg.get("status") not in PARTICIPANT_STATUSES:
            continue
        if reg.get("team_id"):
            teams.add(reg["team_id"])
            if reg.get("user_id"):
                people.add(reg["user_id"])
        elif reg.get("user_id"):
            people.add(reg["user_id"])
    if teams:
        async for team in db.teams.find({"id": {"$in": list(teams)}}, {"_id": 0, "member_ids": 1}):
            people.update(member for member in team.get("member_ids") or [] if member)
    return people


async def build(db, event: dict, user: dict | None, now: datetime | None = None) -> dict:
    """Der Rückblick, wie die Person ihn sehen darf - vor dem Ende nur ``available: false``."""
    now = now or datetime.now(timezone.utc)
    if not is_over(event, now):
        return {"available": False, "reason": "cancelled" if event.get("status") == "cancelled" else "not_over"}

    tournaments = await visible_items(
        await db.tournaments.find({"event_id": event["id"]}, {"_id": 0}).sort("start_date", 1).to_list(200), user, tournament=True)
    challenges = await visible_items(
        await db.f1_challenges.find({"event_id": event["id"]}, {"_id": 0}).sort("start_date", 1).to_list(200), user, tournament=False)
    finished = [t for t in tournaments if t.get("status") in RESULT_STATUSES]
    over_challenges = [c for c in challenges if challenge_over(c, now)]

    people = await _event_people(db, event)
    matches = 0
    winners = []
    tables: dict[str, dict] = {}
    for tournament in finished:
        table = await tournament_table(db, tournament)
        tables[tournament["id"]] = table
        matches += table["played"]
        people |= await _tournament_people(db, table)
        winners.append({"kind": "tournament", "id": tournament["id"], "slug": tournament.get("slug"), "title": tournament.get("title") or "Turnier",
                        "team": tournament.get("team_mode") == "team", "podium": podium_from(table)})
    fastlaps = []
    summaries: dict[str, dict] = {}
    for challenge in over_challenges:
        summary = await fastlap_summary(db, challenge)
        summaries[challenge["id"]] = summary
        people |= summary["drivers"]
        fastlaps.append({"kind": "fastlap", "id": challenge["id"], "slug": challenge.get("slug"), "title": challenge.get("title") or "Fast Lap",
                         "track": summary["track"], "tracks": summary["tracks"], "podium": summary["podium"]})

    payload = {
        "available": True,
        "event_id": event["id"],
        "winners": winners,
        "fastlaps": fastlaps,
        "numbers": {
            "participants": len(people),
            "matches": matches,
            "tournaments": len(finished),
            "fastlaps": len(over_challenges),
            "photos": await photo_count(db, event, user),
        },
        "report": await report_for(db, event, user),
        "mine": None,
    }
    if user:
        payload["mine"] = await mine(db, event, user, finished, tables, over_challenges, summaries)
    return payload


async def mine(db, event: dict, user: dict, finished: list[dict], tables: dict, challenges: list[dict], summaries: dict) -> dict | None:
    """„Du warst dabei“: nur mit echter Teilnahme; dazu der eigene Platz je Turnier und die beste Runde je Fast Lap."""
    user_id = user["id"]
    teams = await team_ids(db, user_id)
    present = bool(await db.event_registrations.find_one(
        {"event_id": event["id"], "user_id": user_id, "status": {"$in": list(EVENT_PRESENT_STATUSES)}}, {"_id": 0, "id": 1}))
    results = []
    for tournament in finished:
        place = own_place(tables[tournament["id"]], user_id, teams)
        if place:
            results.append({"kind": "tournament", "id": tournament["id"], "slug": tournament.get("slug"), "title": tournament.get("title") or "Turnier", **place})
    for challenge in challenges:
        lap = await own_best_lap(db, challenge, user_id, summaries[challenge["id"]]["per_track"])
        if lap:
            results.append({"kind": "fastlap", "id": challenge["id"], "slug": challenge.get("slug"), "title": challenge.get("title") or "Fast Lap", **lap})
    if not present and not results:
        # Auch eine Anmeldung bei einem Turnier, das (noch) keine veröffentlichten Ergebnisse hat, zählt als „dabei“.
        tournament_ids = [t["id"] for t in await db.tournaments.find({"event_id": event["id"], "status": {"$nin": list(HIDDEN_STATUSES)}}, {"_id": 0, "id": 1}).to_list(200)]
        query = {"tournament_id": {"$in": tournament_ids}, "status": {"$in": list(PARTICIPANT_STATUSES)},
                 "$or": [{"user_id": user_id}] + ([{"team_id": {"$in": teams}}] if teams else [])}
        present = bool(tournament_ids) and bool(await db.tournament_registrations.find_one(query, {"_id": 0, "id": 1}))
    if not present and not results:
        return None
    return {"was_there": True, "results": results}
