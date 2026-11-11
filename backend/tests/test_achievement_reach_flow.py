"""Erreichbare Erfolge (#2339): das Kennzeichen „nicht mehr erreichbar“ (retired), eine Regel für die Anzeige „x von y“,
Kategorie-Meister, Sammler, Geheimnisträger und Hundert Prozent, Comeback und Kartenkenner aus den Maps der Vereinsliga,
Streckenrekord und Eiserner Löwe mit eigenem Kriterium, die Gruppen der Leitung nur für die Leitung und Migration 23.

Jeder Test hat seine Gegenprobe: derselbe Aufbau ohne die Regel (Kennzeichen weg, Stufe fehlt, keine Leitung) zeigt das
alte Verhalten."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
import achievement_catalog as catalog  # noqa: E402
import badges  # noqa: E402
from models import new_id, now_utc  # noqa: E402
from services import achievement_counters as counters  # noqa: E402
from services import achievement_reach as reach  # noqa: E402
from services import achievement_recount as recount  # noqa: E402
from services import achievement_visibility as visibility  # noqa: E402
from services import migrations  # noqa: E402
from services.achievement_core import due_tiers  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        visibility.reset_rarity_cache()
        yield instance
    finally:
        visibility.reset_rarity_cache()
        await shutdown()


async def _member(flow, user):
    await flow.db.memberships.insert_one({"user_id": user["id"], "member_status": "active", "membership_type": "ordinary"})


async def _give(flow, user, *codes):
    """Stufen direkt eintragen - ohne Folge-Auswertung, damit der Test nur zählt, was er hinlegt."""
    rows = []
    for code in codes:
        tier = await flow.db.achievements.find_one({"code": code}, {"_id": 0})
        assert tier, code
        rows.append({"id": new_id(), "user_id": user["id"], "tier_code": code, "group_code": tier["group_code"], "level": tier.get("level"),
                     "material": tier.get("material"), "rank": tier.get("rank"), "earned_at": now_utc().isoformat(), "context": {}})
    if rows:
        await flow.db.user_achievements.insert_many(rows)


async def _reachable_codes(flow, *, category: str | None = None, member: bool = True) -> list[str]:
    groups, tiers = await reach.load_catalog(flow.db)
    out = []
    for tier in tiers.values():
        group = groups.get(tier.get("group_code"))
        if reach.reachable(tier, group, member=member) and (category is None or catalog.category_v2(group.get("category")) == category):
            out.append(tier["code"])
    return sorted(out)


def _group_codes(groups: list[dict]) -> set[str]:
    return {group["code"] for group in groups}


# ------------------------------------------------------------------ 1. Nicht mehr erreichbar


def test_vergabe_ueberspringt_nicht_mehr_erreichbares():
    tiers = [
        {"code": "a_1", "group_code": "a", "condition_key": "k", "progress_target": 1},
        {"code": "b_1", "group_code": "b", "condition_key": "k", "progress_target": 1, "retired": True},
        {"code": "c_1", "group_code": "c", "condition_key": "k", "progress_target": 1},
        {"code": "d_1", "group_code": "d", "condition_key": "k", "progress_target": 1, "available_until": "2020-01-01T00:00:00+00:00"},
        {"code": "e_1", "group_code": "e", "condition_key": "k", "progress_target": 1, "available_until": "2999-01-01T00:00:00+00:00"},
    ]
    due = due_tiers(tiers, {"k": 5}, set(), active_member=True, retired_groups=frozenset({"c"}))
    assert [t["code"] for t in due] == ["a_1", "e_1"]
    # Gegenprobe: ohne Kennzeichen wären alle fällig.
    plain = [{key: value for key, value in t.items() if key not in ("retired", "available_until")} for t in tiers]
    assert len(due_tiers(plain, {"k": 5}, set(), active_member=True)) == 5


@pytest.mark.asyncio
async def test_nicht_mehr_erreichbares_sieht_nur_wer_es_hat(flow):
    holder = await flow.add_user(name="Gruenderin")
    other = await flow.add_user(name="Neue")
    for user in (holder, other):
        await _member(flow, user)
        await flow.db.users.update_one({"id": user["id"]}, {"$set": {"privacy_public_profile": True}})
    awarded = await badges.award_achievement(holder["id"], "founding_member_1")
    assert awarded, "von Hand geht es weiter"

    flow.act_as(other)
    mine = (await flow.get("/api/achievements/me")).json()
    assert "founding_member" not in _group_codes(mine["groups"]) and "grand_prix" not in _group_codes(mine["groups"])
    assert "beta_tester" not in _group_codes(mine["groups"]) and "lan_founder" not in _group_codes(mine["groups"])
    club = (await flow.get("/api/achievements/groups", params={"category": "club", "mine": True})).json()
    assert "founding_member" not in _group_codes(club)
    guest_view = (await flow.get("/api/achievements/groups")).json()
    assert "founding_member" not in _group_codes(guest_view)
    # Im Profil der Person, die ihn hat, steht er - auch für andere.
    profile = (await flow.get(f"/api/achievements/user/{holder['id']}")).json()
    assert "founding_member" in _group_codes(profile["groups"])
    assert any(a["code"] == "founding_member_1" and a["retired"] for a in profile["awards"])

    flow.act_as(holder)
    mine = (await flow.get("/api/achievements/me")).json()
    group = next(g for g in mine["groups"] if g["code"] == "founding_member")
    assert group["retired"] is True and [t["code"] for t in group["tiers"]] == ["founding_member_1"]
    assert group["tiers"][0]["retired"] is True and "Gründungsjahr" in group["tiers"][0]["retired_reason"]

    # Gegenprobe: ohne Kennzeichen sieht ihn wieder jede und jeder.
    await flow.db.achievement_groups.update_one({"code": "founding_member"}, {"$set": {"retired": False}})
    flow.act_as(other)
    mine = (await flow.get("/api/achievements/me")).json()
    assert "founding_member" in _group_codes(mine["groups"])


@pytest.mark.asyncio
async def test_einzelne_stufe_nicht_mehr_erreichbar(flow):
    holder = await flow.add_user(name="Alt")
    other = await flow.add_user(name="Neu")
    await flow.db.achievements.update_one({"code": "matches_played_7"}, {"$set": {"retired": True, "retired_reason": "Test"}})
    await _give(flow, holder, "matches_played_7")
    flow.act_as(other)
    groups = (await flow.get("/api/achievements/groups", params={"category": "match", "mine": True})).json()
    played = next(g for g in groups if g["code"] == "matches_played")
    assert "matches_played_7" not in {t["code"] for t in played["tiers"]} and len(played["tiers"]) == 6
    flow.act_as(holder)
    groups = (await flow.get("/api/achievements/groups", params={"category": "match", "mine": True})).json()
    played = next(g for g in groups if g["code"] == "matches_played")
    assert next(t for t in played["tiers"] if t["code"] == "matches_played_7")["retired"] is True
    # Gegenprobe
    await flow.db.achievements.update_one({"code": "matches_played_7"}, {"$set": {"retired": False}})
    flow.act_as(other)
    groups = (await flow.get("/api/achievements/groups", params={"category": "match", "mine": True})).json()
    assert len(next(g for g in groups if g["code"] == "matches_played")["tiers"]) == 7


@pytest.mark.asyncio
async def test_nicht_mehr_erreichbares_zaehlt_nirgends_mit(flow):
    anna = await flow.add_user(name="Anna")
    await _member(flow, anna)
    await flow.db.users.update_one({"id": anna["id"]}, {"$set": {"privacy_public_profile": True}})
    await _give(flow, anna, "matches_played_1", "founding_member_1", "community_helper_1", "neg_afk")
    visibility.reset_rarity_cache()
    flow.act_as(anna)
    data = (await flow.get("/api/achievements/overview")).json()
    assert "founding_member_1" not in data["rarity"]["tiers"] and "founding_member" not in data["rarity"]["groups"]
    club_tiers = await flow.db.achievements.count_documents({"group_code": {"$in": [g["code"] async for g in flow.db.achievement_groups.find({"category": "club", "retired": {"$ne": True}}, {"code": 1})]}})
    club = next(c for c in data["categories"] if c["key"] == "club")
    assert club["tiers"] == club_tiers
    # Sammler und „N Erfolge freigeschaltet“: die normale und die von Hand vergebene - nicht die negative, nicht die retired.
    assert data["mine"]["count"] == 2 and data["mine"]["categories"] == {"match": 1, "community": 1}
    values = await counters.compute(anna["id"])
    assert values["achievements_unlocked"] == 2
    # Gegenprobe: ohne Kennzeichen zählt sie mit.
    await flow.db.achievement_groups.update_one({"code": "founding_member"}, {"$set": {"retired": False}})
    visibility.reset_rarity_cache()
    data = (await flow.get("/api/achievements/overview")).json()
    assert data["mine"]["count"] == 3 and "founding_member_1" in data["rarity"]["tiers"]
    assert (await counters.compute(anna["id"]))["achievements_unlocked"] == 3


@pytest.mark.asyncio
async def test_nicht_mehr_erreichbares_wird_nicht_automatisch_vergeben(flow):
    racer = await flow.add_user(name="Fahrer")
    await flow.db.tournaments.insert_one({"id": "gp", "title": "GP", "format": "grand_prix", "status": "completed"})
    await flow.db.tournament_registrations.insert_one({"id": "r-gp", "tournament_id": "gp", "user_id": racer["id"], "status": "approved"})
    assert (await counters.compute(racer["id"], {"grand_prix_entries"}, legacy=False))["grand_prix_entries"] == 1
    await badges.evaluate_user_progress(racer["id"])
    assert not await flow.db.user_achievements.find_one({"user_id": racer["id"], "tier_code": "grand_prix_1"})
    # Gegenprobe: ohne Kennzeichen kommt die Stufe.
    await flow.db.achievement_groups.update_one({"code": "grand_prix"}, {"$set": {"retired": False}})
    await badges.evaluate_user_progress(racer["id"])
    assert await flow.db.user_achievements.find_one({"user_id": racer["id"], "tier_code": "grand_prix_1"})


@pytest.mark.asyncio
async def test_verwaltung_setzt_retired_mit_grund_und_der_seed_laesst_es_stehen(flow):
    admin = await flow.add_user(role="superadmin", name="chef")
    flow.act_as(admin)
    res = await flow.patch("/api/admin/achievements/groups/matches_played", json={"retired": True})
    assert res.status_code == 400 and "Grund" in res.json()["detail"]
    res = await flow.patch("/api/admin/achievements/groups/matches_played", json={"retired": True, "retired_reason": "  Gibt es  nicht mehr. "})
    assert res.status_code == 200, res.text
    assert res.json()["retired"] is True and res.json()["retired_reason"] == "Gibt es nicht mehr."
    res = await flow.patch("/api/admin/achievements/tiers/matches_played_2", json={"available_until": "kein Datum", "retired_reason": "x"})
    assert res.status_code == 400
    res = await flow.patch("/api/admin/achievements/tiers/matches_played_2", json={"available_until": "2026-01-31T23:00:00Z", "retired_reason": "Saison vorbei"})
    assert res.status_code == 200 and res.json()["available_until"] == "2026-01-31T23:00:00+00:00"
    # Ein Neustart (Seed) überschreibt die Entscheidung der Verwaltung nicht - auch nicht das Zurücknehmen im Code-Katalog.
    res = await flow.patch("/api/admin/achievements/groups/founding_member", json={"retired": False})
    assert res.status_code == 200 and res.json()["retired_reason"] is None
    await badges.seed_badges()
    assert (await flow.db.achievement_groups.find_one({"code": "matches_played"}))["retired"] is True
    assert (await flow.db.achievement_groups.find_one({"code": "founding_member"}))["retired"] is False
    assert (await flow.db.achievements.find_one({"code": "matches_played_2"}))["available_until"] == "2026-01-31T23:00:00+00:00"
    # Gegenprobe: ändert sich die Entscheidung im Code (retired_catalog), kommt sie beim Seed an.
    await flow.db.achievement_groups.update_one({"code": "founding_member"}, {"$set": {"retired_catalog": False}})
    await badges.seed_badges()
    assert (await flow.db.achievement_groups.find_one({"code": "founding_member"}))["retired"] is True
    check = (await flow.get("/api/admin/achievements/catalog/check")).json()
    assert check["errors"] == []


@pytest.mark.asyncio
async def test_pionier_ist_erreichbar_bis_zum_hundertsten_konto(flow):
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    await flow.db.users.insert_many([{"id": f"u{i}", "username": f"u{i}", "created_at": (start + timedelta(hours=i)).isoformat()} for i in range(99)])
    await badges.seed_badges()
    assert "available_until" not in await flow.db.achievement_groups.find_one({"code": "pioneer"}, {"_id": 0}), "erst ab hundert Konten"
    await flow.db.users.insert_one({"id": "u99", "username": "u99", "created_at": (start + timedelta(hours=99)).isoformat()})
    await badges.seed_badges()
    group = await flow.db.achievement_groups.find_one({"code": "pioneer"}, {"_id": 0})
    assert group["available_until"] == (start + timedelta(hours=99)).isoformat() and reach.is_retired(group)
    newcomer = await flow.add_user(name="Spaet")
    flow.act_as(newcomer)
    assert "pioneer" not in _group_codes((await flow.get("/api/achievements/me")).json()["groups"])


# ------------------------------------------------------------------ 2. und 4. Kategorie-Meister und Meta-Erfolge


@pytest.mark.asyncio
async def test_kategorie_ist_abgeschlossen_mit_jeder_erreichbaren_stufe(flow):
    paula = await flow.add_user(name="Paula")
    season = await _reachable_codes(flow, category="season")
    assert season and not any(code.startswith("season_mvp") for code in season)
    await _give(flow, paula, *season[:-1])
    assert (await counters.compute(paula["id"], {"categories_completed"}, legacy=False))["categories_completed"] == 0
    await _give(flow, paula, season[-1])
    assert (await counters.compute(paula["id"], {"categories_completed"}, legacy=False))["categories_completed"] == 1
    flow.act_as(paula)
    mine = (await flow.get("/api/achievements/overview")).json()["mine"]
    assert mine["category_progress"]["season"] == {"earned": len(season), "total": len(season), "complete": True}
    assert mine["category_progress"]["match"]["complete"] is False and mine["categories_complete"] == 1


@pytest.mark.asyncio
async def test_kategorie_meister_ohne_zirkel_hand_geheim_und_leitung(flow):
    paula = await flow.add_user(name="Paula")
    profile = await _reachable_codes(flow, category="profile")
    assert not any(code.split("_")[0] in ("achievements", "categories", "hidden") for code in profile), "Meta-Gruppen zählen nicht"
    tournament = await _reachable_codes(flow, category="tournament")
    assert not any(code.startswith(("tournament_staff", "referee")) for code in tournament), "Leitung zählt nicht"
    community = await _reachable_codes(flow, category="community")
    assert not any(code.startswith(("community_helper", "mentor", "events_hosted")) for code in community), "von Hand und Leitung zählen nicht"
    await _give(flow, paula, *profile)
    # Profil & Konto ist abgeschlossen, ohne dass Kategorie-Meister, Sammler oder Geheimnisträger selbst fehlen dürfen.
    assert (await counters.compute(paula["id"], {"categories_completed"}, legacy=False))["categories_completed"] == 1
    # Gegenprobe: die alte Rechnung (alle Stufen der öffentlichen Gruppen) bliebe bei 0 - die Meta-Stufen fehlen.
    groups, tiers = await reach.load_catalog(flow.db)
    old = {t["code"] for t in tiers.values() if groups[t["group_code"]].get("public") and not groups[t["group_code"]].get("hidden")
           and catalog.category_v2(groups[t["group_code"]].get("category")) == "profile"}
    assert not old <= set(profile)


@pytest.mark.asyncio
async def test_hundert_prozent_verein_nur_fuer_mitglieder_und_erfolg_bleibt(flow):
    guest = await flow.add_user(name="Gast")
    member = await flow.add_user(name="Mitglied")
    await _member(flow, member)
    everything = await _reachable_codes(flow, member=False)
    await _give(flow, guest, *everything)
    await _give(flow, member, *everything)
    assert (await counters.compute(guest["id"], {"all_visible_achievements"}, legacy=False))["all_visible_achievements"] == 1
    # Gegenprobe: dem Mitglied fehlt der Verein.
    assert (await counters.compute(member["id"], {"all_visible_achievements"}, legacy=False))["all_visible_achievements"] == 0
    values = await counters.compute(guest["id"], {"categories_completed"}, legacy=False)
    assert values["categories_completed"] == len(reach.MASTER_CATEGORIES) - 1, "alle außer Verein"

    # Kommt später eine Stufe dazu, bleibt, was schon da ist - nie entzogen.
    await badges.evaluate_user_progress(guest["id"])
    held = {row["tier_code"] async for row in flow.db.user_achievements.find({"user_id": guest["id"], "group_code": {"$in": ["categories_complete", "completionist"]}})}
    assert {"completionist_1", "categories_complete_7"} <= held
    await flow.db.achievements.insert_one(catalog.tier("season_top10_6", "season_top10", "legendary", "Neu", "Neu.", condition_key="season_top10_finishes", progress_target=99) | {"id": "season_top10_6"})
    await badges.evaluate_user_progress(guest["id"])
    assert (await counters.compute(guest["id"], {"all_visible_achievements"}, legacy=False))["all_visible_achievements"] == 0
    still = {row["tier_code"] async for row in flow.db.user_achievements.find({"user_id": guest["id"], "group_code": {"$in": ["categories_complete", "completionist"]}})}
    assert held <= still


@pytest.mark.asyncio
async def test_geheimnistraeger_zaehlt_gruppen_ohne_retired(flow):
    finder = await flow.add_user(name="Finderin")
    await _give(flow, finder, "konami_1", "lost_1")
    assert (await counters.compute(finder["id"], {"hidden_unlocked"}, legacy=False))["hidden_unlocked"] == 2
    total = (await visibility.hidden_summary(flow.db, finder["id"]))["total"]
    await flow.db.achievement_groups.update_one({"code": "lost"}, {"$set": {"retired": True, "retired_reason": "Test"}})
    assert (await counters.compute(finder["id"], {"hidden_unlocked"}, legacy=False))["hidden_unlocked"] == 1
    assert await visibility.hidden_summary(flow.db, finder["id"]) == {"total": total - 1, "earned": 1}


def test_meta_ziele_sind_erreichbar_und_der_text_nennt_die_kategorien():
    groups = {g["code"]: catalog.apply_category_overrides(g) for g in catalog.ACHIEVEMENT_GROUPS}
    tiers = {t["code"]: t for t in catalog.ACHIEVEMENT_TIERS}
    progress = reach.category_progress(groups, tiers.values(), set())
    open_categories = [key for key, row in progress.items() if row["total"]]
    non_member = sum(row["total"] for key, row in progress.items() if key != "club")
    targets = {code: [t["progress_target"] for t in tiers.values() if t["group_code"] == code] for code in reach.META_GROUPS}
    assert max(targets["achievements_unlocked"]) <= non_member, "Sammler VII geht auch ohne Verein"
    hidden = [g for g in groups.values() if g.get("hidden") and not g.get("is_negative") and not reach.is_retired(g)]
    assert max(targets["hidden_found"]) <= len(hidden) - 1, "Geheimnisträger V auch ohne den Sprinter (nur für neue Konten)"
    assert len(targets["categories_complete"]) <= len(open_categories) - 1, "Kategorie-Meister VII auch ohne Verein"
    how_to = groups["categories_complete"]["how_to"]
    for key in reach.MASTER_CATEGORIES:
        assert catalog.CATEGORIES[key]["label"] in how_to, key
    assert "Verein (nur Mitglieder)" in how_to and "Geheim" not in how_to.split(" – ")[0]


def test_retired_im_katalog_mit_grund():
    groups = {g["code"]: g for g in catalog.ACHIEVEMENT_GROUPS}
    retired = {code for code, g in groups.items() if g.get("retired")}
    assert retired == {"founding_member", "lan_founder", "beta_tester", "grand_prix"}
    assert all(groups[code]["retired_reason"] for code in retired)
    assert groups["comeback"].get("retired") is None, "Comeback zählt jetzt über die Liga-Maps"


# ------------------------------------------------------------------ 3. Comeback und Kartenkenner


def test_comeback_nur_nach_rueckstand_und_gewonnen():
    def match(*winners):
        return {"slots": [{"registration_id": "me"}, {"registration_id": "you"}],
                "games": [{"position": index + 1, "winner_registration_id": winner} for index, winner in enumerate(winners)]}
    mine = {"me"}
    assert counters.was_comeback(match("you", "me", "me"), mine), "Bo3 0:1 → 2:1"
    assert counters.was_comeback(match("you", "you", "me", "me", "me"), mine), "Bo5 0:2 → 3:2"
    assert counters.was_comeback(match("me", "you", "you", "me", "me"), mine), "1:2 → 3:2"
    assert not counters.was_comeback(match("me", "me"), mine), "2:0"
    assert not counters.was_comeback(match("me", "you", "me"), mine), "nie hinten"
    assert not counters.was_comeback(match("you", "me", "you"), mine), "verloren"
    unordered = match("you", "me", "me")
    unordered["games"].reverse()
    assert counters.was_comeback(unordered, mine), "die Position zählt, nicht die Reihenfolge im Dokument"
    reversed_win = match("me", "me", "you")
    reversed_win["games"].reverse()
    assert not counters.was_comeback(reversed_win, mine), "Gegenprobe: in Dokument-Reihenfolge sähe es aus wie 0:1 → 2:1"
    broken = match("you", "me", "me")
    broken["games"][1]["winner_registration_id"] = None
    assert not counters.was_comeback(broken, mine), "ohne Sieger je Map keine Reihenfolge"


def test_kartenkenner_nur_maps_mit_eigener_aufstellung():
    match = {"map": " Rust ", "games": [
        {"position": 1, "map_name": "Nuketown", "lineups": {"me": ["u1", "u2"]}},
        {"position": 2, "map_name": "Rust", "lineups": {"me": ["u2", "u3"]}},
        {"position": 3, "map_id": "hacienda"},
    ]}
    assert counters.maps_of(match, {"me"}, "u1") == {"rust", "nuketown", "hacienda"}
    assert counters.maps_of(match, {"me"}, "u3") == {"rust", "hacienda"}


async def _league_match(flow, a, b, *, match_id, winners, when="2026-08-01T18:00:00+00:00"):
    await flow.db.tournaments.update_one({"id": "t-cb"}, {"$set": {"id": "t-cb", "title": "Cup", "status": "completed", "is_public": True}}, upsert=True)
    for user, reg_id in ((a, f"ra-{match_id}"), (b, f"rb-{match_id}")):
        await flow.db.tournament_registrations.insert_one({"id": reg_id, "tournament_id": "t-cb", "user_id": user["id"], "status": "checked_in", "created_at": when})
    side = {"a": f"ra-{match_id}", "b": f"rb-{match_id}"}
    own = sum(1 for winner in winners if winner == "a")
    await flow.db.matches_v2.insert_one({
        "id": match_id, "tournament_id": "t-cb", "status": "completed", "stage_number": 1, "round": 1, "order": 1, "completed_at": when, "updated_at": when, "best_of": 3,
        "slots": [{"slot": 1, "registration_id": side["a"]}, {"slot": 2, "registration_id": side["b"]}],
        "results": [{"registration_id": side["a"], "rank": 1 if own * 2 > len(winners) else 2, "score": own},
                    {"registration_id": side["b"], "rank": 2 if own * 2 > len(winners) else 1, "score": len(winners) - own}],
        "winner_id": side["a"] if own * 2 > len(winners) else side["b"],
        "games": [{"position": index + 1, "map_id": f"map-{index}", "map_name": f"Map {index + 1}", "winner_registration_id": side[winner], "lineups": {}}
                  for index, winner in enumerate(winners)],
    })


@pytest.mark.asyncio
async def test_comeback_und_kartenkenner_aus_den_liga_maps(flow):
    anna = await flow.add_user(name="Anna")
    bernd = await flow.add_user(name="Bernd")
    await _league_match(flow, anna, bernd, match_id="cb1", winners=["b", "a", "a"])
    await _league_match(flow, anna, bernd, match_id="cb2", winners=["a", "a"], when="2026-08-02T18:00:00+00:00")
    values = await counters.compute(anna["id"], {"comebacks", "distinct_maps"}, legacy=False)
    assert values == {"comebacks": 1, "distinct_maps": 3}
    theirs = await counters.compute(bernd["id"], {"comebacks"}, legacy=False)
    assert theirs["comebacks"] == 0
    # Gegenprobe: ohne Maps (nur das Ergebnis) zählt nichts.
    await flow.db.matches_v2.update_many({}, {"$unset": {"games": ""}})
    values = await counters.compute(anna["id"], {"comebacks", "distinct_maps"}, legacy=False)
    assert values == {"comebacks": 0, "distinct_maps": 0}


# ------------------------------------------------------------------ 5. Streckenrekord und Eiserner Löwe


@pytest.mark.asyncio
async def test_streckenrekord_ueber_alle_challenges_nicht_wie_pole(flow):
    anna = await flow.add_user(name="Anna")
    bernd = await flow.add_user(name="Bernd")
    await flow.db.f1_challenges.insert_many([{"id": "c1", "title": "LAN 1", "game_id": "f1"}, {"id": "c2", "title": "LAN 2", "game_id": "f1"}, {"id": "c3", "title": "Andere", "game_id": "gt"}])
    await flow.db.f1_tracks.insert_many([
        {"id": "t1", "challenge_id": "c1", "name": "Monza"}, {"id": "t2", "challenge_id": "c2", "name": " monza "},
        {"id": "t3", "challenge_id": "c1", "name": "Spa"}, {"id": "t4", "challenge_id": "c3", "name": "Monza"},
    ])
    laps = [("anna", "c1", "t1", 80000), ("bernd", "c1", "t1", 81000), ("bernd", "c2", "t2", 79000), ("anna", "c1", "t3", 90000), ("anna", "c3", "t4", 70000)]
    people = {"anna": anna, "bernd": bernd}
    await flow.db.f1_lap_times.insert_many([{"id": new_id(), "user_id": people[who]["id"], "challenge_id": cid, "track_id": tid, "time_ms": ms, "is_invalid": False,
                                             "created_at": "2026-08-01T12:00:00+00:00"} for who, cid, tid, ms in laps])
    anna_values = await counters.compute(anna["id"])
    bernd_values = await counters.compute(bernd["id"])
    # Pole je Challenge: Anna auf Monza (LAN 1), Spa und Monza (anderes Spiel); Bernd auf Monza (LAN 2).
    assert anna_values["pole_count"] == 3 and bernd_values["pole_count"] == 1
    # Rekord: Monza im Spiel f1 wurde in zwei Challenges gefahren - Bernd hält ihn; Spa und Monza im anderen Spiel nur einmal.
    assert anna_values["track_records_held"] == 0 and bernd_values["track_records_held"] == 1
    # Gegenprobe: Anna fährt auf Monza (LAN 2) schneller - der Rekord wechselt.
    await flow.db.f1_lap_times.insert_one({"id": new_id(), "user_id": anna["id"], "challenge_id": "c2", "track_id": "t2", "time_ms": 78000, "is_invalid": False, "created_at": "2026-08-02T12:00:00+00:00"})
    assert (await counters.compute(anna["id"], {"track_records_held"}, legacy=False))["track_records_held"] == 1


async def _played_in(flow, user, other, month: str, match_id: str):
    when = f"{month}-15T18:00:00+00:00"
    await _league_match(flow, user, other, match_id=match_id, winners=["a", "a"], when=when)


@pytest.mark.asyncio
async def test_eiserner_loewe_zaehlt_monate_in_folge_nicht_die_anmeldeserie(flow):
    anna = await flow.add_user(name="Anna")
    bernd = await flow.add_user(name="Bernd")
    for index, month in enumerate(["2025-11", "2025-12", "2026-01", "2026-02", "2026-04"]):
        await _played_in(flow, anna, bernd, month, f"m{index}")
    await flow.db.user_xp.update_one({"user_id": anna["id"]}, {"$set": {"login_streak_max": 400}}, upsert=True)
    values = await counters.compute(anna["id"], {"match_months_streak_max", "login_streak_max"}, legacy=False)
    assert values["match_months_streak_max"] == 4 and values["login_streak_max"] == 400
    tiers = {t["code"]: t for t in catalog.ACHIEVEMENT_TIERS}
    assert tiers["iron_lion_1"]["condition_key"] == "match_months_streak_max" and tiers["iron_lion_1"]["progress_target"] == 12
    assert tiers["login_streak_7"]["condition_key"] == "login_streak_max", "Treue bleibt die Anmeldeserie"
    assert tiers["lap_record_1"]["condition_key"] != tiers["pole_1"]["condition_key"]
    # 400 Tage Anmeldeserie bringen den Eisernen Löwen nicht mehr.
    await badges.evaluate_user_progress(anna["id"])
    assert not await flow.db.user_achievements.find_one({"user_id": anna["id"], "tier_code": "iron_lion_1"})
    assert await flow.db.user_achievements.find_one({"user_id": anna["id"], "tier_code": "login_streak_7"})


# ------------------------------------------------------------------ 6. Die Gruppen der Leitung


@pytest.mark.asyncio
async def test_turnierleitung_und_schiedsrichter_nur_fuer_die_leitung(flow):
    player = await flow.add_user(name="Spielerin")
    lead = await flow.add_user(role="tournament_admin", name="Leitung")
    helper = await flow.add_user(name="Helfer")
    await flow.db.tournament_staff_assignments.insert_one({"id": "a1", "tournament_id": "t1", "user_id": helper["id"], "role": "referee"})
    staff = {"tournament_staff", "referee", "events_hosted"}
    flow.act_as(player)
    assert not staff & _group_codes((await flow.get("/api/achievements/me")).json()["groups"])
    flow.act_as(None)
    assert not staff & _group_codes((await flow.get("/api/achievements/groups")).json())
    for who in (lead, helper):
        flow.act_as(who)
        assert staff <= _group_codes((await flow.get("/api/achievements/me")).json()["groups"]), who["display_name"]
    # Wer eine Stufe schon hat, sieht sie - nur die erhaltene.
    await _give(flow, player, "tournament_staff_1")
    flow.act_as(player)
    groups = (await flow.get("/api/achievements/me")).json()["groups"]
    held = next(g for g in groups if g["code"] == "tournament_staff")
    assert [t["code"] for t in held["tiers"]] == ["tournament_staff_1"] and "referee" not in _group_codes(groups)
    # Fremdes Profil der Leitung: deren Gruppen samt offener Stufen.
    flow.act_as(player)
    await flow.db.users.update_one({"id": lead["id"]}, {"$set": {"privacy_public_profile": True}})
    profile = (await flow.get(f"/api/achievements/user/{lead['id']}")).json()
    assert "referee" in _group_codes(profile["groups"])


# ------------------------------------------------------------------ Migration 23


@pytest.mark.asyncio
async def test_migration_23_prueft_im_stillen_modus_neu_sonst_nichts(flow):
    await flow.add_user(name="Paula")
    assert await migrations.migrate_achievements_catalog_recheck(flow.db) == "silent mode off - nothing to recheck"
    assert await flow.db.settings.find_one({"id": recount.SETTING_ID}) is None, "ohne stillen Modus wird nichts angelegt"
    await recount.begin(flow.db)
    await flow.db.achievement_eval_queue.delete_many({})
    result = await migrations.migrate_achievements_catalog_recheck(flow.db)
    assert result.startswith("recheck, 1 accounts queued"), result
    doc = await flow.db.settings.find_one({"id": recount.SETTING_ID}, {"_id": 0})
    assert doc["generation"] == 2 and doc["rechecked_for"] == ["2339"]
    assert await flow.db.achievement_eval_queue.count_documents({}) == 1
    # Ein zweiter Lauf prüft nicht noch einmal.
    assert await migrations.migrate_achievements_catalog_recheck(flow.db) == "already rechecked for 2339"
    assert (await flow.db.settings.find_one({"id": recount.SETTING_ID}))["generation"] == 2
    # Nach dem Ende des stillen Modus geschieht nichts.
    await flow.db.settings.update_one({"id": recount.SETTING_ID}, {"$set": {"active": False}, "$unset": {"rechecked_for": ""}})
    assert await migrations.migrate_achievements_catalog_recheck(flow.db) == "silent mode off - nothing to recheck"
    assert (await flow.db.settings.find_one({"id": recount.SETTING_ID}))["generation"] == 2
    assert [v for v, name, _fn in migrations.MIGRATIONS if name == "achievements_catalog_recheck_2339"] == [23]
