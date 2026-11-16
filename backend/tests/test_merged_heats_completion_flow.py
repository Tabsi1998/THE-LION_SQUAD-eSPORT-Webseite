"""Läufe-Cup mit zusammengelegten Läufen (#2452): Abschluss und Vergabe wie ohne Zusammenlegung, Nachholen genau einmal.

Das Turnier vom 31.10.: Winner und Loser Bracket mit 14 Läufen, es kamen 8. Der Umbau legt „B in A“, „D in C“, „F in E“
und im Loser Bracket „LB in LA“, „LD in LC“ zusammen - die fünf Läufe sind ``cancelled`` mit ``merged_into``. Danach
sind alle tatsächlich gefahrenen Läufe beendet; Abschluss, Auszeichnungen und Erfolge kommen genau so wie beim Summer Cup
ohne Zusammenlegung. Die Vergabe hängt am Status „Ergebnisse veröffentlicht“, nicht an „alle Spiele fertig“.

„Abschluss nachholen“ (``POST /status`` mit ``recheck``) prüft ein veröffentlichtes Turnier noch einmal - für Turniere,
deren Vergabe beim Veröffentlichen ausblieb. Zweimal ausgeführt entsteht nichts doppelt: keine zweite Auszeichnung, kein
zweiter Erfolg, keine zweite Feier, keine zweiten Punkte, kein Discord, kein „Turnier beendet“.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from services import scheduler  # noqa: E402
import badges  # noqa: E402
from services import achievement_counters as counters  # noqa: E402

# Der Läufe-Cup aus dem Seed (scripts/seed_abnahme.py): 16 Plätze, Läufe zu viert, Winner und Loser Bracket, Finale.
LB_CUP = """[WB]
A=[1,2,3,4]
B=[5,6,7,8]
C=[9,10,11,12]
D=[13,14,15,16]
E=[W:A:1,W:A:2,W:B:1,W:B:2]
F=[W:C:1,W:C:2,W:D:1,W:D:2]
G=[W:E:1,W:E:2,W:F:1,W:F:2]

[LB]
LA=[L:A:1,L:A:2,L:B:1,L:B:2]
LB=[L:C:1,L:C:2,L:D:1,L:D:2]
LC=[W:LA:1,W:LA:2,L:E:1,L:E:2]
LD=[W:LB:1,W:LB:2,L:F:1,L:F:2]
LE=[W:LC:1,W:LC:2,W:LD:1,W:LD:2]
LF=[W:LE:1,W:LE:2,L:G:1,L:G:2]

[FINAL]
FINAL=[W:G:1,W:G:2,W:LF:1,W:LF:2]"""

OPEN = {"pending", "ready", "scheduled", "in_progress"}
PLACE_KEYS = {"tournaments_won", "podium_finishes", "finals_played"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


async def heats_cup(flow, count: int, mode: str = "auto") -> tuple[dict, dict, list[dict], list[dict]]:
    """Der Cup mit ``count`` Fahrern: Check-in, Ende des Check-ins (der Baum steht), live."""
    tournament, users, registrations = await flow.with_participants(
        count, format="ffa_custom_bracket", heat_rebuild_mode=mode, status="registration_open", title="Kart-Cup 31.10.")
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"max_participants": 16}})
    await flow.db.tournament_stages.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "number": 1, "name": "Läufe",
        "stage_type": "ffa_custom_bracket", "match_type": "ffa", "status": "pending",
        "settings": {"schema": LB_CUP, "match_size": 4, "qualifiers_per_match": 2, "min_players": 2},
        "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
    })
    staff = await flow.add_staff()
    flow.act_as(staff)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "check_in"})
    assert response.status_code == 200, response.text
    await flow.db.tournament_registrations.update_many({"tournament_id": tournament["id"]}, {"$set": {"status": "checked_in"}})
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {
        "check_in_until": (now_utc() - timedelta(minutes=1)).isoformat()}})
    await scheduler._safe_status_transitions()
    await confirm_plan(flow, tournament)
    await flow.start(tournament)
    return tournament, staff, users, registrations


async def confirm_plan(flow, tournament: dict) -> None:
    """Im Vorschlag-Modus (Vorgabe) bestätigt die Turnierleitung den Umbau - wie am Abend."""
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0, "heat_rebuild_plan": 1})
    plan = (stored or {}).get("heat_rebuild_plan")
    if plan:
        response = await flow.post(f"/api/tournaments/{tournament['id']}/heat-rebuild/confirm", json={"plan_id": plan["id"]})
        assert response.status_code == 200, response.text


def playable(match: dict) -> bool:
    slots = match.get("slots") or []
    return (match.get("status") in OPEN and not match.get("is_preview")
            and not any(slot.get("status") == "pending" for slot in slots)
            and sum(1 for slot in slots if slot.get("status") == "filled" and slot.get("registration_id")) >= 2)


async def play_out(flow, tournament: dict, order: list[str]) -> None:
    """Jeden Lauf eintragen, sobald er steht - wer früher gesetzt ist, fährt vorne."""
    for _ in range(40):
        await confirm_plan(flow, tournament)
        ready = sorted((m for m in await flow.matches(tournament) if playable(m)),
                       key=lambda m: (int(m.get("round") or 0), m["match_key"]))
        if not ready:
            return
        match = ready[0]
        seated = [slot["registration_id"] for slot in match["slots"] if slot.get("status") == "filled" and slot.get("registration_id")]
        ranking = sorted(seated, key=order.index)
        response = await flow.post(f"/api/matches/{match['id']}/result", json={
            "results": [{"registration_id": reg, "rank": index + 1} for index, reg in enumerate(ranking)]})
        assert response.status_code == 200, (match["match_key"], response.text)
    raise AssertionError("Die Läufe enden nicht")


async def publish(flow, tournament: dict) -> None:
    for status in ("completed", "results_published"):
        response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": status})
        assert response.status_code == 200, response.text


async def recheck(flow, tournament: dict, status: str = "results_published"):
    return await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": status, "recheck": True})


async def unlocked(flow, user: dict) -> list[str]:
    rows = flow.db.user_achievements.find({"user_id": user["id"]}, {"_id": 0})
    return sorted([row.get("tier_code") or "" async for row in rows])


async def places(flow, user: dict) -> dict:
    found = await counters.compute(user["id"], set(PLACE_KEYS))
    return {key: found[key] for key in PLACE_KEYS}


async def footprint(flow, tournament: dict, users: list[dict]) -> dict:
    """Alles, was eine Vergabe hinterlässt - je Person und Turnier."""
    ids = [user["id"] for user in users]

    async def rows(collection: str, query: dict) -> list[dict]:
        return await getattr(flow.db, collection).find(query, {"_id": 0}).to_list(1000)

    earned = [(row["user_id"], row.get("tier_code")) for row in await rows("user_achievements", {"user_id": {"$in": ids}})]
    assert len(earned) == len(set(earned)), "kein Erfolg doppelt"
    awarded = [row["registration_id"] for row in await rows("tournament_awards", {"tournament_id": tournament["id"]})]
    assert len(awarded) == len(set(awarded)), "keine Auszeichnung doppelt"
    return {
        "awards": sorted((row["registration_id"], row.get("rank"))
                         for row in await rows("tournament_awards", {"tournament_id": tournament["id"]})),
        "achievements": sorted((row["user_id"], row.get("tier_code"))
                               for row in await rows("user_achievements", {"user_id": {"$in": ids}})),
        "xp": sorted((row["user_id"], row["source"], row["ref"]) for row in await rows("xp_events", {"user_id": {"$in": ids}})),
        "season_points": sorted((row.get("user_id") or "", row.get("total_points") or 0)
                                for row in await rows("season_points", {"source_id": tournament["id"]})),
        "prizes": await flow.db.prize_pickups.count_documents({"tournament_id": tournament["id"]}),
        "ceremonies": await flow.db.achievement_outbox.count_documents({"user_id": {"$in": ids}}),
        "finished_mails": await flow.db.notifications.count_documents({"user_id": {"$in": ids}}),
    }


# ---------------------------------------------------------------------------------------------- Abschluss und Vergabe

@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["auto", "suggest"])
async def test_zusammengelegte_laeufe_im_winner_und_loser_bracket_abschluss_und_vergabe(flow, mode):
    tournament, staff, users, regs = await heats_cup(flow, 8, mode)
    await play_out(flow, tournament, [reg["id"] for reg in regs])

    by_key = {match["match_key"]: match for match in await flow.matches(tournament)}
    assert len(by_key) == 14, "der Baum hat 14 Läufe"
    merged = {key: match.get("merged_into_key") for key, match in by_key.items() if match["status"] == "cancelled"}
    assert merged == {"B": "A", "D": "C", "F": "E", "LB": "LA", "LD": "LC"}, merged
    played = [key for key, match in by_key.items() if match["status"] == "completed"]
    assert len(played) == 9, "neun Läufe gefahren, keiner offen - die zusammengelegten zählen nicht"
    assert not [key for key, match in by_key.items() if match["status"] in OPEN]

    flow.act_as(staff)
    await publish(flow, tournament)
    awards = {row["registration_id"]: row for row in await flow.db.tournament_awards.find(
        {"tournament_id": tournament["id"]}, {"_id": 0}).to_list(50)}
    assert len(awards) == 8, "je Anmeldung genau eine Auszeichnung"
    assert sorted(row["rank"] for row in awards.values()) == list(range(1, 9))
    assert awards[regs[0]["id"]]["rank"] == 1 and awards[regs[0]["id"]]["kind"] == "trophy"
    assert awards[regs[0]["id"]]["finalist"] is True

    assert await places(flow, users[0]) == {"tournaments_won": 1, "podium_finishes": 1, "finals_played": 1}
    champion = await unlocked(flow, users[0])
    assert champion.count("tournaments_won_1") == 1 and champion.count("podium_1") == 1, champion
    assert (await places(flow, users[1]))["tournaments_won"] == 0


@pytest.mark.asyncio
async def test_summer_cup_ohne_zusammenlegung_bleibt_wie_er_ist(flow):
    """Regression: 16 Fahrer, kein Lauf entfällt - der Fall, in dem es schon immer ging."""
    tournament, staff, users, regs = await heats_cup(flow, 16)
    await play_out(flow, tournament, [reg["id"] for reg in regs])
    rows = await flow.matches(tournament)
    assert len(rows) == 14 and all(match["status"] == "completed" for match in rows)
    flow.act_as(staff)
    await publish(flow, tournament)
    assert await flow.db.tournament_awards.count_documents({"tournament_id": tournament["id"]}) == 16
    assert await places(flow, users[0]) == {"tournaments_won": 1, "podium_finishes": 1, "finals_played": 1}
    assert "tournaments_won_1" in await unlocked(flow, users[0])


# ---------------------------------------------------------------------------------------------- Nachholen

@pytest.mark.asyncio
async def test_abschluss_nachholen_vergibt_fehlendes_genau_einmal(flow, monkeypatch):
    """Beim Veröffentlichen blieb die Vergabe aus (Auszeichnungen und Erfolge fehlen, wie beim Turnier vom 31.10.).
    „Abschluss nachholen“ holt sie nach - zweimal ausgeführt entsteht nichts doppelt."""
    tournament, staff, users, regs = await heats_cup(flow, 8)
    await play_out(flow, tournament, [reg["id"] for reg in regs])
    flow.act_as(staff)
    await publish(flow, tournament)
    # Der Stand des Turniers vom 31.10.: veröffentlicht, aber ohne Auszeichnungen und ohne die Platz-Erfolge.
    await flow.db.tournament_awards.delete_many({"tournament_id": tournament["id"]})
    await flow.db.user_achievements.delete_many({"tier_code": {"$in": ["tournaments_won_1", "podium_1", "finals_1"]}})
    await flow.db.achievement_eval_queue.delete_many({})
    # Alle Meldungen vom Veröffentlichen sind schon zugestellt - ab hier zählt jede Zeile absolut.
    await flow.db.achievement_outbox.delete_many({})
    await flow.db.notifications.delete_many({})
    assert "tournaments_won_1" not in await unlocked(flow, users[0])

    from services import discord_threads, registration_notifications
    calls = []

    async def no_discord(*args, **kwargs):
        calls.append("discord")
        return {"ok": False}

    async def no_mail(*args, **kwargs):
        calls.append("finished")

    monkeypatch.setattr(discord_threads, "status_changed", no_discord)
    monkeypatch.setattr(registration_notifications, "notify_tournament_finished", no_mail)

    first = await recheck(flow, tournament)
    assert first.status_code == 200, first.text
    assert first.json()["rechecked"] is True and first.json()["awards"] == 8
    await badges_queue(flow, users)
    assert "tournaments_won_1" in await unlocked(flow, users[0]), "der Sieger bekommt seinen Erfolg nachgeholt"
    # Wer jetzt etwas Neues bekommt, erhält die übliche Meldung - genau eine je neuem Erfolg.
    won = {"user_id": users[0]["id"], "tier_code": "tournaments_won_1"}
    assert await flow.db.achievement_outbox.count_documents(won) == 1, "die übliche Meldung zum nachgeholten Erfolg"
    after_first = await footprint(flow, tournament, users)
    outbox_after_first = await flow.db.achievement_outbox.count_documents({})
    notifications_after_first = await flow.db.notifications.count_documents({})

    second = await recheck(flow, tournament)
    assert second.status_code == 200, second.text
    await badges_queue(flow, users)
    assert await footprint(flow, tournament, users) == after_first, "zweimal nachholen ergibt nichts doppelt"
    assert await flow.db.achievement_outbox.count_documents(won) == 1
    assert await flow.db.achievement_outbox.count_documents({}) - outbox_after_first == 0, "der zweite Lauf meldet nichts"
    assert await flow.db.notifications.count_documents({}) - notifications_after_first == 0, "der zweite Lauf meldet nichts"
    assert (await unlocked(flow, users[0])).count("tournaments_won_1") == 1
    assert calls == [], "kein Discord, kein „Turnier beendet“"
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0, "status": 1})
    assert stored["status"] == "results_published"
    actions = [row["action"] async for row in flow.db.audit_logs.find({"target_id": tournament["id"]}, {"_id": 0, "action": 1})]
    assert actions.count("tournament.results.rechecked") == 2


@pytest.mark.asyncio
async def test_veroeffentlichen_und_nachholen_ergeben_dasselbe(flow):
    """Ohne Fehler beim Veröffentlichen ändert das Nachholen nichts - auch keine zweite Feier."""
    tournament, staff, users, regs = await heats_cup(flow, 8)
    await play_out(flow, tournament, [reg["id"] for reg in regs])
    flow.act_as(staff)
    await publish(flow, tournament)
    await badges_queue(flow, users)
    before = await footprint(flow, tournament, users)
    response = await recheck(flow, tournament)
    assert response.status_code == 200, response.text
    await badges_queue(flow, users)
    assert await footprint(flow, tournament, users) == before


@pytest.mark.asyncio
async def test_nachholen_nur_fuer_veroeffentlichte_turniere_und_die_leitung(flow):
    tournament, staff, users, regs = await heats_cup(flow, 8)
    await play_out(flow, tournament, [reg["id"] for reg in regs])
    flow.act_as(staff)
    early = await recheck(flow, tournament, "live")
    assert early.status_code == 409, early.text
    other = await recheck(flow, tournament, "results_published")
    assert other.status_code == 409, "nur für den Status, der schon gilt"
    await publish(flow, tournament)
    assert await flow.db.tournaments.find_one({"id": tournament["id"], "status": "results_published"})
    # Ein gesperrtes Turnier: Ergebnisse bleiben, wie sie sind - nachholen geht trotzdem.
    locked = await flow.post(f"/api/tournaments/{tournament['id']}/lock")
    assert locked.status_code == 200, locked.text
    ok = await recheck(flow, tournament)
    assert ok.status_code == 200, ok.text
    flow.act_as(users[0])
    denied = await recheck(flow, tournament)
    assert denied.status_code == 403, denied.text


async def published_cup(flow):
    tournament, staff, users, regs = await heats_cup(flow, 8)
    await play_out(flow, tournament, [reg["id"] for reg in regs])
    flow.act_as(staff)
    await publish(flow, tournament)
    return tournament, staff, users, regs


@pytest.mark.asyncio
async def test_nachholen_meldet_einen_gescheiterten_schritt_statt_erfolg(flow, monkeypatch):
    """Scheitert die Jahreswertung, sagt die Antwort das (``ok`` falsch, der Schritt genannt) - Auszeichnungen und
    Gewinne kommen trotzdem."""
    tournament, _staff, _users, _regs = await published_cup(flow)
    await flow.db.tournament_awards.delete_many({"tournament_id": tournament["id"]})
    from services import season_service

    async def broken(**kwargs):
        raise RuntimeError("Jahreswertung kaputt")

    monkeypatch.setattr(season_service, "sync_tournament_points", broken)
    response = await recheck(flow, tournament)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is False and body["failed"] == ["season_points"] and body["failed_labels"] == ["Jahreswertung"]
    assert body["awards"] == 8, "die Auszeichnungen kommen trotzdem"
    audit = await flow.db.audit_logs.find_one({"target_id": tournament["id"], "action": "tournament.results.rechecked"}, {"_id": 0})
    assert audit["data"]["failed"] == ["season_points"]


@pytest.mark.asyncio
async def test_nachholen_ohne_platzierungen_kein_500_auszeichnungen_kommen_trotzdem(flow, monkeypatch):
    """Lassen sich die Platzierungen nicht berechnen, gibt es keinen Fehler 500: Jahreswertung und Erfolge der
    Platzierten bleiben unverändert und stehen als gescheitert in der Antwort, Auszeichnungen laufen trotzdem."""
    tournament, _staff, _users, _regs = await published_cup(flow)
    await flow.db.tournament_awards.delete_many({"tournament_id": tournament["id"]})
    points_before = await flow.db.season_points.find({"source_id": tournament["id"]}, {"_id": 0}).to_list(50)
    from routes import tournament_lifecycle_routes

    def broken(*args, **kwargs):
        raise RuntimeError("Platzierungen kaputt")

    monkeypatch.setattr(tournament_lifecycle_routes, "placement_rows_for_structure", broken)
    response = await recheck(flow, tournament)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is False and body["failed"] == ["placements", "season_points", "achievements"]
    assert body["awards"] == 8
    assert await flow.db.season_points.find({"source_id": tournament["id"]}, {"_id": 0}).to_list(50) == points_before, \
        "ohne Platzierungen bleibt die Jahreswertung, wie sie ist"


@pytest.mark.asyncio
async def test_rang_korrigiert_dann_nachholen_eine_aktuelle_auszeichnung(flow):
    """Nach dem Veröffentlichen wurde das Grand Final korrigiert: Nachholen schreibt die Auszeichnungen neu - je
    Anmeldung genau eine, mit dem neuen Rang, nichts doppelt."""
    tournament, _staff, users, regs = await published_cup(flow)
    final = next(m for m in await flow.matches(tournament) if m["match_key"] == "FINAL")
    ranking = [row["registration_id"] for row in sorted(final["results"], key=lambda row: row["rank"])]
    assert ranking[0] == regs[0]["id"]
    swapped = [{**row, "rank": 2 if row["registration_id"] == ranking[0] else 1 if row["registration_id"] == ranking[1] else row["rank"]}
               for row in final["results"]]
    await flow.db.matches_v2.update_one({"id": final["id"]}, {"$set": {"results": swapped}})
    response = await recheck(flow, tournament)
    assert response.status_code == 200, response.text
    for _ in range(2):
        again = await recheck(flow, tournament)
        assert again.status_code == 200, again.text
    awards = await flow.db.tournament_awards.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(50)
    assert len(awards) == 8 and len({row["registration_id"] for row in awards}) == 8, "je Anmeldung genau eine"
    by_reg = {row["registration_id"]: row["rank"] for row in awards}
    assert by_reg[ranking[1]] == 1 and by_reg[ranking[0]] == 2, "der neue Rang gilt"


async def badges_queue(flow, users: list[dict]) -> None:
    """Die vorgemerkten Auswertungen abarbeiten - was der Server-Job sonst nach ein paar Sekunden tut -, dann so lange
    nachwerten, bis nichts Neues mehr kommt (Meta-Erfolge wie „Sammler“ zählen erst die frisch vergebenen; das tut sonst
    der nächtliche Durchlauf). So vergleicht der Test fertige Stände."""
    from services import achievement_queue

    count = -1
    for _ in range(6):
        await flow.db.achievement_eval_queue.update_many({}, {"$set": {"due_at": (now_utc() - timedelta(minutes=1)).isoformat()}})
        await achievement_queue.process_queue()
        now = await flow.db.user_achievements.count_documents({})
        if now == count:
            return
        count = now
        await achievement_queue.request_evaluation([user["id"] for user in users], "test_settle")
    raise AssertionError("Die Erfolge kommen nicht zur Ruhe")
