"""Fotos vom Event (#1185, #1186): „Die Fotos sind da“ an die Teilnehmer und Fotos einsenden mit Freigabe.

Geprüft mit echten Routen und erfundenen Konten:
- Die Meldung geht genau einmal je Album und Person an die Angemeldeten des Events - Event-Anmeldung und Turniere des
  Events, bei Teams jedes Mitglied -, nicht an Abgemeldete oder Fremde; Mitglieder-Alben nur an Mitglieder. Alte Alben
  melden sich beim Einspielen nicht nachträglich, und solange Fotos dazukommen, wartet die Meldung.
- Einsenden: nur Mitglieder, nur mit Haken, nur bei Event-Alben, vom ersten Event-Tag bis sieben Tage danach, höchstens
  20 je Person; das Bild wird neu gespeichert (kein EXIF, kein GPS-Ort) und liegt privat, bis es freigegeben ist.
- Freigabe nur durch Redaktion oder Vereinsverwaltung; erst nach der Bildprüfung; freigegeben mit „Foto: Name“ (oder
  ohne), abgelehnt ist die Datei weg; die einsendende Person bekommt Bescheid.
"""
import asyncio
import io
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from services import event_photos, media_scan  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setattr(event_photos, "SUBMISSION_DIR", tmp_path / "submissions")
    monkeypatch.setattr(event_photos, "PUBLIC_DIR", tmp_path / "public")
    flow, shutdown = make_flow()
    # Die eindeutigen Schlüssel für „genau einmal“ und die Höchstzahl - wie beim Start der Anwendung.
    await event_photos.ensure_indexes(flow.db)
    try:
        yield flow
    finally:
        media_scan.fake_results.clear()
        await shutdown()


def jpeg_with_gps() -> bytes:
    exif = Image.Exif()
    exif[0x010F] = "Telefon"
    exif[0x8825] = {1: "N", 2: (48.0, 12.0, 30.0), 3: "E", 4: (16.0, 22.0, 10.0)}
    buffer = io.BytesIO()
    Image.new("RGB", (80, 60), (30, 120, 200)).save(buffer, format="JPEG", exif=exif.tobytes())
    return buffer.getvalue()


def iso(delta: timedelta) -> str:
    return (now_utc() + delta).isoformat()


async def make_event(flow, *, ended_days_ago: int = 1, status: str = "completed") -> dict:
    event = {
        "id": new_id(), "slug": f"lan-{new_id()[:6]}", "name": "Herbst-LAN", "status": status, "visibility": "public",
        "start_date": iso(timedelta(days=-ended_days_ago - 1)), "end_date": iso(timedelta(days=-ended_days_ago)),
    }
    await flow.db.events.insert_one(dict(event))
    return event


async def make_album(flow, event: dict | None, *, visibility: str = "public", published: bool = True) -> dict:
    album = {
        "id": new_id(), "slug": f"album-{new_id()[:6]}", "title": "Herbst-LAN Fotos", "visibility": visibility,
        "published": published, "event_id": event["id"] if event else None, "order_index": 0,
    }
    await flow.db.gallery_albums.insert_one(dict(album))
    return album


async def add_photos(flow, album: dict, count: int, *, uploaded: timedelta = timedelta(minutes=-30)) -> None:
    for index in range(count):
        await flow.db.gallery_photos.insert_one({
            "id": new_id(), "album_id": album["id"], "media_type": "image", "image_url": f"/api/static/uploads/{index}.jpg",
            "order_index": index, "uploaded_at": iso(uploaded),
        })


async def member(flow, name: str, *, consent: bool = True) -> dict:
    user = await flow.add_user(name=name)
    await flow.db.memberships.insert_one({"user_id": user["id"], "member_status": "active"})
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"newsletter_consent": consent}})
    return {**user, "newsletter_consent": consent}


async def guest(flow, name: str) -> dict:
    user = await flow.add_user(name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"newsletter_consent": True}})
    return {**user, "newsletter_consent": True}


async def notices(flow, user: dict, kind: str | None = None) -> list[dict]:
    query = {"user_id": user["id"], "kind": {"$in": [event_photos.PUBLIC_KIND, event_photos.MEMBER_KIND]}}
    if kind:
        query["kind"] = kind
    return await flow.db.notifications.find(query, {"_id": 0}).to_list(50)


# ---------- #1185: Die Fotos sind da ----------

@pytest.mark.asyncio
async def test_participants_hear_once_when_the_photos_are_online(flow):
    event = await make_event(flow)
    album = await make_album(flow, event)
    await add_photos(flow, album, 3)
    registered, cancelled, outsider, captain, teammate = (
        await guest(flow, "Angemeldet"), await guest(flow, "Abgemeldet"), await guest(flow, "Fremd"),
        await guest(flow, "Kapitän"), await guest(flow, "Teamkollegin"))
    await flow.db.event_registrations.insert_many([
        {"id": new_id(), "event_id": event["id"], "user_id": registered["id"], "status": "registered"},
        {"id": new_id(), "event_id": event["id"], "user_id": cancelled["id"], "status": "cancelled"},
    ])
    tournament = await flow.create_tournament(event_id=event["id"], team_mode="team")
    team = {"id": new_id(), "name": "Lions", "leader_id": captain["id"], "member_ids": [captain["id"], teammate["id"]]}
    await flow.db.teams.insert_one(dict(team))
    await flow.db.tournament_registrations.insert_one({"id": new_id(), "tournament_id": tournament["id"], "team_id": team["id"], "user_id": captain["id"], "status": "approved"})

    result = await event_photos.notify_due()
    assert result == {"items": 1, "sent": 3}
    for person in (registered, captain, teammate):
        rows = await notices(flow, person)
        assert len(rows) == 1, person["display_name"]
        assert rows[0]["title"] == "Die Fotos sind da: 3 Bilder"
        assert rows[0]["url"] == f"/galerie/{album['slug']}"
        assert rows[0]["kind"] == "gallery_event" and rows[0]["meta"]["category"] == "tournament_updates"
    for person in (cancelled, outsider):
        assert await notices(flow, person) == []

    # Kommen später Fotos dazu (etwa freigegebene Einsendungen), meldet sich das Album nicht noch einmal.
    await add_photos(flow, album, 2, uploaded=timedelta(minutes=-20))
    await flow.db.gallery_albums.update_one({"id": album["id"]}, {"$unset": {"participants_notified_at": ""}})
    again = await event_photos.notify_due()
    assert again["sent"] == 0, "je Album und Person genau einmal"
    assert len(await notices(flow, registered)) == 1


@pytest.mark.asyncio
async def test_member_album_reaches_only_member_participants(flow):
    event = await make_event(flow)
    album = await make_album(flow, event, visibility="members")
    await add_photos(flow, album, 1)
    club_member = await member(flow, "Mitglied", consent=False)
    not_member = await guest(flow, "Gast")
    await flow.db.event_registrations.insert_many([
        {"id": new_id(), "event_id": event["id"], "user_id": club_member["id"], "status": "checked_in"},
        {"id": new_id(), "event_id": event["id"], "user_id": not_member["id"], "status": "checked_in"},
    ])
    await event_photos.notify_due()
    rows = await notices(flow, club_member)
    assert len(rows) == 1 and rows[0]["kind"] == "gallery_member" and rows[0]["meta"]["category"] == "club_internal"
    assert rows[0]["title"] == "Die Fotos sind da: 1 Bild"
    assert await notices(flow, not_member) == [], "Mitglieder-Alben nur an Mitglieder"


@pytest.mark.asyncio
async def test_waits_for_uploads_to_settle_and_skips_old_empty_and_unlinked_albums(flow):
    event = await make_event(flow)
    person = await guest(flow, "Dabei")
    await flow.db.event_registrations.insert_one({"id": new_id(), "event_id": event["id"], "user_id": person["id"], "status": "registered"})
    busy = await make_album(flow, event)
    await add_photos(flow, busy, 2, uploaded=timedelta(minutes=-2))
    old = await make_album(flow, event)
    await add_photos(flow, old, 5, uploaded=timedelta(days=-3))
    empty = await make_album(flow, event)
    draft = await make_album(flow, event, published=False)
    await add_photos(flow, draft, 2)
    unlinked = await make_album(flow, None)
    await add_photos(flow, unlinked, 2)

    first_run = await event_photos.notify_due()
    assert first_run == {"items": 0, "sent": 0}
    assert await notices(flow, person) == []
    stored_old = await flow.db.gallery_albums.find_one({"id": old["id"]})
    assert stored_old.get("participants_notified_at"), "alte Alben gelten still als gemeldet"
    for waiting in (busy, empty):
        assert not (await flow.db.gallery_albums.find_one({"id": waiting["id"]})).get("participants_notified_at")

    # Zehn Minuten später ist Ruhe - jetzt kommt die Meldung, mit der fertigen Zahl.
    await event_photos.notify_due(now=now_utc() + timedelta(minutes=15))
    rows = await notices(flow, person)
    assert [row["meta"]["album_id"] for row in rows] == [busy["id"]]


@pytest.mark.asyncio
async def test_album_shows_its_event(flow):
    event = await make_event(flow)
    album = await make_album(flow, event)
    await add_photos(flow, album, 1)
    response = await flow.get(f"/api/gallery/{album['slug']}")
    assert response.status_code == 200
    assert response.json()["event"]["slug"] == event["slug"]
    assert response.json()["photo_submission"] is None, "Gäste sehen keinen Einsende-Knopf"


# ---------- #1186: Fotos einsenden ----------

async def submit(flow, album: dict, *, consent: bool = True, credit: bool = True, content: bytes | None = None, name: str = "foto.jpg"):
    return await flow.post(
        f"/api/gallery/{album['slug']}/submissions",
        files={"file": (name, content if content is not None else jpeg_with_gps(), "image/jpeg")},
        data={"consent": "true" if consent else "false", "credit": "true" if credit else "false"},
    )


async def board(flow) -> dict:
    """Jemand mit der Vereinsverwaltung (wie der Vorstand) - ohne Redaktion."""
    user = await flow.add_user(name="Vorstand")
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"areas": ["club"]}})
    return {**user, "areas": ["club"]}


@pytest.mark.asyncio
async def test_member_submits_privately_without_exif_and_only_with_consent(flow):
    event = await make_event(flow)
    album = await make_album(flow, event)
    anna = await member(flow, "Anna")
    flow.act_as(anna)

    info = (await flow.get(f"/api/gallery/{album['slug']}")).json()["photo_submission"]
    assert info["can_submit"] is True and info["remaining"] == 20 and info["pending"] == 0

    without = await submit(flow, album, consent=False)
    assert without.status_code == 400 and "einverstanden" in without.json()["detail"]
    assert await flow.db.gallery_submissions.count_documents({}) == 0

    sent = await submit(flow, album)
    assert sent.status_code == 200, sent.text
    body = sent.json()
    assert body["status"] == "pending" and "/static/uploads" not in body["image_url"]
    stored = await flow.db.gallery_submissions.find_one({"id": body["id"]}, {"_id": 0})
    with Image.open(event_photos.SUBMISSION_DIR / stored["storage_key"]) as image:
        assert dict(image.getexif()) == {}, "neu gespeichert - kein EXIF, kein GPS-Ort"
    assert stored["consent_at"] and stored["credit"] is True

    # Nichts erscheint ohne Freigabe.
    album_view = (await flow.get(f"/api/gallery/{album['slug']}")).json()
    assert album_view["photos"] == []
    assert album_view["photo_submission"]["pending"] == 1 and album_view["photo_submission"]["remaining"] == 19

    # Das Bild sieht nur, wer es geschickt hat - andere Mitglieder und Gäste bekommen 404.
    assert (await flow.get(body["image_url"])).status_code == 200
    flow.act_as(await member(flow, "Bert"))
    assert (await flow.get(body["image_url"])).status_code == 404
    flow.act_as(None)
    assert (await flow.get(body["image_url"])).status_code == 404

    # Kein Bild: abgelehnt, bevor etwas gespeichert wird.
    flow.act_as(anna)
    broken = await submit(flow, album, content=b"kein bild", name="notiz.txt")
    assert broken.status_code == 400
    info_after = (await flow.get(f"/api/gallery/{album['slug']}")).json()["photo_submission"]
    assert info_after["used"] == 1, "ein abgewiesenes Bild kostet keinen Platz"


@pytest.mark.asyncio
async def test_who_may_submit_where_and_until_when(flow, monkeypatch):
    event = await make_event(flow)
    album = await make_album(flow, event)
    flow.act_as(None)
    response = await submit(flow, album)
    assert response.status_code == 401

    not_member = await guest(flow, "Gast")
    flow.act_as(not_member)
    assert (await flow.get(f"/api/gallery/{album['slug']}")).json()["photo_submission"] is None, "Nicht-Mitglieder sehen den Knopf nicht"
    response = await submit(flow, album)
    assert response.status_code == 403

    anna = await member(flow, "Anna")
    flow.act_as(anna)
    plain = await make_album(flow, None)
    response = await submit(flow, plain)
    assert response.status_code == 409, "nur Alben eines Events"
    assert (await flow.get(f"/api/gallery/{plain['slug']}")).json()["photo_submission"] is None

    late_event = await make_event(flow, ended_days_ago=8)
    late = await make_album(flow, late_event)
    info = (await flow.get(f"/api/gallery/{late['slug']}")).json()["photo_submission"]
    assert info["open"] is False and info["can_submit"] is False
    response = await submit(flow, late)
    assert response.status_code == 409, "nach sieben Tagen ist Einsenden zu"
    last_day = await make_album(flow, await make_event(flow, ended_days_ago=7))
    response = await submit(flow, last_day)
    assert response.status_code == 200, "am siebten Tag geht es noch"

    monkeypatch.setattr(event_photos, "MAX_PER_PERSON", 2)
    response = await submit(flow, album)
    assert response.status_code == 200
    response = await submit(flow, album)
    assert response.status_code == 200
    full = await submit(flow, album)
    assert full.status_code == 409
    assert (await flow.get(f"/api/gallery/{album['slug']}")).json()["photo_submission"]["can_submit"] is False


@pytest.mark.asyncio
async def test_board_approves_with_credit_and_rejects_with_deletion(flow):
    event = await make_event(flow)
    album = await make_album(flow, event)
    anna = await member(flow, "Anna")
    flow.act_as(anna)
    named = (await submit(flow, album)).json()
    anonymous = (await submit(flow, album, credit=False)).json()
    rejected = (await submit(flow, album)).json()
    rejected_key = (await flow.db.gallery_submissions.find_one({"id": rejected["id"]}))["storage_key"]

    # Spieler und Turnierleitung geben nicht frei.
    flow.act_as(await member(flow, "Bert"))
    assert (await flow.get("/api/admin/gallery-submissions")).status_code == 403
    flow.act_as(await flow.add_user(role="tournament_admin", name="Leitung"))
    response = await flow.post("/api/admin/gallery-submissions/decide", json={"ids": [named["id"]], "action": "approve"})
    assert response.status_code == 403

    vorstand = await board(flow)
    flow.act_as(vorstand)
    queue = (await flow.get("/api/admin/gallery-submissions")).json()
    assert {row["id"] for row in queue} == {named["id"], anonymous["id"], rejected["id"]}
    assert queue[0]["owner_name"] == "Anna" and queue[0]["event_name"] == "Herbst-LAN" and queue[0]["album_title"] == album["title"]
    assert (await flow.get(named["image_url"])).status_code == 200, "die Freigabe sieht das Bild"

    approved = await flow.post("/api/admin/gallery-submissions/decide", json={"ids": [named["id"], anonymous["id"]], "action": "approve"})
    assert approved.status_code == 200, approved.text
    photos = await flow.db.gallery_photos.find({"album_id": album["id"]}, {"_id": 0}).to_list(10)
    assert sorted(photo["credit"] or "" for photo in photos) == ["", "Anna"]
    assert {photo["uploaded_by"] for photo in photos} == {anna["id"]}, "zählt für den Erfolg der Person, die eingesandt hat"
    assert {photo["approved_by"] for photo in photos} == {vorstand["id"]}
    for photo in photos:
        assert photo["image_url"].startswith("/api/static/uploads/")
        with Image.open(event_photos.PUBLIC_DIR / photo["image_url"].rsplit("/", 1)[1]) as image:
            assert dict(image.getexif()) == {}
    public = (await flow.get(f"/api/gallery/{album['slug']}")).json()
    assert {photo.get("credit") for photo in public["photos"]} == {"Anna", None}

    rejected_now = await flow.post("/api/admin/gallery-submissions/decide", json={"ids": [rejected["id"]], "action": "reject", "reason": "unscharf"})
    assert rejected_now.status_code == 200
    assert await flow.db.gallery_submissions.find_one({"id": rejected["id"]}) is None
    assert not (event_photos.SUBMISSION_DIR / rejected_key).exists(), "abgelehnt: Datei gelöscht"
    assert (await flow.get("/api/admin/gallery-submissions")).json() == []
    again = await flow.post("/api/admin/gallery-submissions/decide", json={"ids": [named["id"]], "action": "approve"})
    assert again.status_code == 409, "schon entschieden"

    told = await flow.db.notifications.find({"user_id": anna["id"], "kind": "gallery_submission"}, {"_id": 0}).to_list(10)
    assert sorted(row["title"] for row in told) == ["Deine Fotos sind online", "Fotos nicht freigegeben"]
    online = next(row for row in told if row["title"] == "Deine Fotos sind online")
    assert online["body"].startswith("2 Fotos") and online["url"] == f"/galerie/{album['slug']}"
    assert "unscharf" in next(row for row in told if row["title"] == "Fotos nicht freigegeben")["body"]
    assert await flow.db.audit_logs.count_documents({"action": {"$in": ["gallery.submission_approve", "gallery.submission_reject"]}}) == 2


@pytest.mark.asyncio
async def test_no_approval_before_the_image_check_is_through(flow):
    event = await make_event(flow)
    album = await make_album(flow, event)
    flow.act_as(await member(flow, "Anna"))
    media_scan.fake_results.append({"scores": {"nudity": 0.7, "racy": 0.0, "violence": 0.0}})
    doubtful = (await submit(flow, album)).json()
    assert doubtful["scan_state"] == "review"

    redaktion = await flow.add_user(name="Redaktion")
    await flow.db.users.update_one({"id": redaktion["id"]}, {"$set": {"areas": ["content"]}})
    flow.act_as({**redaktion, "areas": ["content"]})
    assert (await flow.get(doubtful["image_url"])).status_code == 404, "bis die Moderation entscheidet, sieht es die Freigabe nicht"
    refused = await flow.post("/api/admin/gallery-submissions/decide", json={"ids": [doubtful["id"]], "action": "approve"})
    assert refused.status_code == 409
    assert await flow.db.gallery_photos.count_documents({"album_id": album["id"]}) == 0
    # Ablehnen geht immer.
    response = await flow.post("/api/admin/gallery-submissions/decide", json={"ids": [doubtful["id"]], "action": "reject"})
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_account_erasure_and_album_deletion_take_the_submissions_along(flow):
    event = await make_event(flow)
    album = await make_album(flow, event)
    anna = await member(flow, "Anna")
    flow.act_as(anna)
    first = (await submit(flow, album)).json()
    second = (await submit(flow, album)).json()
    flow.act_as(await board(flow))
    await flow.post("/api/admin/gallery-submissions/decide", json={"ids": [first["id"]], "action": "approve"})

    removed = await event_photos.delete_for_user(flow.db, anna["id"])
    assert removed == 2
    assert await flow.db.gallery_submissions.count_documents({"owner_id": anna["id"]}) == 0
    assert not any((event_photos.SUBMISSION_DIR).iterdir()), "keine Datei bleibt liegen"
    photo = await flow.db.gallery_photos.find_one({"album_id": album["id"]}, {"_id": 0})
    assert photo["credit"] is None, "nach der Kontolöschung steht kein Name mehr am Foto"
    assert second["id"]

    flow.act_as(anna)
    third = (await submit(flow, album)).json()
    staff = await flow.add_staff()
    flow.act_as(staff)
    deleted = await flow.delete(f"/api/gallery/{album['id']}")
    assert deleted.status_code == 200
    assert await flow.db.gallery_submissions.find_one({"id": third["id"]}) is None


# ---------- Nach der Codex-Prüfung: parallel, überlappend, Auskunft ----------

@pytest.mark.asyncio
async def test_parallel_uploads_never_exceed_the_limit(flow, monkeypatch):
    monkeypatch.setattr(event_photos, "MAX_PER_PERSON", 3)
    event = await make_event(flow)
    album = await make_album(flow, event)
    anna = await member(flow, "Anna")
    flow.act_as(anna)
    responses = await asyncio.gather(*(submit(flow, album) for _ in range(7)))
    codes = sorted(response.status_code for response in responses)
    assert codes == [200, 200, 200, 409, 409, 409, 409], codes
    assert await flow.db.gallery_submissions.count_documents({"owner_id": anna["id"]}) == 3
    quota = await flow.db.gallery_submission_quota.find_one({"album_id": album["id"], "owner_id": anna["id"]})
    assert quota["count"] == 3

    # Eine Ablehnung gibt den Platz zurück - danach geht genau eines wieder.
    first = next(response.json() for response in responses if response.status_code == 200)
    flow.act_as(await board(flow))
    rejected = await flow.post("/api/admin/gallery-submissions/decide", json={"ids": [first["id"]], "action": "reject"})
    assert rejected.status_code == 200
    flow.act_as(anna)
    again = await asyncio.gather(submit(flow, album), submit(flow, album))
    assert sorted(response.status_code for response in again) == [200, 409]


@pytest.mark.asyncio
async def test_overlapping_runs_send_exactly_one_notice_per_person(flow):
    event = await make_event(flow)
    album = await make_album(flow, event)
    await add_photos(flow, album, 4)
    people = [await guest(flow, f"Dabei {index}") for index in range(3)]
    for person in people:
        await flow.db.event_registrations.insert_one({"id": new_id(), "event_id": event["id"], "user_id": person["id"], "status": "registered"})

    results = await asyncio.gather(event_photos.notify_due(), event_photos.notify_due(), event_photos.notify_due())
    assert sum(result["sent"] for result in results) == 3
    for person in people:
        assert len(await notices(flow, person)) == 1, person["display_name"]
    stored = await flow.db.gallery_albums.find_one({"id": album["id"]})
    assert stored["participants_notify_state"] == "done" and stored["participants_notified_count"] == 3


@pytest.mark.asyncio
async def test_an_aborted_run_is_picked_up_without_doubles(flow):
    event = await make_event(flow)
    album = await make_album(flow, event)
    await add_photos(flow, album, 2)
    told, missed = await guest(flow, "Schon gemeldet"), await guest(flow, "Noch offen")
    for person in (told, missed):
        await flow.db.event_registrations.insert_one({"id": new_id(), "event_id": event["id"], "user_id": person["id"], "status": "registered"})
    # Ein Lauf hat das Album vor 40 Minuten beansprucht, die erste Person gemeldet und ist dann abgebrochen.
    await flow.db.gallery_albums.update_one({"id": album["id"]}, {"$set": {
        "participants_notified_at": iso(timedelta(minutes=-40)), "participants_notify_state": "sending"}})
    await flow.db.gallery_album_notices.insert_one({"album_id": album["id"], "user_id": told["id"], "created_at": iso(timedelta(minutes=-40))})

    # Solange der Anspruch frisch ist, lässt ein zweiter Lauf das Album in Ruhe.
    await flow.db.gallery_albums.update_one({"id": album["id"]}, {"$set": {"participants_notified_at": iso(timedelta(minutes=-5))}})
    fresh = await event_photos.notify_due()
    assert fresh["sent"] == 0
    await flow.db.gallery_albums.update_one({"id": album["id"]}, {"$set": {"participants_notified_at": iso(timedelta(minutes=-40))}})

    result = await event_photos.notify_due()
    assert result["sent"] == 1
    assert await notices(flow, told) == [], "die Quittung verhindert die zweite Meldung"
    assert len(await notices(flow, missed)) == 1
    duplicate = await event_photos.notify_album(flow.db, album, event, 2, 0)
    assert duplicate == 0, "direkt noch einmal: niemand bekommt es doppelt"


@pytest.mark.asyncio
async def test_data_export_lists_own_submissions_with_consent_but_no_file(flow):
    event = await make_event(flow)
    album = await make_album(flow, event)
    anna = await member(flow, "Anna")
    flow.act_as(anna)
    sent = (await submit(flow, album, credit=False)).json()
    flow.act_as(await member(flow, "Bert"))
    await submit(flow, album)

    flow.act_as(anna)
    export = (await flow.get("/api/dsgvo/export-my-data")).json()
    rows = export["gallery_submissions"]
    assert [row["id"] for row in rows] == [sent["id"]], "nur die eigenen"
    row = rows[0]
    assert row["consent_at"] and row["status"] == "pending" and row["credit"] is False and row["album_id"] == album["id"]
    assert "storage_key" not in row and "data" not in row, "keine Datei, kein Ablageort"
