"""Mitgliederbereich in der App, Server-Seite (#342, #346): Meldungen zu internen Inhalten gehen nur an
Berechtigte - nie an alle -, und die Mitgliedskarte verrät beim Prüfen nur das Nötigste."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import member_announcements, member_card  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def person(flow, name, *, role="player", member=False, push=False, **fields):
    user = await flow.add_user(role=role, name=name)
    if fields:
        await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
    if member:
        await flow.db.memberships.insert_one({"id": f"m-{name}", "user_id": user["id"], "member_status": "active",
                                              "membership_type": "ordinary", "member_number": f"TLS-{name}", "member_since": "2024-03-01"})
    if push:
        await flow.db.mobile_push_tokens.insert_one({"id": f"t-{name}", "user_id": user["id"], "token": f"ExponentPushToken[{name}]", "active": True})
    return user


async def notifications_of(flow, user, kind_prefix):
    return await flow.db.notifications.find({"user_id": user["id"], "kind": {"$regex": f"^{kind_prefix}"}}, {"_id": 0}).to_list(20)


# ---------------------------------------------------------------- Wer bekommt die Meldung (#342)

@pytest.mark.asyncio
async def test_internal_event_reaches_members_only_and_never_everyone(flow):
    mitglied = await person(flow, "mitglied", member=True, push=True)
    gast = await person(flow, "gast", push=True)
    ehemalig = await person(flow, "ehemalig", push=True)
    await flow.db.memberships.insert_one({"id": "m-ehemalig", "user_id": ehemalig["id"], "member_status": "former"})
    vorstand = await person(flow, "vorstand", role="club_admin", member=True)
    start = (now_utc() + timedelta(days=10)).isoformat()
    await flow.db.events.insert_one({"id": "e1", "slug": "lan", "name": "LAN im Vereinsheim", "status": "scheduled", "visibility": "members", "start_date": start, "created_at": now_utc().isoformat()})
    await flow.db.events.insert_one({"id": "e2", "slug": "sitzung", "name": "Vorstandssitzung", "status": "scheduled", "visibility": "internal", "start_date": start, "created_at": now_utc().isoformat()})
    await flow.db.events.insert_one({"id": "e3", "slug": "open", "name": "Öffentliches Turnierfest", "status": "scheduled", "visibility": "public", "start_date": start, "created_at": now_utc().isoformat()})
    await flow.db.events.insert_one({"id": "e4", "slug": "vorbei", "name": "Altes Event", "status": "scheduled", "visibility": "members", "start_date": (now_utc() - timedelta(days=2)).isoformat(), "created_at": now_utc().isoformat()})

    result = await member_announcements.notify_due()
    assert result["items"] == 2

    assert [n["body"] for n in await notifications_of(flow, mitglied, "event_")] == ["LAN im Vereinsheim"]
    assert await notifications_of(flow, gast, "event_") == [], "kein Mitglied, keine Meldung - auch nicht mit Push-Token"
    assert await notifications_of(flow, ehemalig, "event_") == []
    assert sorted(n["body"] for n in await notifications_of(flow, vorstand, "event_")) == ["LAN im Vereinsheim", "Vorstandssitzung"]
    assert await flow.db.notifications.count_documents({"body": "Öffentliches Turnierfest"}) == 0, "Öffentliches geht über Newsletter und Discord, nicht hier"
    assert (await flow.db.events.find_one({"id": "e4"}))["members_notified_count"] == 0, "Vergangenes wird nicht mehr gemeldet"

    again = await member_announcements.notify_due()
    assert again["items"] == 0, "jedes Event genau einmal"
    assert await flow.db.notifications.count_documents({"user_id": mitglied["id"]}) == 1


@pytest.mark.asyncio
async def test_internal_news_and_board_by_area_not_by_role(flow):
    mitglied = await person(flow, "mitglied", member=True)
    freigabe = await person(flow, "freigabe", areas=["club"])
    kassier = await person(flow, "kassier", member=True)
    await flow.db.memberships.update_one({"user_id": kassier["id"]}, {"$set": {"source": "dolibarr", "dolibarr": {"functions": [{"code": "kassier", "label": "Kassier:in", "since": "2026-01-01"}], "synced_at": now_utc().isoformat()}}})
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {"id": "dolibarr", "mode": "live", "function_policy": {"version": 1, "map": {"kassier": ["club"]}, "approved_at": now_utc().isoformat()}}}, upsert=True)
    now = now_utc().isoformat()
    await flow.db.news_posts.insert_one({"id": "n1", "slug": "intern", "title": "Nur für Mitglieder", "content": "x", "visibility": "members", "published": True, "published_at": now})
    await flow.db.news_posts.insert_one({"id": "n2", "slug": "vorstand", "title": "Nur für den Vorstand", "content": "x", "visibility": "internal", "published": True, "published_at": now})
    await flow.db.news_posts.insert_one({"id": "n3", "slug": "morgen", "title": "Kommt morgen", "content": "x", "visibility": "members", "published": True, "published_at": (now_utc() + timedelta(days=1)).isoformat()})

    await member_announcements.notify_due()
    assert [n["body"] for n in await notifications_of(flow, mitglied, "news_")] == ["Nur für Mitglieder"]
    assert [n["body"] for n in await notifications_of(flow, freigabe, "news_")] == ["Nur für den Vorstand"], "Freigabe zählt wie ein Vorstandsposten"
    assert sorted(n["body"] for n in await notifications_of(flow, kassier, "news_")) == ["Nur für Mitglieder", "Nur für den Vorstand"], "Dolibarr-Funktion zählt"
    assert await flow.db.notifications.count_documents({"body": "Kommt morgen"}) == 0


@pytest.mark.asyncio
async def test_no_recipients_means_no_notification_at_all(flow):
    await person(flow, "gast")
    await flow.db.news_posts.insert_one({"id": "n1", "slug": "x", "title": "Intern", "content": "x", "visibility": "members", "published": True, "published_at": now_utc().isoformat()})
    result = await member_announcements.notify_due()
    assert result == {"items": 1, "sent": 0}
    assert await flow.db.notifications.count_documents({}) == 0, "kein Rückfall auf alle"


@pytest.mark.asyncio
async def test_old_internal_content_is_not_announced_after_the_update(flow):
    await person(flow, "mitglied", member=True)
    await flow.db.news_posts.insert_one({"id": "alt", "slug": "alt", "title": "Von damals", "content": "x", "visibility": "members", "published": True, "published_at": (now_utc() - timedelta(days=30)).isoformat()})
    await flow.db.events.insert_one({"id": "e-alt", "slug": "e-alt", "name": "Lange geplant", "status": "scheduled", "visibility": "members", "start_date": (now_utc() + timedelta(days=60)).isoformat(), "created_at": (now_utc() - timedelta(days=10)).isoformat()})
    result = await member_announcements.notify_due()
    assert result == {"items": 0, "sent": 0}
    assert await flow.db.notifications.count_documents({}) == 0
    assert (await flow.db.news_posts.find_one({"id": "alt"}))["members_notified_count"] == 0
    assert (await flow.db.events.find_one({"id": "e-alt"}))["members_notified_count"] == 0


# ---------------------------------------------------------------- Mitgliedskarte (#346)

@pytest.mark.asyncio
async def test_card_only_for_active_members_and_the_check_reveals_the_minimum(flow):
    paula = await person(flow, "paula", member=True, display_name="Paula B.", first_name="Paula", last_name="Beispiel", email="paula@lionsquad-test.at")
    flow.act_as(paula)
    card = (await flow.get("/api/account/member-card")).json()
    assert card["status"] == "valid" and card["member_number"] == "TLS-paula" and card["type_label"] == "Ordentliches Mitglied"
    assert card["verify_url"].startswith("https://") and "/karte/pruefen/" in card["verify_url"]
    token = card["verify_url"].rsplit("/", 1)[1]
    assert "paula" not in token.lower() and "TLS" not in token, "der Code trägt weder Name noch Nummer"
    assert card["wallet"]["barcode"]["format"] == "QR" and card["wallet"]["needs"]["apple"]

    flow.act_as(None)
    check = (await flow.get(f"/api/card/verify/{token}")).json()
    assert check["valid"] is True and check["name"] == "Paula B." and check["type_label"] == "Ordentliches Mitglied"
    for secret in ("paula@", "TLS-paula", "Beispiel"):
        assert secret not in str(check), secret

    assert (await flow.get("/api/card/verify/gibt-es-nicht")).json()["valid"] is False
    assert (await flow.get("/api/card/verify/")).status_code in (404, 405)

    gast = await person(flow, "gast")
    flow.act_as(gast)
    assert (await flow.get("/api/account/member-card")).json()["status"] == "none"


@pytest.mark.asyncio
async def test_expired_token_and_ended_membership_are_not_valid(flow):
    paula = await person(flow, "paula", member=True)
    flow.act_as(paula)
    token = (await flow.get("/api/account/member-card")).json()["verify_url"].rsplit("/", 1)[1]
    await flow.db.member_card_tokens.update_one({"token": token}, {"$set": {"expires_at": now_utc() - timedelta(seconds=1)}})
    flow.act_as(None)
    assert (await flow.get(f"/api/card/verify/{token}")).json()["valid"] is False, "ein Foto von vorhin ist wertlos"

    flow.act_as(paula)
    fresh = (await flow.get("/api/account/member-card")).json()["verify_url"].rsplit("/", 1)[1]
    await flow.db.memberships.update_one({"user_id": paula["id"]}, {"$set": {"member_status": "former"}})
    flow.act_as(None)
    assert (await flow.get(f"/api/card/verify/{fresh}")).json()["valid"] is False, "beendet: sofort ungültig, auch mit frischem Code"


def test_card_status_follows_the_club_not_the_fee():
    assert member_card.card_status({"member_status": "active", "dolibarr": {"fee": {"status": "due"}}}) == "valid", "Rückstand ist kein Austritt"
    assert member_card.card_status({"member_status": "active", "dolibarr": {"membership_ends": "2020-01-01"}}, today="2026-09-22") == "ended"
    assert member_card.card_status({"member_status": "active", "dolibarr": {"membership_ends": "2026-12-31"}}, today="2026-09-22") == "valid"
    assert member_card.card_status({"member_status": "pending"}) == "none"
    assert member_card.card_status(None) == "none"
