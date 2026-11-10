"""Abzeichen nach der Anmeldung (#1871): nur die betroffenen Zähler, ohne den alten Block.

Seit #1859 läuft die Auswertung nach der Antwort - sie rechnete aber weiter den ganzen alten Block (Spiele, Plätze,
Mitgliedschaft, Profil) und belastete so den Server, während am Einlass weitere Gäste Codes einlösten und sich
abmeldeten. Jetzt rechnet die Anmeldung nur die Zähler der Anmeldung (schnelle Anmeldung, Grand Prix). Kein Abzeichen
geht verloren: Das Abzeichen der Anmeldung („Schnell dabei“) kommt sofort, alles
andere im vollen Lauf (nächtlicher Abgleich bzw. jede Auswertung ohne Quelle).

Seit #2337 zählen Turnierveteran, Multitalent und Formatvielfalt die Teilnahme, nicht mehr die Anmeldung: Wer sich
anmeldet, hat noch nicht gespielt. Diese drei Zähler rechnet der Anmelde-Pfad deshalb gar nicht mehr - sie laden Spiele
und Teams und kommen mit dem ersten Ergebnis.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import achievement_play as play  # noqa: E402
from flow_harness import make_flow  # noqa: E402
import achievement_catalog as catalog  # noqa: E402
import badges  # noqa: E402
from models import now_utc  # noqa: E402
from services import achievement_counters as counters  # noqa: E402
from services import achievement_participation  # noqa: E402
from services import achievement_progress  # noqa: E402

PARTICIPATION_KEYS = ("tournaments_registered", "distinct_games_registered", "distinct_formats")


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


async def first_tiers(flow, key: str) -> set[str]:
    rows = await flow.db.achievements.find(
        {"condition_key": key, "progress_target": 1, "manual_only": {"$ne": True}}, {"_id": 0},
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
    fast = await first_tiers(flow, "fast_registrations")
    veteran = await first_tiers(flow, "tournaments_registered")
    assert fast and veteran, "der Katalog kennt ein Abzeichen für die schnelle Anmeldung und eines für das erste Turnier"
    profile_tier = await add_profile_tier(flow)
    anna = await flow.add_user(name="Anna")
    await flow.db.users.update_one({"id": anna["id"]}, {"$set": {"bio": "Spielt gern Mario Kart."}})
    opened = now_utc() - timedelta(minutes=2)
    tournament = await flow.create_tournament(max_participants=8, game_id="mk8", format="single_elim",
                                              registration_opens_at=opened.isoformat())
    registration = await flow.register(tournament, anna)
    await flow.db.tournament_registrations.update_one({"id": registration["id"]}, {"$set": {"created_at": now_utc().isoformat()}})

    legacy_calls = []
    real_legacy = achievement_progress.compute_user_progress

    async def counted(user_id):
        legacy_calls.append(user_id)
        return await real_legacy(user_id)

    monkeypatch.setattr(achievement_progress, "compute_user_progress", counted)
    loads = []
    real_load = achievement_participation.load_participation

    async def watched(db, user_id):
        loads.append(user_id)
        return await real_load(db, user_id)

    monkeypatch.setattr(achievement_participation, "load_participation", watched)

    await badges.on_tournament_registered(anna["id"], tournament["id"])
    assert loads == [], "die Anmeldung lädt weder Spiele noch Teams"

    mine = await earned(flow, anna)
    assert fast <= mine, f"das Abzeichen der Anmeldung kommt sofort: {sorted(mine)}"
    assert legacy_calls == [], "die Anmeldung rechnet den alten Block nicht mehr"
    assert profile_tier not in mine, "Altbestand gehört in den vollen Lauf"
    assert not veteran & mine, "angemeldet ist noch nicht gespielt (#2337)"
    values = await counters.stats(anna["id"], max_age_seconds=10**9)
    assert values["fast_registrations"] == 1
    assert [values[key] for key in PARTICIPATION_KEYS] == [0, 0, 0]

    # Der volle Lauf (nächtlicher Abgleich) holt den Altbestand nach.
    result = await counters.reconcile()
    assert result["checked"] >= 1
    assert profile_tier in await earned(flow, anna), "der volle Lauf vergibt den Altbestand"


@pytest.mark.asyncio
async def test_first_played_match_brings_the_tournament_badge(flow):
    """Turnierveteran I kommt mit dem ersten echten Spiel - über dieselbe Auswertung, die ein Ergebnis auslöst."""
    veteran = await first_tiers(flow, "tournaments_registered")
    anna, bert = await flow.add_user(name="Anna"), await flow.add_user(name="Bert")
    staff, tournament, regs = await play.cup_for(flow, [anna, bert], game_id="mk8")
    await badges.evaluate_user_progress(anna["id"], {"match", "tournament"})
    assert not veteran & await earned(flow, anna)

    [match] = await play.open_matches(flow, tournament)
    await play.decide(flow, staff, match, regs[0]["id"])
    for person in (anna, bert):
        await badges.evaluate_user_progress(person["id"], {"match", "tournament"})
        assert veteran <= await earned(flow, person), person["username"]


@pytest.mark.asyncio
async def test_participation_counters_match_the_legacy_block(flow):
    """Die Zähler der Registry rechnen genau wie der alte Block - sonst sprängen die Werte zwischen Teil- und Nachtlauf.
    Zum Anmelde-Pfad gehören sie nicht mehr; ein Ergebnis oder der Turnierabschluss rechnet sie."""
    anna, bert = await flow.add_user(name="Anna"), await flow.add_user(name="Bert")
    for game, fmt in (("mk8", "single_elim"), ("mk8", "double_elim"), ("fifa", "single_elim")):
        await play.played_cup(flow, [anna, bert], game_id=game, format=fmt)
    # Nur angemeldet (Warteliste bzw. noch nicht gespielt) zählt in keinem der beiden Läufe.
    for game, fmt, status in ((None, None, "waitlist"), ("tekken", "swiss", "approved")):
        tournament = await flow.create_tournament(game_id=game, format=fmt)
        await flow.register(tournament, anna, status=status)

    legacy = await achievement_progress.compute_user_progress(anna["id"])
    on_registration = counters.keys_for_sources({"registration"})
    assert on_registration == {"fast_registrations", "grand_prix_entries"}, "nur was eine Anmeldung ändert"
    for source in ("match", "tournament"):
        assert set(PARTICIPATION_KEYS) <= counters.keys_for_sources({source}), source
    partial = await counters.compute(anna["id"], set(PARTICIPATION_KEYS), legacy=False)

    assert [legacy[key] for key in PARTICIPATION_KEYS] == [3, 2, 2]
    for key in PARTICIPATION_KEYS:
        assert partial[key] == legacy[key], key
