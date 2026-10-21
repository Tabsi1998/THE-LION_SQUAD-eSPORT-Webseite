"""Partner-Plattform anbinden (#1964) über die echten Routen: Quelle je Saison nur aus der Positivliste, „Jetzt holen“
als Vorschau ohne Schreiben, Übernehmen als Entwurf (nie veröffentlicht), Termine anlegen bzw. zuordnen, ein zweiter
Abruf ohne Doppelte, nie still überschreiben (Abweichungen, Version, Entwurf daneben), Namensabgleich mit Riot-ID und
Fehler der Quelle, die nur den Abruf stoppen. Die Quelle ist ein ``httpx.MockTransport`` mit anonymisierten Antworten -
kein Abruf ins Internet. Nur erfundene Namen."""
import json
import pathlib
import sys
from datetime import date, timedelta

import httpx
import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import migrations, partner_platforms  # noqa: E402
from services.dolibarr_policy import club_today  # noqa: E402
from test_tournament_days_unit import RULES  # noqa: E402

ADMIN = "/api/reference-series/admin"
PUBLIC = "/api/reference-series/public"
BASE = "https://tft.pineapps.at"
FIXTURES = pathlib.Path(__file__).resolve().parent / "fixtures" / "tft_dashboard"
PATHS = {"/api/series": "series.json", "/api/series/7": "series_7.json",
         "/api/tournaments/901": "tournament_901.json", "/api/tournaments/902": "tournament_902.json"}


def _fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class Source:
    """Die Partner-Plattform zum Mitschreiben: welche Pfade abgefragt wurden; Antworten lassen sich austauschen."""

    def __init__(self):
        self.calls = []
        self.answers = {path: _fixture(name) for path, name in PATHS.items()}
        self.fail = None

    def __call__(self, request):
        self.calls.append(request.url.path)
        assert request.url.host == "tft.pineapps.at" and request.method == "GET"
        if self.fail:
            return self.fail(request)
        if request.url.path not in self.answers:
            return httpx.Response(404)
        return httpx.Response(200, json=self.answers[request.url.path])


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    # Der Zähler gegen zu viele Abrufe nennt das Konto nur als Schlüssel-Hash - dafür braucht es das Server-Geheimnis.
    monkeypatch.setenv("JWT_SECRET", "partner-tests-secret-with-at-least-32-characters")
    partner_platforms.clear_cache()
    source = Source()
    monkeypatch.setattr(partner_platforms, "_transport", httpx.MockTransport(source))
    instance.source = source
    try:
        yield instance
    finally:
        partner_platforms.clear_cache()
        await shutdown()


async def _setup(flow, *, source=True):
    await migrations.migrate_points_scheme_templates(flow.db)
    board = await flow.add_user(role="user", name="vorstand-vera")
    await flow.db.users.update_one({"id": board["id"]}, {"$set": {"areas": ["content"]}})
    board["areas"] = ["content"]
    flow.act_as(board)
    host = (await flow.post("/api/partners", json={"name": "Probe Ananas"})).json()
    lineage = (await flow.post(f"{ADMIN}/lineages", json={
        "title": "Probe Masters", "kind": "series", "partner_ids": [host["id"]],
        "partner_roles": {host["id"]: "organizer"}})).json()
    series = (await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage["id"], "season": "2026/27",
                                                       "rules": RULES})).json()
    if source:
        saved = await flow.put(_url(series), json={"platform": "tft_dashboard", "base_url": BASE, "series_ref": "7",
                                                   "series_name": "Probe Masters 2026/27", "partner_id": host["id"]})
        assert saved.status_code == 200, saved.text
    return board, host, lineage, series


def _url(series, suffix=""):
    return f"{ADMIN}/series/{series['id']}/partner-source{suffix}"


def _items(preview):
    return {item["ref"]: item for item in preview["items"]}


def _apply_body(preview, refs):
    items = _items(preview)
    return {"items": [{"ref": ref, "fingerprint": items[ref]["fingerprint"],
                       "expected_version": items[ref]["expected_version"],
                       "round_id": (items[ref]["round"] or {}).get("id")} for ref in refs]}


async def _sheet(flow, round_id):
    return await flow.db.reference_round_results.find_one({"round_id": round_id}, {"_id": 0})


# ---------------------------------------------------------------- Einstellung
@pytest.mark.asyncio
async def test_the_source_of_a_season_takes_only_addresses_and_references_of_the_fixed_list(flow):
    _, host, _, series = await _setup(flow, source=False)
    for body in ({"platform": "tft_dashboard", "base_url": "https://example.com", "series_ref": "7"},
                 {"platform": "tft_dashboard", "base_url": "http://tft.pineapps.at", "series_ref": "7"},
                 {"platform": "tft_dashboard", "base_url": BASE, "series_ref": "7/../8"},
                 {"platform": "anderes", "base_url": BASE, "series_ref": "7"},
                 {"platform": "tft_dashboard", "base_url": BASE, "series_ref": "7", "partner_id": "fremd"}):
        refused = await flow.put(_url(series), json=body)
        assert refused.status_code == 422, (body, refused.text)
    assert flow.source.calls == []
    saved = await flow.put(_url(series), json={"platform": "tft_dashboard", "base_url": BASE + "/", "series_ref": "7",
                                               "series_name": "Probe Masters 2026/27", "partner_id": host["id"]})
    assert saved.status_code == 200, saved.text
    state = (await flow.get(_url(series))).json()
    fields = ("platform", "base_url", "series_ref", "series_name", "partner_id")
    assert {key: state["source"][key] for key in fields} == {
        "platform": "tft_dashboard", "base_url": BASE, "series_ref": "7", "series_name": "Probe Masters 2026/27",
        "partner_id": host["id"]}
    assert state["choices"] == partner_platforms.choices()
    assert state["partners"] == [{"id": host["id"], "name": "Probe Ananas", "role": "organizer"}]
    log = await flow.db.audit_logs.find_one({"action": "reference_series.partner_source"}, {"_id": 0})
    assert log["target_id"] == series["id"] and log["data"]["after"]["series_ref"] == "7"
    # Die Serien beim Partner zur Auswahl - nur von der erlaubten Adresse.
    listed = (await flow.get(_url(series, "/series"), params={"platform": "tft_dashboard", "base_url": BASE})).json()
    assert [(item["ref"], item["name"]) for item in listed["items"]] == [
        ("7", "Probe Masters 2026/27"), ("6", "Probe Saison 2025/26")]
    foreign = await flow.get(_url(series, "/series"),
                             params={"platform": "tft_dashboard", "base_url": "https://example.com"})
    assert foreign.status_code == 422
    off = await flow.put(_url(series), json={"platform": None})
    assert off.status_code == 200 and (await flow.get(_url(series))).json()["source"] is None


@pytest.mark.asyncio
async def test_only_the_board_sets_and_fetches_the_source(flow):
    _, _, _, series = await _setup(flow)
    captain = await flow.add_user(role="user", name="captain-carl")
    await flow.db.reference_series_staff.insert_one({
        "id": "staff-1", "series_id": series["id"], "user_id": captain["id"], "role": "captain",
        "valid_until": (date.fromisoformat(club_today()) + timedelta(days=30)).isoformat()})
    await flow.db.memberships.insert_one({"user_id": captain["id"], "member_status": "active"})
    flow.act_as(captain)
    assert (await flow.post(_url(series, "/preview"))).status_code == 403
    assert (await flow.put(_url(series), json={"platform": None})).status_code == 403
    flow.act_as(None)
    assert (await flow.post(_url(series, "/preview"))).status_code == 401


# ---------------------------------------------------------------- Vorschau und Übernehmen
@pytest.mark.asyncio
async def test_fetching_shows_a_preview_and_writes_nothing(flow):
    _, _, _, series = await _setup(flow)
    preview = await flow.post(_url(series, "/preview"))
    assert preview.status_code == 200, preview.text
    items = _items(preview.json())
    assert list(items) == ["901", "902", "903"]
    first = items["901"]
    assert (first["state"], first["action"], first["round"], first["target"]) == ("new", "new", None, "sheet")
    assert (first["club_day"], first["counts"]) == ("2026-09-25", {"players": 6, "rounds": 3, "lobbies": 4,
                                                                   "bots": 1, "guests": 1})
    assert sorted(item["name"] for item in first["unknown_names"]) == sorted([
        "Ada Ausgedacht#AAA", "Bruno Beispiel#EUW", "Cleo Muster#TLS", "Dario Demo#1234", "Ella Erfunden",
        "Finn Fiktiv#EUW"])
    assert first["errors"] == []
    assert (items["902"]["double_up"], items["902"]["state"]) == (True, "new")
    assert (items["903"]["state"], items["903"]["finished"]) == ("new_round", False)
    assert "/api/tournaments/903" not in flow.source.calls  # ein offenes Turnier hat noch keine Ergebnisse
    for collection in ("reference_rounds", "reference_round_results", "reference_participants"):
        assert await getattr(flow.db, collection).count_documents({"series_id": series["id"]}) == 0, collection
    text = json.dumps(preview.json())
    assert "puuid" not in text and "avatar" not in text


@pytest.mark.asyncio
async def test_taking_over_creates_rounds_and_drafts_but_never_publishes(flow):
    _, _, lineage, series = await _setup(flow)
    preview = (await flow.post(_url(series, "/preview"))).json()
    applied = await flow.post(_url(series, "/apply"), json=_apply_body(preview, ["901", "902", "903"]))
    assert applied.status_code == 200, applied.text
    result = {item["ref"]: item for item in applied.json()["items"]}
    assert {ref: item["status"] for ref, item in result.items()} == {"901": "saved", "902": "saved", "903": "round"}
    assert applied.json()["open_unknown"] is True

    rounds = await flow.db.reference_rounds.find({"series_id": series["id"]}, {"_id": 0}).to_list(None)
    shown = sorted((item["club_day"], item["partner_ref"]["ref"], item["source"], item["status"]) for item in rounds)
    assert shown == [
        ("2026-09-25", "901", "partner", "planned"), ("2026-10-16", "902", "partner", "planned"),
        ("2026-12-11", "903", "partner", "planned")]
    by_ref = {item["partner_ref"]["ref"]: item for item in rounds}
    assert by_ref["901"]["title"] == "Turnier 1 - Probe Masters - Online"

    day = await _sheet(flow, by_ref["901"]["id"])
    assert day["status"] == "draft" and day["version"] == 1
    people = {row["id"]: row for row in await flow.db.reference_participants.find(
        {"series_id": series["id"]}, {"_id": 0}).to_list(None)}
    named = {people[row["participant_id"]]["name"]: row for row in day["rows"]}
    assert list(named) == ["Ada Ausgedacht#AAA", "Bruno Beispiel#EUW", "Dario Demo#1234", "Cleo Muster#TLS",
                           "Ella Erfunden", "Finn Fiktiv#EUW"]
    # Rundenpunkte wie geliefert: der Bot belegt Platz 6 der zweiten Runde, Finn wird Siebter mit 2 Punkten.
    finn = named["Finn Fiktiv#EUW"]
    assert finn["day_rounds"] == [{"place": 2, "points": 7, "lobby": "2"}, {"place": 7, "points": 2, "lobby": "1"}]
    assert (finn["place"], finn["day_points"], finn["marks"]) == (6, 9, ["left"])
    assert named["Ada Ausgedacht#AAA"]["day_rounds"][2] == {"place": 2, "points": 7, "lobby": "1"}
    assert all(person["link_status"] == "open" for person in people.values())
    assert len(people) == 8  # Gina und Hugo kommen aus dem Double Up dazu - der Bot nie

    double = await _sheet(flow, by_ref["902"]["id"])
    assert double["status"] == "draft" and double["double_up"] is True
    pairs = {people[row["participant_id"]]["name"]: (row["place"], people[row["partner_id"]]["name"])
             for row in double["rows"]}
    assert pairs["Ada Ausgedacht#AAA"] == (1, "Gina Gedacht#TLS") and pairs["Gina Gedacht#TLS"][1] == (
        "Ada Ausgedacht#AAA")
    assert pairs["Ella Erfunden"] == (4, "Finn Fiktiv#EUW")
    assert await _sheet(flow, by_ref["903"]["id"]) is None

    # Nichts ist veröffentlicht: kein Stand, Termine nicht gewertet.
    filled = {"series_id": series["id"], "rows.0": {"$exists": True}}
    assert await flow.db.reference_standings.count_documents(filled) == 0
    log = await flow.db.audit_logs.find_one({"action": "reference_partner.import"}, {"_id": 0})
    assert [(item["ref"], item["status"]) for item in log["data"]["items"]] == [
        ("901", "saved"), ("902", "saved"), ("903", "round")]
    saves = await flow.db.audit_logs.find({"action": "reference_result.save"}, {"_id": 0}).to_list(None)
    assert {entry["data"]["source"] for entry in saves} == {"partner"} and len(saves) == 2
    # Die neuen Namen stehen im Dialog „Unbekannte Namen“.
    unknown = (await flow.get(f"{ADMIN}/series/{series['id']}/unknown-names")).json()
    assert len(unknown["items"]) == 8
    flow.act_as(None)
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()
    assert page["standings"] is None or not page["standings"]["rows"]


@pytest.mark.asyncio
async def test_a_second_fetch_finds_everything_and_creates_no_duplicates(flow):
    _, _, _, series = await _setup(flow)
    first = (await flow.post(_url(series, "/preview"))).json()
    await flow.post(_url(series, "/apply"), json=_apply_body(first, ["901", "902", "903"]))
    again = _items((await flow.post(_url(series, "/preview"))).json())
    assert {ref: (item["state"], item["action"]) for ref, item in again.items()} == {
        "901": ("same", "linked"), "902": ("same", "linked"), "903": ("waiting", "linked")}
    assert again["901"]["unknown_names"] == []
    repeat = await flow.post(_url(series, "/apply"), json=_apply_body({"items": list(again.values())},
                                                                      ["901", "902", "903"]))
    assert [item["status"] for item in repeat.json()["items"]] == ["same", "same", "same"]
    assert await flow.db.reference_rounds.count_documents({"series_id": series["id"]}) == 3
    assert await flow.db.reference_round_results.count_documents({"series_id": series["id"]}) == 2
    assert await flow.db.reference_participants.count_documents({"series_id": series["id"]}) == 8
    assert [sheet["version"] for sheet in await flow.db.reference_round_results.find({}).to_list(None)] == [1, 1]


@pytest.mark.asyncio
async def test_a_published_sheet_is_never_overwritten_silently(flow):
    """Ein von Hand veröffentlichtes Blatt am selben Tag: die Vorschau nennt die Abweichungen, Übernehmen mit altem
    Stand ändert nichts, mit dem gezeigten Stand entsteht ein Entwurf daneben - das veröffentlichte Blatt bleibt, der
    Sonderbonus von Hand auch."""
    _, _, _, series = await _setup(flow)
    manual = (await flow.post(f"{ADMIN}/series/{series['id']}/rounds", json={"day": "2026-09-25", "code": "T1"})).json()
    body = {"rows": [{"name": "Ada Ausgedacht", "place": 1, "bonus_keys": ["bingo"],
                      "day_rounds": [{"points": 8}, {"points": 8}, {"points": 7}]},
                     {"name": "Bruno Beispiel", "place": 2,
                      "day_rounds": [{"points": 7}, {"points": 6}, {"points": 8}]}],
            "status": "published", "expected_version": 0}
    saved = await flow.put(f"{ADMIN}/series/{series['id']}/rounds/{manual['id']}/results", json=body)
    assert saved.status_code == 200, saved.text
    preview = (await flow.post(_url(series, "/preview"))).json()
    item = _items(preview)["901"]
    assert (item["action"], item["round"]["id"], item["state"], item["target"]) == (
        "assign", manual["id"], "changed", "pending_draft")
    assert (item["sheet"]["status"], item["expected_version"]) == ("published", 1)
    kinds = [(change["name"], change["kind"]) for change in item["changes"]]
    assert ("Ada Ausgedacht", "changed") in kinds and ("Dario Demo#1234", "added") in kinds
    ada = next(change for change in item["changes"] if change["name"] == "Ada Ausgedacht")
    assert ada["fields"]["day_points"] == [None, 23]

    stale = _apply_body(preview, ["901"])
    stale["items"][0]["expected_version"] = 0
    refused = (await flow.post(_url(series, "/apply"), json=stale)).json()
    assert refused["items"][0]["status"] == "conflict"
    before = await _sheet(flow, manual["id"])
    assert before["version"] == 1 and before["pending_draft"] is None

    taken = (await flow.post(_url(series, "/apply"), json=_apply_body(preview, ["901"]))).json()
    assert (taken["items"][0]["status"], taken["items"][0]["target"]) == ("saved", "pending_draft")
    after = await _sheet(flow, manual["id"])
    assert after["status"] == "published" and after["rows"] == before["rows"]
    draft = after["pending_draft"]
    assert len(draft["rows"]) == 6 and draft["created_participant_ids"]
    ada_row = next(row for row in draft["rows"] if row["participant_id"] == before["rows"][0]["participant_id"])
    assert (ada_row["bonus_keys"], ada_row["day_points"]) == (["bingo"], 23)
    linked = await flow.db.reference_rounds.find_one({"id": manual["id"]}, {"_id": 0})
    assert linked["partner_ref"] == {"platform": "tft_dashboard", "ref": "901"}
    assert (linked["code"], linked["status"]) == ("T1", "scored")
    # Der Vorstand gibt den Entwurf wie gewohnt frei.
    approved = await flow.post(f"{ADMIN}/series/{series['id']}/rounds/{manual['id']}/results/approve",
                               json={"expected_version": after["version"]})
    assert approved.status_code == 200, approved.text


@pytest.mark.asyncio
async def test_an_existing_draft_is_replaced_only_after_the_preview(flow):
    _, _, _, series = await _setup(flow)
    manual = (await flow.post(f"{ADMIN}/series/{series['id']}/rounds", json={"day": "2026-10-16"})).json()
    await flow.put(f"{ADMIN}/series/{series['id']}/rounds/{manual['id']}/results", json={
        "rows": [{"name": "Ada Ausgedacht#AAA", "place": 3}], "status": "draft", "expected_version": 0})
    item = _items((await flow.post(_url(series, "/preview"))).json())["902"]
    assert (item["state"], item["target"], item["expected_version"]) == ("changed", "draft", 1)
    taken = (await flow.post(_url(series, "/apply"), json=_apply_body({"items": [item]}, ["902"]))).json()
    assert taken["items"][0]["status"] == "saved"
    sheet = await _sheet(flow, manual["id"])
    assert (sheet["status"], sheet["version"], len(sheet["rows"]), sheet["double_up"]) == ("draft", 2, 8, True)
    revision = await flow.db.reference_round_result_revisions.find_one({"result_id": sheet["id"]}, {"_id": 0})
    assert len(revision["content"]["rows"]) == 1  # der alte Stand liegt als Revision ab


@pytest.mark.asyncio
async def test_names_match_by_riot_id_and_alias_and_unknown_tags_stay_new(flow):
    _, _, _, series = await _setup(flow)
    sid = series["id"]
    await flow.db.reference_participants.insert_many([
        {"id": "p-ada", "series_id": sid, "name": "Ada Ausgedacht", "link": "external", "link_status": "decided"},
        {"id": "p-bruno", "series_id": sid, "name": "Bruno Beispiel#BBB", "link": "external",
         "link_status": "decided"},
        {"id": "p-cleo", "series_id": sid, "name": "Cleo Muster#TLS", "link": "external", "link_status": "decided"}])
    item = _items((await flow.post(_url(series, "/preview"))).json())["901"]
    unknown = sorted(entry["name"] for entry in item["unknown_names"])
    # „Ada Ausgedacht#AAA“ ist Ada (Tag ↔ ohne Tag), Cleo passt genau; „Bruno Beispiel#EUW“ ist nicht „#BBB“.
    assert "Ada Ausgedacht#AAA" not in unknown and "Cleo Muster#TLS" not in unknown
    assert "Bruno Beispiel#EUW" in unknown and "Ella Erfunden" in unknown
    await flow.post(_url(series, "/apply"), json=_apply_body({"items": [item]}, ["901"]))
    rows = (await _sheet(flow, (await flow.db.reference_rounds.find_one({"series_id": sid}))["id"]))["rows"]
    ids = [row["participant_id"] for row in rows]
    assert ids[0] == "p-ada" and "p-cleo" in ids and "p-bruno" not in ids


@pytest.mark.asyncio
async def test_changed_data_at_the_partner_between_preview_and_apply_is_not_taken(flow):
    _, _, _, series = await _setup(flow)
    preview = (await flow.post(_url(series, "/preview"))).json()
    changed = _fixture("tournament_901.json")
    changed["participants"][0]["total_points"] = "24"
    flow.source.answers["/api/tournaments/901"] = changed
    partner_platforms.clear_cache()
    result = (await flow.post(_url(series, "/apply"), json=_apply_body(preview, ["901"]))).json()
    assert result["items"][0]["status"] == "conflict"
    assert await flow.db.reference_round_results.count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_failing_source_stops_only_the_fetch(flow):
    _, _, lineage, series = await _setup(flow)

    def timeout(request):
        raise httpx.ReadTimeout("langsam", request=request)

    flow.source.fail = timeout
    failed = await flow.post(_url(series, "/preview"))
    assert failed.status_code == 502 and failed.json()["detail"] == partner_platforms.TIMEOUT_MESSAGE
    flow.source.fail = lambda request: httpx.Response(500)
    assert (await flow.post(_url(series, "/preview"))).json()["detail"] == partner_platforms.STATUS_MESSAGE
    # Die Seiten bleiben heil.
    assert (await flow.get(f"{ADMIN}/series/{series['id']}")).status_code == 200
    assert (await flow.get(_url(series))).status_code == 200
    flow.act_as(None)
    assert (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).status_code == 200


@pytest.mark.asyncio
async def test_a_broken_tournament_marks_only_its_own_line(flow):
    _, _, _, series = await _setup(flow)
    flow.source.answers["/api/tournaments/902"] = {"id": "kaputt"}
    items = _items((await flow.post(_url(series, "/preview"))).json())
    assert items["901"]["state"] == "new"
    assert (items["902"]["state"], items["902"]["error"]) == ("error", partner_platforms.FORMAT_MESSAGE)


@pytest.mark.asyncio
async def test_without_a_source_there_is_nothing_to_fetch(flow):
    _, _, _, series = await _setup(flow, source=False)
    assert (await flow.post(_url(series, "/preview"))).status_code == 409
    assert flow.source.calls == []


@pytest.mark.asyncio
async def test_the_series_page_names_the_data_source_with_a_link_to_the_partner(flow):
    _, host, lineage, series = await _setup(flow)
    flow.act_as(None)
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()
    assert page["data_source"] == {"provider": "PineApps", "url": BASE,
                                   "partner": {"id": host["id"], "slug": host["slug"], "name": "Probe Ananas"}}
    assert flow.source.calls == []  # die Serienseite fragt nie beim Partner nach
