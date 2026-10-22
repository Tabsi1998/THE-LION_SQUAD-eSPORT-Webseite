"""Korrekturen aus Ergebnis-Bildern lernen (#2012) über die echten Routen: Ändert der Vorstand im Blatt einen gelesenen
Namen auf einen Teilnehmer bzw. ein gelesenes Team auf ein Team, merkt sich die Saison die gelesene Schreibweise beim
Übernehmen - nur eindeutige, nur der Vorstand, mit Protokoll; sichtbar und entfernbar. Beim nächsten Bild zählt sie wie
der Name. Nur erfundene Namen."""
import pathlib
import sys
from datetime import date, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import result_image_fixture as fixture  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import migrations, result_image_ocr  # noqa: E402
from services.dolibarr_policy import club_today  # noqa: E402
from services.result_image_ocr import Read, Reading, RowReading  # noqa: E402

ADMIN = "/api/reference-series/admin"
PNG = {"Content-Type": "image/png"}


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "result-image-tests-secret-with-32-characters")
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


def _day(offset: int) -> str:
    return (date.fromisoformat(club_today()) + timedelta(days=offset)).isoformat()


async def _setup(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    board = await flow.add_user(name="vorstand-vera")
    await flow.db.users.update_one({"id": board["id"]}, {"$set": {"areas": ["content"]}})
    board["areas"] = ["content"]
    flow.act_as(board)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Liga", "kind": "racing"})).json()
    series = (await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage["id"], "season": "2026",
                                                       "points_scheme_id": "formula_1"})).json()
    rounds = []
    for offset in range(2):
        created = await flow.post(f"{ADMIN}/series/{series['id']}/rounds",
                                  json={"day": _day(-14 + offset * 7), "code": f"R{offset + 1}"})
        rounds.append(created.json()["id"])
    ids = {}
    for name, number, team in (("Anna Probe", "7", "Rotor Racing"), ("Bert Bolzt", "12", "Blaupfeil GP"),
                               ("Carl Kurve", "21", "Rotor Racing"), ("Max#AAA", "30", "Blaupfeil GP")):
        added = await flow.post(f"{ADMIN}/series/{series['id']}/participants",
                                json={"name": name, "start_number": number, "default_team": team})
        assert added.status_code == 200, added.text
        ids[name] = added.json()["id"]
    captain = await flow.add_user(name="captain-carla")
    await flow.db.memberships.insert_one({"user_id": captain["id"], "member_status": "active"})
    staff = await flow.post(f"{ADMIN}/series/{series['id']}/staff", json={"user_id": captain["id"],
                                                                          "valid_until": _day(30)})
    assert staff.status_code == 200, staff.text
    return {"board": board, "captain": captain, "series": series, "rounds": rounds, "ids": ids}


def _url(ctx, index: int, suffix: str = "") -> str:
    return f"{ADMIN}/series/{ctx['series']['id']}/rounds/{ctx['rounds'][index]}/results{suffix}"


async def _participant(flow, pid: str) -> dict:
    return await flow.db.reference_participants.find_one({"id": pid}, {"_id": 0})


@pytest.mark.asyncio
async def test_board_corrections_are_learned_only_when_unambiguous(flow):
    ctx = await _setup(flow)
    ids = ctx["ids"]
    rows = [
        # Gelesen „Anna Prob3“, Team „Rotr Racng“ - der Vorstand wählt Anna und Rotor Racing: gelernt.
        {"participant_id": ids["Anna Probe"], "place": 1, "team": "Rotor Racing", "read_name": "Anna Prob3",
         "read_team": "Rotr Racng"},
        # Gelesen ist der Name eines anderen Teilnehmers: nicht eindeutig, nichts gelernt.
        {"participant_id": ids["Bert Bolzt"], "place": 2, "team": "Blaupfeil GP", "read_name": "Carl Kurve"},
        # Ganz anderer Name: keine Verlesung, sondern eine andere Zeile - nichts gelernt.
        {"participant_id": ids["Carl Kurve"], "place": 3, "read_name": "Zora Zebra"},
        # Ein anderer Tag einer Spielkennung ist eine andere Person - nichts gelernt.
        {"participant_id": ids["Max#AAA"], "place": 4, "read_name": "Max#BBB"},
    ]
    saved = await flow.put(_url(ctx, 0), json={"rows": rows, "status": "published", "expected_version": 0})
    assert saved.status_code == 200, saved.text
    learned = {"names": [{"participant_id": ids["Anna Probe"], "name": "Anna Prob3"}],
               "teams": [{"read": "Rotr Racng", "team": "Rotor Racing"}]}
    assert saved.json()["learned"] == learned
    assert [item["name"] for item in (await _participant(flow, ids["Anna Probe"]))["read_aliases"]] == ["Anna Prob3"]
    for name in ("Bert Bolzt", "Carl Kurve", "Max#AAA"):
        assert not (await _participant(flow, ids[name])).get("read_aliases"), name
    series = await flow.db.reference_series.find_one({"id": ctx["series"]["id"]}, {"_id": 0})
    assert [(item["read"], item["team"]) for item in series["read_team_aliases"]] == [("Rotr Racng", "Rotor Racing")]
    log = await flow.db.audit_logs.find_one({"action": "reference_result.save"}, {"_id": 0})
    assert log["data"]["learned"] == learned
    # Im Blatt steht die gelesene Schreibweise nicht.
    sheet = await flow.db.reference_round_results.find_one({"round_id": ctx["rounds"][0]}, {"_id": 0})
    assert "Anna Prob3" not in str(sheet) and "Rotr Racng" not in str(sheet)


@pytest.mark.asyncio
async def test_learned_spellings_are_recognised_shown_and_removable(flow, monkeypatch):
    ctx = await _setup(flow)
    ids = ctx["ids"]
    saved = await flow.put(_url(ctx, 0), json={"rows": [
        {"participant_id": ids["Anna Probe"], "place": 1, "team": "Rotor Racing", "read_name": "Anna Prob3",
         "read_team": "Rtr Rcng"}], "status": "published", "expected_version": 0})
    assert saved.status_code == 200, saved.text

    def read(text):
        return Read(text, 95, [(word, 95) for word in text.split()])

    reading = Reading(template_id="rennliga-dunkel", header_found=True, text_height=20, mean_conf=95, rows=[
        RowReading(cells={"place": read("1"), "name": read("Anna Prob3"), "team": read("Rtr Rcng"),
                          "time": read("1:31.123")},
                   strips={"name": read("Anna Prob3"), "team": read("Rtr Rcng")})])
    monkeypatch.setattr(result_image_ocr, "available", lambda: True)
    monkeypatch.setattr(result_image_ocr, "read", lambda image, template, **_: reading)
    image = await flow.post(_url(ctx, 1, "/image"), content=fixture.png_bytes(fixture.render()), headers=PNG)
    row = image.json()["rows"][0]
    assert (row["participant_id"], row["team"], row["uncertain"]) == (ids["Anna Probe"], "Rotor Racing", [])

    # Sichtbar beim Teilnehmer und bei der Saison - und entfernbar (nur entfernen, nie hinzufügen), mit Protokoll.
    listed = (await flow.get(f"{ADMIN}/series/{ctx['series']['id']}/participants")).json()["participants"]
    anna = next(item for item in listed if item["id"] == ids["Anna Probe"])
    assert [item["name"] for item in anna["read_aliases"]] == ["Anna Prob3"]
    removed = await flow.patch(f"{ADMIN}/series/{ctx['series']['id']}/participants/{ids['Anna Probe']}",
                               json={"read_aliases": ["Erfunden Neu"]})
    assert removed.status_code == 200, removed.text
    assert removed.json().get("read_aliases") == []
    log = await flow.db.audit_logs.find_one({"action": "reference_series.participant_update"}, {"_id": 0})
    assert [item["name"] for item in log["data"]["changes"]["read_aliases"][0]] == ["Anna Prob3"]
    teams = await flow.patch(f"{ADMIN}/series/{ctx['series']['id']}", json={"read_team_aliases": []})
    assert teams.status_code == 200, teams.text
    assert teams.json()["read_team_aliases"] == []
    assert await flow.db.audit_logs.count_documents({"action": "reference_series.read_team_aliases"}) == 1
    row = (await flow.post(_url(ctx, 1, "/image"), content=fixture.png_bytes(fixture.render()),
                           headers=PNG)).json()["rows"][0]
    assert {"name", "team"} <= set(row["uncertain"])


@pytest.mark.asyncio
async def test_learned_spellings_follow_a_merge(flow):
    """Zwei Schreibweisen derselben Person zusammengeführt (#1929): die gelernten Schreibweisen gehen mit."""
    ctx = await _setup(flow)
    ids = ctx["ids"]
    await flow.db.reference_participants.update_one({"id": ids["Carl Kurve"]},
                                                    {"$set": {"read_aliases": [{"name": "Carl Kurue", "at": "x"}]}})
    merged = await flow.post(f"{ADMIN}/series/{ctx['series']['id']}/participants/{ids['Anna Probe']}/merge",
                             json={"duplicate_id": ids["Carl Kurve"]})
    assert merged.status_code == 200, merged.text
    assert [item["name"] for item in merged.json()["read_aliases"]] == ["Carl Kurue"]


@pytest.mark.asyncio
async def test_captains_do_not_teach_spellings(flow):
    ctx = await _setup(flow)
    flow.act_as(ctx["captain"])
    saved = await flow.put(_url(ctx, 0), json={"rows": [
        {"participant_id": ctx["ids"]["Anna Probe"], "place": 1, "team": "Rotor Racing", "read_name": "Anna Prob3",
         "read_team": "Rotr Racng"}], "status": "draft", "expected_version": 0})
    assert saved.status_code == 200, saved.text
    assert "learned" not in saved.json()
    assert not (await _participant(flow, ctx["ids"]["Anna Probe"])).get("read_aliases")
    assert not (await flow.db.reference_series.find_one({"id": ctx["series"]["id"]})).get("read_team_aliases")
