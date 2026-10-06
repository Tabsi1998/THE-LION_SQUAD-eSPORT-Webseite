"""Katalog D, Rest (#615): Versammlungsbesucher, Mitgliederstimme, Helfer, Helferstunden und „Überall dabei“ - durch die
echte Anwendung und gegen die Attrappe des Vereinsmoduls.

Für die Erfolge fragt die Website Dolibarr nicht eigens: Sie zählt mit, wo sie die Daten der Person ohnehin liest
(Versammlungen, Abstimmungs-Popup, Reiter „Ehrungen & Teilnahmen“), und liest die Teilnahmen im stündlichen Lauf nach -
je Mitglied höchstens einmal am Tag. Behalten werden nur Zahlen und Zeitpunkte; wie jemand abgestimmt hat, steht
nirgends. Fällt Dolibarr aus, bleibt der letzte Stand.
"""
import json
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import achievement_catalog as catalog  # noqa: E402
import badges  # noqa: E402
from dolibarr_fake import (API_KEY, BASE_URL, FakeDolibarr,  # noqa: E402
                           ballot_right, member, pin_club_clock)
from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import achievement_counters as counters  # noqa: E402
from services import (achievement_queue, dolibarr_client,  # noqa: E402
                      dolibarr_identity, member_activity)
from services.secret_store import encrypt_secret  # noqa: E402

GV = 5
PARTICIPATIONS = "/vereine/me/participations"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fake(monkeypatch):
    instance = FakeDolibarr()
    monkeypatch.setattr(dolibarr_client, "_transport", instance.transport())
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    # Die Termine der Attrappe sind fest (25.09.2026) - also steht auch die Uhr des Vereins fest.
    pin_club_clock(monkeypatch)
    # Die Warteschlange der Auswertung wartet sonst fünf Sekunden.
    monkeypatch.setattr(achievement_queue, "EVAL_DELAY_SECONDS", -1)
    dolibarr_identity.reset_cache()
    return instance


async def connect(flow, *, mode="live", module="1.9.0"):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": mode, "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY),
        "instance": "verein", "entity": 1,
    }}, upsert=True)
    await flow.db.settings.update_one({"id": "dolibarr_sync_state"}, {"$set": {"id": "dolibarr_sync_state", "module_version": module}}, upsert=True)


async def person(flow, fake, name: str, member_id: int | None, *, status: str = "active", **fields) -> dict:
    """Ein Konto - mit Mitgliedsnummer als Mitglied des Vereins, der Akte bestätigt zugeordnet."""
    user = await flow.add_user(role="player", name=name)
    if fields:
        await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
        user.update(fields)
    if member_id:
        fake.add(member(member_id, firstname=name.capitalize()))
        await flow.db.dolibarr_links.insert_one({"id": f"l-{name}", "user_id": user["id"], "instance": "verein:1", "member_key": f"verein:1:{member_id}",
                                                 "member_id": member_id, "member_ref": str(member_id), "status": "verified"})
        await flow.db.memberships.insert_one({"user_id": user["id"], "member_status": status, "first_name": name.capitalize(), "last_name": "Beispiel"})
    return user


async def record(flow, user: dict) -> dict:
    """Was die Website aus der Vereinsakte behalten hat - das Unterdokument im Stand der Zähler."""
    doc = await flow.db.user_achievement_stats.find_one({"user_id": user["id"]}, {"_id": 0}) or {}
    return doc.get("club") or {}


async def value(user: dict, key: str) -> int:
    return (await counters.compute(user["id"], {key}, legacy=False))[key]


async def earned(flow, user: dict) -> set[str]:
    return {row["tier_code"] async for row in flow.db.user_achievements.find({"user_id": user["id"]}, {"_id": 0, "tier_code": 1})}


async def drain() -> None:
    """Die Warteschlange leeren - eine Vergabe merkt die Person selbst noch einmal vor."""
    for _ in range(10):
        if not (await achievement_queue.process_queue())["evaluated"]:
            return
    raise AssertionError("die Warteschlange wird nicht leer")


async def settle(flow) -> None:
    """Die Einlässe sind älter als die Frist, in der ein Versehen am Eingang zurückgenommen wird."""
    old = (now_utc() - timedelta(minutes=member_activity.ADMISSION_SETTLE_MINUTES + 1)).isoformat()
    await flow.db.meeting_admissions.update_many({}, {"$set": {"updated_at": old}})


def shift(title: str, day: str, hours) -> dict:
    """Ein bestätigter Helferdienst, wie das Vereinsmodul ihn unter den Teilnahmen führt."""
    return {"kind": "shift", "kind_label": "Helferdienst", "title": title, "day": day, "hours": hours, "source": "shift", "external_id": ""}


def asked(fake) -> list[int]:
    """Für welche Mitglieder die Website die Teilnahmen bei Dolibarr geholt hat - in dieser Reihenfolge."""
    return [int(params["member_id"]) for path, params in fake.calls if path == PARTICIPATIONS and params.get("member_id")]


# ---------------------------------------------------------------- Versammlung und Abstimmungen

@pytest.mark.asyncio
async def test_assembly_counts_attendance_and_votes_but_never_the_answer(flow, fake):
    await connect(flow)
    otto = await person(flow, fake, "otto", 7, areas=["club"])
    paula = await person(flow, fake, "paula", 12)
    carl = await person(flow, fake, "carl", 13)
    dora = await person(flow, fake, "dora", 14)
    fake.board_today = {7}
    fake.add_meeting(GV, day=fake.today, invited=[(7, True), (12, True), (13, False), (14, True)])
    fake.add_ballot(3, GV, item=3, kind="election", question="Wahl der Obfrau", status="open",
                    options=[{"code": "kandidatin-b", "label": "Kandidatin B"}, {"code": "kandidat-a", "label": "Kandidat A"}])
    fake.add_ballot(4, GV, item=4, question="Mitgliedsbeitrag 2027", status="open")
    fake.add_ballot(6, GV, item=6, question="Vertagt", status="open")

    # Lesen allein: keine Zahl, kein Eintrag, keine Auswertung.
    flow.act_as(paula)
    assert (await flow.get("/api/membership/me/meetings")).json()["ballots_reason"] is None
    assert (await flow.get("/api/membership/me/ballots/open")).json()["available"] is True
    assert await record(flow, paula) == {} and await flow.db.achievement_eval_queue.count_documents({}) == 0

    # Einlass: Paulas Karte wird gescannt, Carl kommt ohne Karte über die Mitgliedsnummer.
    card = (await flow.get("/api/account/member-card")).json()
    assert card["status"] == "valid", card
    flow.act_as(otto)
    assert (await flow.post(f"/api/admin/admission/{GV}/scan", json={"code": card["verify_url"]})).status_code == 200
    assert (await flow.post(f"/api/admin/admission/{GV}/scan", json={"number": "13"})).status_code == 200
    # Ein ganz frischer Einlass zählt noch nicht - ein Versehen am Eingang ist in dieser Zeit zurückgenommen.
    assert await value(paula, "meetings_attended") == 0
    await settle(flow)
    assert await value(paula, "meetings_attended") == 1
    assert await value(carl, "meetings_attended") == 1, "ohne Karte eingelassen: zählt über die Mitgliedsnummer"
    assert await value(dora, "meetings_attended") == 0
    undone = await flow.post(f"/api/admin/admission/{GV}/undo", json={"member_id": 13, "reason": "falscher Ausweis"})
    assert undone.status_code == 200 and await value(carl, "meetings_attended") == 0, "zurückgenommen zählt nicht"

    # Paula stimmt ab. Das Popup lädt danach neu - damit steht die Zahl da, und die Auswertung ist vorgemerkt.
    flow.act_as(paula)

    async def vote(ballot: int, right: int, option: str) -> int:
        return (await flow.post(f"/api/membership/me/ballots/{ballot}/votes", json={"right_id": right, "option": option})).status_code

    assert await vote(3, 1012, "kandidatin-b") == 200
    assert (await flow.get("/api/membership/me/ballots/open")).status_code == 200
    kept = await record(flow, paula)
    assert (kept["votes"], kept["meetings"]) == (1, 1) and kept["votes_at"]
    assert set(kept) == {"votes", "meetings", "votes_at"}, "nur Zahlen und ein Zeitpunkt"
    queued = await flow.db.achievement_eval_queue.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert queued["sources"] == ["club"] and queued["reason"] == "member_votes"

    # Eine Vollmacht in derselben Abstimmung ist eine zweite Stimme, aber dieselbe Abstimmung - sie zählt einmal.
    fake.ballot_rights[3][12].append(ballot_right(2020, for_="proxy", name="Anna Muster", reason="proxy"))
    assert await vote(3, 2020, "kandidat-a") == 200
    assert await vote(4, 1012, "yes") == 200
    assert await vote(6, 1012, "no") == 200
    fake.set_ballot_status(6, "cancelled")
    assert (await flow.get("/api/membership/me/meetings")).status_code == 200
    kept = await record(flow, paula)
    assert (kept["votes"], kept["meetings"]) == (2, 1), "zwei Abstimmungen (die abgesagte nicht), eine Versammlung"

    # Dora ist anwesend, ohne dass die Website sie eingelassen hat (in Dolibarr eingetragen): ihre Stimme belegt den Besuch.
    fake.present[GV].add(14)
    flow.act_as(dora)
    assert (await flow.post("/api/membership/me/ballots/4/votes", json={"right_id": 1014, "option": "abstain"})).status_code == 200
    assert (await flow.get("/api/membership/me/ballots/open")).status_code == 200
    assert await flow.db.meeting_admissions.count_documents({"member_id": 14}) == 0
    assert (await record(flow, dora))["meetings"] == 1 and await value(dora, "meetings_attended") == 1

    # Carl hat kein Stimmrecht und ist wieder draußen: nichts gezählt, nichts geschrieben.
    flow.act_as(carl)
    assert (await flow.get("/api/membership/me/meetings")).status_code == 200
    assert await record(flow, carl) == {}

    # Die Auswertung vergibt die ersten Stufen - nur an Mitglieder, und Carl bekommt keine.
    result = await achievement_queue.process_queue()
    assert result["evaluated"] == 2 and result["awarded"] >= 4
    assert {"member_votes_1", "meetings_1"} <= await earned(flow, paula)
    assert "member_votes_2" not in await earned(flow, paula), "fünf Abstimmungen sind es noch nicht"
    assert {"member_votes_1", "meetings_1"} <= await earned(flow, dora)
    assert not {code for code in await earned(flow, carl) if code.startswith(("member_votes", "meetings"))}

    # Der Stand der Zähler rechnet neu, ohne die Zahlen aus der Akte zu verlieren.
    values = await counters.refresh(paula["id"])
    assert (values["member_votes_cast"], values["meetings_attended"]) == (2, 1)
    assert (await record(flow, paula))["votes"] == 2

    # Eine frühere Versammlung mit Stimme zählt mit - jede Versammlung einmal.
    fake.add_meeting(2, title="Generalversammlung 2025", day="2025-10-18", status="held", invited=[(12, True)])
    fake.add_ballot(9, 2, status="evaluated", rights={12: [ballot_right(1012, state="used", option="yes")]})
    flow.act_as(paula)
    assert (await flow.get("/api/membership/me/ballots/open")).status_code == 200
    kept = await record(flow, paula)
    assert (kept["votes"], kept["meetings"]) == (3, 2)

    # Dolibarr fällt aus: die Seite nennt den Grund, der letzte Stand bleibt.
    fake.fail_with = 500
    down = (await flow.get("/api/membership/me/meetings")).json()
    assert down["ballots"] == [] and down["ballots_reason"]
    assert (await flow.get("/api/membership/me/ballots/open")).json()["available"] is False
    assert await record(flow, paula) == kept
    assert await value(paula, "member_votes_cast") == 3
    fake.fail_with = None

    # Wie jemand abgestimmt hat, steht nirgends - in keiner Sammlung der Website.
    for name in await flow.db.list_collection_names():
        async for doc in flow.db[name].find({}, {"_id": 0}):
            assert "kandidat" not in json.dumps(doc, default=str).lower(), name
    # In der Auskunft stehen die Zahlen beim Stand der Zähler.
    export = (await flow.get("/api/dsgvo/export-my-data")).json()
    assert export["achievement_counters"]["club"]["votes"] == 3
    assert "kandidat" not in json.dumps(export, default=str).lower()


def test_ballot_numbers_read_only_whether_a_right_is_used():
    used = ballot_right(1012, state="used", option="yes")
    rows = [
        {"id": 1, "meeting_id": 7, "status": "evaluated", "rights": [used, ballot_right(2020, for_="proxy", state="used", option="no")]},
        {"id": 2, "meeting_id": 7, "status": "open", "rights": [ballot_right(1012)]},                                   # noch offen
        {"id": 3, "meeting_id": 8, "status": "closed", "rights": [ballot_right(0, state="none", reason="represented")]},  # vertreten
        {"id": 4, "meeting_id": 8, "status": "cancelled", "rights": [used]},                                             # abgesagt
        {"id": 5, "meeting_id": 9, "secret": True, "status": "closed", "rights": [used]},                                # Stimmzettel erhalten
        "kaputt", {"id": 6, "meeting_id": "x", "status": "closed", "rights": [used, None]},
    ]
    assert member_activity.ballot_numbers(rows) == (3, {7, 9})
    assert member_activity.ballot_numbers([]) == (0, set()) and member_activity.ballot_numbers(None) == (0, set())


# ---------------------------------------------------------------- Helferdienste

@pytest.mark.asyncio
async def test_helper_shifts_and_hours_come_from_the_participations(flow, fake):
    await connect(flow)
    paula = await person(flow, fake, "paula", 12)
    fake.participations[12] = [
        shift("Sommerfest – Ausschank", "2026-07-04", 3.5),
        shift("Sommerfest – Abbau", "2026-07-05", None),   # ohne erfasste Zeit: der Dienst zählt, Stunden nicht
        shift("Herbstfest – Aufbau", fake.today, 3),       # heute: bestätigt, aber noch nicht geleistet - zählt erst morgen
        # Vom Vorstand von Hand als Helferdienst eingetragen.
        {"kind": "shift", "kind_label": "Helferdienst", "title": "Vereinsheim streichen", "day": "2026-05-02", "hours": 2, "source": "dolibarr", "external_id": ""},
        {"kind": "event", "kind_label": "Veranstaltung", "title": "Weihnachtsfeier", "day": "2025-12-19", "hours": 2.5, "source": "dolibarr", "external_id": ""},
        {"kind": "competition", "kind_label": "Wettbewerb", "title": "Sommer-Cup", "day": "2026-07-12", "hours": None, "source": "api", "external_id": "tn.t1.12"},
    ]
    assert member_activity.helper_numbers(fake.participations[12]) == (3, 5.5)
    assert member_activity.helper_numbers(fake.participations[12], today="2026-09-26") == (4, 8.5), "am Tag danach zählt auch der Aufbau"
    assert await value(paula, "helper_shifts_completed") == 0

    # Der Reiter „Ehrungen & Teilnahmen“ liest die Teilnahmen ohnehin - daraus die zwei Zahlen.
    flow.act_as(paula)
    mine = (await flow.get("/api/me/honours")).json()
    assert mine["available"] is True and len(mine["participations"]) == 6
    kept = await record(flow, paula)
    assert (kept["shifts"], kept["hours"]) == (3, 5.5) and kept["shifts_at"]
    assert set(kept) == {"shifts", "hours", "shifts_at"}, "nur Zahlen und ein Zeitpunkt"
    assert await value(paula, "helper_shifts_completed") == 3
    assert await value(paula, "helper_hours") == 5, "volle Stunden zählen"

    result = await achievement_queue.process_queue()
    assert result["evaluated"] == 1
    assert {"helper_shifts_1", "helper_shifts_2", "helper_hours_1"} <= await earned(flow, paula)
    assert "helper_shifts_3" not in await earned(flow, paula) and "helper_hours_2" not in await earned(flow, paula)

    # Noch einmal öffnen ändert nichts und merkt nichts vor; scheitern nur die Teilnahmen, bleibt der letzte Stand.
    await drain()
    await flow.get("/api/me/honours")
    assert await flow.db.achievement_eval_queue.count_documents({}) == 0
    fake.fail_with, fake.fail_paths = 500, {PARTICIPATIONS}
    broken = (await flow.get("/api/me/honours")).json()
    assert broken["available"] is True and broken["participations"] == []
    assert (await record(flow, paula))["shifts"] == 3
    fake.fail_with, fake.fail_paths = None, set()

    # Ohne aktive Mitgliedschaft bleibt die Zahl stehen, eine Stufe gibt es dafür nicht.
    fred = await person(flow, fake, "fred", 15, status="former")
    fake.participations[15] = [shift("Sommerfest – Aufbau", "2026-07-03", 4)]
    flow.act_as(fred)
    await flow.get("/api/me/honours")
    assert (await record(flow, fred))["shifts"] == 1
    await achievement_queue.process_queue()
    assert not {code for code in await earned(flow, fred) if code.startswith("helper_")}


@pytest.mark.asyncio
async def test_the_hourly_run_asks_once_a_day_and_keeps_the_last_state(flow, fake, monkeypatch):
    await connect(flow)
    otto = await person(flow, fake, "otto", 7)
    paula = await person(flow, fake, "paula", 12)
    await person(flow, fake, "fred", 15, status="former")
    await flow.add_user(role="player", name="gast")
    # Dora hängt per Einladungscode an der Akte - ohne die Fähigkeit „Mitgliederakte“ gibt es für sie keinen Abruf.
    dora = await flow.add_user(role="player", name="dora")
    fake.add(member(14, firstname="Dora"))
    await flow.db.memberships.insert_one({"user_id": dora["id"], "member_status": "active"})
    fake.invite("DOCS", 14, capabilities=("documents",))
    flow.act_as(dora)
    assert (await flow.post("/api/membership/me/identity", json={"code": "DOCS"})).json()["status"] == "bound"
    fake.participations[7] = [shift("Sommerfest – Kassa", "2026-07-04", 4), shift("LAN – Aufbau", "2026-08-21", 6)]
    fake.participations[12] = [shift("Sommerfest – Ausschank", "2026-07-04", 3.5)]
    fake.calls.clear()

    # Erster Lauf: jedes aktive Mitglied mit Weg zur Akte einmal - ohne dass jemand eine Seite öffnet.
    result = await member_activity.refresh_due(flow.db)
    assert result == {"ok": True, "refreshed": 2, "changed": 2, "pending": 0}
    assert sorted(asked(fake)) == [7, 12], "kein Abruf für Ehemalige, Gäste oder Konten ohne Fähigkeit"
    assert ((await record(flow, otto))["shifts"], (await record(flow, otto))["hours"]) == (2, 10.0)
    assert await value(paula, "helper_shifts_completed") == 1
    assert (await achievement_queue.process_queue())["evaluated"] == 2
    assert {"helper_shifts_1", "helper_hours_1"} <= await earned(flow, otto)

    # Gleich noch einmal: niemand ist fällig, Dolibarr wird nicht gefragt.
    fake.calls.clear()
    assert await member_activity.refresh_due(flow.db) == {"ok": True, "refreshed": 0, "changed": 0, "pending": 0}
    assert fake.calls == []

    async def aged(user: dict, hours: int) -> None:
        stamp = (now_utc() - timedelta(hours=hours)).isoformat()
        await flow.db.user_achievement_stats.update_one({"user_id": user["id"]}, {"$set": {"club.shifts_at": stamp}})

    # Einen Tag später wieder - gedeckelt je Lauf, wer am längsten nicht gelesen wurde zuerst.
    await aged(otto, 30)
    await aged(paula, 26)
    fake.participations[7].append(shift("Herbstfest – Abbau", "2026-09-20", 2))
    monkeypatch.setattr(member_activity, "REFRESH_BATCH", 1)
    assert await member_activity.refresh_due(flow.db) == {"ok": True, "refreshed": 1, "changed": 1, "pending": 1}
    assert asked(fake) == [7] and (await record(flow, otto))["shifts"] == 3
    monkeypatch.setattr(member_activity, "REFRESH_BATCH", 25)

    # Dolibarr fällt aus: der Lauf hört auf, der letzte Stand bleibt - und beim nächsten Mal ist Paula wieder dran.
    fake.participations[12].append(shift("Herbstfest – Aufbau", "2026-09-19", 3))
    fake.fail_with, fake.fail_paths = 500, {PARTICIPATIONS}
    down = await member_activity.refresh_due(flow.db)
    assert down["ok"] is False and down["error"] == "unavailable" and down["refreshed"] == 0
    assert (await record(flow, paula))["shifts"] == 1
    fake.fail_with, fake.fail_paths = None, set()

    # Fehlt der Website das Recht, im Namen der Mitglieder zu lesen, ist für alle Schluss - und es steht beim Stand der Anbindung.
    fake.members_act_right = False
    denied = await member_activity.refresh_due(flow.db)
    assert denied["ok"] is False and denied["error"] == "forbidden"
    state = await flow.db.settings.find_one({"id": "dolibarr_sync_state"}, {"_id": 0})
    assert state["member_access"]["ok"] is False
    fake.members_act_right = True
    assert (await member_activity.refresh_due(flow.db))["refreshed"] == 1
    assert (await record(flow, paula))["shifts"] == 2
    assert (await flow.db.settings.find_one({"id": "dolibarr_sync_state"}, {"_id": 0}))["member_access"]["ok"] is True

    # Nicht live oder ein Modul vor 1.8.0: gar kein Abruf.
    await aged(otto, 30)
    fake.calls.clear()
    await connect(flow, module="1.7.0")
    assert await member_activity.refresh_due(flow.db) == {"ok": False, "skipped": "module_version"}
    await connect(flow, mode="preview")
    assert await member_activity.refresh_due(flow.db) == {"ok": False, "skipped": "not_live"}
    assert fake.calls == []


@pytest.mark.asyncio
async def test_the_hourly_job_carries_the_helper_refresh(flow, fake):
    """Der Nachlauf hängt am stündlichen Job ``dolibarr_public`` - neben Vereinsdaten, Sponsoren und Ehrungen."""
    from services import scheduler

    await connect(flow)
    otto = await person(flow, fake, "otto", 7)
    fake.participations[7] = [shift("Sommerfest – Kassa", "2026-07-04", 4)]
    await scheduler._safe_dolibarr_public()
    assert asked(fake) == [7]
    assert ((await record(flow, otto))["shifts"], (await record(flow, otto))["hours"]) == (1, 4.0)


# ---------------------------------------------------------------- Überall dabei

@pytest.mark.asyncio
async def test_everywhere_means_every_server_and_grows_with_them(flow):
    paula = await flow.add_user(name="paula")
    servers = ["600000000000000001", "600000000000000002", "600000000000000003", "600000000000000004"]
    await flow.db.discord_guilds.insert_many(
        [{"guild_id": gid, "name": f"Server {index}", "role": "main" if index == 0 else "sub", "enabled": True} for index, gid in enumerate(servers)]
        + [{"guild_id": "600000000000000008", "name": "Aus", "role": "sub", "enabled": False},
           {"guild_id": "600000000000000009", "name": "Verlassen", "role": "sub", "enabled": True, "left_at": "2026-09-01T10:00:00+00:00"}])

    async def join(gid: str, here: bool = True) -> int:
        await flow.db.discord_memberships.update_one({"user_id": paula["id"], "guild_id": gid}, {"$set": {"member": here}}, upsert=True)
        return await value(paula, "discord_servers_stage")

    assert await value(paula, "discord_servers_stage") == 0
    assert await join(servers[0]) == 1
    assert await join(servers[1]) == 1, "zwei Server sind noch nicht drei"
    assert await join("600000000000000008") == 1 and await join("600000000000000009") == 1, "ausgeschaltete und verlassene zählen nicht"
    assert await join(servers[2]) == 2, "drei von vier"
    assert await join(servers[3]) == 3, "alle vier"
    assert await value(paula, "discord_guilds_joined") == 4
    assert "discord" in counters.REGISTRY["discord_servers_stage"].sources, "Beitritt und Austritt rechnen sofort neu"

    assert await badges.evaluate_user_progress(paula["id"], {"discord"}) >= 3
    assert {"discord_servers_1", "discord_servers_2", "discord_servers_3"} <= await earned(flow, paula)

    # „Alle“ wächst mit: kommt ein Server dazu, fehlt wieder einer - die vergebene Stufe bleibt.
    await flow.db.discord_guilds.insert_one({"guild_id": "600000000000000005", "name": "Neu", "role": "sub", "enabled": True})
    assert await value(paula, "discord_servers_stage") == 2
    assert await join(servers[3], here=False) == 2 and await join(servers[2], here=False) == 1
    assert "discord_servers_3" in await earned(flow, paula)

    # Mit weniger als drei Servern gibt es „überall“ noch nicht.
    await flow.db.discord_guilds.update_many({"guild_id": {"$nin": servers[:2]}}, {"$set": {"enabled": False}})
    assert await value(paula, "discord_guilds_joined") == 2 and await value(paula, "discord_servers_stage") == 1


# ---------------------------------------------------------------- Katalog

def test_the_five_groups_sit_where_their_neighbours_sit():
    groups = {g["code"]: g for g in catalog.ACHIEVEMENT_GROUPS}
    tiers: dict[str, list[dict]] = {}
    for tier in catalog.ACHIEVEMENT_TIERS:
        tiers.setdefault(tier["group_code"], []).append(tier)
    club = {
        "meetings": ("Versammlungsbesucher", "meetings_attended", [1, 3, 5, 10, 20]),
        "member_votes": ("Mitgliederstimme", "member_votes_cast", [1, 5, 15, 40, 100]),
        "helper_shifts": ("Helfer", "helper_shifts_completed", [1, 3, 7, 15, 30, 60, 100]),
        "helper_hours": ("Helferstunden", "helper_hours", [5, 20, 50, 100, 250]),
    }
    for code, (name, key, targets) in club.items():
        group = groups[code]
        assert (group["name"], group["category"], group["condition_key"], group["catalog"]) == (name, "club", key, "D")
        assert group["member_only"] is True and all(t["member_only"] for t in tiers[code]), code
        assert [t["progress_target"] for t in tiers[code]] == targets
        assert [t["material"] for t in tiers[code]] == catalog.LADDERS[len(targets)], code
        assert counters.REGISTRY[key].sources == frozenset({"club"}), "wird neu gerechnet, sobald die Akte etwas Neues zeigt"
        assert catalog.CONDITION_KEY_STATUS[key] == "live"
    assert tiers["member_votes"][0]["description"] == "1-mal abgestimmt." and tiers["helper_hours"][0]["description"] == "5 Helferstunden geleistet."
    assert "nie wie" in groups["member_votes"]["how_to"], "die Zusage steht auch für das Mitglied da"

    everywhere = groups["discord_servers"]
    assert (everywhere["name"], everywhere["category"], everywhere["condition_key"], everywhere["catalog"]) == ("Überall dabei", "community", "discord_servers_stage", "C")
    assert not everywhere.get("member_only"), "Discord ist für alle da"
    assert [(t["material"], t["progress_target"]) for t in tiers["discord_servers"]] == [("silver", 1), ("gold", 2), ("diamond", 3)]
    assert tiers["discord_servers"][2]["description"] == "Auf allen Discord-Servern des Vereins dabei."

    # Was es weiter nicht gibt, weil die Daten fehlen - nicht als leere Hülle im Katalog.
    assert not {"lan_crew", "fees_on_time", "supporter", "member_referrer", "votes", "contributor", "ambassador"} & set(groups)
