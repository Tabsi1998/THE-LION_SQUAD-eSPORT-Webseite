"""Wunschnummer je Mitglied (#2034): einmal wählen, eindeutig im Verein, danach nur über den Vorstand; Dolibarr als
ergänzendes Attribut (Feldname per Einstellung), mit Spiegel und Nachtrag; frei bei Austritt und Kontolöschung.
"""

import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import database  # noqa: E402
import services.account_erasure as account_erasure  # noqa: E402
import services.dolibarr_client as dolibarr_client  # noqa: E402
import services.dolibarr_sync as dolibarr_sync  # noqa: E402
import services.jersey_numbers as jersey_numbers  # noqa: E402
from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr  # noqa: E402
from dolibarr_fake import member as summary  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services.dolibarr_links import verify_link  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402

URL = "/api/membership/me/jersey-number"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    await database.ensure_jersey_number_indexes(instance.db)
    jersey_numbers.reset_cache()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fake(monkeypatch):
    instance = FakeDolibarr()
    monkeypatch.setattr(dolibarr_client, "_transport", instance.transport())
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    return instance


async def member(flow, name: str, status: str = "active") -> dict:
    user = await flow.add_user(role="player", name=name)
    await flow.db.memberships.insert_one(
        {
            "id": f"m-{name}",
            "user_id": user["id"],
            "member_status": status,
            "history": [],
        }
    )
    return user


async def board(flow) -> dict:
    return await flow.add_user(role="club_admin", name="vorstand")


async def connect(flow, *, write: bool = True):
    await flow.db.settings.update_one(
        {"id": "dolibarr"},
        {
            "$set": {
                "id": "dolibarr",
                "mode": "live",
                "environment": "production",
                "base_url": BASE_URL,
                "api_key": encrypt_secret(API_KEY),
                "instance": "verein",
                "entity": 1,
                "write_enabled": write,
            }
        },
        upsert=True,
    )


async def link(flow, user: dict, member_id: int):
    settings = await dolibarr_client.load_settings(flow.db)
    await verify_link(
        flow.db,
        settings,
        user_id=user["id"],
        member_id=member_id,
        member_ref=str(member_id),
        source="admin",
        actor_id=None,
    )


@pytest.mark.asyncio
async def test_member_chooses_once_then_only_by_request_and_board(flow):
    guest = await flow.add_user(role="player", name="gast")
    flow.act_as(guest)
    assert (await flow.get(URL)).json() == {
        "available": False,
        "reason": "not_member",
        "text": "Eine eigene Nummer gibt es für Vereinsmitglieder.",
    }
    assert (
        await flow.post(URL, json={"number": 7, "confirmed": True})
    ).status_code == 403

    paula = await member(flow, "paula")
    flow.act_as(paula)
    view = (await flow.get(URL)).json()
    assert (
        view["available"] is True
        and view["number"] is None
        and view["can_choose"] is True
    )
    assert (
        view["range"] == {"min": 0, "max": 99}
        and view["reserved"] == []
        and view["open_request"] is None
    )
    assert view["free_count"] == 100 and view["again"] is False

    # Live-Prüfung: frei, außerhalb des Bereichs, keine Zahl.
    assert (await flow.post(f"{URL}/check", json={"number": "7"})).json()[
        "free"
    ] is True
    out = (await flow.post(f"{URL}/check", json={"number": "100"})).json()
    assert out["free"] is False and out["text"] == "Nur Nummern von 0 bis 99."
    assert (
        await flow.post(f"{URL}/check", json={"number": "sieben"})
    ).status_code == 400

    # Ohne Bestätigung nichts; mit Bestätigung festgelegt - 0 ist eine gültige Nummer.
    unconfirmed = await flow.post(URL, json={"number": 0})
    assert (
        unconfirmed.status_code == 400 and "bestätige" in unconfirmed.json()["detail"]
    )
    chosen = await flow.post(URL, json={"number": 0, "confirmed": True})
    assert chosen.status_code == 200, chosen.text
    view = chosen.json()
    assert (
        view["number"] == 0
        and view["can_choose"] is False
        and view["dolibarr"]["state"] == "off"
    )
    # Doppelklick: dieselbe Nummer noch einmal ist kein Fehler; eine andere schon.
    assert (await flow.post(URL, json={"number": 0, "confirmed": True})).json()[
        "number"
    ] == 0
    locked = await flow.post(URL, json={"number": 8, "confirmed": True})
    assert locked.status_code == 409 and "Antrag" in locked.json()["detail"]
    assert (await flow.post(f"{URL}/check", json={"number": "0"})).json()[
        "reason"
    ] == "own"

    # Eindeutig im Verein: Max sieht „vergeben“, ohne zu erfahren, wer sie hat.
    max_ = await member(flow, "max")
    flow.act_as(max_)
    taken = (await flow.post(f"{URL}/check", json={"number": "0"})).json()
    assert taken == {
        "number": 0,
        "free": False,
        "reason": "taken",
        "text": "Diese Nummer hat schon jemand.",
    }
    assert (
        await flow.post(URL, json={"number": 0, "confirmed": True})
    ).status_code == 409

    # Antrag wie bei den Vereinsdaten: Begründung Pflicht, nur einer offen, Wunsch muss frei sein.
    flow.act_as(paula)
    assert (
        await flow.post(f"{URL}/requests", json={"wished": 8, "reason": ""})
    ).status_code == 400
    assert (
        await flow.post(f"{URL}/requests", json={"wished": 0, "reason": "Lieber die 8"})
    ).status_code == 400
    sent = await flow.post(
        f"{URL}/requests",
        json={"wished": 8, "reason": "Die 8 trägt mein Bruder nicht mehr"},
    )
    assert sent.status_code == 200, sent.text
    assert (
        sent.json()["status"] == "received"
        and sent.json()["status_label"] == "beim Vorstand"
        and sent.json()["wished"] == 8
    )
    assert (
        await flow.post(f"{URL}/requests", json={"wished": 9, "reason": "Doch die 9"})
    ).status_code == 409
    assert (await flow.get(URL)).json()["open_request"]["wished"] == 8

    # Der Vorstand sieht alles und gibt frei: 8 gilt, 0 ist sofort frei.
    admin = await board(flow)
    flow.act_as(admin)
    overview = (await flow.get("/api/admin/jersey-numbers")).json()
    assert [row["number"] for row in overview["rows"]] == [0, None] and overview[
        "open_requests"
    ] == 1
    assert overview["counts"] == {"size": 100, "reserved": 0, "taken": 1, "free": 99}
    request_id = overview["requests"][0]["id"]
    decided = await flow.post(
        f"/api/admin/jersey-numbers/requests/{request_id}/decision",
        json={"decision": "approve"},
    )
    assert decided.status_code == 200, decided.text
    assert decided.json()["status"] == "applied"
    assert (
        await flow.post(
            f"/api/admin/jersey-numbers/requests/{request_id}/decision",
            json={"decision": "reject"},
        )
    ).status_code == 409
    flow.act_as(paula)
    view = (await flow.get(URL)).json()
    assert (
        view["number"] == 8
        and view["can_choose"] is False
        and view["requests"][0]["status_label"] == "übernommen"
    )
    flow.act_as(max_)
    assert (await flow.post(URL, json={"number": 0, "confirmed": True})).json()[
        "number"
    ] == 0

    # Protokoll: der Verlauf an der Zeile kennt die Nummern, das Adminprotokoll nicht.
    doc = await flow.db.jersey_numbers.find_one({"user_id": paula["id"]})
    assert [(e["action"], e["from"], e["to"]) for e in doc["log"]] == [
        ("chosen", None, 0),
        ("requested", 0, 8),
        ("set_by_board", 0, 8),
    ]
    audits = await flow.db.audit_logs.find(
        {"action": {"$regex": "^jersey_number"}}
    ).to_list(50)
    assert {a["action"] for a in audits} >= {
        "jersey_number.chosen",
        "jersey_number.requested",
        "jersey_number.set",
        "jersey_number.request_applied",
    }
    assert all(a["data"] == {} for a in audits)
    # Hinweis an Paula; der Vorstand bekommt den Antrag als Mail.
    assert await flow.db.notifications.find_one(
        {"user_id": paula["id"], "kind": "jersey_number"}
    )


@pytest.mark.asyncio
async def test_board_reopens_rejects_and_sets_rules(flow):
    paula, max_ = await member(flow, "paula"), await member(
        flow, "max", status="inactive"
    )
    admin = await board(flow)
    flow.act_as(admin)
    bad = await flow.put(
        "/api/admin/jersey-numbers/settings", json={"min": 10, "max": 5}
    )
    assert bad.status_code == 400
    assert (
        await flow.put(
            "/api/admin/jersey-numbers/settings",
            json={"dolibarr_field": "Trikot Nummer"},
        )
    ).status_code == 400
    saved = await flow.put(
        "/api/admin/jersey-numbers/settings",
        json={
            "min": 1,
            "max": 30,
            "reserved": "1, 13 ,13",
            "dolibarr_field": "options_rueckennummer",
        },
    )
    assert saved.json() == {
        "min": 1,
        "max": 30,
        "reserved": [1, 13],
        "dolibarr_field": "rueckennummer",
    }

    flow.act_as(max_)  # ruhend ist auch Mitglied
    assert (await flow.get(URL)).json()["free_count"] == 28
    assert (await flow.post(f"{URL}/check", json={"number": "13"})).json()[
        "text"
    ] == "Diese Nummer hält der Verein frei."
    assert (await flow.post(URL, json={"number": 5, "confirmed": True})).json()[
        "number"
    ] == 5

    # Der Vorstand vergibt selbst - auch eine reservierte Nummer bleibt ihm verwehrt, eine vergebene sowieso.
    flow.act_as(admin)
    assert (
        await flow.put(
            f"/api/admin/jersey-numbers/members/{paula['id']}", json={"number": 5}
        )
    ).status_code == 409
    assert (
        await flow.put(
            f"/api/admin/jersey-numbers/members/{paula['id']}", json={"number": 13}
        )
    ).status_code == 409
    row = (
        await flow.put(
            f"/api/admin/jersey-numbers/members/{paula['id']}",
            json={"number": 6, "note": "Trikot liegt bereit"},
        )
    ).json()
    assert (
        row["number"] == 6
        and row["set_by"] == "board"
        and row["can_choose"] is False
        and row["log"][0]["note"] == "Trikot liegt bereit"
    )

    # Antrag ohne Wunsch -> Freigabe heißt Neuwahl; Ablehnen bleibt bei der Nummer.
    flow.act_as(paula)
    first = (
        await flow.post(
            f"{URL}/requests", json={"reason": "Ich hätte gern eine andere"}
        )
    ).json()
    flow.act_as(admin)
    rejected = (
        await flow.post(
            f"/api/admin/jersey-numbers/requests/{first['id']}/decision",
            json={"decision": "reject", "reason": "Erst nach der Saison"},
        )
    ).json()
    assert (
        rejected["status_label"] == "abgelehnt"
        and rejected["decision_reason"] == "Erst nach der Saison"
    )
    flow.act_as(paula)
    view = (await flow.get(URL)).json()
    assert (
        view["number"] == 6
        and view["open_request"] is None
        and view["requests"][0]["decision_reason"] == "Erst nach der Saison"
    )
    second = (
        await flow.post(
            f"{URL}/requests", json={"reason": "Jetzt ist die Saison vorbei"}
        )
    ).json()
    flow.act_as(admin)
    reopened = (
        await flow.post(
            f"/api/admin/jersey-numbers/requests/{second['id']}/decision",
            json={"decision": "approve"},
        )
    ).json()
    assert (
        reopened["status"] == "reopened"
        and reopened["status_label"] == "Neuwahl freigegeben"
    )
    flow.act_as(paula)
    view = (await flow.get(URL)).json()
    assert (
        view["number"] is None
        and view["can_choose"] is True
        and view["again"] is True
        and view["free_count"] == 27
    )
    assert (await flow.post(URL, json={"number": 6, "confirmed": True})).json()[
        "number"
    ] == 6  # die alte war sofort frei
    assert (
        await flow.post(URL, json={"number": 7, "confirmed": True})
    ).status_code == 409  # aber nur einmal

    # Neuwahl direkt vom Vorstand.
    flow.act_as(admin)
    assert (
        await flow.post(
            f"/api/admin/jersey-numbers/members/{paula['id']}/reopen", json={}
        )
    ).json()["number"] is None
    flow.act_as(paula)
    assert (await flow.get(URL)).json()["can_choose"] is True

    # Austritt, auf der Website eingetragen: Max' 5 ist sofort frei.
    flow.act_as(admin)
    assert (
        await flow.put(
            f"/api/membership/user/{max_['id']}", json={"member_status": "former"}
        )
    ).status_code == 200
    assert (
        await flow.post("/api/admin/jersey-numbers/check", json={"number": "5"})
    ).json()["free"] is True
    flow.act_as(paula)

    # Alle vergeben: das steht gleich da.
    flow.act_as(admin)
    await flow.put(
        "/api/admin/jersey-numbers/settings", json={"min": 5, "max": 6, "reserved": []}
    )
    lena, tom = await member(flow, "lena"), await member(flow, "tom")
    await flow.put(
        f"/api/admin/jersey-numbers/members/{lena['id']}", json={"number": 5}
    )
    await flow.put(f"/api/admin/jersey-numbers/members/{tom['id']}", json={"number": 6})
    flow.act_as(paula)
    assert (await flow.get(URL)).json()["free_count"] == 0

    # Nur der Vorstand.
    assert (await flow.get("/api/admin/jersey-numbers")).status_code == 403


@pytest.mark.asyncio
async def test_two_members_pressing_at_the_same_time_get_one_number(flow):
    paula, max_ = await member(flow, "paula"), await member(flow, "max")

    # Gleichzeitig dieselbe Nummer: der eindeutige Index lässt nur eine Zeile zu.
    await flow.db.jersey_numbers.insert_one(
        {
            "id": "pre",
            "user_id": max_["id"],
            "number": None,
            "can_choose": True,
            "log": [],
        }
    )
    results = await asyncio.gather(
        jersey_numbers.choose(flow.db, paula, 23, True),
        jersey_numbers.choose(flow.db, max_, 23, True),
        return_exceptions=True,
    )
    winners = [r for r in results if isinstance(r, dict)]
    losers = [r for r in results if isinstance(r, jersey_numbers.JerseyError)]
    assert len(winners) == 1 and len(losers) == 1 and losers[0].status == 409
    assert await flow.db.jersey_numbers.count_documents({"number_key": "23"}) == 1
    # Und ganz unten: auch an der Prüfung vorbei schützt der Index.
    holder = await flow.db.jersey_numbers.find_one({"number_key": "23"})
    other = max_ if holder["user_id"] == paula["id"] else paula
    with pytest.raises(jersey_numbers.JerseyError) as race:
        await jersey_numbers._claim(
            flow.db, other["id"], 23, actor="member", action="chosen", only_if_open=True
        )
    assert race.value.status == 409 and "gerade jemand" in race.value.detail
    # Doppelklick desselben Mitglieds: beide Antworten nennen dieselbe Nummer.
    third = await member(flow, "lena")
    both = await asyncio.gather(
        choose_number(flow, third, 24), choose_number(flow, third, 24)
    )
    assert [r.status_code for r in both] == [200, 200] and {
        r.json()["number"] for r in both
    } == {24}


async def choose_number(flow, user, number):
    flow.act_as(user)
    return await flow.post(URL, json={"number": number, "confirmed": True})


@pytest.mark.asyncio
async def test_dolibarr_field_is_read_written_and_caught_up(flow, fake):
    await connect(flow)
    paula, max_ = await member(flow, "paula"), await member(flow, "max")
    await link(flow, paula, 12)
    await link(flow, max_, 14)
    fake.add_core_member(12)
    fake.add_core_member(
        13, options={"trikotnummer": "10"}
    )  # Mitglied ohne Website-Konto
    fake.add_core_member(
        15, statut="0", options={"trikotnummer": "11"}
    )  # ausgetreten: zählt nicht mehr
    fake.add_core_member(14)
    fake.define_member_extrafield("trikotnummer")

    flow.act_as(paula)
    assert (await flow.post(f"{URL}/check", json={"number": "10"})).json()[
        "reason"
    ] == "taken"
    assert (await flow.post(f"{URL}/check", json={"number": "11"})).json()[
        "free"
    ] is True
    view = (await flow.post(URL, json={"number": 11, "confirmed": True})).json()
    assert view["number"] == 11 and view["dolibarr"]["state"] == "ok"
    assert fake.member_puts[-1] == (12, {"array_options": {"options_trikotnummer": 11}})
    assert fake.core_members[12]["array_options"]["options_trikotnummer"] == 11

    # Feld fehlt (anderer Name eingestellt): klare Meldung, Nummer bleibt gesichert, der Abgleich trägt nach.
    admin = await board(flow)
    flow.act_as(admin)
    await flow.put(
        "/api/admin/jersey-numbers/settings", json={"dolibarr_field": "rueckennummer"}
    )
    flow.act_as(max_)
    view = (await flow.post(URL, json={"number": 12, "confirmed": True})).json()
    assert view["number"] == 12 and view["dolibarr"]["state"] == "field_missing"
    flow.act_as(admin)
    overview = (await flow.get("/api/admin/jersey-numbers")).json()
    max_row = next(row for row in overview["rows"] if row["user_id"] == max_["id"])
    assert "„rueckennummer“" in max_row["dolibarr"]["text"]
    fake.define_member_extrafield("rueckennummer")
    counts = (await flow.post("/api/admin/jersey-numbers/sync")).json()["counts"]
    assert counts == {"ok": 2}  # Max nachgetragen, Paula unter dem neuen Feldnamen
    assert fake.core_members[14]["array_options"]["options_rueckennummer"] == 12
    assert fake.core_members[12]["array_options"]["options_rueckennummer"] == 11

    # Dolibarr nicht erreichbar: die Wahl gilt trotzdem, nichts geht verloren.
    await flow.put(
        "/api/admin/jersey-numbers/settings", json={"dolibarr_field": "trikotnummer"}
    )
    await jersey_numbers.sync_pending(flow.db)
    lena = await member(flow, "lena")
    await link(flow, lena, 16)
    fake.add_core_member(16)
    fake.define_member_extrafield("trikotnummer")
    fake.fail_with = 503
    flow.act_as(lena)
    view = (await flow.post(URL, json={"number": 20, "confirmed": True})).json()
    assert (
        view["number"] == 20
        and view["dolibarr"]["state"] == "failed"
        and "gesichert" in view["dolibarr"]["text"]
    )
    fake.fail_with = None
    await jersey_numbers.sync_pending(flow.db)
    assert fake.core_members[16]["array_options"]["options_trikotnummer"] == 20
    flow.act_as(admin)
    overview = (await flow.get("/api/admin/jersey-numbers")).json()
    assert overview["dolibarr_only"] == [{"number": 10, "member_id": 13}]
    assert {row["number"]: row["dolibarr"]["state"] for row in overview["rows"]} == {
        11: "ok",
        12: "ok",
        20: "ok",
    }


@pytest.mark.asyncio
async def test_number_already_in_dolibarr_is_taken_over_and_write_switch_is_respected(
    flow, fake
):
    await connect(flow, write=False)
    paula = await member(flow, "paula")
    await link(flow, paula, 12)
    fake.add_core_member(12, options={"trikotnummer": "4"})
    fake.define_member_extrafield("trikotnummer")
    flow.act_as(paula)
    view = (await flow.get(URL)).json()
    assert (
        view["number"] == 4
        and view["can_choose"] is False
        and view["set_by"] == "dolibarr"
        and view["dolibarr"]["state"] == "ok"
    )

    max_ = await member(flow, "max")
    await link(flow, max_, 14)
    fake.add_core_member(14)
    fake.define_member_extrafield("trikotnummer")
    flow.act_as(max_)
    view = (await flow.post(URL, json={"number": 5, "confirmed": True})).json()
    assert view["dolibarr"]["state"] == "read_only" and fake.member_puts == []


@pytest.mark.asyncio
async def test_exit_and_account_erasure_free_the_number_at_once(flow, fake):
    await connect(flow)
    paula, max_ = await member(flow, "paula"), await member(flow, "max")
    await link(flow, paula, 12)
    fake.add_core_member(12)
    fake.add_core_member(14)
    fake.define_member_extrafield("trikotnummer")
    await link(flow, max_, 14)
    flow.act_as(paula)
    await flow.post(URL, json={"number": 3, "confirmed": True})
    await flow.post(f"{URL}/requests", json={"wished": 4, "reason": "Lieber die 4"})
    flow.act_as(max_)
    await flow.post(URL, json={"number": 9, "confirmed": True})
    assert fake.core_members[14]["array_options"]["options_trikotnummer"] == 9

    # Austritt in Dolibarr, vom Abgleich übernommen: sofort frei, offener Antrag erledigt, in Dolibarr gelöscht.
    settings = await dolibarr_client.load_settings(flow.db)
    paula_link = await flow.db.dolibarr_links.find_one(
        {"user_id": paula["id"]}, {"_id": 0}
    )
    assert (
        await dolibarr_sync.apply_summary(
            flow.db, settings, paula_link, summary(12, status="terminated")
        )
        == "applied"
    )
    doc = await flow.db.jersey_numbers.find_one({"user_id": paula["id"]})
    assert (
        doc["number"] is None
        and "number_key" not in doc
        and doc["log"][-1]["action"] == "released_exit"
    )
    assert fake.core_members[12]["array_options"]["options_trikotnummer"] is None
    assert (await flow.db.jersey_number_requests.find_one({"user_id": paula["id"]}))[
        "status"
    ] == "rejected"
    flow.act_as(paula)
    assert (await flow.get(URL)).json()["available"] is False

    # Kontolöschung: Zeile und Anträge weg, in Dolibarr gelöscht - die 9 ist sofort wieder wählbar.
    await account_erasure.erase_related(flow.db, max_, "2026-10-26T10:00:00+00:00")
    assert (
        await flow.db.jersey_numbers.count_documents({}) == 1
    )  # nur Paulas (ohne Nummer)
    assert fake.core_members[14]["array_options"]["options_trikotnummer"] is None

    # Ist Dolibarr bei der Löschung nicht erreichbar, bleibt nur die Mitglieds-ID ohne Konto -
    # und die Nummer ist trotzdem frei.
    lena, tom = await member(flow, "lena"), await member(flow, "tom")
    await link(flow, lena, 16)
    fake.add_core_member(16)
    fake.define_member_extrafield("trikotnummer")
    flow.act_as(lena)
    await flow.post(URL, json={"number": 9, "confirmed": True})
    fake.fail_with = 503
    await account_erasure.erase_related(flow.db, lena, "2026-10-26T10:00:00+00:00")
    orphan = await flow.db.jersey_numbers.find_one({"orphan": True}, {"_id": 0})
    assert (
        "user_id" not in orphan
        and orphan["number"] is None
        and orphan["log"] == []
        and orphan["dolibarr"]["member_id"] == 16
    )
    fake.fail_with = None
    jersey_numbers.reset_cache()
    flow.act_as(tom)
    assert (await flow.post(f"{URL}/check", json={"number": "9"})).json()[
        "free"
    ] is True
    await jersey_numbers.sync_pending(flow.db)
    assert await flow.db.jersey_numbers.count_documents({"orphan": True}) == 0
    assert fake.core_members[16]["array_options"]["options_trikotnummer"] is None


# ---------------------------------------------------------------- Codex-Prüfung (#2034)


@pytest.mark.asyncio
async def test_two_board_decisions_on_one_request_only_one_acts(flow, monkeypatch):
    """Zuerst wird der Antrag beansprucht, dann die Nummer geändert: eine zweite, gleichzeitige Entscheidung ändert
    nichts und bekommt 409."""
    paula = await member(flow, "paula")
    admin = await board(flow)
    flow.act_as(paula)
    await flow.post(URL, json={"number": 7, "confirmed": True})
    row = (
        await flow.post(f"{URL}/requests", json={"wished": 8, "reason": "Lieber die 8"})
    ).json()

    original = jersey_numbers.set_number
    inner: list = []

    async def racing_set_number(db, actor, user_id, raw, note=""):
        try:
            inner.append(await jersey_numbers.decide(db, actor, row["id"], "reopen"))
        except jersey_numbers.JerseyError as exc:
            inner.append(exc)
        return await original(db, actor, user_id, raw, note)

    monkeypatch.setattr(jersey_numbers, "set_number", racing_set_number)
    done = await jersey_numbers.decide(flow.db, admin, row["id"], "approve")
    assert done["status"] == "applied"
    assert isinstance(inner[0], jersey_numbers.JerseyError) and inner[0].status == 409
    doc = await flow.db.jersey_numbers.find_one({"user_id": paula["id"]})
    assert doc["number"] == 8 and doc["can_choose"] is False

    # Scheitert die Freigabe (Wunsch inzwischen vergeben), bleibt der Antrag offen.
    monkeypatch.setattr(jersey_numbers, "set_number", original)
    flow.act_as(paula)
    second = (
        await flow.post(f"{URL}/requests", json={"wished": 9, "reason": "Doch die 9"})
    ).json()
    max_ = await member(flow, "max")
    flow.act_as(max_)
    await flow.post(URL, json={"number": 9, "confirmed": True})
    with pytest.raises(jersey_numbers.JerseyError):
        await jersey_numbers.decide(flow.db, admin, second["id"], "approve")
    assert (await flow.db.jersey_number_requests.find_one({"id": second["id"]}))[
        "status"
    ] == "received"


@pytest.mark.asyncio
async def test_catch_up_never_writes_an_older_number_to_dolibarr(
    flow, fake, monkeypatch
):
    await connect(flow)
    paula = await member(flow, "paula")
    await link(flow, paula, 12)
    fake.add_core_member(12)
    fake.define_member_extrafield("trikotnummer")
    admin = await board(flow)

    # Der Job hat 7 als ausstehend gelesen; inzwischen setzt der Vorstand 8 und schreibt sie.
    fake.fail_with = 503
    flow.act_as(paula)
    await flow.post(URL, json={"number": 7, "confirmed": True})
    fake.fail_with = None
    snapshot = await flow.db.jersey_numbers.find_one(
        {"user_id": paula["id"]}, {"_id": 0}
    )
    flow.act_as(admin)
    await flow.put(
        f"/api/admin/jersey-numbers/members/{paula['id']}", json={"number": 8}
    )
    assert fake.core_members[12]["array_options"]["options_trikotnummer"] == 8
    assert await jersey_numbers._push(flow.db, snapshot) == "ok"
    assert fake.core_members[12]["array_options"]["options_trikotnummer"] == 8

    # Ändert sich der Spiegel, während der Job schreibt, landet am Ende trotzdem der neue Wert in Dolibarr.
    original = dolibarr_client.DolibarrClient.set_member_extrafield
    calls = {"n": 0}

    async def slow_write(self, member_id, code, value):
        calls["n"] += 1
        if calls["n"] == 1:
            await jersey_numbers.set_number(flow.db, admin, paula["id"], 9)
        return await original(self, member_id, code, value)

    monkeypatch.setattr(
        dolibarr_client.DolibarrClient, "set_member_extrafield", slow_write
    )
    await flow.db.jersey_numbers.update_one(
        {"user_id": paula["id"]}, {"$set": {"dolibarr.state": "pending"}}
    )
    await jersey_numbers.sync_pending(flow.db)
    doc = await flow.db.jersey_numbers.find_one({"user_id": paula["id"]})
    assert (
        doc["number"] == 9
        and doc["dolibarr"]["state"] == "ok"
        and doc["dolibarr"]["value"] == 9
    )
    assert fake.core_members[12]["array_options"]["options_trikotnummer"] == 9


@pytest.mark.asyncio
async def test_number_follows_the_account_when_the_link_changes(flow, fake):
    await connect(flow)
    paula = await member(flow, "paula")
    await link(flow, paula, 12)
    fake.add_core_member(12)
    fake.add_core_member(14)
    fake.define_member_extrafield("trikotnummer")
    flow.act_as(paula)
    await flow.post(URL, json={"number": 11, "confirmed": True})
    assert fake.core_members[12]["array_options"]["options_trikotnummer"] == 11

    # Entkoppeln: das Konto behält die 11, beim alten Mitglied ist sie gelöscht.
    admin = await board(flow)
    flow.act_as(admin)
    unlinked = await flow.delete(f"/api/admin/dolibarr/links/{paula['id']}")
    assert unlinked.status_code == 200
    assert fake.core_members[12]["array_options"]["options_trikotnummer"] is None
    doc = await flow.db.jersey_numbers.find_one({"user_id": paula["id"]})
    assert (
        doc["number"] == 11
        and doc["dolibarr"]["state"] == "no_member"
        and doc["pending_clears"] == []
    )

    # Neue Zuordnung: die 11 steht beim neuen Mitglied.
    await link(flow, paula, 14)
    assert fake.core_members[14]["array_options"]["options_trikotnummer"] == 11
    doc = await flow.db.jersey_numbers.find_one({"user_id": paula["id"]})
    assert doc["dolibarr"]["state"] == "ok" and doc["dolibarr"]["member_id"] == 14

    # Schreiben aus: das Löschen beim alten Mitglied wartet als Nachtrag, die Nummer gilt dort trotzdem nicht mehr.
    await flow.db.settings.update_one(
        {"id": "dolibarr"}, {"$set": {"write_enabled": False}}
    )
    link_doc = await flow.db.dolibarr_links.find_one(
        {"user_id": paula["id"]}, {"_id": 0}
    )
    from services.dolibarr_links import close_link

    await close_link(flow.db, link_doc, status="revoked", actor_id=admin["id"])
    doc = await flow.db.jersey_numbers.find_one({"user_id": paula["id"]})
    assert (
        doc["pending_clears"] == [{"member_id": 14, "value": 11}]
        and fake.core_members[14]["array_options"]["options_trikotnummer"] == 11
    )
    await flow.db.settings.update_one(
        {"id": "dolibarr"}, {"$set": {"write_enabled": True}}
    )
    await jersey_numbers.sync_pending(flow.db)
    assert fake.core_members[14]["array_options"]["options_trikotnummer"] is None
    assert (await flow.db.jersey_numbers.find_one({"user_id": paula["id"]}))[
        "pending_clears"
    ] == []


@pytest.mark.asyncio
async def test_check_takes_the_number_in_the_body_and_the_page_lists_free_numbers(flow):
    paula, max_ = await member(flow, "paula"), await member(flow, "jonas")
    admin = await board(flow)
    flow.act_as(admin)
    await flow.put(
        "/api/admin/jersey-numbers/settings", json={"min": 1, "max": 6, "reserved": [3]}
    )
    flow.act_as(max_)
    await flow.post(URL, json={"number": 5, "confirmed": True})
    flow.act_as(paula)
    # Keine Nummer in der Adresse - also nicht im Zugriffsprotokoll.
    assert (await flow.get(f"{URL}/check", params={"number": "5"})).status_code == 405
    assert (await flow.post(f"{URL}/check", json={"number": 5})).json()[
        "reason"
    ] == "taken"
    view = (await flow.get(URL)).json()
    assert view["free_numbers"] == [1, 2, 4, 6] and view["free_count"] == 4
    assert "jonas" not in str(view) and max_["id"] not in str(view)
    # Bei sehr großen Bereichen nur die Zahl.
    flow.act_as(admin)
    await flow.put(
        "/api/admin/jersey-numbers/settings",
        json={"min": 0, "max": 999, "reserved": []},
    )
    flow.act_as(paula)
    view = (await flow.get(URL)).json()
    assert view["free_numbers"] is None and view["free_count"] == 999


# ---------------------------------------------------------------- Codex-Nachprüfung (#2034)


@pytest.mark.asyncio
async def test_a_decision_that_never_finished_frees_the_request_again(flow):
    """Stürzt der Prozess nach dem Beanspruchen ab, bleibt der Antrag nicht für immer „in Entscheidung“."""
    from datetime import timedelta

    from models import now_utc

    paula = await member(flow, "paula")
    admin = await board(flow)
    flow.act_as(paula)
    await flow.post(URL, json={"number": 7, "confirmed": True})
    row = (
        await flow.post(f"{URL}/requests", json={"wished": 8, "reason": "Lieber die 8"})
    ).json()

    # Frisch beansprucht: eine zweite Entscheidung wartet (409).
    fresh = (now_utc() - timedelta(minutes=1)).isoformat()
    await flow.db.jersey_number_requests.update_one(
        {"id": row["id"]},
        {"$set": {"status": "deciding", "claim": "x", "claimed_at": fresh}},
    )
    with pytest.raises(jersey_numbers.JerseyError) as busy:
        await jersey_numbers.decide(flow.db, admin, row["id"], "approve")
    assert busy.value.status == 409

    # Verwaist (älter als fünf Minuten): der Job gibt den Antrag wieder frei - mit Verlauf und Protokoll.
    old = (now_utc() - timedelta(minutes=6)).isoformat()
    await flow.db.jersey_number_requests.update_one(
        {"id": row["id"]}, {"$set": {"claimed_at": old}}
    )
    await jersey_numbers.sync_pending(flow.db)
    reset = await flow.db.jersey_number_requests.find_one({"id": row["id"]})
    assert reset["status"] == "received" and "claim" not in reset
    doc = await flow.db.jersey_numbers.find_one({"user_id": paula["id"]})
    assert doc["log"][-1]["action"] == "decision_reset"
    assert await flow.db.audit_logs.find_one({"action": "jersey_number.request_reset"})

    # Und auch ohne Job darf der Vorstand eine verwaiste Entscheidung neu treffen.
    await flow.db.jersey_number_requests.update_one(
        {"id": row["id"]},
        {"$set": {"status": "deciding", "claim": "y", "claimed_at": old}},
    )
    done = await jersey_numbers.decide(flow.db, admin, row["id"], "approve")
    assert done["status"] == "applied"
    assert (await flow.db.jersey_numbers.find_one({"user_id": paula["id"]}))[
        "number"
    ] == 8


@pytest.mark.asyncio
async def test_old_member_is_only_cleared_if_our_number_is_still_there(flow, fake):
    await connect(flow, write=False)
    paula = await member(flow, "paula")
    await link(flow, paula, 12)
    fake.add_core_member(12, options={"trikotnummer": "11"})
    fake.define_member_extrafield("trikotnummer")
    flow.act_as(paula)
    view = (await flow.get(URL)).json()  # übernimmt die 11 aus Dolibarr
    assert view["number"] == 11

    # Zuordnung gelöst, Schreiben aus: das Löschen beim alten Mitglied wartet.
    from services.dolibarr_links import close_link

    link_doc = await flow.db.dolibarr_links.find_one(
        {"user_id": paula["id"]}, {"_id": 0}
    )
    await close_link(flow.db, link_doc, status="revoked", actor_id="vorstand")
    doc = await flow.db.jersey_numbers.find_one({"user_id": paula["id"]})
    assert doc["pending_clears"] == [{"member_id": 12, "value": 11}]

    # Inzwischen vergibt der Vorstand in Dolibarr dem Mitglied 12 eine andere Nummer: die bleibt stehen.
    fake.core_members[12]["array_options"]["options_trikotnummer"] = 4
    await flow.db.settings.update_one(
        {"id": "dolibarr"}, {"$set": {"write_enabled": True}}
    )
    await jersey_numbers.sync_pending(flow.db)
    assert fake.core_members[12]["array_options"]["options_trikotnummer"] == 4
    assert fake.member_puts == []
    doc = await flow.db.jersey_numbers.find_one({"user_id": paula["id"]})
    assert doc["pending_clears"] == [] and doc["log"][-1]["action"] == "clear_skipped"
