"""Aufbewahrung der Nachweise (#2360, Entscheidungen Nr. 31 und 136) - mit Zeitreise. Erfundene Namen.

Der Aufräum-Job (``match_proof_retention.purge``) bekommt die Uhrzeit gereicht: Liga-Staffeln behalten Nachweise bis Season-Ende plus
``evidence_keep_days``, länger bei offenem Vorfall oder Verfahren; MOSS geht, sobald das Verfahren beendet und die
Einspruchsfrist vorbei ist; Turniere ohne Liga bleiben bei 30 Tagen ab dem Hochladen.
"""
import pathlib
import sys
from datetime import timedelta
from zoneinfo import ZoneInfo

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import world as league_world  # noqa: E402
from match_proof_world import add_image, add_link, protest, season, set_match, user  # noqa: E402
from models import now_utc  # noqa: E402
from services import match_proof_retention, match_proofs  # noqa: E402
from services.league_service import week_days  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setattr(match_proofs, "PROOF_DIR", tmp_path / "proofs")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def left(flow) -> set[str]:
    return {row["id"] for row in await flow.db.match_proof_photos.find({}, {"_id": 0, "id": 1}).to_list(100)}


@pytest.mark.asyncio
async def test_league_proofs_stay_until_season_end_plus_the_season_setting(flow):
    w = await league_world(flow)
    match = w["match"]
    doc = await season(flow, w)
    end = match_proof_retention.season_end(doc)
    # Ende des letzten Tages der letzten Spielwoche: Mitternacht (Wien) nach dem letzten Kalendertag, in etwa einer Woche.
    assert end is not None and timedelta(days=6) < end - now_utc() < timedelta(days=9)
    local = end.astimezone(ZoneInfo("Europe/Vienna"))
    assert (local.hour, local.minute) == (0, 0) and local.date() == week_days(doc)[-1][1] + timedelta(days=1)
    flow.act_as(user(w, "Kapitaen"))
    link = (await add_link(flow, match)).json()
    image = (await add_image(flow, match)).json()
    # Altbestand einer Staffel: gilt ab jetzt dieselbe Regel.
    await flow.db.match_proof_photos.insert_one({"id": "alt-1", "match_id": match["id"], "tournament_id": w["tournament"]["id"],
                                                 "owner_id": user(w, "Kapitaen")["id"], "status": "attached", "context": {"kind": "report"},
                                                 "created_at": now_utc().isoformat()})
    everything = {link["id"], image["id"], "alt-1"}

    # Früher war nach 30 Tagen ab dem Hochladen Schluss - die Season endet aber erst in einer Woche.
    assert await match_proof_retention.purge(flow.db, now=now_utc() + timedelta(days=31)) == 0
    assert await match_proof_retention.purge(flow.db, now=end + timedelta(days=30) - timedelta(hours=1)) == 0
    assert await left(flow) == everything

    # Offenes Verfahren: bleibt über die Frist hinaus - und nach der Entscheidung noch die Einspruchsfrist (48 h).
    decided = end + timedelta(days=40)
    await set_match(flow, w, disputes=[protest(w)])
    assert await match_proof_retention.purge(flow.db, now=end + timedelta(days=45)) == 0
    await set_match(flow, w, disputes=[protest(w, resolved_at=decided.isoformat())])
    assert await match_proof_retention.purge(flow.db, now=decided + timedelta(hours=47)) == 0
    # Auch ein offener Vorfall hält die Nachweise.
    await set_match(flow, w, incidents=[{"id": "vorfall-1", "state": "in_review"}])
    assert await match_proof_retention.purge(flow.db, now=decided + timedelta(hours=49)) == 0
    await set_match(flow, w, incidents=[{"id": "vorfall-1", "state": "decided"}])
    assert await match_proof_retention.purge(flow.db, now=decided + timedelta(hours=49)) == 3
    assert await left(flow) == set()
    assert not any(match_proofs.PROOF_DIR.iterdir()), "auch die Datei ist weg"


@pytest.mark.asyncio
async def test_old_problem_reports_of_a_staffel_hold_their_photo_too(flow):
    """Altbestand: ein offenes „Problem melden“ (Eintrag ohne ``id``, Spiel ``disputed``) hält die Nachweise wie ein Verfahren."""
    w = await league_world(flow)
    doc = await season(flow, w)
    end = match_proof_retention.season_end(doc)
    flow.act_as(user(w, "Kapitaen"))
    await add_link(flow, w["match"])
    old = {"user_id": user(w, "Falke1")["id"], "reason": "Stand war 2:1", "category": "wrong_result", "at": now_utc().isoformat()}
    # Schon der Stand „in Klärung“ hält, auch wenn am Spiel kein Eintrag (mehr) steht.
    await set_match(flow, w, status="disputed", disputes=[])
    assert await match_proof_retention.purge(flow.db, now=end + timedelta(days=90)) == 0
    await set_match(flow, w, status="disputed", disputes=[old])
    assert await match_proof_retention.purge(flow.db, now=end + timedelta(days=90)) == 0
    resolved = end + timedelta(days=91)
    await set_match(flow, w, status="completed", disputes=[{**old, "resolved_at": resolved.isoformat(), "decision": "keep"}])
    assert await match_proof_retention.purge(flow.db, now=resolved + timedelta(hours=47)) == 0
    assert await match_proof_retention.purge(flow.db, now=resolved + timedelta(hours=49)) == 1


@pytest.mark.asyncio
async def test_keep_days_come_from_staffel_then_season_then_the_default(flow):
    w = await league_world(flow)
    doc = await season(flow, w, evidence_keep_days=5)
    end = match_proof_retention.season_end(doc)
    flow.act_as(user(w, "Kapitaen"))
    await add_link(flow, w["match"])
    assert await match_proof_retention.purge(flow.db, now=end + timedelta(days=4)) == 0
    assert await match_proof_retention.purge(flow.db, now=end + timedelta(days=5, hours=1)) == 1, "fünf Tage der Season, nicht die Vorgabe 30"
    await add_link(flow, w["match"])
    # Die Staffel trägt die geltenden Werte: Ihr Wert geht vor.
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"evidence_keep_days": 12}})
    assert await match_proof_retention.purge(flow.db, now=end + timedelta(days=11)) == 0
    assert await match_proof_retention.purge(flow.db, now=end + timedelta(days=12, hours=1)) == 1

    # „Season-Ende“ ist der Abschluss durch die Leitung, sobald es ihn gibt (F.1).
    await add_link(flow, w["match"])
    closed = now_utc() + timedelta(days=60)
    await flow.db.league_seasons.update_one({"id": w["season_id"]}, {"$set": {"closed_at": closed.isoformat()}})
    assert await match_proof_retention.purge(flow.db, now=closed + timedelta(days=11)) == 0
    assert await match_proof_retention.purge(flow.db, now=closed + timedelta(days=13)) == 1


@pytest.mark.asyncio
async def test_a_staffel_without_a_season_calendar_falls_back_to_thirty_days(flow):
    """Lässt sich das Season-Ende nicht bestimmen (Season fehlt), bleibt es bei 30 Tagen ab dem Hochladen - mit der Sperre."""
    w = await league_world(flow)
    flow.act_as(user(w, "Kapitaen"))
    await add_link(flow, w["match"])
    assert await match_proof_retention.purge(flow.db, now=now_utc() + timedelta(days=29)) == 0
    await set_match(flow, w, disputes=[protest(w)])
    assert await match_proof_retention.purge(flow.db, now=now_utc() + timedelta(days=31)) == 0
    await set_match(flow, w, disputes=[])
    assert await match_proof_retention.purge(flow.db, now=now_utc() + timedelta(days=31)) == 1


@pytest.mark.asyncio
async def test_moss_goes_after_the_procedure_plus_the_appeal_window(flow):
    w = await league_world(flow)
    match = w["match"]
    await season(flow, w)
    await set_match(flow, w, disputes=[protest(w)])
    flow.act_as(user(w, "Mila"))
    moss = (await add_image(flow, match, "moss", "verfahren-1")).json()
    moss_file = match_proofs.PROOF_DIR / (await flow.db.match_proof_photos.find_one({"id": moss["id"]}, {"_id": 0}))["storage_key"]
    assert moss_file.is_file()
    flow.act_as(user(w, "Falke1"))
    evidence = (await add_link(flow, match, "protest", "verfahren-1")).json()
    start = now_utc()

    # Offenes Verfahren: MOSS bleibt, auch lange.
    assert await match_proof_retention.purge(flow.db, now=start + timedelta(days=3)) == 0
    decided = start + timedelta(hours=10)
    await set_match(flow, w, disputes=[protest(w, resolved_at=decided.isoformat())])
    assert await match_proof_retention.purge(flow.db, now=decided + timedelta(hours=47)) == 0
    # Ein Einspruch gegen die Entscheidung hält MOSS weiter - bis er entschieden ist, plus Einspruchsfrist.
    appeal = {"id": "einspruch-1", "kind": "appeal", "against": {"type": "protest_decision", "ref_id": "verfahren-1"},
              "registration_id": w["reg_a"]["id"], "at": decided.isoformat()}
    await set_match(flow, w, disputes=[protest(w, resolved_at=decided.isoformat()), appeal])
    assert await match_proof_retention.purge(flow.db, now=decided + timedelta(days=20)) == 0
    final = decided + timedelta(days=2)
    await set_match(flow, w, disputes=[protest(w, resolved_at=decided.isoformat()), {**appeal, "resolved_at": final.isoformat()}])
    assert await match_proof_retention.purge(flow.db, now=final + timedelta(hours=47)) == 0
    # Mitten in der Season: MOSS ist weg, der übrige Nachweis bleibt bis Season-Ende plus Frist.
    assert await match_proof_retention.purge(flow.db, now=final + timedelta(hours=49)) == 1
    assert await left(flow) == {evidence["id"]}
    assert not moss_file.exists(), "auch die Datei ist weg"


@pytest.mark.asyncio
async def test_moss_respects_a_stored_appeal_deadline_and_the_season_setting(flow):
    """Die Einspruchsfrist ruht in Sperrzeiten - gespeichert zählt ``appeal_until``, sonst ``appeal_hours`` der Season."""
    w = await league_world(flow)
    match = w["match"]
    await season(flow, w, appeal_hours=12)
    decided = now_utc() + timedelta(hours=1)
    await set_match(flow, w, disputes=[protest(w), protest(w, id="verfahren-2")])
    flow.act_as(user(w, "Mila"))
    first = (await add_image(flow, match, "moss", "verfahren-1")).json()
    second = (await add_image(flow, match, "moss", "verfahren-2")).json()
    until = decided + timedelta(days=9)
    await set_match(flow, w, disputes=[protest(w, resolved_at=decided.isoformat()),
                                       protest(w, id="verfahren-2", resolved_at=decided.isoformat(), appeal_until=until.isoformat())])
    assert await match_proof_retention.purge(flow.db, now=decided + timedelta(hours=11)) == 0
    # Zwölf Stunden der Season (nicht die Vorgabe 48) - beim zweiten Verfahren geht die gespeicherte Frist vor.
    assert await match_proof_retention.purge(flow.db, now=decided + timedelta(hours=13)) == 1
    assert await left(flow) == {second["id"]} and first["id"] != second["id"]
    assert await match_proof_retention.purge(flow.db, now=until - timedelta(minutes=1)) == 0
    assert await match_proof_retention.purge(flow.db, now=until + timedelta(minutes=1)) == 1


@pytest.mark.asyncio
async def test_a_removed_moss_proof_is_deleted_by_the_retention_like_any_moss(flow):
    """Von der Seite entfernt heißt nur verborgen: Endgültig löscht erst der Job - nach Verfahrensende plus Einspruchsfrist."""
    w = await league_world(flow)
    match = w["match"]
    await season(flow, w)
    await set_match(flow, w, disputes=[protest(w)])
    flow.act_as(user(w, "Mila"))
    moss = (await add_image(flow, match, "moss", "verfahren-1")).json()
    saved = match_proofs.PROOF_DIR / (await flow.db.match_proof_photos.find_one({"id": moss["id"]}, {"_id": 0}))["storage_key"]
    removed = await flow.delete(f"/api/matches/{match['id']}/proofs/{moss['id']}")
    assert removed.status_code == 200, removed.text
    assert await match_proof_retention.purge(flow.db, now=now_utc() + timedelta(days=20)) == 0, "offenes Verfahren"
    decided = now_utc() + timedelta(hours=2)
    await set_match(flow, w, disputes=[protest(w, resolved_at=decided.isoformat())])
    assert await match_proof_retention.purge(flow.db, now=decided + timedelta(hours=47)) == 0
    assert saved.is_file()
    assert await match_proof_retention.purge(flow.db, now=decided + timedelta(hours=49)) == 1
    assert await left(flow) == set() and not saved.exists()


@pytest.mark.asyncio
async def test_moss_on_an_incident_goes_after_the_incident_or_its_procedure(flow):
    """MOSS am Vorfall: bis zum Ende des Vorfalls bzw. eines daraus folgenden Verfahrens plus Einspruchsfrist (M4)."""
    w = await league_world(flow)
    match = w["match"]
    await season(flow, w)
    crash = {"id": "vorfall-1", "position": 1, "kind": "moss_crash", "state": "in_review",
             "reported_by": {"registration_id": w["reg_a"]["id"]}}
    other = {**crash, "id": "vorfall-2"}
    await set_match(flow, w, incidents=[crash, other])
    flow.act_as(user(w, "Mila"))
    first = (await add_image(flow, match, "moss", "vorfall-1")).json()
    second = (await add_image(flow, match, "moss", "vorfall-2")).json()
    assert await match_proof_retention.purge(flow.db, now=now_utc() + timedelta(days=10)) == 0, "offene Vorfälle"

    closed = now_utc() + timedelta(hours=1)
    done = {"state": "decided", "closed_at": closed.isoformat()}
    # Aus dem ersten Vorfall folgt ein Protest - sein MOSS bleibt, der des zweiten geht nach der Einspruchsfrist.
    await set_match(flow, w, incidents=[{**crash, **done}, {**other, **done}], disputes=[protest(w, incident_id="vorfall-1")])
    assert await match_proof_retention.purge(flow.db, now=closed + timedelta(hours=47)) == 0
    assert await match_proof_retention.purge(flow.db, now=closed + timedelta(hours=49)) == 1
    assert await left(flow) == {first["id"]} and first["id"] != second["id"]
    assert await match_proof_retention.purge(flow.db, now=closed + timedelta(days=30)) == 0, "das Verfahren läuft noch"
    decided = closed + timedelta(days=31)
    await set_match(flow, w, disputes=[protest(w, incident_id="vorfall-1", resolved_at=decided.isoformat())])
    assert await match_proof_retention.purge(flow.db, now=decided + timedelta(hours=47)) == 0
    assert await match_proof_retention.purge(flow.db, now=decided + timedelta(hours=49)) == 1


@pytest.mark.asyncio
async def test_moss_on_an_incident_without_an_end_time_counts_from_upload(flow):
    w = await league_world(flow)
    await season(flow, w)
    crash = {"id": "vorfall-1", "kind": "moss_crash", "state": "proposed"}
    await set_match(flow, w, incidents=[crash])
    flow.act_as(user(w, "Mila"))
    await add_image(flow, w["match"], "moss", "vorfall-1")
    await set_match(flow, w, incidents=[{**crash, "state": "withdrawn"}])
    assert await match_proof_retention.purge(flow.db, now=now_utc() + timedelta(hours=47)) == 0
    assert await match_proof_retention.purge(flow.db, now=now_utc() + timedelta(hours=49)) == 1


@pytest.mark.asyncio
async def test_moss_without_its_procedure_goes_after_the_appeal_hours_from_upload(flow):
    w = await league_world(flow)
    await season(flow, w)
    await set_match(flow, w, disputes=[protest(w)])
    flow.act_as(user(w, "Mila"))
    await add_image(flow, w["match"], "moss", "verfahren-1")
    await set_match(flow, w, disputes=[])
    assert await match_proof_retention.purge(flow.db, now=now_utc() + timedelta(hours=47)) == 0
    assert await match_proof_retention.purge(flow.db, now=now_utc() + timedelta(hours=49)) == 1


@pytest.mark.asyncio
async def test_held_proofs_do_not_hide_later_ones_from_the_job(flow, monkeypatch):
    """Der Job liest in Seiten ohne feste Obergrenze: Hinter vielen gehaltenen Nachweisen bleibt nichts ungeprüft (Review, N2)."""
    monkeypatch.setattr(match_proof_retention, "PAGE", 2)
    w = await league_world(flow)
    doc = await season(flow, w)
    late = match_proof_retention.season_end(doc) + timedelta(days=400)
    done = {"id": "spiel-fertig", "tournament_id": w["tournament"]["id"], "status": "completed", "slots": []}
    await flow.db.matches_v2.insert_one(dict(done))
    await set_match(flow, w, disputes=[protest(w)])

    def proof(proof_id: str, match_id: str, tournament_id: str, **extra) -> dict:
        return {"id": proof_id, "match_id": match_id, "tournament_id": tournament_id, "owner_id": "jemand", "type": "link",
                "link": "https://video.example/x", "status": "attached", "context": {"kind": "report", "ref_id": ""},
                "created_at": now_utc().isoformat(), **extra}

    # Liga: fünf gehaltene Nachweise (offenes Verfahren) stehen in der Reihenfolge vor den dreien eines erledigten Spiels.
    held = [proof(f"a-{n}", w["match"]["id"], w["tournament"]["id"]) for n in range(5)]
    free = [proof(f"z-{n}", done["id"], w["tournament"]["id"]) for n in range(3)]
    # MOSS mitten in der Season: vier zu einem offenen Verfahren, einer ohne auffindbares Verfahren.
    moss = [proof(f"m-{n}", w["match"]["id"], w["tournament"]["id"], context={"kind": "moss", "ref_id": "verfahren-1"}) for n in range(4)]
    lost = proof("n-0", done["id"], w["tournament"]["id"], context={"kind": "moss", "ref_id": "weg"})
    # Turnier: drei alte Nachweise eines Spiels in Klärung vor einem alten eines erledigten Spiels.
    staff = await flow.add_staff()
    flow.act_as(staff)
    cup, _users, _registrations = await flow.with_participants(2)
    await flow.db.matches_v2.insert_one({"id": "pokal-streit", "tournament_id": cup["id"], "status": "disputed", "slots": []})
    await flow.db.matches_v2.insert_one({"id": "pokal-fertig", "tournament_id": cup["id"], "status": "completed", "slots": []})
    cup_held = [proof(f"b-{n}", "pokal-streit", cup["id"]) for n in range(3)]
    cup_free = proof("y-0", "pokal-fertig", cup["id"])
    await flow.db.match_proof_photos.insert_many([dict(row) for row in (*held, *free, *moss, lost, *cup_held, cup_free)])

    assert await match_proof_retention.purge(flow.db, now=late) == 5
    assert await left(flow) == {row["id"] for row in (*held, *moss, *cup_held)}
    assert await match_proof_retention.purge(flow.db, now=late) == 0


@pytest.mark.asyncio
async def test_tournaments_keep_their_thirty_days_from_upload(flow):
    """Gegenprobe zur Liga: Ein Turnier ohne Liga löscht weiter 30 Tage nach dem Hochladen - außer das Spiel ist in Klärung."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(2)
    match = {"id": "pokal-1", "tournament_id": tournament["id"], "match_type": "duel", "status": "scheduled",
             "slots": [{"slot": 1, "registration_id": registrations[0]["id"]}, {"slot": 2, "registration_id": registrations[1]["id"]}]}
    await flow.db.matches_v2.insert_one(dict(match))
    flow.act_as(users[0])
    # Der alte Weg: ein Foto, das mit der Meldung abgeschickt wurde.
    await flow.db.match_proof_photos.insert_one({"id": "foto-1", "match_id": match["id"], "tournament_id": tournament["id"],
                                                 "owner_id": users[0]["id"], "status": "attached", "context": {"kind": "report"},
                                                 "created_at": now_utc().isoformat()})
    assert await match_proof_retention.purge(flow.db, now=now_utc() + timedelta(days=29)) == 0
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"status": "disputed"}})
    assert await match_proof_retention.purge(flow.db, now=now_utc() + timedelta(days=31)) == 0
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"status": "completed"}})
    assert await match_proof_retention.purge(flow.db, now=now_utc() + timedelta(days=31)) == 1
