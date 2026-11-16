"""Glocke, Wachstum, Video-Upload und Galerie: die noch gültigen Fälle der alten Live-Tests (#2395), über die echten Routen.

Vertrag:
- Die Glocke (``/api/admin/notifications``) zeigt jeder Person nur ihre eigenen sichtbaren Meldungen, die neueste zuerst;
  „gelesen“ trifft nur eigene.
- Der Kasten „Wachstum“ liefert je Tag des Zeitraums eine Zeile: Anmeldungen, neue Konten und die laufende Summe der
  Konten. Der Zeitraum liegt immer zwischen 7 und 90 Tagen.
- Ein MP4 über ``/api/uploads/media`` speichert die Verwaltung, die Datei ist danach abrufbar; Spielenden ist der
  Video-Upload verwehrt.
- Ein unbekanntes Album ist für Gäste 404.
Erfundene Personen und Dateien.

Ersetzt:
- test_phase1_unified_match.py::TestAuthAndNotifications::test_notifications_me_returns_200
- test_iter12_sessions_growth.py::TestGrowthStats::test_growth_stats_admin
  (neue Konten je Tag nur auf echtem MongoDB: mongomock fehlt ``$substrBytes``)
- test_iter12_sessions_growth.py::TestGrowthStats::test_growth_stats_clamped
- test_iter12_sessions_growth.py::TestVideoUpload::test_video_upload_and_fetch
- test_iter6_google_gallery.py::TestGallery::test_unknown_album_404
- test_iter7_fixes.py::TestGalleryReseed::test_unknown_album_404
"""
import pathlib
import re
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from routes import upload_routes  # noqa: E402

MP4 = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 4096


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_routes, "PUBLIC_UPLOAD_DIR", tmp_path / "public")
    instance, shutdown = make_flow()
    # Erst nach make_flow: das Harness importiert die App mit der Test-Umgebung.
    import server
    monkeypatch.setattr(server, "public_upload_dir", tmp_path / "public")
    try:
        yield instance
    finally:
        await shutdown()


async def note(flow, user: dict, title: str, minutes_ago: int, **extra) -> str:
    nid = new_id()
    await flow.db.notifications.insert_one({
        "id": nid, "user_id": user["id"], "kind": "system", "title": title, "body": title, "read": False,
        "created_at": (now_utc() - timedelta(minutes=minutes_ago)).isoformat(), **extra})
    return nid


@pytest.mark.asyncio
async def test_the_bell_shows_only_own_visible_notes_and_reads_only_own(flow):
    paula = await flow.add_user(name="paula")
    other = await flow.add_user(name="fremd")
    await note(flow, paula, "Älter", 30)
    newest = await note(flow, paula, "Neu", 1)
    await note(flow, paula, "Nur per Push", 5, in_app_visible=False)
    foreign = await note(flow, other, "Fremd", 2)

    flow.act_as(None)
    assert (await flow.get("/api/admin/notifications")).status_code == 401
    flow.act_as(paula)
    rows = (await flow.get("/api/admin/notifications")).json()
    assert [row["title"] for row in rows] == ["Neu", "Älter"]
    assert all("_id" not in row for row in rows)

    assert (await flow.post(f"/api/admin/notifications/{foreign}/read")).status_code == 200
    assert (await flow.db.notifications.find_one({"id": foreign}))["read"] is False, "eine fremde Meldung bleibt ungelesen"
    assert (await flow.post(f"/api/admin/notifications/{newest}/read")).status_code == 200
    assert (await flow.db.notifications.find_one({"id": newest}))["read"] is True


async def growth_world(flow, *, new_accounts: bool) -> None:
    today = now_utc()
    for days_ago in (0, 0, 3):
        jti = new_id()
        await flow.db.refresh_tokens.insert_one({"id": new_id(), "jti": jti, "family_id": jti, "user_id": new_id(),
                                                 "created_at": today - timedelta(days=days_ago)})
    # Eine Erneuerung ist kein neuer Login.
    await flow.db.refresh_tokens.insert_one({"id": new_id(), "jti": new_id(), "family_id": "eine-familie", "created_at": today})
    for days_ago in ((120, 2, 0) if new_accounts else (120, 100)):
        await flow.db.users.insert_one({"id": new_id(), "username": f"konto{days_ago}", "email": f"konto{days_ago}@example.test",
                                        "created_at": (today - timedelta(days=days_ago)).isoformat()})
    flow.act_as(await flow.add_user(role="superadmin", name="root"))


async def growth(flow, days: int) -> list[dict]:
    data = (await flow.get("/api/admin/growth-stats", params={"days": days})).json()
    assert data["window_days"] == len(data["days"])
    return data["days"]


@pytest.mark.asyncio
async def test_growth_has_one_row_per_day_and_a_window_between_7_and_90_days(flow):
    await growth_world(flow, new_accounts=False)

    days = await growth(flow, 30)
    assert len(days) == 30
    assert all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", row["date"]) for row in days)
    assert [row["date"] for row in days] == sorted(row["date"] for row in days)
    assert days[-1]["date"] == now_utc().strftime("%Y-%m-%d")
    assert [row["logins"] for row in days][-4:] == [1, 0, 0, 2], "Logins je Tag, ohne Erneuerungen"
    assert {row["new_users"] for row in days} == {0}
    assert {row["total_users"] for row in days} == {2}, "ältere Konten bilden die Summe vom ersten Tag an"

    for asked, window in ((3, 7), (0, 30), (500, 90)):
        assert len(await growth(flow, asked)) == window, asked


@pytest.mark.asyncio
async def test_growth_counts_new_accounts_on_their_day(flow):
    if not flow.real_mongo:
        pytest.skip("mongomock kennt $substrBytes nicht - läuft im Verbund mit echtem MongoDB")
    await growth_world(flow, new_accounts=True)
    days = await growth(flow, 30)
    assert (days[-1]["new_users"], days[-3]["new_users"]) == (1, 1)
    totals = [row["total_users"] for row in days]
    assert totals == sorted(totals) and totals[0] == 1 and totals[-1] == 3


@pytest.mark.asyncio
async def test_an_mp4_is_stored_for_the_administration_and_refused_for_players(flow):
    flow.act_as(await flow.add_user(name="spieler"))
    # Im eigenen Bereich dürfen Spielende Bilder hochladen - ein Video nicht.
    refused = await flow.post("/api/uploads/media", files={"file": ("clip.mp4", MP4, "video/mp4")})
    assert refused.status_code == 403, refused.text[:300]
    assert "Video" in refused.json()["detail"]

    flow.act_as(await flow.add_user(role="superadmin", name="root"))
    stored = await flow.post("/api/uploads/media", params={"media_scope": "gallery"},
                             files={"file": ("clip.mp4", MP4, "video/mp4")})
    assert stored.status_code == 200, stored.text[:300]
    url = stored.json()["url"]
    assert url.startswith("/api/static/uploads/") and url.endswith(".mp4")
    served = await flow.get(url)
    assert served.status_code == 200 and served.content == MP4
    row = await flow.db.media_uploads.find_one({"url": url}, {"_id": 0})
    assert row["media_type"] == "video" and row["media_scope"] == "gallery"


@pytest.mark.asyncio
async def test_an_unknown_album_is_404_for_guests(flow):
    flow.act_as(None)
    response = await flow.get("/api/gallery/gibt-es-nicht")
    assert response.status_code == 404 and response.json()["detail"] == "Album nicht gefunden."
