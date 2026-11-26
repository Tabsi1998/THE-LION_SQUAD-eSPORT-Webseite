"""Saisonende-Moment für Aufstieg, Abstieg und Meister (#1639, docs/LIGA.md „F.8 Saisonende-Moment“).

Kein zweites System:

- **Quelle** ist allein der bestätigte Endstand der ganzen Season - ``league_successor.plan`` ohne ``problems`` (alle Staffeln aller
  Arten abgeschlossen, samt Playoffs und Relegation, kein offener Gleichstand an einer Grenze). Dieselbe Stelle liest die Nachricht
  „Aufstieg bestätigt“ (#1627) und die Folge-Season (F.2). Der Meister kommt aus dem geltenden Meister-Eintrag (``tournament_awards``,
  F.1 bzw. F.6 aus den Playoffs). Nie aus einer laufenden Tabelle.
- **Wer ihn bekommt**, rechnet dieselbe Funktion wie die Belohnungen (F.4, ``league_rewards.players_for``): Spieler mit Einsatz in
  gespielten Spielen - kampflose zählen nicht -, ohne Aufstellung der Kader; dazu Captain und Vertreter des Co-Teams.
- **Zeigen** übernimmt die Zeremonie der Website (Warteschlange, ``CeremonyHost``). Der Meister bringt die Belohnungen derselben Season
  als zweite Karte mit (Fabian 26.11., A) - sie warten bis dahin (``held_reward_ids``).
- **Nachricht** über die bestehende Art ``league_reward`` (Thema „Turniere“, Push-Kanal der Erfolge) mit ``meta.reason``
  ``league_moment`` - keine neue Meldungsart. Für den Meister ist es die einzige Nachricht (Belohnung und „Staffel abgeschlossen“
  schweigen für ihn).
- **Sichtbar** erst, wenn Mitglieder die Season sehen (``members`` oder ``public``, Fabian 26.11., C) - nie bei „Aus“ oder „Nur
  Liga-Leitung“.

Je Season und Co-Team ein Eintrag in ``league_moments`` (``key`` = ``<season>:<co-team>``, eindeutig; in einer Einzel-Liga
``<season>:user:<person>``). Gezeigt wird in zwei Schritten: ``claim`` holt den Moment für ein Gerät (``claims.<person>`` mit dem
Schlüssel des Geräts - ein zweites Gerät bekommt ihn nicht, dasselbe Gerät nach einer verlorenen Antwort schon), ``done`` trägt die
Person in ``seen_by`` ein - danach kommt er nirgends mehr.

Korrigierter Endstand: Solange der Endstand nicht feststeht, ruht jeder Moment der Season (``suspended``). Steht er wieder fest, bleibt
es derselbe Eintrag. Gleicher Ausgang: nichts passiert. Anderer Ausgang: Der Moment kommt einmal neu mit „Endstand korrigiert“, auch
für alle, die den alten sahen (Fabian 26.11., B). Fällt der Ausgang ganz weg (das Co-Team bleibt), steht der Eintrag mit
``active: false`` da; wer davon erfuhr, bekommt still „Endstand korrigiert“.

Abgleich unter der Blatt-Sperre ``league_season_moment_resource``; wer sie nicht bekommt, lässt die Marke ``moments_pending_at`` an der
Season stehen - der Job (``sweep``) holt nach. Die Nachrichten gehen danach außerhalb der Sperre und gebündelt hinaus.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services.league_moment_rules import (
    MEMBER_VISIBLE, champions, division_done, entrant_of, fresh, member_visible, moment_key, ready, season_closed,
)
from services.log_safe import log_safe

logger = logging.getLogger("tls.league_moments")

KIND = "league_reward"
REASON = "league_moment"
OUTCOMES = ("champion", "up", "down")
LABELS = {"champion": "Meister", "up": "Aufstieg", "down": "Abstieg"}
LIMIT = 500
# Dauer je Season (D), Regeln für die Belohnungen des Meisters (A): ``services/league_moment_rules.py`` (Blatt-Modul, ohne Import-Kreis).
# Merkmarke an der Season: ein Abgleich steht aus (Sperre belegt, Abbruch). Endet auf ``_at`` - geht nicht in die Folge-Season (F.2).
PENDING_FIELD = "moments_pending_at"
# Sichtbar für Mitglieder (Fabian 26.11., C): ``MEMBER_VISIBLE`` - „Aus“ und „Nur Liga-Leitung“ zeigen nichts.
__all__ = ["MEMBER_VISIBLE"]
# Ein geholter, aber nie geschlossener Moment darf nach so vielen Stunden auf ein anderes Gerät wechseln.
CLAIM_HOURS = 12
# Im Profil bzw. an der Teamseite: je Co-Team der jüngste Ausgang.
PROFILE_LIMIT = 3
TEAM_LIMIT = 6
LOCK_WAIT_SECONDS = 10.0
SWEEP_LIMIT = 50
NOTICE = "Endstand korrigiert"


def _now() -> str:
    return now_utc().isoformat()


def fact_of(outcome: str, level) -> str:
    """Der Ausgang als Wert, den ein Wiederöffnen vergleicht: ``up:1``, ``down:3``, ``champion:1``."""
    return f"{outcome}:{level}"


def level_label(step: dict | None) -> str:
    """„Liga 1“ bzw. „Liga 1 · Elite“."""
    level = (step or {}).get("level")
    if not isinstance(level, int):
        return "Liga"
    nickname = " ".join(str((step or {}).get("nickname") or "").split())
    # Festes Leerzeichen vor dem Punkt (wie LeagueBadge): Bricht der Text um, dann hinter dem Punkt - er steht nie am Zeilenanfang.
    return f"Liga {level} · {nickname}" if nickname else f"Liga {level}"


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
    ein Satz für den Hinweis, ``aria``: der ganze Satz für Screenreader, ``notice``: „Endstand korrigiert“ nach einer Korrektur."""
    name = doc.get("display_name") or "Euer Team"
    outcome = doc.get("outcome")
    after = level_label(doc.get("to"))
    before = level_label(doc.get("from"))
    via = " über die Relegation" if doc.get("via") == "relegation" else ""
    notice = NOTICE if doc.get("corrected_at") else None
    if outcome == "champion":
        line = "Sieger der Playoffs." if doc.get("playoffs") else "Platz 1 im Endstand der Season."
        out = {"label": "Meister", "kicker": after, "title": "Meister", "name": name, "meta": title, "line": line, "next": None,
               "summary": f"{name} ist Meister in {after}.", "aria": f"Meister: {name} ist Meister von {title} in {after}."}
    elif outcome == "up":
        line = f"{name} steigt{via} von {before} in {after} auf."
        out = {"label": "Aufstieg", "kicker": "Aufstieg", "title": after, "name": name, "meta": title, "line": line, "next": None,
               "summary": line, "aria": f"Aufstieg: {line}"}
    else:
        line = f"{name} wechselt{via} von {before} in {after}."
        out = {"label": "Abstieg", "kicker": "Abstieg", "title": f"Nächste Season in {after}", "name": name, "meta": title, "line": line,
               "next": "Die neue Season beginnt für alle bei null.", "summary": f"{name} spielt die nächste Season in {after}.",
               "aria": f"Abstieg: {name} spielt die nächste Season{via} in {after}."}
    out["notice"] = notice
    if notice:
        out["aria"] = f"{notice}. {out['aria']}"
    return out


def push_texts(doc: dict, title: str, *, corrected: bool = False, rewards: list[str] | None = None) -> tuple[str, str]:
    """Titel und Text der Nachricht. ``corrected``: Der Ausgang hat sich geändert - einmal „Endstand korrigiert“. ``rewards``: Namen der
    Belohnungen, die der Meister mitbringt - für ihn die einzige Nachricht."""
    name = doc.get("display_name") or "Euer Team"
    after = level_label(doc.get("to"))
    via = " über die Relegation" if doc.get("via") == "relegation" else ""
    if not doc.get("active", True):
        phrase = f"Für {name} gilt jetzt der Stand auf der Ligaseite."
    elif doc.get("outcome") == "champion":
        phrase = f"{name} ist Meister." + (f" Dazu: {', '.join(rewards)}." if rewards else "")
    elif doc.get("outcome") == "up":
        phrase = f"{name} steigt{via} in {after} auf."
    else:
        phrase = f"{name} spielt die nächste Season{via} in {after}."
    if corrected or not doc.get("active", True):
        return NOTICE, f"Die Liga-Leitung hat den Endstand von {title} korrigiert. {phrase}"
    headline = {"champion": f"Meister: {name}", "up": f"Aufstieg in {after}"}.get(doc.get("outcome"), f"Nächste Season in {after}")
    return headline, f"Der Endstand von {title} steht fest: {phrase}"


# ---------------------------------------------------------------- Bestätigter Ausgang

async def confirmed_moves(db, season: dict) -> dict[str, dict] | None:
    """Auf- und Abstieg je Co-Team - ``None``, solange der Endstand der ganzen Season nicht feststeht (samt Relegation). Wer bleibt,
    steht nicht darin."""
    from services import league_successor

    season_id = season["id"]
    if not await season_closed(db, season_id):
        return None
    checked = await league_successor.plan(db, season)
    if checked["problems"]:
        return None
    divisions = await _levels(db, season_id)
    found: dict[str, dict] = {}
    for division in checked["divisions"]:
        for team in division["teams"]:
            if team.get("squad_id") and team.get("movement") in ("up", "down"):
                found[team["squad_id"]] = _entry(team["movement"], team, divisions)
    return found


async def confirmed_champions(db, season: dict) -> dict[str, dict]:
    """Der Meister - sobald **seine** Liga N fertig ist (alle Staffeln samt Playoffs, Meister-Eintrag gesetzt), nicht erst mit der ganzen
    Season (Fabian 26.11.). Je Co-Team (bzw. Person in einer Einzel-Liga); eine Team-Anmeldung ohne Co-Team hat keinen Moment."""
    from services import league_postseason

    season_id = season["id"]
    winners = await champions(db, season_id)
    if not winners:
        return {}
    missing = {row.get("division_id") for row in await league_postseason.missing(db, season_id) if row.get("kind") == "playoff"}
    divisions = await _levels(db, season_id)
    by_id = {row["id"]: row for row in divisions.values()}
    done: dict[str, bool] = {}
    found: dict[str, dict] = {}
    for champion in winners:
        registration = champion["registration"]
        tournament = await db.tournaments.find_one({"id": registration.get("tournament_id")}, {"_id": 0, "league_context": 1})
        division_id = ((tournament or {}).get("league_context") or {}).get("division_id")
        if not division_id or division_id in missing:
            continue
        if division_id not in done:
            done[division_id] = await division_done(db, division_id)
        if not done[division_id]:
            continue
        level = (by_id.get(division_id) or {}).get("level")
        squad_id = registration.get("squad_id")
        entrant = entrant_of(registration)  # Co-Team bzw. in einer Einzel-Liga die Person
        if not entrant:
            continue  # Team-Anmeldung ohne Co-Team: kein Moment - Belohnung und Abschluss melden sich wie bisher (M3)
        user_id = None if squad_id else registration["user_id"]
        found[entrant] = {
            "outcome": "champion", "squad_id": squad_id, "team_id": registration.get("team_id"), "user_id": user_id,
            "registration_id": registration["id"], "display_name": champion["display_name"] or registration.get("display_name"),
            "from": _step(level, divisions), "to": _step(level, divisions), "via": None, "staffel": champion["staffel"],
            "playoffs": champion["playoffs"], "division_id": division_id}
    return found


async def _levels(db, season_id: str) -> dict[int, dict]:
    return {row["level"]: row for row in await db.league_divisions.find(
        {"season_id": season_id}, {"_id": 0, "id": 1, "level": 1, "nickname": 1, "status": 1}).to_list(50)
        if row.get("status") != "archived" and isinstance(row.get("level"), int)}


def _entry(outcome: str, team: dict, divisions: dict[int, dict]) -> dict:
    before = team.get("from_level")
    after = before if outcome == "champion" else team.get("target_level")
    return {"outcome": outcome, "squad_id": team["squad_id"], "team_id": team.get("team_id"), "user_id": None,
            "registration_id": team.get("registration_id"), "display_name": team.get("display_name"),
            "from": _step(before, divisions), "to": _step(after, divisions),
            "via": team.get("via") if outcome != "champion" else None, "staffel": team.get("from_staffel"), "playoffs": False}


async def audiences(db, season: dict, found: dict[str, dict]) -> dict[str, dict]:
    """Wer den Moment bekommt - mit derselben Funktion wie die Belohnungen (F.4, ``league_rewards.players_for``, Nr. 163, 167, 168),
    je Staffel der Season (auch Playoffs und Relegation): wer in einem **gespielten** Spiel aufgestellt war (kampflose zählen nicht);
    ohne jede Aufstellung der Kader; mit „ganzer Kader“ (``reward_players: roster``) der Kader. Dazu Captain und Vertreter des Co-Teams
    (ohne beide die Leitung des Hauptteams) - nie, wer die Anmeldung nur angelegt hat.
    ``{key: {player_ids, responsible_ids, audience_ids, registration_ids}}``."""
    from services.league_reward_rules import basis_of
    from services.league_rewards import players_for
    from services.match_audience import responsible_ids, teams_by_id

    squads = {item["squad_id"]: key for key, item in found.items() if item.get("squad_id")}
    persons = {item["user_id"]: key for key, item in found.items() if not item.get("squad_id") and item.get("user_id")}
    places: dict[str, list[tuple[str, str]]] = {key: [] for key in found}
    # Alle Arten: Wer in den Playoffs oder der Relegation spielte, hatte Einsatz in dieser Season.
    async for final in db.league_final_tables.find({"season_id": season["id"], "active": True}, {"_id": 0, "tournament_id": 1, "sides": 1}):
        for registration_id, side in (final.get("sides") or {}).items():
            key = squads.get(side.get("squad_id") or "")
            if key is None and not side.get("team_id"):
                key = next((persons[person] for person in side.get("player_ids") or [] if person in persons), None)
            if key is not None:
                places[key].append((final["tournament_id"], registration_id))
    registration_ids = sorted({registration_id for rows in places.values() for _tid, registration_id in rows}
                              | {item["registration_id"] for item in found.values() if item.get("registration_id")})
    registrations = {row["id"]: row for row in await db.tournament_registrations.find(
        {"id": {"$in": registration_ids}}, {"_id": 0}).to_list(LIMIT * 4)} if registration_ids else {}
    tournament_ids = sorted({tid for rows in places.values() for tid, _registration in rows})
    matches: dict[str, list[dict]] = {tid: [] for tid in tournament_ids}
    if tournament_ids:
        async for match in db.matches_v2.find({"tournament_id": {"$in": tournament_ids}, "is_preview": {"$ne": True}},
                                              {"_id": 0, "tournament_id": 1, "status": 1, "games": 1, "lineups": 1, "slots": 1}):
            matches[match["tournament_id"]].append(match)
    teams = await teams_by_id(db, list(registrations.values()))
    basis = basis_of(season)
    out = {}
    for key, item in found.items():
        fielded: set[str] = set()
        roster: set[str] = set()
        for tid, registration_id in places[key]:
            registration = registrations.get(registration_id)
            if not registration:
                continue
            players, fallback = players_for(registration, teams.get(registration.get("team_id") or "") or None, matches.get(tid) or [], basis)
            (roster if fallback else fielded).update(players)
        players = fielded or roster
        responsible: set[str] = set()
        if item.get("squad_id"):
            # Wie die Nachrichten der Liga an ein Co-Team (``league_applications._responsible``): die Seite ohne ``user_id``.
            side = {"team_id": item.get("team_id"), "squad_id": item["squad_id"]}
            responsible = set(responsible_ids(side, teams.get(item.get("team_id") or "") or None))
        out[key] = {"player_ids": sorted(players), "responsible_ids": sorted(responsible), "audience_ids": sorted(players | responsible),
                    "registration_ids": sorted({registration_id for _tid, registration_id in places[key]}
                                               | ({item["registration_id"]} if item.get("registration_id") else set()))}
    return out


# ---------------------------------------------------------------- Abgleich

async def sync(db, season_id: str | None) -> dict:
    """Nach jedem Schritt, der den Endstand einer Season ändert (Abschluss, Wiederöffnen, Entscheid über Staffeln hinweg). Erst die Marke
    an der Season, dann der Abgleich unter der Sperre, dann die Nachrichten außerhalb. Wer die Sperre nicht bekommt, lässt die Marke
    stehen - der Job holt nach. Ein zweiter Aufruf ändert nichts mehr."""
    from services.mutation_lock import MutationLockBusy, league_season_moment_resource, mutation_lock

    if not season_id:
        return {"active": 0}
    mark = new_id()
    await db.league_seasons.update_one({"id": season_id}, {"$set": {PENDING_FIELD: {"at": _now(), "mark": mark}}})
    try:
        async with mutation_lock(db, league_season_moment_resource(season_id), wait_seconds=LOCK_WAIT_SECONDS):
            result = await _sync(db, season_id)
    except MutationLockBusy:
        logger.warning("[league_moments] Abgleich der Season %s ausgelassen - der Job holt ihn nach", log_safe(season_id))
        return {"active": 0, "busy": True}
    # Erst die Nachrichten zum Moment, dann das Zurückgestellte des Meisters (M3) - abgedeckt ist nur, wem der Moment wirklich geschickt
    # wurde. Beides außerhalb der Sperre und je Person bzw. je Merkzettel bedingt beansprucht. Scheitert etwas, bleibt die Marke stehen.
    result["sent"] = await notify(db, season_id)
    result["settled"] = await settle(db, season_id)
    # Nur die eigene Marke fällt weg: Kam inzwischen ein neuerer Auftrag, bleibt seine stehen.
    await db.league_seasons.update_one({"id": season_id, f"{PENDING_FIELD}.mark": mark}, {"$unset": {PENDING_FIELD: ""}})
    return result


async def sweep(db) -> dict:
    """Der Job: jede Season mit offener Marke noch einmal abgleichen."""
    done = 0
    async for season in db.league_seasons.find({PENDING_FIELD: {"$exists": True}}, {"_id": 0, "id": 1}).limit(SWEEP_LIMIT):
        try:
            result = await sync(db, season["id"])
            done += 0 if result.get("busy") else 1
        except Exception:  # noqa: BLE001 - eine Season hält die anderen nicht auf
            logger.warning("[league_moments] Nachholen der Season %s fehlgeschlagen", log_safe(season.get("id")), exc_info=True)
    return {"synced": done}


async def _sync(db, season_id: str) -> dict:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        return {"active": 0}
    now = _now()
    moves = await confirmed_moves(db, season)
    winners = await confirmed_champions(db, season)
    # Der Meister geht jedem anderen Ausgang vor (die oberste Liga N hat keinen Aufstieg).
    found = {**(moves or {}), **winners}
    people = await audiences(db, season, found) if found else {}
    existing = {row["key"]: row async for row in db.league_moments.find({"season_id": season_id}, {"_id": 0})}
    for entrant, item in found.items():
        key = moment_key(season_id, entrant)
        await _store(db, season, key, item, people[entrant], existing.get(key), now)
    ready_divisions = {item.get("division_id") for item in winners.values()}
    suspended = 0
    for key, doc in existing.items():
        if key[len(season_id) + 1:] in found or not doc.get("active", True):
            continue
        champion = doc.get("outcome") == "champion"
        # Ruhen: Der Endstand, auf dem der Moment beruht, steht gerade nicht fest (Liga des Meisters bzw. Season wieder offen).
        if (champion and doc.get("division_id") not in ready_divisions) or (not champion and moves is None):
            if not doc.get("suspended"):
                await db.league_moments.update_one({"key": key, "seq": doc.get("seq")}, {"$set": {"suspended": True, "updated_at": now}})
                suspended += 1
            continue
        # Der Ausgang ist weggefallen (ein anderer Meister, bleibt jetzt) - der Eintrag bleibt, ohne Hinweis und ohne Moment.
        await db.league_moments.update_one({"key": key, "seq": doc.get("seq")}, {
            "$set": {"active": False, "suspended": False, "corrected_at": now, "updated_at": now, "seq": int(doc.get("seq") or 1) + 1,
                     "previous": {"outcome": doc.get("outcome"), "fact": doc.get("fact")}, "notified_ids": [],
                     "told_ids": sorted(set(doc.get("told_ids") or []) | set(doc.get("notified_ids") or []))}})
    return {"active": len(found), "suspended": suspended}


async def _store(db, season: dict, key: str, item: dict, people: dict, before: dict | None, now: str) -> None:
    fact = fact_of(item["outcome"], (item.get("to") or {}).get("level"))
    fields = {
        "key": key, "season_id": season["id"], "league_id": season.get("league_id"), "squad_id": item.get("squad_id"),
        "team_id": item.get("team_id"), "user_id": item.get("user_id"), "registration_id": item.get("registration_id"),
        "outcome": item["outcome"], "fact": fact, "from": item["from"], "to": item["to"], "via": item.get("via"),
        "playoffs": bool(item.get("playoffs")), "display_name": item.get("display_name"), "staffel": item.get("staffel"),
        "division_id": item.get("division_id"), **people, "active": True, "suspended": False, "updated_at": now,
    }
    if before is None:
        try:
            await db.league_moments.update_one({"key": key}, {"$setOnInsert": {
                **fields, "id": new_id(), "created_at": now, "confirmed_at": now, "seq": 1, "seen_by": [], "claims": {},
                "notified_ids": [], "told_ids": []}}, upsert=True)
        except DuplicateKeyError:
            pass  # zugleich angelegt - dann gilt der andere
        return
    update: dict = {"$set": fields}
    if before.get("fact") != fact or not before.get("active", True):
        # Ein anderer Ausgang (oder er kommt nach einer Korrektur zurück): einmal neu mit „Endstand korrigiert“ - auch für alle, die den
        # alten sahen (Fabian 26.11., B). Wer schon eine Nachricht bekam, bekommt eine zweite mit dem Hinweis.
        update["$set"].update({"confirmed_at": now, "corrected_at": now, "seq": int(before.get("seq") or 1) + 1, "seen_by": [], "claims": {},
                               "notified_ids": [], "previous": {"outcome": before.get("outcome"), "fact": before.get("fact")},
                               "told_ids": sorted(set(before.get("told_ids") or []) | set(before.get("notified_ids") or []))})
    # Bedingt auf den gelesenen Stand: Zwei Abgleiche schreiben nie über einen neueren hinweg.
    await db.league_moments.update_one({"key": key, "seq": before.get("seq")}, update)


async def settle(db, season_id: str) -> int:
    """M3: Was der Abschluss für den Moment des Meisters zurückstellte (``tournament_awards.moment_owed``: „Neue Belohnung“, „Belohnung
    für euer Team“, „Staffel abgeschlossen“), geht an jede Person, der die Nachricht zum Moment **nicht** geschickt wurde - wie vor
    #1639, mit denselben Schlüsseln (``unique_dedupe``). Erst beansprucht, dann gesendet: Laufen mehrere zugleich (Job und Routen),
    schickt nur einer. Ein späteres Sichtbarwerden schickt nichts noch einmal (``notify`` sieht nach, was schon kam)."""
    from services import league_final, league_rewards

    awards = await db.tournament_awards.find({"league.season_id": season_id, "league.title": "Meister", "reward_key": None,
                                              "moment_owed": {"$exists": True}}, {"_id": 0}).to_list(LIMIT)
    sent = 0
    for award in awards:
        owed = award.get("moment_owed") or {}
        # Erst beanspruchen, dann senden (Prüfung 3): Nur wer das Gemerkte wegnimmt, schickt - vier gleichzeitige Läufe schicken einmal.
        claimed = await db.tournament_awards.update_one({"id": award["id"], "moment_owed.at": owed.get("at")}, {"$unset": {"moment_owed": ""}})
        if not claimed.modified_count:
            continue
        registration = await db.tournament_registrations.find_one({"id": award.get("registration_id")},
                                                                   {"_id": 0, "squad_id": 1, "user_id": 1, "team_id": 1})
        # Co-Team oder - in einer Einzel-Liga - die Person selbst (Prüfung 4).
        entrant = entrant_of(registration)
        doc = await db.league_moments.find_one({"key": moment_key(season_id, entrant)}, {"_id": 0}) if entrant else None
        rewards = owed.get("rewards") or {}
        # Abgedeckt ist nur, wem die Nachricht zum Moment wirklich ging (``notified_ids``, ``notify`` lief davor) - wird die Season
        # danach wieder unsichtbar, bleibt trotzdem niemand ohne Nachricht.
        told = set(doc.get("notified_ids") or []) if doc and doc.get("active", True) and not doc.get("suspended") else set()

        def missed(person: str) -> bool:
            return person not in told

        gains = {person: names for person, names in (rewards.get("gains") or {}).items() if missed(person)}
        leads = {team: [person for person in persons if missed(person)] for team, persons in (rewards.get("team_leads") or {}).items()}
        close = {person for person in owed.get("close") or [] if missed(person)}
        tournament = await db.tournaments.find_one({"id": award.get("tournament_id")}, {"_id": 0})
        final = await db.league_final_tables.find_one({"id": owed.get("final_id")}, {"_id": 0}) if owed.get("final_id") else None
        if tournament and final and (gains or any(leads.values()) or close):
            frame = await league_final._frame(db, tournament)
            if gains or any(leads.values()):
                sent += await league_rewards.notify(db, tournament, final, frame, {
                    "gains": gains, "team_gains": {team: names for team, names in (rewards.get("team_gains") or {}).items() if leads.get(team)},
                    "team_leads": leads, "team_names": rewards.get("team_names") or {}})
            if close:
                sent += await league_final.notify_captains(db, tournament, final, frame, "closed", only=close)
    return sent


async def _heard(db, doc: dict, person: str) -> tuple[bool, bool]:
    """Was die Person zum Meister schon hörte (M3: nie doppelt): „Staffel abgeschlossen … Meister“ bzw. eine Belohnungs-Nachricht."""
    finals = [(award.get("league") or {}).get("final_table_id") async for award in db.tournament_awards.find(
        {"league.season_id": doc["season_id"], "league.title": "Meister", "reward_key": None,
         "registration_id": {"$in": doc.get("registration_ids") or []}}, {"_id": 0, "league.final_table_id": 1})]
    finals = [final for final in finals if final]
    if not finals:
        return False, False
    close = await db.notifications.find_one({"user_id": person, "meta.dedupe_key": {"$in": [f"league-final:{final}:closed:{person}" for final in finals]}},
                                            {"_id": 1})
    keys = [f"league-reward:{final}:gain:{person}" for final in finals]
    keys += [f"league-reward:{final}:team-gain:{doc.get('team_id')}:{person}" for final in finals]
    reward = await db.notifications.find_one({"user_id": person, "meta.dedupe_key": {"$in": keys}}, {"_id": 1})
    return bool(close), bool(reward)


async def after_visibility(db, season_id: str | None) -> int:
    """Die Sichtbarkeit der Season hat sich geändert: Nachrichten, die warteten, gehen jetzt hinaus. Ohne Sperre - jede Nachricht wird je
    Person bedingt beansprucht."""
    if not season_id or not await db.league_moments.find_one({"season_id": season_id}, {"_id": 0, "id": 1}):
        return 0
    return await notify(db, season_id)


# ---------------------------------------------------------------- Nachricht

def _announce_covers(season: dict, doc: dict) -> bool:
    """Captain und Vertreter bekommen zum Auf- und Abstieg schon „Aufstieg bestätigt“ (#1627, ``start_rights.announce``) - kein Doppel."""
    settings = season.get("start_rights")
    return doc.get("outcome") in ("up", "down") and isinstance(settings, dict) and settings.get("announce", True) is not False


async def _reward_names(db, doc: dict) -> list[str]:
    """Die Belohnungen, die der Meister mitbringt - Namen für die eine Nachricht."""
    if doc.get("outcome") != "champion" or not doc.get("registration_ids"):
        return []
    rows = await db.tournament_awards.find({"league.season_id": doc["season_id"], "registration_id": {"$in": doc["registration_ids"]},
                                            "reward_key": {"$type": "string"}, "suspended": {"$ne": True}},
                                           {"_id": 0, "reward.name": 1}).to_list(50)
    return sorted({(row.get("reward") or {}).get("name") for row in rows if (row.get("reward") or {}).get("name")})


async def notify(db, season_id: str) -> int:
    """Je Person und Stand eine Nachricht - nur, solange Mitglieder die Season sehen und die Person sie sieht, und nur bei bestätigtem
    Endstand. Gebündelt an Expo (``push_batch``, #2553). Ein geänderter Ausgang kommt einmal als „Endstand korrigiert“; ein
    weggefallener still (nur Postfach)."""
    from services.league_service import can_see_season
    from services.private_fields import private_projection
    from services.user_notifications import create_user_notification, send_collected_pushes

    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not member_visible(season):
        return 0
    cache: dict = {}
    league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0, "name": 1, "slug": 1}) or {}
    title = season_title(league, season)
    url = f"/liga/{league.get('slug')}/{season.get('slug')}" if league.get("slug") and season.get("slug") else "/"
    sent = 0
    batch: list[dict] = []
    docs = await db.league_moments.find({"season_id": season_id, "suspended": {"$ne": True}}, {"_id": 0}).to_list(LIMIT)
    wanted = sorted({person for doc in docs for person in [*(doc.get("audience_ids") or []), *(doc.get("told_ids") or [])]})
    # Für die Sichtbarkeit (Rolle, Bereiche, Mitgliedschaft) - nie private Felder.
    users = {row["id"]: row for row in await db.users.find({"id": {"$in": wanted}}, private_projection()).to_list(len(wanted) + 1)} if wanted else {}
    allowed: dict[str, bool] = {}
    for doc in docs:
        # Sein Endstand steht gerade nicht fest (veralteter Abgleich) - nichts melden. Ein weggefallener Ausgang meldet sich still mit
        # „Endstand korrigiert“; der alte Meister hat keinen Meister-Eintrag mehr, darum hier ohne diese Prüfung.
        if doc.get("active", True) and not await ready(db, doc, cache):
            continue
        told = set(doc.get("told_ids") or [])
        done = set(doc.get("notified_ids") or [])
        targets = told if not doc.get("active", True) else set(doc.get("audience_ids") or [])
        if doc.get("active", True) and _announce_covers(season, doc):
            targets -= set(doc.get("responsible_ids") or [])
        rewards = await _reward_names(db, doc) if targets - done else []
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
            corrected = person in told or bool(doc.get("corrected_at") and doc.get("active", True) and doc.get("seq", 1) > 1)
            mine = rewards
            if doc.get("outcome") == "champion" and doc.get("active", True):
                heard_close, heard_rewards = await _heard(db, doc, person)
                if heard_close and not corrected:
                    continue  # „Staffel abgeschlossen … Meister“ kam schon (M3) - nie doppelt
                mine = [] if heard_rewards else rewards
            headline, text = push_texts(doc, title, corrected=corrected, rewards=mine)
            try:
                if await create_user_notification(person, headline, text, url=url, kind=KIND, push_batch=batch, meta={
                        "reason": REASON, "season_id": season_id, "moment_id": doc["id"], "outcome": doc.get("outcome"),
                        "dedupe_key": f"league-moment:{doc['id']}:{doc.get('seq')}:{person}", "unique_dedupe": True,
                        **({"in_app_only": True} if not doc.get("active", True) else {})}):
                    sent += 1
            except Exception:  # noqa: BLE001 - der Moment steht, die Nachricht hält ihn nicht auf
                logger.warning("[league_moments] Nachricht zum Moment %s nicht verschickt", log_safe(doc.get("id")), exc_info=True)
    if batch:
        try:
            await send_collected_pushes(batch)
        except Exception:  # noqa: BLE001 - die Meldungen liegen in der Glocke; der Push holt die Nachhol-Stufe nach
            logger.warning("[league_moments] Pushes der Season %s nicht gebündelt verschickt", log_safe(season_id), exc_info=True)
    return sent


# ---------------------------------------------------------------- Belohnungen des Meisters (Fabian 26.11., A)

async def _rewards_for(db, doc: dict, user_id: str) -> list[dict]:
    """Die Belohnungen, die der Meister-Moment dieser Person als zweite Karte mitbringt - geltend, noch nicht gesehen."""
    from services.awards import award_view

    if doc.get("outcome") != "champion" or not doc.get("registration_ids"):
        return []
    rows = await db.tournament_awards.find({"league.season_id": doc["season_id"], "registration_id": {"$in": doc["registration_ids"]},
                                            "reward_key": {"$type": "string"}, "suspended": {"$ne": True}, "audience_ids": user_id,
                                            "seen_by": {"$ne": user_id}}, {"_id": 0}).sort("updated_at", -1).to_list(20)
    return [award_view(row) for row in rows]


# ---------------------------------------------------------------- Lesen

async def _seasons(db, docs: list[dict]) -> tuple[dict, dict]:
    season_ids = sorted({doc["season_id"] for doc in docs if doc.get("season_id")})
    seasons = {row["id"]: row for row in await db.league_seasons.find({"id": {"$in": season_ids}}, {"_id": 0}).to_list(len(season_ids) + 1)}
    league_ids = sorted({row.get("league_id") for row in seasons.values() if row.get("league_id")})
    leagues = {row["id"]: row for row in await db.leagues.find(
        {"id": {"$in": league_ids}}, {"_id": 0, "id": 1, "name": 1, "slug": 1}).to_list(len(league_ids) + 1)}
    return seasons, leagues


def view(doc: dict, season: dict, league: dict, *, next_step: dict | None = None, rewards: list[dict] | None = None) -> dict:
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
        "confirmed_at": doc.get("confirmed_at"), "texts": texts(doc, title), "next_step": next_step, "rewards": rewards or [],
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


async def _readable(db, season: dict | None, doc: dict, cache: dict) -> bool:
    """Für Mitglieder sichtbar und - frisch gefragt - der Endstand des Moments steht (``league_moment_rules.ready``)."""
    return member_visible(season) and await ready(db, doc, cache)


async def unseen_for(db, user: dict) -> list[dict]:
    """Was die Person noch nicht gesehen hat - nur geltende, frische Momente aus Seasons, die Mitglieder und sie selbst sehen, mit
    abgeschlossenen Staffeln. Der Meister bringt seine Belohnungen als ``rewards`` mit."""
    from services.league_service import can_see_season

    user_id = user["id"]
    docs = await db.league_moments.find({"audience_ids": user_id, "seen_by": {"$ne": user_id}, "active": True, "suspended": False},
                                        {"_id": 0}).sort("confirmed_at", -1).to_list(20)
    if not docs:
        return []
    seasons, leagues = await _seasons(db, docs)
    closed: dict[str, bool] = {}
    out = []
    for doc in docs:
        season = seasons.get(doc["season_id"])
        if not fresh(doc, season) or not await _readable(db, season, doc, closed) or not await can_see_season(user, season):
            continue
        out.append(view(doc, season, leagues.get(season.get("league_id") or "") or {}, next_step=await _next_step(db, doc, user_id),
                        rewards=await _rewards_for(db, doc, user_id)))
    # Der Meister zuerst, dann Aufstieg, dann Abstieg.
    return sorted(out, key=lambda row: OUTCOMES.index(row["outcome"]) if row["outcome"] in OUTCOMES else 9)


async def claim(db, user_id: str, ids: list[str], token: str) -> list[str]:
    """Für ein Gerät holen - genau einmal je Person: Nur wer den Moment als Erster für sich holt (``claims.<person>`` mit dem Schlüssel des
    Geräts), zeigt ihn. Dasselbe Gerät bekommt ihn nach einer verlorenen Antwort wieder, ein anderes nicht - es sei denn, das Holen liegt
    ``CLAIM_HOURS`` zurück. Antwort: die Kennungen, die dieses Gerät zeigen darf."""
    ids = [str(value) for value in ids or [] if value][:20]
    if not ids or not token:
        return []
    docs = await db.league_moments.find({"id": {"$in": ids}, "audience_ids": user_id}, {"_id": 0}).to_list(20)
    closed: dict[str, bool] = {}
    now = now_utc()
    stale = (now - timedelta(hours=CLAIM_HOURS)).isoformat()
    claimed = []
    for doc in docs:
        if not await ready(db, doc, closed):
            continue  # ein veralteter Abgleich: Der Endstand ist wieder offen - nichts zeigen
        field = f"claims.{user_id}"
        result = await db.league_moments.update_one(
            {"id": doc["id"], "audience_ids": user_id, "seen_by": {"$ne": user_id}, "active": True, "suspended": False,
             "$or": [{field: {"$exists": False}}, {f"{field}.token": token}, {f"{field}.at": {"$lt": stale}}]},
            {"$set": {field: {"token": token, "at": now.isoformat()}}})
        if result.matched_count:
            claimed.append(doc["id"])
    return claimed


async def done(db, user_id: str, ids: list[str]) -> int:
    """Gezeigt und geschlossen - ab jetzt kommt der Moment für diese Person nirgends mehr."""
    ids = [str(value) for value in ids or [] if value][:20]
    if not ids:
        return 0
    result = await db.league_moments.update_many({"id": {"$in": ids}, "audience_ids": user_id},
                                                 {"$addToSet": {"seen_by": user_id}, "$unset": {f"claims.{user_id}": ""}})
    return int(result.modified_count or 0)


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
    den Spielern (``player_ids``, wie die Season-Historie) und nach der Regel des Profils - nur Seasons, die Mitglieder sehen."""
    from services.league_current import private_team_ids
    from services.profile_visibility import opens_season_page, sees_season

    field = "audience_ids" if scope.everything else "player_ids"
    docs = await db.league_moments.find({field: user_id, "active": True, "suspended": False}, {"_id": 0}).sort("confirmed_at", -1).to_list(50)
    if not docs:
        return []
    private = set() if scope.everything else await private_team_ids(db, [doc.get("team_id") for doc in docs])
    seasons, leagues = await _seasons(db, docs)
    visible, opens, closed = [], {}, {}
    for doc in docs:
        season = seasons.get(doc["season_id"])
        if doc.get("team_id") in private or not await _readable(db, season, doc, closed) or not await sees_season(scope, season):
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
    """Der Hinweis an der Teamseite: je Co-Team der jüngste Ausgang aus Seasons, die Mitglieder und die Person sehen."""
    from services.league_service import can_see_season

    docs = await db.league_moments.find({"team_id": team_id, "active": True, "suspended": False}, {"_id": 0}).sort("confirmed_at", -1).to_list(50)
    if not docs:
        return []
    seasons, leagues = await _seasons(db, docs)
    visible, closed = [], {}
    for doc in docs:
        season = seasons.get(doc["season_id"])
        if await _readable(db, season, doc, closed) and await can_see_season(user, season):
            visible.append(doc)
    return [view(doc, seasons[doc["season_id"]], leagues.get(seasons[doc["season_id"]].get("league_id") or "") or {})
            for doc in _latest_per_entrant(visible, TEAM_LIMIT)]


# ---------------------------------------------------------------- Kontolöschung

PERSON_LISTS = ("player_ids", "responsible_ids", "audience_ids", "seen_by", "notified_ids", "told_ids")


async def scrub_person(db, user_id: str) -> int:
    """Der Moment bleibt Vereinsinhalt (wie ``tournament_awards``); die Kennung der Person fällt aus allen Listen und Gerätevermerken."""
    if not user_id:
        return 0
    query = {"$or": [{field: user_id} for field in PERSON_LISTS] + [{f"claims.{user_id}": {"$exists": True}}]}
    result = await db.league_moments.update_many(query, {"$pull": {field: user_id for field in PERSON_LISTS},
                                                         "$unset": {f"claims.{user_id}": ""}})
    return int(result.modified_count or 0)
