"""Teilnahmen in der Mitgliederakte (#847, Vereine 1.8.0): ein Check-in und ein Turnierende stehen beim Mitglied in
Dolibarr - einmal, auch wenn der Abgleich zweimal läuft; nur mit bestätigter Zuordnung, nie für Gäste; wer erst nach
dem Turnier ins Team kam, hat nicht mitgespielt. Widerrufenes nimmt die Website zurück, Umbenanntes ersetzt sie, ein
gelöschtes Event nimmt nichts aus der Akte. Der Nachzug holt zwölf Monate in Portionen; ohne Schalter, Modul 1.8 oder
Recht geht nichts hin - und der Grund steht da."""
import pathlib
import sys
from datetime import date

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, member  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import dolibarr_client, dolibarr_identity, dolibarr_participations  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402

TODAY = date(2026, 9, 25)


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fake(monkeypatch):
    instance = FakeDolibarr()
    monkeypatch.setattr(dolibarr_client, "_transport", instance.transport())
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    monkeypatch.setattr(dolibarr_participations, "current_day", lambda: TODAY)
    dolibarr_identity.reset_cache()
    return instance


async def connect(flow, *, enabled=True, since="2026-09-01", module="1.9.0"):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": "live", "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY),
        "instance": "verein", "entity": 1, "participations_enabled": enabled, "participations_since": since,
    }}, upsert=True)
    await flow.db.settings.update_one({"id": "dolibarr_sync_state"}, {"$set": {"id": "dolibarr_sync_state", "module_version": module}}, upsert=True)


async def person(flow, name: str, member_id: int | None) -> dict:
    user = await flow.add_user(role="player", name=name)
    if member_id:
        await flow.db.dolibarr_links.insert_one({"id": f"l-{name}", "user_id": user["id"], "instance": "verein:1", "member_key": f"verein:1:{member_id}",
                                                 "member_id": member_id, "member_ref": str(member_id), "status": "verified"})
    return user


async def scene(flow, fake) -> dict:
    """Herbstfest am 20.09. mit Check-ins, Herbstcup am 21.09. mit Paula allein und dem Team Lions."""
    await connect(flow)
    for member_id, firstname in ((12, "Paula"), (13, "Carl"), (14, "Dora")):
        fake.add(member(member_id, firstname=firstname))
    paula = await person(flow, "paula", 12)
    carl = await person(flow, "carl", 13)
    dora = await person(flow, "dora", 14)
    bob = await person(flow, "bob", None)
    db = flow.db
    await db.events.insert_one({"id": "ev-1", "name": "Herbstfest", "status": "completed", "start_date": "2026-09-20T16:00:00+00:00"})
    await db.event_registrations.insert_many([
        {"id": "er-paula", "event_id": "ev-1", "user_id": paula["id"], "status": "checked_in"},
        {"id": "er-bob", "event_id": "ev-1", "user_id": bob["id"], "status": "checked_in"},
        {"id": "er-gast", "event_id": "ev-1", "user_id": None, "status": "checked_in", "is_guest": True},
        {"id": "er-carl", "event_id": "ev-1", "user_id": carl["id"], "status": "registered"},
    ])
    await db.tournaments.insert_one({"id": "tn-1", "title": "Herbstcup", "status": "completed", "start_date": "2026-09-21T09:00:00+00:00"})
    await db.team_members.insert_many([
        {"team_id": "team-lions", "user_id": carl["id"], "joined_at": "2026-01-10T10:00:00+00:00"},
        {"team_id": "team-lions", "user_id": dora["id"], "joined_at": "2026-09-24T10:00:00+00:00"},
    ])
    await db.tournament_registrations.insert_many([
        {"id": "tr-paula", "tournament_id": "tn-1", "user_id": paula["id"], "status": "approved"},
        {"id": "tr-lions", "tournament_id": "tn-1", "user_id": carl["id"], "team_id": "team-lions", "status": "checked_in"},
        {"id": "tr-bob", "tournament_id": "tn-1", "user_id": bob["id"], "status": "rejected"},
    ])
    return {"paula": paula, "carl": carl, "dora": dora, "bob": bob}


def filed(fake, member_id: int) -> dict:
    return {row["external_id"]: row for row in fake.participations.get(member_id, [])}


@pytest.mark.asyncio
async def test_check_in_and_tournament_end_land_in_the_file_once(flow, fake):
    await scene(flow, fake)
    result = await dolibarr_participations.run(flow.db, today=TODAY)
    assert result["ok"] is True and (result["sent"], result["failed"], result["from"]) == (3, 0, "2026-09-01"), result
    assert filed(fake, 12) == {
        "ev.ev-1.12": {"kind": "event", "kind_label": "Vereinsevent", "title": "Herbstfest", "day": "2026-09-20", "hours": None,
                       "source": "api", "external_id": "ev.ev-1.12"},
        "tn.tn-1.12": {"kind": "competition", "kind_label": "Wettbewerb", "title": "Herbstcup", "day": "2026-09-21", "hours": None,
                       "source": "api", "external_id": "tn.tn-1.12"},
    }
    # Carl spielte im Team; Dora kam erst nach dem Turnier dazu; Bob ohne Zuordnung und der Gast ohne Konto bekommen nichts.
    assert list(filed(fake, 13)) == ["tn.tn-1.13"]
    assert not fake.participations.get(14)

    again = await dolibarr_participations.run(flow.db, today=TODAY)
    assert (again["sent"], again["replaced"], again["retracted"]) == (0, 0, 0)
    assert sum(len(rows) for rows in fake.participations.values()) == 3


@pytest.mark.asyncio
async def test_withdrawn_goes_back_renamed_is_replaced_deleted_stays(flow, fake):
    people = await scene(flow, fake)
    db = flow.db
    await dolibarr_participations.run(db, today=TODAY)

    # Check-in aufgehoben: raus aus der Akte. Turnier umbenannt: die eigene Meldung wird ersetzt (409 → zurücknehmen → neu).
    await db.event_registrations.update_one({"id": "er-paula"}, {"$set": {"status": "registered"}})
    await db.tournaments.update_one({"id": "tn-1"}, {"$set": {"title": "Herbstcup 2026"}})
    result = await dolibarr_participations.run(db, today=TODAY)
    assert (result["retracted"], result["replaced"]) == (1, 2), result
    assert list(filed(fake, 12)) == ["tn.tn-1.12"] and filed(fake, 12)["tn.tn-1.12"]["title"] == "Herbstcup 2026"
    assert filed(fake, 13)["tn.tn-1.13"]["title"] == "Herbstcup 2026"

    # Wieder eingecheckt: wieder drin. Ein gelöschtes Event und ein Teamwechsel nehmen danach nichts aus der Akte.
    await db.event_registrations.update_one({"id": "er-paula"}, {"$set": {"status": "checked_in"}})
    assert (await dolibarr_participations.run(db, today=TODAY))["sent"] == 1
    await db.events.delete_one({"id": "ev-1"})
    await db.team_members.delete_one({"user_id": people["carl"]["id"]})
    result = await dolibarr_participations.run(db, today=TODAY)
    assert result["retracted"] == 0 and "ev.ev-1.12" in filed(fake, 12) and "tn.tn-1.13" in filed(fake, 13)

    # Turnier wieder geöffnet: beide Turniermeldungen gehen zurück.
    await db.tournaments.update_one({"id": "tn-1"}, {"$set": {"status": "live"}})
    result = await dolibarr_participations.run(db, today=TODAY)
    assert result["retracted"] == 2 and not filed(fake, 13) and list(filed(fake, 12)) == ["ev.ev-1.12"]


@pytest.mark.asyncio
async def test_backfill_reaches_back_twelve_months_in_portions(flow, fake, monkeypatch):
    people = await scene(flow, fake)
    db = flow.db
    paula = people["paula"]["id"]
    await db.events.insert_many([
        {"id": "ev-alt", "name": "Frühlingsfest", "status": "completed", "start_date": "2026-03-14T15:00:00+00:00"},
        {"id": "ev-uralt", "name": "Sommerfest 2025", "status": "completed", "start_date": "2025-07-01T15:00:00+00:00"},
    ])
    await db.event_registrations.insert_many([
        {"id": "er-alt", "event_id": "ev-alt", "user_id": paula, "status": "checked_in"},
        {"id": "er-uralt", "event_id": "ev-uralt", "user_id": paula, "status": "checked_in"},
    ])
    await db.tournaments.insert_one({"id": "tn-alt", "title": "Frühjahrscup", "status": "results_published", "start_date": "2026-05-02T09:00:00+00:00"})
    await db.tournament_registrations.insert_one({"id": "tr-alt", "tournament_id": "tn-alt", "user_id": paula, "status": "approved"})

    # Der Abgleich schaut nur ab dem Einschalten - Älteres holt erst der Nachzug, in Portionen.
    assert (await dolibarr_participations.run(db, today=TODAY))["sent"] == 3
    assert "ev.ev-alt.12" not in filed(fake, 12)
    monkeypatch.setattr(dolibarr_participations, "BATCH", 1)
    part = await dolibarr_participations.request_backfill(db, today=TODAY)
    assert (part["sent"], part["pending"], part["from"]) == (1, 1, "2025-09-25"), part
    assert (await dolibarr_participations.load_state(db))["backfill_from"] == "2025-09-25"
    rest = await dolibarr_participations.run(db, today=TODAY)
    assert (rest["sent"], rest["pending"]) == (1, 0), rest
    assert {"ev.ev-alt.12", "tn.tn-alt.12"} <= set(filed(fake, 12)) and "ev.ev-uralt.12" not in filed(fake, 12)
    assert (await dolibarr_participations.load_state(db))["backfill_from"] is None
    assert (await dolibarr_participations.run(db, today=TODAY))["from"] == "2026-09-01"


@pytest.mark.asyncio
async def test_reasons_instead_of_silence(flow, fake):
    await scene(flow, fake)
    db = flow.db
    await connect(flow, enabled=False)
    assert (await dolibarr_participations.run(db, today=TODAY))["skipped"] == "switched_off"
    await connect(flow, module="1.7.0")
    old = await dolibarr_participations.run(db, today=TODAY)
    assert old["skipped"] == "module_version" and "1.8.0" in old["text"]
    assert not fake.participations

    # Die Art „Wettbewerb“ ist im Modul aus: die Turniermeldungen werden mit Grund abgelehnt, das Event geht durch.
    await connect(flow)
    del fake.participation_kinds["competition"]
    result = await dolibarr_participations.run(db, today=TODAY)
    assert (result["sent"], result["failed"]) == (1, 2), result
    view = await dolibarr_participations.admin_view(db, await dolibarr_client.load_settings(db))
    assert (view["sent"], view["failed_total"]) == (1, 2)
    assert view["failed"][0]["kind"] == "Turnier" and view["failed"][0]["text"].startswith("Diese Art ist im Wörterbuch")

    # Abgelehntes wartet sechs Stunden - der Nachzug versucht es sofort wieder.
    fake.participation_kinds["competition"] = "Wettbewerb"
    assert (await dolibarr_participations.run(db, today=TODAY))["sent"] == 0
    assert (await dolibarr_participations.request_backfill(db, today=TODAY))["sent"] == 2

    # Fehlt das Recht, hört der Lauf auf und sagt, welches.
    fake.participation_right = False
    await db.event_registrations.update_one({"id": "er-carl"}, {"$set": {"status": "checked_in"}})
    stopped = await dolibarr_participations.run(db, today=TODAY)
    assert stopped["ok"] is False and stopped["error"] == "right_missing" and "Teilnahmen von Mitgliedern erfassen" in stopped["text"]


@pytest.mark.asyncio
async def test_switch_and_backfill_under_dolibarr_features(flow, fake):
    people = await scene(flow, fake)
    await connect(flow, enabled=False, since="")
    flow.act_as(await flow.add_user(role="club_admin"))

    async def row():
        return next(r for r in (await flow.get("/api/admin/dolibarr/status")).json()["features"] if r["key"] == "participations")

    assert (await row())["state"] == "aus"
    assert (await flow.put("/api/admin/dolibarr/features", json={"key": "participations", "on": True})).status_code == 200
    settings = await dolibarr_client.load_settings(flow.db)
    assert settings["participations_enabled"] is True and settings["participations_since"] == "2026-09-25"
    current = await row()
    assert current["switch"] == {"on": True} and current["enabled"] is True and current["state"] == "an · 0 gemeldet"

    # Ab dem Einschalten meldet der Abgleich; das Herbstfest davor holt der Nachzug.
    backfill = await flow.post("/api/admin/dolibarr/participations/backfill")
    assert backfill.status_code == 200 and backfill.json()["sent"] == 3, backfill.text
    current = await row()
    assert current["state"] == "an · 3 gemeldet" and current["participations"]["last_run"]["sent"] == 3

    flow.act_as(people["bob"])
    assert (await flow.post("/api/admin/dolibarr/participations/backfill")).status_code == 403
