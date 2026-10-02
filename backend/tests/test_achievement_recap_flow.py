"""Erfolge II (E12 #622): Wochenrückblick, „Erfolg der Woche“ auf Discord, Push-Deckel, Prestige und Rücknahme.

Der Rückblick geht montags nur an Personen mit Aktivität in der Woche (XP oder Erfolge), nur an sie selbst, und
höchstens einmal je Woche; wer ihn abbestellt, bekommt ihn nicht. Die Einbettung zeigt die seltenste Freischaltung
der Woche mit Person (nur öffentliche Profile). Erfolge, Level und Prestige schicken höchstens drei Pushes am Tag -
der Rest steht im Postfach. Prestige und Rücknahme stehen nur im Postfach, die Notiz des Admins nie.
"""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

VIENNA_MONDAY = datetime(2026, 10, 12, 9, 0, tzinfo=timezone(timedelta(hours=2)))  # Montag 09:00 Wien (Sommerzeit)


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def catalog(flow):
    await flow.db.achievement_groups.insert_many([
        {"code": "cup", "name": "Turniersieger", "category": "tournament", "public": True, "is_negative": False, "sort_order": 1},
        {"code": "oops", "name": "Peinlich", "category": "negative", "public": True, "is_negative": True, "sort_order": 2},
    ])
    await flow.db.achievements.insert_many([
        {"code": "cup-3", "group_code": "cup", "name": "Champion III", "material_name": "Gold", "material": "gold", "level": 3, "rank": 3, "points": 30},
        {"code": "cup-1", "group_code": "cup", "name": "Champion I", "material_name": "Bronze", "material": "bronze", "level": 1, "rank": 1, "points": 10},
        {"code": "oops-1", "group_code": "oops", "name": "Eigentor", "level": 1, "rank": 1, "points": 0},
    ])


async def activity(flow, user, *, xp=0, bonus=0, awards=(), at="2026-10-08T18:00:00+00:00", silent=()):
    if xp or bonus:
        await flow.db.xp_events.insert_one({"id": f"x-{user['id']}-{at}", "user_id": user["id"], "source": "match", "ref": at, "amount": xp, "bonus": bonus, "day": at[:10], "at": at})
    for code in awards:
        await flow.db.user_achievements.insert_one({"id": f"a-{user['id']}-{code}", "user_id": user["id"], "tier_code": code, "earned_at": at, "silent": code in silent})


def test_the_template_lists_each_achievement_and_escapes_everything():
    import email_service

    subject, html = email_service.tpl_achievement_recap("<Paula>", "05.10. – 11.10.2026", "55", "12", "Kämpfer", unlocked="Champion III (Gold)\nNeu <b>", next_up="Champion IV – noch 2", bonus_hint="Vereinsmitglieder bekommen 10 % mehr XP auf alles.", url="https://x/profile", preferences_url="https://x/prefs")
    assert subject == "Deine Woche: +55 XP"
    assert "&lt;Paula&gt;" in html and "<li>Champion III (Gold)</li>" in html and "<li>Neu &lt;b&gt;</li>" in html
    assert "Level 12 – Kämpfer" in html and "Als Nächstes:" in html and "https://x/prefs" in html


@pytest.mark.asyncio
async def test_only_people_with_activity_get_one_recap_and_opting_out_works(flow, monkeypatch):
    from services import achievement_recap, notification_preferences

    await catalog(flow)
    paula = await flow.add_user(name="paula")
    quiet = await flow.add_user(name="ruhig")
    opted_out = await flow.add_user(name="ohne")
    await flow.db.users.update_one({"id": opted_out["id"]}, {"$set": {"notification_preferences": {"achievement_recap": False}}})
    await activity(flow, paula, xp=50, bonus=5, awards=("cup-3", "oops-1"))
    await activity(flow, opted_out, xp=20)
    # Außerhalb der Woche zählt nichts.
    await activity(flow, quiet, xp=99, at="2026-09-20T18:00:00+00:00")

    sent = []

    async def fake_send(template_key, to, **kwargs):
        sent.append((template_key, to, kwargs))
        return {"ok": True}

    import email_service
    monkeypatch.setattr(email_service, "send_template", fake_send)
    result = await achievement_recap.queue_weekly_recaps(VIENNA_MONDAY)
    assert result["candidates"] == 2 and result["queued"] == 1 and result["skipped"] == 1
    assert [entry[1] for entry in sent] == [paula["email"]]
    kwargs = sent[0][2]
    assert kwargs["xp_week"] == "55" and kwargs["unlocked"] == "Champion III (Gold)", "negative Erfolge nie im Rückblick"
    assert kwargs["week"] == "05.10. – 11.10.2026"
    assert kwargs["bonus_hint"].startswith("Vereinsmitglieder bekommen 10 %")
    assert kwargs["dedupe_key"] == "achievement_recap:2026-W42:" + paula["id"]
    assert notification_preferences.TEMPLATE_CATEGORY["achievement_recap"] == "achievement_recap"
    assert notification_preferences.OPTIONAL_EMAIL_PREFERENCES["achievement_recap"]["channels"] == ["email"]


@pytest.mark.asyncio
async def test_silent_awards_and_quiet_weeks_send_nothing(flow):
    from services import achievement_recap

    await catalog(flow)
    paula = await flow.add_user(name="paula")
    await activity(flow, paula, awards=("cup-1",), silent=("cup-1",))
    start = datetime(2026, 10, 5, 6, 0, tzinfo=timezone.utc)
    assert await achievement_recap.recap_for(flow.db, paula, start, start + timedelta(days=7)) is None
    assert achievement_recap.bonus_hint(True) == ""


def test_the_week_embed_names_only_what_the_site_shows():
    from services import discord_embeds

    doc = {"award": {"name": "Champion III", "material_name": "Gold", "material_color": "#FFD700", "group_name": "Turniersieger", "description": "Drei Turniere gewonnen.",
                     "holders": 1, "percent": 2.5, "user": {"username": "paula", "display_name": "Paula"}}}
    embed = discord_embeds.achievement_week_embed(doc, "https://lionsquad.at")
    assert embed["title"] == "🏅 Erfolg der Woche: Champion III"
    assert "Freigeschaltet von **Paula**" in embed["description"] and "Seltenheit: 2,5 % – nur diese Person" in embed["description"]
    assert embed["url"] == "https://lionsquad.at/u/paula" and embed["color"] == 0xFFD700
    empty = discord_embeds.achievement_week_embed({"award": None}, "https://lionsquad.at")
    assert "kein Erfolg" in empty["description"] and empty["url"] == "https://lionsquad.at/achievements"
    assert "achievement_week" in discord_embeds.KINDS


@pytest.mark.asyncio
async def test_three_achievement_pushes_a_day_then_only_the_inbox(flow, monkeypatch):
    from services import push_notifications
    from services.user_notifications import create_user_notification

    paula = await flow.add_user(name="paula")
    pushed = []

    async def fake_push(doc):
        pushed.append(doc["title"])
        return 1

    monkeypatch.setattr(push_notifications, "send_mobile_push_for_notification", fake_push)
    for index in range(4):
        await create_user_notification(paula["id"], f"Erfolg {index}", "", kind="achievement", meta={"dedupe_key": f"a{index}"})
    assert pushed == ["Erfolg 0", "Erfolg 1", "Erfolg 2"]
    assert await flow.db.notifications.count_documents({"user_id": paula["id"], "kind": "achievement"}) == 4
    # Andere Arten zählen nicht mit.
    await create_user_notification(paula["id"], "Nachricht", "", kind="direct_message")
    assert pushed[-1] == "Nachricht"
    # Nur ins Postfach: kein Push.
    await create_user_notification(paula["id"], "Still", "", kind="news_mention", meta={"in_app_only": True})
    assert "Still" not in pushed


@pytest.mark.asyncio
async def test_prestige_and_revocation_land_in_the_inbox_only(flow, monkeypatch):
    from services import achievement_admin, push_notifications, xp

    await catalog(flow)
    paula = await flow.add_user(name="paula")
    admin = await flow.add_user(role="superadmin", name="vorstand")
    pushed = []

    async def fake_push(doc):
        pushed.append(doc["title"])
        return 1

    monkeypatch.setattr(push_notifications, "send_mobile_push_for_notification", fake_push)
    await flow.db.user_achievements.insert_one({"id": "a1", "user_id": paula["id"], "tier_code": "cup-3", "earned_at": "2026-10-08T18:00:00+00:00"})
    await achievement_admin.revoke_with_reason(flow.db, admin, paula["id"], "cup-3", note="intern: doppelt gezählt")
    revoked = await flow.db.notifications.find_one({"user_id": paula["id"], "kind": "achievement_revoked"}, {"_id": 0})
    assert revoked["title"] == "Erfolg zurückgenommen" and "Champion III" in revoked["body"]
    assert "intern" not in revoked["body"], "die Notiz des Admins bleibt intern"

    from services import levels
    await flow.db.user_xp.insert_one({"user_id": paula["id"], "total": levels.xp_for_level(levels.MAX_LEVEL, 0), "prestige": 0, "level": levels.MAX_LEVEL})
    await xp.prestige(paula["id"])
    star = await flow.db.notifications.find_one({"user_id": paula["id"], "kind": "prestige"}, {"_id": 0})
    assert star["title"] == "Prestige ★" and star["meta"]["in_app_only"] is True
    assert pushed == [], "Prestige und Rücknahme schicken keinen Push"


def test_a_package_names_its_most_valuable_award_and_the_dm_finds_words_for_the_material():
    from services import achievement_queue, discord_dm

    rows = [{"tier_name": "Champion I", "material": "bronze", "level": 1, "points": 10},
            {"tier_name": "Champion III", "material": "gold", "level": 3, "points": 30},
            {"tier_name": "Fleißig", "material": "silver", "level": 2, "points": 90}]
    assert achievement_queue.top_award(rows)["tier_name"] == "Champion III", "Material vor Punkten"
    note = {"url": "/profile?tab=achievements", "meta": {"awards": [{"name": "Champion III", "points": 30}], "top": {"name": "Champion III", "material": "gold"}, "level": 3}}
    content = discord_dm.achievement_content(note, "Paula")
    assert "Gold! Das schaffen nicht viele." in content["description"] and content["color"] == 0xFFD700
    assert "image_path" not in content
    legendary = discord_dm.achievement_content({**note, "meta": {**note["meta"], "top": {"material": "legendary"}, "share_award_id": "a9"}}, "Paula")
    assert legendary["image_path"] == "/api/achievements/share/a9.png" and "Legendär" in legendary["description"]


@pytest.mark.asyncio
async def test_a_legendary_award_shows_its_share_card_only_on_a_public_profile(flow, monkeypatch):
    from services import achievement_queue

    await flow.db.achievement_groups.insert_one({"code": "myth", "name": "Mythen", "category": "special", "public": True, "is_negative": False})
    await flow.db.achievements.insert_one({"code": "myth-1", "group_code": "myth", "name": "Unbesiegt", "material": "legendary", "material_name": "Legendär", "level": 8, "rank": 8, "points": 500})
    public = await flow.add_user(name="paula")
    hidden = await flow.add_user(name="privat")
    await flow.db.users.update_one({"id": public["id"]}, {"$set": {"privacy_public_profile": True}})
    for user in (public, hidden):
        await flow.db.user_achievements.insert_one({"id": f"aw-{user['id']}", "user_id": user["id"], "tier_code": "myth-1", "earned_at": "2026-10-08T18:00:00+00:00"})
        await achievement_queue.note_award(user["id"], {"code": "myth-1", "name": "Unbesiegt", "points": 500, "level": 8, "material": "legendary"}, {"name": "Mythen"})
    monkeypatch.setattr(achievement_queue, "BUNDLE_WINDOW_SECONDS", -1)
    await achievement_queue.flush_awards()
    shown = await flow.db.notifications.find_one({"user_id": public["id"], "kind": "achievement"}, {"_id": 0})
    kept = await flow.db.notifications.find_one({"user_id": hidden["id"], "kind": "achievement"}, {"_id": 0})
    assert shown["body"].startswith("Legendär: Unbesiegt") and shown["meta"]["share_award_id"] == f"aw-{public['id']}"
    assert "share_award_id" not in kept["meta"], "ohne öffentliches Profil keine öffentliche Karte"
