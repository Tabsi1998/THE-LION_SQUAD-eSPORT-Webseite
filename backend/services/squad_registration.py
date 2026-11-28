"""Co-Teams einer Liga-Staffel zuteilen (docs/LIGA.md, Abschnitte 2 und 5; #1649, Teil von #1623).

Teilnehmer einer Team-Liga ist das **Co-Team** (``team_squads``) eines Vereinsteams. Die Turnierleitung teilt es von
Hand zu; daraus entsteht eine gewöhnliche Team-Anmeldung mit zwei Zusatzfeldern:

- ``team_id`` = Hauptteam, ``squad_id`` = Co-Team, ``squad_name`` = Schnappschuss des Co-Team-Namens,
- ``display_name`` = „Lions · Lions B“, ``registered_via="league_assign"``, ``status="approved"``,
- ``identity_key = "<tid>:team:<team_id>"`` wie bei jeder Team-Anmeldung - so hält der vorhandene eindeutige Index
  „zwei Co-Teams desselben Hauptteams nie in derselben Staffel“.

Wer im Spiel handelt (Captain, Vertreter, sonst die Hauptteam-Leitung), regelt ``services.match_audience``.
Alle Prüfungen stehen hier an einer Stelle: das Zuteilen nutzt sie, der Dialog zeigt sie vorab je Co-Team.
"""

from __future__ import annotations

from pymongo.errors import DuplicateKeyError

from models import REGISTRATION_LIMIT, new_id, now_utc
from services import league_eligibility, league_participants, league_roster
from services.discord_roles import load_games, top_game
from services.league_roster import active_league_registrations, min_squad_size
from services.mutation_lock import league_season_resource

ACTIVE_REGISTRATION_STATUSES = ("pending", "approved", "checked_in", "waitlist")
# Plätze einer Staffel belegen wie beim Nachrücken (#1551) nur diese - die Warteliste zählt nicht mit.
SEAT_STATUSES = ("pending", "approved", "checked_in")
FINISHED_TOURNAMENT_STATUSES = {"completed", "results_published", "archived", "cancelled"}
NAME_SEPARATOR = " · "
STATUS_LABELS = {
    "withdrawn": "ausgetreten",
    "disqualified": "disqualifiziert",
    "rejected": "abgelehnt",
    "no_show": "nicht erschienen",
}


def league_squad_key(tournament: dict, squad_id: str) -> str | None:
    """``<season_id>:<squad_id>`` - ein eindeutiger Index hält „ein Co-Team je Season nur in einer Staffel“ auch bei
    gleichzeitigem Zuteilen. Ohne Liga-Rahmen (``league_context``) gibt es keinen Schlüssel - und keinen in einer Playoff- oder
    Relegations-Staffel (#2404, H1): Dort spielt das Co-Team zusätzlich zu seiner regulären Staffel."""
    context = tournament.get("league_context") or {}
    season_id = context.get("season_id")
    return f"{season_id}:{squad_id}" if season_id and squad_id and not context.get("kind") else None


def season_entry(registration: dict | None, tournament: dict | None) -> str | None:
    """Wer in der Season antritt (#1629): das Co-Team (``squad_id``) - in einer Solo-Staffel die Person (``user:<id>``). Damit hält derselbe
    Season-Schlüssel ``league_squad_key`` auch „eine Person je Season nur in einer Staffel“. Alle anderen Anmeldungen: ``None``."""
    registration = registration or {}
    if registration.get("squad_id"):
        return registration["squad_id"]
    if league_participants.is_solo_staffel(tournament):
        return league_participants.person_entry(registration.get("user_id"))
    return None


def season_lock_resource(tournament: dict) -> str | None:
    season_id = (tournament.get("league_context") or {}).get("season_id")
    return league_season_resource(season_id) if season_id else None


SEASON_TAKEN = "Dieses Co-Team spielt in dieser Season schon in einer anderen Staffel."
PERSON_SEASON_TAKEN = "Diese Person spielt in dieser Season schon in einer anderen Staffel."
POSTSEASON_ASSIGN = ("In Playoffs und Relegation kommen die Teams aus dem Endstand. Zuteilen geht hier nicht - im Reiter „Abschluss“ der "
                     "Season steht die Setzliste, dort lässt sie sich vor dem ersten Spiel neu berechnen.")


async def sync_season_key(db, registration: dict | None, new_status: str | None, tournament: dict | None) -> None:
    """``league_squad_key`` folgt dem Status einer Co-Team-Anmeldung: nicht aktiv (abgelehnt, nicht erschienen,
    ausgetreten …) → Schlüssel weg, das Co-Team ist in der Season wieder frei; wieder aktiv → Schlüssel neu setzen,
    außer das Co-Team spielt inzwischen in einer anderen Staffel (``SquadAssignError`` 409 - deshalb vor dem
    Statuswechsel aufrufen). Anmeldungen ohne Co-Team oder ohne Liga-Rahmen bleiben unberührt. Aufrufer halten die
    Season-Sperre (``season_lock_resource``). In einer Solo-Staffel (#1629) gilt dasselbe für die Person."""
    entry = season_entry(registration, tournament)
    if not entry or not registration.get("id"):
        return
    key = league_squad_key(tournament or {}, entry)
    if not key:
        return
    if new_status not in ACTIVE_REGISTRATION_STATUSES:
        await db.tournament_registrations.update_one({"id": registration["id"]}, {"$unset": {"league_squad_key": ""}})
        return
    taken = PERSON_SEASON_TAKEN if entry.startswith("user:") else SEASON_TAKEN
    if await db.tournament_registrations.find_one(
        {"league_squad_key": key, "id": {"$ne": registration["id"]}}, {"_id": 0, "id": 1}
    ):
        raise SquadAssignError(409, taken)
    try:
        await db.tournament_registrations.update_one({"id": registration["id"]}, {"$set": {"league_squad_key": key}})
    except DuplicateKeyError:
        raise SquadAssignError(409, taken)


class SquadAssignError(Exception):
    """Eine Prüfung schlägt fehl - mit Statuscode und deutschem Satz für die Turnierleitung."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def is_league_tournament(tournament: dict | None) -> bool:
    """Co-Teams teilt die Leitung Team-Turnieren im Format Liga zu - mit oder ohne Liga-Rahmen (``league_context``)."""
    if not tournament or (tournament.get("team_mode") or "solo") == "solo":
        return False
    return tournament.get("format") == "league" or bool(tournament.get("league_context"))


def display_name(team: dict, squad: dict) -> str:
    """„Lions · Lions B“ - Hauptteam und Co-Team, so wie die Anmeldung überall erscheint."""
    team_name = str(team.get("name") or team.get("tag") or "Team").strip()
    squad_name = str(squad.get("name") or "").strip()
    if not squad_name or squad_name == team_name:
        return team_name
    return f"{team_name}{NAME_SEPARATOR}{squad_name}"


def _positive_int(value) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 1 else None


def _team_member_ids(team: dict, memberships: list[dict] | None = None) -> set[str]:
    ids = {uid for uid in team.get("member_ids") or [] if uid}
    ids.update(row.get("user_id") for row in memberships or [] if row.get("user_id"))
    return ids


def squad_problems(
    team: dict,
    squad: dict,
    tournament: dict,
    *,
    min_size: int,
    team_member_ids: set[str],
    taken_teams: dict[str, str | None],
    seats_taken: int,
    other_staffel_squad_ids: set[str],
    games: dict[str, dict] | None = None,
    parents: dict[str, str | None] | None = None,
    siblings: bool = False,
) -> list[tuple[int, str]]:
    """Alle Gründe, warum dieses Co-Team nicht in die Staffel kann - leer heißt: zuteilbar.

    Reihenfolge = Reihenfolge der Meldung beim Zuteilen (der erste Grund wird zur Antwort). ``siblings``: Die Season erlaubt
    zwei Co-Teams eines Hauptteams in derselben Staffel, ``taken_teams`` zählt dann je Co-Team (``_staffel_state``)."""
    problems: list[tuple[int, str]] = []
    name = squad.get("name") or "Das Co-Team"
    if squad.get("team_id") != team.get("id"):
        problems.append((400, f"{name} gehört nicht zu diesem Team."))
    if (squad.get("status") or "active") != "active":
        problems.append((400, f"{name} ist archiviert – nur aktive Co-Teams spielen in der Liga."))
    if tournament.get("game_id") and squad.get("game_id") and squad["game_id"] != tournament["game_id"]:
        if games is not None and squad["game_id"] not in games:
            # Alter Freitext (#2128): keine Kennung, also auch nicht „ein anderes Spiel“ - der Satz sagt, was zu tun ist.
            problems.append((400, f"{name} hat noch einen alten Spielnamen („{squad['game_id']}“) – unter Teams → Deine Teams aus der Liste wählen."))
        elif top_game(squad["game_id"], parents or {}) != top_game(tournament["game_id"], parents or {}):
            # Hauptspiel und Versionen gehören zusammen (docs/LIGA.md, Abschnitt Liga-Kader) - wie bei den Spiel-Rollen.
            own = (games or {}).get(squad["game_id"], {}).get("name")
            wanted = (games or {}).get(tournament["game_id"], {}).get("name")
            problems.append((400, f"{name} ist für ein anderes Spiel eingetragen ({own}) – diese Staffel spielt {wanted}." if own and wanted
                             else f"{name} ist für ein anderes Spiel eingetragen als diese Staffel."))
    members = [uid for uid in squad.get("member_ids") or [] if uid]
    if len(members) < min_size:
        problems.append((400, f"{name} hat {len(members)} Spieler im Kader – die Liga verlangt mindestens {min_size}."))
    outsiders = [uid for uid in members if uid not in team_member_ids]
    if outsiders:
        count = len(outsiders)
        problems.append(
            (
                400,
                f"{count} {'Person' if count == 1 else 'Personen'} im Kader von {name} "
                f"{'ist' if count == 1 else 'sind'} nicht mehr im Team – bitte erst den Kader bereinigen.",
            )
        )
    if squad.get("id") in other_staffel_squad_ids:
        problems.append((409, f"{name} spielt in dieser Season schon in einer anderen Staffel."))
    if siblings and squad.get("id") in taken_teams:
        problems.append((409, f"{name} stand schon in dieser Staffel – ein Co-Team tritt je Staffel nur einmal an."))
    if not siblings and team.get("id") in taken_teams:
        status = taken_teams[team["id"]]
        team_name = team.get("name") or "Dieses Team"
        if status in ACTIVE_REGISTRATION_STATUSES:
            text = (
                f"{team_name} hat schon ein Co-Team in dieser Staffel – "
                "zwei Co-Teams desselben Teams spielen nie in derselben Staffel."
            )
        else:
            text = (
                f"{team_name} stand schon in dieser Staffel ({STATUS_LABELS.get(status, status or 'ohne Status')}) – "
                "ein Team tritt je Staffel nur einmal an."
            )
        problems.append((409, text))
    limit = _positive_int(tournament.get("max_participants"))
    if limit and seats_taken >= limit:
        problems.append((409, f"Die Staffel ist voll ({seats_taken} von {limit} Plätzen)."))
    return problems


async def siblings_allowed(db, tournament: dict) -> bool:
    """Erlaubt die Season zwei Co-Teams eines Hauptteams in derselben Staffel (#2205)? Ohne Feld und ohne Liga-Rahmen: nein."""
    season_id = (tournament.get("league_context") or {}).get("season_id")
    if not season_id:
        return False
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0, "sibling_squads_in_staffel": 1})
    return bool((season or {}).get("sibling_squads_in_staffel"))


async def _staffel_state(db, tournament: dict) -> tuple[dict[str, str | None], int, set[str]]:
    """Welche Hauptteams schon in der Staffel stehen (mit Status - jede Anmeldung eines Teams belegt den
    ``identity_key``, auch eine ausgetretene), wie viele Plätze belegt sind und welche Co-Teams in einer anderen
    Staffel derselben Season stehen. Erlaubt die Season zwei Co-Teams eines Hauptteams, zählt der ``identity_key`` je
    Co-Team, also auch die erste Liste."""
    tid = tournament["id"]
    siblings = await siblings_allowed(db, tournament)
    regs = await db.tournament_registrations.find(
        {"tournament_id": tid},
        {"_id": 0, "team_id": 1, "squad_id": 1, "status": 1},
    ).to_list(REGISTRATION_LIMIT)
    taken_teams: dict[str, str | None] = {}
    for reg in regs:
        key = reg.get("squad_id") if siblings else reg.get("team_id")
        if key and taken_teams.get(key) not in ACTIVE_REGISTRATION_STATUSES:
            taken_teams[key] = reg.get("status")
    seats = len([reg for reg in regs if reg.get("status") in SEAT_STATUSES])
    other: set[str] = set()
    season_id = (tournament.get("league_context") or {}).get("season_id")
    if season_id:
        other = await _squads_in_staffeln(db, season_id, except_tournament=tid)
    return taken_teams, seats, other


async def _squads_in_staffeln(db, season_id: str, *, except_tournament: str | None = None) -> set[str]:
    """Die Co-Teams, die in **regulären** Staffeln dieser Season stehen - aktiv oder noch mit Season-Schlüssel. Playoffs und Relegation
    (#2404) zählen nicht: Wer dort spielt, ist deshalb nicht „schon in einer anderen Staffel“."""
    query: dict = {"league_context.season_id": season_id, "league_context.kind": None}
    if except_tournament:
        query["id"] = {"$ne": except_tournament}
    staffel_ids = [row["id"] for row in await db.tournaments.find(query, {"_id": 0, "id": 1}).to_list(200) if row.get("id")]
    if not staffel_ids:
        return set()
    return {
        row["squad_id"]
        for row in await db.tournament_registrations.find(
            {
                "tournament_id": {"$in": staffel_ids},
                "squad_id": {"$exists": True},
                "$or": [
                    {"status": {"$in": list(ACTIVE_REGISTRATION_STATUSES)}},
                    {"league_squad_key": {"$exists": True}},
                ],
            },
            {"_id": 0, "squad_id": 1},
        ).to_list(2000)
        if row.get("squad_id")
    }


async def season_problems(db, season: dict, game_id: str | None, team: dict, squad: dict, *, min_size: int, seated: bool = False) -> list[tuple[int, str]]:
    """Dieselbe Prüfung wie beim Zuteilen, nur ohne Staffel (#2205): Die Anmeldung gilt der Season, die Staffel steht erst nach der
    Genehmigung fest. Staffelgröße und „schon in der Staffel“ prüft das Zuteilen. ``seated``: Die Anmeldung gehört zum Antrag selbst und zählt nicht dagegen."""
    memberships = await db.team_members.find({"team_id": team.get("id")}, {"_id": 0, "user_id": 1}).to_list(500)
    games, parents = await load_games(db)
    frame = {"id": None, "game_id": game_id, "team_mode": "team", "format": "league"}
    return squad_problems(
        team,
        squad,
        frame,
        min_size=min_size,
        team_member_ids=_team_member_ids(team, memberships),
        taken_teams={},
        seats_taken=0,
        other_staffel_squad_ids=set() if seated else await _squads_in_staffeln(db, season["id"]),
        games=games,
        parents=parents,
    )


def _public_user(user: dict | None) -> dict | None:
    if not user:
        return None
    return {"id": user.get("id"), "username": user.get("username"), "display_name": user.get("display_name")}


async def candidates(db, tournament: dict) -> dict:
    """Für den Dialog „Co-Team zuteilen“: je Hauptteam die aktiven Co-Teams mit Kader, Captain, Vertreter und den
    Gründen, warum eines (noch) nicht geht."""
    min_size = min_squad_size(tournament)
    siblings = await siblings_allowed(db, tournament)
    taken_teams, seats, other = await _staffel_state(db, tournament)
    squads = await db.team_squads.find({"status": {"$ne": "archived"}}, {"_id": 0}).to_list(1000)
    team_ids = sorted({squad.get("team_id") for squad in squads if squad.get("team_id")})
    teams = {
        row["id"]: row
        for row in await db.teams.find(
            {"id": {"$in": team_ids}},
            {"_id": 0, "id": 1, "name": 1, "tag": 1, "logo_url": 1, "member_ids": 1},
        ).to_list(len(team_ids) + 10)
        if row.get("id")
    }
    memberships: dict[str, list[dict]] = {}
    for row in await db.team_members.find(
        {"team_id": {"$in": team_ids}}, {"_id": 0, "team_id": 1, "user_id": 1}
    ).to_list(5000):
        memberships.setdefault(row.get("team_id"), []).append(row)
    role_ids = sorted(
        {uid for squad in squads for uid in (squad.get("captain_id"), squad.get("vice_captain_id")) if uid}
    )
    people = (
        {
            row["id"]: row
            for row in await db.users.find(
                {"id": {"$in": role_ids}},
                {"_id": 0, "id": 1, "username": 1, "display_name": 1},
            ).to_list(len(role_ids) + 10)
        }
        if role_ids
        else {}
    )
    # Spiel-ID je Spieler (#2108): Stand in der Season - fehlt sie, warnt der Dialog; zuteilen geht trotzdem.
    member_ids = {uid for squad in squads if squad.get("team_id") in teams for uid in squad.get("member_ids") or [] if uid}
    roster_ctx = await league_roster.context_for_tournament(db, tournament, member_ids)
    # Regeln der Season (#2204): dieselbe Prüfung wie beim Zuteilen, der Dialog zeigt die Gründe vorab.
    eligibility = await league_eligibility.context_for_tournament(db, tournament, member_ids)
    games, parents = await load_games(db)
    out: dict[str, dict] = {}
    for squad in squads:
        team = teams.get(squad.get("team_id"))
        if not team:
            continue
        problems = squad_problems(
            team,
            squad,
            tournament,
            min_size=min_size,
            team_member_ids=_team_member_ids(team, memberships.get(team["id"])),
            taken_teams=taken_teams,
            seats_taken=seats,
            other_staffel_squad_ids=other,
            games=games,
            parents=parents,
            siblings=siblings,
        ) + league_eligibility.registration_problems(eligibility, squad)
        entry = out.setdefault(
            team["id"],
            {
                "id": team["id"],
                "name": team.get("name"),
                "tag": team.get("tag"),
                "logo_url": team.get("logo_url"),
                "in_staffel": False,
                "squads": [],
            },
        )
        entry["in_staffel"] = entry["in_staffel"] or (squad.get("id") if siblings else team["id"]) in taken_teams
        entry["squads"].append(
            {
                "id": squad.get("id"),
                "name": squad.get("name"),
                "display_name": display_name(team, squad),
                "member_count": len([uid for uid in squad.get("member_ids") or [] if uid]),
                "game_id": squad.get("game_id"),
                "captain": _public_user(people.get(squad.get("captain_id") or "")),
                "vice_captain": _public_user(people.get(squad.get("vice_captain_id") or "")),
                "problems": [text for _code, text in problems],
                # Alter und Plattform (#2270, #2313): wer so noch nicht spielen darf, ohne das Zuteilen aufzuhalten - auch unter dem Mindestkader.
                "notes": league_eligibility.assign_notes(eligibility, squad),
                # Maß ist die Check-in-Mindestzahl, nicht der Mindestkader (#2322): mit 3 von 4 geht ein 4-gegen-4-Spiel.
                "shortfall": league_eligibility.open_points(eligibility, squad, minimum=league_eligibility.ready_minimum(tournament))["shortfall"],
                "players": (
                    _id_players(squad, league_roster.statuses(roster_ctx, squad.get("member_ids"), squad.get("id")))
                    if roster_ctx and roster_ctx.fields
                    else []
                ),
            }
        )
    rows = sorted(out.values(), key=lambda row: str(row.get("name") or "").lower())
    for row in rows:
        row["squads"].sort(key=lambda squad: str(squad.get("name") or "").lower())
    limit = _positive_int(tournament.get("max_participants"))
    return {
        "min_squad_size": min_size,
        "max_participants": limit,
        "seats_taken": seats,
        "teams": rows,
        "id_label": league_roster.labels(roster_ctx.fields) if roster_ctx and roster_ctx.fields else None,
    }


def _id_players(squad: dict, id_states: dict[str, dict]) -> list[dict]:
    """Je Spieler des Co-Teams: Name, Spiel-ID (festgehalten oder aus dem Profil) und ob er aufstellbar ist."""
    rows = []
    for uid in squad.get("member_ids") or []:
        state = id_states.get(uid)
        if state:
            rows.append({key: state[key] for key in ("id", "name", "state", "ok", "text", "reason")})
    return sorted(rows, key=lambda row: str(row["name"]).lower())


async def _late_mark(db, tournament: dict) -> dict | None:
    """Steht in der Staffel schon ein fester Spielplan? Dann ist die Anmeldung eine Nachmeldung (``league_late_entry``)."""
    from services import league_late_entry

    matches = await db.matches_v2.find({"tournament_id": tournament["id"], "is_preview": {"$ne": True}},
                                       {"_id": 0, "slots": 1, "round": 1, "stage_type": 1, "status": 1, "is_preview": 1}).to_list(3000)
    return league_late_entry.late_mark(tournament, matches)


async def build_registration(db, tournament: dict, team_id: str, squad_id: str, actor: dict, *, status: str = "approved",
                             consent: bool = False, via: str = "league_assign", source: str = "staff_add",
                             application_id: str | None = None, registered_by: str | None = None) -> dict:
    """Prüft das Co-Team und baut die Anmeldung - ohne zu schreiben. Wirft ``SquadAssignError``.

    Die Selbstanmeldung (#2205) sagt, woher sie kommt (``via``, ``source``, ``application_id``, ``registered_by``: wer eingereicht hat)
    und ob ausdrücklich zugestimmt wurde (``consent``). Ohne diese Angaben bleibt es das Zuteilen durch die Leitung."""
    if not is_league_tournament(tournament):
        raise SquadAssignError(400, "Co-Teams teilt die Turnierleitung nur Team-Turnieren im Format Liga zu.")
    if (tournament.get("league_context") or {}).get("kind"):
        # Playoffs und Relegation (#2404, Nr. 219): Die Teams kommen aus dem Endstand - von Hand wird hier niemand zugeteilt.
        raise SquadAssignError(409, POSTSEASON_ASSIGN)
    if tournament.get("status") in FINISHED_TOURNAMENT_STATUSES:
        raise SquadAssignError(409, "Diese Staffel ist schon beendet.")
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise SquadAssignError(404, "Team nicht gefunden.")
    squad = await db.team_squads.find_one({"id": squad_id}, {"_id": 0})
    if not squad:
        raise SquadAssignError(404, "Co-Team nicht gefunden.")
    memberships = await db.team_members.find({"team_id": team_id}, {"_id": 0, "user_id": 1}).to_list(500)
    siblings = await siblings_allowed(db, tournament)
    taken_teams, seats, other = await _staffel_state(db, tournament)
    games, parents = await load_games(db)
    problems = squad_problems(
        team,
        squad,
        tournament,
        min_size=min_squad_size(tournament),
        team_member_ids=_team_member_ids(team, memberships),
        taken_teams=taken_teams,
        seats_taken=seats,
        other_staffel_squad_ids=other,
        games=games,
        parents=parents,
        siblings=siblings,
    )
    eligibility = await league_eligibility.context_for_tournament(db, tournament, squad.get("member_ids") or [])
    problems += league_eligibility.registration_problems(eligibility, squad)
    if problems:
        code, text = problems[0]
        raise SquadAssignError(code, text)
    tid = tournament["id"]
    now_iso = now_utc().isoformat()
    name = display_name(team, squad)
    late = await _late_mark(db, tournament)
    return {
        # Nachmeldung (#2422, Nr. 183): Steht der Spielplan schon, bekommt das Team seine Spiele erst nach Vorschau und Bestätigung der Leitung.
        **({"late_entry": late} if late else {}),
        "id": new_id(),
        "tournament_id": tid,
        "user_id": None,
        "team_id": team_id,
        "squad_id": squad_id,
        "squad_name": squad.get("name"),
        "status": status,
        "display_name": name,
        "ingame_name": name,
        "player_ids": {},
        # Das Zuteilen ist keine Zustimmung (D-7, #1646): Regeln stehen in league_rule_consents, zum Datenschutz hat hier niemand
        # etwas erklärt. Wahr nur, wenn ein Antrag beide Zustimmungen trägt (#2205). An Anmeldungen liest beide Felder kein Code.
        "accepted_rules": consent,
        "accepted_privacy": consent,
        "seed": None,
        "registration_type": "team",
        "registered_via": via,
        "registered_by": registered_by or actor.get("id"),
        "source": source,
        "is_guest": False,
        "identity_key": f"{tid}:team:{team_id}:squad:{squad_id}" if siblings else f"{tid}:team:{team_id}",
        **({"league_squad_key": key} if (key := league_squad_key(tournament, squad_id)) else {}),
        **({"application_id": application_id} if application_id else {}),
        "created_by": actor.get("id"),
        "created_at": now_iso,
        "updated_at": now_iso,
    }


# ---------------------------------------------------------------- Person zuteilen (Solo-Liga, #1629 P1)
#
# In einer Solo-Staffel ist der Teilnehmer die Person selbst. Die Leitung teilt sie über denselben Weg zu wie ein Co-Team
# (``POST …/squad-registrations`` mit ``user_id``); daraus entsteht eine gewöhnliche Einzel-Anmeldung: ``user_id``, kein Team,
# ``registration_type="solo"``, ``identity_key "<tid>:user:<id>"`` wie bei jeder Einzel-Anmeldung und als Season-Schlüssel
# ``league_squad_key "<season>:user:<id>"`` - so spielt eine Person je Season nur in einer Staffel. Kein zweites System.

# Sich selbst zuteilen (#1629, wie #2245): Über die eigene Teilnahme entscheidet eine andere Person, der Superadmin nur mit Grund.
SELF_ASSIGN_DETAIL = "Dich selbst teilt eine andere Person aus der Leitung zu."
SELF_ASSIGN_SUPERADMIN = ("Dich selbst teilt eine andere Person aus der Leitung zu. Als Superadmin geht es nur als Notausnahme, mit einem Grund "
                          "von mindestens fünf Zeichen.")
PERSON_FIELDS = {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "is_banned": 1, "is_active": 1}
PERSON_SEARCH_LIMIT = 30


# Im Dialog vorab (#1629): Die eigene Zeile ist gesperrt - die Notausnahme läuft wie beim Team-Weg nur über die API mit Grund.
SELF_ASSIGN_ROW = "Dich selbst teilt nur der Superadmin mit Grund zu – über den Weg für Notausnahmen."


def person_name(person: dict | None) -> str:
    return str((person or {}).get("display_name") or (person or {}).get("username") or "Diese Person").strip()


def _seat_limit_problem(tournament: dict, seats_taken: int) -> tuple[int, str] | None:
    limit = _positive_int(tournament.get("max_participants"))
    if limit and seats_taken >= limit:
        return 409, f"Die Staffel ist voll ({seats_taken} von {limit} Plätzen)."
    return None


def person_problems(person: dict, tournament: dict, *, taken: dict[str, str | None], seats_taken: int,
                    other_staffel: set[str]) -> list[tuple[int, str]]:
    """Alle Gründe, warum diese Person nicht in die Staffel kann - leer heißt: zuteilbar. Reihenfolge = Reihenfolge der Meldung.
    ``taken``: Personen dieser Staffel mit Status (jede Anmeldung belegt den ``identity_key``, auch eine ausgetretene),
    ``other_staffel``: Personen mit Season-Schlüssel in einer anderen Staffel derselben Season."""
    name = person_name(person)
    problems: list[tuple[int, str]] = []
    if person.get("is_banned") or person.get("is_active") is False:
        problems.append((400, f"{name} ist gesperrt – ein gesperrtes Konto spielt nicht in der Liga."))
    if person.get("id") in taken:
        status = taken[person["id"]]
        if status in ACTIVE_REGISTRATION_STATUSES:
            problems.append((409, f"{name} steht schon in dieser Staffel."))
        else:
            problems.append((409, f"{name} stand schon in dieser Staffel ({STATUS_LABELS.get(status, status or 'ohne Status')}) – "
                                  "eine Person tritt je Staffel nur einmal an."))
    if person.get("id") in other_staffel:
        problems.append((409, f"{name} spielt in dieser Season schon in einer anderen Staffel."))
    seat = _seat_limit_problem(tournament, seats_taken)
    if seat:
        problems.append(seat)
    return problems


async def _person_state(db, tournament: dict, user_ids: list[str]) -> tuple[dict[str, str | None], int, set[str]]:
    """Wer schon in dieser Staffel steht (mit Status), wie viele Plätze belegt sind und wer von ``user_ids`` in einer anderen Staffel
    derselben Season spielt (Season-Schlüssel ``<season>:user:<id>``)."""
    regs = await db.tournament_registrations.find(
        {"tournament_id": tournament["id"]}, {"_id": 0, "user_id": 1, "status": 1}).to_list(REGISTRATION_LIMIT)
    taken: dict[str, str | None] = {}
    for reg in regs:
        uid = reg.get("user_id")
        if uid and taken.get(uid) not in ACTIVE_REGISTRATION_STATUSES:
            taken[uid] = reg.get("status")
    seats = len([reg for reg in regs if reg.get("status") in SEAT_STATUSES])
    keys = {league_squad_key(tournament, league_participants.person_entry(uid)): uid for uid in user_ids if uid}
    keys.pop(None, None)
    other: set[str] = set()
    if keys:
        rows = await db.tournament_registrations.find(
            {"league_squad_key": {"$in": sorted(keys)}, "tournament_id": {"$ne": tournament["id"]}},
            {"_id": 0, "league_squad_key": 1}).to_list(len(keys) + 5)
        other = {keys[row["league_squad_key"]] for row in rows if row.get("league_squad_key") in keys}
    return taken, seats, other


def _check_solo_staffel(tournament: dict) -> None:
    if not league_participants.is_solo_staffel(tournament):
        raise SquadAssignError(400, league_participants.WRONG_ENTRY_TEAM)
    if (tournament.get("league_context") or {}).get("kind"):
        raise SquadAssignError(409, POSTSEASON_ASSIGN)


async def person_candidates(db, tournament: dict, query: str | None, actor: dict | None = None) -> dict:
    """Für den Dialog „Spieler zuteilen“: Konten nach Name (ohne E-Mail), je Person die Gründe, warum sie (noch) nicht geht, dazu
    Alter, Plattform und Spiel-ID als Hinweis - wie beim Co-Team, nur für eine Person. Ohne Suchtext keine Liste."""
    from services.query_filters import safe_regex

    _check_solo_staffel(tournament)
    needle = str(query or "").strip()
    people: list[dict] = []
    if len(needle) >= 2:
        pattern = safe_regex(needle)
        # Wie die Personensuche (``mention-search``): gesperrte und deaktivierte Konten erscheinen nicht - die Leitung sieht so keinen
        # fremden Sperrstatus. Das direkte Zuteilen sagt weiter „gesperrt“ (``person_problems``).
        people = await db.users.find(
            {"is_active": True, "is_banned": {"$ne": True},
             "$or": [{"username": {"$regex": pattern, "$options": "i"}}, {"display_name": {"$regex": pattern, "$options": "i"}}]},
            PERSON_FIELDS).sort("display_name", 1).to_list(PERSON_SEARCH_LIMIT)
    ids = [row["id"] for row in people if row.get("id")]
    taken, seats, other = await _person_state(db, tournament, ids)
    roster_ctx = await league_roster.context_for_tournament(db, tournament, ids) if ids else None
    eligibility = await league_eligibility.context_for_tournament(db, tournament, ids) if ids else None
    rows = []
    for person in people:
        problems = person_problems(person, tournament, taken=taken, seats_taken=seats, other_staffel=other)
        # Eine laufende Sperre der Person (E.3, #1629 P2) hält das Zuteilen auf - wie die Teamsperre beim Co-Team.
        problems += league_eligibility.person_problems(eligibility, person["id"], person_name(person))
        if actor and person.get("id") == actor.get("id"):
            problems.append((403, SELF_ASSIGN_ROW))
        alone = {"id": None, "name": person_name(person), "member_ids": [person["id"]]}
        rows.append({
            "id": person["id"], "username": person.get("username"), "display_name": person_name(person), "avatar_url": person.get("avatar_url"),
            "problems": [text for _code, text in problems],
            # Alter und Plattform (#2270, #2313) und die Spiel-ID (#2108): Hinweis, das Zuteilen geht trotzdem - wie beim Co-Team.
            "notes": league_eligibility.assign_notes(eligibility, alone),
            "players": _id_players(alone, league_roster.statuses(roster_ctx, [person["id"]])) if roster_ctx and roster_ctx.fields else [],
        })
    return {
        "kind": league_participants.SOLO,
        "max_participants": _positive_int(tournament.get("max_participants")),
        "seats_taken": seats,
        "people": rows,
        "id_label": league_roster.labels(roster_ctx.fields) if roster_ctx and roster_ctx.fields else None,
    }


async def build_person_registration(db, tournament: dict, user_id: str, actor: dict, *, consent: bool = False, via: str = "league_assign",
                                    source: str = "staff_add", application_id: str | None = None, registered_by: str | None = None) -> dict:
    """Prüft die Person und baut ihre Einzel-Anmeldung für die Solo-Staffel - ohne zu schreiben. Wirft ``SquadAssignError``.

    Wie ``build_registration``: Die Selbstanmeldung (#1629, P2) sagt, woher sie kommt (``via``, ``source``, ``application_id``,
    ``registered_by``) und ob die Person ausdrücklich zugestimmt hat (``consent``). Ohne diese Angaben bleibt es das Zuteilen durch die Leitung."""
    _check_solo_staffel(tournament)
    if tournament.get("status") in FINISHED_TOURNAMENT_STATUSES:
        raise SquadAssignError(409, "Diese Staffel ist schon beendet.")
    person = await db.users.find_one({"id": user_id}, PERSON_FIELDS)
    if not person:
        raise SquadAssignError(404, "Dieses Konto gibt es nicht.")
    taken, seats, other = await _person_state(db, tournament, [user_id])
    problems = person_problems(person, tournament, taken=taken, seats_taken=seats, other_staffel=other)
    # Sperre der Person (E.3): auf jedem Weg in die Staffel - Zuteilen, Annehmen, automatische Zuteilung.
    problems += league_eligibility.person_problems(await league_eligibility.context_for_tournament(db, tournament, [user_id]), user_id,
                                                   person_name(person))
    if problems:
        code, text = problems[0]
        raise SquadAssignError(code, text)
    tid = tournament["id"]
    now_iso = now_utc().isoformat()
    name = person_name(person)
    late = await _late_mark(db, tournament)
    key = league_squad_key(tournament, league_participants.person_entry(user_id))
    return {
        **({"late_entry": late} if late else {}),
        "id": new_id(),
        "tournament_id": tid,
        "user_id": user_id,
        "team_id": None,
        "status": "approved",
        "display_name": name,
        "ingame_name": name,
        "player_ids": {},
        # Wie beim Co-Team (D-7, #1646): Das Zuteilen ist keine Zustimmung - Regeln stehen in league_rule_consents. Wahr nur, wenn ein
        # Antrag beide Zustimmungen der Person trägt (#1629, P2).
        "accepted_rules": consent,
        "accepted_privacy": consent,
        "seed": None,
        "registration_type": "solo",
        "registered_via": via,
        "registered_by": registered_by or actor.get("id"),
        "source": source,
        "is_guest": False,
        "identity_key": f"{tid}:user:{user_id}",
        **({"league_squad_key": key} if key else {}),
        **({"application_id": application_id} if application_id else {}),
        "created_by": actor.get("id"),
        "created_at": now_iso,
        "updated_at": now_iso,
    }


async def active_league_registration(db, squad_id: str) -> dict | None:
    """Eine Anmeldung dieses Co-Teams in einer Staffel, die noch nicht beendet ist - egal mit welchem Status (auch
    ausgetreten oder disqualifiziert steht es in Tabelle und Spielplan). Dann darf es nicht gelöscht werden."""
    active = await active_league_registrations(db, squad_id)
    return active[0] if active else None


