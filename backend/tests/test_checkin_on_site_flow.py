"""Vor-Ort-Turniere (#1135): die Turnierleitung checkt ein - nirgends eine Aufforderung zum Selbst-Check-in.

Eine Prüfung im Server (``tournament_rules.self_checkin_allowed``) nutzen der Check-in, die Startseite, die
Erinnerungen, die Mail und Discord. Online und hybrid bleibt alles wie bisher.
"""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services.discord_announcements import thread_line, tournament_buttons, tournament_message  # noqa: E402
from services.tournament_reminders import checkin_reminder_text, schedule_checkin_reminders  # noqa: E402
from services.tournament_rules import self_checkin_allowed  # noqa: E402

CHECK_IN_FROM = datetime(2026, 11, 14, 17, 0, tzinfo=timezone.utc)
CHECK_IN_UNTIL = datetime(2026, 11, 14, 17, 45, tzinfo=timezone.utc)


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def test_one_rule_for_every_place():
    assert self_checkin_allowed({"event_mode": "online"}) and self_checkin_allowed({"event_mode": "hybrid"})
    assert self_checkin_allowed({}), "ohne Angabe online"
    assert not self_checkin_allowed({"event_mode": "local"})


def test_reminder_texts_name_the_staff_on_site():
    local = {"title": "LAN-Cup", "event_mode": "local", "check_in_until": CHECK_IN_UNTIL.isoformat()}
    online = {**local, "event_mode": "online"}
    title, body = checkin_reminder_text(local, "open_now", CHECK_IN_FROM)
    assert (title, body) == ("Check-in ist offen", "LAN-Cup: Check-in ist offen. Bitte bis 14.11.2026, 18:45 Uhr vor Ort bei der Turnierleitung melden.")
    assert "einchecken" not in checkin_reminder_text(local, "closes_10m", CHECK_IN_UNTIL)[1]
    assert checkin_reminder_text(local, "closes_10m", CHECK_IN_UNTIL)[1] == "LAN-Cup: Bitte bis 14.11.2026, 18:45 Uhr vor Ort bei der Turnierleitung melden."
    assert "vor Ort bei der Turnierleitung ab 14.11.2026, 18:00 Uhr" in checkin_reminder_text(local, "opens_10m", CHECK_IN_FROM)[1]
    assert checkin_reminder_text(online, "open_now", CHECK_IN_FROM)[1] == "LAN-Cup: Check-in ist jetzt offen. Bitte bis 14.11.2026, 18:45 Uhr einchecken."


def test_discord_says_on_site_without_check_in_button():
    local = {"id": "t1", "slug": "lan-cup", "title": "LAN-Cup", "event_mode": "local", "check_in_until": CHECK_IN_UNTIL.isoformat()}
    assert "bei der Turnierleitung melden" in thread_line(local, "check_in")
    assert "einchecken" not in thread_line(local, "check_in").lower()
    assert tournament_buttons(local, "check_in") == [{"label": "Zum Turnier", "url": "/tournaments/lan-cup"}]
    assert "Check-in vor Ort" in tournament_message(local, "check_in", in_thread=True)["title"]
    online = {**local, "event_mode": "online"}
    assert tournament_buttons(online, "check_in") == [{"label": "Zum Check-in", "url": "/tournaments/lan-cup"}]
    assert thread_line(online, "check_in").startswith("Jetzt einchecken")


@pytest.mark.asyncio
async def test_dashboard_and_reminders_on_site(flow):
    player = await flow.add_user(name="Spielerin")
    soon = now_utc() + timedelta(minutes=10)
    local = await flow.create_tournament(event_mode="local", status="check_in", start_date=(now_utc() + timedelta(hours=1)).isoformat(),
                                         check_in_from=(now_utc() - timedelta(minutes=30)).isoformat(), check_in_until=soon.isoformat())
    online = await flow.create_tournament(event_mode="online", status="check_in", start_date=(now_utc() + timedelta(hours=1)).isoformat(),
                                          check_in_from=(now_utc() - timedelta(minutes=30)).isoformat(), check_in_until=soon.isoformat())
    for tournament in (local, online):
        await flow.register(tournament, player)

    flow.act_as(player)
    data = (await flow.get("/api/mobile/dashboard")).json()
    actions = {action["id"]: action for action in data["me"]["actions"]}
    on_site = actions[f"tournament-checkin-{local['id']}"]
    assert on_site["type"] == "tournament_checkin_onsite" and on_site["label"] == "Check-in vor Ort"
    assert "bei der Turnierleitung melden, bis" in on_site["detail"]
    assert actions[f"tournament-checkin-{online['id']}"]["label"] == "Turnier Check-in offen"
    rows = {row["id"]: row for row in data["me"]["tournaments"]}
    assert rows[local["id"]]["self_checkin"] is False and rows[online["id"]]["self_checkin"] is True

    refused = await flow.post(f"/api/tournaments/{local['id']}/checkin")
    assert refused.status_code == 403

    await schedule_checkin_reminders(now_utc())
    notes = {row["meta"]["tournament_id"]: row for row in await flow.db.notifications.find({"kind": "tournament_checkin"}, {"_id": 0}).to_list(10)}
    assert "vor Ort bei der Turnierleitung melden" in notes[local["id"]]["body"]
    assert "Check-in endet um" in notes[online["id"]]["body"]
    mails = {job["template_key"] for job in await flow.db.mail_jobs.find({}, {"_id": 0}).to_list(10)}
    assert mails == {"checkin_closes_soon_on_site", "checkin_closes_soon"}
    on_site_mail = await flow.db.mail_jobs.find_one({"template_key": "checkin_closes_soon_on_site"}, {"_id": 0})
    assert "Jetzt einchecken" not in on_site_mail["html"] and "vor Ort bei der Turnierleitung" in on_site_mail["html"]
