"""„Mein Dienst“ (#1352) und Rechte je Turnier (#1353).

- ``/api/users/me/duty``: Helfer sehen genau ihre Turniere und Fast Laps mit ihrer Rolle, heute zuerst; abgeschaltete
  Einsätze und vorbei gegangene Turniere fehlen. Moderation bekommt nur den Zähler der offenen Meldungen, Spieler eine
  leere Antwort, die Turnierleitung zusätzlich alle Turniere von heute.
- ``/api/admin/dashboard`` lädt für jeden Verwaltungsbereich - auch Finanzen (Kassier, #992); ohne Bereich 403.
- ``GET /api/tournaments/<id>`` sagt je Turnier, was die Person darf - dieselben Rollen wie die Wächter der Routen.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def _at(days: float) -> str:
    return (now_utc() + timedelta(days=days)).isoformat()


async def _assign(flow, user, tournament, role, **extra):
    await flow.db.tournament_staff_assignments.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "user_id": user["id"], "role": role,
        "scope": "tournament", "scope_id": None, "is_active": True, **extra,
    })


async def _duty(flow, user) -> dict:
    flow.act_as(user)
    response = await flow.get("/api/users/me/duty")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_helper_sees_exactly_own_tournaments_with_role_today_first(flow):
    helper = await flow.add_user(name="Helfer")
    later = await flow.create_tournament(title="Später", start_date=_at(5))
    today = await flow.create_tournament(title="Heute", start_date=_at(0))
    foreign = await flow.create_tournament(title="Fremd", start_date=_at(0))
    finished = await flow.create_tournament(title="Vorbei", start_date=_at(-3), status="completed")
    switched_off = await flow.create_tournament(title="Abgeschaltet", start_date=_at(0))
    await _assign(flow, helper, later, "stream_operator")
    await _assign(flow, helper, today, "scorekeeper")
    await _assign(flow, helper, today, "referee")
    await _assign(flow, helper, finished, "referee")
    await _assign(flow, helper, switched_off, "referee", is_active=False)
    other = await flow.add_user(name="Andere")
    await _assign(flow, other, foreign, "organizer")
    challenge = {"id": new_id(), "slug": "lap", "title": "Fast Lap", "status": "live", "start_date": _at(1)}
    await flow.db.f1_challenges.insert_one(dict(challenge))
    await flow.db.f1_staff_assignments.insert_one({"id": new_id(), "challenge_id": challenge["id"], "user_id": helper["id"], "role": "scorekeeper", "is_active": True})

    data = await _duty(flow, helper)
    rows = [(row["kind"], row["title"], row["roles"], row["today"]) for row in data["assignments"]]
    assert rows == [
        ("tournament", "Heute", ["referee", "scorekeeper"], True),
        # Die Fast Lap läuft (live) - das zählt als heute, auch wenn der Start später eingetragen ist.
        ("fastlap", "Fast Lap", ["scorekeeper"], True),
        ("tournament", "Später", ["stream_operator"], False),
    ]
    first = data["assignments"][0]
    assert first["url"] == f"/tournaments/{today['slug']}/leitung"
    assert first["admin_url"] == f"/admin/tournaments/{today['id']}"
    assert data["assignments"][1]["url"] == f"/admin/f1/{challenge['id']}"
    assert data["moderation"] is None, "Helfer moderieren nicht"
    assert data["lead_today"] == [], "Helfer sehen keine fremden Turniere"


@pytest.mark.asyncio
async def test_moderation_gets_only_the_report_counter(flow):
    moderator = await flow.add_user(role="moderator", name="Moderation")
    await flow.create_tournament(title="Heute", start_date=_at(0))
    await flow.db.user_reports.insert_many([
        {"id": new_id(), "status": "open"}, {"id": new_id(), "status": "open"}, {"id": new_id(), "status": "resolved"},
    ])
    data = await _duty(flow, moderator)
    assert data == {"assignments": [], "series": [], "moderation": {"open_reports": 2}, "lead_today": []}


@pytest.mark.asyncio
async def test_player_without_duty_gets_an_empty_answer(flow):
    player = await flow.add_user(name="Spieler")
    await flow.create_tournament(title="Heute", start_date=_at(0))
    assert await _duty(flow, player) == {"assignments": [], "series": [], "moderation": None, "lead_today": []}


@pytest.mark.asyncio
async def test_tournament_lead_sees_all_tournaments_of_today(flow):
    lead = await flow.add_user(role="tournament_admin", name="Leitung")
    await flow.create_tournament(title="Heute", start_date=_at(0))
    await flow.create_tournament(title="Läuft seit gestern", start_date=_at(-1), status="live")
    await flow.create_tournament(title="Morgen", start_date=_at(2))
    await flow.create_tournament(title="Entwurf", start_date=_at(0), status="draft")
    data = await _duty(flow, lead)
    assert sorted(row["title"] for row in data["lead_today"]) == ["Heute", "Läuft seit gestern"]
    assert data["moderation"] == {"open_reports": 0}

    # Ohne bestätigte Zwei-Faktor-Anmeldung gibt es die Turniere über alle nicht - wie überall in der Verwaltung.
    lead["auth_mfa_verified"] = False
    assert (await _duty(flow, lead))["lead_today"] == []


async def _with_areas(flow, areas, role="user"):
    person = await flow.add_user(role=role)
    person["areas"] = areas
    await flow.db.users.update_one({"id": person["id"]}, {"$set": {"areas": areas}})
    return person


TOURNAMENT_KEYS = {"team_count", "active_tournaments", "registration_open", "today_matches", "open_disputes", "active_f1",
                   "total_tournaments", "total_f1_challenges", "total_events", "prize_pickups", "tournament_registrations", "today"}
CLUB_KEYS = {"player_count", "membership_applications"}
SYSTEM_KEYS = {"ops", "mobile_push", "client_logs", "discord_broken", "recent_audit_logs"}
# Letzte Adminaktionen: ganz für System, „was wann“ für Turnierleitung, Redaktion und Vereinsverwaltung, nichts für den Kassier.
ALL_TASKS = {"reported_results", "schedule_deadlines", "moderation_reports", "contact_messages", "billing_cases", "sponsors_expiring"}


@pytest.mark.asyncio
async def test_dashboard_gives_each_area_only_its_own_blocks(flow):
    """#1353 nach Codex-Prüfung: der Kassier bekommt die Startseite - aber nur die Finanz-Blöcke, keine Zähler von
    Moderation, Kontakt, Mitgliedern, Turnieren, Betrieb oder Protokoll."""
    await flow.db.audit_logs.insert_one({"id": "a-1", "action": "user.role", "ip": "203.0.113.9", "created_at": "2026-10-13T08:00:00+00:00"})
    cases = [
        ("Kassier", await _with_areas(flow, ["finance"]), {"daily_tasks", "finance_attention"}, {"billing_cases"}),
        ("Redaktion", await _with_areas(flow, ["content"]), {"daily_tasks", "recent_audit_logs"}, {"sponsors_expiring"}),
        ("Kassier und Redaktion", await _with_areas(flow, ["finance", "content"]), {"daily_tasks", "finance_attention", "recent_audit_logs"}, {"billing_cases", "sponsors_expiring"}),
        ("Club-Admin (System)", await flow.add_user(role="club_admin"), {"daily_tasks", "finance_attention", *TOURNAMENT_KEYS, *CLUB_KEYS, *SYSTEM_KEYS}, ALL_TASKS),
        ("Turnierleitung", await flow.add_user(role="tournament_admin"), {"daily_tasks", "recent_audit_logs", *TOURNAMENT_KEYS},
         {"reported_results", "schedule_deadlines", "moderation_reports"}),
        ("Superadmin", await flow.add_user(role="superadmin"), {"daily_tasks", "finance_attention", *TOURNAMENT_KEYS, *CLUB_KEYS, *SYSTEM_KEYS}, ALL_TASKS),
    ]
    for name, person, keys, tasks in cases:
        flow.act_as(person)
        response = await flow.get("/api/admin/dashboard")
        assert response.status_code == 200, (name, response.text)
        data = response.json()
        assert set(data) == keys, name
        assert set(data["daily_tasks"]) == tasks, name
    # Der Superadmin liest das Protokoll ganz (mit Adresse); die Redaktion nur, was wann geschah.
    assert data["recent_audit_logs"][0]["ip"] == "203.0.113.9"
    flow.act_as(cases[1][1])
    assert (await flow.get("/api/admin/dashboard")).json()["recent_audit_logs"] == [{"action": "user.role", "created_at": "2026-10-13T08:00:00+00:00"}]

    # Wachstum (Logins, neue Mitglieder) gehört Vereinsverwaltung und System - nicht dem Kassier.
    flow.act_as(cases[0][1])
    assert (await flow.get("/api/admin/growth-stats?days=7")).status_code == 403
    flow.act_as(cases[-1][1])
    assert (await flow.get("/api/admin/growth-stats?days=7")).status_code == 200

    for role in ("moderator", "user"):
        flow.act_as(await flow.add_user(role=role))
        assert (await flow.get("/api/admin/dashboard")).status_code == 403, role


@pytest.mark.asyncio
async def test_tournament_tells_each_helper_role_what_it_may_do(flow):
    tournament = await flow.create_tournament(title="Rechte")
    whole = {"can_manage_results", "can_manage_all_results", "can_plan_matches", "can_check_in"}
    expected = {
        "organizer": whole | {"can_manage_structure", "can_manage_participants", "can_assign_stations", "can_use_staff_tools"},
        "referee": whole | {"can_manage_structure", "can_manage_participants", "can_assign_stations", "can_use_staff_tools"},
        "scorekeeper": whole | {"can_manage_participants", "can_use_staff_tools"},
        "station_manager": whole | {"can_assign_stations", "can_use_staff_tools"},
        "stream_operator": {"can_use_staff_tools"},
    }
    fields = set().union(*expected.values())
    for role, rights in expected.items():
        helper = await flow.add_user(name=f"helfer-{role}")
        await _assign(flow, helper, tournament, role)
        flow.act_as(helper)
        data = (await flow.get(f"/api/tournaments/{tournament['id']}")).json()
        assert {field for field in fields if data.get(field)} == rights, role

    # Redaktion (anderer Bereich) und Spieler: keine Werkzeuge; die Turnierleitung: alle.
    editor = await flow.add_user(name="Redaktion")
    editor["areas"] = ["content"]
    for person, rights in ((editor, set()), (await flow.add_user(name="Spieler"), set()), (await flow.add_staff(), fields)):
        flow.act_as(person)
        data = (await flow.get(f"/api/tournaments/{tournament['id']}")).json()
        assert {field for field in fields if data.get(field)} == rights, person["display_name"]


@pytest.mark.asyncio
async def test_scoped_assignments_only_cover_their_matches(flow):
    """Nach Codex-Prüfung (#1353): ein Einsatz für ein Spiel oder eine Station setzt nicht die Rechte für alle Spiele.
    Turnierweit heißt alle Spiele; gebunden steht er in ``staff_scopes`` - wie die Wächter je Spiel."""
    tournament = await flow.create_tournament(title="Scope")

    async def rights_for(role, scope, scope_id):
        helper = await flow.add_user(name=f"{role}-{scope}")
        await _assign(flow, helper, tournament, role, scope=scope, scope_id=scope_id)
        flow.act_as(helper)
        return (await flow.get(f"/api/tournaments/{tournament['id']}")).json()

    whole = await rights_for("scorekeeper", "tournament", None)
    assert (whole["can_manage_all_results"], whole["can_plan_matches"], whole["staff_scopes"]) == (True, True, [])

    match_bound = await rights_for("scorekeeper", "match", "m-1")
    assert match_bound["can_manage_results"] is True, "die Turnierleitung am Handy öffnet sich weiter"
    assert (match_bound["can_manage_all_results"], match_bound["can_plan_matches"]) == (False, False)
    assert match_bound["staff_scopes"] == [{"scope": "match", "scope_id": "m-1", "results": True, "plan": True}]

    station_bound = await rights_for("station_manager", "station", "st-1")
    assert (station_bound["can_manage_all_results"], station_bound["can_plan_matches"]) == (False, False)
    assert station_bound["staff_scopes"] == [{"scope": "station", "scope_id": "st-1", "results": True, "plan": False}]

    stream = await rights_for("stream_operator", "match", "m-1")
    assert stream["staff_scopes"] == [] and stream["can_manage_results"] is False

    flow.act_as(await flow.add_staff())
    lead = (await flow.get(f"/api/tournaments/{tournament['id']}")).json()
    assert (lead["can_manage_all_results"], lead["can_plan_matches"], lead["staff_scopes"]) == (True, True, [])
