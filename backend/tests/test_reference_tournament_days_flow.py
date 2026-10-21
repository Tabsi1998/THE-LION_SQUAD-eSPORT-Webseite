"""Turniertage einer Turnierserie (#1961) über die echten Routen: Regeln mit Runden je Termin, Sonderbonus und „Top N“,
fünf Ergebnisblätter mit Rundenpunkten (ohne Platz - die Tagessumme bestimmt ihn), Double Up und Gleichstand ohne
Meldung, „Name#TAG“ als dieselbe Person, die Serienseite mit Tagesansicht und Spieler-Detail und der Saisonabschluss.
Der Abnahmefall aus dem Issue (siehe ``test_tournament_days_unit.py``). Nur erfundene Namen."""
import pathlib
import sys
from datetime import date, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import migrations, reference_series  # noqa: E402
from services.dolibarr_policy import club_today  # noqa: E402
from test_tournament_days_unit import DAYS, NAMES, RULES  # noqa: E402

ADMIN = "/api/reference-series/admin"
PUBLIC = "/api/reference-series/public"
TAGGED = "Gina Gedacht#TLS"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


def _day(offset: int) -> str:
    return (date.fromisoformat(club_today()) + timedelta(days=offset)).isoformat()


def _with_tags(entry: dict, index: int) -> dict:
    """Gina steht beim Veranstalter mit Tag; Hugo am zweiten Tag einmal mit Tag, sonst ohne."""
    rows = []
    for row in entry["rows"]:
        row = {**row}
        if row["name"] == NAMES["g"]:
            row["name"] = TAGGED
        if row["name"] == NAMES["h"] and index == 1:
            row["name"] = "Hugo Probe#EUW"
        if (row.get("partner") or {}).get("name") == NAMES["g"]:
            row["partner"] = {"name": TAGGED}
        rows.append(row)
    return {**entry, "rows": rows}


async def _setup(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    board = await flow.add_user(role="user", name="vorstand-vera")
    await flow.db.users.update_one({"id": board["id"]}, {"$set": {"areas": ["content"]}})
    board["areas"] = ["content"]
    flow.act_as(board)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Masters", "kind": "series"})).json()
    body = {"lineage_id": lineage["id"], "season": "2026/27", "rules": RULES, "hide_name_tags": True}
    series = await flow.post(f"{ADMIN}/series", json=body)
    assert series.status_code == 200, series.text
    series = series.json()
    rounds = []
    for index in range(5):
        created = await flow.post(f"{ADMIN}/series/{series['id']}/rounds",
                                  json={"day": _day(-40 + index * 7), "code": f"T{index + 1}"})
        assert created.status_code == 200, created.text
        rounds.append(created.json()["id"])
    return lineage, series, rounds


def _url(series, round_id, suffix=""):
    return f"{ADMIN}/series/{series['id']}/rounds/{round_id}/results{suffix}"


@pytest.mark.asyncio
async def test_five_tournament_days_through_the_routes_match_the_example_table(flow):
    lineage, series, rounds = await _setup(flow)
    for index, (entry, round_id) in enumerate(zip(DAYS.values(), rounds)):
        body = _with_tags(entry, index)
        preview = (await flow.post(_url(series, round_id, "/preview"), json=body)).json()
        # Gleichstand auf Platz 4 und Paare im Double Up teilen ihren Platz ohne Meldung.
        assert preview["errors"] == [], preview["errors"]
        assert [item["code"] for item in preview["warnings"]] == [], preview["warnings"]
        saved = await flow.put(_url(series, round_id), json={**body, "status": "published", "expected_version": 0})
        assert saved.status_code == 200, saved.text

    # „Hugo Probe#EUW“ ist Hugo Probe - acht Teilnehmer, nicht neun.
    people = await flow.db.reference_participants.find({"series_id": series["id"]}, {"_id": 0}).to_list(None)
    assert sorted(person["name"] for person in people) == sorted([*[n for k, n in NAMES.items() if k != "g"], TAGGED])

    flow.act_as(None)
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()
    assert page["rules"]["day_rounds"] == {"count": 5, "points_by_place": [8, 7, 6, 5, 4, 3, 2, 1]}
    assert page["rules"]["custom_bonuses"] == [{"key": "bingo", "label": "Bingo", "points": 3}]
    assert page["rules"]["tiebreak_top_n"] == 4 and page["rules"]["tiebreakers"] == ["wins", "top_n", "countback"]
    rows = page["standings"]["rows"]
    # Öffentlich ohne Tag der Spielkennung.
    assert [(row["name"], row["rank"], row["points"], row["bonus_points"], row["tiebreak"]) for row in rows] == [
        ("Gina Gedacht", 1, 170, 0, None), (NAMES["a"], 2, 116, 0, None), (NAMES["b"], 3, 116, 0, "wins"),
        (NAMES["c"], 4, 114, 0, None), (NAMES["d"], 5, 114, 0, "top_n"), (NAMES["e"], 6, 111, 0, None),
        (NAMES["f"], 7, 111, 0, "countback"), (NAMES["h"], 8, 96, 3, None)]

    # Tagesansicht und Spieler-Detail: Runden, Tagessumme, Tagesplatz, Saisonpunkte, Partner mit Namen, Bonus.
    hugo = rows[-1]
    t1, t2, t3 = hugo["results"][:3]
    assert ([entry["points"] for entry in t1["day_rounds"]], t1["day_points"], t1["place"], t1["points"]) == (
        [1, 1, 1, 1, 1], 5, 8, 14)
    assert (t1["bonus"], t1["bonus_keys"]) == (3, ["bingo"])
    assert t2["round_id"] == rounds[1] and t2["place"] == 8
    assert (t3["place"], t3["points"], t3["partner"]["name"], t3["day_points"]) == (1, 35, "Gina Gedacht", 20)
    assert "partner_id" not in t3
    cleo = rows[3]
    assert [item["place"] for item in cleo["results"]] == [4, 4, 2, 5, 6]


@pytest.mark.asyncio
async def test_saving_an_older_season_unchanged_keeps_its_rules_version(flow):
    """Eine Saison von vor #1961 hat die neuen Regeln (Runden, Sonderboni, Top N) nicht gespeichert. Speichert jemand sie
    unverändert, ist das keine Regeländerung - keine neue Version, kein Eintrag in der Regel-Historie."""
    _, series, _ = await _setup(flow)
    old = {key: value for key, value in series["rules"].items()
           if key not in ("day_rounds", "custom_bonuses", "tiebreak_top_n")}
    old["tiebreakers"] = ["wins", "countback"]
    await flow.db.reference_series.update_one({"id": series["id"]}, {"$set": {"rules": old}})
    unchanged = await flow.patch(f"{ADMIN}/series/{series['id']}", json={"rules": old})
    assert unchanged.status_code == 200, unchanged.text
    assert (unchanged.json()["rules_version"], unchanged.json()["rules_history"]) == (1, [])
    changed = await flow.patch(f"{ADMIN}/series/{series['id']}", json={"rules": {**old, "tiebreak_top_n": 3}})
    assert changed.json()["rules_version"] == 2 and changed.json()["rules"]["tiebreak_top_n"] == 3


@pytest.mark.asyncio
async def test_round_page_of_a_racing_season_shows_names_without_tag_like_the_series_page(flow):
    """Rundenseite (#1950): Namen wie auf der Serienseite - mit ``hide_name_tags`` ohne Tag der Spielkennung, eine
    Startnummer mit Leerzeichen davor bleibt. Eine Turnierserie hat keine Rundenseite (404)."""
    lineage, series, rounds = await _setup(flow)
    racing = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Rennliga", "kind": "racing"})).json()
    season = (await flow.post(f"{ADMIN}/series", json={"lineage_id": racing["id"], "season": "2026",
                                                       "hide_name_tags": True})).json()
    race = (await flow.post(f"{ADMIN}/series/{season['id']}/rounds", json={"day": _day(-3), "code": "R1"})).json()
    saved = await flow.put(_url(season, race["id"]), json={"rows": [
        {"name": "Rita Rennt#EUW", "place": 1}, {"name": "Max Muster #123", "place": 2}],
        "status": "published", "expected_version": 0})
    assert saved.status_code == 200, saved.text
    flow.act_as(None)
    page = (await flow.get(f"{PUBLIC}/{racing['slug']}/{season['season_slug']}/rounds/1")).json()
    assert [row["name"] for row in page["sessions"][0]["rows"]] == ["Rita Rennt", "Max Muster #123"]
    assert (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}/rounds/1")).status_code == 404


@pytest.mark.asyncio
async def test_closing_the_season_takes_the_ranks_after_the_tiebreak(flow):
    lineage, series, rounds = await _setup(flow)
    for index, (entry, round_id) in enumerate(zip(DAYS.values(), rounds)):
        saved = await flow.put(_url(series, round_id), json={**_with_tags(entry, index), "status": "published",
                                                             "expected_version": 0})
        assert saved.status_code == 200, saved.text
    for key, profile in (("c", "profil-cleo"), ("d", "profil-dario")):
        await flow.db.club_member_profiles.insert_one({"id": profile, "slug": profile, "display_name": NAMES[key],
                                                       "gamertag": NAMES[key], "is_active": True})
        await flow.db.reference_participants.update_one(
            {"series_id": series["id"], "name": NAMES[key]},
            {"$set": {"link": "member", "profile_id": profile, "is_club_member": True}})
    await reference_series.recompute_standings(flow.db, await flow.db.reference_series.find_one({"id": series["id"]}))
    proposal = (await flow.get(f"{ADMIN}/series/{series['id']}/close")).json()
    assert [(entry["members"][0]["name"], entry["placement"], entry["participant_count"])
            for entry in proposal["entries"]] == [(NAMES["c"], 4, 8), (NAMES["d"], 5, 8)]
