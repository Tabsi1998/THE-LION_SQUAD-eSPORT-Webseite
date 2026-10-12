"""Foto vom Ergebnis (#1157): Spieler melden mit Foto - nur Gegenseite und Turnierleitung sehen es.

Ein Beweisfoto ist persönlich. Geprüft wird mit echten Routen und erfundenen Konten: wer hochladen darf, dass das Bild
neu gespeichert wird (kein EXIF, kein GPS-Ort), wer es sehen darf (Spieler des Spiels, Turnierleitung - sonst 404),
dass es bis zur Bildprüfung nur der Absender sieht, dass fremde Fotos sich nicht anhängen lassen, und dass es mit dem
Turnier und nach der Frist verschwindet.
"""
import io
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import match_proofs  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setattr(match_proofs, "PROOF_DIR", tmp_path / "proofs")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def jpeg_with_gps() -> bytes:
    exif = Image.Exif()
    exif[0x010F] = "Telefon"
    exif[0x8825] = {1: "N", 2: (48.0, 12.0, 30.0), 3: "E", 4: (16.0, 22.0, 10.0)}
    buffer = io.BytesIO()
    Image.new("RGB", (80, 60), (30, 120, 200)).save(buffer, format="JPEG", exif=exif.tobytes())
    return buffer.getvalue()


async def bracket(flow, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(4, **fields)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    matches = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))
    match = matches[0]
    first, second = [slot["registration_id"] for slot in match["slots"]]
    player = {reg["id"]: users[index] for index, reg in enumerate(registrations)}
    others = [users[index] for index, reg in enumerate(registrations) if reg["id"] not in {first, second}]
    return staff, tournament, match, first, second, player, others


async def upload(flow, match, content=None):
    return await flow.post(f"/api/matches/{match['id']}/proof-photos", files={"file": ("ergebnis.jpg", content or jpeg_with_gps(), "image/jpeg")})


def ranking(winner: str, loser: str, score=(2, 1), **extra) -> dict:
    return {"results": [{"registration_id": winner, "rank": 1, "score": score[0]}, {"registration_id": loser, "rank": 2, "score": score[1]}], **extra}


@pytest.mark.asyncio
async def test_player_reports_with_a_photo_and_only_opponent_and_staff_see_it(flow):
    staff, tournament, match, first, second, player, others = await bracket(flow)
    flow.act_as(player[first])
    uploaded = await upload(flow, match)
    assert uploaded.status_code == 200, uploaded.text
    photo = uploaded.json()
    assert photo["url"] == f"/api/matches/{match['id']}/proof-photos/{photo['id']}"
    stored = await flow.db.match_proof_photos.find_one({"id": photo["id"]}, {"_id": 0})
    saved = match_proofs.PROOF_DIR / stored["storage_key"]
    with Image.open(saved) as image:
        assert dict(image.getexif()) == {}, "neu gespeichert - kein EXIF, kein GPS-Ort"
    assert "/static/uploads" not in photo["url"], "nie eine öffentliche Upload-Adresse"

    # Vor dem Absenden sieht es nur, wer es hochgeladen hat.
    flow.act_as(player[second])
    assert (await flow.get(photo["url"])).status_code == 404

    flow.act_as(player[first])
    reported = await flow.post(f"/api/matches/{match['id']}/report", json=ranking(first, second, photo_id=photo["id"]))
    assert reported.status_code == 200, reported.text
    entry = (await flow.reload(match))["reports"][0]
    assert entry["photo_id"] == photo["id"]

    for viewer in (player[first], player[second], staff):
        flow.act_as(viewer)
        seen = await flow.get(photo["url"])
        assert seen.status_code == 200, viewer["display_name"]
        assert "no-store" in seen.headers["cache-control"]
    for stranger in (others[0], await flow.add_user(role="moderator", name="Moderation"), None):
        flow.act_as(stranger)
        assert (await flow.get(photo["url"])).status_code == 404, "Unbeteiligte bekommen nichts"

    # Beim Bestätigen sieht die Gegenseite das Foto.
    flow.act_as(player[second])
    page = (await flow.get(f"/api/matches/{match['id']}/page")).json()
    assert page["report_state"]["proposal_photo"]["id"] == photo["id"]
    assert page["report_entry"]["kind"] == "duel" and "hold" not in page["report_entry"]


@pytest.mark.asyncio
async def test_only_the_match_sides_upload_and_foreign_photos_cannot_be_attached(flow):
    staff, tournament, match, first, second, player, others = await bracket(flow)
    flow.act_as(others[0])
    assert (await upload(flow, match)).status_code == 403
    flow.act_as(player[second])
    theirs = (await upload(flow, match)).json()
    flow.act_as(player[first])
    stolen = await flow.post(f"/api/matches/{match['id']}/report", json=ranking(first, second, photo_id=theirs["id"]))
    assert stolen.status_code == 400 and "Foto" in stolen.json()["detail"]
    assert (await upload(flow, match, content=b"kein bild")).status_code == 400


@pytest.mark.asyncio
async def test_photo_waits_for_the_image_check(flow):
    staff, tournament, match, first, second, player, others = await bracket(flow)
    flow.act_as(player[first])
    photo = (await upload(flow, match)).json()
    await flow.db.match_proof_photos.update_one({"id": photo["id"]}, {"$set": {"scan_state": "review"}})
    await flow.post(f"/api/matches/{match['id']}/report", json=ranking(first, second, photo_id=photo["id"]))
    assert (await flow.get(photo["url"])).status_code == 200, "der Absender sieht sein Foto"
    flow.act_as(player[second])
    assert (await flow.get(photo["url"])).status_code == 404, "die Gegenseite erst nach der Bildprüfung"
    page = (await flow.get(f"/api/matches/{match['id']}/page")).json()
    assert page["report_state"]["proposal_photo"] is None


@pytest.mark.asyncio
async def test_photos_go_with_the_tournament_and_after_the_retention(flow):
    staff, tournament, match, first, second, player, others = await bracket(flow)
    flow.act_as(player[first])
    kept = (await upload(flow, match)).json()
    await flow.post(f"/api/matches/{match['id']}/report", json=ranking(first, second, photo_id=kept["id"]))
    old = (await upload(flow, match)).json()
    unused = (await upload(flow, match)).json()
    long_ago = (now_utc() - timedelta(days=31)).isoformat()
    await flow.db.match_proof_photos.update_one({"id": old["id"]}, {"$set": {"status": "attached", "created_at": long_ago}})
    await flow.db.match_proof_photos.update_one({"id": unused["id"]}, {"$set": {"created_at": (now_utc() - timedelta(hours=25)).isoformat()}})
    removed = await match_proofs.purge(flow.db)
    assert removed == 2
    left = {row["id"] for row in await flow.db.match_proof_photos.find({}, {"_id": 0}).to_list(10)}
    assert left == {kept["id"]}

    # In Klärung bleibt ein altes Foto - die Turnierleitung braucht es noch.
    await flow.db.match_proof_photos.update_one({"id": kept["id"]}, {"$set": {"created_at": long_ago}})
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"status": "disputed"}})
    assert await match_proofs.purge(flow.db) == 0

    flow.act_as(staff)
    gone = await flow.delete(f"/api/tournaments/{tournament['id']}")
    assert gone.status_code == 200, gone.text
    assert await flow.db.match_proof_photos.count_documents({}) == 0
    assert not any((match_proofs.PROOF_DIR).iterdir()), "auch die Dateien sind weg"


@pytest.mark.asyncio
async def test_staff_only_mode_has_no_player_report(flow):
    staff, tournament, match, first, second, player, others = await bracket(flow, result_entry_mode="staff_only")
    flow.act_as(player[first])
    page = (await flow.get(f"/api/matches/{match['id']}/page")).json()
    assert page["can_player_report_result"] is False and page["report_entry"] is None
    assert page["acting_registration_id"] == first and page["result_entry_mode"] == "staff_only"
    refused = await flow.post(f"/api/matches/{match['id']}/report", json=ranking(first, second))
    assert refused.status_code == 403
