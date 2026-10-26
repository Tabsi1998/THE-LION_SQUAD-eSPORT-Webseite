"""Art-Profil (#2024) über die echten Routen: das Profil kommt mit Übersicht, Saison, Eintragen, Serienseite und
„Läuft gerade“; eine neue Turnierserie startet mit TFT-Regeln; Ort, Land, Lauf und Gegner gibt es bei ihr nicht; eine
Terminliste ohne Datum legt offene Termine an; ein gewerteter Termin braucht ein Datum (beim Veröffentlichen
nachgetragen); „Läuft gerade“ zeigt eine Saison mit nur offenen Terminen vor Saisons ohne Termin. Nur erfundene
Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import reference_result_routes, reference_round_routes, reference_series_public_routes  # noqa: E402
from services import migrations, reference_running_cache, series_kinds  # noqa: E402

ADMIN = "/api/reference-series/admin"
PUBLIC = "/api/reference-series/public"
TODAY = "2026-11-05"


@pytest_asyncio.fixture
async def flow(monkeypatch):
    reference_running_cache.reset()
    instance, shutdown = make_flow()
    for module in (reference_round_routes, reference_series_public_routes, reference_result_routes):
        monkeypatch.setattr(module, "club_today", lambda: TODAY)
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


async def _season(flow, kind="series", **fields):
    await migrations.migrate_points_scheme_templates(flow.db)
    if not getattr(flow, "board", None):
        flow.board = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(flow.board)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": f"Probe {kind}", "kind": kind})).json()
    body = {"lineage_id": lineage["id"], "season": "2026/27", "visibility": "public", "status": "active",
            "default_weekday": 3, "default_time": "19:00", **fields}
    response = await flow.post(f"{ADMIN}/series", json=body)
    assert response.status_code == 200, response.text
    return lineage, response.json()


def _rounds(series):
    return f"{ADMIN}/series/{series['id']}/rounds"


async def _calendar(flow, series):
    return (await flow.get(f"{ADMIN}/series/{series['id']}/calendar")).json()


async def _paste(flow, series, text):
    version = (await _calendar(flow, series))["version"]
    body = {"text": text, "apply": True, "expected_version": version}
    response = await flow.post(f"{_rounds(series)}/paste", json=body)
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------- Profil ausliefern
@pytest.mark.asyncio
async def test_the_profile_comes_with_overview_season_entry_page_and_running(flow):
    lineage, series = await _season(flow)
    overview = (await flow.get(ADMIN)).json()
    assert set(overview["kind_profiles"]) == {"series", "racing", "team_league"}
    assert overview["kind_profiles"]["series"]["vocab"]["round_one"] == "Turniertag"
    detail = (await flow.get(f"{ADMIN}/series/{series['id']}")).json()
    assert detail["profile"]["kind"] == "series" and detail["profile"]["fields"]["venue"] is False
    await _paste(flow, series, "T1 · 01.11.2026")
    round_id = (await _calendar(flow, series))["rounds"][0]["id"]
    entry = (await flow.get(f"{_rounds(series)}/{round_id}/results")).json()
    assert entry["series"]["profile"]["vocab"]["person_one"] == "Spieler"
    flow.act_as(None)
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()
    assert page["profile"] == series_kinds.public_profile("series")
    running = (await flow.get(f"{PUBLIC}/running")).json()["items"]
    assert running[0]["profile"]["vocab"]["round_dative"] == "Turniertagen"


@pytest.mark.asyncio
async def test_a_new_tournament_series_starts_with_tft_rules_and_a_racing_league_as_before(flow):
    _, series = await _season(flow)
    assert series["rules"]["day_rounds"]["count"] == 5
    assert series["rules"]["points_by_place"][:3] == [35, 30, 26]
    _, racing = await _season(flow, "racing")
    assert racing["rules"]["points_by_place"][:3] == [25, 18, 15]
    assert racing["rules"]["day_rounds"]["count"] == 0


@pytest.mark.asyncio
async def test_the_tft_template_is_offered_and_formula_1_narrowed_to_racing(flow):
    # Alter Stand: „Formel 1“ auch für Turnierserien, keine TFT-Vorlage.
    old = {"id": "formula_1", "name": "Formel 1", "kinds": ["racing", "series"], "rules": {}}
    await flow.db.settings.insert_one({"id": "points_schemes", "schemes": [old]})
    await migrations.migrate_kind_templates(flow.db)
    schemes = {item["id"]: item for item in (await flow.db.settings.find_one({"id": "points_schemes"}))["schemes"]}
    assert schemes["formula_1"]["kinds"] == ["racing"] and schemes["tft"]["kinds"] == ["series"]
    # Von Hand bearbeitete Arten bleiben.
    await flow.db.settings.update_one({"id": "points_schemes", "schemes.id": "formula_1"},
                                      {"$set": {"schemes.$.kinds": ["racing", "series", "team_league"]}})
    await migrations.migrate_kind_templates(flow.db)
    schemes = {item["id"]: item for item in (await flow.db.settings.find_one({"id": "points_schemes"}))["schemes"]}
    assert schemes["formula_1"]["kinds"] == ["racing", "series", "team_league"]


@pytest.mark.asyncio
async def test_a_template_of_another_kind_is_refused_when_a_season_is_created(flow):
    lineage, _ = await _season(flow)
    body = {"lineage_id": lineage["id"], "season": "2027", "points_scheme_id": "formula_1"}
    refused = await flow.post(f"{ADMIN}/series", json=body)
    assert refused.status_code == 422
    assert "Formel 1" in refused.json()["detail"] and "Turnierserie" in refused.json()["detail"]
    assert await flow.db.reference_series.count_documents({"season": "2027"}) == 0
    assert (await flow.post(f"{ADMIN}/series", json={**body, "points_scheme_id": "tft"})).status_code == 200
    # Eine Vorlage für alle Arten geht immer.
    organizer = await flow.post(f"{ADMIN}/series", json={**body, "season": "2028", "points_scheme_id": "organizer"})
    assert organizer.status_code == 200, organizer.text


@pytest.mark.asyncio
async def test_a_season_created_from_formula_1_before_stays_editable(flow):
    # Alter Stand: eine Turnierserie, angelegt aus „Formel 1“ - Bearbeiten prüft die Vorlage nicht noch einmal.
    _, series = await _season(flow)
    await flow.db.reference_series.update_one({"id": series["id"]}, {"$set": {"points_scheme_id": "formula_1"}})
    saved = await flow.patch(f"{ADMIN}/series/{series['id']}", json={"title": "Probe Herbst", "rules": series["rules"]})
    assert saved.status_code == 200, saved.text
    assert saved.json()["points_scheme_id"] == "formula_1"


# ---------------------------------------------------------------- Kein Ort bei der Turnierserie
@pytest.mark.asyncio
async def test_a_tournament_series_takes_no_place_flag_lap_or_opponent(flow):
    lineage, series = await _season(flow)
    created = await flow.post(_rounds(series), json={"code": "T1", "day": "2026-11-12", "venue": "Monza",
                                                     "country_code": "IT", "country_auto": False,
                                                     "session": "Sprint", "opponent": "Team X"})
    assert created.status_code == 200, created.text
    body = created.json()
    assert (body["venue"], body["country_code"], body["session"], body["opponent"]) == (None, None, None, None)
    version = (await _calendar(flow, series))["version"]
    patched = await flow.patch(f"{_rounds(series)}/{body['id']}", json={"venue": "Baku", "expected_version": version})
    assert patched.status_code == 200 and patched.json()["venue"] is None
    # Ein alter Ort in der Datenbank geht öffentlich nicht mehr hinaus.
    await flow.db.reference_rounds.update_one({"id": body["id"]}, {"$set": {"venue": "Alt", "country_code": "AT"}})
    flow.act_as(None)
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()
    assert (page["rounds"][0]["venue"], page["rounds"][0]["country_code"]) == (None, None)
    assert page["progress"]["next"]["venue"] is None
    calendar = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}/calendar")).json()
    assert calendar["rounds"][0]["country_code"] is None
    running = (await flow.get(f"{PUBLIC}/running")).json()["items"]
    assert running[0]["next"]["country_code"] is None


@pytest.mark.asyncio
async def test_a_racing_league_keeps_place_and_flag(flow):
    _, series = await _season(flow, "racing")
    created = (await flow.post(_rounds(series), json={"code": "R1", "day": "2026-11-12", "venue": "Monza"})).json()
    assert created["venue"] == "Monza" and created["country_code"] == "IT"


@pytest.mark.asyncio
async def test_the_list_without_a_date_makes_open_tournament_days(flow):
    _, series = await _season(flow)
    await _paste(flow, series, "T1 · 01.10.2026 · Halle\nT2\nT3 · 12.11. 20:00")
    rounds = (await _calendar(flow, series))["rounds"]
    assert [(item["code"], item["club_day"], item["venue"]) for item in rounds] == [
        ("T1", "2026-10-01", None), ("T2", None, None), ("T3", "2026-11-12", None)]


# ---------------------------------------------------------------- Datum nachtragen (Sammelansicht)
@pytest.mark.asyncio
async def test_dates_for_several_open_rounds_come_in_one_go_and_sort_them_in(flow):
    _, series = await _season(flow)
    await _paste(flow, series, "T1 · 01.10.2026\nT2 · offen\nT3 · offen\nT4 · offen")
    calendar = await _calendar(flow, series)
    rounds = {item["code"]: item for item in calendar["rounds"]}
    body = {"expected_version": calendar["version"], "items": [
        {"id": rounds["T3"]["id"], "day": "2026-10-15", "time": "20:30"},
        {"id": rounds["T2"]["id"], "day": "2026-10-08"}]}
    response = await flow.post(f"{_rounds(series)}/dates", json=body)
    assert response.status_code == 200, response.text
    after = response.json()
    assert [(item["code"], item["club_day"], item["time"]) for item in after["rounds"]] == [
        ("T1", "2026-10-01", "19:00"), ("T2", "2026-10-08", "19:00"), ("T3", "2026-10-15", "20:30"),
        ("T4", None, "19:00")]
    log = await flow.db.audit_logs.find_one({"action": "reference_round.dates"}, {"_id": 0})
    assert len(log["data"]["items"]) == 2
    # Veralteter Stand: 409, nichts geändert.
    stale = await flow.post(f"{_rounds(series)}/dates", json={**body, "items": [
        {"id": rounds["T4"]["id"], "day": "2026-10-22"}]})
    assert stale.status_code == 409
    # Ein Termin mit Datum wird hier nicht verschoben - dafür gibt es „Verschieben“.
    version = (await _calendar(flow, series))["version"]
    dated = await flow.post(f"{_rounds(series)}/dates", json={"expected_version": version, "items": [
        {"id": rounds["T1"]["id"], "day": "2026-10-02"}]})
    assert dated.status_code == 422 and "Verschieben" in dated.json()["detail"]


@pytest.mark.asyncio
async def test_dates_are_only_for_open_rounds_not_cancelled_or_scored_ones_and_nothing_changes_halfway(flow):
    _, series = await _season(flow)
    await _paste(flow, series, "T1 · offen\nT2 · offen\nT3 · offen")
    rounds = {item["code"]: item for item in (await _calendar(flow, series))["rounds"]}
    version = (await _calendar(flow, series))["version"]
    assert (await flow.post(f"{_rounds(series)}/{rounds['T2']['id']}/cancel",
                            json={"expected_version": version})).status_code == 200
    # Gewertet ohne Datum (alter Stand vor #2024): auch das ist kein offener Termin mehr.
    await flow.db.reference_rounds.update_one({"id": rounds["T3"]["id"]}, {"$set": {"status": "scored"}})
    version = (await _calendar(flow, series))["version"]
    body = {"expected_version": version, "items": [{"id": rounds["T1"]["id"], "day": "2026-10-08"},
                                                   {"id": rounds["T2"]["id"], "day": "2026-10-15"},
                                                   {"id": rounds["T3"]["id"], "day": "2026-10-22"}]}
    refused = await flow.post(f"{_rounds(series)}/dates", json=body)
    assert refused.status_code == 422
    assert "T2 ist abgesagt" in refused.json()["detail"] and "T3 ist schon gewertet" in refused.json()["detail"]
    # Alles oder nichts: auch T1 hat noch kein Datum, der Kalender keinen neuen Stand.
    stored = {item["code"]: item for item in (await _calendar(flow, series))["rounds"]}
    assert [stored[code]["club_day"] for code in ("T1", "T2", "T3")] == [None, None, None]
    assert (await _calendar(flow, series))["version"] == version
    # Ein Termin einer anderen Saison ist hier unbekannt.
    _, other = await _season(flow)
    await _paste(flow, other, "T1 · offen")
    foreign = (await _calendar(flow, other))["rounds"][0]["id"]
    unknown = await flow.post(f"{_rounds(series)}/dates", json={"expected_version": version, "items": [
        {"id": foreign, "day": "2026-10-08"}]})
    assert unknown.status_code == 404


# ---------------------------------------------------------------- Gewertet nur mit Datum
ROWS = [{"name": "Probe Ada", "place": 1}, {"name": "Probe Bruno", "place": 2}]


async def _open_round(flow):
    _, series = await _season(flow, planned_rounds=3)
    await _paste(flow, series, "T1 · 01.10.2026\nT2 · offen\nT3 · offen")
    rounds = {item["code"]: item for item in (await _calendar(flow, series))["rounds"]}
    return series, rounds


@pytest.mark.asyncio
async def test_publishing_a_result_for_a_round_without_date_needs_the_date(flow):
    series, rounds = await _open_round(flow)
    url = f"{_rounds(series)}/{rounds['T3']['id']}/results"
    refused = await flow.put(url, json={"rows": ROWS, "status": "published", "expected_version": 0})
    assert refused.status_code == 422
    assert "Datum" in refused.json()["detail"]["message"]
    assert refused.json()["detail"]["errors"][0]["code"] == "round_without_day"
    # Ein Entwurf geht ohne Datum - gewertet ist er nicht.
    draft = await flow.put(url, json={"rows": ROWS, "status": "draft", "expected_version": 0})
    assert draft.status_code == 200, draft.text
    saved = await flow.put(url, json={"rows": ROWS, "status": "published", "expected_version": 1,
                                      "round_day": "2026-11-05"})
    assert saved.status_code == 200, saved.text
    calendar = (await _calendar(flow, series))["rounds"]
    # Mit Datum und gemerkter Uhrzeit, vor den offenen Terminen einsortiert, gewertet.
    assert [(item["code"], item["club_day"], item["time"], item["state"]) for item in calendar] == [
        ("T1", "2026-10-01", "19:00", "missing"), ("T3", "2026-11-05", "19:00", "scored"),
        ("T2", None, "19:00", "planned")]
    log = await flow.db.audit_logs.find_one({"action": "reference_round.day_from_result"}, {"_id": 0})
    assert log["data"]["club_day"] == "2026-11-05"


@pytest.mark.asyncio
async def test_approving_a_draft_for_a_round_without_date_needs_the_date_too(flow):
    series, rounds = await _open_round(flow)
    url = f"{_rounds(series)}/{rounds['T2']['id']}/results"
    assert (await flow.put(url, json={"rows": ROWS, "status": "draft", "expected_version": 0})).status_code == 200
    refused = await flow.post(f"{url}/approve", json={"expected_version": 1})
    assert refused.status_code == 422 and refused.json()["detail"]["errors"][0]["code"] == "round_without_day"
    done = await flow.post(f"{url}/approve", json={"expected_version": 1, "round_day": "2026-11-04"})
    assert done.status_code == 200, done.text
    stored = await flow.db.reference_rounds.find_one({"id": rounds["T2"]["id"]})
    assert (stored["club_day"], stored["status"]) == ("2026-11-04", "scored")


@pytest.mark.asyncio
async def test_a_date_in_the_request_does_not_move_a_dated_round(flow):
    series, rounds = await _open_round(flow)
    url = f"{_rounds(series)}/{rounds['T1']['id']}/results"
    saved = await flow.put(url, json={"rows": ROWS, "status": "published", "expected_version": 0,
                                      "round_day": "2026-11-05"})
    assert saved.status_code == 200, saved.text
    stored = await flow.db.reference_rounds.find_one({"id": rounds["T1"]["id"]})
    assert stored["club_day"] == "2026-10-01"


# ---------------------------------------------------------------- Profil: Einsätze
@pytest.mark.asyncio
async def test_the_member_profile_counts_tournament_days(flow):
    _, series = await _season(flow)
    await _paste(flow, series, "T1 · 01.10.2026\nT2 · 08.10.2026")
    rounds = (await _calendar(flow, series))["rounds"]
    await flow.db.club_member_profiles.insert_one({"id": "profil-t", "slug": "spieler-t", "display_name": "Spieler T",
                                                   "is_active": True})
    for item, names in ((rounds[0], ["Spieler T", "Spieler U"]), (rounds[1], ["Spieler U"])):
        saved = await flow.put(f"{_rounds(series)}/{item['id']}/results", json={
            "rows": [{"name": name, "place": place} for place, name in enumerate(names, start=1)],
            "status": "published", "expected_version": 0})
        assert saved.status_code == 200, saved.text
    await flow.db.reference_participants.update_one({"series_id": series["id"], "name": "Spieler T"}, {"$set": {
        "link": "member", "profile_id": "profil-t", "is_club_member": True, "link_status": "decided"}})
    await flow.db.references.insert_one({
        "id": "ref-tft", "title": "Probe TFT", "series_id": series["id"], "visibility": "public", "is_active": True,
        "member_profile_ids": ["profil-t"], "date": "2026-10-10",
        "entries": [{"kind": "solo", "member_profile_ids": ["profil-t"], "placement": 2}]})
    flow.act_as(None)
    profile = (await flow.get("/api/membership/profiles/spieler-t")).json()
    reference = next(item for item in profile["references"] if item["id"] == "ref-tft")
    assert reference["appearances"]["unit"] == "rounds"  # die heutige App kennt nur diesen Wert
    assert reference["appearances"]["unit_words"] == ["Turniertag", "Turniertagen"]


# ---------------------------------------------------------------- Läuft gerade
@pytest.mark.asyncio
async def test_running_puts_a_season_with_only_open_days_after_dated_ones_but_before_seasons_without_any(flow):
    # Angelegt in umgekehrter Reihenfolge: ohne die Regel stünde die Saison ohne Termin vor der mit offenen Terminen.
    empty_lineage, _ = await _season(flow)
    lineage, series = await _season(flow, planned_rounds=9)
    await _paste(flow, series, "T1 · offen\nT2 · offen")
    dated_lineage, dated = await _season(flow)
    await _paste(flow, dated, "T1 · 20.11.2026")
    flow.act_as(None)
    items = (await flow.get(f"{PUBLIC}/running")).json()["items"]
    assert [item["lineage"]["slug"] for item in items] == [dated_lineage["slug"], lineage["slug"],
                                                           empty_lineage["slug"]]
    # Der offene nächste Termin kommt mit Kürzel und ohne Tag - das Web schreibt „Termin folgt“ dazu.
    assert (items[1]["next"]["code"], items[1]["next"]["club_day"]) == ("T1", None)
    assert items[2]["next"] is None
