"""Rechte in der Liga (docs/LIGA.md, Abschnitt 12, #2203): Bereich „Ligen“, Zuständige je Liga und Befangenheit.

- Der Bereich ``leagues`` darf alle Ligen und alle Zuständigkeiten. Der Bereich ``tournaments`` gibt hier nichts.
- Zuständige (``league_staff``) haben nur ihre Liga und nur ihre Zuständigkeiten.
- Bereich und Zuständigkeit gelten nur mit bestätigter Zwei-Faktor-Anmeldung.
- ``conflict_of_interest`` sagt, ob jemand über ein Spiel nicht entscheiden darf, weil er dazugehört. Die Prüfung gilt für
  Ergebnisse, Proteste, Strafen und den direkt gesetzten Termin; ``decided_by`` ist für Einsprüche (E.3).
"""
from __future__ import annotations

from typing import Iterable

from fastapi import Depends, HTTPException, Request

from match_rules import participant_source_ids

from auth import get_current_user
from database import get_db
from models import new_id, now_utc
from services.league_scope import is_league_staffel
from services.match_audience import registrations_for_match, teams_by_id
from services.permissions import MFA_MESSAGE, ROLE_AREAS, holds_area, is_superadmin, needs_mfa

CAPABILITIES: tuple[str, ...] = ("manage", "season", "applications", "roster", "matches", "results", "disputes",
                                 "sanctions", "rules")
CAPABILITY_LABELS: dict[str, str] = {
    "manage": "Liga verwalten",
    "season": "Season konfigurieren",
    "applications": "Teams freigeben",
    "roster": "Kader prüfen",
    "matches": "Spiele betreuen",
    "results": "Ergebnisse korrigieren",
    "disputes": "Proteste",
    "sanctions": "Strafen",
    "rules": "Regeln veröffentlichen",
}
# Fragen statt Zuständigkeit: ``ANY`` jede Zuständigkeit dieser Liga, ``READ`` dazu die Helfer einer Staffel (nur lesen),
# ``AREA`` nur der Bereich.
ANY = "any"
READ = "read"
AREA = "area"
# Hier gilt die Befangenheit (Entscheidungen des Obmanns zu #2203). „matches“: das Spiel direkt planen - als Captain oder Vertreter
# bleibt Vorschlag und Zustimmung.
CONFLICT_CAPABILITIES = frozenset({"results", "disputes", "sanctions", "matches"})

CONFLICT_REASON_MIN = 5
CONFLICT_REASON_MAX = 500
CONFLICT_INVOLVED = "involved"
CONFLICT_OWN_DECISION = "own_decision"
CONFLICT_DETAIL = "Du bist an diesem Spiel selbst beteiligt. Das entscheidet eine zweite berechtigte Person."
BULK_CONFLICT_DETAIL = ("Du bist an einem dieser Spiele selbst beteiligt. Das macht eine zweite berechtigte Person - "
                        "als Captain oder Vertreter nutzt du Vorschlag und Zustimmung.")
CONFLICT_SUPERADMIN_DETAIL = ("Du bist an diesem Spiel selbst beteiligt. Als Superadmin geht es nur als Notausnahme, mit "
                              "einem Grund von mindestens fünf Zeichen.")
OWN_DECISION_DETAIL = "Über einen Einspruch entscheidet nie, wer die Ausgangsentscheidung getroffen hat."
NO_LEAGUE_RIGHT = ("Dafür fehlt dir das Recht in dieser Liga. Den Bereich „Ligen“ vergibt der Superadmin unter "
                   "Admin → Alle Benutzer, Zuständige vergibt der Bereich „Ligen“ auf der Liga-Seite.")


def clean_capabilities(values) -> list[str]:
    """Nur bekannte Zuständigkeiten, jede einmal, in fester Reihenfolge."""
    wanted = {str(value).strip() for value in (values or [])}
    return [capability for capability in CAPABILITIES if capability in wanted]


def has_leagues_area(user: dict | None) -> bool:
    """Der Bereich Ligen für die angemeldete Person einer Anfrage - nur mit bestätigter Zwei-Faktor-Anmeldung."""
    return holds_area(user, "leagues") and not needs_mfa(user)


async def capabilities_of(db, user: dict | None, league_id: str | None) -> frozenset[str]:
    """Was diese Person in dieser Liga darf: mit dem Bereich alles, sonst ihre Zuständigkeiten, ohne Zwei-Faktor nichts."""
    if not user or needs_mfa(user):
        return frozenset()
    if holds_area(user, "leagues"):
        return frozenset(CAPABILITIES)
    if not league_id or not user.get("id"):
        return frozenset()
    row = await db.league_staff.find_one({"league_id": league_id, "user_id": user["id"]}, {"_id": 0, "capabilities": 1})
    return frozenset(clean_capabilities((row or {}).get("capabilities")))


def _satisfied(capabilities: frozenset[str], wanted) -> bool:
    """``wanted``: eine Zuständigkeit, eine Liste (eine davon reicht), ``ANY`` oder ``READ`` (jede) - oder ``AREA``, das
    hier nie reicht, weil Zuständige den Bereich nicht haben (``can``)."""
    if wanted in (ANY, READ):
        return bool(capabilities)
    if isinstance(wanted, str):
        return wanted in capabilities
    return bool(capabilities & set(wanted))


async def can(user: dict | None, capability, league_id: str | None, db=None) -> bool:
    """Darf die angemeldete Person das in dieser Liga? ``AREA`` fragt nur nach dem Bereich."""
    if capability == AREA:
        return has_leagues_area(user)
    return _satisfied(await capabilities_of(db if db is not None else get_db(), user, league_id), capability)


def refusal(user: dict | None, has_duty: bool = False) -> str:
    """Der Grund für 403: fehlt nur die Zwei-Faktor-Anmeldung, der Hinweis darauf."""
    if user and needs_mfa(user) and (holds_area(user, "leagues") or has_duty):
        return MFA_MESSAGE
    return NO_LEAGUE_RIGHT


async def refuse(db, user: dict | None, league_id: str | None) -> HTTPException:
    has_duty = bool(user and league_id and await db.league_staff.find_one(
        {"league_id": league_id, "user_id": user.get("id")}, {"_id": 1}))
    return HTTPException(status_code=403, detail=refusal(user, has_duty))


async def _league_of(db, kind: str, value: str | None) -> str | None:
    """Zu welcher Liga gehört die Kennung aus der Adresse? ``None``: gibt es nicht."""
    if not value:
        return None
    if kind == "league_id":
        return value
    if kind == "season_id":
        row = await db.league_seasons.find_one({"id": value}, {"_id": 0, "league_id": 1})
        return (row or {}).get("league_id")
    if kind == "division_id":
        row = await db.league_divisions.find_one({"id": value}, {"_id": 0, "league_id": 1, "season_id": 1})
        if row and not row.get("league_id"):
            return await _league_of(db, "season_id", row.get("season_id"))
        return (row or {}).get("league_id")
    if kind == "tournament_id":
        row = await db.tournaments.find_one({"id": value}, {"_id": 0, "league_context": 1})
        return ((row or {}).get("league_context") or {}).get("league_id")
    raise ValueError(kind)


def require_league(capability, via: str = "league_id", param: str | None = None):
    """Wächter für Routen der Liga: die Liga kommt aus der Adresse (``via``: ``league_id``, ``season_id``, ``division_id``
    oder ``tournament_id``; ``param``, wenn das Adressfeld anders heißt). Unbekannte Kennungen beantwortet die Route mit 404 - aber nur
    für den Bereich, Zuständige sehen 403 und erfahren nicht, was es gibt."""

    async def dep(request: Request, user: dict = Depends(get_current_user)) -> dict:
        db = get_db()
        league_id = await _league_of(db, via, request.path_params.get(param or via))
        if await can(user, capability, league_id, db=db):
            return user
        raise await refuse(db, user, league_id)

    return dep


async def require_any_league(user: dict = Depends(get_current_user)) -> dict:
    """Einstieg der Verwaltung: Bereich oder mindestens eine Zuständigkeit - die Route zeigt nur die eigenen Ligen."""
    if has_leagues_area(user) or (not needs_mfa(user) and await staffed_league_ids(get_db(), user)):
        return user
    db = get_db()
    has_duty = bool(await db.league_staff.find_one({"user_id": user.get("id")}, {"_id": 1}))
    raise HTTPException(status_code=403, detail=refusal(user, has_duty))


async def staffed_league_ids(db, user: dict | None) -> set[str]:
    """Die Ligen, in denen diese Person zuständig ist (ohne den Bereich zu betrachten)."""
    if not user or not user.get("id"):
        return set()
    rows = await db.league_staff.find({"user_id": user["id"]}, {"_id": 0, "league_id": 1, "capabilities": 1}).to_list(500)
    return {row["league_id"] for row in rows if row.get("league_id") and clean_capabilities(row.get("capabilities"))}


async def has_league_duty(db, user: dict | None) -> bool:
    """Für das Web: öffnet „Mein Dienst“ und die Liga-Seiten; die Routen prüfen selbst."""
    return bool(await staffed_league_ids(db, user))


class StaffelAccess:
    """Für Listen: welche Staffeln die angemeldete Person leitet - alle (Bereich), die ihrer Ligen oder keine."""

    def __init__(self, all_leagues: bool, league_ids: Iterable[str]):
        self.all = all_leagues
        self.league_ids = set(league_ids)

    def covers(self, tournament: dict | None) -> bool:
        if not is_league_staffel(tournament):
            return False
        return self.all or tournament["league_context"].get("league_id") in self.league_ids

    def query(self) -> dict | None:
        """Mongo-Filter der Staffeln, die sie leitet - ``None``: keine."""
        if self.all:
            return {"league_context": {"$type": "object"}}
        if self.league_ids:
            return {"league_context.league_id": {"$in": sorted(self.league_ids)}}
        return None


async def staffel_access(db, user: dict | None) -> StaffelAccess:
    if not user or needs_mfa(user):
        return StaffelAccess(False, ())
    if holds_area(user, "leagues"):
        return StaffelAccess(True, ())
    return StaffelAccess(False, await staffed_league_ids(db, user))


def leagues_area_filter() -> dict:
    """Alle Konten mit dem Bereich Ligen (Rolle oder Freigabe) - wie ``tournament_lead_filter``."""
    roles = sorted(role for role, areas in ROLE_AREAS.items() if "leagues" in areas)
    return {"$or": [{"role": {"$in": roles}}, {"areas": "leagues"}]}


async def staff_user_ids(db, league_id: str | None, capabilities: Iterable[str]) -> set[str]:
    """Wer in dieser Liga eine dieser Zuständigkeiten hat, als Konten: für Meldungen (Streitfälle, Termine, Ergebnisse).
    Gesperrte und abgeschaltete Konten fallen weg."""
    active = {"is_active": {"$ne": False}, "is_banned": {"$ne": True}}
    rows = await db.users.find({**leagues_area_filter(), **active}, {"_id": 0, "id": 1}).to_list(500)
    ids = {row["id"] for row in rows if row.get("id")}
    if league_id:
        staff = await db.league_staff.find(
            {"league_id": league_id, "capabilities": {"$in": sorted(set(capabilities))}}, {"_id": 0, "user_id": 1}).to_list(500)
        wanted = sorted({row["user_id"] for row in staff if row.get("user_id")} - ids)
        if wanted:
            rows = await db.users.find({"id": {"$in": wanted}, **active}, {"_id": 0, "id": 1}).to_list(len(wanted) + 1)
            ids.update(row["id"] for row in rows if row.get("id"))
    return ids


# ---------------------------------------------------------------- Befangenheit


def _people_of_side(registration: dict, team: dict | None) -> set[str]:
    """Wer zu einer Seite gehört: die Person der Anmeldung, die Hauptteam-Leitung, Captain, Vertreter und der Kader des
    Co-Teams - ohne Co-Team das ganze Team. Bewusst aus den Rohdaten: Wer inzwischen das Hauptteam verlassen hat, aber noch im
    Kader steht, bleibt befangen."""
    people = {registration.get("user_id")}
    if team:
        people.update((team.get("leader_id"), *(team.get("co_leader_ids") or [])))
        if registration.get("squad_id"):
            squad = (team.get("squads") or {}).get(registration["squad_id"]) or {}
            people.update((squad.get("captain_id"), squad.get("vice_captain_id"), *(squad.get("member_ids") or [])))
        else:
            people.update(team.get("member_ids") or [])
    return {person for person in people if person}


def _people_in_lineups(match: dict) -> set[str]:
    people: set[str] = set()
    for game in match.get("games") or []:
        for lineup in ((game or {}).get("lineups") or {}).values():
            people.update(lineup or [])
    return {person for person in people if person}


async def involved_user_ids(db, match: dict) -> set[str]:
    """Alle, die in diesem Spiel als beteiligt gelten."""
    registrations = await registrations_for_match(db, match)
    teams = await teams_by_id(db, registrations)
    people = _people_in_lineups(match)
    for registration in registrations:
        people |= _people_of_side(registration, teams.get(registration.get("team_id") or ""))
    return people


async def involved_match_ids(db, user: dict | None, tournament: dict | None, matches: list[dict]) -> set[str]:
    """Für Listen einer Staffel: in welchen dieser Spiele ist die Person beteiligt? Eine Abfrage je Art statt je Spiel - dieselbe Regel
    wie ``involved_user_ids``. Andere Turniere: keine."""
    if not user or not user.get("id") or not is_league_staffel(tournament) or not matches:
        return set()
    registrations = await db.tournament_registrations.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(2000)
    teams = await teams_by_id(db, registrations)
    own = {row["id"] for row in registrations if user["id"] in _people_of_side(row, teams.get(row.get("team_id") or ""))}
    return {match["id"] for match in matches
            if user["id"] in _people_in_lineups(match) or own & set(participant_source_ids(match))}


async def conflict_of_interest(db, user: dict | None, match: dict, *, decided_by: str | None = None) -> dict | None:
    """Darf diese Person über dieses Spiel nicht entscheiden? ``None`` heißt: kein Grund dagegen.

    ``kind``: ``involved`` (gehört zu einer Seite) oder ``own_decision`` (``decided_by``: traf die Ausgangsentscheidung, für
    den Einspruch in E.3). ``override``: Darf die Person es trotzdem - nur der Superadmin, nur bei ``involved``, mit Grund.
    Turniere ohne Liga kennen keine Befangenheit."""
    if not user or not match.get("tournament_id"):
        return None
    tournament = await db.tournaments.find_one({"id": match["tournament_id"]}, {"_id": 0, "league_context": 1})
    if not is_league_staffel(tournament):
        return None
    if decided_by and decided_by == user.get("id"):
        return {"kind": CONFLICT_OWN_DECISION, "override": False}
    if user.get("id") in await involved_user_ids(db, match):
        return {"kind": CONFLICT_INVOLVED, "override": is_superadmin(user)}
    return None


HOLD_NO_ACCOUNT = "Dein Konto ist gesperrt oder abgeschaltet."
HOLD_NO_SECOND_FACTOR = "Deine Zwei-Faktor-Anmeldung ist nicht mehr eingerichtet."
HOLD_NO_RIGHT = "Du hast in dieser Liga nicht mehr das Recht dazu."
HOLD_CONFLICT = "Du bist inzwischen an diesem Spiel beteiligt. Das entscheidet eine zweite berechtigte Person."


async def held_result_refusal(db, match: dict, hold: dict) -> str | None:
    """Darf ein gehaltenes Ergebnis einer Staffel noch hinaus? Zwischen Ablegen und Veröffentlichen liegen 12 Sekunden - zählt
    wird der Stand beim Veröffentlichen: Konto, Zwei-Faktor, Liga-Recht und Befangenheit. ``None``: Ja. Andere Turniere kennen die
    Prüfung nicht. Die Bestätigung der Sitzung gehört zur Anfrage, hier zählt die eingerichtete Zwei-Faktor-Anmeldung des Kontos.
    Die Notausnahme des Superadmins bleibt, wenn sie beim Ablegen mit Grund gesetzt war und die Person noch Superadmin ist."""
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "league_context": 1})
    if not is_league_staffel(tournament):
        return None
    account = await db.users.find_one({"id": hold.get("actor_id")},
                                      {"_id": 0, "id": 1, "role": 1, "areas": 1, "is_active": 1, "is_banned": 1, "mfa_enabled": 1})
    if not account or account.get("is_active") is False or account.get("is_banned"):
        return HOLD_NO_ACCOUNT
    if not account.get("mfa_enabled"):
        return HOLD_NO_SECOND_FACTOR
    person = {**account, "auth_mfa_verified": True}
    capabilities = await capabilities_of(db, person, tournament["league_context"].get("league_id"))
    if "results" not in capabilities or (str(match.get("status") or "") == "disputed" and "disputes" not in capabilities):
        return HOLD_NO_RIGHT
    # Auch wer sich mit diesem Ergebnis selbst aufgestellt hat, gehört zum Spiel.
    conflict = await conflict_of_interest(db, person, {**match, "games": [*(match.get("games") or []), *(hold.get("games") or [])]})
    if conflict and not (conflict["override"] and hold.get("conflict_reason")):
        return HOLD_CONFLICT
    return None


async def require_no_conflict(db, user: dict, match: dict, *, action: str, conflict_reason: str | None = None,
                              decided_by: str | None = None, record: bool = True) -> None:
    """Bricht mit 403 ab, wenn die Person befangen ist. Der Superadmin kommt als Notausnahme mit Grund durch, das steht im
    Protokoll (``league.conflict.override``). ``record=False`` prüft nur, für die Vorprüfung vor einer Sperre."""
    conflict = await conflict_of_interest(db, user, match, decided_by=decided_by)
    if not conflict:
        return
    if conflict["kind"] == CONFLICT_OWN_DECISION:
        raise HTTPException(status_code=403, detail=OWN_DECISION_DETAIL)
    if not conflict["override"]:
        raise HTTPException(status_code=403, detail=CONFLICT_DETAIL)
    reason = conflict_reason.strip() if isinstance(conflict_reason, str) else ""
    if len(reason) < CONFLICT_REASON_MIN:
        raise HTTPException(status_code=403, detail=CONFLICT_SUPERADMIN_DETAIL)
    if record:
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "league.conflict.override", "actor_id": user.get("id"),
            "target_id": match.get("tournament_id"),
            "data": {"match_id": match.get("id"), "action": action, "reason": reason[:CONFLICT_REASON_MAX]},
            "created_at": now_utc().isoformat(),
        })
