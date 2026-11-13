"""Belohnungen je Season (F.4, #2214, docs/LIGA.md „F.4 Belohnungen“; Entscheidungen Nr. 163 bis 166).

Kein zweites System: Eine vergebene Belohnung ist ein Eintrag in ``tournament_awards`` neben dem Meister-Eintrag aus F.1 (mit
``reward_key`` und ``reward``), ein echter Gewinn ein Eintrag in ``prize_pickups``.

- **Zusammenstellung** ``league_seasons.rewards`` (Liste), ``league_seasons.reward_players`` (``fielded`` Spieler mit Einsatz - die
  Vorgabe, Nr. 163 - oder ``roster`` ganzer Kader) und je Liga N ``league_divisions.rewards`` (``None``: die der Season; Liste: eigene).
  Fehlt alles, gibt es keine Belohnungen - die Season verhält sich wie vor F.4.
- **Vergabe** (Nr. 165) beim Abschluss einer Staffel aus dem Endstand (``grant``, ein Folge-Schritt von ``league_final.close``).
- **Wieder öffnen** (Nr. 166): Die Einträge ruhen wie der Meister-Eintrag (``league_final.suspend_champion`` setzt ``suspended`` an
  allen Einträgen der Staffel). Der neue Abschluss teilt neu zu - ohne Doppel; wer etwas gewinnt oder verliert, bekommt Nachricht.
"""
from __future__ import annotations

import logging

from pymongo.errors import DuplicateKeyError

from models import REGISTRATION_LIMIT, new_id, now_utc
from services.log_safe import log_safe
from services.league_reward_rules import (  # noqa: F401 - auch für Routen und Tests
    DEFAULT_BASIS, KINDS, METALS, MODES, PLAYER_BASIS, RECIPIENTS, _order, basis_of, effective, fits, metal_of, place_label, public_item,
    public_view, recipients_label,
)

logger = logging.getLogger("tls.league_rewards")

ITEM_LIMIT = 20
NAME_MAX, DESCRIPTION_MAX, PRIZE_MAX = 60, 200, 160
RANK_MAX = 99
# Gespielte Spiele - nur dort zählt eine Aufstellung als Einsatz. Kampflos zählt nicht (Nr. 168).
PLAYED_STATUSES = ("completed",)
NOTIFICATION_KIND = "league_reward"


class RewardProblem(ValueError):
    """Eine Zusammenstellung, die nicht passt - mit deutscher Meldung (422)."""

    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status


# ---------------------------------------------------------------- Zusammenstellung

def _text(value, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _int(value, what: str) -> int:
    if isinstance(value, bool):
        raise RewardProblem(f"{what}: bitte eine ganze Zahl angeben.")
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise RewardProblem(f"{what}: bitte eine ganze Zahl angeben.") from None
    if number < 1 or number > RANK_MAX:
        raise RewardProblem(f"{what}: bitte eine Zahl von 1 bis {RANK_MAX} angeben.")
    return number


def clean_places(raw) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    mode = raw.get("mode")
    if mode == "all":
        return {"mode": "all"}
    if mode == "rank":
        return {"mode": "rank", "rank": _int(raw.get("rank"), "Platz")}
    if mode == "range":
        first, last = _int(raw.get("from"), "Platz von"), _int(raw.get("to"), "Platz bis")
        if last < first:
            raise RewardProblem("Platzbereich: „bis“ darf nicht vor „von“ liegen.")
        if first == last:
            return {"mode": "rank", "rank": first}
        return {"mode": "range", "from": first, "to": last}
    raise RewardProblem("Für wen gilt die Belohnung? Bitte Platz, Platzbereich oder „Alle Teilnehmer“ wählen.")


def clean_item(raw, known_ids: set[str]) -> dict:
    """Eine Belohnung geprüft. Die Kennung bleibt, wenn sie zur Season gehört - sonst vergibt der Server eine neue."""
    from services import league_look

    raw = raw.model_dump() if hasattr(raw, "model_dump") else dict(raw or {})
    kind = raw.get("kind")
    if kind not in KINDS:
        raise RewardProblem("Art der Belohnung: Banner, Emblem, Medaille oder Titel.")
    name = _text(raw.get("name"), NAME_MAX)
    if not name:
        raise RewardProblem("Jede Belohnung braucht einen Namen.")
    recipients = [value for value in RECIPIENTS if value in (raw.get("recipients") or [])]
    if not recipients:
        raise RewardProblem(f"„{name}“: Bitte wählen, wer sie bekommt - das Team, die Spieler oder beide.")
    try:
        image = league_look.clean_image(raw.get("image_url"))
    except league_look.LookProblem as problem:
        raise RewardProblem(problem.message) from None
    item_id = str(raw.get("id") or "")
    return {
        "id": item_id if item_id in known_ids else new_id(),
        "kind": kind, "name": name, "description": _text(raw.get("description"), DESCRIPTION_MAX),
        "places": clean_places(raw.get("places")), "recipients": recipients,
        "image_url": image, "prize": _text(raw.get("prize"), PRIZE_MAX) or None,
    }


def clean_items(rows, known_ids: set[str]) -> list[dict]:
    rows = list(rows or [])
    if len(rows) > ITEM_LIMIT:
        raise RewardProblem(f"Höchstens {ITEM_LIMIT} Belohnungen je Season bzw. Liga N.")
    out = [clean_item(row, known_ids) for row in rows]
    ids = [row["id"] for row in out]
    if len(ids) != len(set(ids)):
        raise RewardProblem("Eine Belohnung steht doppelt in der Liste.")
    return out


def clean_basis(value) -> str:
    if value in (None, ""):
        return DEFAULT_BASIS
    if value not in PLAYER_BASIS:
        raise RewardProblem("Spieler-Belohnungen gehen an Spieler mit Einsatz oder an den ganzen Kader.")
    return value


def known_ids(season: dict, divisions: list[dict]) -> set[str]:
    rows = list(season.get("rewards") or [])
    for division in divisions:
        rows += list(division.get("rewards") or [])
    return {str(row.get("id")) for row in rows if row.get("id")}


async def admin_view(db, season: dict, *, can_edit: bool) -> dict:
    """Der Reiter „Belohnungen“: Zusammenstellung der Season, je Liga N eigene oder geerbte, und je Staffel der Stand der Vergabe."""
    from services.league_final_read import is_closed
    from services.league_scope import ONLY_LEAGUE
    from services.league_service import division_label

    divisions = await db.league_divisions.find({"season_id": season["id"], "status": {"$ne": "archived"}}, {"_id": 0}).sort("level", 1).to_list(50)
    staffeln = await db.tournaments.find({"league_context.season_id": season["id"], **ONLY_LEAGUE},
                                         {"_id": 0, "id": 1, "title": 1, "status": 1, "final_table": 1, "league_context": 1}).to_list(500)
    counts: dict[str, dict] = {}
    async for doc in db.tournament_awards.find({"league.season_id": season["id"], "reward_key": {"$type": "string"}},
                                               {"_id": 0, "tournament_id": 1, "team_id": 1, "player_ids": 1, "user_id": 1, "suspended": 1,
                                                "roster_fallback": 1, "league.display_name": 1}):
        row = counts.setdefault(doc["tournament_id"], {"awards": 0, "teams": set(), "players": set(), "suspended": False, "fallback": set()})
        row["awards"] += 1
        if doc.get("roster_fallback"):
            row["fallback"].add((doc.get("league") or {}).get("display_name") or "Team")
        row["suspended"] = row["suspended"] or bool(doc.get("suspended"))
        if doc.get("team_id"):
            row["teams"].add(doc["team_id"])
        row["players"].update(doc.get("player_ids") or [])
        if doc.get("user_id"):
            row["players"].add(doc["user_id"])
    by_division: dict[str, list[dict]] = {}
    for staffel in staffeln:
        if staffel.get("status") in ("draft", "cancelled") and not is_closed(staffel):
            continue
        count = counts.get(staffel["id"]) or {"awards": 0, "teams": set(), "players": set(), "suspended": False, "fallback": set()}
        by_division.setdefault((staffel.get("league_context") or {}).get("division_id") or "", []).append({
            "tournament_id": staffel["id"], "title": staffel.get("title"), "staffel": (staffel.get("league_context") or {}).get("staffel"),
            "closed": is_closed(staffel), "version": (staffel.get("final_table") or {}).get("version"),
            "awards": count["awards"], "teams": len(count["teams"]), "players": len(count["players"]),
            "suspended": count["suspended"],
            # Nr. 167: Teams ohne gemeldete Aufstellung - deren Spieler-Belohnung ging an den Kader zum Abschluss.
            "roster_fallback": sorted(count["fallback"])})
    basis = basis_of(season)
    return {
        "season": {"id": season["id"], "name": season.get("name"), "status": season.get("status")},
        "can_edit": can_edit, "reward_players": basis, "player_basis": PLAYER_BASIS, "kinds": KINDS,
        "items": [public_item(item, basis) for item in season.get("rewards") or []],
        "divisions": [{
            "id": division["id"], "level": division.get("level"), "label": division_label(division),
            "own": isinstance(division.get("rewards"), list),
            "items": [public_item(item, basis) for item in effective(season, division)],
            "staffeln": sorted(by_division.get(division["id"], []), key=lambda row: str(row.get("staffel") or "")),
        } for division in divisions],
    }


async def save(db, season: dict, body: dict, actor: dict) -> dict:
    """Speichert die Zusammenstellung (Zuständigkeit „Season konfigurieren“, prüft die Route). Bilder müssen aus der Mediathek sein."""
    from services import league_look

    divisions = await db.league_divisions.find({"season_id": season["id"]}, {"_id": 0}).to_list(50)
    known = known_ids(season, divisions)
    now = now_utc().isoformat()
    season_update: dict = {}
    if "reward_players" in body:
        season_update["reward_players"] = clean_basis(body.get("reward_players"))
    if "items" in body:
        season_update["rewards"] = clean_items(body.get("items"), known)
    division_updates: dict[str, list[dict] | None] = {}
    by_id = {row["id"]: row for row in divisions}
    for division_id, rows in (body.get("divisions") or {}).items():
        if division_id not in by_id:
            raise RewardProblem("Diese Liga N gehört nicht zur Season.", 404)
        division_updates[division_id] = None if rows is None else clean_items(rows, known)
    images = [row.get("image_url") for row in season_update.get("rewards") or []]
    images += [row.get("image_url") for rows in division_updates.values() for row in rows or []]
    try:
        await league_look.check_uploaded(db, {league_look.PRIZES: [{"image_url": url} for url in images if url]})
    except league_look.LookProblem as problem:
        raise RewardProblem(problem.message) from None
    if season_update:
        await db.league_seasons.update_one({"id": season["id"]}, {"$set": {**season_update, "updated_at": now}})
    for division_id, rows in division_updates.items():
        await db.league_divisions.update_one({"id": division_id}, {"$set": {"rewards": rows, "updated_at": now}})
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "league.rewards.save", "actor_id": actor.get("id"), "target_id": season["id"],
        "data": {"items": len(season_update.get("rewards") or []) if "rewards" in season_update else None,
                 "reward_players": season_update.get("reward_players"),
                 "divisions": {key: (None if value is None else len(value)) for key, value in division_updates.items()}},
        "created_at": now})
    return await db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})


# ---------------------------------------------------------------- Vergabe

def _fielded(matches: list[dict], registration_id: str) -> set[str]:
    """Wer für diese Anmeldung in einem gespielten Spiel aufgestellt war (wie ``league_games.participants``, nur eine Seite) - kampflose
    Spiele zählen nicht (Nr. 168)."""
    from services.league_games import with_series

    people: set[str] = set()
    for match in matches:
        if str(match.get("status") or "") not in PLAYED_STATUSES:
            continue
        for game in with_series(match.get("games"), match.get("lineups")):
            people.update((game.get("lineups") or {}).get(registration_id) or [])
    return {person for person in people if person}


def _played(matches: list[dict], registration_id: str) -> bool:
    """Hat diese Anmeldung mindestens ein Spiel tatsächlich gespielt (nicht kampflos, Nr. 168)?"""
    return any(str(match.get("status") or "") in PLAYED_STATUSES
               and registration_id in {slot.get("registration_id") for slot in match.get("slots") or [] if isinstance(slot, dict)}
               for match in matches)


def players_for(registration: dict, team: dict | None, matches: list[dict], basis: str) -> tuple[list[str], bool]:
    """Die Spieler einer Anmeldung, die eine Spieler-Belohnung bekommen (Nr. 163, 167, 168) - und ob statt des Einsatzes der Kader
    gilt. Team: wer in einem gespielten Spiel aufgestellt war; fehlen alle Aufstellungen (oder gab es nur kampflose Spiele), der Kader
    zum Abschluss wie beim Meister-Eintrag (Nr. 167). Einzel: die angemeldete Person, wenn sie gespielt hat - mit „ganzer Kader“ immer."""
    from services.match_audience import roster_ids

    if not registration.get("team_id"):
        person = registration.get("user_id")
        if not person:
            return [], False
        return ([person] if basis == "roster" or _played(matches, registration["id"]) else []), False
    if basis == "roster":
        return sorted(roster_ids(registration, team)), False
    fielded = _fielded(matches, registration["id"])
    if fielded:
        return sorted(fielded), False
    return sorted(roster_ids(registration, team)), True


def _art(frame: dict, item: dict, rank) -> dict:
    """Beschriftung der Lionsquad-Vorlage (Nr. 164): Season, Liga N und Platz."""
    places = item.get("places") or {}
    place = f"{rank}. Platz" if places.get("mode") != "all" and isinstance(rank, int) else place_label(places)
    return {"league": frame["league"].get("name"), "season": frame["season"].get("name"), "division": frame.get("division_label"),
            "place": place, "metal": metal_of(places, rank)}


def _snapshot(item: dict, frame: dict, rank, basis: str) -> dict:
    return {"id": item["id"], "kind": item.get("kind"), "name": item.get("name"), "description": item.get("description") or "",
            "places": item.get("places") or {}, "place_label": place_label(item.get("places")), "image_url": item.get("image_url"),
            "prize": item.get("prize"), "recipients": list(item.get("recipients") or []),
            "recipients_label": recipients_label(item.get("recipients"), basis), "art": _art(frame, item, rank)}


def _holdings(docs: list[dict]) -> dict[str, set[str]]:
    """Wer welche Belohnung persönlich hält - je Person (Spieler bzw. die Person einer Einzel-Liga) die Kennungen der Belohnungen. Captain
    und Vertreter zählen hier nicht: Sie halten die Team-Belohnung nicht selbst, ein Wechsel ist kein Gewinn oder Verlust."""
    out: dict[str, set[str]] = {}
    for doc in docs:
        item_id = (doc.get("reward") or {}).get("id")
        for person in {*(doc.get("player_ids") or []), *([doc["user_id"]] if doc.get("user_id") else [])}:
            out.setdefault(person, set()).add(f"{item_id}")
    return out


def _team_holdings(docs: list[dict]) -> dict[str, set[str]]:
    """Was jedes Team hält (Team-Belohnungen) - je Team die Kennungen der Belohnungen."""
    out: dict[str, set[str]] = {}
    for doc in docs:
        if doc.get("team_id"):
            out.setdefault(doc["team_id"], set()).add(f"{(doc.get('reward') or {}).get('id')}")
    return out


def _changes(old: dict[str, set[str]], new: dict[str, set[str]], names: dict) -> tuple[dict, dict]:
    gains = {key: sorted(names.get(item, "Belohnung") for item in new.get(key, set()) - old.get(key, set()))
             for key in new if new.get(key, set()) - old.get(key, set())}
    losses = {key: sorted(names.get(item, "Belohnung") for item in old.get(key, set()) - new.get(key, set()))
              for key in old if old.get(key, set()) - new.get(key, set())}
    return gains, losses


async def grant(db, tournament: dict, final: dict, frame: dict) -> dict:
    """Teilt die Belohnungen nach dem Endstand zu (Nr. 165, 166). Gleiches bleibt derselbe Eintrag, Neues kommt dazu, Weggefallenes
    verschwindet. Gibt zurück, wer etwas gewonnen bzw. verloren hat (für die Nachricht)."""
    from services.competition_standings import registration_match_summary
    from services.match_audience import responsible_ids, teams_by_id

    tid = tournament["id"]
    season = frame["season"]
    items = effective(season, frame["division"])
    basis = basis_of(season)
    before = await db.tournament_awards.find({"tournament_id": tid, "reward_key": {"$type": "string"}}, {"_id": 0}).to_list(5000)
    if not items and not before:
        return {"granted": 0, "gains": {}, "losses": {}}
    rows = [row for row in final.get("rows") or [] if row.get("registration_id")]
    ids = [row["registration_id"] for row in rows]
    registrations = {row["id"]: row for row in await db.tournament_registrations.find(
        {"tournament_id": tid, "id": {"$in": ids}}, {"_id": 0}).to_list(REGISTRATION_LIMIT)}
    teams = await teams_by_id(db, list(registrations.values()))
    matches = await db.matches_v2.find({"tournament_id": tid, "is_preview": {"$ne": True}}, {"_id": 0}).to_list(2000)
    game = await db.games.find_one({"id": tournament.get("game_id")}, {"_id": 0, "id": 1, "name": 1, "logo_url": 1, "cover_url": 1}) \
        if tournament.get("game_id") else None
    league = frame["league"]
    title = " · ".join(part for part in (league.get("name"), season.get("name")) if part) or tournament.get("title")
    after: list[dict] = []
    wanted_prizes: list[dict] = []
    for row in rows:
        registration = registrations.get(row["registration_id"])
        if not registration:
            continue
        exited = bool(row.get("exit"))
        rank = row.get("rank") if isinstance(row.get("rank"), int) else None
        fitting = [item for item in items if fits(item.get("places"), rank, exited=exited)]
        if not fitting:
            continue
        team = teams.get(registration.get("team_id") or "") or None
        summary = registration_match_summary(matches, {registration["id"]})
        players, roster_fallback = players_for(registration, team, matches, basis)
        responsible = sorted(responsible_ids(registration, team)) if registration.get("team_id") else []
        solo = not registration.get("team_id")
        for item in fitting:
            recipients = item.get("recipients") or []
            to_team = "team" in recipients and not solo
            to_players = "players" in recipients
            player_ids = players if to_players and not solo else []
            # Einzel-Liga: Die Person ist zugleich „Team“ - eine Spieler-Belohnung bekommt sie aber nur mit Einsatz (bzw. „ganzer Kader“).
            person = registration.get("user_id") if solo and ("team" in recipients or (to_players and players)) else None
            if not (to_team or player_ids or person):
                continue  # niemand bekommt sie - kein Eintrag ohne Empfänger
            audience = sorted(set(player_ids) | (set(responsible) if to_team else set()) | ({person} if person else set()))
            reward_key = f"{item['id']}:{registration['id']}"
            doc = {
                "tournament_id": tid, "registration_id": registration["id"], "reward_key": reward_key,
                "user_id": person,
                "team_id": registration.get("team_id") if to_team else None,
                # Nr. 167: keine Aufstellung gemeldet - die Spieler-Belohnung ging an den Kader zum Abschluss.
                "roster_fallback": bool(roster_fallback and player_ids),
                "rank": rank, "kind": "reward", "participants": int(final.get("participants") or 0),
                "finalist": False, "final_match_id": None,
                "matches": {"played": summary["matches_played"], "won": summary["matches_won"]},
                "tournament": {**{key: tournament.get(key) for key in ("id", "slug", "start_date", "visibility", "is_public")},
                               "title": title, "status": "completed"},
                "game": game, "season": {"id": season.get("id"), "name": season.get("name") or "Season"} if season.get("id") else None,
                "team": ({"id": team["id"], "name": team.get("name"), "tag": team.get("tag"), "logo_url": team.get("logo_url")}
                         if team else None),
                "league": {"title": item.get("name"), "league_id": league.get("id"), "season_id": season.get("id"),
                           "division_label": frame.get("division_label"), "staffel": (tournament.get("league_context") or {}).get("staffel"),
                           "display_name": row.get("display_name"), "final_table_id": final["id"], "version": final["version"]},
                "reward": _snapshot(item, frame, rank, basis),
                "player_ids": player_ids, "audience_ids": audience, "suspended": False,
            }
            after.append(doc)
            if item.get("prize"):
                wanted_prizes.append({"reward_key": reward_key, "place": rank or 0, "team_id": registration.get("team_id"),
                                      "user_id": person,
                                      "label": item.get("name"), "value": item.get("prize"), "place_label": _art(frame, item, rank)["place"]})
    result = await store(db, tournament, before, after, wanted_prizes)
    # Wer eine Team-Belohnung erfährt: Captain und Vertreter von heute (bzw. die Teamleitung) - für das Team, nicht für sich.
    leads = {}
    for registration in registrations.values():
        if registration.get("team_id") in {*result["team_gains"], *result["team_losses"]}:
            leads.setdefault(registration["team_id"], set()).update(responsible_ids(registration, teams.get(registration["team_id"]) or None))
    return {**result, "team_leads": {key: sorted(value) for key, value in leads.items()},
            "team_names": {key: (teams.get(key) or {}).get("name") or "Euer Team" for key in leads}}


async def store(db, scope: dict, before: list[dict], after: list[dict], wanted_prizes: list[dict]) -> dict:
    """Schreibt die Einträge eines Bereichs (``scope["id"]``: die Staffel, in F.5 die Gesamtwertung ``overall:<zeitraum>:<n>``):
    Gleiches bleibt derselbe Eintrag (samt ``seen_by``), Neues kommt dazu, Weggefallenes verschwindet, echte Gewinne über
    ``prize_service``. Gibt zurück, wer persönlich bzw. als Team etwas gewonnen oder verloren hat."""
    tid = scope["id"]
    now = now_utc().isoformat()
    kept: list[str] = []
    for doc in after:
        doc.update({"tournament_id": tid, "updated_at": now})
        reward_key = doc["reward_key"]
        try:
            await db.tournament_awards.update_one({"tournament_id": tid, "reward_key": reward_key},
                                                  {"$set": doc, "$setOnInsert": {"id": new_id(), "created_at": now, "seen_by": []}},
                                                  upsert=True)
        except DuplicateKeyError:
            # Zwei Schreiber zugleich (eindeutiger Teilindex): der zweite schreibt in den Eintrag des ersten.
            await db.tournament_awards.update_one({"tournament_id": tid, "reward_key": reward_key}, {"$set": doc})
        kept.append(reward_key)
    await db.tournament_awards.delete_many({"tournament_id": tid, "reward_key": {"$type": "string", "$nin": kept}})
    if wanted_prizes or before:
        from services.prize_service import sync_league_reward_prizes

        await sync_league_reward_prizes(db, scope, wanted_prizes)
    names = {doc["reward"]["id"]: doc["reward"]["name"] for doc in [*before, *after] if doc.get("reward")}
    gains, losses = _changes(_holdings(before), _holdings(after), names)
    team_gains, team_losses = _changes(_team_holdings(before), _team_holdings(after), names)
    return {"granted": len(kept), "gains": gains, "losses": losses, "team_gains": team_gains, "team_losses": team_losses}


async def notify(db, tournament: dict, final: dict, frame: dict, result: dict, *, url: str | None = None) -> int:
    """Nachricht an jede Person, die eine Belohnung neu bekommt oder verliert (Nr. 166) - je Fassung, Richtung und Person einmal.
    ``tournament``: die Staffel bzw. der Bereich der Gesamtwertung (F.5, ``id`` und ``title``); ``url``: wohin die Nachricht führt."""
    from services.user_notifications import create_user_notification

    league, season = frame["league"], frame["season"]
    url = url or (f"/liga/{league.get('slug')}/{season.get('slug')}" if league.get("slug") and season.get("slug")
                  else f"/tournaments/{tournament.get('slug') or tournament['id']}")
    name = tournament.get("title") or "Die Staffel"
    sent = 0
    for event, people in (("gain", result.get("gains") or {}), ("loss", result.get("losses") or {})):
        for user_id in sorted(people):
            rewards = ", ".join(people[user_id])
            if event == "gain":
                title, text = "Neue Belohnung", f"{name}: {rewards}. Sie steht ab jetzt in deiner Sammlung."
            else:
                title, text = "Belohnung entfällt", (f"{name}: Nach dem neuen Endstand entfällt {rewards}. Die Liga-Leitung hat den Abschluss "
                                                       "korrigiert.")
            sent += await _send(create_user_notification, user_id, title, text, url, tournament,
                                f"league-reward:{final['id']}:{event}:{user_id}")
    # Team-Belohnungen (Nr. 166): eigene Nachricht an Captain und Vertreter, je Fassung, Team, Richtung und Person einmal.
    for event, teams in (("team-gain", result.get("team_gains") or {}), ("team-loss", result.get("team_losses") or {})):
        for team_id in sorted(teams):
            rewards = ", ".join(teams[team_id])
            team_name = (result.get("team_names") or {}).get(team_id) or "Euer Team"
            if event == "team-gain":
                title, text = "Belohnung für euer Team", f"{team_name} hat {rewards} bekommen ({name}) - steht in der Team-Sammlung."
            else:
                title, text = "Team-Belohnung entfällt", f"{team_name}: Nach dem neuen Endstand von {name} entfällt {rewards}."
            for user_id in (result.get("team_leads") or {}).get(team_id) or []:
                sent += await _send(create_user_notification, user_id, title, text, url, tournament,
                                    f"league-reward:{final['id']}:{event}:{team_id}:{user_id}")
    return sent


async def _send(create, user_id: str, title: str, text: str, url: str, tournament: dict, dedupe_key: str) -> int:
    try:
        done = await create(user_id, title, text, url=url, kind=NOTIFICATION_KIND,
                            meta={"reason": "league_reward", "tournament_id": tournament["id"], "dedupe_key": dedupe_key})
        return 1 if done else 0
    except Exception:  # noqa: BLE001 - die Vergabe steht, die Nachricht hält sie nicht auf
        logger.warning("[league_rewards] Nachricht für Staffel %s nicht verschickt", log_safe(tournament.get("id")), exc_info=True)
        return 0


async def grant_and_notify(db, tournament: dict, final: dict, frame: dict) -> dict:
    result = await grant(db, tournament, final, frame)
    changed = any(result.get(key) for key in ("gains", "losses", "team_gains", "team_losses"))
    result["sent"] = await notify(db, tournament, final, frame, result) if changed else 0
    return result


# ---------------------------------------------------------------- Lesen

def holder_view(doc: dict) -> dict:
    return {"registration_id": doc.get("registration_id"), "display_name": (doc.get("league") or {}).get("display_name"),
            "rank": doc.get("rank"), "team_id": (doc.get("team") or {}).get("id")}


async def staffel_view(db, tournament: dict, season: dict | None, division: dict | None, *, granted: bool) -> dict | None:
    """Belohnungen einer Staffel für die Ligaseite: vor dem Abschluss die Zusammenstellung, danach mit Inhabern aus den Einträgen."""
    items = effective(season, division)
    basis = basis_of(season)
    docs = await db.tournament_awards.find({"tournament_id": tournament["id"], "reward_key": {"$type": "string"},
                                            "suspended": {"$ne": True}}, {"_id": 0}).to_list(5000) if granted else []
    if not items and not docs:
        return None
    by_item: dict[str, list[dict]] = {}
    snapshots: dict[str, dict] = {}
    for doc in docs:
        item_id = (doc.get("reward") or {}).get("id")
        by_item.setdefault(item_id, []).append(holder_view(doc))
        snapshots.setdefault(item_id, doc["reward"])
    out = []
    if granted:
        for item_id, snapshot in snapshots.items():
            holders = sorted(by_item[item_id], key=lambda row: (row.get("rank") or 999, str(row.get("display_name") or "")))
            out.append({**public_item(snapshot, basis), "holders": holders})
    else:
        out = [{**public_item(item, basis), "holders": []} for item in items]
    out.sort(key=lambda row: _order(row.get("places")))
    return {"granted": granted, "items": out}


async def pdf_rows(db, tournament: dict) -> list[list[str]]:
    """Für das Ergebnis-PDF einer abgeschlossenen Staffel: je Belohnung Platz, Name, Art und wer sie bekommen hat."""
    from services.league_final_read import active_final

    if not (tournament or {}).get("league_context") or not await active_final(db, tournament["id"]):
        return []
    context = tournament["league_context"]
    season = await db.league_seasons.find_one({"id": context.get("season_id")}, {"_id": 0}) or {}
    division = await db.league_divisions.find_one({"id": context.get("division_id")}, {"_id": 0}) or {}
    view = await staffel_view(db, tournament, season, division, granted=True)
    rows = []
    for item in (view or {}).get("items") or []:
        holders = ", ".join(str(row.get("display_name") or "Team") for row in item.get("holders") or [])
        rows.append([item["place_label"], item.get("name") or "", item.get("kind_label") or "", holders or "-"])
    return rows


async def unseen_for(db, user_id: str) -> list[dict]:
    """Was die Person noch nicht gefeiert hat (Zeremonie, Nr. 165) - nur geltende Einträge."""
    from services.awards import award_view

    docs = await db.tournament_awards.find({"audience_ids": user_id, "reward_key": {"$type": "string"}, "suspended": {"$ne": True},
                                            "seen_by": {"$ne": user_id}}, {"_id": 0}).sort("updated_at", -1).to_list(20)
    return [award_view(doc) for doc in docs]


async def mark_seen(db, user_id: str, ids: list[str]) -> int:
    ids = [str(value) for value in ids or [] if value][:50]
    if not ids:
        return 0
    result = await db.tournament_awards.update_many({"id": {"$in": ids}, "audience_ids": user_id}, {"$addToSet": {"seen_by": user_id}})
    return int(result.modified_count or 0)
