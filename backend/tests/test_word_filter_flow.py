"""Wortfilter (#417): Liste der Moderation, Prüfung beim Senden in allen vier Chats und bei Namen/Bio;
„zurückhalten“ = nur der Absender sieht die Nachricht, bis die Moderation freigibt oder zurückweist
(zurückgewiesen = Treffer); „markieren“ = geht durch, steht in der Liste; Leetspeak und
Trennzeichen werden erkannt, kurze Wörter nur als ganzes Wort; Export/Import; aus = nichts."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import word_filter  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def test_normalisation_catches_leetspeak_gaps_and_umlauts_but_short_words_only_whole():
    entries = [{"term": "Scheiße", "action": "hold"}, {"term": "ass", "action": "flag"}, {"term": "du Idiot", "action": "hold"}]
    assert [e["term"] for e in word_filter.find_matches(entries, "So eine SCH31SSE hier")] == ["Scheiße"]
    assert [e["term"] for e in word_filter.find_matches(entries, "s.c.h.e.i.s.s.e")] == ["Scheiße"]
    assert [e["term"] for e in word_filter.find_matches(entries, "scheisse!!!")] == ["Scheiße"]
    assert word_filter.find_matches(entries, "Mein Passwort ist neu") == [], "kurze Begriffe nur als ganzes Wort"
    assert [e["term"] for e in word_filter.find_matches(entries, "you ASS")] == ["ass"]
    assert [e["term"] for e in word_filter.find_matches(entries, "Ach du Idiot, echt")] == ["du Idiot"]
    assert word_filter.find_matches(entries, "du bist kein idiot-jäger") == [], "Mehrwort-Begriff nur am Stück"
    assert word_filter.verdict_for(word_filter.find_matches(entries, "you ass")) == "flag"
    assert word_filter.verdict_for(word_filter.find_matches(entries, "sch3isse ass")) == "hold"
    assert word_filter.verdict_for([]) is None


async def moderator(flow):
    return await flow.add_user(role="moderator")


async def friends(flow, a, b):
    await flow.db.friendships.insert_one({"id": "f1", "user_ids": [a["id"], b["id"]], "status": "accepted"})


@pytest.mark.asyncio
async def test_list_is_moderation_only_and_held_direct_messages_wait_for_a_decision(flow):
    mod = await moderator(flow)
    paula = await flow.add_user(role="player", name="paula")
    otto = await flow.add_user(role="player", name="otto")
    for user in (paula, otto):
        await flow.db.users.update_one({"id": user["id"]}, {"$set": {"dm_privacy": "everyone"}})

    flow.act_as(paula)
    assert (await flow.get("/api/moderation/word-filter")).status_code == 403
    flow.act_as(mod)
    assert (await flow.get("/api/moderation/word-filter")).json()["enabled"] is False
    added = await flow.post("/api/moderation/word-filter/entries", json={"term": "Scheiße", "action": "hold", "note": "grob"})
    assert added.status_code == 200 and added.json()["entries"][0]["term"] == "Scheiße"
    assert (await flow.post("/api/moderation/word-filter/entries", json={"term": "scheisse", "action": "flag"})).status_code == 409, "dieselbe Normalform"
    assert (await flow.post("/api/moderation/word-filter/entries", json={"term": "noob", "action": "flag"})).status_code == 200
    assert (await flow.post("/api/moderation/word-filter/entries", json={"term": "x", "action": "flag"})).status_code == 400

    # Aus: nichts passiert.
    flow.act_as(paula)
    sent = await flow.post(f"/api/messages/direct/{otto['id']}", json={"message": "sch31sse, noob"})
    assert sent.status_code == 200 and "moderation" not in sent.json()

    flow.act_as(mod)
    assert (await flow.put("/api/moderation/word-filter", json={"enabled": True})).json()["enabled"] is True

    # An: zurückgehalten - nur Paula sieht die Nachricht, Otto weder im Gespräch noch in der Liste, keine Benachrichtigung.
    flow.act_as(paula)
    held = await flow.post(f"/api/messages/direct/{otto['id']}", json={"message": "So eine sch31sse!"})
    assert held.status_code == 200, held.text
    assert held.json()["moderation"] == {"state": "held"} and "matched" not in held.json()["moderation"]
    held_id = held.json()["id"]
    mine = (await flow.get(f"/api/messages/direct/{otto['id']}")).json()["messages"]
    assert [m["id"] for m in mine][-1] == held_id and mine[-1]["moderation"]["state"] == "held"
    flow.act_as(otto)
    theirs = (await flow.get(f"/api/messages/direct/{paula['id']}")).json()["messages"]
    assert held_id not in [m["id"] for m in theirs]
    conversations = (await flow.get("/api/messages/conversations")).json()
    assert all(c["latest_message"]["id"] != held_id for c in conversations)
    assert await flow.db.notifications.count_documents({"user_id": otto["id"], "meta.message_id": held_id}) == 0

    # Markiert: kommt an, steht aber in der Liste.
    flow.act_as(paula)
    flagged = await flow.post(f"/api/messages/direct/{otto['id']}", json={"message": "gg noob"})
    assert flagged.json()["moderation"] == {"state": "flagged"}
    flow.act_as(otto)
    assert flagged.json()["id"] in [m["id"] for m in (await flow.get(f"/api/messages/direct/{paula['id']}")).json()["messages"]]

    # Moderation: Warteschlange mit beiden Funden; Freigabe stellt zu, Zurückweisen zählt als Treffer.
    flow.act_as(mod)
    items = (await flow.get("/api/moderation/items")).json()
    assert {(i["kind"], i["state"]) for i in items} == {("direct", "pending"), ("direct", "flagged")}
    pending = next(i for i in items if i["state"] == "pending")
    assert pending["matched"] == ["Scheiße"] and pending["excerpt"] == "So eine sch31sse!" and pending["user"]["username"] == paula["username"]
    released = await flow.patch(f"/api/moderation/items/{pending['id']}", json={"decision": "release"})
    assert released.status_code == 200 and released.json()["state"] == "released"
    flow.act_as(otto)
    assert held_id in [m["id"] for m in (await flow.get(f"/api/messages/direct/{paula['id']}")).json()["messages"]]
    assert await flow.db.notifications.count_documents({"user_id": otto["id"], "meta.message_id": held_id}) == 1

    flow.act_as(paula)
    second = (await flow.post(f"/api/messages/direct/{otto['id']}", json={"message": "scheisse nochmal"})).json()
    flow.act_as(mod)
    item = next(i for i in (await flow.get("/api/moderation/items?state=pending")).json() if i["ref_id"] == second["id"])
    rejected = await flow.patch(f"/api/moderation/items/{item['id']}", json={"decision": "reject", "note": "Beleidigung"})
    assert rejected.json()["state"] == "rejected"
    assert (await flow.patch(f"/api/moderation/items/{item['id']}", json={"decision": "release"})).status_code == 409
    strike = await flow.db.moderation_strikes.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert strike["source"] == "word_filter" and strike["ref_id"] == second["id"] and strike["note"] == "Beleidigung"
    assert await flow.db.notifications.count_documents({"user_id": paula["id"], "kind": "moderation"}) == 1
    flow.act_as(otto)
    assert second["id"] not in [m["id"] for m in (await flow.get(f"/api/messages/direct/{paula['id']}")).json()["messages"]]
    flow.act_as(paula)
    own = next(m for m in (await flow.get(f"/api/messages/direct/{otto['id']}")).json()["messages"] if m["id"] == second["id"])
    assert own["moderation"] == {"state": "rejected"}
    assert await flow.db.audit_logs.count_documents({"action": {"$regex": "^word_filter|^moderation_item"}}) >= 5


@pytest.mark.asyncio
async def test_team_chat_names_and_bio_are_checked_and_the_list_can_be_exported(flow):
    mod = await moderator(flow)
    flow.act_as(mod)
    await flow.put("/api/moderation/word-filter", json={"enabled": True})
    await flow.post("/api/moderation/word-filter/entries", json={"term": "Scheiße", "action": "hold"})
    await flow.post("/api/moderation/word-filter/entries", json={"term": "noob", "action": "flag"})

    paula = await flow.add_user(role="player", name="paula")
    otto = await flow.add_user(role="player", name="otto")
    flow.act_as(paula)
    # Teamname: zurückhalten heißt abweisen, markieren heißt notieren.
    assert (await flow.post("/api/teams", json={"name": "Scheisse Squad", "tag": "SSQ"})).status_code == 400
    created = await flow.post("/api/teams", json={"name": "Noob Slayers", "tag": "NBS"})
    assert created.status_code == 200, created.text
    team_id = created.json()["id"]
    await flow.db.teams.update_one({"id": team_id}, {"$addToSet": {"member_ids": otto["id"]}})

    # Team-Chat: zurückgehalten sieht nur Paula; Otto nicht.
    held = await flow.post(f"/api/teams/{team_id}/chat", json={"message": "was für eine s.c.h.e.i.s.s.e"})
    assert held.status_code == 200 and held.json()["moderation"] == {"state": "held"}
    assert held.json()["id"] in [m["id"] for m in (await flow.get(f"/api/teams/{team_id}/chat")).json()]
    flow.act_as(otto)
    assert held.json()["id"] not in [m["id"] for m in (await flow.get(f"/api/teams/{team_id}/chat")).json()]

    # Profil: Bio mit gesperrtem Wort wird abgewiesen, Anzeigename mit markiertem Wort geht durch.
    flow.act_as(paula)
    assert (await flow.put("/api/users/me", json={"bio": "Ich bin die Scheiße"})).status_code == 400
    assert (await flow.db.users.find_one({"id": paula["id"]})).get("bio") in (None, "")
    assert (await flow.put("/api/users/me", json={"display_name": "Noob King"})).status_code == 200

    # Benutzername bei der Registrierung.
    await flow.db.settings.update_one({"id": "auth"}, {"$set": {"id": "auth", "registration_enabled": True}}, upsert=True)
    flow.act_as(None)
    blocked = await flow.post("/api/auth/register", json={"username": "sch31sse", "email": "neu@lionsquad-test.at", "password": "Passwort-123!", "accept_privacy": True, "accept_terms": True})
    assert blocked.status_code == 400 and "nicht erlaubt" in blocked.json()["detail"], blocked.text
    assert await flow.db.users.count_documents({"username": "sch31sse"}) == 0

    flow.act_as(mod)
    items = (await flow.get("/api/moderation/items?state=flagged")).json()
    assert {i["kind"] for i in items} >= {"team_name", "display_name"}
    noted = await flow.patch(f"/api/moderation/items/{items[0]['id']}", json={"decision": "noted"})
    assert noted.json()["state"] == "noted"
    rejected_names = (await flow.get("/api/moderation/items?state=rejected")).json()
    assert {i["kind"] for i in rejected_names} >= {"team_name", "bio", "username"}

    # Export und Import (Ersetzen) für Backup und zweiten Verein.
    exported = (await flow.get("/api/moderation/word-filter/export")).json()
    assert exported == {"version": 1, "entries": [{"term": "Scheiße", "action": "hold", "note": None}, {"term": "noob", "action": "flag", "note": None}]}
    imported = await flow.post("/api/moderation/word-filter/import", json={"entries": [{"term": "noob", "action": "hold"}, {"term": "loser", "action": "flag", "note": "en"}], "replace": True})
    assert imported.status_code == 200 and [(e["term"], e["action"]) for e in imported.json()["entries"]] == [("noob", "hold"), ("loser", "flag")]
    assert (await flow.post("/api/moderation/word-filter/import", json={"entries": [{"term": "", "action": "hold"}]})).status_code == 400
    entry_id = imported.json()["entries"][1]["id"]
    assert (await flow.patch(f"/api/moderation/word-filter/entries/{entry_id}", json={"action": "hold"})).json()["entries"][1]["action"] == "hold"
    assert len((await flow.client.delete(f"/api/moderation/word-filter/entries/{entry_id}")).json()["entries"]) == 1
