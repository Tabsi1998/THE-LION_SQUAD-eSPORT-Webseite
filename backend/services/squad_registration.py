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

from models import new_id, now_utc

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
    gleichzeitigem Zuteilen. Ohne Liga-Rahmen (``league_context``) gibt es keinen Schlüssel."""
    season_id = (tournament.get("league_context") or {}).get("season_id")
    return f"{season_id}:{squad_id}" if season_id and squad_id else None


def season_lock_resource(tournament: dict) -> str | None:
    season_id = (tournament.get("league_context") or {}).get("season_id")
    return f"league_season:{season_id}:squads" if season_id else None


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


def min_squad_size(tournament: dict) -> int:
    """Mindestkader: das Feld ``min_squad_size`` der Staffel (der Liga-Rahmen kopiert es aus Season bzw. Liga N), sonst
    die Teamgröße des Turniers - nie kleiner als sie. Der Turnierkern liest nur das Turnier, nie die Season."""
    team_size = _positive_int(tournament.get("team_size")) or 1
    value = _positive_int(tournament.get("min_squad_size"))
    return max(value or team_size, team_size)


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
) -> list[tuple[int, str]]:
    """Alle Gründe, warum dieses Co-Team nicht in die Staffel kann - leer heißt: zuteilbar.

    Reihenfolge = Reihenfolge der Meldung beim Zuteilen (der erste Grund wird zur Antwort)."""
    problems: list[tuple[int, str]] = []
    name = squad.get("name") or "Das Co-Team"
    if squad.get("team_id") != team.get("id"):
        problems.append((400, f"{name} gehört nicht zu diesem Team."))
    if (squad.get("status") or "active") != "active":
        problems.append((400, f"{name} ist archiviert – nur aktive Co-Teams spielen in der Liga."))
    if tournament.get("game_id") and squad.get("game_id") and squad["game_id"] != tournament["game_id"]:
        problems.append((400, f"{name} ist für ein anderes Spiel eingetragen als diese Staffel."))
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
    if team.get("id") in taken_teams:
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


async def _staffel_state(db, tournament: dict) -> tuple[dict[str, str | None], int, set[str]]:
    """Welche Hauptteams schon in der Staffel stehen (mit Status - jede Anmeldung eines Teams belegt den
    ``identity_key``, auch eine ausgetretene), wie viele Plätze belegt sind und welche Co-Teams in einer anderen
    Staffel derselben Season stehen."""
    tid = tournament["id"]
    regs = await db.tournament_registrations.find(
        {"tournament_id": tid},
        {"_id": 0, "team_id": 1, "status": 1},
    ).to_list(2000)
    taken_teams: dict[str, str | None] = {}
    for reg in regs:
        if reg.get("team_id") and taken_teams.get(reg["team_id"]) not in ACTIVE_REGISTRATION_STATUSES:
            taken_teams[reg["team_id"]] = reg.get("status")
    seats = len([reg for reg in regs if reg.get("status") in SEAT_STATUSES])
    other: set[str] = set()
    season_id = (tournament.get("league_context") or {}).get("season_id")
    if season_id:
        sibling_ids = [
            row["id"]
            for row in await db.tournaments.find(
                {"league_context.season_id": season_id, "id": {"$ne": tid}},
                {"_id": 0, "id": 1},
            ).to_list(200)
            if row.get("id")
        ]
        if sibling_ids:
            other = {
                row["squad_id"]
                for row in await db.tournament_registrations.find(
                    {
                        "tournament_id": {"$in": sibling_ids},
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
    return taken_teams, seats, other


def _public_user(user: dict | None) -> dict | None:
    if not user:
        return None
    return {"id": user.get("id"), "username": user.get("username"), "display_name": user.get("display_name")}


async def candidates(db, tournament: dict) -> dict:
    """Für den Dialog „Co-Team zuteilen“: je Hauptteam die aktiven Co-Teams mit Kader, Captain, Vertreter und den
    Gründen, warum eines (noch) nicht geht."""
    min_size = min_squad_size(tournament)
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
        )
        entry = out.setdefault(
            team["id"],
            {
                "id": team["id"],
                "name": team.get("name"),
                "tag": team.get("tag"),
                "logo_url": team.get("logo_url"),
                "in_staffel": team["id"] in taken_teams,
                "squads": [],
            },
        )
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
            }
        )
    rows = sorted(out.values(), key=lambda row: str(row.get("name") or "").lower())
    for row in rows:
        row["squads"].sort(key=lambda squad: str(squad.get("name") or "").lower())
    limit = _positive_int(tournament.get("max_participants"))
    return {"min_squad_size": min_size, "max_participants": limit, "seats_taken": seats, "teams": rows}


async def build_registration(db, tournament: dict, team_id: str, squad_id: str, actor: dict) -> dict:
    """Prüft das Co-Team und baut die Anmeldung - ohne zu schreiben. Wirft ``SquadAssignError``."""
    if not is_league_tournament(tournament):
        raise SquadAssignError(400, "Co-Teams teilt die Turnierleitung nur Team-Turnieren im Format Liga zu.")
    if tournament.get("status") in FINISHED_TOURNAMENT_STATUSES:
        raise SquadAssignError(409, "Diese Staffel ist schon beendet.")
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise SquadAssignError(404, "Team nicht gefunden.")
    squad = await db.team_squads.find_one({"id": squad_id}, {"_id": 0})
    if not squad:
        raise SquadAssignError(404, "Co-Team nicht gefunden.")
    memberships = await db.team_members.find({"team_id": team_id}, {"_id": 0, "user_id": 1}).to_list(500)
    taken_teams, seats, other = await _staffel_state(db, tournament)
    problems = squad_problems(
        team,
        squad,
        tournament,
        min_size=min_squad_size(tournament),
        team_member_ids=_team_member_ids(team, memberships),
        taken_teams=taken_teams,
        seats_taken=seats,
        other_staffel_squad_ids=other,
    )
    if problems:
        code, text = problems[0]
        raise SquadAssignError(code, text)
    tid = tournament["id"]
    now_iso = now_utc().isoformat()
    name = display_name(team, squad)
    return {
        "id": new_id(),
        "tournament_id": tid,
        "user_id": None,
        "team_id": team_id,
        "squad_id": squad_id,
        "squad_name": squad.get("name"),
        "status": "approved",
        "display_name": name,
        "ingame_name": name,
        "player_ids": {},
        "accepted_rules": True,
        "accepted_privacy": True,
        "seed": None,
        "registration_type": "team",
        "registered_via": "league_assign",
        "registered_by": actor.get("id"),
        "source": "staff_add",
        "is_guest": False,
        "identity_key": f"{tid}:team:{team_id}",
        **({"league_squad_key": key} if (key := league_squad_key(tournament, squad_id)) else {}),
        "created_by": actor.get("id"),
        "created_at": now_iso,
        "updated_at": now_iso,
    }


async def active_league_registration(db, squad_id: str) -> dict | None:
    """Eine Anmeldung dieses Co-Teams in einer Staffel, die noch nicht beendet ist - egal mit welchem Status (auch
    ausgetreten oder disqualifiziert steht es in Tabelle und Spielplan). Dann darf es nicht gelöscht werden."""
    regs = await db.tournament_registrations.find(
        {"squad_id": squad_id},
        {"_id": 0, "id": 1, "tournament_id": 1},
    ).to_list(500)
    if not regs:
        return None
    tournaments = {
        row["id"]: row
        for row in await db.tournaments.find(
            {"id": {"$in": sorted({reg["tournament_id"] for reg in regs if reg.get("tournament_id")})}},
            {"_id": 0, "id": 1, "title": 1, "slug": 1, "status": 1},
        ).to_list(510)
    }
    for reg in regs:
        tournament = tournaments.get(reg.get("tournament_id") or "")
        if tournament and tournament.get("status") not in FINISHED_TOURNAMENT_STATUSES:
            return {**reg, "tournament_title": tournament.get("title"), "tournament_slug": tournament.get("slug")}
    return None
