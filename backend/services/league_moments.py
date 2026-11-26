"""Saisonende-Moment für Aufstieg, Abstieg und Meister (#1639, docs/LIGA.md „F.8 Saisonende-Moment“).

Kein zweites System:

- **Quelle** ist allein der bestätigte Endstand der ganzen Season - ``league_successor.plan`` ohne ``problems`` (alle Staffeln aller
  Arten abgeschlossen, samt Playoffs und Relegation, kein offener Gleichstand an einer Grenze). Dieselbe Stelle liest die Nachricht
  „Aufstieg bestätigt“ (#1627) und die Folge-Season (F.2). Der Meister kommt aus dem geltenden Meister-Eintrag (``tournament_awards``,
  F.1 bzw. F.6 aus den Playoffs). Nie aus einer laufenden Tabelle.
- **Zeigen** übernimmt die Zeremonie der Website (Warteschlange, ``CeremonyHost``) wie bei den Belohnungen (F.4, ``rewards/seen``).
- **Nachricht** über die bestehende Art ``league_reward`` (Thema „Turniere“, Push-Kanal der Erfolge) mit ``meta.reason``
  ``league_moment`` - keine neue Meldungsart.

Je Season und Co-Team ein Eintrag in ``league_moments`` (``key`` = ``<season>:<co-team>``, eindeutig; in einer Einzel-Liga
``<season>:user:<person>``). ``seen_by`` sagt, wer den Moment schon gesehen hat - einmal je Person, auf jedem Gerät: Das Zeigen holt
sich den Moment erst mit ``claim`` (ein bedingtes Schreiben), zwei Geräte zugleich zeigen ihn nie beide.

Korrigierter Endstand (Wiederöffnen, neuer Abschluss, Entscheid über Staffeln hinweg): Solange der Endstand nicht feststeht, ruht jeder
Moment der Season (``suspended``). Steht er wieder fest, bleibt es derselbe Eintrag samt ``seen_by``: Derselbe Ausgang kommt kein
zweites Mal; ein anderer Ausgang wird ruhig nachgezogen (``corrected_at``, ``previous``) - wer den Moment schon sah, bekommt keinen
neuen, sondern eine stille Nachricht „Endstand korrigiert“ (nur Postfach, kein Push). Fällt der Ausgang ganz weg (das Co-Team bleibt),
steht der Eintrag mit ``active: false`` da. Jeder Abgleich läuft unter der Sperre ``league_season_moment_resource`` - zwei Abschlüsse
kurz nacheinander schreiben nacheinander, nie durcheinander.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services.log_safe import log_safe

logger = logging.getLogger("tls.league_moments")

KIND = "league_reward"
REASON = "league_moment"
OUTCOMES = ("champion", "up", "down")
LABELS = {"champion": "Meister", "up": "Aufstieg", "down": "Abstieg"}
LIMIT = 500
# So lange nach dem bestätigten Endstand erscheint der Moment beim nächsten Besuch - danach bleibt nur der Hinweis im Profil.
FRESH_DAYS = 45
# Im Profil bzw. an der Teamseite: je Co-Team der jüngste Ausgang.
PROFILE_LIMIT = 3
TEAM_LIMIT = 6
LOCK_WAIT_SECONDS = 10.0


def _now() -> str:
    return now_utc().isoformat()


def _key(season_id: str, entrant: str) -> str:
    return f"{season_id}:{entrant}"


def fact_of(outcome: str, level) -> str:
    """Der Ausgang als Wert, den ein Wiederöffnen vergleicht: ``up:1``, ``down:3``, ``champion:1``."""
    return f"{outcome}:{level}"


def level_label(step: dict | None) -> str:
    """„Liga 1“ bzw. „Liga 1 · Elite“."""
    level = (step or {}).get("level")
    if not isinstance(level, int):
        return "Liga"
    nickname = " ".join(str((step or {}).get("nickname") or "").split())
    return f"Liga {level} · {nickname}" if nickname else f"Liga {level}"


def season_title(league: dict | None, season: dict | None) -> str:
    return " · ".join(part for part in ((league or {}).get("name"), (season or {}).get("name")) if part) or "Season"


def _step(level, divisions: dict[int, dict]) -> dict:
    division = divisions.get(level) if isinstance(level, int) else None
    nickname = " ".join(str((division or {}).get("nickname") or "").split()) or None
    return {"level": level if isinstance(level, int) else None, "nickname": nickname}


def texts(doc: dict, title: str) -> dict:
    """Die Texte des Moments - sachlich, Abstieg ruhig mit Blick auf die nächste Season. Web und App zeigen dieselben.

    ``label``: der Ausgang in einem Wort (Hinweis an Profil und Teamseite), ``kicker``/``title``/``name``/``meta``/``line``/``next``: die
    Zeilen der Karte von oben nach unten - jede Angabe nur einmal (Liga N steht im Titel, der Satz nennt den Weg dorthin), ``summary``:
    ein Satz für den Hinweis, ``aria``: der ganze Satz für Screenreader."""
    name = doc.get("display_name") or "Euer Team"
    outcome = doc.get("outcome")
    after = level_label(doc.get("to"))
    before = level_label(doc.get("from"))
    via = " über die Relegation" if doc.get("via") == "relegation" else ""
    if outcome == "champion":
        line = "Sieger der Playoffs." if doc.get("playoffs") else "Platz 1 im Endstand der Season."
        return {"label": "Meister", "kicker": after, "title": "Meister", "name": name, "meta": title, "line": line, "next": None,
                "summary": f"{name} ist Meister in {after}.", "aria": f"Meister: {name} ist Meister von {title} in {after}."}
    if outcome == "up":
        line = f"{name} steigt{via} von {before} in {after} auf."
        return {"label": "Aufstieg", "kicker": "Aufstieg", "title": after, "name": name, "meta": title, "line": line, "next": None,
                "summary": line, "aria": f"Aufstieg: {line}"}
    line = f"{name} wechselt{via} von {before} in {after}."
    return {"label": "Abstieg", "kicker": "Abstieg", "title": f"Nächste Season in {after}", "name": name, "meta": title, "line": line,
            "next": "Die neue Season beginnt für alle bei null.", "summary": f"{name} spielt die nächste Season in {after}.",
            "aria": f"Abstieg: {name} spielt die nächste Season{via} in {after}."}


def push_texts(doc: dict, title: str, *, corrected: bool = False) -> tuple[str, str]:
    """Titel und Text der Nachricht. ``corrected``: wer schon vom früheren Ausgang erfuhr - still und ohne Feier."""
    name = doc.get("display_name") or "Euer Team"
    after = level_label(doc.get("to"))
    via = " über die Relegation" if doc.get("via") == "relegation" else ""
    if not doc.get("active", True):
        phrase = f"Für {name} gilt jetzt der Stand auf der Ligaseite."
    elif doc.get("outcome") == "champion":
        phrase = f"{name} ist Meister."
    elif doc.get("outcome") == "up":
        phrase = f"{name} steigt{via} in {after} auf."
    else:
        phrase = f"{name} spielt die nächste Season{via} in {after}."
    if corrected or not doc.get("active", True):
        return "Endstand korrigiert", f"Die Liga-Leitung hat den Endstand von {title} korrigiert. {phrase}"
    headline = {"champion": f"Meister: {name}", "up": f"Aufstieg in {after}"}.get(doc.get("outcome"), f"Nächste Season in {after}")
    return headline, f"Der Endstand von {title} steht fest: {phrase}"


# ---------------------------------------------------------------- Bestätigter Ausgang

async def confirmed(db, season: dict) -> dict[str, dict] | None:
    """Je Co-Team (bzw. Person in einer Einzel-Liga) der bestätigte Ausgang - ``None``, solange der Endstand der ganzen Season nicht
    feststeht. Wer bleibt, steht nicht darin; der Meister geht vor."""
    from services import league_final, league_successor

    season_id = season["id"]
    if not league_final.all_closed(await league_final.season_staffeln(db, season_id)):
        return None
    checked = await league_successor.plan(db, season)
    if checked["problems"]:
        return None
    divisions = {row["level"]: row for row in await db.league_divisions.find(
        {"season_id": season_id}, {"_id": 0, "id": 1, "level": 1, "nickname": 1, "status": 1}).to_list(50)
        if row.get("status") != "archived" and isinstance(row.get("level"), int)}
    teams = {team["squad_id"]: team for division in checked["divisions"] for team in division["teams"] if team.get("squad_id")}
    found: dict[str, dict] = {}
    for squad_id, team in teams.items():
        if team.get("movement") in ("up", "down"):
            found[squad_id] = _entry(team["movement"], team, divisions)
    awards = await db.tournament_awards.find(
        {"league.season_id": season_id, "league.title": "Meister", "reward_key": None, "suspended": {"$ne": True}},
        {"_id": 0, "registration_id": 1, "user_id": 1, "team_id": 1, "tournament_id": 1, "final_match_id": 1, "league": 1}).to_list(LIMIT)
    registration_ids = sorted({award["registration_id"] for award in awards if award.get("registration_id")})
    registrations = {row["id"]: row for row in await db.tournament_registrations.find(
        {"id": {"$in": registration_ids}}, {"_id": 0, "id": 1, "squad_id": 1, "user_id": 1, "team_id": 1, "display_name": 1,
                                             "tournament_id": 1}).to_list(LIMIT)} if registration_ids else {}
    for award in awards:
        registration = registrations.get(award.get("registration_id") or "") or {}
        playoffs = not (award.get("league") or {}).get("staffel")
        squad_id = registration.get("squad_id")
        if squad_id and squad_id in teams:
            # Meister ist die oberste Liga N - dort steigt niemand auf; der Meister geht jedem anderen Ausgang vor.
            found[squad_id] = {**_entry("champion", teams[squad_id], divisions), "playoffs": playoffs}
        elif not registration.get("team_id") and registration.get("user_id"):
            # Einzel-Liga (F.4): die Person ist der Teilnehmer - ein Startplatz für die Folge-Season entsteht hier nie.
            level = await _level_of(db, registration.get("tournament_id"))
            found[f"user:{registration['user_id']}"] = {
                "outcome": "champion", "squad_id": None, "team_id": None, "user_id": registration["user_id"],
                "registration_id": registration["id"], "display_name": (award.get("league") or {}).get("display_name")
                or registration.get("display_name"), "from": _step(level, divisions), "to": _step(level, divisions), "via": None,
                "staffel": (award.get("league") or {}).get("staffel"), "playoffs": playoffs}
    return found


def _entry(outcome: str, team: dict, divisions: dict[int, dict]) -> dict:
    before = team.get("from_level")
    after = before if outcome == "champion" else team.get("target_level")
    return {"outcome": outcome, "squad_id": team["squad_id"], "team_id": team.get("team_id"), "user_id": None,
            "registration_id": team.get("registration_id"), "display_name": team.get("display_name"),
            "from": _step(before, divisions), "to": _step(after, divisions),
            "via": team.get("via") if outcome != "champion" else None, "staffel": team.get("from_staffel"), "playoffs": False}


async def _level_of(db, tournament_id: str | None):
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "league_context": 1}) if tournament_id else None
    division_id = ((tournament or {}).get("league_context") or {}).get("division_id")
    division = await db.league_divisions.find_one({"id": division_id}, {"_id": 0, "level": 1}) if division_id else None
    return (division or {}).get("level")


async def audiences(db, season: dict, found: dict[str, dict]) -> dict[str, dict]:
    """Wer den Moment bekommt - nach den Regeln der Belohnungen (F.4, Nr. 163, 167, 168): die Spieler mit Einsatz in der Season (aus
    allen geltenden Endständen: wer aufgestellt war, ohne Aufstellung der Kader), mit „ganzer Kader“ (``reward_players: roster``) der
    Kader des Co-Teams; dazu Captain und Vertreter wie bei einer Team-Belohnung. ``{key: {player_ids, responsible_ids, audience_ids}}``."""
    from services.league_reward_rules import basis_of
    from services.match_audience import responsible_ids, roster_ids, teams_by_id

    squads = {item["squad_id"] for item in found.values() if item.get("squad_id")}
    fielded: dict[str, set[str]] = {squad_id: set() for squad_id in squads}
    # Alle Arten: Wer in den Playoffs oder der Relegation spielte, hatte Einsatz in dieser Season.
    async for final in db.league_final_tables.find({"season_id": season["id"], "active": True}, {"_id": 0, "sides": 1}):
        for side in (final.get("sides") or {}).values():
            if side.get("squad_id") in fielded:
                fielded[side["squad_id"]].update(person for person in side.get("player_ids") or [] if person)
    registration_ids = sorted({item["registration_id"] for item in found.values() if item.get("registration_id")})
    registrations = {row["id"]: row for row in await db.tournament_registrations.find(
        {"id": {"$in": registration_ids}}, {"_id": 0}).to_list(LIMIT)} if registration_ids else {}
    teams = await teams_by_id(db, list(registrations.values()))
    basis = basis_of(season)
    out = {}
    for key, item in found.items():
        registration = registrations.get(item.get("registration_id") or "") or {}
        team = teams.get(registration.get("team_id") or "") or None
        if not item.get("squad_id"):
            players = {item["user_id"]} if item.get("user_id") else set()
            responsible: set[str] = set()
        else:
            players = set(roster_ids(registration, team)) if basis == "roster" else set(fielded.get(item["squad_id"]) or ())
            if not players:
                players = set(roster_ids(registration, team))
            responsible = set(responsible_ids(registration, team)) if registration else set()
        out[key] = {"player_ids": sorted(players), "responsible_ids": sorted(responsible), "audience_ids": sorted(players | responsible)}
    return out


# ---------------------------------------------------------------- Abgleich

async def sync(db, season_id: str | None) -> dict:
    """Nach jedem Schritt, der den Endstand einer Season ändert (Abschluss, Wiederöffnen, Entscheid über Staffeln hinweg) und nach
    einer geänderten Sichtbarkeit der Season. Gleicht die Momente mit dem bestätigten Endstand ab und schickt die Nachrichten. Ein
    zweiter Aufruf ändert nichts mehr."""
    from services.mutation_lock import MutationLockBusy, league_season_moment_resource, mutation_lock

    if not season_id:
        return {"active": 0}
    try:
        async with mutation_lock(db, league_season_moment_resource(season_id), wait_seconds=LOCK_WAIT_SECONDS):
            return await _sync(db, season_id)
    except MutationLockBusy:
        logger.warning("[league_moments] Abgleich der Season %s läuft schon - ausgelassen", log_safe(season_id))
        return {"active": 0, "busy": True}


async def _sync(db, season_id: str) -> dict:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        return {"active": 0}
    now = _now()
    found = await confirmed(db, season)
    if found is None:
        # Der Endstand steht nicht (mehr) fest: Jeder Moment der Season ruht - nichts wird gelöscht, nichts gezeigt.
        result = await db.league_moments.update_many({"season_id": season_id, "suspended": {"$ne": True}},
                                                     {"$set": {"suspended": True, "updated_at": now}})
        return {"active": 0, "suspended": int(result.modified_count or 0)}
    people = await audiences(db, season, found)
    existing = {row["key"]: row async for row in db.league_moments.find({"season_id": season_id}, {"_id": 0})}
    for entrant, item in found.items():
        key = _key(season_id, entrant)
        await _store(db, season, key, item, people[entrant], existing.get(key), now)
    for key, doc in existing.items():
        if key[len(season_id) + 1:] in found or not doc.get("active", True):
            continue
        # Der Ausgang ist weggefallen (etwa: bleibt nach der Korrektur) - der Eintrag bleibt, ohne Hinweis und ohne Moment.
        await db.league_moments.update_one({"key": key, "fact": doc.get("fact")}, {
            "$set": {"active": False, "suspended": False, "corrected_at": now, "updated_at": now, "seq": int(doc.get("seq") or 1) + 1,
                     "previous": {"outcome": doc.get("outcome"), "fact": doc.get("fact")}, "notified_ids": [],
                     "told_ids": sorted(set(doc.get("told_ids") or []) | set(doc.get("notified_ids") or []))}})
    sent = await notify(db, season)
    return {"active": len(found), "sent": sent}


async def after_visibility(db, season_id: str | None) -> int:
    """Die Sichtbarkeit der Season hat sich geändert: Nachrichten, die wegen „Aus“ (oder „Nur Liga-Leitung“) warteten, gehen jetzt
    hinaus. Rechnet den Endstand nicht neu."""
    from services.mutation_lock import MutationLockBusy, league_season_moment_resource, mutation_lock

    if not season_id or not await db.league_moments.find_one({"season_id": season_id}, {"_id": 0, "id": 1}):
        return 0
    try:
        async with mutation_lock(db, league_season_moment_resource(season_id), wait_seconds=LOCK_WAIT_SECONDS):
            season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
            return await notify(db, season) if season else 0
    except MutationLockBusy:
        return 0


async def _store(db, season: dict, key: str, item: dict, people: dict, before: dict | None, now: str) -> None:
    fact = fact_of(item["outcome"], (item.get("to") or {}).get("level"))
    fields = {
        "key": key, "season_id": season["id"], "league_id": season.get("league_id"), "squad_id": item.get("squad_id"),
        "team_id": item.get("team_id"), "user_id": item.get("user_id"), "registration_id": item.get("registration_id"),
        "outcome": item["outcome"], "fact": fact, "from": item["from"], "to": item["to"], "via": item.get("via"),
        "playoffs": bool(item.get("playoffs")), "display_name": item.get("display_name"), "staffel": item.get("staffel"),
        **people, "active": True, "suspended": False, "updated_at": now,
    }
    if before is None:
        try:
            await db.league_moments.update_one({"key": key}, {"$setOnInsert": {
                **fields, "id": new_id(), "created_at": now, "confirmed_at": now, "seq": 1, "seen_by": [], "notified_ids": [], "told_ids": []}},
                upsert=True)
        except DuplicateKeyError:
            pass  # zugleich angelegt - dann gilt der andere
        return
    changed = before.get("fact") != fact or not before.get("active", True)
    update: dict = {"$set": fields}
    if changed:
        # Ein anderer Ausgang (oder er kommt nach einer Korrektur zurück): ruhig nachgezogen - wer schon sah, sieht nicht noch einmal.
        update["$set"].update({"confirmed_at": now, "seq": int(before.get("seq") or 1) + 1, "notified_ids": [],
                               "told_ids": sorted(set(before.get("told_ids") or []) | set(before.get("notified_ids") or []))})
        if before.get("fact") != fact:
            update["$set"].update({"corrected_at": now, "previous": {"outcome": before.get("outcome"), "fact": before.get("fact")}})
    # Bedingt auf den gelesenen Stand: Zwei Abgleiche schreiben nie über einen neueren hinweg.
    await db.league_moments.update_one({"key": key, "seq": before.get("seq")}, update)


# ---------------------------------------------------------------- Nachricht

def _announce_covers(season: dict, doc: dict) -> bool:
    """Captain und Vertreter bekommen zum Auf- und Abstieg schon „Aufstieg bestätigt“ (#1627, ``start_rights.announce``) - kein Doppel."""
    settings = season.get("start_rights")
    return doc.get("outcome") in ("up", "down") and isinstance(settings, dict) and settings.get("announce", True) is not False


async def notify(db, season: dict) -> int:
    """Je Person und Stand eine Nachricht. Nur, solange die Season für die Person sichtbar ist - eine Season „Aus“ verrät nichts; wird
    sie eingeschaltet, holt der nächste Abgleich die Nachricht nach. Wer schon vom früheren Ausgang erfuhr, bekommt still „Endstand
    korrigiert“ (nur Postfach)."""
    from services.league_service import can_see_season
    from services.user_notifications import create_user_notification

    if (season.get("visibility") or "off") == "off":
        return 0
    league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0, "name": 1, "slug": 1}) or {}
    title = season_title(league, season)
    url = f"/liga/{league.get('slug')}/{season.get('slug')}" if league.get("slug") and season.get("slug") else "/"
    sent = 0
    docs = await db.league_moments.find({"season_id": season["id"], "suspended": {"$ne": True}}, {"_id": 0}).to_list(LIMIT)
    wanted = sorted({person for doc in docs for person in [*(doc.get("audience_ids") or []), *(doc.get("told_ids") or [])]})
    users = {row["id"]: row for row in await db.users.find({"id": {"$in": wanted}}, {"_id": 0}).to_list(len(wanted) + 1)} if wanted else {}
    allowed: dict[str, bool] = {}
    for doc in docs:
        told = set(doc.get("told_ids") or [])
        done = set(doc.get("notified_ids") or [])
        targets = told if not doc.get("active", True) else set(doc.get("audience_ids") or [])
        if doc.get("active", True) and _announce_covers(season, doc):
            targets -= set(doc.get("responsible_ids") or [])
        for person in sorted(targets - done):
            user = users.get(person)
            if not user:
                continue
            if person not in allowed:
                allowed[person] = await can_see_season(user, season)
            if not allowed[person]:
                continue
            claimed = await db.league_moments.update_one({"id": doc["id"], "seq": doc.get("seq"), "notified_ids": {"$ne": person}},
                                                         {"$addToSet": {"notified_ids": person}})
            if not claimed.modified_count:
                continue
            corrected = person in told
            headline, text = push_texts(doc, title, corrected=corrected)
            try:
                if await create_user_notification(person, headline, text, url=url, kind=KIND, meta={
                        "reason": REASON, "season_id": season["id"], "moment_id": doc["id"], "outcome": doc.get("outcome"),
                        "dedupe_key": f"league-moment:{doc['id']}:{doc.get('seq')}:{person}", "unique_dedupe": True,
                        **({"in_app_only": True} if corrected or not doc.get("active", True) else {})}):
                    sent += 1
            except Exception:  # noqa: BLE001 - der Moment steht, die Nachricht hält ihn nicht auf
                logger.warning("[league_moments] Nachricht zum Moment %s nicht verschickt", log_safe(doc.get("id")), exc_info=True)
    return sent


# ---------------------------------------------------------------- Lesen

async def _seasons(db, docs: list[dict]) -> tuple[dict, dict]:
    season_ids = sorted({doc["season_id"] for doc in docs if doc.get("season_id")})
    seasons = {row["id"]: row for row in await db.league_seasons.find({"id": {"$in": season_ids}}, {"_id": 0}).to_list(len(season_ids) + 1)}
    league_ids = sorted({row.get("league_id") for row in seasons.values() if row.get("league_id")})
    leagues = {row["id"]: row for row in await db.leagues.find(
        {"id": {"$in": league_ids}}, {"_id": 0, "id": 1, "name": 1, "slug": 1}).to_list(len(league_ids) + 1)}
    return seasons, leagues


def view(doc: dict, season: dict, league: dict, *, next_step: dict | None = None) -> dict:
    """Was Web und App zeigen - ohne Personenlisten."""
    title = season_title(league, season)
    to = doc.get("to") or {}
    before = doc.get("from") or {}
    return {
        "id": doc["id"], "outcome": doc.get("outcome"), "season_id": doc.get("season_id"), "season_name": season.get("name"),
        "season_number": season.get("number"), "league_name": league.get("name"), "title": title,
        "url": f"/liga/{league.get('slug')}/{season.get('slug')}" if league.get("slug") and season.get("slug") else None,
        "squad_id": doc.get("squad_id"), "team_id": doc.get("team_id"), "display_name": doc.get("display_name"),
        "from": {"level": before.get("level"), "nickname": before.get("nickname"), "label": level_label(before)},
        "to": {"level": to.get("level"), "nickname": to.get("nickname"), "label": level_label(to)},
        # Das Liga-Abzeichen (#1638) vor und nach dem Ausgang - Gold nur für den Meister.
        "badge_from": {"level": before.get("level"), "nickname": before.get("nickname"), "champion": False}
        if isinstance(before.get("level"), int) else None,
        "badge_to": {"level": to.get("level"), "nickname": to.get("nickname"), "champion": doc.get("outcome") == "champion"}
        if isinstance(to.get("level"), int) else None,
        "via": doc.get("via"), "playoffs": bool(doc.get("playoffs")), "corrected": bool(doc.get("corrected_at")),
        "confirmed_at": doc.get("confirmed_at"), "texts": texts(doc, title), "next_step": next_step,
    }


async def _next_step(db, doc: dict, user_id: str) -> dict | None:
    """Für Captain und Vertreter: Steht schon die Folge-Season mit einem offenen Startrecht (#1627, F.2a), der Weg zur Zusage. Ein
    aufgegebenes Co-Team (abgemeldet, verfallen, abgelehnt) bekommt keine Aufforderung - nur den Endstand."""
    if not doc.get("squad_id") or user_id not in (doc.get("responsible_ids") or []):
        return None
    successor = await db.league_seasons.find_one({"predecessor_id": doc["season_id"]}, {"_id": 0, "id": 1})
    if not successor:
        return None
    application = await db.league_applications.find_one(
        {"season_id": successor["id"], "squad_id": doc["squad_id"], "carry_over": {"$exists": True}},
        {"_id": 0, "status": 1, "carry_over": 1})
    right = ((application or {}).get("carry_over") or {}).get("start_right") or {}
    if (application or {}).get("status") == "accepted" and right.get("status") == "offered":
        return {"label": "Startrecht zusagen", "url": "/teams"}
    return None


def fresh(doc: dict, now: datetime | None = None) -> bool:
    stamp = doc.get("confirmed_at") or doc.get("created_at")
    try:
        when = datetime.fromisoformat(str(stamp))
    except (TypeError, ValueError):
        return False
    return when >= (now or now_utc()) - timedelta(days=FRESH_DAYS)


async def unseen_for(db, user: dict) -> list[dict]:
    """Was die Person noch nicht gesehen hat - nur geltende, frische Momente aus Seasons, die sie sieht (nie „Aus“)."""
    from services.league_service import can_see_season

    user_id = user["id"]
    docs = await db.league_moments.find({"audience_ids": user_id, "seen_by": {"$ne": user_id}, "active": True, "suspended": False},
                                        {"_id": 0}).sort("confirmed_at", -1).to_list(20)
    docs = [doc for doc in docs if fresh(doc)]
    if not docs:
        return []
    seasons, leagues = await _seasons(db, docs)
    out = []
    for doc in docs:
        season = seasons.get(doc["season_id"])
        if not season or season.get("status") == "archived" or not await can_see_season(user, season):
            continue
        out.append(view(doc, season, leagues.get(season.get("league_id") or "") or {}, next_step=await _next_step(db, doc, user_id)))
    # Der Meister zuerst, dann Aufstieg, dann Abstieg.
    return sorted(out, key=lambda row: OUTCOMES.index(row["outcome"]) if row["outcome"] in OUTCOMES else 9)


async def claim(db, user_id: str, ids: list[str]) -> list[str]:
    """Gesehen - genau einmal: Nur wer den Moment als Erster für sich einträgt, zeigt ihn (ein zweites Gerät, ein zweiter Tab bekommt
    ihn nicht mehr). Antwort: die Kennungen, die dieser Aufruf eingetragen hat."""
    claimed = []
    for moment_id in [str(value) for value in ids or [] if value][:20]:
        result = await db.league_moments.update_one(
            {"id": moment_id, "audience_ids": user_id, "seen_by": {"$ne": user_id}, "active": True, "suspended": False},
            {"$addToSet": {"seen_by": user_id}})
        if result.modified_count:
            claimed.append(moment_id)
    return claimed


def _latest_per_entrant(docs: list[dict], limit: int) -> list[dict]:
    out, seen = [], set()
    for doc in sorted(docs, key=lambda row: str(row.get("confirmed_at") or ""), reverse=True):
        entrant = doc.get("squad_id") or doc.get("user_id") or doc["id"]
        if entrant in seen:
            continue
        seen.add(entrant)
        out.append(doc)
    return out[:limit]


async def for_player(db, user_id: str, viewer: dict | None, *, scope) -> list[dict]:
    """Der Hinweis im Profil: je Co-Team der jüngste Ausgang. Die Person selbst sieht alles, wofür sie den Moment bekam; andere nur bei
    den Spielern (``player_ids``, wie die Season-Historie) und nach der Regel des Profils - eine Season „Aus“ nie."""
    from services.league_current import private_team_ids
    from services.profile_visibility import opens_season_page, sees_season

    field = "audience_ids" if scope.everything else "player_ids"
    docs = await db.league_moments.find({field: user_id, "active": True, "suspended": False}, {"_id": 0}).sort("confirmed_at", -1).to_list(50)
    if not docs:
        return []
    private = set() if scope.everything else await private_team_ids(db, [doc.get("team_id") for doc in docs])
    seasons, leagues = await _seasons(db, docs)
    visible, opens = [], {}
    for doc in docs:
        season = seasons.get(doc["season_id"])
        if not season or (season.get("visibility") or "off") == "off" or doc.get("team_id") in private:
            continue
        if not await sees_season(scope, season):
            continue
        visible.append(doc)
    out = []
    for doc in _latest_per_entrant(visible, PROFILE_LIMIT):
        season = seasons[doc["season_id"]]
        row = view(doc, season, leagues.get(season.get("league_id") or "") or {})
        if row["url"] and scope.mode != "public" and not await opens_season_page(viewer, season, opens):
            row["url"] = None
        out.append(row)
    return out


async def for_team(db, team_id: str, user: dict | None) -> list[dict]:
    """Der Hinweis an der Teamseite: je Co-Team der jüngste Ausgang aus Seasons, die die Person sieht."""
    from services.league_service import can_see_season

    docs = await db.league_moments.find({"team_id": team_id, "active": True, "suspended": False}, {"_id": 0}).sort("confirmed_at", -1).to_list(50)
    if not docs:
        return []
    seasons, leagues = await _seasons(db, docs)
    visible = []
    for doc in docs:
        season = seasons.get(doc["season_id"])
        if season and season.get("status") != "archived" and (season.get("visibility") or "off") != "off" and await can_see_season(user, season):
            visible.append(doc)
    return [view(doc, seasons[doc["season_id"]], leagues.get(seasons[doc["season_id"]].get("league_id") or "") or {})
            for doc in _latest_per_entrant(visible, TEAM_LIMIT)]
