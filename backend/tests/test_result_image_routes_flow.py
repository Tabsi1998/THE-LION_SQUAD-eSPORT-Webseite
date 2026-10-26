"""Ergebnis-Bild auslesen (#1756) über die echten Routen: nur Vorstand und Captains der Saison, Termin muss zur Saison
gehören, Vorlage je Spur und Saison (Standard je Art, abschaltbar), Größe am Kopf der Anfrage begrenzt, feste
Meldungen, Rate-Limit je Konto, Aliase nur für den Vorstand - und gespeichert wird nichts. Mit Tesseract zusätzlich
einmal Ende-zu-Ende über die Route. Nur erfundene Namen."""
import pathlib
import struct
import sys
from datetime import date, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import result_image_fixture as fixture  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from routes import reference_result_image_routes as image_routes, reference_result_routes  # noqa: E402
from services import migrations, result_image_ocr, result_image_second  # noqa: E402
from services.dolibarr_policy import club_today  # noqa: E402
from services.result_image_ocr import Read, Reading, RowReading  # noqa: E402
from test_result_image_ocr import _png_in_two_blocks, needs_tesseract  # noqa: E402

ADMIN = "/api/reference-series/admin"
PNG = {"Content-Type": "image/png"}


@pytest_asyncio.fixture
async def flow(monkeypatch):
    # Das Rate-Limit schlüsselt das Konto mit dem Server-Geheimnis (``keyed_subject``).
    monkeypatch.setenv("JWT_SECRET", "result-image-tests-secret-with-32-characters")
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


def _day(offset: int) -> str:
    return (date.fromisoformat(club_today()) + timedelta(days=offset)).isoformat()


async def _setup(flow, *, kind: str = "racing", people=None):
    await migrations.migrate_points_scheme_templates(flow.db)
    board = await flow.add_user(name="vorstand-vera")
    await flow.db.users.update_one({"id": board["id"]}, {"$set": {"areas": ["content"]}})
    board["areas"] = ["content"]
    flow.act_as(board)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Liga", "kind": kind, "label": "F1"})).json()
    # #2024: „Formel 1“ passt nur zur Rennliga - andere Arten starten mit ihren Standardregeln.
    scheme = {"points_scheme_id": "formula_1"} if kind == "racing" else {}
    body = {"lineage_id": lineage["id"], "season": "2026", **scheme}
    series = (await flow.post(f"{ADMIN}/series", json=body)).json()
    other = (await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage["id"], "season": "2027"})).json()
    round_doc = (await flow.post(f"{ADMIN}/series/{series['id']}/rounds",
                                 json={"day": _day(-7), "code": "R1", "venue": "Probering Nord"})).json()
    foreign = (await flow.post(f"{ADMIN}/series/{other['id']}/rounds", json={"day": _day(-7)})).json()
    ids = {}
    for name, number, team in people or (("Anna Probe", "7", "Rotor Racing"), ("Bert Bolzt", "12", "Blaupfeil GP")):
        added = await flow.post(f"{ADMIN}/series/{series['id']}/participants",
                                json={"name": name, "start_number": number, "default_team": team})
        assert added.status_code == 200, added.text
        ids[name] = added.json()["id"]
    captain = await flow.add_user(name="captain-carla")
    await flow.db.memberships.insert_one({"user_id": captain["id"], "member_status": "active"})
    staff = await flow.post(f"{ADMIN}/series/{series['id']}/staff", json={"user_id": captain["id"],
                                                                          "valid_until": _day(30)})
    assert staff.status_code == 200, staff.text
    stranger = await flow.add_user(name="fremd-fritz")
    url = f"{ADMIN}/series/{series['id']}/rounds/{round_doc['id']}/results/image"
    return {"board": board, "captain": captain, "stranger": stranger, "lineage": lineage, "series": series,
            "other": other,
            "round": round_doc, "foreign_url": f"{ADMIN}/series/{series['id']}/rounds/{foreign['id']}/results/image",
            "url": url, "ids": ids}


def _fake_reading(*names_and_numbers, times: bool = True) -> Reading:
    def read(text):
        return Read(text, 95, [(word, 95) for word in text.split()])
    rows = [RowReading(cells={"place": read(str(index)), "start_number": read(number), "name": read(name),
                              **({"time": read(f"1:3{index}.123")} if times else {})})
            for index, (name, number) in enumerate(names_and_numbers, start=1)]
    return Reading(template_id="rennliga-dunkel", rows=rows, header_found=True, text_height=20, mean_conf=95,
                   header={"track": read("Probering Nord")})


@pytest.fixture
def fake_ocr(monkeypatch):
    """Tesseract nachgestellt: ``fake_ocr.reading`` ist, was gelesen wird."""
    class Fake:
        reading = _fake_reading(("Anna Probe", "7"), ("Bert Bolzt", "12"))
        calls = 0
        max_rows = None

    def read(image, template, *, max_rows=None):
        Fake.calls += 1
        Fake.max_rows = max_rows
        assert image.mode == "RGB" and template["id"] == "rennliga-dunkel"
        return Fake.reading

    monkeypatch.setattr(result_image_ocr, "available", lambda: True)
    monkeypatch.setattr(result_image_ocr, "read", read)
    return Fake


def _png() -> bytes:
    return fixture.png_bytes(fixture.render())


async def _counts(flow) -> dict:
    return {name: await getattr(flow.db, name).count_documents({}) for name in (
        "reference_round_results", "reference_round_result_revisions", "reference_participants", "reference_aliases",
        "reference_standings")}


# ---------------------------------------------------------------- Rechte und Vorlage
@pytest.mark.asyncio
async def test_only_board_and_captains_of_the_season(flow, fake_ocr):
    ctx = await _setup(flow)
    flow.act_as(ctx["stranger"])
    assert (await flow.get(ctx["url"])).status_code == 403
    assert (await flow.post(ctx["url"], content=_png(), headers=PNG)).status_code == 403
    flow.act_as(None)
    assert (await flow.post(ctx["url"], content=_png(), headers=PNG)).status_code == 401
    flow.act_as(ctx["board"])
    assert (await flow.get(ctx["foreign_url"])).status_code == 404
    assert (await flow.post(ctx["foreign_url"], content=_png(), headers=PNG)).status_code == 404
    assert fake_ocr.calls == 0
    for user in (ctx["board"], ctx["captain"]):
        flow.act_as(user)
        info = await flow.get(ctx["url"])
        assert info.status_code == 200, info.text
        assert info.json()["template"]["id"] == "rennliga-dunkel"
        assert info.json()["available"] is True
        assert (await flow.post(ctx["url"], content=_png(), headers=PNG)).status_code == 200


@pytest.mark.asyncio
async def test_template_per_lineage_and_season(flow, fake_ocr):
    ctx = await _setup(flow, kind="team_league")
    info = (await flow.get(ctx["url"])).json()
    assert (info["template"], info["available"]) == (None, False)
    answer = await flow.post(ctx["url"], content=_png(), headers=PNG)
    assert (answer.status_code, answer.json()["detail"]) == (409, image_routes.NO_TEMPLATE)
    # Die Saison wählt die Vorlage selbst ...
    saved = await flow.patch(f"{ADMIN}/series/{ctx['series']['id']}", json={"result_image_template": "rennliga-dunkel"})
    assert saved.status_code == 200 and saved.json()["result_image_template"] == "rennliga-dunkel"
    assert (await flow.get(ctx["url"])).json()["template"]["id"] == "rennliga-dunkel"
    # ... die Spur schaltet ab, die Saison gewinnt; ohne Wahl der Saison gilt die Spur.
    lineage = f"{ADMIN}/lineages/{ctx['lineage']['id']}"
    assert (await flow.patch(lineage, json={"result_image_template": "none"})).json()["result_image_template"] == "none"
    assert (await flow.get(ctx["url"])).json()["template"]["id"] == "rennliga-dunkel"
    cleared = await flow.patch(f"{ADMIN}/series/{ctx['series']['id']}", json={"result_image_template": None})
    assert cleared.json()["result_image_template"] is None
    assert (await flow.get(ctx["url"])).json()["template"] is None
    # Unbekannte Vorlagen lehnt der Server ab.
    assert (await flow.patch(lineage, json={"result_image_template": "erfunden"})).status_code == 422
    body = {"lineage_id": ctx["lineage"]["id"], "season": "2028", "result_image_template": "erfunden"}
    assert (await flow.post(f"{ADMIN}/series", json=body)).status_code == 422


@pytest.mark.asyncio
async def test_racing_lineage_can_switch_reading_off(flow, fake_ocr):
    ctx = await _setup(flow)
    await flow.patch(f"{ADMIN}/lineages/{ctx['lineage']['id']}", json={"result_image_template": "none"})
    assert (await flow.get(ctx["url"])).json()["available"] is False
    assert (await flow.post(ctx["url"], content=_png(), headers=PNG)).status_code == 409


# ---------------------------------------------------------------- Lesen
@pytest.mark.asyncio
async def test_reading_matches_participants_and_stores_nothing(flow, fake_ocr):
    ctx = await _setup(flow)
    fake_ocr.reading = _fake_reading(("Anna Prob3", "7"), ("Bert Bolzt", "99"), ("Dora Neu", "5"))
    before = await _counts(flow)
    answer = await flow.post(ctx["url"], content=_png(), headers=PNG)
    assert answer.status_code == 200, answer.text
    data = answer.json()
    anna, bert, dora = data["rows"]
    assert (anna["participant_id"], anna["name"], anna["uncertain"]) == (ctx["ids"]["Anna Probe"], "Anna Probe", [])
    assert anna["read"] == {"name": "Anna Prob3"}
    # Sicher eine andere Nummer, die sonst keiner hat: die aus dem Bild, gelb, mit der bisherigen als Hinweis (#2012).
    assert (bert["participant_id"], bert["start_number"], bert["uncertain"], bert["hint"]) == (
        ctx["ids"]["Bert Bolzt"], "99", ["start_number"], {"start_number": "bisher 12"})
    assert (dora["participant_id"], dora["name"], dora["uncertain"]) == (None, "Dora Neu", ["name"])  # neu: gelb
    assert data["uncertain_rows"] == 2
    assert data["template"]["id"] == "rennliga-dunkel"
    assert data["track"] == {"name": "Probering Nord", "uncertain": []}
    assert data["warnings"] == []
    assert await _counts(flow) == before
    sheet = await flow.get(f"{ADMIN}/series/{ctx['series']['id']}/rounds/{ctx['round']['id']}/results")
    assert sheet.json()["sheet"] is None


@pytest.mark.asyncio
async def test_aliases_help_only_the_board(flow, fake_ocr):
    ctx = await _setup(flow)
    anna = ctx["ids"]["Anna Probe"]
    await flow.db.reference_participants.update_one({"id": anna}, {"$set": {"link": "member", "profile_id": "prof-a"}})
    await flow.db.reference_aliases.insert_one({"id": "alias-1", "name": "Alter Tag", "name_normalized": "altertag",
                                                "target": "member", "profile_id": "prof-a", "game_id": None})
    fake_ocr.reading = _fake_reading(("Alter Tag", ""))
    board = (await flow.post(ctx["url"], content=_png(), headers=PNG)).json()["rows"][0]
    assert (board["participant_id"], board["name"]) == (anna, "Anna Probe")
    flow.act_as(ctx["captain"])
    captain = (await flow.post(ctx["url"], content=_png(), headers=PNG)).json()["rows"][0]
    assert (captain["participant_id"], captain["name"]) == (None, "Alter Tag")


@pytest.mark.asyncio
async def test_roster_of_the_whole_lineage_helps_but_stays_yellow(flow, fake_ocr):
    """Kader der ganzen Spur (#2012): Namen und Teams aus einer anderen Saison derselben Spur werden vorgeschlagen -
    ohne Kennung, gelb, mit „wie in Saison …“. Wer in dieser Saison steht, zählt zuerst; ausgeblendete Namen helfen nie.
    Der Kader anderer Saisons hilft nur dem Vorstand (wie Aliase) - auch die Teams anderer Saisons (Prüfer zu #2012:
    Captains sehen sonst Teams fremder Saisons). Gelernte Schreibweisen am Teilnehmer bzw. an der Saison zählen wie
    Namen."""
    ctx = await _setup(flow)
    other_id = ctx["other"]["id"]

    for name, team in (("Emil Eck", "Altes Team"), ("Anna Probe", "Rotor Racing"), ("Geheim Name", None)):
        added = await flow.post(f"{ADMIN}/series/{other_id}/participants", json={"name": name, "default_team": team})
        assert added.status_code == 200, added.text
    await flow.db.reference_participants.update_one({"series_id": other_id, "name": "Geheim Name"},
                                                    {"$set": {"name_hidden": True}})
    await flow.db.reference_participants.update_one({"id": ctx["ids"]["Bert Bolzt"]},
                                                    {"$set": {"read_aliases": [{"name": "B3rt Boltz"}]}})
    fake_ocr.reading = _fake_reading(("Emil Ek", ""), ("Anna Probe", "7"), ("Geheim Name", ""), ("B3rt Boltz", ""))
    for index, team in enumerate(("Altes Team", "Rotor Racing", "Altes Team", "Blaupfeil GP")):
        fake_ocr.reading.rows[index].cells["team"] = Read(team, 95, [(team, 95)])
    emil, anna, hidden, bert = (await flow.post(ctx["url"], content=_png(), headers=PNG)).json()["rows"]
    assert (emil["name"], emil["participant_id"], emil["team"]) == ("Emil Eck", None, "Altes Team")
    assert {"name", "team"} <= set(emil["uncertain"])
    assert emil["hint"] == {"name": "wie in Saison 2027", "team": "wie in Saison 2027"}
    assert (anna["participant_id"], anna["uncertain"], anna["hint"]) == (ctx["ids"]["Anna Probe"], [], {})
    assert (hidden["name"], hidden["participant_id"], hidden["hint"].get("name")) == ("Geheim Name", None, None)
    assert (bert["participant_id"], bert["uncertain"]) == (ctx["ids"]["Bert Bolzt"], [])
    flow.act_as(ctx["captain"])
    fake_ocr.reading.rows[0].cells["team"] = Read("Altes Tem", 95, [("Altes", 95), ("Tem", 95)])
    emil = (await flow.post(ctx["url"], content=_png(), headers=PNG)).json()["rows"][0]
    assert (emil["name"], emil["team"], emil["hint"]) == ("Emil Ek", "Altes Tem", {})  # nur, was im Bild stand


@pytest.mark.asyncio
async def test_limits_and_fixed_messages(flow, fake_ocr, monkeypatch):
    ctx = await _setup(flow)
    # Größe schon am Kopf der Anfrage: gelesen wird dann gar nicht.
    monkeypatch.setattr(image_routes, "MAX_BYTES", 1000)
    too_big = await flow.post(ctx["url"], content=b"x" * 2000, headers=PNG)
    assert (too_big.status_code, too_big.json()["detail"]) == (413, result_image_ocr.TOO_LARGE)
    monkeypatch.setattr(image_routes, "MAX_BYTES", result_image_ocr.MAX_BYTES)
    wrong = await flow.post(ctx["url"], content=b"%PDF-1.7 kein Bild", headers=PNG)
    assert (wrong.status_code, wrong.json()["detail"]) == (400, result_image_ocr.NOT_AN_IMAGE)
    assert fake_ocr.calls == 0

    # Tesseract antwortet nicht: feste Meldung, nie der Text einer Ausnahme.
    def broken(image, template, **_):
        raise result_image_ocr.OcrUnavailable()
    monkeypatch.setattr(result_image_ocr, "read", broken)
    failed = await flow.post(ctx["url"], content=_png(), headers=PNG)
    assert (failed.status_code, failed.json()["detail"]) == (503, image_routes.UNAVAILABLE)
    monkeypatch.setattr(result_image_ocr, "available", lambda: False)
    assert (await flow.post(ctx["url"], content=_png(), headers=PNG)).json()["detail"] == image_routes.UNAVAILABLE

    # Nichts lesbar: 422 mit Hinweis.
    monkeypatch.setattr(result_image_ocr, "available", lambda: True)
    monkeypatch.setattr(result_image_ocr, "read", lambda image, template, **_: Reading(template_id="rennliga-dunkel"))
    empty = await flow.post(ctx["url"], content=_png(), headers=PNG)
    assert (empty.status_code, empty.json()["detail"]) == (422, image_routes.NO_TABLE)


@pytest.mark.asyncio
async def test_row_limit_is_the_one_of_the_sheet(flow, fake_ocr):
    """Höchstens so viele Zeilen wie die Vorschau des Blatts nimmt (``MAX_ROWS``), sonst 422 mit fester Meldung."""
    ctx = await _setup(flow)
    assert (await flow.post(ctx["url"], content=_png(), headers=PNG)).status_code == 200
    assert fake_ocr.max_rows == reference_result_routes.MAX_ROWS == 500
    fake_ocr.reading = Reading(template_id="rennliga-dunkel", too_many_rows=True)
    answer = await flow.post(ctx["url"], content=_png(), headers=PNG)
    assert (answer.status_code, answer.json()["detail"]) == (422, image_routes.TOO_MANY_ROWS)
    assert "500" in image_routes.TOO_MANY_ROWS


@pytest.mark.asyncio
async def test_track_in_the_image_suggests_the_round(flow, fake_ocr):
    """Steht im Bild eine andere Strecke, schlägt die Antwort den passenden Termin der Saison vor - nur als Hinweis."""
    ctx = await _setup(flow)
    other = (await flow.post(f"{ADMIN}/series/{ctx['series']['id']}/rounds",
                             json={"day": _day(-14), "code": "R2", "venue": "Großbritannien"})).json()
    reading = _fake_reading(("Anna Probe", "7"))
    reading.header = {"track": Read("Grossbritanien", 95, [("Grossbritanien", 95)]),
                      "session": Read("Qualifying", 95, [("Qualifying", 95)])}
    fake_ocr.reading = reading
    data = (await flow.post(ctx["url"], content=_png(), headers=PNG)).json()
    assert data["suggested_round"]["id"] == other["id"]
    assert data["session"] == {"name": "Qualifying", "kind": "qualifying"}
    assert [item["code"] for item in data["warnings"]] == ["other_track"]
    assert "R2" in data["warnings"][0]["message"]
    fake_ocr.reading = _fake_reading(("Anna Probe", "7"))  # „Probering Nord“ wie der Termin selbst
    assert (await flow.post(ctx["url"], content=_png(), headers=PNG)).json()["suggested_round"] is None


@pytest.mark.asyncio
async def test_quali_whose_times_lost_their_colon_is_read_without_points(flow, fake_ocr):
    """Echte Fälle (#1981): Im Quali-Bild las die Erkennung „132,134“ statt „1:32,134“ - die Route lehnte es als
    „keine Zeiten“ ab (422). Und der Rand der Tabelle („|“) wurde in jeder Zeile zu „1 Punkt“. Jetzt: gelesen, Zeiten
    wie gespeichert mit Punkt, kein Abstand beim Ersten, keine Punkte."""
    ctx = await _setup(flow)

    def read(text):
        return Read(text, 95, [(word, 95) for word in text.split()])

    lines = [("1", "7", "Anna Probe", "1:31,770", "+--:--,---"), ("2", "12", "Bert Bolzt", "132,134", "+0,364"),
             ("3", "5", "Carl Kurve", "132,754", "+0,984"), ("4", "9", "Dora Neu", "134,358", "+2,588")]
    fake_ocr.reading = Reading(
        template_id="rennliga-dunkel", header_found=True, text_height=20, mean_conf=95,
        rows=[RowReading(cells={"place": read(place), "start_number": read(number), "name": read(name),
                                "time": read(time), "gap": read(gap), "points": read("|")})
              for place, number, name, time, gap in lines])
    fake_ocr.reading.labelled = {"place", "start_number", "name", "time", "gap"}
    answer = await flow.post(ctx["url"], content=_png(), headers=PNG)
    assert answer.status_code == 200, answer.text
    rows = answer.json()["rows"]
    assert [(row["time"], row["gap"], row["points"]) for row in rows] == [
        ("1:31.770", None, None), ("1:32.134", "+0.364", None), ("1:32.754", "+0.984", None),
        ("1:34.358", "+2.588", None)]
    assert all("points" not in row["uncertain"] for row in rows)


@pytest.mark.asyncio
async def test_tables_without_times_are_refused(flow, fake_ocr):
    """Eine Saisontabelle oder der Kalender (keine Zeiten) wird nicht als Ergebnis angeboten."""
    ctx = await _setup(flow)
    fake_ocr.reading = _fake_reading(("Anna Probe", "7"), ("Bert Bolzt", "12"), times=False)
    answer = await flow.post(ctx["url"], content=_png(), headers=PNG)
    assert (answer.status_code, answer.json()["detail"]) == (422, image_routes.NOT_A_RESULT)


@pytest.mark.asyncio
async def test_rate_limit_per_account(flow, fake_ocr, monkeypatch):
    ctx = await _setup(flow)
    monkeypatch.setattr(image_routes, "RATE_LIMIT", 2)
    for _ in range(2):
        assert (await flow.post(ctx["url"], content=_png(), headers=PNG)).status_code == 200
    third = await flow.post(ctx["url"], content=_png(), headers=PNG)
    assert third.status_code == 429
    assert third.json()["detail"].startswith("Zu viele Bilder in kurzer Zeit.")
    # Ein anderes Konto hat sein eigenes Kontingent.
    flow.act_as(ctx["captain"])
    assert (await flow.post(ctx["url"], content=_png(), headers=PNG)).status_code == 200


@pytest.mark.asyncio
async def test_warnings_for_other_track_and_blurry_images(flow, fake_ocr):
    ctx = await _setup(flow)
    reading = _fake_reading(("Anna Probe", "7"))
    reading.header = {"track": Read("Wüstenring", 95, [("Wüstenring", 95)])}
    reading.mean_conf = 70
    reading.header_found = False
    fake_ocr.reading = reading
    codes = [item["code"] for item in (await flow.post(ctx["url"], content=_png(), headers=PNG)).json()["warnings"]]
    assert codes == ["no_header", "blurry", "other_track"]


@pytest.mark.asyncio
async def test_a_missing_second_reader_warns_and_reading_goes_on(flow, fake_ocr):
    """#2018: Fehlt der zweite Leser (oder reichte die Zeit nicht), liest der Server weiter - mit einer Warnung, und ein
    unbekannter Name bleibt gelb wie in #2012. Abgeschaltet ist gewollt und keine Warnung."""
    ctx = await _setup(flow)
    fake_ocr.reading = _fake_reading(("Dora Neu", "5"))
    for status, codes in (("missing", ["second_reader"]), ("failed", ["second_reader"]),
                          ("out_of_time", ["out_of_time"]), ("off", []), ("ok", [])):
        fake_ocr.reading.second = status
        data = (await flow.post(ctx["url"], content=_png(), headers=PNG)).json()
        assert [item["code"] for item in data["warnings"]] == codes, status
        assert data["rows"][0]["uncertain"] == ["name"]
    # Lesen beide Leser denselben Namen, ist er grün - auch für Captains.
    fake_ocr.reading.rows[0].second = {"name": Read("Dora Neu", 99, [("Dora", 99), ("Neu", 99)])}
    flow.act_as(ctx["captain"])
    row = (await flow.post(ctx["url"], content=_png(), headers=PNG)).json()["rows"][0]
    assert (row["name"], row["uncertain"]) == ("Dora Neu", [])


@pytest.mark.asyncio
async def test_broken_png_is_400_not_500(flow, fake_ocr):
    """Kaputter Chunk mitten in den Bilddaten: Pillow wirft ``SyntaxError`` - die Route antwortet 400 mit fester
    Meldung."""
    ctx = await _setup(flow)
    first, rest, end = _png_in_two_blocks()
    broken = first + struct.pack(">I", len(rest)) + b"\x01\x02\x03\x04" + rest + b"\x00\x00\x00\x00" + end
    answer = await flow.post(ctx["url"], content=broken, headers=PNG)
    assert (answer.status_code, answer.json()["detail"]) == (400, result_image_ocr.BROKEN)
    assert fake_ocr.calls == 0


@pytest.mark.asyncio
async def test_one_image_per_account_and_decoding_only_with_a_free_place(flow, fake_ocr, monkeypatch):
    """Dekodiert wird erst mit einem freien Platz zum Lesen - wer wartet, hält nur die Datei. Je Konto ein Bild zur
    Zeit; nach einem Fehler ist das Konto wieder frei."""
    ctx = await _setup(flow)

    class Gate:
        held = False

        async def acquire(self):
            Gate.held = True
            return True

        def release(self):
            Gate.held = False

    seen = []
    real_open = result_image_ocr.open_image

    def open_image(data):
        seen.append(Gate.held)
        return real_open(data)

    monkeypatch.setattr(image_routes, "_gate", Gate())
    monkeypatch.setattr(result_image_ocr, "open_image", open_image)
    assert (await flow.post(ctx["url"], content=_png(), headers=PNG)).status_code == 200
    assert (seen, Gate.held) == ([True], False)

    image_routes._reading_accounts.add(ctx["board"]["id"])  # das erste Bild dieses Kontos wird noch gelesen
    try:
        busy = await flow.post(ctx["url"], content=_png(), headers=PNG)
        assert (busy.status_code, busy.json()["detail"]) == (429, image_routes.BUSY_ACCOUNT)
        assert len(seen) == 1  # nicht einmal geöffnet
        flow.act_as(ctx["captain"])  # ein anderes Konto liest weiter
        assert (await flow.post(ctx["url"], content=_png(), headers=PNG)).status_code == 200
    finally:
        image_routes._reading_accounts.discard(ctx["board"]["id"])
    flow.act_as(ctx["board"])
    assert (await flow.post(ctx["url"], content=b"kein Bild", headers=PNG)).status_code == 400
    assert image_routes._reading_accounts == set()
    assert Gate.held is False


@pytest.mark.asyncio
async def test_time_budget_leaves_the_rest_yellow_or_refuses(flow, fake_ocr, monkeypatch):
    """Reichte das Zeitbudget nicht für die zweite Lesung einer Spalte, ist sie gelb und eine Warnung sagt es. Reichte
    es nicht einmal für die Seite: 422 mit fester Meldung."""
    ctx = await _setup(flow)
    reading = _fake_reading(("Anna Probe", "7"), ("Bert Bolzt", "12"))
    reading.out_of_time, reading.unchecked = True, {"time", "gap"}
    fake_ocr.reading = reading
    data = (await flow.post(ctx["url"], content=_png(), headers=PNG)).json()
    assert [item["code"] for item in data["warnings"]] == ["out_of_time"]
    assert [row["uncertain"] for row in data["rows"]] == [["time"], ["time"]]  # Abstand stand nirgends

    def slow(image, template, **_):
        raise result_image_ocr.OutOfTime()

    monkeypatch.setattr(result_image_ocr, "read", slow)
    answer = await flow.post(ctx["url"], content=_png(), headers=PNG)
    assert (answer.status_code, answer.json()["detail"]) == (422, image_routes.TOO_SLOW)


# ---------------------------------------------------------------- Ende-zu-Ende
@needs_tesseract
@pytest.mark.asyncio
async def test_clean_screenshot_through_the_route(flow, monkeypatch):
    # Nur Tesseract - den zweiten Leser prüft test_result_image_second.py (ohne Modell gäbe es hier eine Warnung).
    monkeypatch.setattr(result_image_second, "MODE", "off")
    sheet = fixture.sample_sheet()
    ctx = await _setup(flow, people=[(row.name, row.number, row.team) for row in sheet.rows])
    answer = await flow.post(ctx["url"], content=fixture.png_bytes(fixture.render(sheet)), headers=PNG)
    assert answer.status_code == 200, answer.text
    data = answer.json()
    assert data["uncertain_rows"] == 0
    assert [row["participant_id"] for row in data["rows"]] == [ctx["ids"][row.name] for row in sheet.rows]
    assert [row["place"] for row in data["rows"]] == [row.place for row in sheet.rows]
    assert data["fastest_lap"]["participant_id"] == ctx["ids"]["Mia Motorhaube"]
    assert data["driver_of_the_day"]["participant_id"] == ctx["ids"]["Otto Ostwind"]
    assert data["warnings"] == []
