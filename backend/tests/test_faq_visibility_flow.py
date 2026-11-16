"""FAQ (#2448): Wer sieht welche Fragen? Die Prüfung läuft am Server - durch die echte Anwendung (flow_harness).

Entscheidung Fabian 16.11.: Mitglieder-Fragen sehen nur Mitglieder, Fragen der Turnierleitung nur Personen mit
Leitungsrechten. Gast, angemeldet ohne Mitgliedschaft, Mitglied, Turnierleitung - auch negativ: ohne Zwei-Faktor zählt
die Turnierleitung nicht, eine beendete Mitgliedschaft auch nicht.

Review F2: Die Leitungsansicht eines Turniers öffnen auch Helfer mit aktivem Einsatz und die Liga-Leitung - sie sehen
die Leitungs-Fragen, aber nicht die mit Weg über die Verwaltung (Stufe „turnierleitung_verwaltung“). Ein beendeter
Einsatz zählt nicht. Erfundene Daten, keine echten Personen.
"""
import json
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id  # noqa: E402
from services import faq_protected  # noqa: E402

FRONTEND_HILFE = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "hilfe"
MEMBER_IDS = {q["id"] for q in faq_protected.PROTECTED_QUESTIONS if q["sichtbar_fuer"] == "mitglied"}
LEAD_IDS = {q["id"] for q in faq_protected.PROTECTED_QUESTIONS if q["sichtbar_fuer"] == "turnierleitung"}
ADMIN_LEAD_IDS = {q["id"] for q in faq_protected.PROTECTED_QUESTIONS if q["sichtbar_fuer"] == "turnierleitung_verwaltung"}
NOTHING = {"angemeldet": False, "mitglied": False, "turnierleitung": False, "turnierleitung_verwaltung": False}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def faq_as(flow, user):
    flow.act_as(user)
    response = await flow.get("/api/faq")
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    body = response.json()
    return body, {question["id"] for question in body["fragen"]}


async def helper(flow, *, active=True, role="referee"):
    person = await flow.add_user(role="player", name="Helferin")
    await flow.db.tournament_staff_assignments.insert_one({
        "id": new_id(), "tournament_id": "t-faq", "user_id": person["id"], "role": role, "scope": "tournament",
        "is_active": active,
    })
    return person


def test_both_lead_levels_have_questions():
    assert MEMBER_IDS and LEAD_IDS and ADMIN_LEAD_IDS
    # Fragen mit Weg über die Verwaltung (Link nach /admin) sehen nur Personen mit dem Bereich.
    for question in faq_protected.PROTECTED_QUESTIONS:
        if str((question.get("link") or {}).get("to", "")).startswith("/admin"):
            assert question["sichtbar_fuer"] == "turnierleitung_verwaltung", question["id"]


@pytest.mark.asyncio
async def test_guest_gets_nothing_protected(flow):
    body, ids = await faq_as(flow, None)
    assert ids == set()
    assert body["darf"] == NOTHING


@pytest.mark.asyncio
async def test_signed_in_without_membership_gets_nothing_protected(flow):
    player = await flow.add_user(role="player", name="Spieler ohne Verein")
    body, ids = await faq_as(flow, player)
    assert ids == set()
    assert body["darf"] == {**NOTHING, "angemeldet": True}


@pytest.mark.asyncio
async def test_ended_membership_counts_as_none(flow):
    former = await flow.add_user(role="player", name="Früheres Mitglied")
    await flow.db.memberships.insert_one({"user_id": former["id"], "member_status": "former"})
    _, ids = await faq_as(flow, former)
    assert ids == set()


@pytest.mark.asyncio
async def test_member_gets_member_questions_but_not_the_lead(flow):
    member = await flow.add_user(role="player", name="Vereinsmitglied")
    await flow.db.memberships.insert_one({"user_id": member["id"], "member_status": "active"})
    body, ids = await faq_as(flow, member)
    assert ids == MEMBER_IDS
    assert body["darf"] == {**NOTHING, "angemeldet": True, "mitglied": True}
    # Die Antwort bringt den Inhalt mit - Frage, Antwort, Bereich -, nicht nur die Kennungen.
    shift = next(question for question in body["fragen"] if question["id"] == "helferdienst-eintragen")
    assert shift["bereich"] == "helferdienste" and "Ich helfe" in shift["antwort"]


@pytest.mark.asyncio
async def test_tournament_lead_gets_all_lead_questions_but_not_member_ones(flow):
    lead = await flow.add_user(role="tournament_admin", name="Turnierleitung")
    body, ids = await faq_as(flow, lead)
    assert ids == LEAD_IDS | ADMIN_LEAD_IDS
    assert body["darf"] == {**NOTHING, "angemeldet": True, "turnierleitung": True, "turnierleitung_verwaltung": True}


@pytest.mark.asyncio
async def test_tournament_lead_without_two_factor_gets_no_lead_questions(flow):
    lead = await flow.add_user(role="tournament_admin", name="Leitung ohne Zwei-Faktor")
    lead.update({"mfa_enabled": False, "auth_mfa_verified": False})
    await flow.db.users.update_one({"id": lead["id"]}, {"$set": {"mfa_enabled": False, "auth_mfa_verified": False}})
    body, ids = await faq_as(flow, lead)
    assert ids == set()
    assert body["darf"]["turnierleitung"] is False and body["darf"]["turnierleitung_verwaltung"] is False


@pytest.mark.asyncio
async def test_tournament_area_by_grant_counts_and_member_lead_sees_both(flow):
    granted = await flow.add_user(role="player", name="Freigabe Turnierleitung")
    granted["areas"] = ["tournaments"]
    await flow.db.users.update_one({"id": granted["id"]}, {"$set": {"areas": ["tournaments"]}})
    await flow.db.memberships.insert_one({"user_id": granted["id"], "member_status": "active"})
    _, ids = await faq_as(flow, granted)
    assert ids == MEMBER_IDS | LEAD_IDS | ADMIN_LEAD_IDS


@pytest.mark.parametrize("role", ["referee", "scorekeeper", "station_manager", "stream_operator", "organizer"])
@pytest.mark.asyncio
async def test_helper_with_active_assignment_sees_the_lead_questions_but_not_the_admin_ones(flow, role):
    person = await helper(flow, role=role)
    body, ids = await faq_as(flow, person)
    assert ids == LEAD_IDS
    assert body["darf"] == {**NOTHING, "angemeldet": True, "turnierleitung": True}


@pytest.mark.asyncio
async def test_helper_with_ended_assignment_sees_nothing_protected(flow):
    person = await helper(flow, active=False)
    body, ids = await faq_as(flow, person)
    assert ids == set()
    assert body["darf"]["turnierleitung"] is False


@pytest.mark.asyncio
async def test_league_staff_sees_the_lead_questions_but_not_the_admin_ones(flow):
    league_lead = await flow.add_user(role="player", name="Liga-Leitung")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": "liga-faq", "user_id": league_lead["id"], "capabilities": ["results"]})
    body, ids = await faq_as(flow, league_lead)
    assert ids == LEAD_IDS
    assert body["darf"]["turnierleitung_verwaltung"] is False


@pytest.mark.asyncio
async def test_leagues_area_counts_and_league_staff_without_two_factor_does_not(flow):
    area = await flow.add_user(role="player", name="Bereich Ligen")
    area["areas"] = ["leagues"]
    await flow.db.users.update_one({"id": area["id"]}, {"$set": {"areas": ["leagues"]}})
    _, ids = await faq_as(flow, area)
    assert ids == LEAD_IDS

    no_mfa = await flow.add_user(role="player", name="Liga ohne Zwei-Faktor")
    no_mfa.update({"mfa_enabled": False, "auth_mfa_verified": False})
    await flow.db.users.update_one({"id": no_mfa["id"]}, {"$set": {"mfa_enabled": False, "auth_mfa_verified": False}})
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": "liga-faq", "user_id": no_mfa["id"], "capabilities": ["results"]})
    _, ids = await faq_as(flow, no_mfa)
    assert ids == set()


def test_unknown_visibility_is_never_shown():
    assert faq_protected.allowed("alle", {}) is True
    assert faq_protected.allowed("vorstand", {"angemeldet": True, "mitglied": True, "turnierleitung": True}) is False
    assert faq_protected.allowed("mitglied", {"mitglied": False}) is False
    assert faq_protected.allowed("turnierleitung_verwaltung", {"turnierleitung": True}) is False


def test_protected_questions_are_well_formed_and_not_in_the_public_bundle():
    public = json.loads((FRONTEND_HILFE / "fragen.json").read_text(encoding="utf-8"))
    areas = {area["id"]: area for area in json.loads((FRONTEND_HILFE / "bereiche.json").read_text(encoding="utf-8"))}
    public_ids = {question["id"] for question in public}
    seen = set()
    for question in faq_protected.PROTECTED_QUESTIONS:
        assert question["id"] not in seen and question["id"] not in public_ids, question["id"]
        seen.add(question["id"])
        assert question["sichtbar_fuer"] in faq_protected.VISIBILITIES and question["sichtbar_fuer"] != "alle"
        assert question["bereich"] in areas, question["id"]
        assert set(question["rollen"]) <= set(faq_protected.ROLES)
        # Rollen der Frage passen zum Bereich (Review F4) - sonst stünde der Bereich unter dem Filter leer da.
        assert set(question["rollen"]) <= set(areas[question["bereich"]]["rollen"]), question["id"]
        assert question["frage"].endswith("?") and question["antwort"]
    # Nichts Geschütztes im Frontend: keine geschützte Frage, keine Antwort daraus in irgendeiner Datei unter src/hilfe.
    texts = "\n".join(path.read_text(encoding="utf-8") for path in FRONTEND_HILFE.rglob("*.json"))
    for question in faq_protected.PROTECTED_QUESTIONS:
        assert question["antwort"] not in texts and question["frage"] not in texts, question["id"]
