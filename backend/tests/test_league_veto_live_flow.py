"""Map-Veto live (D.4, #1651; docs/LIGA.md D.4) über die echten Routen: der kurze Abruf ``GET /api/matches/{id}/veto`` für Captains
(wie die Matchseite, mit Ablauf, eigener Seite und Serverzeit), für Zuschauer und TV nur lesend ohne Internes (Sichtbarkeit wie die
Matchseite, mit Anzeige-Schlüssel ohne Anmeldung) und die Erinnerung „Map-Veto wartet“ - einmal je Schritt und Seite, nach 20 Sekunden
ohne Zug und nur, wenn die Seite das Veto nicht offen hat. Erfundene Namen."""
import pathlib
import sys
from datetime import datetime, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from routes import league_veto_routes  # noqa: E402
from services import league_veto, league_veto_sweep  # noqa: E402
from test_league_veto_flow import both_in, lead, mid, page, pick, stored_veto, veto_rules, veto_world  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


async def live(flow, world, user, **params) -> dict:
    flow.act_as(user if isinstance(user, dict) or user is None else world["users"][user])
    answer = await flow.get(f"/api/matches/{mid(world)}/veto", params=params or None)
    assert answer.status_code == 200, answer.text
    return answer.json()


async def live_status(flow, world, user, **params) -> int:
    flow.act_as(user if isinstance(user, dict) or user is None else world["users"][user])
    answer = await flow.get(f"/api/matches/{mid(world)}/veto", params=params or None)
    return answer.status_code


async def nudges(flow) -> list[dict]:
    return await flow.db.notifications.find({"meta.reason": "veto_turn"}, {"_id": 0}).to_list(20)


async def started_world(flow, **rules) -> dict:
    world = await veto_world(flow, rules=veto_rules(**rules))
    await both_in(flow, world)
    return world


# ---------------------------------------------------------------- Captains: derselbe Block, dazu Ablauf und Serverzeit

@pytest.mark.asyncio
async def test_the_short_poll_gives_the_captain_the_page_block_with_plan_side_and_server_time(flow):
    world = await started_world(flow)
    answer = await live(flow, world, "Kapitaen")
    block = answer["veto"]
    assert answer["state"] == "veto" and answer["match"]["sides"] == ["Loewen · Rudel A", "Falken · Horst"]
    assert block["status"] == "running" and block["own_turn"] is True and block["can_pick"] is True and block["own_side"] == "A"
    assert [row["map_id"] for row in block["options"] if row["allowed"]] == ["map-hafen", "map-nebel", "map-turm", "map-glut"]
    # Serverzeit der Antwort: der Countdown rechnet damit statt mit der Uhr des Geräts.
    server_now = datetime.fromisoformat(block["server_now"])
    assert abs((server_now - now_utc()).total_seconds()) < 5 and answer["now"]
    assert 0 < (datetime.fromisoformat(block["current"]["deadline_at"]) - server_now).total_seconds() <= 60
    # Der ganze Ablauf als Zeitleiste: Schritt 1 läuft, die übrigen sind offen - Seite, Modus und Position je Schritt.
    plan = block["plan"]
    assert len(plan) == 11 and [row["state"] for row in plan[:3]] == ["current", "open", "open"]
    assert plan[0] == {"index": 0, "number": 1, "kind": "ban", "mode": "stellung", "mode_label": "Stellung", "side": "A",
                       "name": "Loewen · Rudel A", "position": None, "state": "current", "map_id": None, "map_name": None,
                       "map_image_url": None, "via": None}
    assert plan[10]["kind"] == "decider" and plan[10]["side"] is None and plan[10]["name"] is None and plan[10]["position"] == 3

    moved = await pick(flow, world, "Kapitaen", "map-glut", block["version"])
    assert moved.status_code == 200
    other = (await live(flow, world, "Falke1"))["veto"]
    assert other["own_side"] == "B" and other["own_turn"] is True
    assert other["plan"][0]["state"] == "done" and other["plan"][0]["map_name"] == "Glut" and other["plan"][0]["via"] == "side"
    assert other["plan"][0]["map_image_url"] == "/uploads/maps/glut.webp" and other["plan"][1]["state"] == "current"
    glut = next(row for row in other["remaining"][0]["maps"] if row["map_id"] == "map-glut")
    assert glut["status"] == "banned" and glut["side"] == "A" and glut["by_name"] == "Loewen · Rudel A"
    # Dieselben Felder auf der Matchseite - der Abruf ist nur leichter.
    shown = await page(flow, world, "Falke1")
    assert shown["checkin"]["veto"]["plan"] == other["plan"] and shown["checkin"]["veto"]["own_side"] == "B"


@pytest.mark.asyncio
async def test_the_short_poll_starts_a_due_veto_and_settles_an_expired_step_like_the_page(flow):
    world = await veto_world(flow, rules=veto_rules(step_seconds=30))
    await both_in(flow, world)
    await flow.db.matches_v2.update_one({"id": mid(world)}, {"$set": {"flow.veto.deadline_at": (now_utc() - timedelta(seconds=1)).isoformat()}})
    block = (await live(flow, world, "Falke1"))["veto"]
    assert len(block["history"]) == 1 and block["history"][0]["via"] == "auto" and block["plan"][0]["via"] == "auto"
    assert block["own_turn"] is True, "nach der Zufallswahl für Team A ist Team B am Zug"


# ---------------------------------------------------------------- Zuschauer und TV: nur lesend, nichts Internes

@pytest.mark.asyncio
async def test_spectators_see_the_veto_read_only_without_choice_lead_or_pause_reason(flow):
    world = await started_world(flow)
    version = (await stored_veto(flow, world))["version"]
    moved = await pick(flow, world, "Kapitaen", "map-glut", version)
    assert moved.status_code == 200

    outside = await live(flow, world, "Fremd")
    block = outside["veto"]
    assert outside["state"] is None, "der Stand des Check-ins bleibt bei den Beteiligten"
    assert block["status"] == "running" and block["own_turn"] is False and block["can_pick"] is False and block["own_side"] is None
    assert block["options"] == [] and block["lead"] is None and block["start"] is None and block["blocked"] is None
    assert block["current"]["name"] == "Falken · Horst" and block["plan"][0]["map_name"] == "Glut"
    assert block["history"][0]["name"] == "Loewen · Rudel A" and "by" not in block["history"][0]
    anonymous = (await live(flow, world, None))["veto"]
    assert anonymous["plan"] == block["plan"] and anonymous["remaining"] == block["remaining"] and anonymous["options"] == []
    # Die Matchseite zeigt Zuschauern denselben Block - der Check-in bleibt verborgen.
    shown = await page(flow, world, "Fremd")
    assert shown["checkin"] is None and shown["veto_view"]["status"] == "running" and shown["veto_view"]["options"] == []
    assert shown["veto_view"]["plan"] == block["plan"] and "flow" not in shown["match"]
    # Gegenprobe: Beteiligte bekommen auf der Matchseite den vollen Block, kein zweites.
    involved = await page(flow, world, "Falke1")
    assert involved["veto_view"] is None and involved["checkin"]["veto"]["own_turn"] is True
    # Ziehen kann ein Zuschauer nicht.
    refused = await pick(flow, world, "Fremd", "map-turm", version + 1)
    assert refused.status_code == 403

    # Pause: Zuschauer sehen, dass pausiert ist - den frei geschriebenen Grund nicht.
    held = await lead(flow, world, "pause", version + 1, reason="Störung bei Falken, Router neu")
    assert held.status_code == 200
    paused = (await live(flow, world, "Fremd"))["veto"]
    assert paused["status"] == "paused" and paused["paused"]["reason"] is None and paused["paused"]["remaining_seconds"] > 0
    assert paused["pick_hint"] == league_veto.SPECTATOR_PAUSE_HINT and "Router" not in str(paused)
    own = (await live(flow, world, "Falke1"))["veto"]
    assert own["paused"]["reason"] == "Störung bei Falken, Router neu", "die Seiten sehen den Grund weiter"
    # Der TV (``display=1``) bekommt immer die Zuschauer-Sicht - auch wenn ein Captain ihn öffnet.
    tv = (await live(flow, world, "Falke1", display="1"))["veto"]
    assert tv["paused"]["reason"] is None and tv["own_side"] is None and tv["lead"] is None


async def tv_key(flow, world) -> str:
    admin = await flow.add_user(role="tournament_admin", name="Hallenleitung")
    admin["areas"] = ["leagues"]
    flow.act_as(admin)
    made = await flow.post("/api/tv/keys", json={"tournament_id": world["tournament"]["id"], "label": "Beamer Halle"})
    assert made.status_code == 200, made.text
    return made.json()["token"]


async def answer_of(flow, url: str, **params):
    flow.act_as(None)
    answer = await flow.get(url, params=params or None)
    return answer.status_code, answer.json().get("detail")


@pytest.mark.asyncio
async def test_spectators_only_see_a_visible_staffel_and_the_display_key_opens_it_without_login(flow):
    world = await started_world(flow)
    token = await tv_key(flow, world)
    # Season „Nur Mitglieder“: Die Staffel steht auf „members“ (öffentlich gelistet, Inhalt nur für Mitglieder).
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {"is_public": True, "visibility": "members"}})
    hidden = await live_status(flow, world, None)
    assert hidden in (403, 404), "ohne Anmeldung bleibt eine Staffel „Nur Mitglieder“ verborgen - wie die Matchseite"
    # Beteiligte sehen ihr Spiel weiter.
    own = (await live(flow, world, "Kapitaen"))["veto"]
    assert own["own_turn"] is True

    tv = await live(flow, world, None, key=token)
    assert tv["veto"]["status"] == "running" and tv["veto"]["options"] == [] and tv["state"] is None
    assert tv["match"]["sides"] == ["Loewen · Rudel A", "Falken · Horst"]
    # Gegenprobe: ein falscher Schlüssel und ein unbekanntes Spiel sehen gleich aus - kein Hinweis, ob es das Spiel gibt.
    wrong = await answer_of(flow, f"/api/matches/{mid(world)}/veto", key="kein-gueltiger-schluessel")
    unknown = await answer_of(flow, "/api/matches/gibt-es-nicht/veto", key=token)
    unknown_wrong = await answer_of(flow, "/api/matches/gibt-es-nicht/veto", key="kein-gueltiger-schluessel")
    assert wrong == unknown == unknown_wrong and wrong[0] == 403

    # Auch mit Schlüssel nie: eine interne Staffel (Season aus bzw. nur Verwaltung) und ein Entwurf - wie beim Event-TV.
    for fields in ({"is_public": False, "visibility": "internal"}, {"is_public": True, "visibility": "public", "status": "draft"}):
        await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": fields})
        refused = await answer_of(flow, f"/api/matches/{mid(world)}/veto", key=token)
        assert refused == wrong, fields


@pytest.mark.asyncio
async def test_spectator_polls_are_limited_per_address_and_per_key(flow, monkeypatch):
    world = await started_world(flow)
    token = await tv_key(flow, world)
    monkeypatch.setattr(league_veto_routes, "SPECTATOR_RATE_LIMIT", 3)
    address = ["10.0.0.1"]
    monkeypatch.setattr(league_veto_routes, "get_client_ip", lambda _request: address[0])
    codes = [await live_status(flow, world, "Fremd") for _ in range(4)]
    assert codes == [200, 200, 200, 429], "Zuschauer: höchstens so viele Abrufe je Adresse und Minute"
    # Gegenprobe: Beteiligte fragen unbegrenzt - ihr Abruf ist die Matchseite selbst.
    own = [await live_status(flow, world, "Kapitaen") for _ in range(5)]
    assert own == [200] * 5
    # Ein gültiger Schlüssel zählt nur in seinem eigenen Topf: Hallen-TVs hinter derselben (schon vollen) Adresse laufen weiter, bis
    # der Schlüssel selbst sein Limit erreicht - auch über verschiedene Adressen.
    keyed = [await live_status(flow, world, None, key=token) for _ in range(2)]
    address[0] = "10.0.1.9"
    keyed += [await live_status(flow, world, None, key=token) for _ in range(2)]
    assert keyed == [200, 200, 200, 429]
    key_rows = await flow.db.rate_limits.count_documents({"_id": {"$regex": "^veto_live_key:"}})
    named = await flow.db.rate_limits.count_documents({"_id": {"$regex": token}})
    on_address = await flow.db.rate_limits.count_documents({"_id": {"$regex": r"^veto_live_address:10\.0\.1\.9:"}})
    assert key_rows == 1 and named == 0, "der Zähler nennt den Schlüssel nie"
    assert on_address == 0, "gültige Schlüssel zählen nicht auf die Adresse"
    # Gegenprobe: Ein falscher Schlüssel zählt auf die Adresse - Raten bleibt gebremst.
    address[0] = "10.0.2.1"
    guessed = [await live_status(flow, world, None, key=f"geraten-{number}") for number in range(4)]
    assert guessed == [403, 403, 403, 429]


@pytest.mark.asyncio
async def test_the_spectator_view_is_cached_briefly_but_a_new_move_shows_at_once(flow, monkeypatch):
    world = await started_world(flow)
    built = []
    original = league_veto.live_block

    async def counting(*args, **kwargs):
        built.append(kwargs.get("spectator"))
        return await original(*args, **kwargs)

    monkeypatch.setattr(league_veto, "live_block", counting)
    clock = [1000.0]
    monkeypatch.setattr(league_veto_routes, "_clock", lambda: clock[0])
    first = (await live(flow, world, "Fremd"))["veto"]
    clock[0] += 1
    second = (await live(flow, world, None, display="1"))["veto"]
    assert built == [True], "derselbe Stand: einmal gebaut, für alle Zuschauer"
    assert second["plan"] == first["plan"] and second["version"] == first["version"]
    assert second["server_now"] >= first["server_now"], "die Serverzeit ist die dieses Abrufs"
    # Ein neuer Zug ist sofort da - der Schlüssel des Zwischenspeichers ist der Stand des Spiels.
    moved = await pick(flow, world, "Kapitaen", "map-glut", first["version"])
    assert moved.status_code == 200
    third = (await live(flow, world, "Fremd"))["veto"]
    assert third["plan"][0]["map_name"] == "Glut" and len(built) == 2
    # Nach Ablauf baut der nächste Abruf neu, auch ohne Änderung.
    clock[0] += league_veto_routes.SPECTATOR_CACHE_SECONDS + 0.1
    await live(flow, world, "Fremd")
    assert len(built) == 3
    # Beteiligte gehen nie über den Zwischenspeicher.
    await live(flow, world, "Kapitaen")
    assert len(built) == 4 and not built[-1]


@pytest.mark.asyncio
async def test_a_spectator_read_after_the_deadline_triggers_nothing(flow):
    world = await started_world(flow)
    await flow.db.matches_v2.update_one({"id": mid(world)}, {"$set": {"flow.veto.deadline_at": (now_utc() - timedelta(seconds=2)).isoformat()}})
    outside = (await live(flow, world, "Fremd"))["veto"]
    tv = (await live(flow, world, None, display="1"))["veto"]
    assert outside["history"] == [] and tv["history"] == [] and outside["current"]["remaining_seconds"] == 0
    stored = await stored_veto(flow, world)
    assert stored["steps"] == [] and stored["version"] == 1, "Zuschauer und TV wählen nie - das macht der Job oder die Seite der Beteiligten"
    # Gegenprobe: Der Abruf eines Captains löst die Frist auf.
    own = (await live(flow, world, "Falke1"))["veto"]
    assert len(own["history"]) == 1 and own["history"][0]["via"] == "auto"


@pytest.mark.asyncio
async def test_mark_seen_writes_at_most_every_five_seconds(flow):
    world = await started_world(flow)
    match = await flow.reload(world["match"])
    reg = world["reg_a"]["id"]
    now = now_utc()
    first = await league_veto.mark_seen(flow.db, match, reg, now=now)
    soon = await league_veto.mark_seen(flow.db, match, reg, now=now + timedelta(seconds=4))
    later = await league_veto.mark_seen(flow.db, match, reg, now=now + timedelta(seconds=6))
    assert (first, soon, later) == (True, False, True)
    seen = (await flow.reload(world["match"]))["flow"]["veto_seen"][reg]
    assert seen == (now + timedelta(seconds=6)).isoformat()
    # Ohne laufendes Veto und mit einer unbrauchbaren Kennung schreibt es nichts.
    dotted = await league_veto.mark_seen(flow.db, match, "a.b", now=now + timedelta(seconds=20))
    paused = {**match, "flow": {**match["flow"], "veto": {**match["flow"]["veto"], "status": "paused"}}}
    while_paused = await league_veto.mark_seen(flow.db, paused, reg, now=now + timedelta(seconds=20))
    assert dotted is False and while_paused is False


@pytest.mark.asyncio
async def test_without_veto_rules_the_short_poll_answers_without_block(flow):
    world = await veto_world(flow)
    await both_in(flow, world)
    answer = await live(flow, world, "Fremd")
    assert answer["veto"] is None and answer["match"] is None and answer["now"]
    shown = await page(flow, world, "Fremd")
    assert shown["veto_view"] is None


def test_the_spectator_view_drops_everything_internal():
    block = {"status": "paused", "own_turn": True, "can_pick": True, "own_side": "A", "options": [{"map_id": "x"}], "pick_hint": "Grund intern",
             "lead": {"can_act": True}, "start": {"sides": []}, "blocked": {"text": "fehlt"}, "paused": {"at": "t", "reason": "intern", "remaining_seconds": 9}}
    view = league_veto.spectator_view(block)
    assert view["own_turn"] is False and view["can_pick"] is False and view["own_side"] is None and view["options"] == []
    assert view["lead"] is None and view["start"] is None and view["blocked"] is None
    assert view["paused"] == {"at": "t", "reason": None, "remaining_seconds": 9} and view["pick_hint"] == league_veto.SPECTATOR_PAUSE_HINT
    waiting = league_veto.spectator_view({**block, "status": "waiting", "paused": None, "step_seconds": 60})
    assert waiting["pick_hint"] is None and waiting["step_seconds"] is None and waiting["start"] is None
    assert league_veto.spectator_view(None) is None


# ---------------------------------------------------------------- Erinnerung „Map-Veto wartet“

async def move_deadline(flow, world, seconds_left: float) -> datetime:
    """Die Frist des laufenden Schritts so legen, dass noch ``seconds_left`` bleiben - gibt „jetzt“ zurück."""
    now = now_utc()
    await flow.db.matches_v2.update_one({"id": mid(world)}, {"$set": {"flow.veto.deadline_at": (now + timedelta(seconds=seconds_left)).isoformat()}})
    return now


@pytest.mark.asyncio
async def test_the_side_at_turn_gets_one_reminder_after_twenty_idle_seconds_when_the_veto_is_not_open(flow):
    world = await started_world(flow)
    now = await move_deadline(flow, world, 55)
    early = await league_veto_sweep.nudge(flow.db, now=now)
    assert early == 0 and await nudges(flow) == [], "erst nach 20 Sekunden ohne Zug"
    later = now + timedelta(seconds=20)
    told = await league_veto_sweep.nudge(flow.db, now=later)
    assert told == 1
    rows = await nudges(flow)
    assert [row["user_id"] for row in rows] == [world["users"]["Kapitaen"]["id"]], "nur die Seite am Zug"
    assert rows[0]["title"] == "Map-Veto wartet – ihr seid am Zug" and rows[0]["kind"] == "match_call"
    assert "sperrt eine Map (Stellung)" in rows[0]["body"] and "Noch 35 Sekunden" in rows[0]["body"]
    assert rows[0]["url"] == f"/matches/{mid(world)}" and rows[0]["meta"]["category"] == "match_reminders"
    again = await league_veto_sweep.nudge(flow.db, now=later + timedelta(seconds=10))
    assert again == 0 and len(await nudges(flow)) == 1, "höchstens eine je Schritt und Seite"
    stored = await flow.reload(world["match"])
    assert stored["flow"]["veto"]["version"] == 1 and stored["flow"]["veto"]["step"] == 0, "am Veto ändert sich nichts"
    assert stored["flow"]["veto_nudge"]["key"].endswith(f":0:{world['reg_a']['id']}")

    # Nächster Schritt, andere Seite: wieder eine.
    moved = await pick(flow, world, "Kapitaen", "map-glut", 1)
    assert moved.status_code == 200
    now = await move_deadline(flow, world, 30)
    next_side = await league_veto_sweep.nudge(flow.db, now=now)
    assert next_side == 1
    rows = await nudges(flow)
    assert [row["user_id"] for row in rows][-1] == world["users"]["Falke1"]["id"]


@pytest.mark.asyncio
async def test_after_undo_the_same_step_gets_its_reminder_again_but_not_after_pause_and_resume(flow):
    world = await started_world(flow)
    captain = world["users"]["Kapitaen"]["id"]
    now = await move_deadline(flow, world, 35)
    first = await league_veto_sweep.nudge(flow.db, now=now)
    assert first == 1
    moved = await pick(flow, world, "Kapitaen", "map-glut", 1)
    undone = await lead(flow, world, "undo", 2, reason="Falsche Map angetippt, beide einig")
    assert moved.status_code == 200 and undone.status_code == 200
    stored = await stored_veto(flow, world)
    assert stored["step"] == 0 and stored["version"] == 3
    now = await move_deadline(flow, world, 35)
    again = await league_veto_sweep.nudge(flow.db, now=now)
    assert again == 1, "derselbe Schritt beginnt nach „Schritt zurück“ neu - die Seite bekommt wieder eine Erinnerung"
    rows = await nudges(flow)
    assert [row["user_id"] for row in rows] == [captain, captain]
    assert rows[0]["meta"]["dedupe_key"] != rows[1]["meta"]["dedupe_key"]
    # Gegenprobe: Pause und Fortsetzen sind derselbe Schritt - keine dritte.
    held = await lead(flow, world, "pause", 3)
    resumed = await lead(flow, world, "resume", 4)
    assert held.status_code == 200 and resumed.status_code == 200
    now = await move_deadline(flow, world, 35)
    after_pause = await league_veto_sweep.nudge(flow.db, now=now)
    assert after_pause == 0 and len(await nudges(flow)) == 2


@pytest.mark.asyncio
async def test_no_reminder_while_the_side_has_the_veto_open_and_none_for_pause_or_lock(flow):
    world = await started_world(flow)
    now = await move_deadline(flow, world, 35)
    # Der Captain hat die Seite offen: sein kurzer Abruf merkt das (ohne Person, nur die Seite).
    await live(flow, world, "Kapitaen")
    seen = (await flow.reload(world["match"]))["flow"]["veto_seen"]
    assert list(seen) == [world["reg_a"]["id"]]
    open_page = await league_veto_sweep.nudge(flow.db, now=now + timedelta(seconds=1))
    assert open_page == 0, "die Seite hat das Veto offen"
    # Gegenprobe: Ein Kadermitglied ohne Zugrecht schreibt nichts, die Gegenseite nur für sich.
    await live(flow, world, "Mila")
    await live(flow, world, "Falke1")
    seen = (await flow.reload(world["match"]))["flow"]["veto_seen"]
    assert set(seen) == {world["reg_a"]["id"], world["reg_h"]["id"]}
    # Kein Abruf mehr (Tab im Hintergrund, Seite zu): nach 15 Sekunden gilt das Veto als nicht offen.
    closed = await league_veto_sweep.nudge(flow.db, now=now + timedelta(seconds=16))
    assert closed == 1

    # Pausiert: nichts.
    paused_world = await veto_world(flow, rules=veto_rules(), letter="B")
    await both_in(flow, paused_world)
    held = await lead(flow, paused_world, "pause", 1)
    assert held.status_code == 200
    while_paused = await league_veto_sweep.nudge(flow.db, now=now_utc() + timedelta(seconds=40))
    assert while_paused == 0

    # Gesperrte Staffel: nichts.
    locked_world = await veto_world(flow, rules=veto_rules(), letter="C")
    await both_in(flow, locked_world)
    await flow.db.tournaments.update_one({"id": locked_world["tournament"]["id"]}, {"$set": {"locked_at": now_utc().isoformat()}})
    before = len(await nudges(flow))
    while_locked = await league_veto_sweep.nudge(flow.db, now=now_utc() + timedelta(seconds=40))
    assert while_locked == 0 and len(await nudges(flow)) == before


def test_the_reminder_never_fires_for_system_steps_or_in_the_last_seconds():
    now = now_utc()
    base = {"id": "m1", "started_at": None, "flow": {"veto": {
        "status": "running", "version": 3, "step": 0, "team_a": "ra", "team_b": "rb", "started_at": "s",
        "template": {"step_seconds": 60, "steps": [{"kind": "ban", "mode": "hp", "team": "A", "position": None},
                                                   {"kind": "decider", "mode": "hp", "team": None, "position": 3}]},
        "deadline_at": (now + timedelta(seconds=30)).isoformat()}}}
    target = league_veto.nudge_target(base, now=now)
    assert target["registration_id"] == "ra" and target["key"] == "veto-turn:m1:s:0:0:ra" and target["left"] == 30
    # „Schritt zurück“ oder „Neu starten“ beginnen denselben Schritt neu - eigener Schlüssel; Pause und Fortsetzen nicht.
    undone = {**base, "flow": {"veto": {**base["flow"]["veto"], "lead_log": [{"action": "pause"}, {"action": "resume"}, {"action": "undo"}]}}}
    assert league_veto.nudge_target(undone, now=now)["key"] == "veto-turn:m1:s:1:0:ra"
    decider = {**base, "flow": {"veto": {**base["flow"]["veto"], "step": 1}}}
    assert league_veto.nudge_target(decider, now=now) is None, "Decider setzt das System"
    late = {**base, "flow": {"veto": {**base["flow"]["veto"], "deadline_at": (now + timedelta(seconds=3)).isoformat()}}}
    assert league_veto.nudge_target(late, now=now) is None, "kurz vor Ablauf hilft keine Nachricht mehr"
    early = {**base, "flow": {"veto": {**base["flow"]["veto"], "deadline_at": (now + timedelta(seconds=45)).isoformat()}}}
    assert league_veto.nudge_target(early, now=now) is None, "erst nach 20 Sekunden"
    told = {**base, "flow": {**base["flow"], "veto_nudge": {"key": "veto-turn:m1:s:0:0:ra"}}}
    assert league_veto.nudge_target(told, now=now) is None
    open_page = {**base, "flow": {**base["flow"], "veto_seen": {"ra": (now - timedelta(seconds=3)).isoformat()}}}
    assert league_veto.nudge_target(open_page, now=now) is None
    other_open = {**base, "flow": {**base["flow"], "veto_seen": {"rb": now.isoformat()}}}
    assert league_veto.nudge_target(other_open, now=now)["registration_id"] == "ra", "nur die Seite am Zug zählt"
