"""Neuberechnung der Erfolge (#2340): stiller Modus, Probelauf und Abschluss mit Sammel-Nachricht.

Nach den Korrekturen an den Zählern (#2337, #2338, #2339) bekommen viele auf einen Schlag Erfolge. Im stillen Modus
vergeben Sweep, Nachtlauf und Nachläufer sie gespeichert und markiert, aber ohne Postfach, Push, Discord und
Level-Meldung. Ein echtes Ereignis meldet laut - nur die Stufen seiner Quelle, Altansprüche gehen still. Der Probelauf
schreibt nichts. Der Abschluss schickt je Person genau eine Sammel-Nachricht (kein Discord), auch beim zweiten Lauf
nicht doppelt, lässt sich nach einem Abbruch fortsetzen und beendet den stillen Modus - danach ist alles wieder laut.
Probelauf und Abschluss darf in der Verwaltung nur der Superadmin.
"""
import io
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

import badges  # noqa: E402
from services import achievement_queue, achievement_recount as recount  # noqa: E402

LOOK = {"icon": "trophy", "accent_color": "#29B6E8"}
GROUPS = [
    {"code": "leser", "id": "leser", "name": "Leseratte", "category": "community", "public": True, "is_negative": False, "sort_order": 1, **LOOK},
    {"code": "sicher", "id": "sicher", "name": "Abgesichert", "category": "profile", "public": True, "is_negative": False, "sort_order": 2, **LOOK},
    {"code": "lob", "id": "lob", "name": "Fairplay", "category": "match", "public": True, "is_negative": False, "sort_order": 3, **LOOK},
]
# Drei Zähler aus drei Quellen: News gelesen (community), Passkey (profile), Lob verteilt (match).
TIERS = [
    {"code": "leser_1", "id": "leser_1", "group_code": "leser", "name": "Leseratte I", "condition_key": "news_read", "progress_target": 1, "points": 50, "material": "wood", "rank": 1, "level": 1},
    {"code": "sicher_1", "id": "sicher_1", "group_code": "sicher", "name": "Abgesichert I", "condition_key": "passkey_registered", "progress_target": 1, "points": 50, "material": "wood", "rank": 1, "level": 1},
    {"code": "lob_1", "id": "lob_1", "group_code": "lob", "name": "Fairplay I", "condition_key": "commendations_given", "progress_target": 1, "points": 50, "material": "wood", "rank": 1, "level": 1},
]
QUIET_KINDS = ["achievement", "level"]


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    monkeypatch.setattr(achievement_queue, "EVAL_DELAY_SECONDS", -1)
    monkeypatch.setattr(achievement_queue, "BUNDLE_WINDOW_SECONDS", -1)
    try:
        await instance.db.achievement_groups.insert_many([dict(g) for g in GROUPS])
        await instance.db.achievements.insert_many([dict(t) for t in TIERS])
        yield instance
    finally:
        await recount.wait_for_jobs()
        await shutdown()


async def claims(flow, user, *, news=0, passkey=False, commend=0):
    """Was jemand schon getan hat - der Zähler steht, die Stufe fehlt noch."""
    for n in range(news):
        await flow.db.news_reads.insert_one({"user_id": user["id"], "news_id": f"news-{user['id']}-{n}", "read_at": "2026-11-01T10:00:00+00:00"})
    if passkey:
        await flow.db.passkeys.insert_one({"id": f"pk-{user['id']}", "user_id": user["id"], "credential_id": f"cred-{user['id']}"})
    for n in range(commend):
        await flow.db.match_commendations.insert_one({"id": f"lob-{user['id']}-{n}", "from_user_id": user["id"], "to_user_id": "jemand", "match_id": f"m-{n}"})


async def drain():
    """Die Warteschlange abarbeiten wie der Planer - samt Folge-Auswertungen nach jeder Vergabe."""
    for _ in range(6):
        if not (await achievement_queue.process_queue())["evaluated"]:
            break
    await achievement_queue.flush_awards()


async def awards_of(flow, user) -> dict:
    return {a["tier_code"]: a async for a in flow.db.user_achievements.find({"user_id": user["id"]}, {"_id": 0})}


async def noisy(flow, user) -> int:
    """Alles, was die Person über den normalen Weg erfahren hätte: Postfach-Meldung, Level, offene Meldungen."""
    notes = await flow.db.notifications.count_documents({"user_id": user["id"], "kind": {"$in": QUIET_KINDS}})
    return notes + await flow.db.achievement_outbox.count_documents({"user_id": user["id"]})


# ------------------------------------------------------------------ Stiller Modus

@pytest.mark.asyncio
async def test_sweep_and_night_run_store_quietly_and_announce_nothing(flow):
    from services import levels

    paula = await flow.add_user(name="paula")
    max_ = await flow.add_user(name="max")
    await claims(flow, paula, news=1, passkey=True)
    await claims(flow, max_, news=1)
    assert await recount.begin() == "silent mode on, 2 accounts queued"

    await achievement_queue.sweep(everyone=True)
    await achievement_queue.process_queue()
    # Die Folge-Auswertung nach einer stillen Vergabe (Sammler, Level) steht ohne laute Quelle in der Schlange.
    entry = await flow.db.achievement_eval_queue.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert entry["sources"] and "achievement" in entry["sources"] and entry.get("announce") is None
    await drain()
    # Der Nachtlauf (achievement_counters.reconcile) wertet ohne Quelle aus - genauso still.
    await claims(flow, max_, passkey=True)
    assert await badges.evaluate_user_progress(max_["id"]) == 1

    for person in (paula, max_):
        got = await awards_of(flow, person)
        assert set(got) == {"leser_1", "sicher_1"}
        assert all(a.get("recount") is True and a.get("recount_id") == recount.MARKER for a in got.values())
        assert await noisy(flow, person) == 0, "keine Meldung, kein Level, nichts offen"
    # Gespeichert wie immer: XP je Stufe, das Level steigt - nur gemeldet wird es nicht.
    state = await flow.db.user_xp.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert state["total"] == 1000 and state["level"] == levels.level_for_xp(1000) > 1
    # Die Tafel zeigt den bisherigen Umfang: je Stufe die Zahl und die Personen.
    recounted = (await recount.status())["recounted"]
    assert (recounted["awards"], recounted["users"]) == (4, 2)
    assert [(row["tier_code"], row["count"], row["group_name"]) for row in recounted["tiers"]] == [("sicher_1", 2, "Abgesichert"), ("leser_1", 2, "Leseratte")]


@pytest.mark.asyncio
async def test_after_the_quiet_full_run_a_real_event_announces_its_fresh_tiers(flow):
    paula = await flow.add_user(name="paula")
    await recount.begin()
    assert await recount.is_checked(flow.db, paula["id"], f"{recount.MARKER}:1") is False
    await drain()   # die stille volle Auswertung, die begin() vorgemerkt hat
    assert await recount.is_checked(flow.db, paula["id"], f"{recount.MARKER}:1") is True
    await claims(flow, paula, passkey=True, commend=1)   # beides frisch, nach der Marke

    # Wie services/match_notifications.py nach einem bestätigten Ergebnis: voll auswerten, Spiel und Turnier laut.
    await achievement_queue.request_evaluation([paula["id"]], "match_result", announce={"match", "tournament"})
    entry = await flow.db.achievement_eval_queue.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert entry["full"] is True and entry["announce"] == ["match", "tournament"]
    await drain()

    got = await awards_of(flow, paula)
    assert set(got) == {"lob_1", "sicher_1"}
    assert not got["lob_1"].get("recount"), "zum Ereignis passend und frisch: normal"
    assert got["sicher_1"]["recount"] is True, "andere Quelle: still"
    note = await flow.db.notifications.find_one({"user_id": paula["id"], "kind": "achievement"}, {"_id": 0})
    assert note is not None and note["meta"]["tier_codes"] == ["lob_1"]

    # Direkt aus einem Haken mit Quelle (wie badges.on_match_completed): ebenfalls laut.
    await claims(flow, paula, news=1)
    assert await badges.evaluate_user_progress(paula["id"], {"community"}) == 1
    assert not (await awards_of(flow, paula))["leser_1"].get("recount")
    await achievement_queue.flush_awards()
    assert await flow.db.notifications.count_documents({"user_id": paula["id"], "kind": "achievement"}) == 2


def lob(target: int) -> dict:
    base = next(t for t in TIERS if t["code"] == "lob_1")
    return {**base, "code": f"lob_{target}", "id": f"lob_{target}", "name": f"Fairplay {target}", "progress_target": target, "rank": target, "level": 2}


@pytest.mark.asyncio
async def test_before_the_quiet_full_run_even_old_claims_of_the_same_source_stay_quiet(flow):
    """Review zu #2340 (Vorlage test_review_same_source): fünfmal gelobt vor dem Deploy, die Stufen fehlen noch. Das erste
    bestätigte Ergebnis danach hängt sich an den wartenden Eintrag aus begin() - die Person trägt noch keine Marke, also
    bleibt alles still, auch Stufen der Quelle „match“. Erst danach meldet ein Ergebnis frische Stufen laut."""
    await flow.db.achievements.insert_many([lob(5), lob(6)])
    paula = await flow.add_user(name="paula")
    await claims(flow, paula, commend=5)
    await recount.begin()
    await achievement_queue.request_evaluation([paula["id"]], "match_result", announce={"match", "tournament"})
    entry = await flow.db.achievement_eval_queue.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert entry["full"] is True and entry["announce"] == ["match", "tournament"] and entry["reason"] == "match_result"
    await drain()

    got = await awards_of(flow, paula)
    assert {code: bool(a.get("recount")) for code, a in got.items()} == {"lob_1": True, "lob_5": True}
    assert await noisy(flow, paula) == 0, "keine Meldung - die Stufen kommen mit der Sammel-Nachricht"

    # Die volle stille Auswertung hat die Marke gesetzt: jetzt ist ein frisch erreichtes Lob wieder laut.
    await claims(flow, paula, commend=6)
    await achievement_queue.request_evaluation([paula["id"]], "match_result", announce={"match", "tournament"})
    await drain()
    assert not (await awards_of(flow, paula))["lob_6"].get("recount")
    note = await flow.db.notifications.find_one({"user_id": paula["id"], "kind": "achievement"}, {"_id": 0})
    assert note is not None and note["meta"]["tier_codes"] == ["lob_6"]


@pytest.mark.asyncio
async def test_a_check_in_keeps_an_old_finalist_tier_quiet(flow):
    """Finalist im Herbst-Cup, die Stufe dafür kam erst mit #2337: ein Check-in (Quelle „tournament“) vor der stillen
    vollen Auswertung meldet sie nicht laut."""
    import achievement_play as play

    players = [await flow.add_user(name=f"finalist-{n}") for n in range(4)]
    tournament, _registrations = await play.played_cup(flow, players)
    await flow.db.achievement_groups.insert_one({"code": "finale", "id": "finale", "name": "Finalist", "category": "tournament", "public": True,
                                                 "is_negative": False, "sort_order": 9, **LOOK})
    await flow.db.achievements.insert_one({"code": "finale_1", "id": "finale_1", "group_code": "finale", "name": "Finalist I",
                                           "condition_key": "finals_played", "progress_target": 1, "points": 50, "material": "wood", "rank": 1, "level": 1})
    await recount.begin()

    await badges.on_checked_in(players[0]["id"], tournament["id"])

    assert (await awards_of(flow, players[0]))["finale_1"]["recount"] is True
    await achievement_queue.flush_awards()
    assert await flow.db.achievement_outbox.count_documents({"user_id": players[0]["id"]}) == 0
    assert await flow.db.notifications.count_documents({"user_id": players[0]["id"], "kind": "achievement"}) == 0


@pytest.mark.asyncio
async def test_a_later_correction_package_lets_all_marks_expire(flow):
    """recheck (für ein Korrektur-Paket während des stillen Modus, etwa #2339): neue Generation, alle wieder vorgemerkt -
    bis zur nächsten stillen vollen Auswertung ist jedes Ereignis wieder ganz still."""
    paula = await flow.add_user(name="paula")
    await recount.begin()
    await drain()
    assert await recount.is_checked(flow.db, paula["id"], f"{recount.MARKER}:1")
    assert await recount.recheck() == "recheck, 1 accounts queued"
    assert (await recount.silent_state())["mark"] == f"{recount.MARKER}:2"
    await claims(flow, paula, commend=1)
    assert await badges.evaluate_user_progress(paula["id"], {"match"}) == 1
    assert (await awards_of(flow, paula))["lob_1"]["recount"] is True, "Marke der alten Generation zählt nicht"
    await recount.finish()
    assert await recount.recheck() == "silent mode off - nothing to recheck"


@pytest.mark.asyncio
async def test_without_silent_mode_everything_is_announced_as_before(flow):
    paula = await flow.add_user(name="paula")
    await claims(flow, paula, news=1, passkey=True)
    await achievement_queue.sweep(everyone=True)
    await drain()
    got = await awards_of(flow, paula)
    assert set(got) == {"leser_1", "sicher_1"} and not any(a.get("recount") for a in got.values())
    note = await flow.db.notifications.find_one({"user_id": paula["id"], "kind": "achievement"}, {"_id": 0})
    assert note is not None and sorted(note["meta"]["tier_codes"]) == ["leser_1", "sicher_1"]
    assert await flow.db.notifications.count_documents({"user_id": paula["id"], "kind": "level"}) == 1


# ------------------------------------------------------------------ Probelauf

@pytest.mark.asyncio
async def test_the_dry_run_counts_per_tier_and_writes_nothing(flow):
    paula = await flow.add_user(name="paula")
    max_ = await flow.add_user(name="max")
    await flow.add_user(name="ohne")
    await claims(flow, paula, news=2, passkey=True)
    await claims(flow, max_, news=1)
    await published_tournament(flow, paula)
    await recount.begin()
    watched = ("user_achievements", "xp_events", "user_xp", "user_achievement_stats", "achievement_eval_queue", "achievement_outbox", "notifications",
               "tournament_awards")
    before = {name: [doc async for doc in flow.db[name].find({}, {"_id": 0})] for name in watched}
    assert not before["user_achievements"] and len(before["achievement_eval_queue"]) == 3, "begin() hat nur vorgemerkt"

    result = await recount.dry_run()

    assert result["status"] == "done" and result["checked"] == 3 and result["affected_users"] == 2 and result["awards"] == 3
    assert {row["tier_code"]: row["count"] for row in result["tiers"]} == {"leser_1": 2, "sicher_1": 1}
    assert result["tiers"][0]["name"] == "Leseratte I" and result["tiers"][0]["group_name"] == "Leseratte"
    for name in watched:
        assert [doc async for doc in flow.db[name].find({}, {"_id": 0})] == before[name], f"{name} bleibt unberührt"
    state = await recount.status()
    assert state["dry_run"]["status"] == "done" and state["dry_run"]["affected_users"] == 2 and not state["dry_run"]["running"]
    assert state["active"] is True, "der Probelauf ändert den stillen Modus nicht"
    assert "Leseratte I (Leseratte)" in recount.render_dry_run(result)


# ------------------------------------------------------------------ Abschluss

@pytest.mark.asyncio
async def test_finishing_sends_exactly_one_summary_per_person_and_never_twice(flow, monkeypatch):
    from services import discord_dm, push_notifications

    dms, pushes = [], []

    async def fake_dm(doc, category=None):
        dms.append(doc["user_id"])
        return 1

    async def fake_push(doc):
        pushes.append(doc["user_id"])
        return 1

    monkeypatch.setattr(discord_dm, "send_discord_dm_for_notification", fake_dm)
    monkeypatch.setattr(push_notifications, "send_mobile_push_for_notification", fake_push)
    paula = await flow.add_user(name="paula")
    max_ = await flow.add_user(name="max")
    ohne = await flow.add_user(name="ohne")
    # Paula hat Discord als Kanal eingeschaltet - die Sammel-Nachricht kommt trotzdem nicht als Direktnachricht.
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"notification_preferences": {"discord": True}}})
    await claims(flow, paula, news=1, passkey=True)
    await claims(flow, max_, news=1)
    await recount.begin()
    # Zwei Stufen hat der Nachtlauf schon still vergeben, die dritte holt der Abschluss nach.
    assert await badges.evaluate_user_progress(paula["id"]) == 2
    await claims(flow, paula, commend=1)

    result = await recount.finish(batch=1)

    assert result["status"] == "done" and result["notified"] == 2
    notes = {n["user_id"]: n async for n in flow.db.notifications.find({"kind": recount.NOTIFY_KIND}, {"_id": 0})}
    assert set(notes) == {paula["id"], max_["id"]}, "wer nichts nachbekommt, bekommt keine Nachricht"
    assert notes[paula["id"]]["body"] == "Wir haben die Erfolge neu berechnet – du hast 3 neue."
    assert notes[max_["id"]]["body"] == "Wir haben die Erfolge neu berechnet – du hast einen neuen."
    assert notes[paula["id"]]["url"] == "/profile?tab=achievements" and notes[paula["id"]]["meta"]["count"] == 3
    assert dms == [] and sorted(pushes) == sorted([paula["id"], max_["id"]]), "Push ja, Discord nie"
    assert (await awards_of(flow, paula))["lob_1"]["recount"] is True
    for person in (paula, max_, ohne):
        assert await noisy(flow, person) == 0
    state = await recount.status()
    assert state["active"] is False and state["ended_at"] and state["finish"]["done"] and not state["finish"]["running"]

    # Zweiter Lauf: fertig ist fertig.
    assert (await recount.finish())["status"] == "done"
    # Selbst ein neu angestoßener Versand schickt nichts doppelt (dedupe_key).
    await flow.db.settings.update_one({"id": recount.SETTING_ID}, {"$set": {"finish.phase": "notify", "finish.cursor": None}})
    assert (await recount.finish(batch=1))["status"] == "done"
    assert await flow.db.notifications.count_documents({"kind": recount.NOTIFY_KIND}) == 2


@pytest.mark.asyncio
async def test_an_interrupted_finish_resumes_where_it_stopped(flow, monkeypatch):
    from services import user_notifications

    people = [await flow.add_user(name=f"person-{n}") for n in range(3)]
    for person in people:
        await claims(flow, person, news=1)
    await recount.begin()
    middle = sorted(p["id"] for p in people)[1]
    real = user_notifications.create_user_notification
    broke: list[str] = []
    tried: list[str] = []

    async def flaky(user_id, *args, **kwargs):
        tried.append(user_id)
        if user_id == middle and not broke:
            broke.append(user_id)
            raise RuntimeError("Verbindung weg")
        return await real(user_id, *args, **kwargs)

    monkeypatch.setattr(user_notifications, "create_user_notification", flaky)

    assert (await recount.finish(batch=1))["status"] == "failed"
    state = await recount.status()
    assert state["finish"]["interrupted"] and state["finish"]["phase"] == "notify"
    assert state["active"] is False, "ausgewertet ist schon alles - der stille Modus ist aus"

    assert (await recount.finish(batch=1))["status"] == "done"
    for person in people:
        assert await flow.db.notifications.count_documents({"kind": recount.NOTIFY_KIND, "user_id": person["id"]}) == 1
    first = sorted(p["id"] for p in people)[0]
    assert tried.count(first) == 1, "fortgesetzt wird beim Stand - wer schon dran war, kommt nicht noch einmal"


@pytest.mark.asyncio
async def test_an_interrupted_evaluation_keeps_quiet_and_continues(flow, monkeypatch):
    people = [await flow.add_user(name=f"person-{n}") for n in range(2)]
    for person in people:
        await claims(flow, person, news=1)
    await recount.begin()
    real_extend = recount._extend
    calls: list[int] = []

    async def failing_once(db, doc_id, field, changes=None):
        calls.append(1)
        # Der erste Aufruf folgt auf den Finalisten-Nachtrag, der zweite auf den ersten Stapel Konten.
        if len(calls) == 2:
            raise RuntimeError("Server neu gestartet")
        return await real_extend(db, doc_id, field, changes)

    monkeypatch.setattr(recount, "_extend", failing_once)
    assert (await recount.finish(batch=1))["status"] == "failed"
    state = await recount.status()
    assert state["active"] is True and state["finish"]["phase"] == "evaluate" and state["finish"]["interrupted"]

    assert (await recount.finish(batch=1))["status"] == "done"
    for person in people:
        assert all(a.get("recount") for a in (await awards_of(flow, person)).values())
        assert await noisy(flow, person) == 0
        assert await flow.db.notifications.count_documents({"kind": recount.NOTIFY_KIND, "user_id": person["id"]}) == 1


async def published_tournament(flow, *people):
    """Ein Turnier mit veröffentlichten Ergebnissen, dessen Pokale noch fehlen - wie älterer Bestand."""
    await flow.db.tournaments.insert_one({"id": "t-alt", "slug": "t-alt", "title": "Herbst-Cup", "status": "results_published",
                                          "start_date": "2025-10-02T17:00:00+02:00", "visibility": "public", "is_public": True, "format": "single_elim"})
    await flow.db.tournament_registrations.insert_many([
        {"id": f"r-{n}", "tournament_id": "t-alt", "user_id": person["id"], "status": "approved", "final_position": n + 1}
        for n, person in enumerate(people)
    ])


OLD_SEASON = {"id": "s-2025", "name": "Saison 2025"}


async def old_trophies(flow, paula, max_):
    """Pokale von 2025 ohne ``finalist`` - einer davon für eine Anmeldung, die heute nicht mehr gilt; einer trägt das Feld
    schon. „Pokale nachtragen“ würde die Saison umstempeln, Ränge neu ableiten und den ungültigen löschen."""
    stamp = "2025-10-03T09:00:00+00:00"
    base = {"tournament_id": "t-alt", "kind": "trophy", "participants": 4, "matches": {"played": 3, "won": 2}, "season": OLD_SEASON,
            "tournament": {"id": "t-alt", "title": "Herbst-Cup", "status": "results_published"}, "created_at": stamp, "updated_at": stamp}
    await flow.db.tournament_awards.insert_many([
        {**base, "id": "a-sieg", "registration_id": "r-0", "user_id": paula["id"], "rank": 1},
        {**base, "id": "a-zweit", "registration_id": "r-1", "user_id": max_["id"], "rank": 2},
        {**base, "id": "a-weg", "registration_id": "r-weg", "user_id": "ehemalig", "rank": 3},
        {**base, "id": "a-schon", "registration_id": "r-schon", "user_id": "jemand", "rank": 4, "finalist": False, "final_match_id": None},
    ])
    await flow.db.tournament_registrations.insert_one({"id": "r-weg", "tournament_id": "t-alt", "user_id": "ehemalig", "status": "cancelled"})


@pytest.mark.asyncio
async def test_finishing_first_adds_finalists_to_old_trophies_and_touches_nothing_else(flow, monkeypatch):
    from services import awards

    paula = await flow.add_user(name="paula")
    max_ = await flow.add_user(name="max")
    await claims(flow, paula, news=1)
    await published_tournament(flow, paula, max_)
    await old_trophies(flow, paula, max_)
    before = {doc["id"]: doc async for doc in flow.db.tournament_awards.find({}, {"_id": 0})}
    await recount.begin()
    seen: list[tuple[str, bool, int]] = []

    async def outcome(db, tournament_id):
        # Dieselbe Schnittstelle wie awards.tournament_outcome (#2337): wer im Finale stand und welches Spiel es war.
        seen.append((tournament_id, recount.in_quiet_scope(), await flow.db.user_achievements.count_documents({})))
        return {"ranks": {}, "participants": 4, "final_match_id": "m-finale", "finalists": frozenset({"r-0", "r-1", "r-schon"})}

    monkeypatch.setattr(awards, "tournament_outcome", outcome, raising=False)
    assert (await recount.finish(batch=1))["status"] == "done"

    assert seen == [("t-alt", True, 0)], "einmal je Turnier, vor der Auswertung, als Teil der Neuberechnung"
    after = {doc["id"]: doc async for doc in flow.db.tournament_awards.find({}, {"_id": 0})}
    assert set(after) == set(before), "nichts gelöscht, nichts dazu"
    for award_id, doc in after.items():
        untouched = {key: value for key, value in doc.items() if key not in ("finalist", "final_match_id")}
        assert untouched == {key: value for key, value in before[award_id].items() if key not in ("finalist", "final_match_id")}, award_id
    assert after["a-sieg"]["season"] == OLD_SEASON and after["a-sieg"]["rank"] == 1 and after["a-sieg"]["updated_at"] == before["a-sieg"]["updated_at"]
    assert (after["a-sieg"]["finalist"], after["a-sieg"]["final_match_id"]) == (True, "m-finale")
    assert (after["a-zweit"]["finalist"], after["a-zweit"]["final_match_id"]) == (True, "m-finale")
    assert (after["a-weg"]["finalist"], after["a-weg"]["final_match_id"]) == (False, None)
    assert (after["a-schon"]["finalist"], after["a-schon"]["final_match_id"]) == (False, None), "was schon dasteht, bleibt"
    assert (await recount.status())["finish"]["finalists_backfilled"] == {"tournaments": 1, "awards": 3}
    for person in (paula, max_):
        assert await noisy(flow, person) == 0
    assert await flow.db.notifications.count_documents({"kind": {"$ne": recount.NOTIFY_KIND}}) == 0
    # Ein zweiter Lauf ergänzt nichts mehr - fertig ist fertig, und auch von Hand ist nichts mehr offen.
    await recount.finish()
    assert await recount.backfill_finalists() == {"tournaments": 0, "awards": 0}
    assert len(seen) == 1


@pytest.mark.asyncio
async def test_without_the_outcome_of_2337_the_backfill_changes_nothing(flow, monkeypatch):
    from services import awards

    paula = await flow.add_user(name="paula")
    max_ = await flow.add_user(name="max")
    await old_trophies(flow, paula, max_)
    monkeypatch.delattr(awards, "tournament_outcome", raising=False)
    assert (await recount.backfill_finalists())["skipped"] is True
    assert await flow.db.tournament_awards.count_documents({"finalist": {"$exists": True}}) == 1


@pytest.mark.asyncio
async def test_the_backfill_with_the_real_outcome_of_2337_only_adds_who_played_the_final(flow):
    """Ein echt gespieltes K.-o.-Turnier (1 schlägt 4, 2 schlägt 3, Finale 1 gegen 2), dessen Pokale wie älterer Bestand
    aussehen: ohne ``finalist``, mit alter Saison und altem ``updated_at`` - und mit dem Pokal einer Anmeldung, die heute
    abgemeldet ist. Der Nachtrag rechnet über ``awards.tournament_outcome`` und ändert sonst nichts."""
    import achievement_play as play
    from services import awards

    players = [await flow.add_user(name=f"spieler-{n}") for n in range(4)]
    tournament, registrations = await play.played_cup(flow, players)
    written = {doc["registration_id"]: doc async for doc in flow.db.tournament_awards.find({"tournament_id": tournament["id"]}, {"_id": 0})}
    assert {reg for reg, doc in written.items() if doc.get("finalist")} == {registrations[0]["id"], registrations[1]["id"]}, "so schreibt #2337 neu"
    final_id = written[registrations[0]["id"]]["final_match_id"]
    assert final_id and written[registrations[1]["id"]]["final_match_id"] == final_id

    # Älterer Bestand: das Feld fehlt, Saison und Zeitstempel sind alt, dazu der Pokal einer heute abgemeldeten Anmeldung.
    await flow.db.tournament_awards.update_many({"tournament_id": tournament["id"]}, {
        "$unset": {"finalist": "", "final_match_id": ""}, "$set": {"season": OLD_SEASON, "updated_at": "2025-10-03T09:00:00+00:00"}})
    gone = dict(written[registrations[3]["id"]], id="a-abgemeldet", registration_id="r-abgemeldet", rank=5, season=OLD_SEASON,
                updated_at="2025-10-03T09:00:00+00:00")
    gone.pop("finalist", None)
    gone.pop("final_match_id", None)
    await flow.db.tournament_awards.insert_one(gone)
    await flow.db.tournament_registrations.insert_one({"id": "r-abgemeldet", "tournament_id": tournament["id"], "user_id": "ehemalig", "status": "cancelled"})
    awards.forget_outcome(flow.db)
    before = {doc["id"]: doc async for doc in flow.db.tournament_awards.find({"tournament_id": tournament["id"]}, {"_id": 0})}

    result = await recount.backfill_finalists()

    after = {doc["id"]: doc async for doc in flow.db.tournament_awards.find({"tournament_id": tournament["id"]}, {"_id": 0})}
    assert set(after) == set(before), "nichts gelöscht - auch nicht der Pokal der abgemeldeten Anmeldung"
    for award_id, doc in after.items():
        rest = {key: value for key, value in doc.items() if key not in ("finalist", "final_match_id")}
        assert rest == before[award_id], f"{award_id}: Saison, Rang und updated_at bleiben"
        assert rest["season"] == OLD_SEASON and rest["updated_at"] == "2025-10-03T09:00:00+00:00"
    by_reg = {doc["registration_id"]: doc for doc in after.values()}
    for reg in registrations[:2]:
        assert (by_reg[reg["id"]]["finalist"], by_reg[reg["id"]]["final_match_id"]) == (True, final_id), "wie es #2337 schreibt"
    for reg_id in (registrations[2]["id"], registrations[3]["id"], "r-abgemeldet"):
        assert (by_reg[reg_id]["finalist"], by_reg[reg_id]["final_match_id"]) == (False, None)
    assert result == {"tournaments": 1, "awards": 5}
    assert await recount.backfill_finalists() == {"tournaments": 0, "awards": 0}, "ein zweiter Lauf hat nichts mehr zu tun"


def test_the_legacy_sources_only_name_keys_of_the_legacy_block():
    from services import achievement_counters

    assert set(recount.LEGACY_KEY_SOURCES) <= achievement_counters.LEGACY_KEYS
    assert all(sources <= set(achievement_counters.SOURCES) for sources in recount.LEGACY_KEY_SOURCES.values())
    # Jeder Zähler des alten Blocks hat eine Quelle - hier oder in der Registry. Sonst bliebe seine Stufe im stillen Modus
    # auch bei einem passenden Ereignis still.
    assert achievement_counters.LEGACY_KEYS <= set(recount.LEGACY_KEY_SOURCES) | set(achievement_counters.REGISTRY)
    # Was seit #2337/#2338 in der Registry steht, steht hier nicht doppelt.
    assert not set(recount.LEGACY_KEY_SOURCES) & set(achievement_counters.REGISTRY)


@pytest.mark.asyncio
async def test_after_the_finish_everything_is_loud_again(flow):
    paula = await flow.add_user(name="paula")
    await claims(flow, paula, news=1)
    await recount.begin()
    await recount.finish()
    await claims(flow, paula, passkey=True)

    await achievement_queue.sweep(everyone=True)
    await drain()

    got = await awards_of(flow, paula)
    assert got["leser_1"]["recount"] is True and not got["sicher_1"].get("recount")
    note = await flow.db.notifications.find_one({"user_id": paula["id"], "kind": "achievement"}, {"_id": 0})
    assert note is not None and note["meta"]["tier_codes"] == ["sicher_1"]


@pytest.mark.asyncio
async def test_the_own_achievements_tell_the_page_what_was_recounted_and_when_it_is_done(flow):
    paula = await flow.add_user(name="paula")
    await claims(flow, paula, news=1)
    flow.act_as(paula)
    res = await flow.get("/api/achievements/me")
    assert res.status_code == 200 and res.json()["recount"] is None, "ohne Neuberechnung nichts zu feiern"

    await recount.begin()
    await badges.evaluate_user_progress(paula["id"])
    mine = (await flow.get("/api/achievements/me")).json()
    assert mine["recount"] == {"marker": recount.MARKER, "finished": False}, "während des stillen Modus noch keine Sammel-Zeremonie"
    tiers = {t["code"]: t for g in mine["groups"] for t in g["tiers"]}
    assert tiers["leser_1"]["earned"] and tiers["leser_1"]["recount"] is True and tiers["sicher_1"]["recount"] is False

    await recount.finish()
    mine = (await flow.get("/api/achievements/me")).json()
    assert mine["recount"] == {"marker": recount.MARKER, "finished": True}


@pytest.mark.asyncio
async def test_crowns_stand_still_during_the_silent_mode_and_change_once_at_the_end(flow):
    from services import crown_events

    anna = await flow.add_user(name="anna")
    ben = await flow.add_user(name="ben")
    await flow.db.users.update_many({"id": {"$in": [anna["id"], ben["id"]]}}, {"$set": {"privacy_public_profile": True}})
    await claims(flow, anna, news=1)
    await badges.evaluate_user_progress(anna["id"])
    await crown_events.get_crowns(force=True)
    assert (await flow.db.crown_state.find_one({"id": "current"}, {"_id": 0}))["holders"] == {anna["id"]: "gold"}

    await recount.begin()
    await claims(flow, ben, news=1, passkey=True, commend=1)   # 150 Punkte - still nachgerechnet
    await drain()
    await crown_events.get_crowns(force=True)                   # etwa ein Besuch der Erfolge-Seite
    assert (await flow.db.crown_state.find_one({"id": "current"}, {"_id": 0}))["holders"] == {anna["id"]: "gold"}, "nicht gespeichert"
    assert await flow.db.notifications.count_documents({"kind": {"$regex": "^crown_"}}) == 0, "nicht gemeldet"

    await recount.finish()
    assert (await flow.db.crown_state.find_one({"id": "current"}, {"_id": 0}))["holders"] == {ben["id"]: "gold", anna["id"]: "silver"}
    kinds = sorted([(n["user_id"] == ben["id"], n["kind"]) async for n in flow.db.notifications.find({"kind": {"$regex": "^crown_"}}, {"_id": 0})])
    assert kinds == [(False, "crown_changed"), (True, "crown_gained")], "einmal je Person, nur die Änderung über alles"


# ------------------------------------------------------------------ Migration, Kommando, Rechte

@pytest.mark.asyncio
async def test_migration_22_turns_the_silent_mode_on_once(flow):
    from services import migrations

    assert (22, "achievements_recount_silent", migrations.migrate_achievements_recount) in migrations.MIGRATIONS
    assert await migrations.migrate_achievements_recount(flow.db) == "no accounts - nothing to recount"
    assert await flow.db.settings.find_one({"id": recount.SETTING_ID}) is None
    paula = await flow.add_user(name="paula")
    banned = await flow.add_user(name="gesperrt")
    await flow.db.users.update_one({"id": banned["id"]}, {"$set": {"is_banned": True}})
    assert await migrations.migrate_achievements_recount(flow.db) == "silent mode on, 1 accounts queued"
    doc = await flow.db.settings.find_one({"id": recount.SETTING_ID}, {"_id": 0})
    assert doc["active"] is True and doc["marker"] == recount.MARKER and doc["generation"] == 1 and doc["started_at"]
    # Alle Konten stehen gleich für eine volle, stille Auswertung in der Schlange - danach tragen sie die Marke.
    entry = await flow.db.achievement_eval_queue.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert entry["full"] is True and entry["reason"] == "recount_start" and not entry.get("announce")
    await recount.finish()
    assert await migrations.migrate_achievements_recount(flow.db) == "already present"
    assert (await recount.status())["active"] is False, "einmal abgeschlossen bleibt abgeschlossen"


@pytest.mark.asyncio
async def test_the_command_line_runs_dry_run_and_finish(flow):
    import importlib

    script = importlib.import_module("scripts.achievements_recount")
    paula = await flow.add_user(name="paula")
    await claims(flow, paula, news=1)
    out = io.StringIO()
    assert await script.main([], out=out) == 0
    assert "Keine Neuberechnung angelegt" in out.getvalue()
    assert await script.main(["--starten"], out=io.StringIO()) == 0

    out = io.StringIO()
    assert await script.main(["--dry-run"], out=out) == 0
    assert "1 Personen bekämen 1 Stufen neu dazu" in out.getvalue() and "Leseratte I" in out.getvalue()
    assert await flow.db.user_achievements.count_documents({}) == 0

    out = io.StringIO()
    assert await script.main(["--abschliessen"], out=out) == 0
    assert "Abschluss: done" in out.getvalue() and "Stiller Modus: aus" in out.getvalue()
    assert "Schon still vergeben: 1 Stufen an 1 Personen." in out.getvalue() and "Leseratte I (Leseratte)" in out.getvalue()
    assert await flow.db.notifications.count_documents({"kind": recount.NOTIFY_KIND}) == 1


@pytest.mark.asyncio
async def test_only_the_superadmin_may_run_the_recount(flow):
    player = await flow.add_user(name="spieler")
    club_admin = await flow.add_user(role="club_admin", name="vorstand")
    unconfirmed = {**await flow.add_user(role="superadmin", name="ohne-2fa"), "auth_mfa_verified": False}
    boss = await flow.add_user(role="superadmin", name="chef")
    await claims(flow, player, news=1)

    for person in (player, club_admin, unconfirmed):
        flow.act_as(person)
        for method, url in (("get", "/api/admin/achievements/recount"), ("post", "/api/admin/achievements/recount/dry-run"),
                            ("post", "/api/admin/achievements/recount/finish")):
            res = await getattr(flow, method)(url)
            assert res.status_code == 403, (person["username"], url)
    assert await flow.db.settings.find_one({"id": recount.DRY_RUN_ID}) is None, "abgewiesen heißt: nichts gestartet"

    flow.act_as(boss)
    res = await flow.post("/api/admin/achievements/recount/finish")
    assert res.status_code == 404, "ohne Neuberechnung gibt es nichts abzuschließen"
    await recount.begin()
    res = await flow.post("/api/admin/achievements/recount/dry-run")
    assert res.status_code == 200
    await recount.wait_for_jobs()
    res = await flow.get("/api/admin/achievements/recount")
    assert res.status_code == 200 and res.json()["dry_run"]["status"] == "done" and res.json()["dry_run"]["awards"] == 1

    res = await flow.post("/api/admin/achievements/recount/finish")
    assert res.status_code == 200
    await recount.wait_for_jobs()
    state = (await flow.get("/api/admin/achievements/recount")).json()
    assert state["finish"]["done"] and state["active"] is False and state["finish"]["notified"] == 1
    res = await flow.post("/api/admin/achievements/recount/finish")
    assert res.status_code == 200 and res.json()["finish"]["done"], "ein zweiter Klick tut nichts"
    kinds = [e["kind"] async for e in flow.db.achievement_events.find({}, {"_id": 0, "kind": 1})]
    assert sorted(kinds) == ["recount_dry_run", "recount_finish"]
    assert await flow.db.notifications.count_documents({"kind": recount.NOTIFY_KIND}) == 1


# ------------------------------------------------------------------ Auslöser aus #2337/#2338

async def queued_announce(flow, user) -> list | None:
    entry = await flow.db.achievement_eval_queue.find_one({"user_id": user["id"]}, {"_id": 0})
    return entry.get("announce") if entry else "nicht vorgemerkt"


@pytest.mark.asyncio
async def test_each_real_trigger_names_its_source_and_the_nightly_discord_sync_names_none(flow, monkeypatch):
    """Was im stillen Modus laut sein darf, nennt der Auslöser: Chat, Konto verknüpfen, Team speichern, Discord-Beitritt,
    Check-in und Twitch. Der nächtliche Discord-Abgleich ist ein Abgleich, kein Ereignis - er nennt nichts."""
    from routes import team_routes
    from services import discord_guilds, discord_runtime, platform_links, twitch_service

    people = {name: await flow.add_user(name=name) for name in ("chat", "konto", "team", "beitritt", "nachts")}
    await achievement_queue.request_chat_evaluation(people["chat"]["id"])
    assert await queued_announce(flow, people["chat"]) == ["chat", "community"]
    await platform_links._request_link_evaluation(people["konto"]["id"], "platform_link")
    assert await queued_announce(flow, people["konto"]) == ["discord", "profile", "stream"]
    await team_routes._queue_team_leads({"id": "tm", "leader_id": people["team"]["id"], "co_leader_ids": []}, "team_update")
    assert await queued_announce(flow, people["team"]) == ["team"]

    main_guild = "700000000000000001"
    await flow.db.discord_guilds.insert_one({"guild_id": main_guild, "name": "Haupt", "role": "main", "enabled": True})
    await flow.db.platform_links.insert_many([
        {"id": "l-b", "user_id": people["beitritt"]["id"], "platform": "discord", "external_id": "301"},
        {"id": "l-n", "user_id": people["nachts"]["id"], "platform": "discord", "external_id": "302"},
    ])
    await discord_guilds.note_membership(flow.db, main_guild, "301", True)
    assert await queued_announce(flow, people["beitritt"]) == ["discord"], "der Bot sieht den Beitritt im Moment"

    async def member_status(guild_ids, discord_id):
        return {guild_id: True for guild_id in guild_ids}

    monkeypatch.setattr(discord_runtime.bot, "member_status", member_status)
    await flow.db.achievement_eval_queue.delete_many({})
    result = await discord_guilds.sync_all_memberships(flow.db, pause=0)
    assert result["changed"] >= 1
    assert await queued_announce(flow, people["nachts"]) is None, "nachts vorgemerkt, aber ohne laute Quelle"
    assert not recount.in_quiet_scope(), "der stille Rahmen endet mit dem Abgleich"

    calls: list[tuple] = []

    async def evaluate(*args, **kwargs):
        calls.append((args, kwargs))
        return 0

    monkeypatch.setattr(badges, "evaluate_user_progress", evaluate)
    await badges.on_checked_in(people["chat"]["id"], "kein-turnier")
    assert calls[-1] == ((people["chat"]["id"], {"tournament"}), {}), "Check-in: die Quelle ist zugleich, was laut sein darf"
    await twitch_service._evaluate_streamer(people["chat"]["id"])
    assert calls[-1] == ((people["chat"]["id"],), {"announce": {"stream"}})


# ------------------------------------------------------------------ Laufband und Wochenrückblick

@pytest.mark.asyncio
async def test_recounted_tiers_stay_out_of_the_ticker_and_the_weekly_recap(flow):
    from datetime import datetime, timezone

    from services import achievement_recap, achievement_visibility

    paula = await flow.add_user(name="paula")
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"privacy_public_profile": True}})
    at = "2026-11-04T18:00:00+00:00"
    await flow.db.user_achievements.insert_many([
        {"id": "a-normal", "user_id": paula["id"], "tier_code": "leser_1", "group_code": "leser", "earned_at": at},
        {"id": "a-recount", "user_id": paula["id"], "tier_code": "sicher_1", "group_code": "sicher", "earned_at": at, "recount": True, "recount_id": recount.MARKER},
    ])
    await flow.db.xp_events.insert_many([
        {"id": "x1", "user_id": paula["id"], "source": "achievement", "ref": "leser_1", "amount": 500, "bonus": 0, "day": at[:10], "at": at},
        {"id": "x2", "user_id": paula["id"], "source": "achievement", "ref": "sicher_1", "amount": 500, "bonus": 0, "day": at[:10], "at": at},
    ])

    ticker = await achievement_visibility.recent_unlocks(flow.db, 20)
    assert [row["tier_code"] for row in ticker] == ["leser_1"]

    start, end = datetime(2026, 11, 2, 7, tzinfo=timezone.utc), datetime(2026, 11, 9, 7, tzinfo=timezone.utc)
    user = await flow.db.users.find_one({"id": paula["id"]}, {"_id": 0})
    recap = await achievement_recap.recap_for(flow.db, user, start, end)
    assert recap["unlocked"] == ["Leseratte I"]
    assert recap["xp_week"] == 500, "die XP der nachgerechneten Stufe zählen nicht"
    await flow.db.user_achievements.delete_one({"id": "a-normal"})
    await flow.db.xp_events.delete_one({"id": "x1"})
    assert await achievement_recap.recap_for(flow.db, user, start, end) is None, "nur Nachgerechnetes: keine Mail"


@pytest.mark.asyncio
async def test_recounted_tiers_count_overall_but_in_no_period_and_not_in_the_year_review(flow):
    """Review zu #2340: Ranglisten nach Zeitraum und der Jahresrückblick zählen nachgerechnete Stufen nicht - verdient
    wurden sie früher. Die Gesamt-Rangliste zählt sie."""
    from datetime import datetime, timezone

    from services import achievement_visibility, year_review

    paula = await flow.add_user(name="paula")
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"privacy_public_profile": True}})
    at = "2026-11-04T18:00:00+00:00"
    await flow.db.user_achievements.insert_many([
        {"id": "a-normal", "user_id": paula["id"], "tier_code": "leser_1", "group_code": "leser", "earned_at": at},
        {"id": "a-recount", "user_id": paula["id"], "tier_code": "sicher_1", "group_code": "sicher", "earned_at": at, "recount": True, "recount_id": recount.MARKER},
    ])
    now = datetime(2026, 11, 11, 12, tzinfo=timezone.utc)
    overall = await achievement_visibility.leaderboard(flow.db, period="all", now=now)
    month = await achievement_visibility.leaderboard(flow.db, period="month", now=now)
    year = await achievement_visibility.leaderboard(flow.db, period="year", now=now)
    assert (overall[0]["count"], overall[0]["points"]) == (2, 100)
    assert (month[0]["count"], month[0]["points"]) == (1, 50) and (year[0]["count"], year[0]["points"]) == (1, 50)

    review = await year_review._achievements(flow.db, paula["id"], 2026)
    assert review["count"] == 1 and [row["name"] for row in review["top"]] == ["Leseratte I"]
