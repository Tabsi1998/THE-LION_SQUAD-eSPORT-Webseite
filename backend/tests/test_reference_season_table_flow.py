"""Saisontabelle des Veranstalters einlesen (#1928) über die echten Routen. Abnahme aus dem Issue: eine Saison mit 19
gefahrenen Runden und 36 Fahrern in einem Schritt nachgetragen - Summen und Plätze stimmen mit der Tabelle. Dazu
„OUT“, „--“ und leere Zellen, ein TFT-Fall mit Bonus im Wert (21 = 18 + 3 Bingo), nicht eindeutige Punkte, ein
vorhandener Entwurf, der nie still überschrieben wird, und wer das darf. Nur erfundene Namen."""
import pathlib
import random
import sys
from datetime import date, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import migrations, reference_running_cache  # noqa: E402
from services.dolibarr_policy import club_today  # noqa: E402

ADMIN = "/api/reference-series/admin"
F1 = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
FIRST = ["Ada", "Bruno", "Cleo", "Dario", "Ella", "Finn", "Gina", "Hugo", "Ida", "Jonas", "Kira", "Leo"]
LAST = ["Ausgedacht", "Beispiel", "Muster"]
DRIVERS = [f"{first} {last}" for last in LAST for first in FIRST]  # 36 erfundene Namen
TEAMS = ["Probe Rot", "Probe Blau", "Probe Grün", "Probe Gelb", "Probe Weiß", "Probe Grau"]


@pytest_asyncio.fixture
async def flow():
    reference_running_cache.reset()
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


async def _season(flow, *, kind="racing", rules=None, rounds=19):
    await migrations.migrate_points_scheme_templates(flow.db)
    board = await flow.add_user(role="club_admin", name="vorstand-vera")
    flow.act_as(board)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Rennliga", "kind": kind})).json()
    series = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2026", "status": "active", "default_time": "20:00",
        "rules": rules or {"points_mode": "scheme", "points_by_place": F1, "tiebreakers": ["countback"]}})).json()
    start = date.fromisoformat(club_today()) - timedelta(days=7 * (rounds + 1))
    lines = [f"R{index} · {(start + timedelta(days=7 * index)).strftime('%d.%m.%Y')} · Probe Strecke {index}"
             for index in range(1, rounds + 1)]
    pasted = await flow.post(f"{ADMIN}/series/{series['id']}/rounds/paste", json={"text": "\n".join(lines),
                                                                                  "apply": True})
    assert pasted.status_code == 200, pasted.text
    return board, series, pasted.json()["rounds"]


def _url(series, suffix):
    return f"{ADMIN}/series/{series['id']}/season-table/{suffix}"


def _season_data(rounds=19, seed=1928):
    """Erfundene Saison: je Runde 30 bis 36 Fahrer, Plätze 1-10 nach F1-Schema, dahinter 0, ein bis zwei Ausfälle
    („OUT“); wer fehlt, steht als „--“ oder leer. Liefert Tabelle (Zeilen) und die Plätze je Runde."""
    rng = random.Random(seed)
    cells = {name: [] for name in DRIVERS}
    places = []
    for number in range(rounds):
        field = rng.sample(DRIVERS, rng.randint(30, 36))
        out = set(field[-rng.randint(1, 2):])
        finishers = [name for name in field if name not in out]
        places.append({name: index for index, name in enumerate(finishers, start=1)})
        for name in DRIVERS:
            if name in out:
                cells[name].append("OUT")
            elif name in places[-1]:
                place = places[-1][name]
                cells[name].append(str(F1[place - 1]) if place <= len(F1) else "0")
            else:
                cells[name].append("--" if number % 2 else "")
    rows = []
    for index, name in enumerate(DRIVERS):
        total = sum(int(value) for value in cells[name] if value not in ("", "--", "OUT"))
        rows.append({"name": name, "team": TEAMS[index % len(TEAMS)], "cells": cells[name], "total": total})
    return rows, places


@pytest.mark.asyncio
async def test_a_season_with_19_rounds_and_36_drivers_is_filled_in_one_step(flow):
    _, series, rounds = await _season(flow)
    rows, places = _season_data()
    body = {"columns": [{"label": f"R{index}"} for index in range(1, 20)], "rows": rows, "team_column": True}
    preview = await flow.post(_url(series, "preview"), json=body)
    assert preview.status_code == 200, preview.text
    data = preview.json()
    assert [(item["round"]["id"], item["how"], item["state"]) for item in data["columns"]] == [
        (item["id"], "code", "new") for item in rounds]
    assert data["summary"] == {"rows": 36, "columns": 19, "mapped": 19, "unclear": 0, "errors": 0}
    assert data["selectable"] == list(range(19))
    assert len(data["unknown_names"]) == 36
    # Abgleich: je Fahrer die eigene Rechnung gleich „Gesamt“ der Tabelle.
    assert all(item["state"] == "ok" for item in data["totals"]), [
        item for item in data["totals"] if item["state"] != "ok"]
    assert [item["computed"] for item in data["totals"]] == [row["total"] for row in rows]
    unique = [item for item in data["totals"]
              if sum(1 for other in rows if other["total"] == item["table_total"]) == 1]
    assert unique and all(item["rank"] == item["table_rank"] for item in unique)
    # Plätze je Runde aus den Punkten zurückgerechnet - wo eindeutig (Punkteränge 1-10).
    first = {cell["row"]: cell for cell in data["columns"][0]["cells"]}
    for name, place in places[0].items():
        if place <= len(F1):
            assert first[DRIVERS.index(name)]["place"] == place, name
    for collection in ("reference_round_results", "reference_participants"):
        assert await getattr(flow.db, collection).count_documents({"series_id": series["id"]}) == 0, collection

    items = [{"column": item["index"], "round_id": item["round"]["id"], "expected_version": item["expected_version"]}
             for item in data["columns"]]
    applied = await flow.post(_url(series, "apply"), json={**body, "items": items})
    assert applied.status_code == 200, applied.text
    assert [item["status"] for item in applied.json()["items"]] == ["saved"] * 19
    assert applied.json()["open_unknown"] is True
    assert await flow.db.reference_participants.count_documents({"series_id": series["id"]}) == 36
    sheets = {sheet["round_id"]: sheet async for sheet in flow.db.reference_round_results.find(
        {"series_id": series["id"]}, {"_id": 0})}
    assert len(sheets) == 19 and {sheet["status"] for sheet in sheets.values()} == {"draft"}
    people = {row["id"]: row["name"] async for row in flow.db.reference_participants.find(
        {"series_id": series["id"]}, {"_id": 0})}
    for index, rnd in enumerate(rounds):
        by_name = {people[row["participant_id"]]: row for row in sheets[rnd["id"]]["rows"]}
        expected = {name for name in DRIVERS if rows[DRIVERS.index(name)]["cells"][index] not in ("", "--")}
        assert set(by_name) == expected, rnd["code"]
        for name, row in by_name.items():
            cell = rows[DRIVERS.index(name)]["cells"][index]
            if cell == "OUT":
                assert row["marks"] == ["dnf"] and not row["place"]
            elif places[index][name] <= len(F1):
                assert row["place"] == places[index][name], (rnd["code"], name)
            assert row["team"] == TEAMS[DRIVERS.index(name) % len(TEAMS)]
    log = await flow.db.audit_logs.find_one({"action": "reference_season_table.import"}, {"_id": 0})
    assert log["data"]["rows"] == 36 and len(log["data"]["items"]) == 19
    # Ein zweites Einlesen derselben Tabelle ändert nichts.
    again = (await flow.post(_url(series, "preview"), json=body)).json()
    assert {item["state"] for item in again["columns"]} == {"same"} and again["selectable"] == []
    assert again["unknown_names"] == []


@pytest.mark.asyncio
async def test_existing_sheets_are_never_overwritten_silently(flow):
    _, series, rounds = await _season(flow, rounds=3)
    base = f"{ADMIN}/series/{series['id']}/rounds"
    published = await flow.put(f"{base}/{rounds[0]['id']}/results", json={
        "rows": [{"name": "Ada Ausgedacht", "place": 1}, {"name": "Bruno Beispiel", "place": 2}],
        "status": "published", "expected_version": 0})
    assert published.status_code == 200, published.text
    draft = await flow.put(f"{base}/{rounds[1]['id']}/results", json={
        "rows": [{"name": "Ada Ausgedacht", "place": 2, "note": "von Hand"}, {"name": "Bruno Beispiel", "place": 1}],
        "status": "draft", "expected_version": 0})
    assert draft.status_code == 200, draft.text
    rows = [{"name": "Ada Ausgedacht", "cells": ["18", "25", "25"], "total": 68},
            {"name": "Bruno Beispiel", "cells": ["25", "18", "--"], "total": 43},
            {"name": "Cleo Muster", "cells": ["", "OUT", "18"], "total": 18}]
    body = {"columns": [{"label": "R1"}, {"label": "R2"}, {"label": "R3"}], "rows": rows}
    data = (await flow.post(_url(series, "preview"), json=body)).json()
    columns = data["columns"]
    assert [(item["state"], item["target"]) for item in columns] == [
        ("changed", "pending_draft"), ("changed", "draft"), ("new", "sheet")]
    ada = next(change for change in columns[1]["changes"] if change["name"] == "Ada Ausgedacht")
    assert ada["fields"]["place"] == [2, 1]
    assert any(change["kind"] == "added" and change["name"] == "Cleo Muster" for change in columns[1]["changes"])

    # Nur R3 übernommen: der Entwurf von R2 und das veröffentlichte Blatt von R1 bleiben, wie sie sind.
    before = await flow.db.reference_round_results.find_one({"round_id": rounds[1]["id"]}, {"_id": 0})
    item = {"column": 2, "round_id": rounds[2]["id"], "expected_version": 0}
    assert (await flow.post(_url(series, "apply"), json={**body, "items": [item]})).json()["items"][0]["status"] == \
        "saved"
    assert await flow.db.reference_round_results.find_one({"round_id": rounds[1]["id"]}, {"_id": 0}) == before
    # Mit veralteter Version: nichts geschrieben.
    stale = {"column": 1, "round_id": rounds[1]["id"], "expected_version": 0}
    result = (await flow.post(_url(series, "apply"), json={**body, "items": [stale]})).json()["items"][0]
    assert result["status"] == "conflict"
    assert await flow.db.reference_round_results.find_one({"round_id": rounds[1]["id"]}, {"_id": 0}) == before
    # Bewusst angehakt: der Entwurf wird ersetzt (Revision bleibt, die Notiz von Hand auch); neben dem veröffentlichten
    # Blatt entsteht ein Entwurf daneben.
    wished = [{"column": 0, "round_id": rounds[0]["id"], "expected_version": columns[0]["expected_version"]},
              {"column": 1, "round_id": rounds[1]["id"], "expected_version": columns[1]["expected_version"]}]
    out = (await flow.post(_url(series, "apply"), json={**body, "items": wished})).json()["items"]
    assert [(item["status"], item["target"]) for item in out] == [("saved", "pending_draft"), ("saved", "draft")]
    first = await flow.db.reference_round_results.find_one({"round_id": rounds[0]["id"]}, {"_id": 0})
    assert first["status"] == "published" and len(first["rows"]) == 2 and first["pending_draft"]
    second = await flow.db.reference_round_results.find_one({"round_id": rounds[1]["id"]}, {"_id": 0})
    ada_row = next(row for row in second["rows"] if row["place"] == 1)
    assert ada_row["note"] == "von Hand"
    assert await flow.db.reference_round_result_revisions.count_documents({"round_id": rounds[1]["id"]}) == 1


TFT = {"points_by_place": [35, 30, 26, 23, 20, 18, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2] + [1] * 6,
       "custom_bonuses": [{"label": "Bingo", "points": 3}], "tiebreakers": ["countback"]}


@pytest.mark.asyncio
async def test_the_tft_case_with_bingo_in_the_value_waits_for_a_decision(flow):
    _, series, rounds = await _season(flow, kind="series", rules=TFT, rounds=1)
    names = ["Ada Ausgedacht#AAA", "Bruno Beispiel#EUW", "Cleo Muster", "Dario Demo#1234", "Ella Erfunden",
             "Finn Fiktiv#EUW", "Gina Gedacht", "Hugo Probe"]
    values = ["35", "30", "26", "23", "20", "21", "16", "14"]
    rows = [{"name": name, "cells": [value], "total": int(value)} for name, value in zip(names, values)]
    body = {"columns": [{"label": "Turnier 1"}], "rows": rows}
    data = (await flow.post(_url(series, "preview"), json=body)).json()
    column = data["columns"][0]
    assert (column["round"]["id"], column["how"], column["state"], column["unclear"]) == (
        rounds[0]["id"], "order", "unclear", 1)
    finn = next(cell for cell in column["cells"] if cell["row"] == 5)
    assert (finn["code"], [item["label"] for item in finn["candidates"]]) == ("bonus", ["Platz 6 + Bingo"])
    assert data["selectable"] == []
    assert all(item["state"] == "ok" for item in data["totals"])  # bis zur Klärung zählt der Wert der Tabelle
    item = {"column": 0, "round_id": rounds[0]["id"], "expected_version": 0}
    refused = (await flow.post(_url(series, "apply"), json={**body, "items": [item]})).json()["items"][0]
    assert refused["status"] == "unclear"
    assert await flow.db.reference_round_results.count_documents({"series_id": series["id"]}) == 0

    decided = {**body, "decisions": [{"column": 0, "row": 5, "choice": "place", "place": 6, "bonus_keys": ["bingo"]}]}
    data = (await flow.post(_url(series, "preview"), json=decided)).json()
    assert (data["columns"][0]["state"], data["selectable"]) == ("new", [0])
    finn_total = data["totals"][5]
    assert (finn_total["computed"], finn_total["state"]) == (21, "ok")
    saved = (await flow.post(_url(series, "apply"), json={**decided, "items": [item]})).json()["items"][0]
    assert saved["status"] == "saved"
    sheet = await flow.db.reference_round_results.find_one({"round_id": rounds[0]["id"]}, {"_id": 0})
    finn_row = next(row for row in sheet["rows"] if row["place"] == 6)
    assert finn_row["bonus_keys"] == ["bingo"]


@pytest.mark.asyncio
async def test_points_by_the_organizer_take_the_value_without_the_way_back(flow):
    _, series, rounds = await _season(flow, kind="series", rules=TFT, rounds=1)
    rows = [{"name": "Ada Ausgedacht", "cells": ["21"], "total": 21},
            {"name": "Bruno Beispiel", "cells": ["1"], "total": 1}]
    body = {"columns": [{"label": "T1"}], "rows": rows, "points": "organizer"}
    data = (await flow.post(_url(series, "preview"), json=body)).json()
    column = data["columns"][0]
    assert (column["state"], column["unclear"]) == ("new", 0)
    assert [(cell["code"], cell["state"]) for cell in column["cells"]] == [
        ("outside_scheme", "note"), ("organizer", "ok")]
    assert not [warning for warning in column["warnings"] if warning["code"] in ("place_missing", "points_manual")]
    item = {"column": 0, "round_id": rounds[0]["id"], "expected_version": 0}
    assert (await flow.post(_url(series, "apply"), json={**body, "items": [item]})).json()["items"][0]["status"] == \
        "saved"
    sheet = await flow.db.reference_round_results.find_one({"round_id": rounds[0]["id"]}, {"_id": 0})
    assert [(row["place"], row["points"], row["points_source"]) for row in sheet["rows"]] == [
        (None, 21, "manual"), (None, 1, "manual")]


@pytest.mark.asyncio
async def test_unclear_points_and_unknown_cells_stop_only_their_round(flow):
    _, series, rounds = await _season(flow, rounds=3)
    rows = [{"name": "Ada Ausgedacht", "cells": ["25", "17", "25"]},
            {"name": "Bruno Beispiel", "cells": ["25", "18", "x"]}]
    body = {"columns": [{"label": "R1"}, {"label": "R2"}, {"label": "R3"}], "rows": rows}
    data = (await flow.post(_url(series, "preview"), json=body)).json()
    assert [(item["state"], item["unclear"]) for item in data["columns"]] == [
        ("unclear", 2), ("unclear", 1), ("error", 0)]
    assert [cell["code"] for cell in data["columns"][0]["cells"]] == ["shared", "shared"]
    assert data["columns"][1]["cells"][0]["code"] == "outside"
    assert "„x“" in data["columns"][2]["errors"][0]["message"]
    # Spalte bewusst nicht übernehmen und eine andere Spalte selbst zuordnen.
    chosen = {**body, "columns": [{"label": "R1", "round_id": ""}, {"label": "R2", "round_id": rounds[2]["id"]},
                                  {"label": "R3", "round_id": ""}]}
    data = (await flow.post(_url(series, "preview"), json=chosen)).json()
    assert [(item["state"], item["how"], (item["round"] or {}).get("id")) for item in data["columns"]] == [
        ("skip", "skip", None), ("unclear", "chosen", rounds[2]["id"]), ("skip", "skip", None)]
    assert [item["id"] for item in data["rounds"]] == [item["id"] for item in rounds]


@pytest.mark.asyncio
async def test_only_the_board_reads_a_season_table_and_not_for_a_team_league(flow):
    board, series, _ = await _season(flow, rounds=1)
    body = {"columns": [{"label": "R1"}], "rows": [{"name": "Ada Ausgedacht", "cells": ["25"]}]}
    captain = await flow.add_user(role="user", name="captain-carl")
    await flow.db.reference_series_staff.insert_one({
        "id": "staff-1", "series_id": series["id"], "user_id": captain["id"], "role": "captain",
        "valid_until": (date.fromisoformat(club_today()) + timedelta(days=30)).isoformat()})
    await flow.db.memberships.insert_one({"user_id": captain["id"], "member_status": "active"})
    flow.act_as(captain)
    assert (await flow.post(_url(series, "preview"), json=body)).status_code == 403
    flow.act_as(None)
    assert (await flow.post(_url(series, "preview"), json=body)).status_code == 401
    flow.act_as(board)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Liga", "kind": "team_league"})).json()
    league = (await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage["id"], "season": "2026"})).json()
    assert (await flow.post(_url(league, "preview"), json=body)).status_code == 409
