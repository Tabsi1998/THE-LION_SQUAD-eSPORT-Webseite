"""Verwarnungen mit Stufen (#416): Treffer aus Wortfilter, berechtigten Meldungen oder von Hand;
Stufen Hinweis → Verwarnung mit Chat-Sperre → Sperre bis zur Entscheidung; die Person sieht ihren
Stand und legt Einspruch ein; die Moderation sieht die Historie, hebt auf, exportiert."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def person(flow, name, role="player", **fields):
    user = await flow.add_user(role=role, name=name)
    fields = {"email": f"{name}@lionsquad-test.at", **fields}
    await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
    user.update(fields)
    return user


@pytest.mark.asyncio
async def test_levels_notice_warning_suspension_with_chat_block_appeal_and_export(flow):
    mod = await person(flow, "mod", role="moderator")
    paula = await person(flow, "paula")
    otto = await person(flow, "otto")
    direct = f"/api/messages/direct/{otto['id']}"

    # 1. Treffer: Hinweis - Benachrichtigung und Mail, keine Einschränkung.
    flow.act_as(mod)
    first = await flow.post(f"/api/moderation/people/{paula['id']}/strikes", json={"note": "Beleidigung im Team-Chat"})
    assert first.status_code == 200, first.text
    assert first.json()["sanction"]["action"] == "notice" and "1. Treffer" in first.json()["sanction"]["reason"]
    assert await flow.db.notifications.count_documents({"user_id": paula["id"], "kind": "moderation"}) == 1
    assert await flow.db.mail_jobs.count_documents({"to": paula["email"], "template_key": "moderation_notice"}) == 1
    flow.act_as(paula)
    assert (await flow.post(direct, json={"message": "hallo otto"})).status_code == 200

    # 2. Treffer: Verwarnung mit Chat-Sperre (24 h) - alle Chats zu, der Stand erklärt es.
    flow.act_as(mod)
    second = await flow.post(f"/api/moderation/people/{paula['id']}/strikes", json={"note": "schon wieder"})
    warning = second.json()["sanction"]
    assert warning["action"] == "warning" and warning["chat_blocked_until"]
    flow.act_as(paula)
    blocked = await flow.post(direct, json={"message": "geht das?"})
    assert blocked.status_code == 403 and "gesperrt" in blocked.json()["detail"]
    standing = (await flow.get("/api/moderation/me/standing")).json()
    assert standing["strike_count"] == 2 and standing["active"]["action"] == "warning" and standing["chat_block"]["until"]
    assert standing["next_level"]["action"] == "suspension" and standing["can_appeal"] is True
    assert "moderator_id" not in standing["strikes"][0]

    # Einspruch: einmal, danach liegt er bei der Moderation.
    appeal = await flow.post("/api/moderation/me/appeal", json={"sanction_id": warning["id"], "message": "Das war ein Missverständnis, bitte prüft die Nachricht."})
    assert appeal.status_code == 200 and appeal.json()["standing"]["can_appeal"] is False
    assert (await flow.post("/api/moderation/me/appeal", json={"sanction_id": warning["id"], "message": "Noch einmal, bitte wirklich prüfen."})).status_code == 409
    assert await flow.db.notifications.count_documents({"user_id": mod["id"], "kind": "moderation"}) == 1

    # Moderation: Übersicht, Historie, Einspruch annehmen - der Chat geht wieder.
    flow.act_as(mod)
    people = (await flow.get("/api/moderation/people")).json()
    row = next(r for r in people if r["user_id"] == paula["id"])
    assert row["active_strikes"] == 2 and row["open_appeal"] is True and row["active"]["action"] == "warning" and row["user"]["username"] == paula["username"]
    history = (await flow.get(f"/api/moderation/people/{paula['id']}")).json()
    assert len(history["strikes"]) == 2 and history["active"]["appeal"]["status"] == "open" and history["strikes"][0]["moderator_id"] == mod["id"]
    decided = await flow.post(f"/api/moderation/sanctions/{warning['id']}/appeal-decision", json={"decision": "lift", "note": "Passt, war ein Missverständnis."})
    assert decided.status_code == 200 and decided.json()["status"] == "lifted" and decided.json()["appeal"]["decision"] == "lift"
    flow.act_as(paula)
    assert (await flow.post(direct, json={"message": "danke"})).status_code == 200
    assert (await flow.get("/api/moderation/me/standing")).json()["active"] is None

    # 3. Treffer: Sperre bis zur Entscheidung - nur ein Mensch hebt sie auf.
    flow.act_as(mod)
    third = await flow.post(f"/api/moderation/people/{paula['id']}/strikes", json={"note": "dritter Vorfall"})
    suspension = third.json()["sanction"]
    assert suspension["action"] == "suspension" and suspension["open_until_decision"] is True and suspension["chat_blocked_until"] is None
    flow.act_as(paula)
    stopped = await flow.post(direct, json={"message": "hallo?"})
    assert stopped.status_code == 403 and "bis die Moderation entschieden" in stopped.json()["detail"]
    flow.act_as(mod)
    lifted = await flow.post(f"/api/moderation/sanctions/{suspension['id']}/lift", json={"note": "Aussprache im Discord"})
    assert lifted.json()["status"] == "lifted" and lifted.json()["lift_note"] == "Aussprache im Discord"
    assert (await flow.post(f"/api/moderation/sanctions/{suspension['id']}/lift", json={})).status_code == 409
    flow.act_as(paula)
    assert (await flow.post(direct, json={"message": "geht wieder"})).status_code == 200

    # Export für den Vorstand und Audit.
    flow.act_as(mod)
    export = await flow.get("/api/moderation/people/export.csv")
    assert export.status_code == 200 and "Benutzername" in export.text and paula["username"] in export.text
    assert await flow.db.audit_logs.count_documents({"action": "moderation.sanction", "target_id": paula["id"]}) == 3
    assert await flow.db.audit_logs.count_documents({"action": "moderation.sanction_lifted"}) == 2

    # Ein Spieler sieht nichts davon.
    flow.act_as(otto)
    assert (await flow.get("/api/moderation/people")).status_code == 403
    assert (await flow.get(f"/api/moderation/people/{paula['id']}")).status_code == 403


@pytest.mark.asyncio
async def test_justified_report_counts_once_and_levels_are_configurable(flow):
    mod = await person(flow, "mod", role="moderator")
    paula = await person(flow, "paula")
    otto = await person(flow, "otto")

    # Stufen umstellen: schon der erste Treffer sperrt den Chat für zwei Stunden; Treffer verfallen nach 6 Monaten.
    flow.act_as(mod)
    bad = await flow.put("/api/moderation/levels", json={"levels": [{"strikes": 2, "action": "notice"}, {"strikes": 1, "action": "warning"}]})
    assert bad.status_code == 400
    saved = await flow.put("/api/moderation/levels", json={"levels": [{"strikes": 1, "action": "warning", "chat_hours": 2}, {"strikes": 3, "action": "suspension"}], "strike_ttl_months": 6})
    assert saved.status_code == 200, saved.text
    assert saved.json()["levels"][0] == {"strikes": 1, "action": "warning", "chat_hours": 2} and saved.json()["strike_ttl_months"] == 6
    assert (await flow.get("/api/moderation/levels")).json() == saved.json()

    # Otto meldet Paula; „berechtigt“ zählt als Treffer - genau einmal.
    flow.act_as(otto)
    report = (await flow.post("/api/moderation/reports", json={"target_user_id": paula["id"], "category": "harassment", "details": "Sie beleidigt mich im Chat."})).json()["report"]
    flow.act_as(mod)
    justified = await flow.patch(f"/api/moderation/reports/{report['id']}", json={"status": "justified", "resolution_note": "Beleidigung bestätigt"})
    assert justified.status_code == 200 and justified.json()["sanction"]["action"] == "warning"
    assert (await flow.patch(f"/api/moderation/reports/{report['id']}", json={"status": "justified"})).json().get("strike") is None
    strikes = await flow.db.moderation_strikes.find({"user_id": paula["id"]}, {"_id": 0}).to_list(10)
    assert len(strikes) == 1 and strikes[0]["source"] == "report" and strikes[0]["report_id"] == report["id"] and strikes[0]["note"] == "Beleidigung bestätigt"
    sanction = await flow.db.moderation_sanctions.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert sanction["strike_ids"] == [strikes[0]["id"]]

    # Chat zu - Team-Chat und Match-Chat fragen dieselbe Sperre (hier: Direktnachricht als Beleg).
    flow.act_as(paula)
    assert (await flow.post(f"/api/messages/direct/{otto['id']}", json={"message": "hey"})).status_code == 403

    # Treffer zurücknehmen: der Stand zählt ihn nicht mehr; die Sanktion hebt die Moderation getrennt auf.
    flow.act_as(mod)
    revoked = await flow.post(f"/api/moderation/strikes/{strikes[0]['id']}/revoke", json={"note": "Meldung war überzogen"})
    assert revoked.status_code == 200 and revoked.json()["revoked"] is True
    assert (await flow.post(f"/api/moderation/strikes/{strikes[0]['id']}/revoke", json={})).status_code == 409
    history = (await flow.get(f"/api/moderation/people/{paula['id']}")).json()
    assert history["active_strike_count"] == 0 and history["active"]["action"] == "warning"
    await flow.post(f"/api/moderation/sanctions/{sanction['id']}/lift", json={"note": "zurückgenommen"})
    flow.act_as(paula)
    standing = (await flow.get("/api/moderation/me/standing")).json()
    assert standing["strike_count"] == 0 and standing["active"] is None and standing["history"][0]["status"] == "lifted"
