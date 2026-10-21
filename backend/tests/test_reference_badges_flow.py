"""Abzeichen aus externen Wettbewerben (#1750): „Podest extern“ und „Dauerbrenner“ - nur Abzeichen, keine Punkte in der
Jahreswertung (Entscheidung des Obmanns). Gezählt wird aus den Referenzen: je Eintrag, in dem die Person steht.
Nur erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import achievement_catalog as catalog  # noqa: E402
import badges  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import achievement_counters as counters  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


async def _count(user_id: str, key: str) -> int:
    return (await counters.compute(user_id, {key}, legacy=False))[key]


def _ref(ref_id, entries, **extra):
    return {"id": ref_id, "title": f"Probe {ref_id}", "is_active": True, "status": "completed", "entries": entries,
            **extra}


async def _seed(flow):
    user = await flow.add_user(role="user", name="probe-alpha")
    await flow.db.club_member_profiles.insert_one(
        {"id": "profil-alpha", "user_id": user["id"], "display_name": "Probe Alpha", "is_active": True})
    team = {"kind": "team", "team_name": "Probe Löwen", "member_profile_ids": ["profil-alpha", "profil-beta"]}
    solo = {"kind": "solo", "member_profile_ids": ["profil-alpha"]}
    await flow.db.references.insert_many([
        # Saison mit Teamplatz 2 und Fahrerplatz 3 - zwei Podeste, eine Saison.
        _ref("saison-2026", [{**team, "placement": 2}, {**solo, "placement": 3}], series_id="serie-2026"),
        # Saison ohne Podest - zählt als Saison, nicht als Podest.
        _ref("saison-2025", [{**team, "placement": 6, "team_count": 8}], series_id="serie-2025"),
        # Abgebrochene Saison: ohne Platz kein Podest und keine zu Ende gespielte Saison.
        _ref("saison-abgebrochen", [{**team, "placement": None}], series_id="serie-abgebrochen"),
        # Einzelnes Turnier: Podest ja, Saison nein.
        _ref("cup", [{**team, "placement": 1}]),
        # Laufend, inaktiv oder ohne die Person: zählt nicht.
        _ref("laufend", [{**team, "placement": 1}], status="active", series_id="serie-laufend"),
        _ref("inaktiv", [{**team, "placement": 1}], is_active=False),
        _ref("andere", [{"kind": "team", "team_name": "Fremd", "member_profile_ids": ["profil-beta"],
                         "placement": 1}]),
    ])
    return user


@pytest.mark.asyncio
async def test_external_podiums_count_each_own_entry_on_the_podium(flow):
    user = await _seed(flow)
    assert await _count(user["id"], "external_podiums") == 3


@pytest.mark.asyncio
async def test_finished_external_seasons_count_once_per_season_reference(flow):
    user = await _seed(flow)
    assert await _count(user["id"], "external_seasons") == 2


@pytest.mark.asyncio
async def test_two_references_of_one_season_count_once(flow):
    """Prüfung 21.10.: eine Saison zählt einmal - auch wenn eine alte Referenz von Hand dazu verknüpft ist."""
    user = await _seed(flow)
    await flow.db.references.insert_one(_ref("saison-2026-hand", [
        {"kind": "team", "team_name": "Probe Löwen", "member_profile_ids": ["profil-alpha"], "placement": 5}],
        series_id="serie-2026"))
    assert await _count(user["id"], "external_seasons") == 2


@pytest.mark.asyncio
async def test_without_club_profile_nothing_counts(flow):
    await _seed(flow)
    stranger = await flow.add_user(role="user", name="probe-gast")
    assert await _count(stranger["id"], "external_podiums") == 0
    assert await _count(stranger["id"], "external_seasons") == 0


def test_badges_are_club_badges_recounted_when_the_club_changes():
    groups = {group["code"]: group for group in catalog.ACHIEVEMENT_GROUPS}
    for code, key, name in (("external_podium", "external_podiums", "Podest extern"),
                            ("external_seasons", "external_seasons", "Dauerbrenner")):
        group = groups[code]
        assert (group["name"], group["category"], group["condition_key"]) == (name, "club", key)
        assert group["member_only"] is True and catalog.CONDITION_KEY_STATUS[key] == "live"
        assert counters.REGISTRY[key].sources == frozenset({"club"})
        tiers = [tier for tier in catalog.ACHIEVEMENT_TIERS if tier["group_code"] == code]
        assert tiers and all(tier["member_only"] for tier in tiers)
