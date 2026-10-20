"""Ergebnisse externer Serien eintragen (#1744) über die echten Routen: Vorschau ändert nichts, Übernehmen mit Version
(409, auch bei zwei gleichzeitigen), alle schreibenden Vorgänge einer Saison nacheinander unter einer Sperre (Ergebnis
und Kalender; parallele Vorgänge enden stimmig), Revision und Protokoll, Neurechnen mit Streichergebnissen, Entwurf
eines Captains neben dem veröffentlichten Blatt mit Freigabe oder Verwerfen durch den Vorstand, unbekannte Namen als
offene Teilnehmer, Team-Liga mit Tabelle laut Veranstalter. Kennungen fremder Serien antworten 404. Nur erfundene
Namen."""
import asyncio
import pathlib
import sys
from datetime import date, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import reference_participant_routes, reference_result_routes  # noqa: E402
from services import migrations, reference_series  # noqa: E402
from services.dolibarr_policy import club_today  # noqa: E402

ADMIN = "/api/reference-series/admin"
RULES = {"points_by_place": [10, 6, 4], "count_mode": "drop_n", "count_n": 1, "final_top_n": 2,
         "team_scoring": {"enabled": False}}


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


async def _setup(flow, *, kind: str = "racing", scheme: str = "formula_1", rules: dict | None = None,
                 team_name: str | None = None, rounds: int = 3):
    """Vorstand, Spur mit eigener und fremder Saison, Termine in der Vergangenheit, drei Teilnehmer, ein Captain."""
    await migrations.migrate_points_scheme_templates(flow.db)
    board = await flow.add_user(role="user", name="vorstand-vera")
    await flow.db.users.update_one({"id": board["id"]}, {"$set": {"areas": ["content"]}})
    board["areas"] = ["content"]
    flow.act_as(board)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Liga", "kind": kind})).json()
    body = {"lineage_id": lineage["id"], "season": "2026", "points_scheme_id": scheme,
            "rules": RULES if rules is None else rules, "team_name": team_name}
    own = (await flow.post(f"{ADMIN}/series", json=body)).json()
    other = (await flow.post(f"{ADMIN}/series", json={**body, "season": "2027"})).json()
    round_ids = []
    for offset in range(rounds):
        created = await flow.post(f"{ADMIN}/series/{own['id']}/rounds",
                                  json={"day": _day(-30 + offset * 7), "code": f"R{offset + 1}",
                                        "opponent": "Probe Gegner" if kind == "team_league" else None})
        assert created.status_code == 200, created.text
        round_ids.append(created.json()["id"])
    foreign_round = (await flow.post(f"{ADMIN}/series/{other['id']}/rounds", json={"day": _day(-30)})).json()
    people = {}
    for name, number in (("Anna Probe", "7"), ("Bert Bolzt", "12"), ("Carl Kurve", "21")):
        added = await flow.post(f"{ADMIN}/series/{own['id']}/participants", json={"name": name, "start_number": number})
        people[name] = added.json()["id"]
    captain = await flow.add_user(name="captain-carla")
    await flow.db.memberships.insert_one({"user_id": captain["id"], "member_status": "active"})
    staff = await flow.post(f"{ADMIN}/series/{own['id']}/staff", json={"user_id": captain["id"],
                                                                       "valid_until": _day(30)})
    assert staff.status_code == 200, staff.text
    return {"board": board, "captain": captain, "own": own, "other": other, "rounds": round_ids,
            "foreign_round": foreign_round["id"], "people": people}


def _url(ctx, round_index: int = 0, suffix: str = "") -> str:
    return f"{ADMIN}/series/{ctx['own']['id']}/rounds/{ctx['rounds'][round_index]}/results{suffix}"


def _rows(*names_in_order) -> list[dict]:
    return [{"name": name, "place": index} for index, name in enumerate(names_in_order, start=1)]


async def _save(flow, ctx, round_index: int, rows: list[dict], *, version: int = 0, status: str = "published",
                expect: int = 200, **extra):
    answer = await flow.put(_url(ctx, round_index), json={"rows": rows, "status": status,
                                                          "expected_version": version, **extra})
    assert answer.status_code == expect, answer.text
    return answer.json()


async def _standing(flow, ctx, round_index: int, scope: str = "drivers") -> list[dict]:
    doc = await flow.db.reference_standings.find_one({"series_id": ctx["own"]["id"],
                                                      "round_id": ctx["rounds"][round_index], "scope": scope})
    return doc["rows"] if doc else []


async def _counts(flow) -> dict:
    db = flow.db
    return {name: await getattr(db, name).count_documents({}) for name in (
        "reference_round_results", "reference_round_result_revisions", "reference_participants", "reference_standings",
        "audit_logs", "reference_aliases")}


class _Hooked:
    """Datenbank, bei der ``hook`` einmal läuft, unmittelbar bevor ``collection.method`` zum ersten Mal aufgerufen
    wird (``after=False``) oder gleich danach (``after=True``) - so kommt eine andere Anfrage genau zwischen zwei
    Schritte. ``db`` darf selbst ein Wrapper sein (etwa ``InterleavedReads``)."""

    def __init__(self, db, collection: str, method: str, hook, *, after: bool = False):
        self._db, self._collection, self._method, self._hook, self._after = db, collection, method, hook, after
        self.fired = False

    def __getattr__(self, name):
        target = getattr(self._db, name)
        return _HookedCollection(target, self) if name == self._collection else target

    def __getitem__(self, name):
        return self.__getattr__(name)


class _HookedCollection:
    def __init__(self, collection, owner: _Hooked):
        self._collection, self._owner = collection, owner

    def __getattr__(self, name):
        original = getattr(self._collection, name)
        if name != self._owner._method:
            return original

        async def hooked(*args, **kwargs):
            first = not self._owner.fired
            self._owner.fired = True
            if first and not self._owner._after:
                await self._owner._hook()
            result = await original(*args, **kwargs)
            if first and self._owner._after:
                await self._owner._hook()
            return result
        return hooked


# ---------------------------------------------------------------- Vorschau
@pytest.mark.asyncio
async def test_the_preview_changes_nothing_and_shows_table_movement_final_line_and_unknown_names(flow):
    ctx = await _setup(flow)
    await _save(flow, ctx, 0, _rows("Anna Probe", "Bert Bolzt", "Carl Kurve"))
    before = await _counts(flow)
    rounds_before = await flow.db.reference_rounds.find({}, {"_id": 0}).to_list(None)

    answer = await flow.post(_url(ctx, 1, "/preview"), json={"rows": [
        {"name": "carl  kurve", "place": 1}, {"start_number": "12", "place": 2}, {"name": "Neu Nora", "place": 3},
        {"participant_id": ctx["people"]["Anna Probe"], "marks": ["dnf"]}]})
    assert answer.status_code == 200, answer.text
    preview = answer.json()
    assert await _counts(flow) == before
    assert await flow.db.reference_rounds.find({}, {"_id": 0}).to_list(None) == rounds_before

    assert (preview["can_save"], preview["version"], preview["target"], preview["errors"]) == (True, 0, "sheet", [])
    assert [(row["match"], row["name"]) for row in preview["rows"]] == [
        ("name", "Carl Kurve"), ("start_number", "Bert Bolzt"), ("new", "Neu Nora"), ("id", "Anna Probe")]
    assert [row["scored"]["points"] for row in preview["rows"]] == [10, 6, 4, 0]
    assert [(item["name"], item["auto_assigned"]) for item in preview["unknown_names"]] == [("Neu Nora", False)]
    assert preview["unknown_names"][0]["suggestions"] == []
    # Zwischenstand nach Runde 2, als wäre das Blatt veröffentlicht: Carl springt von 3 auf 1.
    drivers = preview["standings"]["scopes"]["drivers"]
    assert [(row["name"], row["rank"], row["points"], row["rank_change"]) for row in drivers] == [
        ("Carl Kurve", 1, 14, 2), ("Bert Bolzt", 2, 12, 0), ("Anna Probe", 3, 10, -2), ("Neu Nora", 4, 4, None)]
    assert drivers[3]["is_new"] is True and drivers[3]["participant_id"] == "neu:neunora"
    assert preview["final"] == {"top_n": 2, "participant_ids": [ctx["people"]["Carl Kurve"],
                                                                ctx["people"]["Bert Bolzt"]],
                                "entered": [ctx["people"]["Carl Kurve"]], "left": [ctx["people"]["Anna Probe"]]}
    assert preview["latest"] is None


@pytest.mark.asyncio
async def test_the_preview_lists_errors_and_warnings_and_saving_refuses_errors(flow):
    ctx = await _setup(flow)
    rows = [{"name": "Anna Probe", "place": 1}, {"participant_id": ctx["people"]["Anna Probe"], "place": 3},
            {"participant_id": "fremd", "place": 4}]
    preview = (await flow.post(_url(ctx, 0, "/preview"), json={"rows": rows})).json()
    assert preview["can_save"] is False and preview["standings"] is None
    assert [item["code"] for item in preview["errors"]] == ["unknown_participant", "duplicate_participant"]
    assert [item["code"] for item in preview["warnings"]] == ["place_gap"]

    before = await _counts(flow)
    refused = await flow.put(_url(ctx, 0), json={"rows": rows, "status": "published", "expected_version": 0})
    assert refused.status_code == 422
    codes = [item["code"] for item in refused.json()["detail"]["errors"]]
    assert codes == ["unknown_participant", "duplicate_participant"]
    assert await _counts(flow) == before


# ---------------------------------------------------------------- Übernehmen
@pytest.mark.asyncio
async def test_saving_writes_revisions_and_the_log_and_recomputes_with_dropped_results(flow):
    ctx = await _setup(flow)
    first = await _save(flow, ctx, 0, _rows("Anna Probe", "Bert Bolzt", "Carl Kurve"))
    assert (first["target"], first["version"], first["recomputed"]) == ("sheet", 1, True)
    assert first["sheet"]["status"] == "published"
    await _save(flow, ctx, 1, _rows("Bert Bolzt", "Anna Probe", "Carl Kurve"))
    await _save(flow, ctx, 2, _rows("Carl Kurve", "Anna Probe", "Bert Bolzt"))

    # Drei Runden, ein Streichergebnis: je das schlechteste fällt weg, bei gleichen Punkten das spätere.
    last = {row["participant_id"]: row for row in await _standing(flow, ctx, 2)}
    anna, bert, carl = (last[ctx["people"][name]] for name in ("Anna Probe", "Bert Bolzt", "Carl Kurve"))
    assert (anna["points"], anna["dropped_round_ids"]) == (16, [ctx["rounds"][2]])
    assert (bert["points"], bert["dropped_round_ids"]) == (16, [ctx["rounds"][2]])
    assert (carl["points"], carl["dropped_round_ids"]) == (14, [ctx["rounds"][1]])
    assert {row["status"] async for row in flow.db.reference_rounds.find({"series_id": ctx["own"]["id"]})} == {"scored"}

    # Korrektur in Runde 1: Version prüfen, alter Stand als Revision, Protokoll, neu gerechnet.
    stale = await flow.put(_url(ctx, 0), json={"rows": _rows("Carl Kurve"), "status": "published",
                                               "expected_version": 0})
    assert stale.status_code == 409
    fixed = await _save(flow, ctx, 0, _rows("Carl Kurve", "Bert Bolzt", "Anna Probe"), version=1)
    assert fixed["version"] == 2
    revision = await flow.db.reference_round_result_revisions.find_one({"result_id": first["sheet"]["id"]})
    assert (revision["kind"], revision["reason"], revision["version"], revision["status"]) == ("sheet", "save", 1,
                                                                                               "published")
    assert [row["participant_id"] for row in revision["content"]["rows"]] == [
        ctx["people"][name] for name in ("Anna Probe", "Bert Bolzt", "Carl Kurve")]
    assert revision["replaced_by"] == ctx["board"]["id"]
    log = await flow.db.audit_logs.find_one({"action": "reference_result.save", "data.version": 2})
    assert (log["target_id"], log["data"]["previous_version"], log["data"]["revision_id"]) == (
        first["sheet"]["id"], 1, revision["id"])
    last = {row["participant_id"]: row["points"] for row in await _standing(flow, ctx, 2)}
    assert last[ctx["people"]["Carl Kurve"]] == 20


@pytest.mark.asyncio
async def test_two_simultaneous_saves_one_wins_the_other_gets_409(flow):
    ctx = await _setup(flow)
    answers = await asyncio.gather(*(flow.put(_url(ctx, 0), json={
        "rows": _rows(*order), "status": "published", "expected_version": 0})
        for order in (("Anna Probe", "Neu Nora"), ("Neu Otto", "Bert Bolzt"))))
    assert sorted(answer.status_code for answer in answers) == [200, 409]
    assert await flow.db.reference_round_results.count_documents({}) == 1
    # Der Verlierer prüft die Version unter der Sperre, bevor er etwas anlegt: nur der neue Name des Gewinners bleibt.
    sheet = await flow.db.reference_round_results.find_one({})
    new = await flow.db.reference_participants.find({"name": {"$in": ["Neu Nora", "Neu Otto"]}}).to_list(None)
    assert len(new) == 1 and new[0]["id"] in [row["participant_id"] for row in sheet["rows"]]

    # Auch zwei Korrekturen auf denselben Stand: eine gewinnt.
    answers = await asyncio.gather(*(flow.put(_url(ctx, 0), json={
        "rows": _rows(*order), "status": "published", "expected_version": 1})
        for order in (("Anna Probe", "Bert Bolzt"), ("Bert Bolzt", "Anna Probe"))))
    assert sorted(answer.status_code for answer in answers) == [200, 409]
    assert (await flow.db.reference_round_results.find_one({}))["version"] == 2
    assert await flow.db.reference_round_result_revisions.count_documents({}) == 1


@pytest.mark.asyncio
async def test_a_second_write_waits_for_the_first_and_round_and_standings_follow_the_last(flow, monkeypatch):
    ctx = await _setup(flow)
    await _save(flow, ctx, 0, _rows("Anna Probe", "Bert Bolzt"))
    written = asyncio.Event()

    async def pause():
        written.set()
        await asyncio.sleep(0.3)

    gate = _Hooked(flow.db, "reference_round_results", "find_one_and_update", pause, after=True)
    monkeypatch.setattr(reference_result_routes, "get_db", lambda: gate)
    first = asyncio.create_task(flow.put(_url(ctx, 0), json={
        "rows": _rows("Anna Probe", "Bert Bolzt"), "status": "draft", "expected_version": 1}))
    await written.wait()
    second = await flow.put(_url(ctx, 0), json={"rows": _rows("Bert Bolzt", "Anna Probe"), "status": "published",
                                                "expected_version": 2})
    first = await first
    assert (first.status_code, second.status_code) == (200, 200), (first.text, second.text)
    assert (first.json()["version"], first.json()["sheet"]["status"]) == (2, "draft")
    # B wartet, bis A ganz fertig ist - erst A, dann B im Protokoll; Termin und Stand folgen B.
    versions = [row["data"]["version"] async for row in flow.db.audit_logs.find({"action": "reference_result.save"})]
    assert versions == [1, 2, 3]
    sheet = await flow.db.reference_round_results.find_one({"round_id": ctx["rounds"][0]})
    assert (sheet["version"], sheet["status"]) == (3, "published")
    assert (await flow.db.reference_rounds.find_one({"id": ctx["rounds"][0]}))["status"] == "scored"
    standing = await _standing(flow, ctx, 0)
    assert standing and standing[0]["participant_id"] == ctx["people"]["Bert Bolzt"]


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["cancel", "archive"])
async def test_cancelling_or_archiving_waits_for_a_result_being_written(flow, monkeypatch, action):
    ctx = await _setup(flow)
    written = asyncio.Event()

    async def pause():
        written.set()
        await asyncio.sleep(0.3)

    gate = _Hooked(flow.db, "reference_round_results", "update_one", pause, after=True)
    monkeypatch.setattr(reference_result_routes, "get_db", lambda: gate)
    saving = asyncio.create_task(flow.put(_url(ctx, 0), json={
        "rows": _rows("Anna Probe", "Bert Bolzt"), "status": "published", "expected_version": 0}))
    await written.wait()
    # Das Ergebnis ist geschrieben, der Termin noch nicht gewertet - Absagen bzw. Archivieren muss warten.
    closing = await flow.post(f"{ADMIN}/series/{ctx['own']['id']}/rounds/{ctx['rounds'][0]}/{action}", json={})
    saved = await saving
    assert saved.status_code == 200, saved.text
    assert closing.status_code == 409 and "gewertet" in closing.json()["detail"]
    round_doc = await flow.db.reference_rounds.find_one({"id": ctx["rounds"][0]})
    assert (round_doc["status"], round_doc.get("archived_at")) == ("scored", None)
    assert (await flow.db.reference_round_results.find_one({}))["status"] == "published"
    assert await _standing(flow, ctx, 0)


@pytest.mark.asyncio
async def test_a_lost_approval_claims_nothing_and_discarding_still_cleans_up(flow, monkeypatch):
    ctx = await _setup(flow)
    await _save(flow, ctx, 0, _rows("Anna Probe", "Bert Bolzt"))
    flow.act_as(ctx["captain"])
    await _save(flow, ctx, 0, _rows("Neu Nora", "Anna Probe"), version=1, status="draft")
    nora = await flow.db.reference_participants.find_one({"name": "Neu Nora"})
    flow.act_as(ctx["board"])

    async def someone_else_writes():
        # Genau vor dem Schreiben der Freigabe ändert sich das Blatt - die Freigabe verliert.
        await flow.db.reference_round_results.update_one({"round_id": ctx["rounds"][0]}, {"$inc": {"version": 1}})

    gate = _Hooked(flow.db, "reference_round_results", "find_one_and_update", someone_else_writes)
    monkeypatch.setattr(reference_result_routes, "get_db", lambda: gate)
    lost = await flow.post(_url(ctx, 0, "/approve"), json={"expected_version": 2})
    assert lost.status_code == 409
    sheet = await flow.db.reference_round_results.find_one({})
    assert (sheet["status"], bool(sheet["pending_draft"]), sheet["version"]) == ("published", True, 3)
    # Nichts ist hängen geblieben: Verwerfen nimmt Nora weiter mit.
    discarded = await flow.post(_url(ctx, 0, "/discard"), json={"expected_version": 3})
    assert discarded.status_code == 200, discarded.text
    assert discarded.json()["removed_participants"] == [nora["id"]]
    assert await flow.db.reference_participants.find_one({"id": nora["id"]}) is None


@pytest.mark.asyncio
async def test_discarding_keeps_a_new_participant_the_board_assigns_between_check_and_delete(flow, monkeypatch):
    ctx = await _setup(flow)
    await _save(flow, ctx, 0, _rows("Anna Probe", "Bert Bolzt"))
    flow.act_as(ctx["captain"])
    await _save(flow, ctx, 0, _rows("Neu Nora", "Anna Probe"), version=1, status="draft")
    nora = await flow.db.reference_participants.find_one({"name": "Neu Nora"})
    flow.act_as(ctx["board"])

    async def assign_meanwhile():
        # Die Zuordnung (#1743) läuft ohne die Sperre der Saison - genau zwischen Prüfen und Löschen.
        await flow.db.reference_participants.update_one({"id": nora["id"]}, {"$set": {
            "link": "guest", "link_status": "decided"}})

    gate = _Hooked(flow.db, "reference_participants", "delete_many", assign_meanwhile)
    monkeypatch.setattr(reference_result_routes, "get_db", lambda: gate)
    discarded = await flow.post(_url(ctx, 0, "/discard"), json={"expected_version": 2})
    assert discarded.status_code == 200, discarded.text
    assert gate.fired and discarded.json()["removed_participants"] == []
    assert await flow.db.reference_participants.find_one({"id": nora["id"]}) is not None


class _SlowWrites:
    """Jedes Schreiben auf ``collection`` wartet danach kurz - so laufen gleichzeitige Anfragen wirklich ineinander
    (mongomock antwortet sonst ohne Pause)."""

    def __init__(self, db, collection: str, seconds: float = 0.02):
        self._db, self._collection, self._seconds = db, collection, seconds

    def __getattr__(self, name):
        target = getattr(self._db, name)
        return _SlowCollection(target, self._seconds) if name == self._collection else target

    def __getitem__(self, name):
        return self.__getattr__(name)


class _SlowCollection:
    WRITES = {"update_one", "update_many", "insert_one", "find_one_and_update", "delete_many"}

    def __init__(self, collection, seconds: float):
        self._collection, self._seconds = collection, seconds

    def __getattr__(self, name):
        original = getattr(self._collection, name)
        if name not in self.WRITES:
            return original

        async def slow(*args, **kwargs):
            result = await original(*args, **kwargs)
            await asyncio.sleep(self._seconds)
            return result
        return slow


@pytest.mark.asyncio
async def test_parallel_results_and_calendar_changes_end_consistent(flow, monkeypatch):
    ctx = await _setup(flow, rounds=4)
    gate = _SlowWrites(flow.db, "reference_round_results")
    monkeypatch.setattr(reference_result_routes, "get_db", lambda: gate)
    sid, rounds = ctx["own"]["id"], ctx["rounds"]
    answers = await asyncio.gather(
        flow.put(_url(ctx, 0), json={"rows": _rows("Anna Probe", "Bert Bolzt"), "status": "published",
                                     "expected_version": 0}),
        flow.put(_url(ctx, 1), json={"rows": _rows("Bert Bolzt", "Carl Kurve"), "status": "published",
                                     "expected_version": 0}),
        flow.post(f"{ADMIN}/series/{sid}/rounds/{rounds[1]}/cancel", json={}),
        flow.put(_url(ctx, 2), json={"rows": _rows("Carl Kurve", "Anna Probe"), "status": "published",
                                     "expected_version": 0}),
        flow.post(f"{ADMIN}/series/{sid}/rounds/{rounds[2]}/postpone", json={"day": _day(-1)}),
        flow.post(f"{ADMIN}/series/{sid}/rounds/{rounds[3]}/archive", json={}),
        flow.put(_url(ctx, 0), json={"rows": _rows("Bert Bolzt", "Anna Probe"), "status": "published",
                                     "expected_version": 1}),
    )
    # Erlaubt sind Erfolg, veralteter Stand, „schon gewertet“ und ein abgesagter Termin (422) - nie ein Serverfehler.
    assert all(answer.status_code in (200, 409, 422) for answer in answers), [a.text for a in answers]
    sheets = {row["round_id"]: row async for row in flow.db.reference_round_results.find({}, {"_id": 0})}
    for round_doc in await flow.db.reference_rounds.find({"series_id": sid}, {"_id": 0}).to_list(None):
        published = (sheets.get(round_doc["id"]) or {}).get("status") == "published"
        # Gewertet genau dann, wenn das Blatt veröffentlicht ist; kein archivierter Termin mit Ergebnis.
        assert (round_doc["status"] == "scored") == published, round_doc
        assert not (published and round_doc.get("archived_at")), round_doc
    # Die gespeicherten Stände sind genau die, die ein frisches Neurechnen ergibt.
    stored = {(row["round_id"], row["scope"]): row["rows"]
              async for row in flow.db.reference_standings.find({"series_id": sid}, {"_id": 0})}
    series = await flow.db.reference_series.find_one({"id": sid}, {"_id": 0})
    await reference_series.recompute_standings(flow.db, series)
    fresh = {(row["round_id"], row["scope"]): row["rows"]
             async for row in flow.db.reference_standings.find({"series_id": sid}, {"_id": 0})}
    assert stored == fresh and stored


async def _standings_match_a_fresh_recompute(flow, series_id: str) -> dict:
    stored = {(row["round_id"], row["scope"]): row["rows"]
              async for row in flow.db.reference_standings.find({"series_id": series_id}, {"_id": 0})}
    series = await flow.db.reference_series.find_one({"id": series_id}, {"_id": 0})
    await reference_series.recompute_standings(flow.db, series)
    fresh = {(row["round_id"], row["scope"]): row["rows"]
             async for row in flow.db.reference_standings.find({"series_id": series_id}, {"_id": 0})}
    assert stored == fresh and stored, series_id
    return stored


@pytest.mark.asyncio
async def test_assigning_in_parallel_to_saving_results_ends_with_consistent_standings(flow, monkeypatch):
    # Teamwertung ohne Gäste: wird Bert zum Gast, ändert das die Stände.
    rules = {**RULES, "team_scoring": {"enabled": True, "counting_drivers": None, "guests_count": False}}
    ctx = await _setup(flow, rules=rules)
    sid, other = ctx["own"]["id"], ctx["other"]["id"]

    def team_rows(*names):
        return [{"name": name, "place": index, "team": "Probe Team"} for index, name in enumerate(names, start=1)]

    await _save(flow, ctx, 0, team_rows("Anna Probe", "Bert Bolzt"))
    # In der anderen Saison steht Bert noch offen - der Alias zieht ihn dort mit (Neurechnen unter ihrer Sperre).
    other_results = f"{ADMIN}/series/{other}/rounds/{ctx['foreign_round']}/results"
    published = await flow.put(other_results, json={
        "rows": team_rows("Bert Bolzt", "Anna Probe"), "status": "published", "expected_version": 0})
    assert published.status_code == 200, published.text
    written = asyncio.Event()

    async def pause():
        # Die Zuordnung hat den ersten Stand geschrieben, ist aber noch nicht fertig.
        written.set()
        await asyncio.sleep(0.3)

    gate = _Hooked(flow.db, "reference_standings", "update_one", pause, after=True)
    monkeypatch.setattr(reference_participant_routes, "get_db", lambda: gate)
    assigning = asyncio.create_task(flow.post(
        f"{ADMIN}/series/{sid}/participants/{ctx['people']['Bert Bolzt']}/assign", json={"link": "guest"}))
    await written.wait()
    saved = await flow.put(_url(ctx, 1), json={"rows": team_rows("Bert Bolzt", "Anna Probe"), "status": "published",
                                               "expected_version": 0})
    assigned = await assigning
    assert (assigned.status_code, saved.status_code) == (200, 200), (assigned.text, saved.text)

    own = await _standings_match_a_fresh_recompute(flow, sid)
    assert (ctx["rounds"][1], "drivers") in own
    elsewhere = await _standings_match_a_fresh_recompute(flow, other)
    bert_there = await flow.db.reference_participants.find_one({"series_id": other, "name": "Bert Bolzt"})
    assert bert_there["link"] == "guest"
    # Als Gast zählt Bert nicht mehr fürs Team - auch in der mitgezogenen Saison.
    assert all(bert_there["id"] not in row["driver_ids"]
               for (_, scope), rows in elsewhere.items() if scope == "teams" for row in rows)


@pytest.mark.asyncio
async def test_unknown_names_become_open_participants_and_a_confirmed_alias_assigns_at_once(flow):
    ctx = await _setup(flow)
    await flow.db.club_member_profiles.insert_one({"id": "p-dora", "display_name": "Dora Probe", "is_active": True})
    await flow.db.reference_aliases.insert_one({"id": "alias-dora", "name_normalized": "dorad", "target": "member",
                                                "profile_id": "p-dora", "game_id": None,
                                                "confirmed_at": "2026-01-02T10:00:00+00:00"})
    rows = [{"name": "Anna Probe", "place": 1}, {"name": "Neu Nora", "place": 2, "start_number": "99",
                                                 "team": "Probe Team"}, {"name": "Dora D", "place": 3}]
    preview = (await flow.post(_url(ctx, 0, "/preview"), json={"rows": rows})).json()
    by_name = {item["name"]: item for item in preview["unknown_names"]}
    assert by_name["Dora D"]["auto_assigned"] is True
    assert by_name["Dora D"]["alias"] == {"target": "member", "profile_id": "p-dora", "label": "Dora Probe"}
    assert [(item["name"], item.get("profile_name")) for item in preview["club_members"]] == [("Dora D", "Dora Probe")]

    saved = await _save(flow, ctx, 0, rows)
    created = {item["name"]: item for item in saved["created_participants"]}
    assert (created["Neu Nora"]["link_status"], created["Dora D"]["link_status"]) == ("open", "decided")
    nora = await flow.db.reference_participants.find_one({"id": created["Neu Nora"]["id"]})
    assert (nora["start_number"], nora["default_team"], nora["series_id"]) == ("99", "Probe Team", ctx["own"]["id"])
    # Im Dialog „Unbekannte Namen“ steht Nora (neben den noch offenen aus der Vorbereitung), Dora nicht.
    unknown = (await flow.get(f"{ADMIN}/series/{ctx['own']['id']}/unknown-names")).json()
    open_names = [item["participant"]["name"] for item in unknown["items"]]
    assert "Neu Nora" in open_names and "Dora D" not in open_names
    log = await flow.db.audit_logs.find_one({"action": "reference_result.save"})
    assert sorted(log["data"]["created_participants"]) == sorted(item["id"] for item in created.values())

    # Beim nächsten Mal erkennt die Saison beide Namen selbst.
    again = (await flow.post(_url(ctx, 1, "/preview"), json={"rows": rows})).json()
    assert [row["match"] for row in again["rows"]] == ["name", "name", "name"] and again["unknown_names"] == []


@pytest.mark.asyncio
async def test_unpublishing_takes_the_round_out_of_the_standings_and_restores_its_status(flow):
    ctx = await _setup(flow)
    await flow.post(f"{ADMIN}/series/{ctx['own']['id']}/rounds/{ctx['rounds'][0]}/postpone", json={"day": _day(-2)})
    saved = await _save(flow, ctx, 0, _rows("Anna Probe", "Bert Bolzt"))
    round_doc = await flow.db.reference_rounds.find_one({"id": ctx["rounds"][0]})
    assert (round_doc["status"], round_doc["scored_from"]) == ("scored", "postponed")
    assert await _standing(flow, ctx, 0)

    withdrawn = await _save(flow, ctx, 0, _rows("Anna Probe", "Bert Bolzt"), version=saved["version"], status="draft")
    assert withdrawn["recomputed"] is True and withdrawn["sheet"]["status"] == "draft"
    assert (await flow.db.reference_rounds.find_one({"id": ctx["rounds"][0]}))["status"] == "postponed"
    assert await _standing(flow, ctx, 0) == []


# ---------------------------------------------------------------- Captain und Freigabe
@pytest.mark.asyncio
async def test_a_captain_change_to_a_published_sheet_waits_beside_it_until_the_board_approves(flow):
    ctx = await _setup(flow)
    await _save(flow, ctx, 0, _rows("Anna Probe", "Bert Bolzt", "Carl Kurve"))
    flow.act_as(ctx["captain"])
    loaded = (await flow.get(_url(ctx, 0))).json()
    assert (loaded["target"], loaded["version"], loaded["access"]["role"]) == ("pending_draft", 1, "captain")
    assert not [key for key in loaded["sheet"] if key.endswith("_by")]
    assert [row["name"] for row in loaded["participants"]] == ["Anna Probe", "Bert Bolzt", "Carl Kurve"]

    refused = await flow.put(_url(ctx, 0), json={"rows": _rows("Bert Bolzt"), "status": "published",
                                                 "expected_version": 1})
    assert refused.status_code == 403
    draft = await _save(flow, ctx, 0, _rows("Bert Bolzt", "Anna Probe", "Carl Kurve"), version=1, status="draft")
    assert (draft["target"], draft["version"], draft["recomputed"]) == ("pending_draft", 2, False)
    sheet = await flow.db.reference_round_results.find_one({})
    # Das veröffentlichte Blatt bleibt sichtbar und zählt weiter; die Änderung steht daneben.
    assert sheet["status"] == "published"
    assert [row["participant_id"] for row in sheet["rows"]][0] == ctx["people"]["Anna Probe"]
    assert [row["participant_id"] for row in sheet["pending_draft"]["rows"]][0] == ctx["people"]["Bert Bolzt"]
    assert (await _standing(flow, ctx, 0))[0]["participant_id"] == ctx["people"]["Anna Probe"]
    log = await flow.db.audit_logs.find_one({"action": "reference_result.pending_draft"})
    assert log["data"]["role"] == "captain"
    assert (await flow.post(_url(ctx, 0, "/approve"), json={"expected_version": 2})).status_code == 403
    assert (await flow.post(_url(ctx, 0, "/discard"), json={"expected_version": 2})).status_code == 403

    flow.act_as(ctx["board"])
    assert (await flow.post(_url(ctx, 0, "/approve"), json={"expected_version": 1})).status_code == 409
    approved = await flow.post(_url(ctx, 0, "/approve"), json={"expected_version": 2})
    assert approved.status_code == 200, approved.text
    sheet = approved.json()["sheet"]
    assert (sheet["status"], sheet["pending_draft"], sheet["version"]) == ("published", None, 3)
    assert sheet["drafted_by"] == ctx["captain"]["id"]
    assert (await _standing(flow, ctx, 0))[0]["participant_id"] == ctx["people"]["Bert Bolzt"]
    revision = await flow.db.reference_round_result_revisions.find_one({"reason": "approve"})
    assert (revision["version"], revision["content"]["rows"][0]["participant_id"]) == (2, ctx["people"]["Anna Probe"])
    log = await flow.db.audit_logs.find_one({"action": "reference_result.approve"})
    assert (log["data"]["from"], log["data"]["drafted_by"]) == ("pending_draft", ctx["captain"]["id"])
    nothing = await flow.post(_url(ctx, 0, "/approve"), json={"expected_version": 3})
    assert nothing.status_code == 409


@pytest.mark.asyncio
async def test_the_board_discards_a_draft_beside_and_approves_a_captains_draft_sheet(flow):
    ctx = await _setup(flow)
    await _save(flow, ctx, 0, _rows("Anna Probe", "Bert Bolzt"))
    flow.act_as(ctx["captain"])
    await _save(flow, ctx, 0, _rows("Bert Bolzt", "Anna Probe"), version=1, status="draft")
    # Ein neuer Entwurf ersetzt den alten - der alte bleibt als Revision.
    await _save(flow, ctx, 0, _rows("Bert Bolzt", "Carl Kurve", "Anna Probe"), version=2, status="draft")
    assert (await flow.db.reference_round_result_revisions.find_one({"reason": "replace"}))["kind"] == "pending_draft"

    flow.act_as(ctx["board"])
    discarded = await flow.post(_url(ctx, 0, "/discard"), json={"expected_version": 3})
    assert discarded.status_code == 200, discarded.text
    sheet = discarded.json()["sheet"]
    assert sheet["pending_draft"] is None and sheet["rows"][0]["participant_id"] == ctx["people"]["Anna Probe"]
    revision = await flow.db.reference_round_result_revisions.find_one({"reason": "discard"})
    assert len(revision["content"]["rows"]) == 3 and revision["author_id"] == ctx["captain"]["id"]
    assert (await flow.post(_url(ctx, 0, "/discard"), json={"expected_version": 4})).status_code == 409

    # Ein Blatt, das ein Captain als Entwurf anlegt, zählt erst nach der Freigabe.
    flow.act_as(ctx["captain"])
    first = await _save(flow, ctx, 1, _rows("Carl Kurve", "Anna Probe"), status="draft")
    assert (first["target"], first["sheet"]["status"]) == ("sheet", "draft")
    assert await _standing(flow, ctx, 1) == []
    flow.act_as(ctx["board"])
    approved = await flow.post(_url(ctx, 1, "/approve"), json={"expected_version": 1})
    assert approved.status_code == 200, approved.text
    assert (await _standing(flow, ctx, 1))[0]["participant_id"] == ctx["people"]["Anna Probe"]
    assert (await flow.db.reference_rounds.find_one({"id": ctx["rounds"][1]}))["status"] == "scored"


@pytest.mark.asyncio
async def test_discarding_a_draft_removes_the_people_only_this_draft_created(flow):
    ctx = await _setup(flow)
    await flow.db.club_member_profiles.insert_one({"id": "p-dora", "display_name": "Dora Probe", "is_active": True})
    await flow.db.reference_aliases.insert_one({"id": "alias-dora", "name_normalized": "dorad", "target": "member",
                                                "profile_id": "p-dora", "game_id": None,
                                                "confirmed_at": "2026-01-02T10:00:00+00:00"})
    await _save(flow, ctx, 0, _rows("Anna Probe", "Bert Bolzt"))
    await _save(flow, ctx, 1, _rows("Anna Probe", "Schon Da"))
    flow.act_as(ctx["captain"])
    await _save(flow, ctx, 0, _rows("Neu Nora", "Neu Otto", "Neu Paul", "Schon Da"), version=1, status="draft")
    # Der zweite Entwurf ersetzt den ersten: Nora steht schon in der Saison, Otto fällt weg, Quinn und Dora kommen dazu.
    await _save(flow, ctx, 0, _rows("Neu Nora", "Neu Quinn", "Neu Paul", "Dora D"), version=2, status="draft")
    people = {row["name"]: row async for row in flow.db.reference_participants.find({}, {"_id": 0})}
    assert people["Dora D"]["link_status"] == "decided"

    flow.act_as(ctx["board"])
    # Paul steht inzwischen auch in einem anderen Blatt, Quinn hat der Vorstand zugeordnet - beide bleiben.
    await _save(flow, ctx, 2, _rows("Neu Paul"), status="draft")
    assigned = await flow.post(f"{ADMIN}/series/{ctx['own']['id']}/participants/{people['Neu Quinn']['id']}/assign",
                               json={"link": "guest"})
    assert assigned.status_code == 200, assigned.text
    discarded = await flow.post(_url(ctx, 0, "/discard"), json={"expected_version": 3})
    assert discarded.status_code == 200, discarded.text

    left = {row["name"] async for row in flow.db.reference_participants.find({}, {"_id": 0})}
    assert left == {"Anna Probe", "Bert Bolzt", "Carl Kurve", "Schon Da", "Neu Paul", "Neu Quinn", "Dora D"}
    log = await flow.db.audit_logs.find_one({"action": "reference_result.discard"})
    assert sorted(item["name"] for item in log["data"]["removed_participants"]) == ["Neu Nora", "Neu Otto"]
    # Ein Entwurf, der niemanden neu angelegt hat, entfernt beim Verwerfen auch niemanden.
    flow.act_as(ctx["captain"])
    await _save(flow, ctx, 0, _rows("Bert Bolzt", "Anna Probe"), version=4, status="draft")
    flow.act_as(ctx["board"])
    assert (await flow.post(_url(ctx, 0, "/discard"), json={"expected_version": 5})).status_code == 200
    assert await flow.db.reference_participants.count_documents({}) == len(left)


@pytest.mark.asyncio
async def test_approving_removes_people_left_over_from_replaced_drafts(flow):
    ctx = await _setup(flow)
    await _save(flow, ctx, 0, _rows("Anna Probe", "Bert Bolzt"))
    await _save(flow, ctx, 1, _rows("Anna Probe"), status="draft")
    flow.act_as(ctx["captain"])
    await _save(flow, ctx, 0, _rows("Neu Otto", "Neu Paul", "Neu Nora"), version=1, status="draft")
    # Der zweite Entwurf ersetzt den ersten: Otto und Paul fallen weg, Nora bleibt, Quinn kommt dazu.
    await _save(flow, ctx, 0, _rows("Neu Nora", "Neu Quinn", "Anna Probe"), version=2, status="draft")
    flow.act_as(ctx["board"])
    # Paul steht inzwischen in einem anderen Blatt und bleibt deshalb.
    paul = await flow.db.reference_participants.find_one({"name": "Neu Paul"})
    await _save(flow, ctx, 1, [{"participant_id": paul["id"], "place": 1}], version=1, status="draft")

    approved = await flow.post(_url(ctx, 0, "/approve"), json={"expected_version": 3})
    assert approved.status_code == 200, approved.text
    left = {row["name"] async for row in flow.db.reference_participants.find({}, {"_id": 0})}
    assert left == {"Anna Probe", "Bert Bolzt", "Carl Kurve", "Neu Nora", "Neu Quinn", "Neu Paul"}
    log = await flow.db.audit_logs.find_one({"action": "reference_result.approve"})
    assert [item["name"] for item in log["data"]["removed_participants"]] == ["Neu Otto"]
    assert approved.json()["removed_participants"] == [item["id"] for item in log["data"]["removed_participants"]]
    assert "created_participant_ids" not in approved.json()["sheet"]


@pytest.mark.asyncio
async def test_a_captain_of_a_direct_series_publishes_and_sees_no_alias_details(flow):
    ctx = await _setup(flow)
    await flow.patch(f"{ADMIN}/series/{ctx['own']['id']}", json={"publish_mode": "direct"})
    # Anna ist als Mitglied zugeordnet, „Dora D“ erkennt ein bestätigter Alias - beides sieht nur die Verwaltung.
    await flow.db.club_member_profiles.insert_many([
        {"id": "p-anna", "display_name": "Anna Profil", "is_active": True},
        {"id": "p-dora", "display_name": "Dora Profil", "is_active": True}])
    await flow.db.reference_aliases.insert_one({"id": "alias-dora", "name_normalized": "dorad", "target": "member",
                                                "profile_id": "p-dora", "game_id": None,
                                                "confirmed_at": "2026-01-02T10:00:00+00:00"})
    assigned = await flow.post(f"{ADMIN}/series/{ctx['own']['id']}/participants/{ctx['people']['Anna Probe']}/assign",
                               json={"link": "member", "profile_id": "p-anna"})
    assert assigned.status_code == 200, assigned.text
    rows = _rows("Anna Probe", "Neu Nora", "Dora D")
    board_view = (await flow.post(_url(ctx, 0, "/preview"), json={"rows": rows})).json()
    assert [item["name"] for item in board_view["club_members"]] == ["Anna Probe", "Dora D"]

    flow.act_as(ctx["captain"])
    preview = (await flow.post(_url(ctx, 0, "/preview"), json={"rows": rows})).json()
    assert preview["access"]["can_publish"] is True
    # Nur bekannt oder unbekannt: keine Zuordnung, kein Alias, keine Vereinsmitglieder.
    assert [set(item) for item in preview["unknown_names"]] == [
        {"participant_id", "name", "start_number", "team", "rows", "matches"}] * 2
    assert [row["match"] for row in preview["rows"]] == ["name", "new", "new"]
    assert "club_members" not in preview
    assert not [row for row in preview["rows"] if "is_club_member" in row]
    assert not [row for row in preview["standings"]["scopes"]["drivers"] if "is_club_member" in row]
    for secret in ("p-anna", "p-dora", "Anna Profil", "Dora Profil", "alias-dora"):
        assert secret not in str(preview)
    loaded = (await flow.get(_url(ctx))).json()
    assert {key for row in loaded["participants"] for key in row} == {"id", "name", "start_number", "default_team",
                                                                      "kind"}
    saved = await _save(flow, ctx, 0, _rows("Anna Probe", "Neu Nora"))
    assert [set(item) for item in saved["created_participants"]] == [{"id", "name"}]
    assert (saved["target"], saved["sheet"]["status"]) == ("sheet", "published")
    assert "created_by" not in saved["sheet"] and "updated_by" not in saved["sheet"]


# ---------------------------------------------------------------- Fremde Kennungen
@pytest.mark.asyncio
async def test_round_ids_of_another_series_answer_404_and_other_series_stay_closed(flow):
    ctx = await _setup(flow)
    foreign = f"{ADMIN}/series/{ctx['own']['id']}/rounds/{ctx['foreign_round']}/results"
    body = {"rows": _rows("Anna Probe"), "status": "draft", "expected_version": 0}
    for person in ("board", "captain"):
        flow.act_as(ctx[person])
        assert (await flow.get(foreign)).status_code == 404
        assert (await flow.post(f"{foreign}/preview", json=body)).status_code == 404
        assert (await flow.put(foreign, json=body)).status_code == 404
    flow.act_as(ctx["board"])
    assert (await flow.post(f"{foreign}/approve", json={"expected_version": 0})).status_code == 404
    assert (await flow.post(f"{foreign}/discard", json={"expected_version": 0})).status_code == 404
    assert (await flow.get(f"{ADMIN}/series/gibt-es-nicht/rounds/{ctx['rounds'][0]}/results")).status_code == 404
    flow.act_as(ctx["captain"])
    other = f"{ADMIN}/series/{ctx['other']['id']}/rounds/{ctx['foreign_round']}/results"
    assert (await flow.put(other, json=body)).status_code == 403
    flow.act_as(None)
    assert (await flow.get(_url(ctx))).status_code == 401
    assert await flow.db.reference_round_results.count_documents({}) == 0


# ---------------------------------------------------------------- Team-Liga
@pytest.mark.asyncio
async def test_team_league_own_match_and_the_official_table_with_deviation(flow):
    ctx = await _setup(flow, kind="team_league", scheme="team_league_3_1_0", rules={}, team_name="Probe Löwen",
                       rounds=2)
    body = {
        "matches": [{"home": "Probe Löwen", "away": "Probe Gegner", "home_score": 2, "away_score": 1,
                     "maps": [{"name": "Map A", "home_score": 13, "away_score": 7},
                              {"name": "Map B", "home_score": 9, "away_score": 13},
                              {"name": "Map C", "home_score": 13, "away_score": 11}],
                     "lineup": [{"name": "Anna Probe"}, {"name": "Neu Nora"}]}],
        "official_table": [{"team": "Probe Löwen", "rank": 1, "played": 1, "won": 1, "points": 4},
                           {"team": "Probe Gegner", "rank": 2, "played": 1, "lost": 1, "points": 0}],
    }
    loaded = (await flow.get(_url(ctx))).json()
    assert (loaded["series"]["kind"], loaded["series"]["team_name"], loaded["round"]["opponent"]) == (
        "team_league", "Probe Löwen", "Probe Gegner")
    preview = (await flow.post(_url(ctx, 0, "/preview"), json=body)).json()
    assert preview["errors"] == []
    table = preview["standings"]["scopes"]["table"]
    assert [(row["team"], row["rank"], row["points"], row["computed_points"], row["deviation"]) for row in table] == [
        ("Probe Löwen", 1, 4, 3, 1), ("Probe Gegner", 2, 0, 0, None)]
    assert [item["code"] for item in preview["warnings"]] == ["official_differs"]
    assert [item["name"] for item in preview["unknown_names"]] == ["Neu Nora"]

    saved = await flow.put(_url(ctx), json={**body, "status": "published", "expected_version": 0})
    assert saved.status_code == 200, saved.text
    lineup = saved.json()["sheet"]["matches"][0]["lineup"]
    nora = await flow.db.reference_participants.find_one({"name": "Neu Nora"})
    assert lineup == [ctx["people"]["Anna Probe"], nora["id"]]
    stored = await _standing(flow, ctx, 0, "table")
    assert [(row["team"], row["points"], row["deviation"]) for row in stored] == [
        ("Probe Löwen", 4, 1), ("Probe Gegner", 0, None)]
