"""Rollen II (#1350): Superadmin-Konten bannt niemand, Strikes und Chat-Sperren gegen Admin-Konten nur durch den
Superadmin, die Freigabe „Turnierleitung“ zählt in allen Turnieren wie die Rolle, Mitglieder-Inhalte nach Bereich.

Durch die echte Anwendung (flow_harness): Routen, Wächter und Datenbank-Semantik sind die echten.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def granted(flow, name: str, *areas: str) -> dict:
    """Ein Spieler-Konto mit Freigaben - so, wie der Superadmin sie unter „Alle Benutzer“ vergibt."""
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"areas": list(areas)}})
    user["areas"] = list(areas)
    return user


def ranking(winner: str, loser: str) -> list[dict]:
    return [{"registration_id": winner, "rank": 1, "score": 2}, {"registration_id": loser, "rank": 2, "score": 0}]


# ---------------------------------------------------------------- Bannen

@pytest.mark.asyncio
async def test_no_one_bans_a_superadmin_account(flow):
    root = await flow.add_user(role="superadmin", name="root")
    other_root = await flow.add_user(role="superadmin", name="zweiter-root")
    chair = await granted(flow, "vorsitz", "club")
    reason = {"reason": "Wiederholt beleidigt"}

    for actor in (root, chair):
        flow.act_as(actor)
        refused = await flow.post(f"/api/users/{other_root['id']}/ban", json=reason)
        assert refused.status_code == 403, refused.text
        assert refused.json()["detail"] == "Superadmin-Konten lassen sich nicht bannen. Zuerst die Rolle ändern."
    stored = await flow.db.users.find_one({"id": other_root["id"]})
    assert not stored.get("is_banned")
    ban_audits = await flow.db.audit_logs.count_documents({"action": "user.ban"})
    assert ban_audits == 0

    # Zuerst die Rolle ändern, dann gilt der normale Weg - mit Grund im Protokoll.
    flow.act_as(root)
    demoted = await flow.post(f"/api/users/{other_root['id']}/role", json={"role": "player"})
    assert demoted.status_code == 200, demoted.text
    banned = await flow.post(f"/api/users/{other_root['id']}/ban", json=reason)
    assert banned.status_code == 200, banned.text
    stored = await flow.db.users.find_one({"id": other_root["id"]})
    assert stored["is_banned"] is True


# ---------------------------------------------------------------- Strikes und Chat-Sperren

async def report(flow, target: dict) -> str:
    flow.act_as(await flow.add_user(name=f"meldende-{new_id()[:4]}"))
    created = await flow.post("/api/moderation/reports", json={
        "target_user_id": target["id"], "category": "harassment", "details": "Beleidigung im Turnier-Chat",
    })
    assert created.status_code == 200, created.text
    return created.json()["report"]["id"]


@pytest.mark.asyncio
async def test_strikes_and_chat_blocks_against_admin_accounts_only_by_the_superadmin(flow):
    mod = await flow.add_user(role="moderator", name="mod")
    root = await flow.add_user(role="superadmin", name="root")
    lead = await flow.add_user(role="tournament_admin", name="turnierleitung")
    editor = await granted(flow, "redaktion", "content")
    player = await flow.add_user(name="spieler")
    report_id = await report(flow, lead)

    mod["auth_mfa_verified"] = False  # Moderation braucht keine Zwei-Faktor-Anmeldung
    flow.act_as(mod)
    for target in (lead, editor):
        strike = await flow.post(f"/api/moderation/people/{target['id']}/strikes", json={"note": "Beleidigung"})
        assert strike.status_code == 403, strike.text
        assert "Superadmin" in strike.json()["detail"]
        sanction = await flow.post(f"/api/moderation/people/{target['id']}/sanctions", json={
            "action": "warning", "reason": "Wiederholte Beleidigung", "chat_hours": 24,
        })
        assert sanction.status_code == 403, sanction.text
    justified = await flow.patch(f"/api/moderation/reports/{report_id}", json={"status": "justified", "resolution_note": "Belegt"})
    assert justified.status_code == 403, justified.text
    strikes = await flow.db.moderation_strikes.count_documents({})
    sanctions = await flow.db.moderation_sanctions.count_documents({})
    assert strikes == 0 and sanctions == 0
    # Die Meldung bleibt offen, bis der Superadmin entscheidet.
    stored_report = await flow.db.user_reports.find_one({"id": report_id})
    assert stored_report["status"] == "open"

    # Normale Konten verwarnt und sperrt die Moderation wie bisher.
    player_strike = await flow.post(f"/api/moderation/people/{player['id']}/strikes", json={"note": "Spam"})
    assert player_strike.status_code == 200, player_strike.text
    blocked = await flow.post(f"/api/moderation/people/{player['id']}/sanctions", json={"action": "warning", "reason": "Spam im Chat", "chat_hours": 12})
    assert blocked.status_code == 200, blocked.text

    # Der Superadmin darf - ein Strike braucht dann einen Grund fürs Protokoll.
    flow.act_as(root)
    without_note = await flow.post(f"/api/moderation/people/{lead['id']}/strikes", json={"note": ""})
    assert without_note.status_code == 422, without_note.text
    struck = await flow.post(f"/api/moderation/people/{lead['id']}/strikes", json={"note": "Beleidigung im Turnier-Chat"})
    assert struck.status_code == 200, struck.text
    audit = await flow.db.audit_logs.find_one({"action": "moderation.strike", "target_id": lead["id"]}, {"_id": 0})
    assert audit["actor_id"] == root["id"] and audit["data"]["note"] == "Beleidigung im Turnier-Chat"
    root_block = await flow.post(f"/api/moderation/people/{lead['id']}/sanctions", json={"action": "warning", "reason": "Beleidigung im Turnier-Chat", "chat_hours": 6})
    assert root_block.status_code == 200, root_block.text
    sanction_id = root_block.json()["id"]
    strike_id = struck.json()["strike"]["id"]

    # Die Übersicht sagt vorher, wen nur der Superadmin verwarnt - ohne Rolle und Bereiche.
    overview = await flow.get("/api/moderation/people")
    people = {row["user"]["username"]: row for row in overview.json()}
    assert people["turnierleitung"]["protected"] is True and people["spieler"]["protected"] is False
    assert "role" not in people["turnierleitung"]["user"] and "areas" not in people["turnierleitung"]["user"]
    history = await flow.get(f"/api/moderation/people/{lead['id']}")
    assert history.json()["protected"] is True and "areas" not in history.json()["user"]

    # Zurücknehmen und Aufheben bei Admin-Konten ebenfalls nur der Superadmin.
    flow.act_as(mod)
    revoked = await flow.post(f"/api/moderation/strikes/{strike_id}/revoke", json={})
    assert revoked.status_code == 403, revoked.text
    lifted = await flow.post(f"/api/moderation/sanctions/{sanction_id}/lift", json={})
    assert lifted.status_code == 403, lifted.text
    flow.act_as(root)
    root_lift = await flow.post(f"/api/moderation/sanctions/{sanction_id}/lift", json={"note": "geklärt"})
    assert root_lift.status_code == 200, root_lift.text


# ---------------------------------------------------------------- Freigabe Turnierleitung

@pytest.mark.asyncio
async def test_a_tournament_grant_works_in_every_tournament_like_the_role(flow):
    lead = await flow.add_staff()
    flow.act_as(lead)
    created = await flow.with_participants(4)
    tournament, registrations = created[0], created[2]
    built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert built.status_code == 200, built.text
    await flow.start(tournament)
    tid = tournament["id"]

    grant = await granted(flow, "freigabe-turnier", "tournaments")
    flow.act_as(grant)
    me = await flow.get("/api/auth/me")
    assert "tournaments" in me.json()["areas"]

    match = (await flow.matches(tournament))[0]
    first, second = [slot["registration_id"] for slot in match["slots"]]
    entered = await flow.post(f"/api/matches/{match['id']}/result", json={"results": ranking(first, second)})
    assert entered.status_code == 200, entered.text
    reloaded = await flow.reload(match)
    assert reloaded["status"] == "completed"

    paused = await flow.post(f"/api/tournaments/{tid}/status", json={"status": "paused"})
    assert paused.status_code == 200, paused.text
    reg_id = registrations[-1]["id"]
    checked = await flow.post(f"/api/tournaments/{tid}/registrations/{reg_id}/checkin", json={"status": "checked_in"})
    assert checked.status_code == 200, checked.text
    staff = await flow.get(f"/api/tournaments/{tid}/staff")
    assert staff.status_code == 200, staff.text
    # Von Streitfällen erfährt, wer Ergebnisse eintragen darf - mit Freigabe wie mit Rolle (#1415).
    from services.tournament_permissions import result_staff_user_ids

    told = await result_staff_user_ids(flow.db, match)
    assert grant["id"] in told and lead["id"] in told

    # Fast Lap: Zeiten eintragen wie mit der Rolle.
    challenge_id, track_id = new_id(), new_id()
    await flow.db.f1_challenges.insert_one({"id": challenge_id, "slug": "fl-freigabe", "title": "Fast Lap", "status": "live", "visibility": "public"})
    await flow.db.f1_tracks.insert_one({"id": track_id, "challenge_id": challenge_id, "name": "Teststrecke"})
    driver = await flow.add_user(name="fahrerin")
    lap = await flow.post(f"/api/f1/challenges/{challenge_id}/times", json={"user_id": driver["id"], "track_id": track_id, "time_ms": 81234})
    assert lap.status_code == 200, lap.text

    # Ohne Freigabe (nur Redaktion) bleibt das Turnier zu.
    flow.act_as(await granted(flow, "nur-redaktion", "content"))
    refused = await flow.post(f"/api/tournaments/{tid}/status", json={"status": "live"})
    assert refused.status_code == 403, refused.text


# ---------------------------------------------------------------- Mitglieder-Inhalte

async def member_content(flow) -> None:
    await flow.db.news_posts.insert_one({
        "id": new_id(), "slug": "nur-mitglieder", "title": "Nur für Mitglieder", "content": "Protokoll", "visibility": "members",
        "published": True, "published_at": "2026-01-01T10:00:00+00:00", "created_at": "2026-01-01T10:00:00+00:00",
    })
    await flow.db.documents.insert_one({
        "id": new_id(), "title": "Protokoll Generalversammlung", "visibility": "members", "category": "protokolle",
        "file_url": "/api/static/uploads/protokoll.pdf", "created_at": "2026-01-01T10:00:00+00:00",
    })


async def sees(flow, user: dict) -> tuple[bool, bool]:
    flow.act_as(user)
    news_response = await flow.get("/api/news")
    news = news_response.json()
    titles = [post["title"] for post in (news.get("items") if isinstance(news, dict) else news)]
    docs_response = await flow.get("/api/documents")
    docs = docs_response.json()
    doc_titles = [doc["title"] for doc in (docs.get("items") if isinstance(docs, dict) else docs)]
    return "Nur für Mitglieder" in titles, "Protokoll Generalversammlung" in doc_titles


@pytest.mark.asyncio
async def test_member_content_needs_a_membership_or_the_club_area(flow):
    await member_content(flow)
    lead = await flow.add_user(role="tournament_admin", name="turnierleitung")
    lead_view = await sees(flow, lead)
    assert lead_view == (False, False), "die Rolle Turnierleitung allein reicht nicht"
    detail = await flow.get("/api/news/nur-mitglieder")
    assert detail.status_code == 403

    chair = await flow.add_user(name="vorsitz")
    await flow.db.board_positions.insert_one({"id": new_id(), "slug": "obmann", "title_male": "Obmann", "is_active": True,
                                              "user_id": chair["id"], "deputy_user_id": None})
    chair_view = await sees(flow, chair)
    assert chair_view == (True, True), "ein Vorstandsposten bringt die Vereinsverwaltung"

    member = await flow.add_user(name="mitglied")
    member["is_club_member"] = True
    member_view = await sees(flow, member)
    assert member_view == (True, True)

    member_lead = await flow.add_user(role="tournament_admin", name="mitglied-turnierleitung")
    await flow.db.memberships.insert_one({"user_id": member_lead["id"], "member_status": "active", "source": "website"})
    member_lead_view = await sees(flow, member_lead)
    assert member_lead_view == (True, True), "mit Mitgliedschaft sieht auch die Turnierleitung alles"


@pytest.mark.asyncio
async def test_the_tournament_lead_still_runs_members_only_events(flow):
    """Events gehören zur Turnierleitung: anlegen, einchecken, auswerten - auch mit „Nur Mitglieder“. Alben und News am
    Event bleiben Mitglieder-Inhalte."""
    event_id = new_id()
    await flow.db.events.insert_one({"id": event_id, "slug": "vereinsabend", "name": "Vereinsabend", "status": "scheduled",
                                     "visibility": "members", "start_date": "2026-11-20T18:00:00+00:00"})
    lead = await granted(flow, "freigabe-events", "tournaments")
    flow.act_as(lead)
    listed_response = await flow.get("/api/events", params={"include_drafts": "true"})
    listed = listed_response.json()
    names = [row["name"] for row in (listed.get("items") if isinstance(listed, dict) else listed)]
    assert "Vereinsabend" in names
    lead_detail = await flow.get("/api/events/vereinsabend")
    assert lead_detail.status_code == 200

    flow.act_as(await flow.add_user(name="community"))
    community_detail = await flow.get("/api/events/vereinsabend")
    assert community_detail.status_code == 403
