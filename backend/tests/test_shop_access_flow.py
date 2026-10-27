"""Wer sieht den Shop (#1706)? Vier Stufen statt „Aus/Vorschau/Live“ - Entscheidung des Obmanns vom 27.10.2026:

- **Aus**: niemand.
- **Nur Admins (Test)**: Finanzen (Bereich ``finance`` mit Zwei-Faktor - Club-Admin und Superadmin bringen ihn mit).
- **Vereinsmitglieder**: aktive Mitgliedschaft, dazu weiter die Finanzen.
- **Öffentlich**: alle, auch ohne Anmeldung - einschalten nur Superadmin und nur mit der Freigabe „Steuer geklärt“.

Durch die echte Anwendung (flow_harness): Die Stufe setzt der Superadmin über die Admin-Route, gefragt wird der eine
Helfer ``shop_access.can_view_shop``, den die späteren Shop-Seiten (#1712) benutzen. Erfundene Daten, keine echten
Personen."""
import pathlib
import sys

import pytest
import pytest_asyncio
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

CONFIG = "/api/admin/shop/config"
ROLES = ("gast", "spieler", "mitglied", "turnierleitung", "finanzen", "club-admin", "superadmin")
SEES = {
    "off": set(),
    "admins": {"finanzen", "club-admin", "superadmin"},
    "members": {"mitglied", "finanzen", "club-admin", "superadmin"},
    "public": set(ROLES),
}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def people(flow) -> dict:
    player = await flow.add_user(role="player", name="spieler")
    member = await flow.add_user(role="player", name="mitglied")
    await flow.db.memberships.insert_one({"user_id": member["id"], "member_status": "active"})
    lead = await flow.add_user(role="tournament_admin", name="turnierleitung")
    finance = await flow.add_user(role="player", name="kassier")
    await flow.db.users.update_one({"id": finance["id"]}, {"$set": {"areas": ["finance"]}})
    finance["areas"] = ["finance"]
    club_admin = await flow.add_user(role="club_admin", name="clubadmin")
    root = await flow.add_user(role="superadmin", name="root")
    return {"gast": None, "spieler": player, "mitglied": member, "turnierleitung": lead, "finanzen": finance,
            "club-admin": club_admin, "superadmin": root}


async def set_stage(flow, root: dict, stage: str) -> None:
    flow.act_as(root)
    if stage == "public":
        cleared = await flow.put(f"{CONFIG}/tax-clearance", json={"cleared": True, "reason": "Steuerberatung bestätigt"})
        assert cleared.status_code == 200, cleared.text
    answer = await flow.patch(CONFIG, json={"stage": stage, "reason": f"Test der Stufe {stage}"})
    assert answer.status_code == 200, answer.text
    assert answer.json()["config"]["stage"] == stage


async def who_sees(flow, who: dict) -> set[str]:
    from services import shop_access

    return {name for name in ROLES if await shop_access.can_view_shop(flow.db, who[name])}


@pytest.mark.asyncio
async def test_by_default_the_shop_is_off_and_nobody_sees_it(flow):
    who = await people(flow)
    assert await who_sees(flow, who) == set()


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["off", "admins", "members", "public"])
async def test_each_stage_shows_the_shop_to_exactly_its_people(flow, stage):
    who = await people(flow)
    await set_stage(flow, who["superadmin"], stage)
    assert await who_sees(flow, who) == SEES[stage]


@pytest.mark.asyncio
async def test_finance_without_the_second_factor_does_not_count_as_admin(flow):
    who = await people(flow)
    await set_stage(flow, who["superadmin"], "admins")
    from services import shop_access

    for name in ("finanzen", "club-admin", "superadmin"):
        assert not await shop_access.can_view_shop(flow.db, {**who[name], "auth_mfa_verified": False}), name


@pytest.mark.asyncio
async def test_honorary_counts_as_member_but_a_former_member_does_not(flow):
    who = await people(flow)
    await set_stage(flow, who["superadmin"], "members")
    from services import shop_access

    honorary = await flow.add_user(role="player", name="ehrenmitglied")
    await flow.db.memberships.insert_one({"user_id": honorary["id"], "member_status": "honorary"})
    former = await flow.add_user(role="player", name="ausgetreten")
    await flow.db.memberships.insert_one({"user_id": former["id"], "member_status": "former"})
    assert await shop_access.can_view_shop(flow.db, honorary)
    assert not await shop_access.can_view_shop(flow.db, former)
    # Die Anfrage bringt die Mitgliedschaft schon mit (auth.get_current_user) - die zählt auch ohne Nachschlagen.
    assert await shop_access.can_view_shop(flow.db, {"id": "ohne-akte", "role": "player", "is_club_member": True})


@pytest.mark.asyncio
async def test_a_broken_stage_in_the_database_fails_closed(flow):
    from services import shop_access

    who = await people(flow)
    await flow.db.settings.update_one({"id": "shop"}, {"$set": {"id": "shop", "stage": "alle"}}, upsert=True)
    assert await who_sees(flow, who) == set()
    # „Öffentlich“ ohne Steuer-Freigabe (etwa von Hand in der Datenbank) zeigt den Shop niemandem.
    await flow.db.settings.update_one({"id": "shop"}, {"$set": {"stage": "public", "tax_cleared": None}})
    assert await who_sees(flow, who) == set()
    assert not await shop_access.can_view_shop(flow.db, None)


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["off", "admins", "members", "public"])
async def test_the_guard_for_later_shop_pages_answers_404_to_everyone_who_may_not_look(flow, stage):
    """Der Wächter für die späteren Shop-Seiten (#1712): wer den Shop nicht sehen darf, bekommt 404 - der Shop verrät
    nicht, dass es ihn gibt."""
    import auth
    from services import shop_access

    who = await people(flow)
    await set_stage(flow, who["superadmin"], stage)
    app = FastAPI()

    @app.get("/probe")
    async def probe(viewer=Depends(shop_access.require_shop_viewer())):
        return {"ok": True}

    current: dict = {"user": None}
    app.dependency_overrides[auth.get_optional_user] = lambda: current["user"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        for name in ROLES:
            current["user"] = who[name]
            answer = await client.get("/probe")
            assert answer.status_code == (200 if name in SEES[stage] else 404), (stage, name, answer.text)
