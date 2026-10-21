"""Teilnehmer einer Saison nachträglich bearbeiten (#1929) über die echten Routen.

- Name, Startnummer und Standard-Team ändern: ins Protokoll, danach neu rechnen; ein Name, den es in der Saison schon
  gibt, verweist aufs Zusammenführen.
- Mehrere auf einmal als Extern oder Gast: eine Sperre, einmal neu rechnen, Aliase zurückgenommen, andere Saisons
  über den Alias mitgezogen (je unter ihrer eigenen Sperre, danach).
- Zwei Schreibweisen zusammenführen: Ergebnisse samt Entwürfen wandern mit; stehen beide in einem Ergebnis, bleibt
  alles, wie es ist.
- Entfernen nur ohne Ergebnis.
- Nur der Vorstand (Bereich Redaktion), kein Captain.

Nur erfundene Namen."""
import pathlib
import sys
from datetime import date, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import migrations, reference_series  # noqa: E402
from services.dolibarr_policy import club_today  # noqa: E402

ADMIN = "/api/reference-series/admin"
PUBLIC = "/api/reference-series/public"
# Punkte für alle 20 Plätze; Teamwertung ohne Gäste - so ändert jede Zuordnung den Stand sichtbar.
RULES = {"points_mode": "scheme", "points_by_place": list(range(20, 0, -1)),
         "team_scoring": {"enabled": True, "counting_drivers": None, "guests_count": False}}
OWN_TEAM = "Probe Löwen"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    # Die Sperre je Saison braucht wie in der Datenbank (database.py) einen eindeutigen Schlüssel.
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


def _day(offset: int) -> str:
    return (date.fromisoformat(club_today()) + timedelta(days=offset)).isoformat()


async def _round(flow, series_id: str, code: str, offset: int) -> str:
    created = await flow.post(f"{ADMIN}/series/{series_id}/rounds", json={"day": _day(offset), "code": code})
    assert created.status_code == 200, created.text
    return created.json()["id"]


async def _setup(flow):
    """Vorstand, eine Rennliga mit Saison 2026 (drei Termine) und Vorsaison 2025 (ein Termin), ein Captain."""
    await migrations.migrate_points_scheme_templates(flow.db)
    board = await flow.add_user(role="user", name="vorstand-vera")
    await flow.db.users.update_one({"id": board["id"]}, {"$set": {"areas": ["content"]}})
    board["areas"] = ["content"]
    flow.act_as(board)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Rennliga", "kind": "racing"})).json()
    body = {"lineage_id": lineage["id"], "points_scheme_id": "formula_1", "rules": RULES, "team_name": OWN_TEAM}
    own = (await flow.post(f"{ADMIN}/series", json={**body, "season": "2026", "status": "active"})).json()
    earlier = (await flow.post(f"{ADMIN}/series", json={**body, "season": "2025"})).json()
    rounds = [await _round(flow, own["id"], f"R{index + 1}", -30 + index * 7) for index in range(3)]
    earlier_round = await _round(flow, earlier["id"], "R1", -300)
    captain = await flow.add_user(name="captain-carla")
    await flow.db.memberships.insert_one({"user_id": captain["id"], "member_status": "active"})
    staff = await flow.post(f"{ADMIN}/series/{own['id']}/staff",
                            json={"user_id": captain["id"], "valid_until": _day(30)})
    assert staff.status_code == 200, staff.text
    return {"board": board, "captain": captain, "lineage": lineage, "own": own, "earlier": earlier,
            "rounds": rounds, "earlier_round": earlier_round}


async def _add(flow, series_id: str, name: str, **fields) -> dict:
    response = await flow.post(f"{ADMIN}/series/{series_id}/participants", json={"name": name, **fields})
    assert response.status_code == 200, response.text
    return response.json()


async def _assign(flow, series_id: str, participant_id: str, **body):
    return await flow.post(f"{ADMIN}/series/{series_id}/participants/{participant_id}/assign", json=body)


async def _publish(flow, series_id: str, round_id: str, rows: list[dict], *, status: str = "published",
                   version: int = 0) -> dict:
    answer = await flow.put(f"{ADMIN}/series/{series_id}/rounds/{round_id}/results",
                            json={"rows": rows, "status": status, "expected_version": version})
    assert answer.status_code == 200, answer.text
    return answer.json()


def _places(ids: list[str], **extra) -> list[dict]:
    return [{"participant_id": pid, "place": index, **extra} for index, pid in enumerate(ids, start=1)]


async def _person(flow, participant_id: str) -> dict | None:
    return await flow.db.reference_participants.find_one({"id": participant_id}, {"_id": 0})


async def _standings_match_a_fresh_recompute(flow, series_id: str) -> dict:
    stored = {(row["round_id"], row["scope"]): row["rows"]
              async for row in flow.db.reference_standings.find({"series_id": series_id}, {"_id": 0})}
    series = await flow.db.reference_series.find_one({"id": series_id}, {"_id": 0})
    await reference_series.recompute_standings(flow.db, series)
    fresh = {(row["round_id"], row["scope"]): row["rows"]
             async for row in flow.db.reference_standings.find({"series_id": series_id}, {"_id": 0})}
    assert stored == fresh and stored, series_id
    return stored


def _count_recomputes(monkeypatch) -> list[str]:
    calls: list[str] = []
    original = reference_series.recompute_standings

    async def counting(db, series):
        calls.append(series["id"])
        return await original(db, series)

    monkeypatch.setattr(reference_series, "recompute_standings", counting)
    return calls


async def _hold_lock(flow, series_id: str) -> None:
    """Ein anderer Vorgang hält die Sperre dieser Saison gerade fest."""
    await flow.db.mutation_locks.insert_one({"resource": f"series:{series_id}", "owner": "anderer-worker",
                                             "expires_at": now_utc() + timedelta(minutes=1)})


# ---------------------------------------------------------------- Prüffall: 20 Gäste, 17 davon fremd
async def _twenty_guests(flow, ctx) -> dict:
    """Eine Rennliga mit 20 Fahrern, alle versehentlich als Gast angelegt. Die ersten drei fahren fürs Vereinsteam,
    die anderen für zwei fremde Teams. Die Vorsaison kennt dieselben Namen - über den Alias ebenfalls Gäste."""
    own, earlier = ctx["own"]["id"], ctx["earlier"]["id"]
    names = [f"Probe Fahrer {number:02d}" for number in range(1, 21)]
    teams = {name: OWN_TEAM if index < 3 else ("Fremd Rot" if index % 2 else "Fremd Blau")
             for index, name in enumerate(names)}
    added = await flow.post(f"{ADMIN}/series/{earlier}/participants/batch", json={"names": names})
    assert added.status_code == 200, added.text
    ids = {}
    for name in names:
        row = await _add(flow, own, name, default_team=teams[name])
        assert (await _assign(flow, own, row["id"], link="guest")).status_code == 200
        ids[name] = row["id"]
    earlier_ids = {row["name"]: row["id"] async for row in flow.db.reference_participants.find({"series_id": earlier})}
    assert all([(await _person(flow, pid))["link"] == "guest" for pid in earlier_ids.values()])
    # Das Standard-Team steht im Feld, wie beim Eintragen vorbelegt (#1960: ein leeres Feld hieße kein Team).
    await _publish(flow, own, ctx["rounds"][0], [{**row, "team": teams[names[index]]}
                                                 for index, row in enumerate(_places([ids[name] for name in names]))])
    await _publish(flow, earlier, ctx["earlier_round"],
                   [{**row, "team": teams[names[index]]}
                    for index, row in enumerate(_places([earlier_ids[name] for name in names]))])
    return {"names": names, "teams": teams, "ids": ids, "earlier_ids": earlier_ids}


@pytest.mark.asyncio
async def test_seventeen_of_twenty_guests_become_external_with_one_action(flow, monkeypatch):
    ctx = await _setup(flow)
    own, earlier = ctx["own"]["id"], ctx["earlier"]["id"]
    league = await _twenty_guests(flow, ctx)
    names, ids = league["names"], league["ids"]
    # Vorher: alle sind Gäste, die Teamwertung ohne Gäste hat kein einziges Team.
    assert await flow.db.reference_standings.find_one({"series_id": own, "scope": "teams"}) is None
    assert await flow.db.reference_aliases.count_documents({}) == 20

    calls = _count_recomputes(monkeypatch)
    strangers = [ids[name] for name in names[3:]]
    response = await flow.post(f"{ADMIN}/series/{own}/participants/bulk-assign",
                               json={"participant_ids": strangers, "link": "external"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert sorted(body["changed"]) == sorted(strangers) and body["unchanged"] == []
    assert body["other_series"] == {"updated": [earlier], "pending": []} and "notice" not in body
    # Gesammelt: diese Saison einmal neu gerechnet, die mitgezogene Vorsaison ebenfalls einmal.
    assert calls.count(own) == 1 and calls.count(earlier) == 1

    # Die 17 sind extern, ihre Aliase sind weg; die drei echten Gäste bleiben.
    for name in names[3:]:
        row = await _person(flow, ids[name])
        assert (row["link"], row["link_status"], row["alias_id"], row["is_club_member"]) == (
            "external", "decided", None, False), name
    assert all([(await _person(flow, ids[name]))["link"] == "guest" for name in names[:3]])
    assert sorted([alias["name"] async for alias in flow.db.reference_aliases.find({})]) == names[:3]
    # Die Vorsaison hing über die Aliase daran und zieht mit.
    for name in names[3:]:
        assert (await _person(flow, league["earlier_ids"][name]))["link"] == "external", name
    assert all([(await _person(flow, league["earlier_ids"][name]))["link"] == "guest" for name in names[:3]])

    # Teamwertung: jetzt zählen die Fremden für ihre Teams, das Vereinsteam (nur Gäste) weiter nicht.
    own_standings = await _standings_match_a_fresh_recompute(flow, own)
    await _standings_match_a_fresh_recompute(flow, earlier)
    teams = {row["team"]: row for row in own_standings[(ctx["rounds"][0], "teams")]}
    assert set(teams) == {"Fremd Rot", "Fremd Blau"}
    points = {name: 21 - place for place, name in enumerate(names, start=1)}
    for team, row in teams.items():
        assert row["computed_points"] == sum(points[name] for name in names[3:] if league["teams"][name] == team)

    # Garage der Rennliga: „Gast“ nur noch bei den drei echten Gästen, das Vereinsteam bleibt das eigene.
    flow.act_as(None)
    page = await flow.get(f"{PUBLIC}/{ctx['lineage']['slug']}/{ctx['own']['season_slug']}")
    assert page.status_code == 200, page.text
    racing = page.json()["racing"]
    assert sorted(pid for pid, driver in racing["drivers"].items() if driver["guest"]) == sorted(
        ids[name] for name in names[:3])
    assert racing["club_teams"] == [OWN_TEAM]

    logs = await flow.db.audit_logs.find({"action": "reference_series.participant_bulk_assign"},
                                         {"_id": 0}).to_list(None)
    assert len(logs) == 1
    data = logs[0]["data"]
    assert (data["series_id"], data["link"], len(data["items"])) == (own, "external", 17)
    assert data["also_assigned_in"] == [earlier] and {item["previous_link"] for item in data["items"]} == {"guest"}


@pytest.mark.asyncio
async def test_bulk_guest_saves_aliases_and_skips_who_already_is_a_guest(flow, monkeypatch):
    ctx = await _setup(flow)
    own = ctx["own"]["id"]
    first, second, done = [await _add(flow, own, name) for name in ("Probe Erst", "Probe Zweit", "Probe Schon")]
    await _assign(flow, own, done["id"], link="guest")
    calls = _count_recomputes(monkeypatch)
    response = await flow.post(f"{ADMIN}/series/{own}/participants/bulk-assign",
                               json={"participant_ids": [first["id"], second["id"], done["id"]], "link": "guest"})
    assert response.status_code == 200, response.text
    assert sorted(response.json()["changed"]) == sorted([first["id"], second["id"]])
    assert response.json()["unchanged"] == [done["id"]]
    assert calls == [own]
    for row in (first, second):
        saved = await _person(flow, row["id"])
        assert (saved["link"], saved["guest_name"], saved["link_status"]) == ("guest", row["name"], "decided")
    assert await flow.db.reference_aliases.count_documents({"target": "guest"}) == 3
    # Ein später eingetragener gleicher Name in der Vorsaison ist gleich Gast.
    assert (await _add(flow, ctx["earlier"]["id"], "Probe Zweit"))["link"] == "guest"


@pytest.mark.asyncio
async def test_bulk_refuses_without_changing_anything(flow):
    ctx = await _setup(flow)
    own, earlier = ctx["own"]["id"], ctx["earlier"]["id"]
    mine = await _add(flow, own, "Probe Mein")
    foreign = await _add(flow, earlier, "Probe Fremd")
    url = f"{ADMIN}/series/{own}/participants/bulk-assign"
    # Ein Teilnehmer einer anderen Saison: 404, auch der eigene bleibt offen.
    mixed = await flow.post(url, json={"participant_ids": [mine["id"], foreign["id"]], "link": "external"})
    assert mixed.status_code == 404
    assert (await _person(flow, mine["id"]))["link_status"] == "open"
    # Mitglied geht nur einzeln (mit Profil); eine leere Auswahl ist keine.
    assert (await flow.post(url, json={"participant_ids": [mine["id"]], "link": "member"})).status_code == 422
    assert (await flow.post(url, json={"participant_ids": [], "link": "external"})).status_code == 422
    # Ein Name ohne Buchstaben bekommt keinen Alias: als Gast wird dann keiner geändert.
    broken = await _add(flow, own, "Probe Kaputt")
    await flow.db.reference_participants.update_one({"id": broken["id"]},
                                                    {"$set": {"name": "???", "name_normalized": ""}})
    refused = await flow.post(url, json={"participant_ids": [mine["id"], broken["id"]], "link": "guest"})
    assert refused.status_code == 422 and "???" in refused.text
    assert (await _person(flow, mine["id"]))["link_status"] == "open"
    assert await flow.db.reference_aliases.count_documents({}) == 0
    assert await flow.db.audit_logs.count_documents({"action": "reference_series.participant_bulk_assign"}) == 0


@pytest.mark.asyncio
async def test_bulk_leaves_a_busy_other_season_whole_and_it_catches_up_later(flow, monkeypatch):
    monkeypatch.setattr(reference_series, "SERIES_WAIT_SECONDS", 0.05)
    ctx = await _setup(flow)
    own, earlier = ctx["own"]["id"], ctx["earlier"]["id"]
    league = await _twenty_guests(flow, ctx)
    strangers = [league["ids"][name] for name in league["names"][3:6]]
    await _hold_lock(flow, earlier)
    response = await flow.post(f"{ADMIN}/series/{own}/participants/bulk-assign",
                               json={"participant_ids": strangers, "link": "external"})
    assert response.status_code == 200, response.text
    assert response.json()["other_series"] == {"updated": [], "pending": [earlier]}
    assert response.json()["notice"].startswith("1 weitere Saison wird gerade bearbeitet")
    waiting = league["earlier_ids"][league["names"][3]]
    assert (await _person(flow, waiting))["link"] == "guest"
    assert len((await flow.db.reference_series.find_one({"id": earlier}))["alias_followups"]) == 3

    await flow.db.mutation_locks.delete_many({"owner": "anderer-worker"})
    next_write = await flow.post(f"{ADMIN}/series/{earlier}/rounds", json={"day": _day(-200), "code": "R2"})
    assert next_write.status_code == 200
    assert (await _person(flow, waiting))["link"] == "external"
    await _standings_match_a_fresh_recompute(flow, earlier)


# ---------------------------------------------------------------- Bearbeiten
@pytest.mark.asyncio
async def test_editing_name_number_and_team_is_logged_and_recomputed(flow):
    ctx = await _setup(flow)
    own = ctx["own"]["id"]
    anna = await _add(flow, own, "Probe Anah", default_team="Fremd Rot")
    bert = await _add(flow, own, "Probe Bert", default_team="Fremd Rot")
    # R1 mit dem Standard-Team im Feld (wie vorbelegt), R2 mit leerem Feld.
    await _publish(flow, own, ctx["rounds"][0], _places([anna["id"], bert["id"]], team="Fremd Rot"))
    await _publish(flow, own, ctx["rounds"][1], _places([anna["id"], bert["id"]]))
    response = await flow.patch(f"{ADMIN}/series/{own}/participants/{anna['id']}",
                                json={"name": "Probe Anna", "start_number": "7", "default_team": "Fremd Blau"})
    assert response.status_code == 200, response.text
    saved = response.json()
    assert (saved["name"], saved["name_normalized"], saved["start_number"], saved["default_team"]) == (
        "Probe Anna", "probeanna", "7", "Fremd Blau")
    # Neu gerechnet - aber was im Blatt steht, zählt (#1960): ein neues Standard-Team zieht gefahrene Rennen nicht um,
    # ein leeres Team-Feld zählt für kein Team.
    standings = await _standings_match_a_fresh_recompute(flow, own)
    teams = {row["team"]: row["computed_points"] for row in standings[(ctx["rounds"][1], "teams")]}
    assert teams == {"Fremd Rot": 39}
    log = await flow.db.audit_logs.find_one({"action": "reference_series.participant_update"}, {"_id": 0})
    assert log["target_id"] == anna["id"] and log["actor_id"] == ctx["board"]["id"]
    assert log["data"]["changes"] == {"name": ["Probe Anah", "Probe Anna"], "start_number": [None, "7"],
                                      "default_team": ["Fremd Rot", "Fremd Blau"]}


@pytest.mark.asyncio
async def test_a_name_that_already_is_in_the_season_points_to_merging(flow):
    ctx = await _setup(flow)
    own = ctx["own"]["id"]
    await _add(flow, own, "Probe Anna")
    typo = await _add(flow, own, "Probe Ana")
    response = await flow.patch(f"{ADMIN}/series/{own}/participants/{typo['id']}", json={"name": "probe  ANNA"})
    assert response.status_code == 409 and "zusammen" in response.json()["detail"]
    assert (await _person(flow, typo["id"]))["name"] == "Probe Ana"
    # Unverändert speichern ist keine Änderung und steht nicht im Protokoll.
    same = await flow.patch(f"{ADMIN}/series/{own}/participants/{typo['id']}", json={"name": "Probe Ana"})
    assert same.status_code == 200
    assert await flow.db.audit_logs.count_documents({"action": "reference_series.participant_update"}) == 0


@pytest.mark.asyncio
async def test_participants_list_brings_profiles_to_choose_from_and_who_is_in_a_result(flow):
    ctx = await _setup(flow)
    own = ctx["own"]["id"]
    await flow.db.club_member_profiles.insert_many([
        {"id": "p-bert", "display_name": "Bert Probe", "is_active": True},
        {"id": "p-anna", "display_name": "Anna Probe", "is_active": True},
        {"id": "p-alt", "display_name": "Alt Probe", "is_active": False}])
    drafted = await _add(flow, own, "Probe Entwurf")
    unused = await _add(flow, own, "Probe Nie")
    await _publish(flow, own, ctx["rounds"][0], _places([drafted["id"]]), status="draft")
    listed = (await flow.get(f"{ADMIN}/series/{own}/participants")).json()
    assert listed["profiles"] == [{"id": "p-anna", "name": "Anna Probe"}, {"id": "p-bert", "name": "Bert Probe"}]
    # Wer in einem Ergebnis steht (auch im Entwurf), lässt sich nur zusammenführen, nicht entfernen.
    in_results = {row["id"]: row["in_results"] for row in listed["participants"]}
    assert in_results == {drafted["id"]: True, unused["id"]: False}


# ---------------------------------------------------------------- Zusammenführen
@pytest.mark.asyncio
async def test_merging_two_spellings_moves_all_results_and_drafts_and_recomputes(flow):
    ctx = await _setup(flow)
    own, rounds = ctx["own"]["id"], ctx["rounds"]
    anna = await _add(flow, own, "Probe Anna", default_team="Fremd Rot")
    ana = await _add(flow, own, "Probe Ana", start_number="7")
    bert = await _add(flow, own, "Probe Bert", default_team="Fremd Rot")
    await _publish(flow, own, rounds[0], _places([anna["id"], bert["id"]]))
    second = await _publish(flow, own, rounds[1], [{"participant_id": ana["id"], "place": 1, "official_total": 40},
                                                   {"participant_id": bert["id"], "place": 2}])
    third = await _publish(flow, own, rounds[2], _places([bert["id"], ana["id"]]), status="draft")
    # Der Captain trägt zu R1 eine Korrektur als Entwurf daneben ein - mit der anderen Schreibweise.
    flow.act_as(ctx["captain"])
    await _publish(flow, own, rounds[0], _places([ana["id"], bert["id"]]), status="draft", version=1)
    flow.act_as(ctx["board"])

    response = await flow.post(f"{ADMIN}/series/{own}/participants/{anna['id']}/merge",
                               json={"duplicate_id": ana["id"]})
    assert response.status_code == 200, response.text
    kept = response.json()
    assert (kept["id"], kept["name"], kept["start_number"], kept["default_team"]) == (
        anna["id"], "Probe Anna", "7", "Fremd Rot")
    assert await _person(flow, ana["id"]) is None

    sheets = {row["round_id"]: row
              async for row in flow.db.reference_round_results.find({"series_id": own}, {"_id": 0})}
    assert [row["participant_id"] for row in sheets[rounds[0]]["pending_draft"]["rows"]] == [anna["id"], bert["id"]]
    assert [row["participant_id"] for row in sheets[rounds[1]]["rows"]] == [anna["id"], bert["id"]]
    assert sheets[rounds[1]]["official_totals"] == {anna["id"]: 40}
    assert [row["participant_id"] for row in sheets[rounds[2]]["rows"]] == [bert["id"], anna["id"]]
    # Offene Seiten zum Eintragen laden neu: jede geänderte Seite hat eine neue Version.
    assert (sheets[rounds[1]]["version"], sheets[rounds[2]]["version"]) == (second["version"] + 1, third["version"] + 1)

    drivers = (await _standings_match_a_fresh_recompute(flow, own))[(rounds[1], "drivers")]
    assert [(row["participant_id"], row["computed_points"]) for row in drivers] == [(anna["id"], 40), (bert["id"], 38)]
    log = await flow.db.audit_logs.find_one({"action": "reference_series.participant_merge"}, {"_id": 0})
    assert (log["target_id"], log["data"]["duplicate_id"], log["data"]["duplicate_name"]) == (
        anna["id"], ana["id"], "Probe Ana")
    assert sorted(log["data"]["round_ids"]) == sorted(rounds)

    # Jedes geänderte Blatt hat eine Revision mit dem alten Stand - die alte Kennung bleibt nachvollziehbar.
    revisions = await flow.db.reference_round_result_revisions.find({"reason": "merge"}, {"_id": 0}).to_list(None)
    by_round = {(row["round_id"], row["kind"]): row for row in revisions}
    assert sorted(by_round) == sorted([(rounds[0], "pending_draft"), (rounds[1], "sheet"), (rounds[2], "sheet")])
    old_r2 = by_round[(rounds[1], "sheet")]
    assert [row["participant_id"] for row in old_r2["content"]["rows"]] == [ana["id"], bert["id"]]
    assert (old_r2["version"], old_r2["status"], old_r2["replaced_by"]) == (second["version"], "published",
                                                                            ctx["board"]["id"])
    assert [row["participant_id"] for row in by_round[(rounds[0], "pending_draft")]["content"]["rows"]] == [
        ana["id"], bert["id"]]
    assert sorted(log["data"]["revision_ids"]) == sorted(row["id"] for row in revisions)


@pytest.mark.asyncio
async def test_merging_takes_the_manual_current_team_only_when_the_kept_one_has_none(flow):
    """„Aktuelles Team (von Hand)“ (#1960) wie Startnummer und Team: der Wert des behaltenen bleibt, fehlt er, kommt
    der des anderen."""
    ctx = await _setup(flow)
    own = ctx["own"]["id"]
    people = {}
    for name, team in (("Probe Cora", None), ("Probe Kora", "Fremd Blau"), ("Probe Dora", "Fremd Rot"),
                       ("Probe Tora", "Fremd Blau")):
        people[name] = await _add(flow, own, name)
        if team:
            saved = await flow.patch(f"{ADMIN}/series/{own}/participants/{people[name]['id']}",
                                     json={"current_team": team})
            assert saved.status_code == 200, saved.text
    url = f"{ADMIN}/series/{own}/participants/{{}}/merge"
    taken = await flow.post(url.format(people["Probe Cora"]["id"]), json={"duplicate_id": people["Probe Kora"]["id"]})
    assert taken.status_code == 200, taken.text
    assert taken.json()["current_team"] == "Fremd Blau"
    kept = await flow.post(url.format(people["Probe Dora"]["id"]), json={"duplicate_id": people["Probe Tora"]["id"]})
    assert kept.status_code == 200, kept.text
    assert kept.json()["current_team"] == "Fremd Rot"


@pytest.mark.asyncio
async def test_merging_keeps_the_decision_of_the_duplicate_when_the_kept_one_is_still_open(flow):
    ctx = await _setup(flow)
    own = ctx["own"]["id"]
    open_one = await _add(flow, own, "Probe Offen")
    guest = await _add(flow, own, "Probe-Offen Gast")
    await _assign(flow, own, guest["id"], link="guest")
    kept = (await flow.post(f"{ADMIN}/series/{own}/participants/{open_one['id']}/merge",
                            json={"duplicate_id": guest["id"]})).json()
    assert (kept["link"], kept["link_status"], kept["guest_name"]) == ("guest", "decided", "Probe-Offen Gast")


@pytest.mark.asyncio
async def test_after_merging_extern_takes_back_the_aliases_of_both_names_in_every_season(flow):
    ctx = await _setup(flow)
    own, earlier = ctx["own"]["id"], ctx["earlier"]["id"]
    waiting = await _add(flow, earlier, "Probe Gastname")
    kept = await _add(flow, own, "Probe Offen")
    guest = await _add(flow, own, "Probe Gastname")
    await _assign(flow, own, guest["id"], link="guest")  # Alias „Probe Gastname“, die Vorsaison folgt
    assert (await _person(flow, waiting["id"]))["link"] == "guest"
    merged = await flow.post(f"{ADMIN}/series/{own}/participants/{kept['id']}/merge",
                             json={"duplicate_id": guest["id"]})
    assert merged.status_code == 200, merged.text
    assert merged.json()["link"] == "guest"

    # „Extern“ nimmt jeden Alias des Teilnehmers zurück - auch den der zusammengeführten Schreibweise, überall.
    response = await _assign(flow, own, kept["id"], link="external")
    assert response.status_code == 200, response.text
    assert response.json()["other_series"] == {"updated": [earlier], "pending": []}
    assert await flow.db.reference_aliases.count_documents({}) == 0
    assert (await _person(flow, waiting["id"]))["link"] == "external"
    assert (await _add(flow, ctx["earlier"]["id"], "Probe-Gastname"))["link_status"] == "open"


@pytest.mark.asyncio
async def test_merging_points_the_alias_of_the_other_spelling_to_the_kept_assignment(flow):
    ctx = await _setup(flow)
    await flow.db.club_member_profiles.insert_one({"id": "p-bert", "display_name": "Bert Probe", "is_active": True})
    own, earlier = ctx["own"]["id"], ctx["earlier"]["id"]
    there = await _add(flow, earlier, "Probe Zweitname")
    kept = await _add(flow, own, "Probe Erstname")
    duplicate = await _add(flow, own, "Probe Zweitname")
    await _assign(flow, own, kept["id"], link="guest")
    await _assign(flow, own, duplicate["id"], link="member", profile_id="p-bert")
    assert (await _person(flow, there["id"]))["profile_id"] == "p-bert"

    merged = await flow.post(f"{ADMIN}/series/{own}/participants/{kept['id']}/merge",
                             json={"duplicate_id": duplicate["id"]})
    assert merged.status_code == 200, merged.text
    assert merged.json()["other_series"] == {"updated": [earlier], "pending": []}
    # Beide Schreibweisen meinen jetzt dieselbe Person: die Zuordnung des behaltenen gilt, auch in der Vorsaison.
    alias = await flow.db.reference_aliases.find_one({"name_normalized": "probezweitname"}, {"_id": 0})
    assert (alias["target"], alias["profile_id"]) == ("guest", None)
    moved = await _person(flow, there["id"])
    assert (moved["link"], moved["profile_id"], moved["is_club_member"]) == ("guest", None, False)
    log = await flow.db.audit_logs.find_one({"action": "reference_series.participant_merge"}, {"_id": 0})
    assert log["data"]["aliases"] == [alias["id"]] and log["data"]["also_assigned_in"] == [earlier]

    await _assign(flow, own, kept["id"], link="external")
    assert await flow.db.reference_aliases.count_documents({}) == 0
    assert (await _person(flow, there["id"]))["link"] == "external"


@pytest.mark.asyncio
async def test_extern_after_renaming_takes_back_the_alias_of_the_old_name(flow):
    ctx = await _setup(flow)
    own, earlier = ctx["own"]["id"], ctx["earlier"]["id"]
    there = await _add(flow, earlier, "Probe Altname")
    row = await _add(flow, own, "Probe Altname")
    await _assign(flow, own, row["id"], link="guest")
    assert (await _person(flow, there["id"]))["link"] == "guest"
    renamed = await flow.patch(f"{ADMIN}/series/{own}/participants/{row['id']}", json={"name": "Probe Neuname"})
    assert renamed.status_code == 200, renamed.text
    await _assign(flow, own, row["id"], link="external")
    assert await flow.db.reference_aliases.count_documents({}) == 0
    assert (await _person(flow, there["id"]))["link"] == "external"


@pytest.mark.asyncio
async def test_two_participants_in_one_result_are_never_merged(flow):
    ctx = await _setup(flow)
    own, rounds = ctx["own"]["id"], ctx["rounds"]
    anna = await _add(flow, own, "Probe Anna")
    ana = await _add(flow, own, "Probe Ana")
    await _publish(flow, own, rounds[0], _places([anna["id"]]))
    await _publish(flow, own, rounds[1], _places([anna["id"], ana["id"]]), status="draft")
    before = await flow.db.reference_round_results.find({}, {"_id": 0}).to_list(None)
    response = await flow.post(f"{ADMIN}/series/{own}/participants/{anna['id']}/merge",
                               json={"duplicate_id": ana["id"]})
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "Probe Anna" in detail and "Probe Ana" in detail and "R2" in detail
    assert await _person(flow, ana["id"]) is not None
    assert await flow.db.reference_round_results.find({}, {"_id": 0}).to_list(None) == before
    assert await flow.db.audit_logs.count_documents({"action": "reference_series.participant_merge"}) == 0
    # Mit sich selbst und über Saisons hinweg geht es nie.
    assert (await flow.post(f"{ADMIN}/series/{own}/participants/{anna['id']}/merge",
                            json={"duplicate_id": anna["id"]})).status_code == 422
    foreign = await _add(flow, ctx["earlier"]["id"], "Probe Anna")
    assert (await flow.post(f"{ADMIN}/series/{own}/participants/{anna['id']}/merge",
                            json={"duplicate_id": foreign["id"]})).status_code == 404


# ---------------------------------------------------------------- Entfernen
@pytest.mark.asyncio
async def test_only_participants_without_results_can_be_removed(flow):
    ctx = await _setup(flow)
    own, rounds = ctx["own"]["id"], ctx["rounds"]
    unused = await _add(flow, own, "Probe Nie")
    drafted = await _add(flow, own, "Probe Entwurf")
    await _publish(flow, own, rounds[0], _places([drafted["id"]]), status="draft")
    refused = await flow.delete(f"{ADMIN}/series/{own}/participants/{drafted['id']}")
    assert refused.status_code == 409 and "Zusammenführen" in refused.json()["detail"]
    assert await _person(flow, drafted["id"]) is not None

    removed = await flow.delete(f"{ADMIN}/series/{own}/participants/{unused['id']}")
    assert removed.status_code == 200, removed.text
    assert await _person(flow, unused["id"]) is None
    log = await flow.db.audit_logs.find_one({"action": "reference_series.participant_delete"}, {"_id": 0})
    assert (log["target_id"], log["data"]["name"]) == (unused["id"], "Probe Nie")
    # Teilnehmer einer anderen Saison: 404.
    foreign = await _add(flow, ctx["earlier"]["id"], "Probe Fremd")
    elsewhere = await flow.delete(f"{ADMIN}/series/{own}/participants/{foreign['id']}")
    assert elsewhere.status_code == 404


# ---------------------------------------------------------------- Rechte
@pytest.mark.asyncio
async def test_a_captain_may_not_edit_assign_merge_or_remove_participants(flow):
    ctx = await _setup(flow)
    own = ctx["own"]["id"]
    one = await _add(flow, own, "Probe Eins")
    two = await _add(flow, own, "Probe Zwei")
    for user in (ctx["captain"], await flow.add_user(role="moderator", name="moderation")):
        flow.act_as(user)
        assert (await flow.patch(f"{ADMIN}/series/{own}/participants/{one['id']}",
                                 json={"name": "X Probe"})).status_code == 403
        assert (await flow.post(f"{ADMIN}/series/{own}/participants/bulk-assign",
                                json={"participant_ids": [one["id"]], "link": "external"})).status_code == 403
        assert (await flow.post(f"{ADMIN}/series/{own}/participants/{one['id']}/merge",
                                json={"duplicate_id": two["id"]})).status_code == 403
        removed = await flow.delete(f"{ADMIN}/series/{own}/participants/{two['id']}")
        assert removed.status_code == 403
    assert (await _person(flow, one["id"]))["name"] == "Probe Eins"
    assert await _person(flow, two["id"]) is not None


def test_swapping_a_participant_covers_rows_lineups_official_totals_and_draft_creations():
    from services.series_participants import content_participant_ids, swap_participant
    content = {"rows": [{"participant_id": "alt", "place": 1}, {"participant_id": "b", "place": 2}],
               "matches": [{"home": "A", "lineup": ["alt", "c"]}], "official_totals": {"alt": 12, "b": 9},
               "created_participant_ids": ["alt", "c"], "note": "bleibt"}
    swapped = swap_participant(content, "alt", "neu")
    assert [row["participant_id"] for row in swapped["rows"]] == ["neu", "b"]
    assert swapped["matches"][0]["lineup"] == ["neu", "c"] and swapped["official_totals"] == {"neu": 12, "b": 9}
    assert swapped["created_participant_ids"] == ["c"] and swapped["note"] == "bleibt"
    assert content_participant_ids(swapped) == {"neu", "b", "c"}
    assert content["rows"][0]["participant_id"] == "alt", "das Original bleibt unverändert"
