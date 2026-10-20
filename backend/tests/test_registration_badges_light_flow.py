"""Abzeichen nach der Anmeldung (#1871): nur die betroffenen Zähler, ohne den alten Block.

Seit #1859 läuft die Auswertung nach der Antwort - sie rechnete aber weiter den ganzen alten Block (Spiele, Plätze,
Mitgliedschaft, Profil) und belastete so den Server, während am Einlass weitere Gäste Codes einlösten und sich
abmeldeten. Jetzt rechnet die Anmeldung nur die Zähler der Anmeldung (Anmeldungen, Spiele, Formate, schnelle
Anmeldung, Grand Prix). Kein Abzeichen geht verloren: Das Anmelde-Abzeichen kommt sofort, alles andere im vollen Lauf
(nächtlicher Abgleich bzw. jede Auswertung ohne Quelle).
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
import achievement_catalog as catalog  # noqa: E402
import badges  # noqa: E402
from services import achievement_counters as counters  # noqa: E402
from services import achievement_progress  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


async def earned(flow, user: dict) -> set[str]:
    return {row["tier_code"] async for row in flow.db.user_achievements.find({"user_id": user["id"]}, {"_id": 0})}


async def first_registration_tiers(flow) -> set[str]:
    rows = await flow.db.achievements.find(
        {"condition_key": "tournaments_registered", "progress_target": 1, "manual_only": {"$ne": True}}, {"_id": 0},
    ).to_list(20)
    return {row["code"] for row in rows}


async def add_profile_tier(flow) -> str:
    """Eine Stufe, die nur der alte Block kennt (Profil-Vollständigkeit) - der Altbestand der Person."""
    await flow.db.achievement_groups.insert_one({
        "code": "profile_test", "id": "profile_test", "name": "Profil", "category": "community", "public": True,
        "is_special": False, "is_negative": False, "icon": "user", "accent_color": "#fff", "description": "",
        "sort_order": 5,
    })
    await flow.db.achievements.insert_one(
        catalog.tier("profile_test_1", "profile_test", "bronze", "Profil I", "Profil angefangen.",
                     condition_key="profile_completeness", progress_target=1) | {"id": "profile_test_1"})
    return "profile_test_1"


@pytest.mark.asyncio
async def test_registration_awards_its_badge_at_once_without_the_legacy_block(flow, monkeypatch):
    first = await first_registration_tiers(flow)
    assert first, "der Katalog kennt ein Abzeichen für die erste Anmeldung"
    profile_tier = await add_profile_tier(flow)
    anna = await flow.add_user(name="Anna")
    await flow.db.users.update_one({"id": anna["id"]}, {"$set": {"bio": "Spielt gern Mario Kart."}})
    tournament = await flow.create_tournament(max_participants=8, game_id="mk8", format="single_elim")
    await flow.register(tournament, anna)

    legacy_calls = []
    real_legacy = achievement_progress.compute_user_progress

    async def counted(user_id):
        legacy_calls.append(user_id)
        return await real_legacy(user_id)

    monkeypatch.setattr(achievement_progress, "compute_user_progress", counted)

    await badges.on_tournament_registered(anna["id"], tournament["id"])

    mine = await earned(flow, anna)
    assert first <= mine, f"das Anmelde-Abzeichen kommt sofort: {sorted(mine)}"
    assert legacy_calls == [], "die Anmeldung rechnet den alten Block nicht mehr"
    assert profile_tier not in mine, "Altbestand gehört in den vollen Lauf"
    values = await counters.stats(anna["id"], max_age_seconds=10**9)
    assert values["tournaments_registered"] == 1
    assert values["distinct_games_registered"] == 1 and values["distinct_formats"] == 1

    # Der volle Lauf (nächtlicher Abgleich) holt den Altbestand nach.
    result = await counters.reconcile()
    assert result["checked"] >= 1
    assert profile_tier in await earned(flow, anna), "der volle Lauf vergibt den Altbestand"


@pytest.mark.asyncio
async def test_registration_counters_match_the_legacy_block(flow):
    """Die leichten Zähler rechnen genau wie der alte Block - sonst sprängen die Werte zwischen An- und Nachtlauf."""
    anna = await flow.add_user(name="Anna")
    for game, fmt in (("mk8", "single_elim"), ("mk8", "double_elim"), ("fifa", "single_elim"), (None, None)):
        tournament = await flow.create_tournament(game_id=game, format=fmt)
        await flow.register(tournament, anna, status="waitlist" if game is None else "approved")

    legacy = await achievement_progress.compute_user_progress(anna["id"])
    light = await counters.compute(anna["id"], counters.keys_for_sources({"registration"}), legacy=False)

    for key in ("tournaments_registered", "distinct_games_registered", "distinct_formats"):
        assert light[key] == legacy[key], key
    assert {"fast_registrations", "grand_prix_entries"} <= set(light)
