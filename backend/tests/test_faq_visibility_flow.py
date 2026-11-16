"""FAQ (#2448): Wer sieht welche Fragen? Die Prüfung läuft am Server - durch die echte Anwendung (flow_harness).

Entscheidung Fabian 16.11.: Mitglieder-Fragen sehen nur Mitglieder, Fragen der Turnierleitung nur Personen mit
Leitungsrechten. Gast, angemeldet ohne Mitgliedschaft, Mitglied, Turnierleitung - auch negativ: ohne Zwei-Faktor zählt
die Turnierleitung nicht, eine beendete Mitgliedschaft auch nicht. Erfundene Daten, keine echten Personen.
"""
import json
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import faq_protected  # noqa: E402

FRONTEND_HILFE = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "hilfe"
MEMBER_IDS = {q["id"] for q in faq_protected.PROTECTED_QUESTIONS if q["sichtbar_fuer"] == "mitglied"}
LEAD_IDS = {q["id"] for q in faq_protected.PROTECTED_QUESTIONS if q["sichtbar_fuer"] == "turnierleitung"}


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


@pytest.mark.asyncio
async def test_guest_gets_nothing_protected(flow):
    body, ids = await faq_as(flow, None)
    assert ids == set()
    assert body["darf"] == {"angemeldet": False, "mitglied": False, "turnierleitung": False}


@pytest.mark.asyncio
async def test_signed_in_without_membership_gets_nothing_protected(flow):
    player = await flow.add_user(role="player", name="Spieler ohne Verein")
    body, ids = await faq_as(flow, player)
    assert ids == set()
    assert body["darf"] == {"angemeldet": True, "mitglied": False, "turnierleitung": False}


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
    assert MEMBER_IDS and ids == MEMBER_IDS
    assert not ids & LEAD_IDS
    assert body["darf"] == {"angemeldet": True, "mitglied": True, "turnierleitung": False}
    # Die Antwort bringt den Inhalt mit - Frage, Antwort, Bereich -, nicht nur die Kennungen.
    shift = next(question for question in body["fragen"] if question["id"] == "helferdienst-eintragen")
    assert shift["bereich"] == "helferdienste" and "Ich helfe" in shift["antwort"]


@pytest.mark.asyncio
async def test_tournament_lead_gets_lead_questions_but_not_member_ones(flow):
    lead = await flow.add_user(role="tournament_admin", name="Turnierleitung")
    body, ids = await faq_as(flow, lead)
    assert LEAD_IDS and ids == LEAD_IDS
    assert body["darf"] == {"angemeldet": True, "mitglied": False, "turnierleitung": True}


@pytest.mark.asyncio
async def test_tournament_lead_without_two_factor_gets_no_lead_questions(flow):
    lead = await flow.add_user(role="tournament_admin", name="Leitung ohne Zwei-Faktor")
    lead.update({"mfa_enabled": False, "auth_mfa_verified": False})
    await flow.db.users.update_one({"id": lead["id"]}, {"$set": {"mfa_enabled": False, "auth_mfa_verified": False}})
    body, ids = await faq_as(flow, lead)
    assert ids == set()
    assert body["darf"]["turnierleitung"] is False


@pytest.mark.asyncio
async def test_tournament_area_by_grant_counts_and_member_lead_sees_both(flow):
    granted = await flow.add_user(role="player", name="Freigabe Turnierleitung")
    granted["areas"] = ["tournaments"]
    await flow.db.users.update_one({"id": granted["id"]}, {"$set": {"areas": ["tournaments"]}})
    await flow.db.memberships.insert_one({"user_id": granted["id"], "member_status": "active"})
    _, ids = await faq_as(flow, granted)
    assert ids == MEMBER_IDS | LEAD_IDS


def test_unknown_visibility_is_never_shown():
    assert faq_protected.allowed("alle", {}) is True
    assert faq_protected.allowed("vorstand", {"angemeldet": True, "mitglied": True, "turnierleitung": True}) is False
    assert faq_protected.allowed("mitglied", {"mitglied": False}) is False


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
        assert question["frage"].endswith("?") and question["antwort"]
    # Nichts Geschütztes im Frontend: keine geschützte Frage, keine Antwort daraus in irgendeiner Datei unter src/hilfe.
    texts = "\n".join(path.read_text(encoding="utf-8") for path in FRONTEND_HILFE.rglob("*.json"))
    for question in faq_protected.PROTECTED_QUESTIONS:
        assert question["antwort"] not in texts and question["frage"] not in texts, question["id"]
