"""„Mein Dienst“ (#1352): die eigene Arbeit in der Verwaltung - Helfer-Einsätze, Moderation, Turniere von heute.

Ein Server-Dienst für alle, die ihn brauchen: die Seite „Mein Dienst“ der Website, die Startseite der Verwaltung
(#1286) und später „Dein Dienst“ auf Home und in der App (#1175). Er zeigt nur, was die Person selbst betrifft:

- Helfer sehen genau ihre Turniere und Fast Laps mit ihrer Rolle, heute zuerst. Einsätze, die abgeschaltet sind, und
  Turniere, die vorbei sind (abgeschlossen, Ergebnisse veröffentlicht, archiviert, abgesagt), fehlen.
- Moderation bekommt nur den Zähler der offenen Meldungen - keine Turniere.
- Die Turnierleitung über alle Turniere (mit bestätigter Zwei-Faktor-Anmeldung) sieht zusätzlich alle Turniere von heute.
- Captains externer Serien (#1749) sehen ihre Serien („Meine Serien“), solange ihr Recht gilt.
- Spieler ohne Dienst bekommen eine leere Antwort.
"""
from __future__ import annotations

from datetime import datetime, timezone

from services.daily_center import club_day_window
from services.league_scope import NOT_LEAGUE
from services.permissions import can_use_area, is_confirmed_tournament_lead, needs_mfa

# Vorbei: dort gibt es für Helfer nichts mehr zu tun.
FINISHED_STATUSES = ("completed", "results_published", "archived", "cancelled")
# Läuft gerade - zählt als „heute“, auch wenn der Start gestern war.
RUNNING_STATUSES = ("check_in", "checkin_open", "live", "paused")
# Reihenfolge der Rollen in einer Zeile: die mit den meisten Rechten zuerst.
ROLE_ORDER = ("organizer", "referee", "scorekeeper", "station_manager", "stream_operator")
TOURNAMENT_FIELDS = {"_id": 0, "id": 1, "slug": 1, "title": 1, "status": 1, "start_date": 1}


def _iso(value) -> str | None:
    if isinstance(value, datetime):
        return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()
    return str(value) if value else None


def _parse(value) -> datetime | None:
    text = _iso(value)
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _is_today(item: dict, window: tuple[datetime, datetime]) -> bool:
    if item.get("status") in RUNNING_STATUSES:
        return True
    start = _parse(item.get("start_date"))
    return bool(start and window[0] <= start < window[1])


def _sort_key(row: dict):
    """Heute zuerst, dann nach Beginn; ohne Datum ganz hinten."""
    start = row.get("starts_at") or "9999"
    return (not row["today"], start, row.get("title") or "")


def _roles(values) -> list[str]:
    wanted = {value for value in values if value}
    return [role for role in ROLE_ORDER if role in wanted] + sorted(wanted - set(ROLE_ORDER))


def _tournament_row(tournament: dict, roles: list[str], window) -> dict:
    ref = tournament.get("slug") or tournament["id"]
    return {
        "kind": "tournament",
        "id": tournament["id"],
        "slug": tournament.get("slug"),
        "title": tournament.get("title") or "Turnier",
        "status": tournament.get("status"),
        "starts_at": _iso(tournament.get("start_date")),
        "today": _is_today(tournament, window),
        "roles": roles,
        # Live-Werkzeuge am Handy (#1156) - dort tragen Helfer ein; die Verwaltung bleibt zum Vorbereiten.
        "url": f"/tournaments/{ref}/leitung",
        "admin_url": f"/admin/tournaments/{tournament['id']}",
    }


def _challenge_row(challenge: dict, roles: list[str], window) -> dict:
    return {
        "kind": "fastlap",
        "id": challenge["id"],
        "slug": challenge.get("slug"),
        "title": challenge.get("title") or "Fast Lap",
        "status": challenge.get("status"),
        "starts_at": _iso(challenge.get("start_date")),
        "today": _is_today(challenge, window),
        "roles": roles,
        "url": f"/admin/f1/{challenge['id']}",
        "admin_url": f"/admin/f1/{challenge['id']}",
    }


async def helper_rows(db, user: dict, now: datetime | None = None) -> list[dict]:
    """Die eigenen Einsätze - ein Eintrag je Turnier oder Fast Lap, mit allen Rollen der Person darin."""
    window = club_day_window(now)
    active = {"user_id": user["id"], "is_active": {"$ne": False}}
    by_tournament: dict[str, set[str]] = {}
    async for row in db.tournament_staff_assignments.find(active, {"_id": 0, "tournament_id": 1, "role": 1}):
        if row.get("tournament_id"):
            by_tournament.setdefault(row["tournament_id"], set()).add(row.get("role"))
    by_challenge: dict[str, set[str]] = {}
    async for row in db.f1_staff_assignments.find(active, {"_id": 0, "challenge_id": 1, "role": 1}):
        if row.get("challenge_id"):
            by_challenge.setdefault(row["challenge_id"], set()).add(row.get("role"))

    rows: list[dict] = []
    if by_tournament:
        query = {"id": {"$in": sorted(by_tournament)}, "status": {"$nin": list(FINISHED_STATUSES)}}
        async for tournament in db.tournaments.find(query, TOURNAMENT_FIELDS):
            rows.append(_tournament_row(tournament, _roles(by_tournament[tournament["id"]]), window))
    if by_challenge:
        query = {"id": {"$in": sorted(by_challenge)}, "status": {"$nin": list(FINISHED_STATUSES)}}
        async for challenge in db.f1_challenges.find(query, TOURNAMENT_FIELDS):
            rows.append(_challenge_row(challenge, _roles(by_challenge[challenge["id"]]), window))
    return sorted(rows, key=_sort_key)


async def lead_today_rows(db, now: datetime | None = None, limit: int = 50) -> list[dict]:
    """Für die Turnierleitung über alle Turniere: was heute läuft oder heute beginnt."""
    window = club_day_window(now)
    query = {
        **NOT_LEAGUE,  # Die Turnierleitung leitet keine Staffeln (#2203).
        "status": {"$nin": ["draft", *FINISHED_STATUSES]},
        "$or": [
            {"status": {"$in": list(RUNNING_STATUSES)}},
            {"start_date": {"$gte": window[0].isoformat(), "$lt": window[1].isoformat()}},
        ],
    }
    rows = [
        _tournament_row(tournament, [], window)
        async for tournament in db.tournaments.find(query, TOURNAMENT_FIELDS).limit(limit)
    ]
    return sorted(rows, key=_sort_key)


async def duty_overview(db, user: dict, now: datetime | None = None, *, desks: bool = False) -> dict:
    """Alles für „Mein Dienst“ in einer Antwort; leer für Spieler ohne Dienst. ``desks``: dazu die Zähler der Leitstände (E.4) - nur die
    Seite „Mein Dienst“ fragt danach; die Startseite der Verwaltung lädt ohne, weil das je Season alle Quellen liest."""
    moderation = None
    if await can_use_area(user, "moderation", db=db):
        moderation = {"open_reports": await db.user_reports.count_documents({"status": "open"})}
    from services.reference_series_access import captain_series

    from services.league_permissions import capabilities_of, has_leagues_area, staffed_league_ids

    league_rows = []
    # Ligen (#2203): Wer zuständig ist, findet hier seine Ligen. Mit dem Bereich stehen sie im Menü.
    if not has_leagues_area(user) and not needs_mfa(user):
        wanted = sorted(await staffed_league_ids(db, user))
        async for row in db.leagues.find({"id": {"$in": wanted}}, {"_id": 0, "id": 1, "name": 1, "slug": 1}):
            league_rows.append({**row, "capabilities": sorted(await capabilities_of(db, user, row["id"]))})
    return {
        "assignments": await helper_rows(db, user, now),
        "leagues": sorted(league_rows, key=lambda row: str(row.get("name") or "").casefold()),
        # Externe Serien (#1749): wo die Person heute Captain ist - „Meine Serien“.
        "series": await captain_series(db, user),
        "moderation": moderation,
        "lead_today": await lead_today_rows(db, now) if is_confirmed_tournament_lead(user) else [],
        # Nach dem Ende noch „Live“ (#2194) und überfällige Liga-Spiele (Nr. 28): Hinweise für die Leitung.
        "ended_live": await ended_live_rows(db, user, now=now),
        "overdue_matches": await overdue_match_rows(db, user),
        # Regelwerk muss freigegeben werden (#2269): für wer in der Liga „Regeln veröffentlichen“ darf.
        "rules_pending": await rules_pending_rows(db, user),
        # Check-in abgelaufen (#1652, § 8.4): der Vorschlag „nicht erschienen“ - entschieden wird nur von Hand.
        "checkin_proposals": await checkin_proposal_rows(db, user),
        # Vorfälle (#1619, D.5): Map in Klärung oder Serie noch festzustellen - für wer in der Liga entscheiden darf.
        "incident_reviews": await incident_review_rows(db, user),
        # Leitstand je Season (E.4, Nr. 152): „Mein Dienst“ bleibt die eigene Liste und führt mit der Zahl der offenen Aufgaben hinein.
        "league_desks": await league_desk_rows(db, user) if desks else [],
    }


async def league_desk_rows(db, user: dict, limit: int = 10) -> list[dict]:
    """Die Seasons (Entwurf oder laufend) der Ligen, in denen die Person zuständig ist, mit den Aufgaben, die im Leitstand auf sie
    warten (``mine``) und allen offenen (``total``)."""
    from services import league_desk
    from services.league_permissions import has_leagues_area, staffed_league_ids

    if not user or needs_mfa(user):
        return []
    query = {"status": "active"} if has_leagues_area(user) else {"status": "active", "id": {"$in": sorted(await staffed_league_ids(db, user))}}
    rows: list[dict] = []
    for league in await db.leagues.find(query, {"_id": 0, "id": 1, "name": 1}).sort("name", 1).to_list(200):
        seasons = await db.league_seasons.find({"league_id": league["id"], "status": {"$in": ["draft", "active"]}},
                                               {"_id": 0}).sort("number", -1).to_list(20)
        for season in seasons:
            desk = await league_desk.season_desk(db, season, user)
            rows.append({"season_id": season["id"], "league_name": league.get("name"), "season_name": season.get("name"),
                         "mine": desk["mine"], "total": desk["total"], "url": f"/admin/leagues/seasons/{season['id']}#leitstand"})
            if len(rows) >= limit:
                return rows
    return rows


async def rules_pending_rows(db, user: dict, limit: int = 50) -> list[dict]:
    """Seasons, deren Regelwerk freigegeben werden muss (#2269): Einstellungen geändert oder ein Entwurf wartet - je Liga, in der die
    Person „Regeln veröffentlichen“ darf. Beendete und archivierte Seasons zählen nicht."""
    from services import league_rules
    from services.league_permissions import can, has_leagues_area, staffed_league_ids

    if not user or needs_mfa(user):
        return []
    query = {"status": "active"} if has_leagues_area(user) else {"status": "active", "id": {"$in": sorted(await staffed_league_ids(db, user))}}
    rows: list[dict] = []
    for league in await db.leagues.find(query, {"_id": 0, "id": 1, "name": 1, "slug": 1, "game_id": 1}).sort("name", 1).to_list(200):
        if not await can(user, "rules", league["id"], db=db):
            continue
        seasons = await db.league_seasons.find({"league_id": league["id"], "status": {"$nin": ["completed", "archived"]}},
                                               {"_id": 0}).sort("number", -1).to_list(20)
        for season in seasons:
            pending = await league_rules.pending_release(db, league, season)
            if pending:
                rows.append({"league_id": league["id"], "league_name": league.get("name"), "season_id": season["id"],
                             "season_name": season.get("name"), **pending})
            if len(rows) >= limit:
                return rows
    return rows


async def checkin_proposal_rows(db, user: dict, limit: int = 50) -> list[dict]:
    from services.match_flow import proposal_rows

    return await proposal_rows(db, user, limit)


async def incident_review_rows(db, user: dict, limit: int = 50) -> list[dict]:
    from services.league_incidents import review_rows

    if not user or needs_mfa(user):
        return []
    return await review_rows(db, user, limit)


async def ended_live_rows(db, user: dict, now: datetime | None = None) -> list[dict]:
    from services.tournament_overrun import ended_live_rows as rows

    return await rows(db, user, now=now)


async def overdue_match_rows(db, user: dict, limit: int = 50, *, season_id: str | None = None) -> list[dict]:
    """Überfällige Liga-Spiele (#2194, Nr. 28) - die Regel steht in ``league_schedule.overdue_rows`` (dort liest auch der Leitstand)."""
    from services.league_schedule import overdue_rows

    return await overdue_rows(db, user, limit, season_id=season_id)
