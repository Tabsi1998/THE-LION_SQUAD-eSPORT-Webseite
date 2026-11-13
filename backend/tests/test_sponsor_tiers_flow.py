"""Sponsorenstufen (#932): fünf Stufen, alte Stufen landen als Bronze, jede Stufe bringt ihre Standard-Platzierung mit,
die Filter Startseite/Fußzeile halten sich daran, und nur die Inhaltsverwaltung legt Sponsoren an.

Ersetzt die alten Live-Tests
test_iter20_bug_hunt.py::TestSponsorTiers (test_all_5_tiers_accepted, test_legacy_tier_rejected_or_normalized,
test_public_sponsors_all_valid_tiers, test_placement_home, test_placement_footer, test_sponsor_update_roundtrip),
test_phase_a_quickwins.py::test_sponsor_tier_system und
test_phase5_badges.py::TestSponsorsCRUD::test_sponsor_create_requires_admin.
Erfundene Firmen, keine echten Sponsoren."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


TIERS = ("main", "platinum", "gold", "silver", "bronze")


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def names(rows):
    return {row["name"] for row in rows}


@pytest.mark.asyncio
async def test_five_tiers_are_accepted_and_bring_their_default_placement(flow):
    flow.act_as(await flow.add_staff())
    created = {}
    for tier in TIERS:
        res = await flow.post("/api/sponsors", json={"name": f"Probefirma {tier}", "tier": tier})
        assert res.status_code == 200, res.text
        created[tier] = res.json()
        assert created[tier]["tier"] == tier

    placement = {tier: (row["show_on_home"], row["show_on_footer"]) for tier, row in created.items()}
    assert placement == {
        "main": (True, True),
        "platinum": (False, True),
        "gold": (False, True),
        "silver": (False, True),
        "bronze": (False, False),
    }

    legacy = await flow.post("/api/sponsors", json={"name": "Probefirma alt", "tier": "supporter"})
    assert legacy.status_code == 422

    # Ausdrücklich gesetzte Platzierung gewinnt gegen den Standard der Stufe.
    explicit = await flow.post("/api/sponsors", json={"name": "Probefirma eigen", "tier": "bronze",
                                                      "show_on_home": True, "show_on_footer": True})
    assert explicit.status_code == 200
    assert (explicit.json()["show_on_home"], explicit.json()["show_on_footer"]) == (True, True)

    flow.act_as(None)
    home = await flow.get("/api/sponsors", params={"placement": "home"})
    assert home.status_code == 200
    assert names(home.json()) == {"Probefirma main", "Probefirma eigen"}

    footer = await flow.get("/api/sponsors", params={"placement": "footer"})
    assert footer.status_code == 200
    assert names(footer.json()) == {"Probefirma main", "Probefirma platinum", "Probefirma gold",
                                    "Probefirma silver", "Probefirma eigen"}

    everyone = await flow.get("/api/sponsors")
    assert everyone.status_code == 200
    assert [row["tier"] for row in everyone.json() if row["name"] != "Probefirma eigen"] == list(TIERS)


@pytest.mark.asyncio
async def test_legacy_tiers_in_the_database_appear_as_bronze(flow):
    for tier in ("supporter", "partner"):
        await flow.db.sponsors.insert_one({"id": new_id(), "name": f"Altfirma {tier}", "tier": tier, "is_active": True})

    flow.act_as(None)
    res = await flow.get("/api/sponsors")
    assert res.status_code == 200
    rows = {row["name"]: row for row in res.json()}
    assert {rows["Altfirma supporter"]["tier"], rows["Altfirma partner"]["tier"]} == {"bronze"}
    assert all(row["tier"] in TIERS for row in res.json())

    footer = await flow.get("/api/sponsors", params={"placement": "footer"})
    assert footer.status_code == 200
    assert names(footer.json()).isdisjoint({"Altfirma supporter", "Altfirma partner"}), "Bronze steht nicht in der Fußzeile"


@pytest.mark.asyncio
async def test_tier_change_shows_in_the_admin_list_and_only_content_admins_create(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    created = await flow.post("/api/sponsors", json={"name": "Probefirma Wechsel", "tier": "bronze"})
    assert created.status_code == 200
    sid = created.json()["id"]

    changed = await flow.patch(f"/api/sponsors/{sid}", json={"name": "Probefirma Silber", "tier": "silver"})
    assert changed.status_code == 200
    assert changed.json()["tier"] == "silver"

    listed = await flow.get("/api/sponsors/admin")
    assert listed.status_code == 200
    row = next(s for s in listed.json() if s["id"] == sid)
    assert (row["name"], row["tier"]) == ("Probefirma Silber", "silver")

    flow.act_as(await flow.add_user(name="mitglied"))
    refused = await flow.post("/api/sponsors", json={"name": "Probefirma fremd", "logo_url": "/x.png"})
    assert refused.status_code == 403
    assert await flow.db.sponsors.count_documents({"name": "Probefirma fremd"}) == 0
