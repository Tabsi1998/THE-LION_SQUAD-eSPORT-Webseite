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
    # Aus dem ersten Vorfall folgt ein Protest - sein MOSS bleibt, der des zweiten geht nach der Einspruchsfrist. Das Ergebnis
    # stand schon vorher fest, die Protestfrist des Spiels (eigener Test) ist also vorbei.
    await set_match(flow, w, incidents=[{**crash, **done}, {**other, **done}], disputes=[protest(w, incident_id="vorfall-1")],
                    status="completed", completed_at=(closed - timedelta(days=5)).isoformat())
    assert await match_proof_retention.purge(flow.db, now=closed + timedelta(hours=47)) == 0
    assert await match_proof_retention.purge(flow.db, now=closed + timedelta(hours=49)) == 1
    assert await left(flow) == {first["id"]} and first["id"] != second["id"]
    assert await match_proof_retention.purge(flow.db, now=closed + timedelta(days=30)) == 0, "das Verfahren läuft noch"
    decided = closed + timedelta(days=31)
    await set_match(flow, w, disputes=[protest(w, incident_id="vorfall-1", resolved_at=decided.isoformat())])
    assert await match_proof_retention.purge(flow.db, now=decided + timedelta(hours=47)) == 0
    assert await match_proof_retention.purge(flow.db, now=decided + timedelta(hours=49)) == 1


@pytest.mark.asyncio
async def test_moss_on_an_incident_stays_until_the_protest_window_of_the_match_is_over(flow):
    """Ein Protest ist erst nach der Bestätigung möglich und läuft dann ``protest_hours`` - so lange bleibt MOSS am Vorfall
    mindestens (Review #2360, M5). Vorher endete die Frist 48 Stunden nach dem Vorfall, mitten im laufenden Spiel."""
    w = await league_world(flow)
    match = w["match"]
    await season(flow, w, protest_hours=72)
    crash = {"id": "vorfall-1", "position": 1, "kind": "moss_crash", "state": "proposed",
             "reported_by": {"registration_id": w["reg_a"]["id"]}}
    await set_match(flow, w, incidents=[crash], status="reported")
    flow.act_as(user(w, "Mila"))
    assert (await add_image(flow, match, "moss", "vorfall-1")).status_code == 200
    closed = now_utc()
    await set_match(flow, w, incidents=[{**crash, "state": "agreed", "closed_at": closed.isoformat()}], status="reported")
    # Geeinigt, aber das Ergebnis ist nur gemeldet: Die Protestfrist hat nicht einmal begonnen.
    assert await match_proof_retention.purge(flow.db, now=closed + timedelta(hours=49)) == 0
    assert await match_proof_retention.purge(flow.db, now=closed + timedelta(days=30)) == 0
    # Bestätigt: ab dann 72 Stunden der Season (nicht die Vorgabe 48).
    confirmed = closed + timedelta(days=3)
    await set_match(flow, w, status="completed", completed_at=confirmed.isoformat())
    assert await match_proof_retention.purge(flow.db, now=confirmed + timedelta(hours=71)) == 0
    # Kommt in der Frist ein Protest zu dem Vorfall, gilt dessen Kette samt Einspruchsfrist.
    await set_match(flow, w, disputes=[protest(w, incident_id="vorfall-1")])
    assert await match_proof_retention.purge(flow.db, now=confirmed + timedelta(days=30)) == 0
    decided = confirmed + timedelta(days=31)
    await set_match(flow, w, disputes=[protest(w, incident_id="vorfall-1", resolved_at=decided.isoformat())])
    assert await match_proof_retention.purge(flow.db, now=decided + timedelta(hours=47)) == 0
    assert await match_proof_retention.purge(flow.db, now=decided + timedelta(hours=49)) == 1


@pytest.mark.asyncio
async def test_moss_on_an_incident_of_a_match_that_is_never_decided_goes_with_the_season(flow):
    """Obergrenze (Review #2360, Runde 3): Wird das Spiel nie entschieden, bleibt MOSS am Vorfall nicht für immer - spätestens
    Season-Ende plus ``evidence_keep_days``, wie jeder andere Nachweis der Staffel."""
    w = await league_world(flow)
    match = w["match"]
    doc = await season(flow, w, evidence_keep_days=10)
    cap = match_proof_retention.season_end(doc) + timedelta(days=10)
    crash = {"id": "vorfall-1", "kind": "moss_crash", "state": "proposed"}
    await set_match(flow, w, incidents=[crash], status="reported")
    flow.act_as(user(w, "Mila"))
    await add_image(flow, match, "moss", "vorfall-1")
    await set_match(flow, w, incidents=[{**crash, "state": "agreed", "closed_at": now_utc().isoformat()}])
    assert await match_proof_retention.purge(flow.db, now=cap - timedelta(hours=1)) == 0
    assert await match_proof_retention.purge(flow.db, now=cap + timedelta(hours=1)) == 1

    # Ein noch offener Vorfall hält auch über die Obergrenze hinaus - wie jedes offene Verfahren.
    await set_match(flow, w, incidents=[crash])
    await add_image(flow, match, "moss", "vorfall-1")
    assert await match_proof_retention.purge(flow.db, now=cap + timedelta(days=90)) == 0


@pytest.mark.asyncio
async def test_moss_on_an_incident_of_a_decided_match_without_a_decision_time(flow):
    """Entschieden, aber ohne Zeitpunkt (Altdaten): Die Protestfrist läuft ab dem letzten bekannten Zeitpunkt - der letzten
    Änderung am Spiel, sonst dem Ende des Vorfalls -, nicht nur die kürzere Einspruchsfrist ab dem Vorfall."""
    w = await league_world(flow)
    match = w["match"]
    await season(flow, w, protest_hours=96)
    crash = {"id": "vorfall-1", "kind": "moss_crash", "state": "proposed"}
    await set_match(flow, w, incidents=[crash])
    flow.act_as(user(w, "Mila"))
    await add_image(flow, match, "moss", "vorfall-1")
    closed, changed = now_utc() + timedelta(hours=1), now_utc() + timedelta(days=4)
    await set_match(flow, w, incidents=[{**crash, "state": "agreed", "closed_at": closed.isoformat()}], status="completed",
                    updated_at=changed.isoformat())
    # Vorfallsende plus Einspruchsfrist (48 h) wäre längst vorbei - es zählen 96 Stunden ab der letzten Änderung am Spiel.
    assert await match_proof_retention.purge(flow.db, now=changed + timedelta(hours=95)) == 0
    assert await match_proof_retention.purge(flow.db, now=changed + timedelta(hours=97)) == 1

    # Auch die letzte Änderung fehlt: dann ab dem Ende des Vorfalls.
    await set_match(flow, w, incidents=[crash], status="scheduled")
    await add_image(flow, match, "moss", "vorfall-1")
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {
        "status": "completed", "incidents": [{**crash, "state": "agreed", "closed_at": closed.isoformat()}]}, "$unset": {"updated_at": ""}})
    assert await match_proof_retention.purge(flow.db, now=closed + timedelta(hours=95)) == 0
    assert await match_proof_retention.purge(flow.db, now=closed + timedelta(hours=97)) == 1


@pytest.mark.asyncio
async def test_the_protest_window_for_moss_on_an_incident_rests_in_blocked_periods(flow):
    """Ohne Protest: weg nach Bestätigung plus Protestfrist - die in einer Sperrzeit ruht. Ein abgesagtes Spiel wartet nicht."""
    w = await league_world(flow)
    match = w["match"]
    await season(flow, w)
    crash = {"id": "vorfall-1", "kind": "moss_crash", "state": "proposed"}
    await set_match(flow, w, incidents=[crash])
    flow.act_as(user(w, "Mila"))
    await add_image(flow, match, "moss", "vorfall-1")
    confirmed = now_utc() + timedelta(hours=3)
    await set_match(flow, w, incidents=[{**crash, "state": "agreed", "closed_at": now_utc().isoformat()}], status="completed",
                    completed_at=confirmed.isoformat())
    assert await match_proof_retention.purge(flow.db, now=confirmed + timedelta(hours=47)) == 0
    # Sperrzeit ab dem Tag nach der Bestätigung, zehn Tage lang: Die 48 Stunden laufen erst danach zu Ende.
    first, last = (confirmed + timedelta(days=1)).date(), (confirmed + timedelta(days=10)).date()
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"blocked_periods": [
        {"start_date": first.isoformat(), "end_date": last.isoformat(), "label": "Pause"}]}})
    assert await match_proof_retention.purge(flow.db, now=confirmed + timedelta(days=9)) == 0
    assert await match_proof_retention.purge(flow.db, now=confirmed + timedelta(days=14)) == 1

    # Abgesagtes Spiel: Dort kommt kein Protest mehr - es bleibt bei Vorfallsende plus Einspruchsfrist.
    await set_match(flow, w, incidents=[crash], status="scheduled")
    await add_image(flow, match, "moss", "vorfall-1")
    closed = now_utc()
    await set_match(flow, w, incidents=[{**crash, "state": "decided", "closed_at": closed.isoformat()}], status="cancelled")
    assert await match_proof_retention.purge(flow.db, now=closed + timedelta(hours=47)) == 0
    assert await match_proof_retention.purge(flow.db, now=closed + timedelta(hours=49)) == 1


@pytest.mark.asyncio
async def test_moss_on_an_incident_without_an_end_time_counts_from_upload(flow):
    w = await league_world(flow)
    await season(flow, w)
    crash = {"id": "vorfall-1", "kind": "moss_crash", "state": "proposed"}
    await set_match(flow, w, incidents=[crash])
    flow.act_as(user(w, "Mila"))
    await add_image(flow, w["match"], "moss", "vorfall-1")
    await set_match(flow, w, incidents=[{**crash, "state": "withdrawn"}], status="completed",
                    completed_at=(now_utc() - timedelta(days=5)).isoformat())
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
async def test_account_erasure_keeps_moss_of_a_running_procedure_for_the_lead_only(flow):
    """Kontolöschung bei laufendem Verfahren (Entscheidung Fabian, Art. 17 Abs. 3 lit. e): Der MOSS-Nachweis bleibt ohne
    Kennung der Person nur für die Leitung, bis das Verfahren samt Einspruchsfrist um ist. Alles andere geht sofort."""
    w = await league_world(flow)
    match = w["match"]
    await season(flow, w)
    long_ago = (now_utc() - timedelta(days=20)).isoformat()
    await set_match(flow, w, disputes=[protest(w), protest(w, id="verfahren-alt", resolved_at=long_ago)])
    captain = user(w, "Kapitaen")
    flow.act_as(captain)
    needed = (await add_image(flow, match, "moss", "verfahren-1")).json()
    report = (await add_link(flow, match)).json()
    # Ein MOSS-Nachweis zu einem längst erledigten Verfahren (Altfall, den der Job noch nicht geholt hat).
    await flow.db.match_proof_photos.insert_one({"id": "moss-alt", "match_id": match["id"], "tournament_id": w["tournament"]["id"],
                                                 "owner_id": captain["id"], "registration_id": w["reg_a"]["id"], "type": "link",
                                                 "link": "https://video.example/alt", "status": "attached", "created_at": long_ago,
                                                 "context": {"kind": "moss", "ref_id": "verfahren-alt"}})
    saved = match_proofs.PROOF_DIR / (await flow.db.match_proof_photos.find_one({"id": needed["id"]}, {"_id": 0}))["storage_key"]

    assert await match_proof_retention.delete_for_user(flow.db, captain["id"]) == 2
    assert await left(flow) == {needed["id"]} and report["id"] != needed["id"]
    kept = await flow.db.match_proof_photos.find_one({"id": needed["id"]}, {"_id": 0})
    assert kept["owner_id"] is None and kept["owner_erased"] is True and kept["status"] == "removed" and kept["removed_by"] is None
    assert captain["id"] not in str(kept), "keine Kennung der Person mehr am Nachweis"
    assert saved.is_file()
    audit = await flow.db.audit_logs.find({"action": "match.proof.erasure_hold"}, {"_id": 0}).to_list(10)
    assert len(audit) == 1 and audit[0]["actor_id"] is None and captain["id"] not in str(audit[0])

    # Nur die Leitung, die an dem Spiel nicht beteiligt ist, sieht ihn noch.
    for person in (captain, user(w, "Mila"), user(w, "Falke1")):
        flow.act_as(person)
        response = await flow.get(f"/api/matches/{match['id']}/proofs", params={"kind": "moss", "ref_id": "verfahren-1"})
        assert response.status_code == 200 and response.json()["items"] == [], person["display_name"]
        assert (await flow.get(needed["url"])).status_code == 404
    flow.act_as(w["staff"])
    items = (await flow.get(f"/api/matches/{match['id']}/proofs", params={"kind": "moss", "ref_id": "verfahren-1"})).json()["items"]
    assert [(item["id"], item["removed"], item["own"]) for item in items] == [(needed["id"], True, False)]
    assert (await flow.get(needed["url"])).status_code == 200

    # Verfahren entschieden: nach der Einspruchsfrist löscht ihn der Job wie jeden MOSS-Nachweis.
    decided = now_utc() + timedelta(days=2)
    await set_match(flow, w, disputes=[protest(w, resolved_at=decided.isoformat())])
    assert await match_proof_retention.purge(flow.db, now=decided + timedelta(hours=47)) == 0
    assert await match_proof_retention.purge(flow.db, now=decided + timedelta(hours=49)) == 1
    assert await left(flow) == set() and not saved.exists()


@pytest.mark.asyncio
async def test_account_erasure_leaves_no_trace_of_the_person_at_proof_or_image_check(flow):
    """Die ganze Kontolöschung (wie die Route sie ausführt): Am gehaltenen MOSS-Nachweis und an seinem Eintrag der Bildprüfung
    steht keine Kennung der Person mehr; zu gelöschten Nachweisen bleibt kein Prüfeintrag zurück (Review #2360, Runde 3)."""
    from routes.dsgvo_routes import _anonymize_user_data

    w = await league_world(flow)
    match = w["match"]
    await season(flow, w)
    await set_match(flow, w, disputes=[protest(w), protest(w, id="verfahren-alt")])
    mila = user(w, "Mila")
    flow.act_as(mila)
    needed = (await add_image(flow, match, "moss", "verfahren-1")).json()
    stale = (await add_image(flow, match, "moss", "verfahren-alt")).json()
    await set_match(flow, w, disputes=[protest(w), protest(w, id="verfahren-alt", resolved_at=(now_utc() - timedelta(days=20)).isoformat())])
    scans = await flow.db.media_scans.find({"kind": "proof"}, {"_id": 0, "ref_id": 1, "owner_id": 1}).to_list(10)
    assert sorted(row["ref_id"] for row in scans) == sorted([needed["id"], stale["id"]]) and all(row["owner_id"] == mila["id"] for row in scans)

    await _anonymize_user_data(flow.db, mila["id"], mila["id"], "self")

    assert await left(flow) == {needed["id"]}
    kept = await flow.db.match_proof_photos.find_one({"id": needed["id"]}, {"_id": 0})
    assert kept["owner_id"] is None and kept["status"] == "removed" and mila["id"] not in str(kept)
    scans = await flow.db.media_scans.find({"kind": "proof"}, {"_id": 0}).to_list(10)
    assert [row["ref_id"] for row in scans] == [needed["id"]], "der Prüfeintrag des gelöschten Nachweises ist weg"
    assert scans[0]["owner_id"] is None and mila["id"] not in str(scans[0])
    # Das Protokoll behält wie überall die Kennung des Kontos - und die zeigt nur noch auf die pseudonymisierte Kontozeile.
    audits = await flow.db.audit_logs.find({"data.proof_id": needed["id"]}, {"_id": 0, "action": 1, "actor_id": 1}).to_list(10)
    assert sorted((row["action"], row["actor_id"] == mila["id"]) for row in audits) == [
        ("match.proof.add", True), ("match.proof.erasure_hold", False)]
    account = await flow.db.users.find_one({"id": mila["id"]}, {"_id": 0, "username": 1, "display_name": 1, "email": 1})
    assert account["username"].startswith("deleted_") and "Mila" not in str(account)


@pytest.mark.asyncio
async def test_account_erasure_without_a_running_procedure_deletes_moss_at_once(flow):
    w = await league_world(flow)
    match = w["match"]
    await season(flow, w)
    await set_match(flow, w, disputes=[protest(w)])
    flow.act_as(user(w, "Mila"))
    moss = (await add_image(flow, match, "moss", "verfahren-1")).json()
    saved = match_proofs.PROOF_DIR / (await flow.db.match_proof_photos.find_one({"id": moss["id"]}, {"_id": 0}))["storage_key"]
    # Verfahren entschieden, Einspruchsfrist um: Es gibt keinen Grund mehr, die Datei zu halten.
    await set_match(flow, w, disputes=[protest(w, resolved_at=(now_utc() - timedelta(days=5)).isoformat())])
    assert await match_proof_retention.delete_for_user(flow.db, user(w, "Mila")["id"]) == 1
    assert await left(flow) == set() and not saved.exists()


@pytest.mark.asyncio
async def test_the_job_requeues_images_whose_image_check_never_started(flow, monkeypatch):
    """Ließ sich die Bildprüfung beim Hochladen nicht anstoßen, holt der stündliche Job sie nach (Review #2360, N6)."""
    from services import media_scan

    real, down = media_scan.enqueue, {"now": True}

    async def flaky(*args, **kwargs):
        if down["now"]:
            raise RuntimeError("Prüfdienst nicht erreichbar")
        return await real(*args, **kwargs)

    monkeypatch.setattr(media_scan, "enqueue", flaky)
    w = await league_world(flow)
    match = w["match"]
    flow.act_as(user(w, "Kapitaen"))
    stuck = (await add_image(flow, match)).json()
    assert stuck["scan_state"] == "pending" and await flow.db.media_scans.count_documents({}) == 0
    down["now"] = False
    fine = (await add_image(flow, match)).json()
    link = (await add_link(flow, match)).json()

    # Noch keine Stunde: Der Job wartet. Danach reiht er genau das hängende Bild ein - kein Link, kein geprüftes Bild.
    assert await match_proof_retention.rescan_stuck(flow.db, now=now_utc() + timedelta(minutes=59)) == 0
    assert await match_proof_retention.rescan_stuck(flow.db, now=now_utc() + timedelta(minutes=61)) == 1
    scans = await flow.db.media_scans.find({}, {"_id": 0, "ref_id": 1}).to_list(10)
    assert sorted(row["ref_id"] for row in scans) == sorted([stuck["id"], fine["id"]])
    stored = await flow.db.match_proof_photos.find_one({"id": stuck["id"]}, {"_id": 0})
    assert stored["scan_state"] in match_proofs.VISIBLE_SCAN_STATES, "geprüft"
    flow.act_as(user(w, "Falke1"))
    assert (await flow.get(stuck["url"])).status_code == 200, "jetzt sieht es auch die Gegenseite"
    assert await match_proof_retention.rescan_stuck(flow.db, now=now_utc() + timedelta(hours=5)) == 0
    assert link["type"] == "link"

    # Steht schon eine Prüfung an, reiht der Job nicht doppelt ein - das ist Sache des Sammlers der Bildprüfung.
    await flow.db.match_proof_photos.update_one({"id": fine["id"]}, {"$set": {"scan_state": "pending"}})
    await flow.db.media_scans.update_one({"ref_id": fine["id"]}, {"$set": {"state": "pending"}})
    assert await match_proof_retention.rescan_stuck(flow.db, now=now_utc() + timedelta(hours=5)) == 0


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
