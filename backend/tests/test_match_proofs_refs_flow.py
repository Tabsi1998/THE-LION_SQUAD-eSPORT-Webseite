"""Nachweis-Baustein (#2360): mehrere Bilder und Video-Links je Bezug, Sichtbarkeit je Rolle. Erfundene Namen.

Geprüft wird mit echten Routen in einer Liga-Staffel (Löwen gegen Falken): wer hinzufügen und entfernen darf und bis wann,
dass die Gegenseite alles sieht außer MOSS, dass eine befangene Leitung MOSS nicht sieht, dass nur ``https``-Links
durchgehen. Die Aufbewahrung prüft test_match_proofs_retention_flow. Die Felder der Vorfälle und Verfahren stehen im Vertrag
(docs/LIGA.md, „D.5/E.2-Vertrag“) und werden hier direkt ans Spiel geschrieben - D.5 und E.2 bauen die Abläufe dazu.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import world as league_world  # noqa: E402
from match_proof_world import VIDEO, add_image, add_link, ids_seen, listed, picture, protest, set_match, user  # noqa: E402
from models import now_utc  # noqa: E402
from services import match_proofs  # noqa: E402
from services.league_result_rules import attached_proofs  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setattr(match_proofs, "PROOF_DIR", tmp_path / "proofs")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_several_images_and_links_per_report_and_who_sees_them(flow):
    w = await league_world(flow)
    match = w["match"]
    flow.act_as(user(w, "Kapitaen"))
    first, second = await add_image(flow, match), await add_image(flow, match)
    video = await add_link(flow, match)
    assert [first.status_code, second.status_code, video.status_code] == [200, 200, 200], video.text
    link = video.json()
    assert link["type"] == "link" and link["link"] == VIDEO and "url" not in link, "ein Link wird nie als Bild ausgeliefert"
    image = first.json()
    assert image["type"] == "image" and image["url"] == f"/api/matches/{match['id']}/proof-photos/{image['id']}"
    assert image["kind"] == "report" and image["own"] is True and image["can_remove"] is True

    own = (await listed(flow, match)).json()
    assert [item["type"] for item in own["items"]] == ["image", "image", "link"]
    assert own["open"] is True and own["can_add"] is True and own["limit"] == match_proofs.MAX_PER_REF

    # Die Gegenseite sieht alles, darf aber nichts davon entfernen; die Leitung ebenso.
    for viewer in (user(w, "Falke1"), user(w, "Falke2"), w["staff"]):
        flow.act_as(viewer)
        seen = (await listed(flow, match)).json()
        assert len(seen["items"]) == 3, viewer["display_name"]
        assert not any(item["own"] or item["can_remove"] for item in seen["items"])
        assert (await flow.get(image["url"])).status_code == 200
    assert seen["items"][0]["own_side"] is False

    # Unbeteiligte bekommen 404 - auch für die Liste, sonst ließe sich prüfen, ob es Nachweise gibt.
    flow.act_as(user(w, "Fremd"))
    assert (await listed(flow, match)).status_code == 404
    assert (await flow.get(image["url"])).status_code == 404
    assert (await add_link(flow, match)).status_code == 403

    # Ein Link ist kein Foto: Die alten Karten (Meldung, Problem) und der Nachweis je Map sehen ihn nicht.
    assert await match_proofs.visible_proofs(flow.db, [link["id"], image["id"]]) == {
        image["id"]: {key: image[key] for key in ("id", "url", "width", "height", "scan_state")}}
    assert await attached_proofs(flow.db, match["id"]) == {image["id"], second.json()["id"]}


@pytest.mark.asyncio
@pytest.mark.parametrize("link", [
    "http://video.example/clip",              # nur https
    "javascript:alert(1)",
    "ftp://video.example/clip",
    "https://name:geheim@video.example/clip",  # keine Zugangsdaten in der Adresse
    "https://video.example/a b",
    "https://video.example/<script>",
    "https://localhost/clip",                 # keine Domain
    "https:///clip",
    "https://video.example/" + "a" * 500,     # Längengrenze
    "   ",
])
async def test_only_plain_https_links_pass(flow, link):
    w = await league_world(flow)
    flow.act_as(user(w, "Kapitaen"))
    refused = await add_link(flow, w["match"], link=link)
    assert refused.status_code == 422, refused.text
    assert await flow.db.match_proof_photos.count_documents({}) == 0


@pytest.mark.asyncio
async def test_link_is_stored_as_given_and_needs_exactly_one_of_image_or_link(flow):
    w = await league_world(flow)
    match = w["match"]
    flow.act_as(user(w, "Kapitaen"))
    stored = await add_link(flow, match, link="  HTTPS://Clips.example/Video?t=1m30s  ")
    assert stored.status_code == 200, stored.text
    assert stored.json()["link"] == "https://Clips.example/Video?t=1m30s"
    neither = await flow.post(f"/api/matches/{match['id']}/proofs", data={"kind": "report"})
    both = await flow.post(f"/api/matches/{match['id']}/proofs", data={"kind": "report", "link": VIDEO},
                           files={"file": ("beleg.jpg", picture(), "image/jpeg")})
    unknown = await flow.post(f"/api/matches/{match['id']}/proofs", data={"kind": "galerie", "link": VIDEO})
    assert [neither.status_code, both.status_code, unknown.status_code] == [422, 422, 422]
    # Das Protokoll nennt den Nachweis, nie die Adresse.
    audit = await flow.db.audit_logs.find({"action": "match.proof.add"}, {"_id": 0}).to_list(10)
    assert len(audit) == 1 and audit[0]["data"]["type"] == "link" and "example" not in str(audit[0])


@pytest.mark.asyncio
async def test_moss_goes_only_to_uploader_captain_and_an_unbiased_lead(flow):
    w = await league_world(flow)
    match = w["match"]
    await set_match(flow, w, disputes=[protest(w)])
    # Die MOSS-Datei lädt der Spieler selbst hoch - Mila ist weder Captain noch Vertreterin.
    flow.act_as(user(w, "Mila"))
    uploaded = await add_image(flow, match, "moss", "verfahren-1")
    assert uploaded.status_code == 200, uploaded.text
    moss = uploaded.json()
    assert (await add_link(flow, match)).status_code == 403, "zur Meldung fügen nur Captain und Vertreter hinzu"

    # Wer hochgeladen hat und der Captain der eigenen Seite sehen ihn (Entscheidung Fabian 11.11.) …
    for allowed in (user(w, "Mila"), user(w, "Kapitaen")):
        flow.act_as(allowed)
        assert await ids_seen(flow, match, "moss", "verfahren-1") == {moss["id"]}
        assert (await flow.get(moss["url"])).status_code == 200
    # … die übrigen Spieler der eigenen Seite nicht, auch nicht die Leitung des Hauptteams: Die Datei zeigt Milas PC.
    for teammate in (user(w, "Tom"), user(w, "LoeLeitung")):
        flow.act_as(teammate)
        assert await ids_seen(flow, match, "moss", "verfahren-1") == set(), teammate["display_name"]
        assert (await flow.get(moss["url"])).status_code == 404, teammate["display_name"]

    # Die Gegenseite sieht ihn nie - weder in der Liste noch als Bild. Zum Vergleich: einen Nachweis zum Protest sieht sie.
    flow.act_as(user(w, "Falke1"))
    other = (await add_link(flow, match, "protest", "verfahren-1")).json()
    for opponent in (user(w, "Falke1"), user(w, "Falke3"), user(w, "FalLeitung")):
        flow.act_as(opponent)
        assert await ids_seen(flow, match, "moss", "verfahren-1") == set(), opponent["display_name"]
        assert (await flow.get(moss["url"])).status_code == 404
    flow.act_as(user(w, "Kapitaen"))
    assert await ids_seen(flow, match, "protest", "verfahren-1") == {other["id"]}

    # Leitung: wer nicht beteiligt ist, sieht MOSS. Wer zur Gegenseite gehört, sieht ihn trotz Liga-Recht nicht.
    flow.act_as(w["staff"])
    assert await ids_seen(flow, match, "moss", "verfahren-1") == {moss["id"]}
    assert (await flow.get(moss["url"])).status_code == 200
    biased = user(w, "FalLeitung")
    biased["areas"] = ["leagues"]
    await flow.db.users.update_one({"id": biased["id"]}, {"$set": {"areas": ["leagues"]}})
    flow.act_as(biased)
    assert await ids_seen(flow, match, "protest", "verfahren-1") == {other["id"]}
    assert await ids_seen(flow, match, "moss", "verfahren-1") == set()
    assert (await flow.get(moss["url"])).status_code == 404
    flow.act_as(None)
    assert (await flow.get(moss["url"])).status_code == 404


@pytest.mark.asyncio
async def test_moss_may_hang_on_an_incident_with_the_same_visibility(flow):
    """Der Screenshot vom MOSS-Absturz gehört zum Vorfall (§ 9a.6) - gleiche Sichtregeln wie am Verfahren (Review #2360, M4)."""
    w = await league_world(flow)
    match = w["match"]
    crash = {"id": "vorfall-1", "position": 1, "kind": "moss_crash", "state": "proposed",
             "reported_by": {"registration_id": w["reg_a"]["id"], "user_id": user(w, "Kapitaen")["id"]}}
    await set_match(flow, w, incidents=[crash])
    flow.act_as(user(w, "Mila"))
    uploaded = await add_image(flow, match, "moss", "vorfall-1")
    assert uploaded.status_code == 200, uploaded.text
    moss = uploaded.json()
    assert (await add_image(flow, match, "moss", "gibt-es-nicht")).status_code == 404
    for allowed in (user(w, "Mila"), user(w, "Kapitaen"), w["staff"]):
        flow.act_as(allowed)
        assert await ids_seen(flow, match, "moss", "vorfall-1") == {moss["id"]}, allowed["display_name"]
    for hidden in (user(w, "Tom"), user(w, "Falke1")):
        flow.act_as(hidden)
        assert await ids_seen(flow, match, "moss", "vorfall-1") == set(), hidden["display_name"]
        assert (await flow.get(moss["url"])).status_code == 404
    # Der Nachweis zum Vorfall selbst (kein MOSS) bleibt für beide Seiten sichtbar.
    flow.act_as(user(w, "Kapitaen"))
    clip = (await add_link(flow, match, "incident", "vorfall-1")).json()
    flow.act_as(user(w, "Falke1"))
    assert await ids_seen(flow, match, "incident", "vorfall-1") == {clip["id"]}

    # Vorfall erledigt: nichts kommt mehr dazu - außer ein Verfahren folgt aus ihm, dann ist MOSS dort wieder offen.
    await set_match(flow, w, incidents=[{**crash, "state": "decided", "closed_at": now_utc().isoformat()}])
    flow.act_as(user(w, "Mila"))
    assert (await add_image(flow, match, "moss", "vorfall-1")).status_code == 409
    await set_match(flow, w, disputes=[protest(w, incident_id="vorfall-1")])
    assert (await add_image(flow, match, "moss", "vorfall-1")).status_code == 200


@pytest.mark.asyncio
async def test_who_may_add_to_which_reference_and_until_when(flow):
    w = await league_world(flow)
    match = w["match"]
    soon, past = (now_utc() + timedelta(hours=5)).isoformat(), (now_utc() - timedelta(minutes=1)).isoformat()
    await set_match(flow, w, disputes=[protest(w, evidence_until=soon, statement={"due_at": soon})],
                    incidents=[{"id": "vorfall-1", "position": 1, "kind": "disconnect", "state": "proposed",
                                "reported_by": {"registration_id": w["reg_a"]["id"], "user_id": user(w, "Kapitaen")["id"]}}])

    flow.act_as(user(w, "Kapitaen"))
    assert (await add_link(flow, match, "protest", "gibt-es-nicht")).status_code == 404
    assert (await add_link(flow, match, "incident", "")).status_code == 404
    assert (await add_link(flow, match, "protest", "verfahren-1")).status_code == 403, "den Protest belegt, wer ihn eingelegt hat"
    assert (await add_link(flow, match, "statement", "verfahren-1")).status_code == 200
    assert (await add_link(flow, match, "incident", "vorfall-1")).status_code == 200

    flow.act_as(user(w, "Falke1"))
    assert (await add_link(flow, match, "statement", "verfahren-1")).status_code == 403, "Stellung nimmt die Gegenseite"
    assert (await add_link(flow, match, "protest", "verfahren-1")).status_code == 200
    assert (await add_link(flow, match, "incident", "vorfall-1")).status_code == 200
    assert (await listed(flow, match, "incident", "vorfall-1")).json()["can_add"] is True

    # Höchstens zehn je Seite und Bezug.
    for _ in range(match_proofs.MAX_PER_REF - 1):
        added = await add_link(flow, match, "protest", "verfahren-1")
        assert added.status_code == 200, added.text
    full = await add_link(flow, match, "protest", "verfahren-1")
    assert full.status_code == 409 and "10" in full.json()["detail"]

    # Fristen: Nach ``evidence_until`` reicht die Seite nichts mehr nach, nach ``statement.due_at`` nimmt niemand mehr Stellung.
    await set_match(flow, w, disputes=[protest(w, evidence_until=past, statement={"due_at": past})])
    late = await add_link(flow, match, "protest", "verfahren-1")
    assert late.status_code == 409 and "Frist" in late.json()["detail"]
    assert (await listed(flow, match, "protest", "verfahren-1")).json()["can_add"] is False
    flow.act_as(user(w, "Kapitaen"))
    assert (await add_link(flow, match, "statement", "verfahren-1")).status_code == 409
    # Die Leitung kann zu einem offenen Verfahren weiter hinzufügen (etwa was sie auf anderem Weg bekam).
    flow.act_as(w["staff"])
    assert (await add_link(flow, match, "protest", "verfahren-1")).status_code == 200

    # Abgeschlossen: Vorfall geeinigt, Verfahren entschieden - nichts kommt mehr dazu.
    await set_match(flow, w, disputes=[protest(w, resolved_at=now_utc().isoformat())],
                    incidents=[{"id": "vorfall-1", "state": "agreed", "reported_by": {"registration_id": w["reg_a"]["id"]}}])
    for kind, ref_id in (("protest", "verfahren-1"), ("moss", "verfahren-1"), ("incident", "vorfall-1")):
        closed = await add_link(flow, match, kind, ref_id)
        assert closed.status_code == 409, kind
    assert (await listed(flow, match, "incident", "vorfall-1")).json()["open"] is False


@pytest.mark.asyncio
async def test_a_biased_lead_acts_like_a_member_of_their_side(flow):
    """Wer zu einer Seite gehört, ist mit Liga-Recht nicht „Leitung“: Seitenregeln und Fristen gelten weiter (Review #2360, M1)."""
    w = await league_world(flow)
    match = w["match"]
    past = (now_utc() - timedelta(minutes=1)).isoformat()
    # Verfahren der Falken; Nachreichfrist und Frist der Stellungnahme sind vorbei.
    await set_match(flow, w, disputes=[protest(w, evidence_until=past, statement={"due_at": past})])
    for name in ("Mila", "Kapitaen"):
        user(w, name)["areas"] = ["leagues"]
        await flow.db.users.update_one({"id": user(w, name)["id"]}, {"$set": {"areas": ["leagues"]}})

    # Mila ist Löwin ohne Amt: weder zum Protest der Falken noch zur Stellungnahme - auch nicht als „Leitung“.
    flow.act_as(user(w, "Mila"))
    as_protest = await add_link(flow, match, "protest", "verfahren-1")
    as_statement = await add_link(flow, match, "statement", "verfahren-1")
    assert [as_protest.status_code, as_statement.status_code] == [403, 403]
    state = (await listed(flow, match, "protest", "verfahren-1")).json()
    assert state["can_add"] is False and state["items"] == [], "lesen darf sie als Mitglied ihrer Seite"
    # Der Captain der Löwen: die Seitenregel (kein Nachweis zum fremden Protest) und die abgelaufene Frist gelten für ihn.
    flow.act_as(user(w, "Kapitaen"))
    foreign = await add_link(flow, match, "protest", "verfahren-1")
    late = await add_link(flow, match, "statement", "verfahren-1")
    assert foreign.status_code == 403 and late.status_code == 409 and "Frist" in late.json()["detail"]
    assert await flow.db.match_proof_photos.count_documents({}) == 0
    # Gegenprobe: Die Leitung, die an dem Spiel nicht beteiligt ist, darf beides.
    flow.act_as(w["staff"])
    neutral = await add_link(flow, match, "protest", "verfahren-1")
    assert neutral.status_code == 200 and neutral.json()["side"] is None


@pytest.mark.asyncio
async def test_remove_only_your_own_and_only_while_the_reference_is_open(flow):
    w = await league_world(flow)
    match = w["match"]
    flow.act_as(user(w, "Kapitaen"))
    image, link = (await add_image(flow, match)).json(), (await add_link(flow, match)).json()
    stored = await flow.db.match_proof_photos.find_one({"id": image["id"]}, {"_id": 0})
    saved = match_proofs.PROOF_DIR / stored["storage_key"]
    assert saved.is_file()

    for other in (user(w, "Falke1"), user(w, "LoeLeitung"), w["staff"]):
        flow.act_as(other)
        refused = await flow.delete(f"/api/matches/{match['id']}/proofs/{image['id']}")
        assert refused.status_code == 404, other["display_name"]
    flow.act_as(user(w, "Kapitaen"))
    removed = await flow.delete(f"/api/matches/{match['id']}/proofs/{image['id']}")
    assert removed.status_code == 200, removed.text
    assert not saved.exists(), "auch die Datei ist weg"
    assert await ids_seen(flow, match) == {link["id"]}
    audit = await flow.db.audit_logs.find({"action": "match.proof.remove"}, {"_id": 0}).to_list(10)
    assert [row["data"]["proof_id"] for row in audit] == [image["id"]]

    # Steht das Ergebnis, ist die Meldung abgeschlossen: Der Nachweis bleibt, wie er ist.
    await set_match(flow, w, status="completed")
    locked = await flow.delete(f"/api/matches/{match['id']}/proofs/{link['id']}")
    assert locked.status_code == 409
    state = (await listed(flow, match)).json()
    assert state["open"] is False and state["can_add"] is False and state["items"][0]["can_remove"] is False
    assert (await add_link(flow, match)).status_code == 409


@pytest.mark.asyncio
async def test_removing_follows_the_deadline_for_adding(flow):
    """Nach der Frist lässt sich ein Beleg nicht mehr zurückziehen - die Gegenseite hat vielleicht schon darauf geantwortet (M2)."""
    w = await league_world(flow)
    match = w["match"]
    soon, past = (now_utc() + timedelta(hours=5)).isoformat(), (now_utc() - timedelta(minutes=1)).isoformat()
    await set_match(flow, w, disputes=[protest(w, evidence_until=soon, statement={"due_at": soon})])
    flow.act_as(user(w, "Falke1"))
    evidence = (await add_link(flow, match, "protest", "verfahren-1")).json()
    early = (await add_link(flow, match, "protest", "verfahren-1")).json()
    assert evidence["can_remove"] is True
    flow.act_as(user(w, "Kapitaen"))
    answer = (await add_link(flow, match, "statement", "verfahren-1")).json()
    # Innerhalb der Frist geht es.
    flow.act_as(user(w, "Falke1"))
    in_time = await flow.delete(f"/api/matches/{match['id']}/proofs/{early['id']}")
    assert in_time.status_code == 200 and in_time.json() == {"ok": True, "kept_for_lead": False}

    await set_match(flow, w, disputes=[protest(w, evidence_until=past, statement={"due_at": past})])
    late_add = await add_link(flow, match, "protest", "verfahren-1")
    late_remove = await flow.delete(f"/api/matches/{match['id']}/proofs/{evidence['id']}")
    assert late_add.status_code == 409 and late_remove.status_code == 409 and "Frist" in late_remove.json()["detail"]
    state = (await listed(flow, match, "protest", "verfahren-1")).json()
    assert state["open"] is True and [item["can_remove"] for item in state["items"]] == [False]
    flow.act_as(user(w, "Kapitaen"))
    late_statement = await flow.delete(f"/api/matches/{match['id']}/proofs/{answer['id']}")
    assert late_statement.status_code == 409
    assert await flow.db.match_proof_photos.count_documents({}) == 2


@pytest.mark.asyncio
async def test_a_removed_moss_proof_stays_for_the_lead(flow):
    """MOSS wird nicht gelöscht, nur als entfernt markiert: Die Seite sieht ihn nicht mehr, die Leitung behält ihn (M2)."""
    w = await league_world(flow)
    match = w["match"]
    await set_match(flow, w, disputes=[protest(w)])
    flow.act_as(user(w, "Mila"))
    moss = (await add_image(flow, match, "moss", "verfahren-1")).json()
    saved = match_proofs.PROOF_DIR / (await flow.db.match_proof_photos.find_one({"id": moss["id"]}, {"_id": 0}))["storage_key"]
    removed = await flow.delete(f"/api/matches/{match['id']}/proofs/{moss['id']}")
    assert removed.status_code == 200 and removed.json() == {"ok": True, "kept_for_lead": True}
    stored = await flow.db.match_proof_photos.find_one({"id": moss["id"]}, {"_id": 0})
    assert stored["status"] == "removed" and stored["removed_by"] == user(w, "Mila")["id"] and stored["removed_at"]
    assert saved.is_file(), "die Datei bleibt"
    audit = await flow.db.audit_logs.find({"action": "match.proof.remove"}, {"_id": 0}).to_list(10)
    assert [row["data"]["kept"] for row in audit] == [True]

    # Weder wer hochgeladen hat noch Captain oder Gegenseite sehen ihn noch - auch nicht als Bild.
    for person in (user(w, "Mila"), user(w, "Kapitaen"), user(w, "Falke1")):
        flow.act_as(person)
        assert await ids_seen(flow, match, "moss", "verfahren-1") == set(), person["display_name"]
        assert (await flow.get(moss["url"])).status_code == 404, person["display_name"]
    flow.act_as(user(w, "Mila"))
    again = await flow.delete(f"/api/matches/{match['id']}/proofs/{moss['id']}")
    assert again.status_code == 404
    # Die Leitung sieht ihn weiter, als entfernt gekennzeichnet.
    flow.act_as(w["staff"])
    item = (await listed(flow, match, "moss", "verfahren-1")).json()["items"][0]
    assert item["id"] == moss["id"] and item["removed"] is True and item["removed_at"] and item["can_remove"] is False
    assert (await flow.get(moss["url"])).status_code == 200
    # Ein entfernter Nachweis zählt nicht mehr gegen die Grenze je Seite.
    flow.act_as(user(w, "Mila"))
    for _ in range(match_proofs.MAX_PER_REF):
        added = await add_link(flow, match, "moss", "verfahren-1")
        assert added.status_code == 200, added.text


@pytest.mark.asyncio
async def test_an_image_waits_for_the_image_check_from_the_first_moment(flow, monkeypatch):
    """Lässt sich die Bildprüfung nicht anstoßen, bleibt das Bild „in Prüfung“ - die Gegenseite sieht es nicht (Review #2360, N1)."""
    from services import media_scan

    async def broken(*args, **kwargs):
        raise RuntimeError("Prüfdienst nicht erreichbar")

    monkeypatch.setattr(media_scan, "enqueue", broken)
    w = await league_world(flow)
    match = w["match"]
    flow.act_as(user(w, "Kapitaen"))
    uploaded = await add_image(flow, match)
    assert uploaded.status_code == 200, uploaded.text
    image = uploaded.json()
    stored = await flow.db.match_proof_photos.find_one({"id": image["id"]}, {"_id": 0})
    assert stored["scan_state"] == "pending" and image["scan_state"] == "pending"
    assert await ids_seen(flow, match) == {image["id"]}, "wer hochgeladen hat, sieht es"
    for other in (user(w, "Falke1"), w["staff"]):
        flow.act_as(other)
        assert await ids_seen(flow, match) == set(), other["display_name"]
        assert (await flow.get(image["url"])).status_code == 404


@pytest.mark.asyncio
async def test_tournaments_outside_a_league_have_no_proof_list(flow):
    """Turniere bleiben, wie sie sind (Review #2360, M3): ein Foto je Meldung über ``/proof-photos`` - ``/proofs`` gibt es dort nicht."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(2)
    match = {"id": "pokal-1", "tournament_id": tournament["id"], "match_type": "duel", "status": "scheduled",
             "slots": [{"slot": 1, "registration_id": registrations[0]["id"]}, {"slot": 2, "registration_id": registrations[1]["id"]}]}
    await flow.db.matches_v2.insert_one(dict(match))
    for person in (users[0], staff):
        flow.act_as(person)
        codes = [(await add_link(flow, match)).status_code, (await add_image(flow, match)).status_code,
                 (await add_link(flow, match, "moss", "verfahren-1")).status_code, (await listed(flow, match)).status_code]
        assert codes == [404, 404, 404, 404], person["display_name"]
    assert await flow.db.match_proof_photos.count_documents({}) == 0
    # Der alte Weg bleibt: ein Foto hochladen, das mit der Meldung mitgeht.
    flow.act_as(users[0])
    photo = await flow.post(f"/api/matches/{match['id']}/proof-photos", files={"file": ("ergebnis.jpg", picture(), "image/jpeg")})
    assert photo.status_code == 200, photo.text
    gone = await flow.delete(f"/api/matches/{match['id']}/proofs/{photo.json()['id']}")
    assert gone.status_code == 404 and await flow.db.match_proof_photos.count_documents({}) == 1


@pytest.mark.asyncio
async def test_old_photos_keep_working_and_show_up_in_the_list(flow):
    """Altbestand: das eine Foto zur Meldung (``photo_id``) läuft unverändert weiter und steht in der Liste - ohne Entfernen."""
    w = await league_world(flow)
    match = w["match"]
    flow.act_as(user(w, "Kapitaen"))
    uploaded = await flow.post(f"/api/matches/{match['id']}/proof-photos", files={"file": ("ergebnis.jpg", picture(), "image/jpeg")})
    assert uploaded.status_code == 200, uploaded.text
    photo = uploaded.json()
    assert set(photo) == {"id", "url", "width", "height", "scan_state"}, "die Antwort des alten Wegs ist unverändert"
    assert await ids_seen(flow, match) == set(), "nicht abgeschickt: hängt noch an nichts"
    claimed = await match_proofs.claim_proof(flow.db, photo["id"], owner_id=user(w, "Kapitaen")["id"], match_id=match["id"], kind="report")
    assert claimed["id"] == photo["id"]
    stored = await flow.db.match_proof_photos.find_one({"id": photo["id"]}, {"_id": 0})
    assert stored["context"] == {"kind": "report"} and "type" not in stored

    item = (await listed(flow, match)).json()["items"][0]
    assert item["id"] == photo["id"] and item["type"] == "image" and item["can_remove"] is False
    kept = await flow.delete(f"/api/matches/{match['id']}/proofs/{photo['id']}")
    assert kept.status_code == 404
    flow.act_as(user(w, "Falke1"))
    assert (await flow.get(photo["url"])).status_code == 200
    # Ein altes Foto zu „Problem melden“ (``dispute``) sieht die Gegenseite weiter - es ist kein MOSS.
    await flow.db.match_proof_photos.update_one({"id": photo["id"]}, {"$set": {"context": {"kind": "dispute"}}})
    assert (await flow.get(photo["url"])).status_code == 200
