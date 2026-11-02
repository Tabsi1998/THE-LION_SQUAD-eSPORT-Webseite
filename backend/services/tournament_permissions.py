"""Tournament-scoped staff permission helpers."""
from fastapi import HTTPException

from database import get_db
from services import league_permissions
from services.league_permissions import ANY, READ
from services.permissions import MFA_MESSAGE, area_refusal, is_confirmed_tournament_lead, lead_without_second_factor

# Turnierrechte für alle Turniere: wer den Bereich Turnierleitung hat - über die Rolle (Turnierleitung,
# Club-Admin, Superadmin) oder eine Freigabe (#1350). Moderatoren moderieren; in einem einzelnen Turnier
# bekommen sie genau die Rechte eines Helfer-Einsatzes (tournament_staff_assignments) - wie jede andere
# Person auch. Die Rechte über alle Turniere gelten wie jeder Adminbereich nur mit bestätigter Zwei-Faktor-Anmeldung
# (#291); Helfer-Einsätze brauchen sie nicht. Die Rollenlisten bleiben nur als Auskunft für ältere Aufrufer.
GLOBAL_TOURNAMENT_STAFF_ROLES = {"tournament_admin", "club_admin", "superadmin"}
GLOBAL_TOURNAMENT_ADMIN_ROLES = {"tournament_admin", "club_admin", "superadmin"}

# Ergebnisse eintragen: Organisation, Schiedsrichter, Ergebnisdienst - und die Station-Crew (Entscheidung des Betreibers
# zu #1139: alles steht im Protokoll, die Turnierleitung kann korrigieren).
RESULT_STAFF_ROLES = {"organizer", "referee", "scorekeeper", "station_manager"}
CHECKIN_STAFF_ROLES = {"organizer", "referee", "scorekeeper", "station_manager"}
READ_STAFF_ROLES = {"organizer", "referee", "scorekeeper", "station_manager", "stream_operator"}
STRUCTURE_STAFF_ROLES = {"organizer", "referee"}
PARTICIPANT_STAFF_ROLES = {"organizer", "referee", "scorekeeper"}


def is_global_tournament_staff(user: dict | None) -> bool:
    return is_confirmed_tournament_lead(user)


def is_global_tournament_admin(user: dict | None) -> bool:
    return is_confirmed_tournament_lead(user)


async def assigned_tournament_ids(user: dict | None) -> list[str]:
    if not user:
        return []
    db = get_db()
    return await db.tournament_staff_assignments.distinct(
        "tournament_id",
        {"user_id": user["id"], "is_active": {"$ne": False}},
    )


# Liga-Staffel (#2203, docs/LIGA.md Abschnitt 12): eine Staffel ist ein Turnier, aber der Bereich Turnierleitung gibt dort nichts
# und Helfer lesen nur. Jeder Aufrufer nennt deshalb, welches Liga-Recht in einer Staffel gilt (``capability``). Nennt er keines,
# gilt „Liga verwalten“ - eine vergessene Route ist in der Staffel zu, nicht offen.
async def _league_context(tournament_id: str | None, db=None) -> dict | None:
    """Der Liga-Rahmen eines Turniers - ``None`` heißt: normales Turnier."""
    if not tournament_id:
        return None
    row = await (db if db is not None else get_db()).tournaments.find_one({"id": tournament_id}, {"_id": 0, "league_context": 1})
    context = (row or {}).get("league_context")
    return context if isinstance(context, dict) else None


async def is_staffel(tournament_id: str | None) -> bool:
    return await _league_context(tournament_id) is not None


async def _staffel_permission(user, tournament_id, context, scope, scope_id, capability) -> bool:
    if not user:
        return False
    wanted = capability or "manage"
    if await league_permissions.can(user, wanted, context.get("league_id")):
        return True
    return wanted == READ and await _assignment_permission(user, tournament_id, READ_STAFF_ROLES, scope, scope_id)


async def has_tournament_staff_permission(
    user: dict | None,
    tournament_id: str,
    allowed_roles: set[str] | None = None,
    scope: str | None = None,
    scope_id: str | None = None,
    *,
    capability=None,
) -> bool:
    context = await _league_context(tournament_id)
    if context is not None:
        return await _staffel_permission(user, tournament_id, context, scope, scope_id, capability)
    if is_global_tournament_staff(user):
        return True
    return await _assignment_permission(user, tournament_id, allowed_roles, scope, scope_id)


async def _assignment_permission(user, tournament_id, allowed_roles, scope, scope_id) -> bool:
    """Der Helfer-Einsatz in diesem Turnier (ganzes Turnier oder Spiel, Phase, Gruppe, Station)."""
    if not user:
        return False
    query = {
        "tournament_id": tournament_id,
        "user_id": user["id"],
        "is_active": {"$ne": False},
    }
    if allowed_roles:
        query["role"] = {"$in": sorted(allowed_roles)}
    db = get_db()
    assignments = await db.tournament_staff_assignments.find(query, {"_id": 0}).to_list(200)
    if not assignments:
        return False
    if not scope:
        return True
    for assignment in assignments:
        assignment_scope = assignment.get("scope") or "tournament"
        assignment_scope_id = assignment.get("scope_id")
        if assignment_scope == "tournament":
            return True
        if assignment_scope == scope and (not assignment_scope_id or assignment_scope_id == scope_id):
            return True
    return False


# Stationen automatisch verteilen (routes/station_routes.py): Organisation, Schiedsrichter, Stationsleitung.
STATION_ASSIGN_ROLES = {"organizer", "referee", "station_manager"}


async def tournament_rights(user: dict | None, tournament_id: str) -> dict:
    """Was die Person in diesem Turnier darf (#1353) - dieselben Rollen und Bereiche (Scope) wie die Wächter der Routen.
    Die Verwaltung zeigt Knöpfe nur nach diesen Feldern, nicht nach „irgendein Adminbereich“.

    - ``can_manage_results``: Ergebnisse irgendwo in diesem Turnier (auch nur für einzelne Spiele) - dafür öffnen Web
      und App die Turnierleitung am Handy (#1156).
    - ``can_manage_all_results`` / ``can_plan_matches``: für **alle** Spiele - nur mit Einsatz für das ganze Turnier.
      Ist der Einsatz an Spiel, Phase, Gruppe oder Station gebunden, steht er in ``staff_scopes``; das Web zeigt die
      Knöpfe dann nur bei den Spielen, die er abdeckt (wie ``has_match_result_permission`` und ``PATCH /matches``).
    - Check-in der Anmeldungen, Teilnehmer und die Werkzeuge zum Lesen prüft der Server ohne Scope - hier ebenso.
    In einer Staffel entscheiden die Liga-Rechte (``league_capabilities``, ``can_edit_staffel``, #2203)."""
    context = await _league_context(tournament_id)
    if context is not None:
        return await _staffel_rights(user, tournament_id, context)
    lead = is_global_tournament_admin(user)

    async def allowed(roles: set[str], scope: str | None = None) -> bool:
        return lead or await has_tournament_staff_permission(user, tournament_id, roles, scope)

    return {
        "can_manage_results": await allowed(RESULT_STAFF_ROLES),
        "can_manage_all_results": await allowed(RESULT_STAFF_ROLES, "tournament"),
        "can_plan_matches": await allowed(CHECKIN_STAFF_ROLES, "tournament"),
        "can_manage_structure": await allowed(STRUCTURE_STAFF_ROLES, "tournament"),
        "can_check_in": await allowed(CHECKIN_STAFF_ROLES),
        "can_manage_participants": await allowed(PARTICIPANT_STAFF_ROLES),
        "can_assign_stations": await allowed(STATION_ASSIGN_ROLES, "tournament"),
        "can_use_staff_tools": await allowed(READ_STAFF_ROLES),
        "staff_scopes": [] if lead or not user else await _scoped_rights(user, tournament_id),
    }


async def _staffel_rights(user: dict | None, tournament_id: str, context: dict) -> dict:
    capabilities = await league_permissions.capabilities_of(get_db(), user, context.get("league_id"))
    reads = bool(capabilities) or await _assignment_permission(user, tournament_id, READ_STAFF_ROLES, None, None)
    return {
        "can_manage_results": "results" in capabilities,
        "can_manage_all_results": "results" in capabilities,
        "can_plan_matches": "matches" in capabilities,
        "can_manage_structure": "season" in capabilities,
        "can_check_in": "matches" in capabilities,
        "can_manage_participants": "applications" in capabilities,
        "can_assign_stations": "matches" in capabilities,
        "can_use_staff_tools": reads,
        "staff_scopes": [],
        "league_capabilities": sorted(capabilities),
        "can_edit_staffel": "manage" in capabilities,
    }


async def _scoped_rights(user: dict, tournament_id: str) -> list[dict]:
    """Einsätze, die an einen Teil des Turniers gebunden sind: Ergebnisse gelten für Spiel, Phase, Gruppe oder Station
    (``has_match_result_permission``), Termin und Station eines Spiels nur für genau dieses Spiel (``PATCH /matches``,
    Scope „match“)."""
    db = get_db()
    rows = await db.tournament_staff_assignments.find(
        {"tournament_id": tournament_id, "user_id": user["id"], "is_active": {"$ne": False}, "scope": {"$nin": [None, "tournament"]}},
        {"_id": 0, "role": 1, "scope": 1, "scope_id": 1},
    ).to_list(200)
    scopes = []
    for row in rows:
        # Ohne scope_id gilt der Einsatz - wie in den Wächtern - für jedes Spiel, das diesen Teil hat.
        results = row.get("role") in RESULT_STAFF_ROLES
        plan = row.get("scope") == "match" and row.get("role") in CHECKIN_STAFF_ROLES
        if results or plan:
            scopes.append({"scope": row["scope"], "scope_id": row.get("scope_id"), "results": results, "plan": plan})
    return scopes


async def has_match_result_permission(user: dict | None, match: dict, *, capability="results") -> bool:
    """Return whether a user may enter the result for one concrete match.

    Keep the scope rules in one place so legacy and v2 routes, dashboards and
    operational match lists cannot drift apart.

    In einer Liga-Staffel (#2203) zählen nur die Liga-Rechte (``capability``), kein Helfer-Einsatz. Die Befangenheit prüft
    ``league_permissions.require_no_conflict`` an den Stellen, die entscheiden.
    """
    if not user or not match.get("tournament_id"):
        return False
    tournament_id = match["tournament_id"]
    context = await _league_context(tournament_id)
    if context is not None:
        return await league_permissions.can(user, capability, context.get("league_id"))
    if is_global_tournament_staff(user):
        return True
    checks = [
        ("tournament", None),
        ("match", match.get("id")),
        ("stage", match.get("stage_id")),
        ("group", match.get("group_id")),
        ("station", match.get("station_id")),
    ]
    for scope, scope_id in checks:
        if scope != "tournament" and not scope_id:
            continue
        if await _assignment_permission(user, tournament_id, RESULT_STAFF_ROLES, scope, scope_id):
            return True
    return False


def _assignment_covers_match(assignment: dict, match: dict) -> bool:
    scope = assignment.get("scope") or "tournament"
    scope_id = assignment.get("scope_id")
    if scope == "tournament" or not scope_id:
        return True
    field = {"match": "id", "stage": "stage_id", "group": "group_id", "station": "station_id"}.get(scope)
    return bool(field and match.get(field) == scope_id)


async def result_staff_user_ids(db, match: dict) -> set[str]:
    """Wer für dieses Spiel Ergebnisse eintragen darf - und deshalb von Streitfällen erfährt (#1132, #1134): die
    Turnierleitung über alle Turniere und die Helfer mit Ergebnis-Recht, deren Einsatz das Spiel umfasst (ganzes
    Turnier, Phase, Gruppe, Station oder genau dieses Spiel). Dieselbe Regel wie ``has_match_result_permission`` -
    die Turnierleitung als Rolle oder als Freigabe (#1350). In einer Staffel (#2203): wer dort Ergebnisse oder Proteste
    entscheidet, nicht die Turnierleitung und keine Helfer."""
    from services.permissions import tournament_lead_filter

    context = await _league_context(match.get("tournament_id"), db)
    if context is not None:
        return await league_permissions.staff_user_ids(db, context.get("league_id"), ("results", "disputes"))
    users = await db.users.find(
        {**tournament_lead_filter(), "is_active": {"$ne": False}, "is_banned": {"$ne": True}},
        {"_id": 0, "id": 1},
    ).to_list(200)
    ids = {row["id"] for row in users if row.get("id")}
    if match.get("tournament_id"):
        assignments = await db.tournament_staff_assignments.find(
            {"tournament_id": match["tournament_id"], "is_active": {"$ne": False}, "role": {"$in": sorted(RESULT_STAFF_ROLES)}},
            {"_id": 0, "user_id": 1, "scope": 1, "scope_id": 1},
        ).to_list(500)
        ids.update(row["user_id"] for row in assignments if row.get("user_id") and _assignment_covers_match(row, match))
    return ids


async def tournament_lead_user_ids(db, tournament_id: str | None, capabilities=("matches", "results", "disputes", "manage")) -> set[str] | None:
    """Empfänger von Meldungen an „die Leitung“: in einer Staffel die Liga-Rechte - ``None`` bei normalen Turnieren, dort
    bleibt die Abfrage des Aufrufers."""
    context = await _league_context(tournament_id, db)
    if context is None:
        return None
    return await league_permissions.staff_user_ids(db, context.get("league_id"), capabilities)


async def leads_tournament(user: dict | None, tournament_id: str | None, capability=ANY) -> bool:
    """Leitet die angemeldete Person dieses eine Turnier? Normales Turnier: Bereich Turnierleitung mit Zwei-Faktor; Staffel:
    das Liga-Recht. Ersetzt ``is_confirmed_tournament_lead``, wo das Turnier bekannt ist und Staffeln vorkommen."""
    context = await _league_context(tournament_id)
    if context is not None:
        return await league_permissions.can(user, capability, context.get("league_id"))
    return is_confirmed_tournament_lead(user)


async def require_tournament_lead(user: dict | None, tournament_id: str | None, capability) -> None:
    """Für Routen, die bei normalen Turnieren den Bereich Turnierleitung verlangen (``require_admin``): dieselbe Antwort wie
    bisher, in einer Staffel stattdessen das Liga-Recht."""
    context = await _league_context(tournament_id)
    if context is not None:
        if await league_permissions.can(user, capability, context.get("league_id")):
            return
        raise await league_permissions.refuse(get_db(), user, context.get("league_id"))
    reason = await area_refusal(user, ("tournaments",))
    if reason:
        raise HTTPException(status_code=403, detail=reason)


async def require_lead_for_staffel(user: dict | None, tournament_id: str | None, capability="manage") -> None:
    """Für Wege am Bereich Turnierleitung, die ein Turnier nennen (Zugangslinks, TV-Schlüssel, Stationen): Bei einer Staffel
    braucht es zusätzlich das Liga-Recht. Normale Turniere bleiben, wie sie sind."""
    context = await _league_context(tournament_id)
    if context is not None and not await league_permissions.can(user, capability, context.get("league_id")):
        raise await league_permissions.refuse(get_db(), user, context.get("league_id"))


async def require_tournament_staff_permission(
    user: dict | None,
    tournament_id: str,
    allowed_roles: set[str] | None = None,
    scope: str | None = None,
    scope_id: str | None = None,
    *,
    capability=None,
) -> None:
    if await has_tournament_staff_permission(user, tournament_id, allowed_roles, scope, scope_id, capability=capability):
        return
    context = await _league_context(tournament_id)
    if context is not None:
        raise await league_permissions.refuse(get_db(), user, context.get("league_id"))
    if lead_without_second_factor(user):
        raise HTTPException(status_code=403, detail=MFA_MESSAGE)
    raise HTTPException(status_code=403, detail="Keine Turnierberechtigung für diese Aktion")
