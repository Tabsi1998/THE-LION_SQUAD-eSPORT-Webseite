"""Externe Namen den Mitgliedern zuordnen (#1743) über die echten Routen: Teilnehmer anlegen, „Unbekannte Namen“ mit
Vorschlägen (Spiel-ID, Alias, nie bei bloß ähnlichen Namen), einmal bestätigen - danach erkennt die Website den Namen
in jeder Serie selbst. Gäste zählen fürs Team, nie für den Verein. Nur die Redaktion sieht Aliase und Verknüpfungen;
Kontolöschung und Auskunft bleiben richtig. Nur erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import migrations  # noqa: E402

ADMIN = "/api/reference-series/admin"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _setup(flow, *, game: bool = True):
    """Vorstand, ein Spiel mit Spieler-ID-Feld, eine Spur mit zwei Saisons und drei Vereinsprofile."""
    db = flow.db
    await migrations.migrate_points_scheme_templates(db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    anna = await flow.add_user(role="player", name="anna")
    await db.users.update_one({"id": anna["id"]}, {"$set": {
        "ea_id": "Probe_Anna77", "game_ids": {"probe-racing": {"racer_id": "AnnaFaehrt"}, "anderes-spiel": {"x": "AnnaWoanders"}}}})
    await db.games.insert_one({"id": "spiel-1", "slug": "probe-racing", "name": "Probe Racing",
                               "player_id_fields": [{"key": "racer_id", "label": "Racer-ID"}]})
    await db.club_member_profiles.insert_many([
        {"id": "p-anna", "user_id": anna["id"], "display_name": "Anna Probe", "source": "member", "is_active": True},
        {"id": "p-bert", "display_name": "Bert Probe", "gamertag": "BertBolzt", "source": "editorial", "is_active": True},
        {"id": "p-alt", "display_name": "Alte Probe", "source": "editorial", "is_active": False},
    ])
    flow.act_as(admin)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Liga F1", "kind": "racing",
                                                           "game_id": "spiel-1" if game else None})).json()
    first = (await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage["id"], "season": "2025",
                                                      "points_scheme_id": "formula_1"})).json()
    second = (await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage["id"], "season": "2026",
                                                       "points_scheme_id": "formula_1"})).json()
    return {"admin": admin, "anna": anna, "lineage": lineage, "first": first, "second": second}


async def _add(flow, series_id: str, name: str, **fields) -> dict:
    response = await flow.post(f"{ADMIN}/series/{series_id}/participants", json={"name": name, **fields})
    assert response.status_code == 200, response.text
    return response.json()


async def _unknown(flow, series_id: str) -> dict:
    response = await flow.get(f"{ADMIN}/series/{series_id}/unknown-names")
    assert response.status_code == 200, response.text
    return {item["participant"]["name"]: item["suggestions"] for item in response.json()["items"]}


async def _assign(flow, series_id: str, participant_id: str, **body):
    return await flow.post(f"{ADMIN}/series/{series_id}/participants/{participant_id}/assign", json=body)


# ---------------------------------------------------------------- Vorschläge
@pytest.mark.asyncio
async def test_unknown_names_come_with_reasons_and_never_match_similar_names(flow):
    ctx = await _setup(flow)
    sid = ctx["first"]["id"]
    for name in ("probe anna77", "[TLS] AnnaFaehrt", "BertBolzt", "AnnaFaehrt2", "AnnaWoanders", "Alte Probe", "Fremd Probe"):
        await _add(flow, sid, name)
    found = await _unknown(flow, sid)
    assert len(found) == 7, "neue Namen sind offen, solange niemand bestätigt hat"
    assert [(item["profile_id"], item["reason"]) for item in found["probe anna77"]] == [("p-anna", "Spiel-ID passt (EA-ID)")]
    assert [(item["profile_id"], item["reason"]) for item in found["[TLS] AnnaFaehrt"]] == [
        ("p-anna", "Spiel-ID passt (Racer-ID) – ohne Clan-Tag")]
    assert [(item["profile_id"], item["basis"]) for item in found["BertBolzt"]] == [("p-bert", "profile_name")]
    # Ähnlich ist nicht gleich; die ID eines anderen Spiels zählt nicht; ein inaktives Profil wird nie vorgeschlagen.
    assert found["AnnaFaehrt2"] == [] and found["AnnaWoanders"] == [] and found["Alte Probe"] == []
    assert found["Fremd Probe"] == []
    # Die Spiel-ID selbst steht nie in der Antwort - nur, welche Art Kennung gepasst hat.
    raw = (await flow.get(f"{ADMIN}/series/{sid}/unknown-names")).json()
    assert "Probe_Anna77" not in str(raw)
    assert [item["id"] for item in raw["profiles"]] == ["p-anna", "p-bert"]


@pytest.mark.asyncio
async def test_without_a_game_on_the_lineage_every_game_id_counts(flow):
    ctx = await _setup(flow, game=False)
    sid = ctx["first"]["id"]
    await _add(flow, sid, "AnnaWoanders")
    assert [item["profile_id"] for item in (await _unknown(flow, sid))["AnnaWoanders"]] == ["p-anna"]


# ---------------------------------------------------------------- Einmal bestätigen
@pytest.mark.asyncio
async def test_confirming_once_saves_the_alias_and_recognises_the_name_everywhere(flow):
    ctx = await _setup(flow)
    first, second = ctx["first"]["id"], ctx["second"]["id"]
    anni = await _add(flow, first, "Anni Rennt", start_number="17")
    waiting = await _add(flow, second, "anni rennt")  # schon in der nächsten Saison eingetragen, noch offen
    response = await _assign(flow, first, anni["id"], link="member", profile_id="p-anna")
    assert response.status_code == 200, response.text
    saved = response.json()
    assert (saved["link"], saved["profile_id"], saved["is_club_member"], saved["link_status"]) == ("member", "p-anna", True, "decided")
    assert saved["link_source"] == "manual" and saved["decided_by"] == ctx["admin"]["id"]

    alias = await flow.db.reference_aliases.find_one({"name_normalized": "annirennt"}, {"_id": 0})
    assert (alias["target"], alias["profile_id"], alias["game_id"], alias["source"]) == ("member", "p-anna", "spiel-1", "manual")
    assert alias["confirmed_by"] == ctx["admin"]["id"] and alias["confirmed_at"]
    # Der offene Name in der anderen Saison ist gleich mit zugeordnet ...
    other = await flow.db.reference_participants.find_one({"id": waiting["id"]}, {"_id": 0})
    assert (other["link"], other["profile_id"], other["link_source"]) == ("member", "p-anna", "alias")
    # ... und ein später eingetragener Name ebenso - ohne Rückfrage.
    later = await _add(flow, second, "ANNI-RENNT")
    assert (later["link"], later["profile_id"], later["link_status"]) == ("member", "p-anna", "decided")
    # Erst ohne Clan-Tag gleich: nur ein Vorschlag mit Datum, keine stille Übernahme.
    tagged = await _add(flow, second, "[XY] Anni Rennt")
    assert tagged["link_status"] == "open"
    suggestion = (await _unknown(flow, second))["[XY] Anni Rennt"][0]
    assert suggestion["profile_id"] == "p-anna" and suggestion["reason"].startswith("Alias bestätigt am ")
    assert suggestion["reason"].endswith("– ohne Clan-Tag")

    audit = await flow.db.audit_logs.find_one({"action": "reference_series.participant_assign"}, {"_id": 0})
    assert audit["data"]["also_assigned_in"] == [second] and audit["actor_id"] == ctx["admin"]["id"]


@pytest.mark.asyncio
async def test_accepting_a_strong_suggestion_is_recorded_as_such(flow):
    ctx = await _setup(flow)
    sid = ctx["first"]["id"]
    row = await _add(flow, sid, "Probe_Anna77")
    await _assign(flow, sid, row["id"], link="member", profile_id="p-anna")
    alias = await flow.db.reference_aliases.find_one({"name_normalized": "probeanna77"}, {"_id": 0})
    assert alias["source"] == "suggestion"


@pytest.mark.asyncio
async def test_the_start_number_of_an_earlier_season_is_only_a_hint(flow):
    ctx = await _setup(flow)
    old = await _add(flow, ctx["first"]["id"], "Bert Alt", start_number="17")
    await _assign(flow, ctx["first"]["id"], old["id"], link="member", profile_id="p-bert")
    new = await _add(flow, ctx["second"]["id"], "Ganz Neu", start_number="17")
    assert new["link_status"] == "open"
    hint = (await _unknown(flow, ctx["second"]["id"]))["Ganz Neu"]
    assert [(item["profile_id"], item["strong"], item["reason"]) for item in hint] == [
        ("p-bert", False, "Gleiche Startnummer 17 wie in 2025")]


@pytest.mark.asyncio
async def test_external_saves_no_alias_and_takes_back_a_wrong_one(flow):
    ctx = await _setup(flow)
    sid = ctx["first"]["id"]
    row = await _add(flow, sid, "Verwechselt")
    await _assign(flow, sid, row["id"], link="member", profile_id="p-bert")
    assert await flow.db.reference_aliases.count_documents({}) == 1
    fixed = (await _assign(flow, sid, row["id"], link="external")).json()
    assert (fixed["link"], fixed["profile_id"], fixed["is_club_member"]) == ("external", None, False)
    assert await flow.db.reference_aliases.count_documents({}) == 0
    stranger = await _add(flow, sid, "Fremd Probe")
    await _assign(flow, sid, stranger["id"], link="external")
    assert await flow.db.reference_aliases.count_documents({}) == 0, "über Fremde wird kein Alias gespeichert"
    again = await _add(flow, ctx["second"]["id"], "Verwechselt")
    assert again["link_status"] == "open"


@pytest.mark.asyncio
async def test_assignment_checks_profile_and_series(flow):
    ctx = await _setup(flow)
    row = await _add(flow, ctx["first"]["id"], "Probe")
    assert (await _assign(flow, ctx["first"]["id"], row["id"], link="member", profile_id="p-alt")).status_code == 404
    assert (await _assign(flow, ctx["first"]["id"], row["id"], link="member")).status_code == 404
    # Der Teilnehmer muss zur Serie aus dem Pfad gehören.
    assert (await _assign(flow, ctx["second"]["id"], row["id"], link="external")).status_code == 404
    patched = await flow.patch(f"{ADMIN}/series/{ctx['second']['id']}/participants/{row['id']}", json={"name": "X"})
    assert patched.status_code == 404


@pytest.mark.asyncio
async def test_batch_adds_new_names_and_skips_known_ones(flow):
    ctx = await _setup(flow)
    sid = ctx["first"]["id"]
    await _add(flow, sid, "Erste Probe")
    response = await flow.post(f"{ADMIN}/series/{sid}/participants/batch",
                               json={"names": ["erste probe", "Zweite Probe", " ", "Zweite  Probe", "Dritte Probe"]})
    assert response.status_code == 200, response.text
    assert [row["name"] for row in response.json()["created"]] == ["Zweite Probe", "Dritte Probe"]
    assert response.json()["skipped"] == 3
    listed = (await flow.get(f"{ADMIN}/series/{sid}/participants")).json()
    assert [row["name"] for row in listed["participants"]] == ["Dritte Probe", "Erste Probe", "Zweite Probe"]
    assert listed["counts"]["open"] == 3


@pytest.mark.asyncio
async def test_names_without_letters_or_digits_are_refused(flow):
    ctx = await _setup(flow)
    sid = ctx["first"]["id"]
    for name in ("!!!", "🙂", "[TLS]"):
        response = await flow.post(f"{ADMIN}/series/{sid}/participants", json={"name": name})
        assert response.status_code == 422, name
    response = await flow.post(f"{ADMIN}/series/{sid}/participants/batch", json={"names": ["!!!", "[TLS]", "Gut Probe", " "]})
    assert [row["name"] for row in response.json()["created"]] == ["Gut Probe"]
    assert response.json()["rejected"] == ["!!!", "[TLS]"] and response.json()["skipped"] == 3
    row = response.json()["created"][0]
    assert (await flow.patch(f"{ADMIN}/series/{sid}/participants/{row['id']}", json={"name": "🙂🙂"})).status_code == 422
    # Ein alter Teilnehmer ohne Schlüssel bekommt nie einen Alias.
    await flow.db.reference_participants.update_one({"id": row["id"]}, {"$set": {"name": "???", "name_normalized": ""}})
    assert (await _assign(flow, sid, row["id"], link="member", profile_id="p-anna")).status_code == 422
    assert (await _assign(flow, sid, row["id"], link="external")).status_code == 200
    assert await flow.db.reference_aliases.count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_game_bound_alias_wins_and_a_global_one_does_not_override_it(flow):
    ctx = await _setup(flow)
    game_series = ctx["first"]["id"]
    waiting = await _add(flow, game_series, "Doppel Name")  # offen, bevor es Aliase gab
    other = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Ohne Spiel", "kind": "series"})).json()
    free = (await flow.post(f"{ADMIN}/series", json={"lineage_id": other["id"], "season": "2026"})).json()
    await flow.db.reference_aliases.insert_one({"id": "a-game", "name": "Doppel Name", "name_normalized": "doppelname",
                                                "target": "member", "profile_id": "p-anna", "guest_name": None,
                                                "game_id": "spiel-1", "confirmed_at": "2026-01-01T10:00:00+00:00"})
    row = await _add(flow, free["id"], "Doppel Name")
    await _assign(flow, free["id"], row["id"], link="member", profile_id="p-bert")  # globaler Alias
    # Der globale Alias ordnet in der Spur mit eigenem Spiel-Alias nichts zu ...
    assert (await flow.db.reference_participants.find_one({"id": waiting["id"]}, {"_id": 0}))["link_status"] == "open"
    # ... und ein neuer Name dort folgt dem Alias seines Spiels.
    assert (await _add(flow, game_series, "Doppel Name"))["profile_id"] == "p-anna"
    assert (await _add(flow, free["id"], "Doppel-Name"))["profile_id"] == "p-bert"


@pytest.mark.asyncio
async def test_editing_a_participant_never_changes_the_link(flow):
    ctx = await _setup(flow)
    sid = ctx["first"]["id"]
    row = await _add(flow, sid, "Probe Name")
    response = await flow.patch(f"{ADMIN}/series/{sid}/participants/{row['id']}", json={
        "name": " Probe  Neu ", "start_number": "9", "default_team": "Team Probe", "link": "member",
        "profile_id": "p-anna", "is_club_member": True})
    assert response.status_code == 200, response.text
    saved = response.json()
    assert (saved["name"], saved["name_normalized"], saved["start_number"]) == ("Probe Neu", "probeneu", "9")
    assert (saved["link"], saved["profile_id"], saved["is_club_member"], saved["link_status"]) == ("external", None, False, "open")


# ---------------------------------------------------------------- Gast
@pytest.mark.asyncio
async def test_a_guest_counts_for_the_team_but_not_for_the_club(flow):
    ctx = await _setup(flow)
    sid = ctx["first"]["id"]
    rules = {**ctx["first"]["rules"], "team_scoring": {"enabled": True, "counting_drivers": None, "guests_count": True}}
    await flow.patch(f"{ADMIN}/series/{sid}", json={"rules": rules, "team_name": "Löwen Probe"})
    member = await _add(flow, sid, "Anna Rennt", default_team="Löwen Probe")
    guest = await _add(flow, sid, "Gast Fahrer", default_team="Löwen Probe")
    await _assign(flow, sid, member["id"], link="member", profile_id="p-anna")
    saved = (await _assign(flow, sid, guest["id"], link="guest")).json()
    assert (saved["link"], saved["guest_name"], saved["is_club_member"], saved["profile_id"]) == ("guest", "Gast Fahrer", False, None)
    alias = await flow.db.reference_aliases.find_one({"name_normalized": "gastfahrer"}, {"_id": 0})
    assert (alias["target"], alias["guest_name"]) == ("guest", "Gast Fahrer")

    # Ein gewertetes Rennen: der Gast punktet fürs Team ...
    await flow.db.reference_rounds.insert_one({"id": "r1", "series_id": sid, "order": 1, "status": "scored",
                                               "counts": True, "kind": "regular", "archived_at": None})
    await flow.db.reference_round_results.insert_one({"id": "b1", "series_id": sid, "round_id": "r1", "status": "published",
                                                      "rows": [{"participant_id": member["id"], "place": 1},
                                                               {"participant_id": guest["id"], "place": 2}]})
    series = await flow.db.reference_series.find_one({"id": sid}, {"_id": 0})
    from services import reference_series
    await reference_series.recompute_standings(flow.db, series)
    teams = await flow.db.reference_standings.find_one({"series_id": sid, "scope": "teams"}, {"_id": 0})
    assert teams["rows"][0]["computed_points"] == 25 + 18
    # ... aber in der Vereinsstatistik zählt nur das Mitglied.
    listed = (await flow.get(f"{ADMIN}/series/{sid}/participants")).json()
    assert (listed["counts"]["club"], listed["counts"]["member"], listed["counts"]["guest"]) == (1, 1, 1)
    by_name = {row["name"]: row for row in listed["participants"]}
    assert by_name["Anna Rennt"]["profile_name"] == "Anna Probe"
    # Ein späterer Eintrag mit demselben Namen ist gleich wieder Gast.
    assert (await _add(flow, ctx["second"]["id"], "Gast Fahrer"))["link"] == "guest"


# ---------------------------------------------------------------- Datenschutz
@pytest.mark.asyncio
async def test_only_the_content_area_sees_aliases_and_links(flow):
    ctx = await _setup(flow)
    sid = ctx["first"]["id"]
    row = await _add(flow, sid, "Probe Name")
    for user in (ctx["anna"], await flow.add_user(role="moderator", name="moderation")):
        flow.act_as(user)
        assert (await flow.get(f"{ADMIN}/series/{sid}/participants")).status_code == 403
        assert (await flow.get(f"{ADMIN}/series/{sid}/unknown-names")).status_code == 403
        assert (await _assign(flow, sid, row["id"], link="external")).status_code == 403
        assert (await flow.post(f"{ADMIN}/series/{sid}/participants", json={"name": "X"})).status_code == 403


@pytest.mark.asyncio
async def test_deleting_the_account_after_a_confirmed_assignment(flow):
    ctx = await _setup(flow)
    sid = ctx["first"]["id"]
    row = await _add(flow, sid, "Anni Rennt")
    await _assign(flow, sid, row["id"], link="member", profile_id="p-anna")
    flow.act_as(ctx["anna"])
    export = (await flow.get("/api/dsgvo/export-my-data")).json()
    assert [item["name"] for item in export["reference_aliases"]] == ["Anni Rennt"]
    assert ctx["admin"]["id"] not in str(export["reference_aliases"]) + str(export["reference_participations"])
    assert (await flow.post("/api/dsgvo/anonymize-me")).status_code == 200
    gone = await flow.db.reference_participants.find_one({"id": row["id"]}, {"_id": 0})
    assert (gone["profile_id"], gone["link"], gone["name_hidden"], gone["is_club_member"]) == (None, "external", True, False)
    assert await flow.db.reference_aliases.count_documents({}) == 0
    # Der Name wird danach nicht mehr von selbst zugeordnet.
    flow.act_as(ctx["admin"])
    assert (await _add(flow, ctx["second"]["id"], "Anni Rennt"))["link_status"] == "open"


# ---------------------------------------------------------------- Korrektur eines Alias
@pytest.mark.asyncio
async def test_correcting_an_alias_moves_everyone_it_assigned_but_not_single_decisions(flow):
    ctx = await _setup(flow)
    first, second = ctx["first"]["id"], ctx["second"]["id"]
    original = await _add(flow, first, "Wechsel Name")
    await _assign(flow, first, original["id"], link="member", profile_id="p-bert")
    auto = await _add(flow, second, "Wechsel Name")  # von selbst über den Alias zugeordnet
    assert (auto["profile_id"], auto["link_source"]) == ("p-bert", "alias")
    single = await _add(flow, second, "Wechsel-Name")
    await flow.db.reference_participants.update_one({"id": single["id"]}, {"$set": {"link_source": "manual"}})

    # Korrektur am automatisch zugeordneten Teilnehmer: der Alias zieht um und alle, die er zugeordnet hat, mit.
    later = await _add(flow, first, "WECHSEL NAME")
    fixed = (await _assign(flow, second, auto["id"], link="member", profile_id="p-anna")).json()
    assert fixed["profile_id"] == "p-anna"
    assert (await flow.db.reference_participants.find_one({"id": later["id"]}, {"_id": 0}))["profile_id"] == "p-anna"
    assert await flow.db.reference_aliases.count_documents({}) == 1
    assert (await flow.db.reference_aliases.find_one({}, {"_id": 0}))["profile_id"] == "p-anna"
    # Einzeln bestätigte Zuordnungen bleiben.
    assert (await flow.db.reference_participants.find_one({"id": original["id"]}, {"_id": 0}))["profile_id"] == "p-bert"
    assert (await flow.db.reference_participants.find_one({"id": single["id"]}, {"_id": 0}))["profile_id"] == "p-bert"
    assert (await _add(flow, second, "Wechsel  Name!"))["profile_id"] == "p-anna"

    # „Extern“ nimmt den Alias zurück: wer über ihn zugeordnet war, wird ebenfalls extern.
    await _assign(flow, second, fixed["id"], link="external")
    assert await flow.db.reference_aliases.count_documents({}) == 0
    follower = await flow.db.reference_participants.find_one({"id": later["id"]}, {"_id": 0})
    assert (follower["link"], follower["profile_id"], follower["alias_id"], follower["is_club_member"]) == (
        "external", None, None, False)
    assert (await flow.db.reference_participants.find_one({"id": single["id"]}, {"_id": 0}))["profile_id"] == "p-bert"
    audit = await flow.db.audit_logs.find({"action": "reference_series.participant_assign"}, {"_id": 0}).to_list(None)
    assert later["id"] in audit[-1]["data"]["followers"]
