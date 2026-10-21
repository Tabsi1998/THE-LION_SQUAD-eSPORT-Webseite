"""Sonderregeln einer Rennliga (#1960) über die echten Routen - Abnahme-Fälle aus dem Issue, nur erfundene Namen.

- Saison mit zwei −5-Abzügen: die Fahrerwertung stimmt mit der offiziellen überein, öffentlich als „−5“ mit Grund.
- Abgebrochene Saison mit Nachfolger: Serienseite, Liga-Weg, Saison abschließen (ohne Platz) und Chronik.
- F2 mit Format 1 (R1–R4) und Format 2 (R5–R8): richtig angelegt, Regeländerung samt Tag und Hinweis sichtbar.
- Termin ohne Wertung mit Grund (unterschieden von „abgesagt“), Mindestzahl am Start als Hinweis beim Eintragen.
- Teamwertung laut Veranstalter mit Quelle, Team-Anpassung und „im Team seit“.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import reference_round_routes, reference_series_routes  # noqa: E402
from services import migrations, reference_series  # noqa: E402

ADMIN = "/api/reference-series/admin"
PUBLIC = "/api/reference-series/public"
RULES = {"points_mode": "scheme", "points_by_place": [10, 6, 4, 3, 2, 1], "tiebreakers": ["countback"],
         "team_scoring": {"enabled": True, "counting_drivers": 2, "guests_count": True}}
PEOPLE = [
    {"id": "p-lion1", "name": "Probe Lion Eins", "link": "member", "profile_id": "profil-lion1",
     "is_club_member": True, "default_team": "Probe Löwen"},
    {"id": "p-lion2", "name": "Probe Lion Zwei", "link": "member", "profile_id": "profil-lion2",
     "is_club_member": True, "default_team": "Probe Löwen"},
    {"id": "p-ext1", "name": "Fremd Eins", "link": "external", "default_team": "Fremd Rot"},
    {"id": "p-ext2", "name": "Fremd Zwei", "link": "external", "default_team": "Fremd Rot"},
]


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    monkeypatch.setattr(reference_round_routes, "club_today", lambda: "2026-11-20")
    monkeypatch.setattr(reference_series_routes, "club_today", lambda: "2026-11-20")
    try:
        yield instance
    finally:
        await shutdown()


async def _board(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    for number in (1, 2):
        await flow.db.club_member_profiles.insert_one({"id": f"profil-lion{number}", "slug": f"probe-lion-{number}",
                                                       "display_name": f"Probe Lion {number}", "is_active": True})
    return admin


async def _lineage(flow, title="Probe Racing"):
    response = await flow.post(f"{ADMIN}/lineages", json={"title": title, "kind": "racing", "organizer": "Probe Liga",
                                                          "label": "F1"})
    assert response.status_code == 200, response.text
    return response.json()


async def _season(flow, lineage, season="2026", **extra):
    response = await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage["id"], "season": season,
                                                        "status": "active", "rules": RULES, **extra})
    assert response.status_code == 200, response.text
    return response.json()


async def _rounds(flow, series, *codes):
    out = {}
    for number, code in enumerate(codes, start=1):
        response = await flow.post(f"{ADMIN}/series/{series['id']}/rounds",
                                   json={"code": code, "day": f"2026-11-{number:02d}"})
        assert response.status_code == 200, response.text
        out[code] = response.json()["id"]
    return out


async def _publish(flow, series, rounds, results: dict, **extra_by_code):
    """``results``: Kürzel → Kennungen in Platz-Reihenfolge (Team = Standard-Team, außer ``(Kennung, Team)``)."""
    await flow.db.reference_participants.insert_many([
        {"series_id": series["id"], "is_club_member": False, "name_hidden": False, **person} for person in PEOPLE])
    for code, order in results.items():
        rows = []
        for place, item in enumerate(order, start=1):
            pid, team = item if isinstance(item, tuple) else (item, None)
            rows.append({"participant_id": pid, "place": place, "marks": [], "team": team})
        await flow.db.reference_round_results.insert_one({
            "id": f"blatt-{code}", "series_id": series["id"], "round_id": rounds[code], "status": "published",
            "rows": rows, **extra_by_code.get(code, {})})
        await flow.db.reference_rounds.update_one({"id": rounds[code]}, {"$set": {"status": "scored"}})
    stored = await flow.db.reference_series.find_one({"id": series["id"]}, {"_id": 0})
    await reference_series.recompute_standings(flow.db, stored)


async def _page(flow, lineage, series):
    response = await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------- Anpassungen
@pytest.mark.asyncio
async def test_two_minus_five_adjustments_give_the_official_table(flow):
    await _board(flow)
    lineage = await _lineage(flow)
    series = await _season(flow, lineage)
    rounds = await _rounds(flow, series, "R1", "R2")
    # Rennsummen: Lion Eins 20, Fremd Eins 12, Lion Zwei 8, Fremd Zwei 6. Offiziell: 15, 12, 3, 6 (zwei Abzüge).
    official = {"official_totals": {"p-lion1": 15, "p-ext1": 12, "p-lion2": 3, "p-ext2": 6}}
    await _publish(flow, series, rounds, {"R1": ["p-lion1", "p-ext1", "p-lion2", "p-ext2"],
                                          "R2": ["p-lion1", "p-ext1", "p-lion2", "p-ext2"]}, R2=official)
    before = await _page(flow, lineage, series)
    assert [(row["key"], row["deviation"]) for row in before["standings"]["rows"]] == [
        ("p-lion1", -5), ("p-ext1", 0), ("p-ext2", 0), ("p-lion2", -5)]

    url = f"{ADMIN}/series/{series['id']}/adjustments"
    first = await flow.post(url, json={"participant_id": "p-lion1", "points": -5, "reason": "Nichtteilnahme nach "
                                       "Anmeldung", "day": "2026-11-02", "round_id": rounds["R2"]})
    assert first.status_code == 200, first.text
    second = await flow.post(url, json={"participant_id": "p-lion2", "points": -5, "reason": "Video fehlt",
                                        "day": "2026-11-01"})
    assert second.status_code == 200, second.text
    assert [item["reason"] for item in second.json()["adjustments"]] == ["Nichtteilnahme nach Anmeldung",
                                                                         "Video fehlt"]

    body = await _page(flow, lineage, series)
    rows = body["standings"]["rows"]
    assert [(row["key"], row["rank"], row["points"], row["deviation"], row["adjustment_points"]) for row in rows] == [
        ("p-lion1", 1, 15, 0, -5), ("p-ext1", 2, 12, 0, 0), ("p-ext2", 3, 6, 0, 0), ("p-lion2", 4, 3, 0, -5)]
    assert rows[0]["adjustments"] == [{"points": -5, "reason": "Nichtteilnahme nach Anmeldung", "day": "2026-11-02",
                                       "round_id": rounds["R2"]}]
    log = await flow.db.audit_logs.find_one({"action": "reference_series.adjustment_create"})
    assert log and log["target_id"] == series["id"]

    # Ändern und Entfernen rechnen neu.
    adjustment_id = second.json()["adjustments"][1]["id"]
    changed = await flow.patch(f"{url}/{adjustment_id}", json={"participant_id": "p-lion2", "points": -3,
                                                               "reason": "Video zu spät", "day": "2026-11-01"})
    assert changed.status_code == 200, changed.text
    assert {row["key"]: row["computed_points"] for row in (await _page(flow, lineage, series))["standings"]["rows"]}[
        "p-lion2"] == 5
    removed = await flow.delete(f"{url}/{adjustment_id}")
    assert removed.status_code == 200 and len(removed.json()["adjustments"]) == 1
    assert {row["key"]: row["adjustment_points"] for row in (await _page(flow, lineage, series))["standings"]["rows"]}[
        "p-lion2"] == 0


@pytest.mark.asyncio
async def test_adjustments_need_a_reason_a_known_participant_and_the_board(flow):
    await _board(flow)
    lineage = await _lineage(flow)
    series = await _season(flow, lineage)
    await _rounds(flow, series, "R1")
    await flow.db.reference_participants.insert_one({"id": "p-lion1", "series_id": series["id"], "name": "Probe"})
    url = f"{ADMIN}/series/{series['id']}/adjustments"
    assert (await flow.post(url, json={"participant_id": "p-lion1", "points": -5, "reason": " ",
                                       "day": "2026-11-01"})).status_code == 422
    assert (await flow.post(url, json={"participant_id": "p-lion1", "points": 0, "reason": "Null",
                                       "day": "2026-11-01"})).status_code == 422
    assert (await flow.post(url, json={"participant_id": "fremd", "points": -5, "reason": "Grund",
                                       "day": "2026-11-01"})).status_code == 404
    assert (await flow.post(url, json={"participant_id": "p-lion1", "points": -5, "reason": "Grund",
                                       "day": "2026-11-01", "round_id": "fremd"})).status_code == 404
    assert (await flow.post(url, json={"kind": "team", "points": -5, "reason": "Grund",
                                       "day": "2026-11-01"})).status_code == 422
    flow.act_as(await flow.add_user(role="member", name="mitglied"))
    assert (await flow.post(url, json={"participant_id": "p-lion1", "points": -5, "reason": "Grund",
                                       "day": "2026-11-01"})).status_code == 403


# ---------------------------------------------------------------- Teamwertung laut Veranstalter
@pytest.mark.asyncio
async def test_official_team_standings_lead_with_source_team_adjustment_and_team_since(flow):
    await _board(flow)
    lineage = await _lineage(flow)
    series = await _season(flow, lineage)
    rounds = await _rounds(flow, series, "R1", "R2")
    await _publish(flow, series, rounds, {
        "R1": ["p-lion1", "p-ext1", "p-lion2", "p-ext2"],
        # Ab R2 fährt Fremd Zwei für die Löwen.
        "R2": ["p-ext1", ("p-ext2", "Probe Löwen"), "p-lion1"]})
    body = await _page(flow, lineage, series)
    assert body["racing"]["teams"]["source"] == "computed"
    assert body["racing"]["drivers"]["p-ext2"]["team_since"] == rounds["R2"]
    assert body["racing"]["drivers"]["p-lion1"]["team_since"] is None

    await flow.db.reference_round_results.update_one(
        {"id": "blatt-R2"}, {"$set": {"official_team_totals": {"Fremd Rot": 40, "Probe Löwen": 30}}})
    response = await flow.post(f"{ADMIN}/series/{series['id']}/adjustments", json={
        "kind": "team", "team": "Probe Löwen", "points": -2, "reason": "Korrektur", "day": "2026-11-02"})
    assert response.status_code == 200, response.text
    teams = (await _page(flow, lineage, series))["racing"]["teams"]
    assert teams["source"] == "official"
    assert [(row["team"], row["rank"], row["points"], row["computed_points"], row["deviation"],
             row["adjustment_points"]) for row in teams["rows"]] == [
        ("Fremd Rot", 1, 40, 19, 21, 0), ("Probe Löwen", 2, 30, 22, 8, -2)]
    assert teams["rows"][1]["adjustments"] == [{"points": -2, "reason": "Korrektur", "day": "2026-11-02",
                                                "round_id": None}]


# ---------------------------------------------------------------- Saison abgebrochen
@pytest.mark.asyncio
async def test_cancelled_season_with_successor_on_page_league_path_close_and_chronicle(flow):
    await _board(flow)
    lineage = await _lineage(flow)
    old = await _season(flow, lineage, season="2026", tier="F1")
    restart = await _season(flow, lineage, season="2026", tier="F1 Neustart")
    rounds = await _rounds(flow, old, "R1")
    await _publish(flow, old, rounds, {"R1": ["p-lion1", "p-ext1", "p-lion2"]})

    assert (await flow.patch(f"{ADMIN}/series/{old['id']}", json={"successor_id": old["id"]})).status_code == 422
    response = await flow.patch(f"{ADMIN}/series/{old['id']}", json={
        "status": "cancelled", "cancel_reason": "  Neustart mit   anderem Auto ", "successor_id": restart["id"]})
    assert response.status_code == 200, response.text
    saved = response.json()
    assert (saved["status"], saved["cancelled_on"], saved["cancel_reason"], saved["successor_id"]) == (
        "cancelled", "2026-11-20", "Neustart mit anderem Auto", restart["id"])

    body = await _page(flow, lineage, old)
    assert (body["series"]["status"], body["series"]["cancelled_on"], body["series"]["cancel_reason"]) == (
        "cancelled", "2026-11-20", "Neustart mit anderem Auto")
    assert body["successor"] == {"season": "2026", "tier": "F1 Neustart", "title": None,
                                 "season_slug": restart["season_slug"], "status": "active",
                                 "lineage_slug": lineage["slug"], "lineage_title": "Probe Racing"}
    # Gefahrene Ergebnisse bleiben sichtbar.
    assert [row["key"] for row in body["standings"]["rows"]] == ["p-lion1", "p-ext1", "p-lion2"]

    path = (await flow.get(f"{PUBLIC}/lineages")).json()["items"][0]["seasons"]
    assert [(item["tier"], item["status"]) for item in path] == [("F1", "cancelled"), ("F1 Neustart", "active")]

    # Saison abschließen: Referenz ohne Platz, die Saison bleibt abgebrochen; die Chronik sagt es dazu.
    preview = (await flow.get(f"{ADMIN}/series/{old['id']}/close")).json()
    assert preview["cancelled"] is True
    assert {entry["placement"] for entry in preview["entries"]} == {None}
    closed = await flow.post(f"{ADMIN}/series/{old['id']}/close", json={})
    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "cancelled"
    items = (await flow.get("/api/references")).json()["items"]
    link = next(item for item in items if item["id"] == closed.json()["reference_id"])["season_link"]
    assert link["cancelled"] is True and link["season_slug"] == old["season_slug"]

    # Wieder aufgenommen: Tag und Grund gehen weg, der Nachfolger bleibt.
    again = (await flow.patch(f"{ADMIN}/series/{old['id']}", json={"status": "active"})).json()
    assert (again["cancelled_on"], again["cancel_reason"], again["successor_id"]) == (None, None, restart["id"])


# ---------------------------------------------------------------- Format ab Runde X
@pytest.mark.asyncio
async def test_f2_with_format_one_and_two_shows_the_rule_change(flow):
    await _board(flow)
    lineage = await _lineage(flow, title="Probe Racing F2")
    weekend = {"formats": [
        {"from_round": 1, "sessions": [{"label": "Qualifying"}, {"label": "Sprint", "offset": 60,
                                                                   "points": [12, 9, 7, 6, 5, 4, 3, 2, 1]},
                                       {"label": "Hauptrennen", "offset": 120}]},
        {"from_round": 5, "note": "Ab R5 kein Qualifying, Start in umgekehrter WM-Reihenfolge",
         "sessions": [{"label": "Sprint", "points": [12, 9, 7, 6, 5, 4, 3, 2, 1],
                       "grid": "reverse_standings_before_round"},
                      {"label": "Hauptrennen", "offset": 60, "grid": "reverse_standings_before_round"}]},
    ]}
    series = await _season(flow, lineage, weekend=weekend,
                           rules={**RULES, "team_scoring": {"enabled": False}})
    assert series["weekend"]["formats"][1]["note"] == "Ab R5 kein Qualifying, Start in umgekehrter WM-Reihenfolge"
    lines = "\n".join(f"R{number} · {7 + number:02d}.11.2026 20:00 · Probe Ring" for number in range(1, 9))
    pasted = await flow.post(f"{ADMIN}/series/{series['id']}/rounds/paste", json={"text": lines, "apply": True})
    assert pasted.status_code == 200, pasted.text
    calendar = pasted.json()["rounds"]
    sessions = {}
    for item in calendar:
        sessions.setdefault(item["weekend"], []).append(item["session"])
    assert sessions[4] == ["Qualifying", "Sprint", "Hauptrennen"]
    assert sessions[5] == ["Sprint", "Hauptrennen"]
    assert len(calendar) == 4 * 3 + 4 * 2

    body = await _page(flow, lineage, series)
    assert body["rule_changes"] == [{"kind": "format", "from_round": 5, "to_round": None, "day": "2026-11-12",
                                     "note": "Ab R5 kein Qualifying, Start in umgekehrter WM-Reihenfolge",
                                     "sessions": ["Sprint", "Hauptrennen"]}]
    # Teamwertung „keine“: kein Teamstand, die Seite zeigt keinen leeren Teamreiter.
    assert body["racing"]["team_scoring"]["enabled"] is False and body["racing"]["teams"] is None

    # Eine Regeländerung der Saison mit Hinweis steht mit Version und Tag dabei.
    changed = await flow.patch(f"{ADMIN}/series/{series['id']}", json={
        "rules": {**RULES, "team_scoring": {"enabled": False}, "count_mode": "drop_n", "count_n": 1},
        "rules_note": "Ein Streichergebnis"})
    assert changed.status_code == 200, changed.text
    changes = (await _page(flow, lineage, series))["rule_changes"]
    assert changes[1]["kind"] == "rules" and changes[1]["version"] == 2 and changes[1]["note"] == "Ein Streichergebnis"
    assert changes[1]["day"]


# ---------------------------------------------------------------- Umgekehrte Startaufstellung
@pytest.mark.asyncio
async def test_a_sprint_in_reverse_qualifying_order_top_two_without_pole(flow):
    await _board(flow)
    lineage = await _lineage(flow, title="Probe Racing F3")
    weekend = {"formats": [{"from_round": 1, "sessions": [
        {"label": "Qualifying"}, {"label": "Sprint", "offset": 30, "grid": "reverse_qualifying", "reverse_top": 2},
        {"label": "Hauptrennen", "offset": 60, "grid": "qualifying"}]}]}
    series = await _season(flow, lineage, weekend=weekend,
                           rules={**RULES, "bonuses": {"pole": {"points": 2}}, "team_scoring": {"enabled": False}})
    assert series["weekend"]["formats"][0]["sessions"][1]["reverse_top"] == 2
    pasted = await flow.post(f"{ADMIN}/series/{series['id']}/rounds/paste",
                             json={"text": "R1 · 08.11.2026 20:00 · Probe Ring", "apply": True})
    assert pasted.status_code == 200, pasted.text
    ids = {item["session"]: item["id"] for item in pasted.json()["rounds"]}
    await flow.db.reference_participants.insert_many([
        {"series_id": series["id"], "is_club_member": False, "name_hidden": False, **person} for person in PEOPLE])

    # Beim Eintragen fällt eine Pole-Marke im umgekehrten Sprint mit Hinweis weg.
    preview = await flow.post(f"{ADMIN}/series/{series['id']}/rounds/{ids['Sprint']}/results/preview", json={
        "rows": [{"participant_id": "p-ext1", "place": 1, "marks": ["pole"]}, {"participant_id": "p-lion1", "place": 2}]})
    assert preview.status_code == 200, preview.text
    moved = [item for item in preview.json()["warnings"] if item["code"] == "pole_moved"]
    assert moved and "keine Pole" in moved[0]["message"]

    for session, order in (("Qualifying", ["p-lion1", "p-lion2", "p-ext1", "p-ext2"]),
                           ("Sprint", ["p-ext1", "p-lion2", "p-lion1", "p-ext2"]),
                           ("Hauptrennen", ["p-lion1", "p-ext1", "p-lion2", "p-ext2"])):
        await flow.db.reference_round_results.insert_one({
            "id": f"blatt-{session}", "series_id": series["id"], "round_id": ids[session], "status": "published",
            "rows": [{"participant_id": pid, "place": place, "marks": ["pole"] if session == "Sprint" and place == 1
                      else []} for place, pid in enumerate(order, start=1)]})
        await flow.db.reference_rounds.update_one({"id": ids[session]}, {"$set": {"status": "scored"}})
    stored = await flow.db.reference_series.find_one({"id": series["id"]}, {"_id": 0})
    await reference_series.recompute_standings(flow.db, stored)
    rows = (await _page(flow, lineage, series))["standings"]["rows"]
    sprint = {row["key"]: next(item for item in row["results"] if item["round_id"] == ids["Sprint"]) for row in rows}
    # Top 2 umgedreht: Quali-P2 startet von 1, Quali-P1 von 2, dahinter wie im Qualifying - und keine Pole im Sprint.
    assert {key: item.get("grid") for key, item in sprint.items()} == {
        "p-lion2": 1, "p-lion1": 2, "p-ext1": 3, "p-ext2": 4}
    assert all("pole" not in item["marks"] for item in sprint.values())
    race = {row["key"]: next(item for item in row["results"] if item["round_id"] == ids["Hauptrennen"]) for row in rows}
    assert race["p-lion1"]["marks"] == ["pole"]


@pytest.mark.asyncio
async def test_round_page_and_statistics_know_reversed_grids_no_score_rounds_and_cancelled_seasons(flow):
    """Rundenseite und Statistik (#1950) mit den Sonderregeln: der umgekehrte Sprint zeigt Startplatz 1 statt Pole, die
    Pole kommt nur aus dem Qualifying, ein Termin ohne Wertung zählt in der Statistik nicht und zeigt seinen Grund,
    Anpassungen bleiben aus den Punkten je Lauf draußen, eine abgebrochene Saison sagt es."""
    await _board(flow)
    lineage = await _lineage(flow, title="Probe Racing F4")
    weekend = {"formats": [{"from_round": 1, "sessions": [
        {"label": "Qualifying"}, {"label": "Sprint", "offset": 30, "grid": "reverse_qualifying", "reverse_top": 2},
        {"label": "Hauptrennen", "offset": 60, "grid": "qualifying"}]}]}
    series = await _season(flow, lineage, weekend=weekend,
                           rules={**RULES, "bonuses": {"pole": {"points": 2}}, "team_scoring": {"enabled": False}})
    pasted = await flow.post(f"{ADMIN}/series/{series['id']}/rounds/paste", json={
        "text": "R1 · 08.11.2026 20:00 · Probe Ring\nR2 · 15.11.2026 20:00 · Probe Ring", "apply": True})
    assert pasted.status_code == 200, pasted.text
    ids = {(item["weekend"], item["session"]): item["id"] for item in pasted.json()["rounds"]}
    await flow.db.reference_participants.insert_many([
        {"series_id": series["id"], "is_club_member": False, "name_hidden": False, **person} for person in PEOPLE])
    sheets = {
        (1, "Qualifying"): (["p-lion1", "p-lion2", "p-ext1", "p-ext2"], {}),
        # Eine Pole-Marke von Hand im umgekehrten Sprint zählt nicht.
        (1, "Sprint"): (["p-ext1", "p-lion2", "p-lion1", "p-ext2"], {"p-ext1": ["pole"]}),
        (1, "Hauptrennen"): (["p-lion1", "p-ext1", "p-lion2", "p-ext2"], {}),
        (2, "Hauptrennen"): (["p-ext2", "p-ext1"], {}),
    }
    for key, (order, marks) in sheets.items():
        await flow.db.reference_round_results.insert_one({
            "id": f"blatt-{key[0]}-{key[1]}", "series_id": series["id"], "round_id": ids[key], "status": "published",
            "rows": [{"participant_id": pid, "place": place, "marks": marks.get(pid, [])}
                     for place, pid in enumerate(order, start=1)]})
        await flow.db.reference_rounds.update_one({"id": ids[key]}, {"$set": {"status": "scored"}})
    version = (await flow.get(f"{ADMIN}/series/{series['id']}/calendar")).json()["version"]
    no_score = await flow.patch(f"{ADMIN}/series/{series['id']}/rounds/{ids[(2, 'Hauptrennen')]}", json={
        "no_score_reason": "too_few", "no_score_note": "Nur zwei am Start", "expected_version": version})
    assert no_score.status_code == 200, no_score.text
    assert (await flow.post(f"{ADMIN}/series/{series['id']}/adjustments", json={
        "participant_id": "p-lion1", "points": -5, "reason": "Video fehlt", "day": "2026-11-08"})).status_code == 200
    cancelled = await flow.patch(f"{ADMIN}/series/{series['id']}", json={"status": "cancelled",
                                                                          "cancel_reason": "Serverwechsel"})
    assert cancelled.status_code == 200, cancelled.text
    base = f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}"

    page = (await flow.get(f"{base}/rounds/1")).json()
    assert (page["series"]["status"], page["series"]["cancel_reason"]) == ("cancelled", "Serverwechsel")
    sessions = {item["key"]: item for item in page["sessions"]}
    sprint, race = sessions["sprint"], sessions["hauptrennen"]
    assert (sprint["grid_source"], sprint["reverse_top"]) == ("reverse_qualifying", 2)
    assert {row["key"]: row["grid"] for row in sprint["rows"]} == {"p-lion2": 1, "p-lion1": 2, "p-ext1": 3, "p-ext2": 4}
    assert all("pole" not in row["marks"] for row in sprint["rows"])
    assert (race["grid_source"], race["reverse_top"]) == ("qualifying", None)
    race_rows = {row["key"]: row for row in race["rows"]}
    assert race_rows["p-lion1"]["marks"] == ["pole"]
    # Punkte je Lauf ohne Anpassung: 10 für den Sieg plus 2 für die Pole - die −5 gehören in die Gesamtwertung.
    assert race_rows["p-lion1"]["points"] == 12
    assert page["summary"]["pole"]["key"] == "p-lion1" and page["summary"]["pole"]["session"] == "qualifying"

    second = (await flow.get(f"{base}/rounds/2")).json()
    late = next(item for item in second["sessions"] if item["key"] == "hauptrennen")
    assert (late["no_score_reason"], late["no_score_note"], late["counts"]) == ("too_few", "Nur zwei am Start", False)
    assert all(row["points"] is None for row in late["rows"])
    assert second["summary"]["pole"] is None

    stats = (await flow.get(f"{base}/statistics")).json()
    assert stats["series"]["status"] == "cancelled"
    drivers = {row["key"]: row for row in stats["drivers"]}
    assert (drivers["p-lion1"]["poles"], drivers["p-ext1"]["poles"]) == (1, 0)
    assert (drivers["p-lion1"]["wins"], drivers["p-ext1"]["wins"]) == (1, 1)
    # Der Termin ohne Wertung (p-ext2 gewinnt R2) zählt in der Statistik nicht.
    assert drivers["p-ext2"]["wins"] == 0 and drivers["p-ext2"]["races"] == 2


# ---------------------------------------------------------------- Prüfung (Codex)
@pytest.mark.asyncio
async def test_a_captain_never_changes_the_official_team_standings(flow):
    await _board(flow)
    lineage = await _lineage(flow)
    series = await _season(flow, lineage)
    rounds = await _rounds(flow, series, "R1")
    await flow.db.reference_participants.insert_many([
        {"series_id": series["id"], "is_club_member": False, "name_hidden": False, **person} for person in PEOPLE])
    url = f"{ADMIN}/series/{series['id']}/rounds/{rounds['R1']}/results"
    rows = [{"participant_id": "p-lion1", "place": 1}, {"participant_id": "p-ext1", "place": 2}]
    saved = await flow.put(url, json={"rows": rows, "official_team_totals": {"Fremd Rot": 40}, "status": "draft",
                                      "expected_version": 0})
    assert saved.status_code == 200, saved.text

    captain = await flow.add_user(name="captain-probe")
    await flow.db.memberships.update_one({"user_id": captain["id"]},
                                         {"$set": {"user_id": captain["id"], "member_status": "active"}}, upsert=True)
    staff = await flow.post(f"{ADMIN}/series/{series['id']}/staff",
                            json={"user_id": captain["id"], "valid_until": "2099-12-31"})
    assert staff.status_code == 200, staff.text
    flow.act_as(captain)
    changed = await flow.put(url, json={"rows": rows, "official_team_totals": {"Fremd Rot": 99, "Probe Löwen": 1},
                                        "status": "draft", "expected_version": 1})
    assert changed.status_code == 200, changed.text
    sheet = await flow.db.reference_round_results.find_one({"round_id": rounds["R1"]}, {"_id": 0})
    assert sheet["official_team_totals"] == {"Fremd Rot": 40} and sheet["version"] == 2
    preview = await flow.post(f"{url}/preview", json={"rows": rows, "official_team_totals": {"Fremd Rot": 99}})
    assert preview.status_code == 200, preview.text
    teams = {row["team"]: row for row in preview.json()["standings"]["scopes"]["teams"]}
    assert teams["Fremd Rot"]["official_points"] == 40


@pytest.mark.asyncio
async def test_a_successor_is_another_season_of_the_same_lineage_without_a_loop(flow):
    await _board(flow)
    lineage = await _lineage(flow)
    other_lineage = await _lineage(flow, title="Probe Racing Andere")
    first = await _season(flow, lineage, season="2025")
    second = await _season(flow, lineage, season="2026")
    third = await _season(flow, lineage, season="2027")
    foreign = await _season(flow, other_lineage, season="2026")
    url = f"{ADMIN}/series/{{}}"
    other = await flow.patch(url.format(first["id"]), json={"successor_id": foreign["id"]})
    assert other.status_code == 422 and "derselben Spur" in other.json()["detail"]
    assert (await flow.patch(url.format(first["id"]), json={"successor_id": first["id"]})).status_code == 422
    assert (await flow.patch(url.format(first["id"]), json={"successor_id": second["id"]})).status_code == 200
    assert (await flow.patch(url.format(second["id"]), json={"successor_id": third["id"]})).status_code == 200
    loop = await flow.patch(url.format(third["id"]), json={"successor_id": first["id"]})
    assert loop.status_code == 422 and "zurück" in loop.json()["detail"]
    assert (await flow.db.reference_series.find_one({"id": third["id"]})).get("successor_id") is None


@pytest.mark.asyncio
async def test_cancelling_and_reinstating_a_season_is_logged_with_reason_and_successor(flow):
    await _board(flow)
    lineage = await _lineage(flow)
    old = await _season(flow, lineage, season="2026", tier="F1")
    restart = await _season(flow, lineage, season="2026", tier="F1 Neustart")
    url = f"{ADMIN}/series/{old['id']}"
    cancelled = await flow.patch(url, json={"status": "cancelled", "cancel_reason": "Neustart mit anderem Auto",
                                            "successor_id": restart["id"]})
    assert cancelled.status_code == 200, cancelled.text
    log = await flow.db.audit_logs.find_one({"action": "reference_series.cancel", "target_id": old["id"]})
    assert log["data"] == {"cancelled_on": "2026-11-20", "reason": "Neustart mit anderem Auto",
                           "successor_id": restart["id"]}
    assert (await flow.patch(url, json={"status": "active"})).status_code == 200
    undo = await flow.db.audit_logs.find_one({"action": "reference_series.cancel_undo", "target_id": old["id"]})
    assert undo["data"] == {"status": "active", "previous_cancelled_on": "2026-11-20",
                            "previous_reason": "Neustart mit anderem Auto", "successor_id": restart["id"]}
    # Ein unveränderter Abschnitt schreibt keinen weiteren Eintrag.
    assert (await flow.patch(url, json={"status": "active"})).status_code == 200
    actions = [item["action"] async for item in flow.db.audit_logs.find({"target_id": old["id"]})]
    assert actions.count("reference_series.cancel") == 1 and actions.count("reference_series.cancel_undo") == 1


# ---------------------------------------------------------------- Ersatzfahrer
@pytest.mark.asyncio
async def test_substitutes_keep_their_entry_and_new_team_names_are_flagged(flow):
    """Ein Ersatzfahrer bleibt im Blatt „Ersatzfahrer“ und zählt für kein Team; ein Team, das es in der Saison noch nicht
    gibt, bekommt beim Prüfen einen Hinweis - mit Vorschlag, wenn ein bekanntes ähnlich heißt."""
    await _board(flow)
    lineage = await _lineage(flow)
    series = await _season(flow, lineage)
    rounds = await _rounds(flow, series, "R1")
    await flow.db.reference_participants.insert_many([
        {"series_id": series["id"], "is_club_member": False, "name_hidden": False, **person} for person in PEOPLE])
    url = f"{ADMIN}/series/{series['id']}/rounds/{rounds['R1']}/results"
    rows = [{"participant_id": "p-lion1", "place": 1, "team": "Ersatzfahrer"},
            {"participant_id": "p-lion2", "place": 2, "team": "Probe Loewen"},
            {"participant_id": "p-ext1", "place": 3, "team": "Team 2"},
            {"participant_id": "p-ext2", "place": 4}]
    preview = await flow.post(f"{url}/preview", json={"rows": rows})
    assert preview.status_code == 200, preview.text
    unknown = {tuple(item["rows"]): item["message"] for item in preview.json()["warnings"]
               if item["code"] == "team_unknown"}
    assert unknown == {(1,): "Team „Probe Loewen“ gibt es in dieser Saison noch nicht – meintest du „Probe Löwen“?",
                       (2,): "Team „Team 2“ gibt es in dieser Saison noch nicht"}
    saved = await flow.put(url, json={"rows": rows, "status": "published", "expected_version": 0})
    assert saved.status_code == 200, saved.text
    assert saved.json()["sheet"]["rows"][0]["team"] == "Ersatzfahrer"
    teams = (await _page(flow, lineage, series))["racing"]["teams"]["rows"]
    assert "Ersatzfahrer" not in {row["team"] for row in teams}
    # Lion Eins zählt als Ersatzfahrer nicht für die Löwen, Fremd Zwei ohne Team fürs Stammteam.
    assert {row["team"]: row["points"] for row in teams} == {"Probe Loewen": 6, "Team 2": 4, "Fremd Rot": 3}


@pytest.mark.asyncio
async def test_a_spelling_of_an_own_team_is_never_an_unknown_team(flow):
    """Eine hinterlegte Schreibweise eines eigenen Teams („Probe Loewen“ für „Probe Löwen“) ist bekannt - so wie
    ``own_teams.Matcher`` sie beim Rechnen zuordnet; nur ein wirklich neues Team bekommt den Hinweis."""
    await _board(flow)
    lineage = await _lineage(flow)
    series = await _season(flow, lineage, own_teams=[{"name": "Probe Löwen", "aliases": ["Probe Loewen"]}])
    rounds = await _rounds(flow, series, "R1")
    await flow.db.reference_participants.insert_many([
        {"series_id": series["id"], "is_club_member": False, "name_hidden": False, **person} for person in PEOPLE])
    preview = await flow.post(f"{ADMIN}/series/{series['id']}/rounds/{rounds['R1']}/results/preview", json={
        "rows": [{"participant_id": "p-lion1", "place": 1, "team": "Probe Loewen"},
                 {"participant_id": "p-lion2", "place": 2, "team": "probe  löwen"},
                 {"participant_id": "p-ext1", "place": 3, "team": "Team 2"}]})
    assert preview.status_code == 200, preview.text
    unknown = [(item["rows"], item["message"]) for item in preview.json()["warnings"] if item["code"] == "team_unknown"]
    assert unknown == [([2], "Team „Team 2“ gibt es in dieser Saison noch nicht")]


# ---------------------------------------------------------------- Termin ohne Wertung
@pytest.mark.asyncio
async def test_a_round_without_score_has_a_public_reason_and_too_few_starters_warn(flow):
    await _board(flow)
    lineage = await _lineage(flow)
    series = await _season(flow, lineage, rules={**RULES, "min_participants": 3})
    rounds = await _rounds(flow, series, "R1", "R2")
    await flow.db.reference_participants.insert_many([
        {"series_id": series["id"], "is_club_member": False, "name_hidden": False, **person} for person in PEOPLE])

    preview = await flow.post(f"{ADMIN}/series/{series['id']}/rounds/{rounds['R1']}/results/preview", json={
        "rows": [{"participant_id": "p-lion1", "place": 1}, {"participant_id": "p-ext1", "place": 2}]})
    assert preview.status_code == 200, preview.text
    assert "too_few_participants" in [item["code"] for item in preview.json()["warnings"]]

    version = (await flow.get(f"{ADMIN}/series/{series['id']}/calendar")).json()["version"]
    response = await flow.patch(f"{ADMIN}/series/{series['id']}/rounds/{rounds['R1']}", json={
        "no_score_reason": "too_few", "no_score_note": "Nur zwei Fahrer am Start", "expected_version": version})
    assert response.status_code == 200, response.text
    saved = response.json()
    assert (saved["counts"], saved["counts_manual"], saved["no_score_reason"], saved["no_score_note"]) == (
        False, True, "too_few", "Nur zwei Fahrer am Start")
    again = await flow.post(f"{ADMIN}/series/{series['id']}/rounds/{rounds['R1']}/results/preview", json={
        "rows": [{"participant_id": "p-lion1", "place": 1}, {"participant_id": "p-ext1", "place": 2}]})
    assert "too_few_participants" not in [item["code"] for item in again.json()["warnings"]]

    body = await _page(flow, lineage, series)
    first = next(item for item in body["rounds"] if item["id"] == rounds["R1"])
    assert (first["state"], first["counts"], first["no_score_reason"], first["no_score_note"]) == (
        "missing", False, "too_few", "Nur zwei Fahrer am Start")
    assert body["progress"]["total"] == 1

    # Wieder werten: der Grund geht weg.
    version = (await flow.get(f"{ADMIN}/series/{series['id']}/calendar")).json()["version"]
    back = (await flow.patch(f"{ADMIN}/series/{series['id']}/rounds/{rounds['R1']}", json={
        "counts": True, "expected_version": version})).json()
    assert (back["counts"], back["no_score_reason"], back["no_score_note"]) == (True, None, None)
