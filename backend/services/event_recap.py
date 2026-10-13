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
  eingecheckt, nicht Warteliste, nicht „nicht erschienen“), Turnier-Anmeldung (selbst oder in dem Team, in dem sie
  damals stand - ``services/event_roster.py``, nie das heutige Team) oder eine gefahrene Zeit. Dazu der eigene Platz
  je Turnier und die beste Runde je Fast Lap.
- Namen gesperrter, deaktivierter oder gelöschter Konten stehen neutral als „Teilnehmer“ da; Ergebnis und Rang bleiben.
- Alle Turniere und Fast Laps eines Events werden mit je einer Abfrage geladen (``$in``), nicht einzeln.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from services import event_days
from services.competition_read import CompetitionReadModel, observe_structure_read
from services.competition_standings import standings_for_structure
from services.event_roster import registration_players
from services.fastlap_standings import championship_totals, effective_ms, official_query
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


# ---------------------------------------------------------------- Namen

NEUTRAL_NAME = "Teilnehmer"
USER_FIELDS = {"_id": 0, "id": 1, "username": 1, "display_name": 1, "is_active": 1, "is_banned": 1, "anonymized_at": 1}


def account_gone(user: dict | None) -> bool:
    """Gesperrt, deaktiviert oder gelöscht (anonymisiert): der Name steht nicht mehr im Rückblick."""
    return bool(user) and (user.get("is_active") is False or user.get("is_banned") is True or bool(user.get("anonymized_at")))


async def load_users(db, user_ids) -> dict[str, dict]:
    ids = sorted({user_id for user_id in user_ids if user_id})
    if not ids:
        return {}
    return {user["id"]: user for user in await db.users.find({"id": {"$in": ids}}, USER_FIELDS).to_list(len(ids) + 1)}


def person_name(user: dict | None) -> str:
    """Name einer Person - ohne Konto oder bei gesperrtem bzw. gelöschtem Konto neutral; Ergebnis und Rang bleiben."""
    if not user or account_gone(user):
        return NEUTRAL_NAME
    return user.get("display_name") or user.get("username") or NEUTRAL_NAME


def registration_name(registration: dict | None, users: dict[str, dict]) -> str:
    """Name einer Anmeldung: Teams mit ihrem Namen; Einzelne neutral, wenn ihr Konto gesperrt oder gelöscht ist."""
    registration = registration or {}
    if not registration.get("team_id") and account_gone(users.get(registration.get("user_id") or "")):
        return NEUTRAL_NAME
    return registration.get("display_name") or registration.get("ingame_name") or NEUTRAL_NAME


# ---------------------------------------------------------------- Turniere

def _counts(row: dict) -> bool:
    return bool(row.get("played") or row.get("furthest_round") or row.get("wins") or row.get("won") or row.get("losses"))


async def tournament_tables(db, tournaments: list[dict]) -> dict[str, dict]:
    """Tabelle, Anmeldungen, gespielte Spiele und wer zu welcher Anmeldung gehört - für alle Turniere mit je einer
    Abfrage (``$in``) statt mehreren je Turnier. Dasselbe Lesemodell wie die Turnierseite."""
    if not tournaments:
        return {}
    ids = [t["id"] for t in tournaments]
    regs = await db.tournament_registrations.find({"tournament_id": {"$in": ids}}, {"_id": 0}).to_list(50000)
    stage_matches = await db.matches_v2.find({"tournament_id": {"$in": ids}}, {"_id": 0}).sort([
        ("stage_number", 1), ("round", 1), ("order", 1)]).to_list(100000)
    stages = await db.tournament_stages.find({"tournament_id": {"$in": ids}}, {"_id": 0}).sort("number", 1).to_list(5000)
    group_ids = [t["id"] for t in tournaments if t.get("format") == "groups"]
    groups = await db.tournament_groups.find({"tournament_id": {"$in": group_ids}}, {"_id": 0}).to_list(5000) if group_ids else []
    players = await registration_players(db, regs, {t["id"]: t for t in tournaments})
    tables: dict[str, dict] = {}
    for tournament in tournaments:
        tid = tournament["id"]
        own_regs = [reg for reg in regs if reg.get("tournament_id") == tid]
        structure = CompetitionReadModel(
            tournament_id=tid,
            stage_matches=[match for match in stage_matches if match.get("tournament_id") == tid],
            stages=[stage for stage in stages if stage.get("tournament_id") == tid],
        ).structure_snapshot()
        observe_structure_read(structure, surface="event_recap_page")
        rows = standings_for_structure(tournament, structure, own_regs, groups=[g for g in groups if g.get("tournament_id") == tid])
        if tournament.get("format") == "groups":
            rows = [row for group in rows for row in group.get("standings") or []]
        rows = [row for row in rows if _counts(row)]
        played = sum(
            1 for match in structure.get("matches") or []
            if match.get("status") in PLAYED_MATCH_STATUSES
            and len([slot for slot in match.get("slots") or [] if slot.get("registration_id")]) >= 2
        )
        tables[tid] = {"rows": rows, "registrations": {reg["id"]: reg for reg in own_regs}, "played": played,
                       "players": {reg["id"]: players.get(reg["id"], set()) for reg in own_regs}}
    return tables


def _row_rank(row: dict, index: int) -> int:
    try:
        return int(row.get("rank") or index)
    except (TypeError, ValueError):
        return index


def podium_from(table: dict, users: dict[str, dict]) -> list[dict]:
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
        podium.append({"rank": _row_rank(row, index), "name": registration_name(reg, users), "team": bool(reg.get("team_id")),
                       "detail": ", ".join(detail) or None})
    return podium


def _podium_user_ids(table: dict) -> set[str]:
    ids = set()
    for row in table["rows"][:PODIUM_SIZE]:
        reg = table["registrations"].get(row.get("registration_id")) or {}
        if reg.get("user_id") and not reg.get("team_id"):
            ids.add(reg["user_id"])
    return ids


def participant_regs(table: dict, user_id: str) -> list[str]:
    """Die Anmeldungen, zu denen die Person gehört - mit gültigem Status, Teams nach gespeicherter Aufstellung."""
    return [reg_id for reg_id, reg in table["registrations"].items()
            if reg.get("status") in PARTICIPANT_STATUSES and user_id in table["players"].get(reg_id, set())]


def own_place(table: dict, user_id: str) -> dict | None:
    """Der eigene Platz - die eigene Anmeldung oder die des Teams, in dem die Person damals stand."""
    mine = set(participant_regs(table, user_id))
    if not mine:
        return None
    for index, row in enumerate(table["rows"], start=1):
        if row.get("registration_id") in mine:
            reg = table["registrations"][row["registration_id"]]
            return {"rank": _row_rank(row, index), "of": len(table["rows"]), "team_name": reg.get("display_name") if reg.get("team_id") else None}
    reg = table["registrations"][sorted(mine)[0]]
    return {"rank": None, "of": len(table["rows"]), "team_name": reg.get("display_name") if reg.get("team_id") else None}


# ---------------------------------------------------------------- Fast Laps

def lap_label(ms: int | None) -> str:
    if ms is None or ms < 0:
        return ""
    minutes, rest = divmod(int(round(ms)), 60000)
    seconds, millis = divmod(rest, 1000)
    return f"{minutes}:{seconds:02d}.{millis:03d}"


async def fastlap_summaries(db, challenges: list[dict]) -> dict[str, dict]:
    """Je Fast Lap Wertung, Strecken und gültige Zeiten - Strecken und Zeiten aller Challenges mit je einer Abfrage."""
    if not challenges:
        return {}
    ids = [c["id"] for c in challenges]
    tracks = await db.f1_tracks.find({"challenge_id": {"$in": ids}}, {"_id": 0}).sort("order_index", 1).to_list(5000)
    times = await db.f1_lap_times.find(official_query({"challenge_id": {"$in": ids}}), {"_id": 0}).to_list(200000)
    out: dict[str, dict] = {}
    for challenge in challenges:
        cid = challenge["id"]
        own_tracks = [track for track in tracks if track.get("challenge_id") == cid]
        own_times = [row for row in times if row.get("challenge_id") == cid]
        by_track = {track["id"]: [row for row in own_times if row.get("track_id") == track["id"]] for track in own_tracks}
        standings, per_track = championship_totals(own_tracks, by_track, challenge.get("points_per_position"))
        out[cid] = {"standings": standings, "per_track": per_track, "tracks": own_tracks, "times": own_times,
                    "drivers": {entry["user_id"] for entry in standings}}
    return out


def fastlap_podium(summary: dict, users: dict[str, dict]) -> dict:
    """Podest: mit einer Strecke die schnellsten Zeiten, mit mehreren die Wertung über alle Strecken."""
    tracks = summary["tracks"]
    if len(tracks) == 1:
        results = summary["per_track"][tracks[0]["id"]]["results"][:PODIUM_SIZE]
        podium = [{"rank": row["rank"], "name": person_name(users.get(row["user_id"])), "time_ms": row["time_ms"],
                   "detail": lap_label(row["time_ms"])} for row in results]
        return {"podium": podium, "track": tracks[0].get("name"), "tracks": 1}
    podium = [{"rank": row["rank"], "name": person_name(users.get(row["user_id"])), "time_ms": None,
               "detail": f"{row['points']} {'Punkt' if row['points'] == 1 else 'Punkte'}"} for row in summary["standings"][:PODIUM_SIZE]]
    return {"podium": podium, "track": None, "tracks": len(tracks)}


def _fastlap_podium_user_ids(summary: dict) -> set[str]:
    tracks = summary["tracks"]
    rows = summary["per_track"][tracks[0]["id"]]["results"] if len(tracks) == 1 else summary["standings"]
    return {row["user_id"] for row in rows[:PODIUM_SIZE]}


def own_best_lap(summary: dict, user_id: str) -> dict | None:
    """Die eigene beste Runde (wirksame Zeit) über alle Strecken, mit dem Platz auf dieser Strecke."""
    rows = [row for row in summary["times"] if row.get("user_id") == user_id]
    if not rows:
        return None
    best = min(rows, key=effective_ms)
    track = summary["per_track"].get(best.get("track_id")) or {}
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


def _tournament_people(table: dict) -> set[str]:
    """Wer gespielt hat: je gültiger Anmeldung die Personen nach gespeicherter Aufstellung - nie das heutige Team."""
    people: set[str] = set()
    for reg_id, reg in table["registrations"].items():
        if reg.get("status") in PARTICIPANT_STATUSES:
            people |= table["players"].get(reg_id, set())
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

    tables = await tournament_tables(db, finished)
    summaries = await fastlap_summaries(db, over_challenges)
    podium_ids: set[str] = set()
    for table in tables.values():
        podium_ids |= _podium_user_ids(table)
    for summary in summaries.values():
        podium_ids |= _fastlap_podium_user_ids(summary)
    users = await load_users(db, podium_ids)

    people = await _event_people(db, event)
    winners = []
    for tournament in finished:
        table = tables[tournament["id"]]
        people |= _tournament_people(table)
        winners.append({"kind": "tournament", "id": tournament["id"], "slug": tournament.get("slug"), "title": tournament.get("title") or "Turnier",
                        "team": tournament.get("team_mode") == "team", "podium": podium_from(table, users)})
    fastlaps = []
    for challenge in over_challenges:
        summary = summaries[challenge["id"]]
        people |= summary["drivers"]
        fastlaps.append({"kind": "fastlap", "id": challenge["id"], "slug": challenge.get("slug"), "title": challenge.get("title") or "Fast Lap",
                         **fastlap_podium(summary, users)})

    payload = {
        "available": True,
        "event_id": event["id"],
        "winners": winners,
        "fastlaps": fastlaps,
        "numbers": {
            "participants": len(people),
            "matches": sum(table["played"] for table in tables.values()),
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
    present = bool(await db.event_registrations.find_one(
        {"event_id": event["id"], "user_id": user_id, "status": {"$in": list(EVENT_PRESENT_STATUSES)}}, {"_id": 0, "id": 1}))
    results = []
    for tournament in finished:
        place = own_place(tables[tournament["id"]], user_id)
        if place:
            results.append({"kind": "tournament", "id": tournament["id"], "slug": tournament.get("slug"), "title": tournament.get("title") or "Turnier", **place})
    for challenge in challenges:
        lap = own_best_lap(summaries[challenge["id"]], user_id)
        if lap:
            results.append({"kind": "fastlap", "id": challenge["id"], "slug": challenge.get("slug"), "title": challenge.get("title") or "Fast Lap", **lap})
    if not present and not results:
        # Auch eine Anmeldung bei einem Turnier, das (noch) keine veröffentlichten Ergebnisse hat, zählt als „dabei“ -
        # Teams wieder nach gespeicherter Aufstellung bzw. Beitrittsdatum, nie nach dem heutigen Team.
        others = await db.tournaments.find({"event_id": event["id"], "status": {"$nin": list(HIDDEN_STATUSES)}},
                                           {"_id": 0, "id": 1, "start_date": 1, "end_date": 1}).to_list(200)
        if others:
            regs = await db.tournament_registrations.find(
                {"tournament_id": {"$in": [t["id"] for t in others]}, "status": {"$in": list(PARTICIPANT_STATUSES)}},
                {"_id": 0, "id": 1, "tournament_id": 1, "user_id": 1, "team_id": 1, "lineup": 1, "substitutes": 1},
            ).to_list(50000)
            players = await registration_players(db, regs, {t["id"]: t for t in others})
            present = any(user_id in people for people in players.values())
    if not present and not results:
        return None
    return {"was_there": True, "results": results}
