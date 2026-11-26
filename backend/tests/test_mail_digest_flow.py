"""Sammel-Mail (#1662) auf der Datenbank-Schicht: sammeln statt einzeln, genau eine Mail je Zeitraum, Dringendes sofort,
nur, was die Person sehen darf. Mit ``FLOW_MONGO_URL`` gegen echtes MongoDB samt den eindeutigen Indizes
``mail_digest_runs.user_period`` und ``mail_digest_items.user_dedupe`` (docs/entwicklung/abnahme-lokal.md, Abschnitt 7).

Es geht keine echte Mail hinaus: Mails stehen nur in ``mail_jobs`` (ohne Versand-Job)."""
import asyncio
import os
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

from services import mail_digest  # noqa: E402
from services.notification_preferences import send_user_template  # noqa: E402

URL = "https://lionsquad.test/tournaments/winter-cup"


def _utc(text):
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def _clock(monkeypatch, when):
    moment = _utc(when)
    monkeypatch.setattr("services.mail_digest.now_utc", lambda: moment)
    monkeypatch.setattr("services.mail_digest_rules.now_utc", lambda: moment)
    return moment


async def _person(flow, rhythm="daily", **extra):
    user = await flow.add_user(name="Paula")
    if rhythm:
        await flow.db.users.update_one({"id": user["id"]}, {"$set": {"mail_digest": rhythm, **extra}})
    return await flow.db.users.find_one({"id": user["id"]}, {"_id": 0})


async def _approved(user, number, **extra):
    return await send_user_template(user, "registration_approved", tournament_title=f"Winter Cup {number}", url=URL,
                                    detail="Check-in ab 17:30 Uhr.", dedupe_key=f"reg:{number}:{user['id']}", **extra)


async def _jobs(flow, **query):
    return await flow.db.mail_jobs.find(query, {"_id": 0}).to_list(100)


# ---------------------------------------------------------------- sammeln statt einzeln

@pytest.mark.asyncio
async def test_with_daily_digest_the_mail_waits_and_with_instant_it_goes_out(flow, monkeypatch):
    _clock(monkeypatch, "2026-11-26T10:00:00")
    paula = await _person(flow, "daily")
    result = await _approved(paula, 1)
    assert result["ok"] and result.get("digest") is True
    assert await _jobs(flow) == []
    items = await flow.db.mail_digest_items.find({"user_id": paula["id"]}, {"_id": 0}).to_list(10)
    assert len(items) == 1 and items[0]["template_key"] == "registration_approved"
    assert items[0]["category"] == "tournament_updates" and items[0]["url"] == URL
    assert items[0]["subject"] and items[0]["preview"] == "Check-in ab 17:30 Uhr."

    max_ = await _person(flow, "instant")
    await _approved(max_, 2)
    assert len(await _jobs(flow, template_key="registration_approved")) == 1


@pytest.mark.asyncio
async def test_the_default_rhythm_comes_from_the_settings(flow, monkeypatch):
    _clock(monkeypatch, "2026-11-26T10:00:00")
    paula = await _person(flow, rhythm=None)
    await _approved(paula, 1)
    assert len(await _jobs(flow)) == 1, "Vorgabe „sofort“: wie bisher"
    await flow.db.settings.insert_one({"id": mail_digest.SETTINGS_ID, "default_rhythm": "weekly"})
    await _approved(paula, 2)
    assert len(await _jobs(flow)) == 1
    assert await flow.db.mail_digest_items.count_documents({"user_id": paula["id"]}) == 1


@pytest.mark.asyncio
async def test_urgent_mails_never_go_into_the_collection(flow, monkeypatch):
    _clock(monkeypatch, "2026-11-26T10:00:00")
    paula = await _person(flow, "weekly")
    await send_user_template(paula, "match_lead_10m", tournament_title="Winter Cup", opponent="Neon Kings", when="10:10", url=URL,
                             dedupe_key=f"lead:{paula['id']}")
    await send_user_template(paula, "league_notice", title="Check-in offen", text="Jetzt einchecken.", url=URL,
                             dedupe_key=f"league:{paula['id']}", importance="urgent")
    assert sorted(job["template_key"] for job in await _jobs(flow)) == ["league_notice", "match_lead_10m"]
    assert await flow.db.mail_digest_items.count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_switched_off_topic_is_not_collected_either(flow, monkeypatch):
    _clock(monkeypatch, "2026-11-26T10:00:00")
    paula = await _person(flow, "daily", notification_preferences={"email:tournament_updates": False})
    result = await _approved(paula, 1)
    assert result.get("reason") == "preference_disabled"
    assert await flow.db.mail_digest_items.count_documents({}) == 0


@pytest.mark.asyncio
async def test_the_same_mail_is_collected_once(flow, monkeypatch):
    _clock(monkeypatch, "2026-11-26T10:00:00")
    paula = await _person(flow, "daily")
    await _approved(paula, 1)
    again = await _approved(paula, 1)
    assert again.get("deduped") is True
    assert await flow.db.mail_digest_items.count_documents({"user_id": paula["id"]}) == 1


# ---------------------------------------------------------------- genau eine Mail je Zeitraum

@pytest.mark.asyncio
async def test_one_digest_at_the_slot_and_nothing_twice(flow, monkeypatch):
    _clock(monkeypatch, "2026-11-25T15:00:00")
    paula = await _person(flow, "daily")
    for number in (1, 2, 3):
        await _approved(paula, number)
    early = await mail_digest.send_due(flow.db, _utc("2026-11-26T05:59:00"))
    assert early == {"digests": 0, "items": 0, "skipped": 0} and await _jobs(flow) == []

    done = await mail_digest.send_due(flow.db, _utc("2026-11-26T06:00:00"))
    assert (done["digests"], done["items"]) == (1, 3)
    jobs = await _jobs(flow)
    assert len(jobs) == 1 and jobs[0]["template_key"] == mail_digest.DIGEST_TEMPLATE
    assert jobs[0]["subject"] == "Deine Sammel-Mail: 3 Neuigkeiten"
    assert all(f"Winter Cup {number}" in jobs[0]["html"] for number in (1, 2, 3))
    assert "Turnier-Updates" in jobs[0]["html"]
    assert "/profile?tab=notifications&amp;bereich=mail" in jobs[0]["html"]
    assert (await mail_digest.send_due(flow.db, _utc("2026-11-26T06:05:00")))["digests"] == 0
    assert len(await _jobs(flow)) == 1


@pytest.mark.asyncio
async def test_what_comes_after_the_slot_waits_for_the_next_one(flow, monkeypatch):
    _clock(monkeypatch, "2026-11-25T15:00:00")
    paula = await _person(flow, "daily")
    await _approved(paula, 1)
    _clock(monkeypatch, "2026-11-26T06:30:00")
    await _approved(paula, 2)
    first = await mail_digest.send_due(flow.db, _utc("2026-11-26T06:31:00"))
    assert (first["digests"], first["items"]) == (1, 1)
    second = await mail_digest.send_due(flow.db, _utc("2026-11-27T06:00:00"))
    assert (second["digests"], second["items"]) == (1, 1)
    jobs = sorted(await _jobs(flow), key=lambda job: job["created_at"])
    assert "Winter Cup 1" in jobs[0]["html"] and "Winter Cup 2" not in jobs[0]["html"]
    assert "Winter Cup 2" in jobs[1]["html"]


@pytest.mark.asyncio
async def test_switching_back_to_instant_sends_what_waits_at_the_next_run(flow, monkeypatch):
    _clock(monkeypatch, "2026-11-26T10:00:00")
    paula = await _person(flow, "weekly")
    await _approved(paula, 1)
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"mail_digest": "instant"}})
    done = await mail_digest.send_due(flow.db, _utc("2026-11-26T10:10:00"))
    assert (done["digests"], done["items"]) == (1, 1)
    assert (await mail_digest.send_due(flow.db, _utc("2026-11-26T10:20:00")))["digests"] == 0


@pytest.mark.asyncio
async def test_two_runs_at_once_send_one_digest(flow, monkeypatch):
    """Zwei Läufe zur selben Zeit (zwei Server, ein verspäteter Job): eine Mail - auf echtem MongoDB echt gleichzeitig."""
    assert flow.real_mongo is bool(os.environ.get("FLOW_MONGO_URL"))
    _clock(monkeypatch, "2026-11-25T15:00:00")
    people = [await _person(flow, "daily") for _ in range(3)]
    for person in people:
        for number in (1, 2):
            await _approved(person, number)
    moment = _utc("2026-11-26T06:00:00")
    results = await asyncio.gather(*(mail_digest.send_due(flow.db, moment) for _ in range(4)))
    assert sum(result["digests"] for result in results) == 3
    jobs = await _jobs(flow, template_key=mail_digest.DIGEST_TEMPLATE)
    assert sorted(job["meta"]["user_id"] for job in jobs) == sorted(person["id"] for person in people)
    assert await flow.db.mail_digest_items.count_documents({"sent_at": {"$exists": False}}) == 0


@pytest.mark.asyncio
async def test_two_runs_that_meet_before_binding_the_rows_still_send_one_mail(flow, monkeypatch):
    """Beide Läufe haben offene Zeilen gesehen und binden sie im selben Moment: Nur wer den Zeitraum beansprucht hat, bindet
    und schickt - sonst teilten sich zwei Mails die Zeilen."""
    from flow_harness import InterleavedReads

    _clock(monkeypatch, "2026-11-25T15:00:00")
    paula = await _person(flow, "daily")
    for number in range(1, 7):
        await _approved(paula, number)
    gate = InterleavedReads(flow.db, "mail_digest_items", parties=2, before=("update_many",))
    moment = _utc("2026-11-26T06:00:00")
    results = await asyncio.gather(mail_digest.send_due(gate, moment), mail_digest.send_due(gate, moment))
    assert sum(result["digests"] for result in results) == 1
    jobs = await _jobs(flow, template_key=mail_digest.DIGEST_TEMPLATE)
    assert len(jobs) == 1 and all(f"Winter Cup {number}" in jobs[0]["html"] for number in range(1, 7))


@pytest.mark.asyncio
async def test_a_run_that_stopped_after_claiming_is_finished_later(flow, monkeypatch):
    _clock(monkeypatch, "2026-11-25T15:00:00")
    paula = await _person(flow, "daily")
    await _approved(paula, 1)
    moment = _utc("2026-11-26T06:00:00")
    run = await mail_digest.claim_run(flow.db, paula["id"], "daily:2026-11-26", moment)
    assert run and await mail_digest.claim_run(flow.db, paula["id"], "daily:2026-11-26", moment) is None
    # Der Lauf bricht hier ab. Solange sein Anspruch gilt, schickt kein anderer ...
    assert (await mail_digest.send_due(flow.db, moment + timedelta(minutes=5)))["digests"] == 0
    # ... danach holt ein späterer Lauf ihn nach - einmal.
    later = moment + timedelta(seconds=mail_digest.CLAIM_SECONDS + 60)
    assert (await mail_digest.send_due(flow.db, later))["digests"] == 1
    assert (await mail_digest.send_due(flow.db, later + timedelta(minutes=5)))["digests"] == 0
    assert len(await _jobs(flow)) == 1


# ---------------------------------------------------------------- nur, was die Person sehen darf

@pytest.mark.asyncio
async def test_what_the_person_may_no_longer_see_stays_out(flow, monkeypatch):
    _clock(monkeypatch, "2026-11-25T15:00:00")
    paula = await _person(flow, "daily")
    await _approved(paula, 1)
    await send_user_template(paula, "event_message", category="club_internal", display_name="Paula", event_name="Vereinsabend",
                             message="Nur für Mitglieder.", url=URL, dedupe_key=f"intern:{paula['id']}")
    other = await _person(flow, "daily")
    await _approved(other, 9)
    # Paula ist kein Mitglied (mehr): das Vereinsinterne fehlt; ihr Turnier-Update bleibt, fremde Meldungen kommen nie hinein.
    await mail_digest.send_due(flow.db, _utc("2026-11-26T06:00:00"))
    mine = (await _jobs(flow, **{"meta.user_id": paula["id"]}))[0]["html"]
    assert "Winter Cup 1" in mine and "Vereinsabend" not in mine and "Winter Cup 9" not in mine


@pytest.mark.asyncio
async def test_members_see_their_internal_news(flow, monkeypatch):
    _clock(monkeypatch, "2026-11-25T15:00:00")
    paula = await _person(flow, "daily")
    await flow.db.memberships.insert_one({"id": "m1", "user_id": paula["id"], "member_status": "active"})
    await send_user_template(paula, "event_message", category="club_internal", display_name="Paula", event_name="Vereinsabend",
                             message="Nur für Mitglieder.", url=URL, dedupe_key=f"intern:{paula['id']}")
    await mail_digest.send_due(flow.db, _utc("2026-11-26T06:00:00"))
    assert "Vereinsabend" in (await _jobs(flow))[0]["html"]


@pytest.mark.asyncio
async def test_a_topic_switched_off_since_and_a_banned_account_get_nothing(flow, monkeypatch):
    _clock(monkeypatch, "2026-11-25T15:00:00")
    paula = await _person(flow, "daily")
    await _approved(paula, 1)
    banned = await _person(flow, "daily")
    await _approved(banned, 2)
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"notification_preferences": {"email:tournament_updates": False}}})
    await flow.db.users.update_one({"id": banned["id"]}, {"$set": {"is_banned": True}})
    done = await mail_digest.send_due(flow.db, _utc("2026-11-26T06:00:00"))
    assert done["digests"] == 0 and done["skipped"] == 2
    assert await _jobs(flow) == []
    # Erledigt, nicht vergessen: beim nächsten Lauf nicht noch einmal geprüft.
    assert await flow.db.mail_digest_items.count_documents({"sent_at": {"$exists": False}, "dropped": {"$exists": False}}) == 0


# ---------------------------------------------------------------- Einstellungen

@pytest.mark.asyncio
async def test_the_person_sets_the_rhythm_and_sees_when_it_comes(flow):
    paula = await _person(flow, rhythm=None)
    flow.act_as(paula)
    payload = (await flow.get("/api/users/me/notification-preferences")).json()
    assert payload["mail_digest"] == {
        "rhythm": "instant", "own": None, "default": "instant",
        "options": [
            {"key": "instant", "label": "Sofort", "schedule": "Jede Mail sofort"},
            {"key": "daily", "label": "Täglich", "schedule": "Täglich um 07:00 Uhr"},
            {"key": "weekly", "label": "Wöchentlich", "schedule": "Montags um 07:00 Uhr"},
        ],
    }
    res = await flow.patch("/api/users/me", json={"mail_digest": "weekly"})
    assert res.status_code == 200, res.text
    assert (await flow.get("/api/users/me/notification-preferences")).json()["mail_digest"]["rhythm"] == "weekly"
    assert (await flow.patch("/api/users/me", json={"mail_digest": "stündlich"})).status_code == 422


@pytest.mark.asyncio
async def test_the_admin_sets_the_defaults_and_sees_a_preview(flow):
    admin = await flow.add_user(role="superadmin", name="Obmann")
    flow.act_as(admin)
    current = (await flow.get("/api/settings/notification-digest")).json()
    assert current["settings"] == mail_digest.normalized_settings({})
    res = await flow.put("/api/settings/notification-digest", json={"default_rhythm": "daily", "daily_time": "18:00",
                                                                     "weekly_weekday": 6, "weekly_time": "18:00"})
    assert res.status_code == 200, res.text
    assert (await flow.get("/api/settings/notification-digest")).json()["settings"]["daily_time"] == "18:00"
    assert (await flow.put("/api/settings/notification-digest", json={"daily_time": "25:00"})).status_code == 422
    preview = (await flow.get("/api/settings/notification-digest/preview")).json()
    assert preview["subject"].startswith("Deine Sammel-Mail") and "<html" in preview["html"]
    member = await flow.add_user(name="Mitglied")
    flow.act_as(member)
    assert (await flow.get("/api/settings/notification-digest")).status_code == 403


@pytest.mark.asyncio
async def test_a_second_claim_never_wins_whatever_the_ids(flow, monkeypatch):
    """Ohne eindeutigen Index (Speicher-Datenbank) entscheidet nicht die Reihenfolge der Kennungen: Wer zuerst da war, behält
    den Zeitraum - auch wenn die Kennung des Zweiten kleiner ist."""
    moment = _utc("2026-11-26T06:00:00")
    ids = iter(["zzz-first", "aaa-second"])
    monkeypatch.setattr("services.mail_digest.new_id", lambda: next(ids))
    first = await mail_digest.claim_run(flow.db, "u1", "daily:2026-11-26", moment)
    second = await mail_digest.claim_run(flow.db, "u1", "daily:2026-11-26", moment)
    assert first["id"] == "zzz-first" and second is None
    assert [row["id"] for row in await flow.db.mail_digest_runs.find({}, {"_id": 0}).to_list(5)] == ["zzz-first"]


# ---------------------------------------------------------------- Nachbesserung (Prüfung 26.11., Fabians Entscheidungen)

@pytest.mark.asyncio
async def test_more_than_500_rows_all_go_out_and_none_hang(flow, monkeypatch):
    _clock(monkeypatch, "2026-11-25T15:00:00")
    paula = await _person(flow, "daily")
    await flow.db.mail_digest_items.insert_many([
        {"id": f"i{number:04d}", "user_id": paula["id"], "template_key": "registration_approved", "category": "tournament_updates",
         "subject": f"Meldung {number}", "preview": "", "url": URL, "created_at": f"2026-11-25T15:{number % 60:02d}:00+00:00"}
        for number in range(520)])
    done = await mail_digest.send_due(flow.db, _utc("2026-11-26T06:00:00"))
    assert (done["digests"], done["items"]) == (1, 520)
    assert await flow.db.mail_digest_items.count_documents({"sent_at": {"$exists": False}}) == 0
    job = (await _jobs(flow))[0]
    assert job["subject"] == "Deine Sammel-Mail: 520 Neuigkeiten"
    assert f"und {520 - mail_digest.SHOWN_MAX} weitere" in job["html"]


@pytest.mark.asyncio
async def test_cancellations_and_new_dates_never_wait(flow, monkeypatch):
    """Fabian 26.11. (A): Absagen und Terminänderungen sind dringend - sofort, nie gesammelt."""
    _clock(monkeypatch, "2026-11-26T10:00:00")
    paula = await _person(flow, "weekly")
    await send_user_template(paula, "tournament_cancelled", display_name="Paula", tournament_title="Winter Cup", url=URL,
                             dedupe_key=f"cancel:{paula['id']}")
    await send_user_template(paula, "event_cancelled", display_name="Paula", event_name="Herbst-LAN", url=URL,
                             dedupe_key=f"ev-cancel:{paula['id']}")
    from services import event_changes
    event = {"id": "ev-1", "name": "Herbst-LAN", "slug": "herbst-lan"}
    await event_changes._inform(flow.db, event, [paula], title="Termin oder Ort geändert", message="Neuer Termin: Samstag",
                                dedupe="ev-change:ev-1:1")
    assert sorted(job["template_key"] for job in await _jobs(flow)) == ["event_cancelled", "event_message", "tournament_cancelled"]
    assert await flow.db.mail_digest_items.count_documents({}) == 0
    note = await flow.db.notifications.find_one({"user_id": paula["id"], "kind": "event_message"}, {"_id": 0})
    assert note["importance"] == "urgent"


@pytest.mark.asyncio
async def test_a_broken_template_call_still_reports_not_ok(flow, monkeypatch):
    _clock(monkeypatch, "2026-11-26T10:00:00")
    paula = await _person(flow, "daily")
    result = await send_user_template(paula, "registration_approved", tournament_title="Cup", url=URL, gibt_es_nicht="x")
    assert result["ok"] is False and "template args" in result["reason"]
    assert await flow.db.mail_digest_items.count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_slow_run_that_was_taken_over_counts_nothing_and_sends_nothing(flow, monkeypatch):
    _clock(monkeypatch, "2026-11-25T15:00:00")
    paula = await _person(flow, "daily")
    await _approved(paula, 1)
    moment = _utc("2026-11-26T06:00:00")
    slow = await mail_digest.claim_run(flow.db, paula["id"], "daily:2026-11-26", moment, moment.isoformat())
    later = moment + timedelta(seconds=mail_digest.CLAIM_SECONDS + 60)
    assert (await mail_digest.send_due(flow.db, later))["digests"] == 1
    user = await flow.db.users.find_one({"id": paula["id"]}, mail_digest.USER_FIELDS)
    assert await mail_digest._finish(flow.db, slow, user, moment, moment.isoformat()) == (0, 0)
    assert len(await _jobs(flow)) == 1


@pytest.mark.asyncio
async def test_the_mail_carries_a_signed_one_click_link_back_to_single_mails(flow, monkeypatch):
    """Fabian 26.11. (D): „Zurück auf Einzelmails“ mit einem Klick, ohne Login, signiert - wirkt nur auf mail_digest=instant."""
    from services import mail_digest_link

    _clock(monkeypatch, "2026-11-25T15:00:00")
    paula = await _person(flow, "weekly", newsletter_consent=True)
    await _approved(paula, 1)
    await mail_digest.send_due(flow.db, _utc("2026-11-30T06:00:00"))
    token = mail_digest_link.token_for(paula["id"])
    html = (await _jobs(flow))[0]["html"]
    assert f"{mail_digest_link.PAGE_PATH}?token={token}" in html
    # Fremdes Konto, kaputter Schlüssel: nichts.
    other = await _person(flow, "weekly")
    forged = f"{other['id']}.{token.rsplit('.', 1)[1]}"
    assert (await flow.client.post(f"{mail_digest_link.API_PATH}?token={forged}")).status_code == 400
    assert (await flow.client.post(f"{mail_digest_link.API_PATH}?token=kaputt")).status_code == 400
    assert mail_digest_link.token_for(paula["id"]) != mail_digest_link.token_for(other["id"])
    # Ein Klick: nur der Rhythmus, sonst nichts; der zweite Klick sagt „schon“.
    done = await flow.client.post(f"{mail_digest_link.API_PATH}?token={token}")
    assert done.status_code == 200 and done.json() == {"ok": True, "rhythm": "instant"}
    stored = await flow.db.users.find_one({"id": paula["id"]}, {"_id": 0, "mail_digest": 1, "newsletter_consent": 1})
    assert stored == {"mail_digest": "instant", "newsletter_consent": True}
    again = await flow.client.post(f"{mail_digest_link.API_PATH}?token={token}")
    assert again.json() == {"ok": True, "rhythm": "instant", "already": True}
    assert (await flow.db.users.find_one({"id": other["id"]}, {"_id": 0, "mail_digest": 1}))["mail_digest"] == "weekly"


@pytest.mark.asyncio
async def test_back_to_the_club_default(flow):
    """„Vorgabe des Vereins“ wählbar: mail_digest null nimmt die eigene Wahl zurück (Fabian 26.11., D)."""
    paula = await _person(flow, "weekly")
    flow.act_as(paula)
    res = await flow.patch("/api/users/me", json={"mail_digest": None})
    assert res.status_code == 200, res.text
    payload = (await flow.get("/api/users/me/notification-preferences")).json()["mail_digest"]
    assert payload["own"] is None and payload["rhythm"] == "instant"
