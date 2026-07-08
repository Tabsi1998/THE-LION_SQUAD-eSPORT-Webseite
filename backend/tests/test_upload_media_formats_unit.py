import asyncio
import pathlib
import sys
from io import BytesIO
from types import SimpleNamespace

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from PIL import Image

from routes import upload_routes


class FakeUpload:
    def __init__(self, filename, content_type, data):
        self.filename = filename
        self.content_type = content_type
        self._data = data
        self._offset = 0

    async def read(self, size=-1):
        if size is None or size < 0:
            size = len(self._data) - self._offset
        chunk = self._data[self._offset:self._offset + size]
        self._offset += len(chunk)
        return chunk


class FakeMediaUploads:
    def __init__(self):
        self.rows = []

    async def insert_one(self, row):
        self.rows.append(row)


class FakeDb:
    def __init__(self):
        self.media_uploads = FakeMediaUploads()
        self.upload_events = FakeMediaUploads()


def fake_file(filename, content_type="application/octet-stream"):
    return SimpleNamespace(filename=filename, content_type=content_type)


def test_media_kind_routes_camera_originals_as_files():
    assert upload_routes._upload_kind_for_file(fake_file("DSC_001.NEF")) == "file"
    assert upload_routes._upload_kind_for_file(fake_file("iphone.heic", "image/heic")) == "file"
    assert upload_routes._upload_kind_for_file(fake_file("clip.mkv", "video/x-matroska")) == "file"
    assert upload_routes._upload_kind_for_file(fake_file("clip.mts", "video/mp2t")) == "file"


def test_media_kind_keeps_browser_media_as_image_or_video():
    assert upload_routes._upload_kind_for_file(fake_file("photo.jpg", "image/jpeg")) == "image"
    assert upload_routes._upload_kind_for_file(fake_file("clip.mov", "video/quicktime")) == "video"


def test_upload_event_records_diagnostics(monkeypatch):
    fake_db = FakeDb()
    monkeypatch.setattr(upload_routes, "get_db", lambda: fake_db)
    request = SimpleNamespace(headers={"user-agent": "pytest"}, client=SimpleNamespace(host="127.0.0.1"))
    result = {"url": "/api/static/uploads/video.mp4", "filename": "video.mp4", "media_type": "video"}

    asyncio.run(upload_routes._record_upload_event(
        request,
        {"id": "admin-1", "role": "admin"},
        endpoint="/uploads/media",
        media_scope="gallery",
        filename="clip.MOV",
        size=123,
        mime="video/quicktime",
        kind="video",
        status="success",
        status_code=200,
        detail="",
        duration_ms=45,
        result=result,
    ))

    row = fake_db.upload_events.rows[0]
    assert row["endpoint"] == "/uploads/media"
    assert row["media_scope"] == "gallery"
    assert row["filename"] == "clip.MOV"
    assert row["kind"] == "video"
    assert row["status"] == "success"
    assert row["result"]["url"] == "/api/static/uploads/video.mp4"
    assert row["expires_at"] > upload_routes.now_utc()


def test_original_media_upload_converts_nef_preview_and_keeps_original(monkeypatch, tmp_path):
    fake_db = FakeDb()
    monkeypatch.setattr(upload_routes, "PUBLIC_UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(upload_routes, "get_db", lambda: fake_db)
    me = {"id": "admin-1", "role": "admin"}

    def fake_preview(path, suffix):
        assert suffix == ".nef"
        name = "preview.webp"
        (tmp_path / name).write_bytes(b"WEBP-PREVIEW")
        return {
            "filename": name,
            "url": f"/api/static/uploads/{name}",
            "size": len(b"WEBP-PREVIEW"),
            "mime": "image/webp",
            "ext": "webp",
            "width": 1200,
            "height": 800,
            "original_width": 6000,
            "original_height": 4000,
        }

    monkeypatch.setattr(upload_routes, "_create_original_image_preview", fake_preview)
    nef = FakeUpload("DSC_001.NEF", "application/octet-stream", b"NEF-DATA-123")
    nef_result = asyncio.run(upload_routes._upload_original_file_impl(nef, me, "gallery"))

    assert nef_result["media_type"] == "image"
    assert nef_result["mime"] == "image/webp"
    assert nef_result["filename"] == "preview.webp"
    assert nef_result["original_url"].endswith(".nef")
    assert nef_result["original_mime"] == "image/x-nikon-nef"
    original_name = pathlib.Path(nef_result["original_url"]).name
    assert (tmp_path / original_name).read_bytes() == b"NEF-DATA-123"
    assert (tmp_path / "preview.webp").read_bytes() == b"WEBP-PREVIEW"
    assert [row["ext"] for row in fake_db.media_uploads.rows] == ["nef", "webp"]


def test_original_media_upload_accepts_non_preview_video_original(monkeypatch, tmp_path):
    fake_db = FakeDb()
    monkeypatch.setattr(upload_routes, "PUBLIC_UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(upload_routes, "get_db", lambda: fake_db)
    me = {"id": "admin-1", "role": "admin"}

    mkv = FakeUpload("clip.mkv", "video/x-matroska", b"\x1a\x45\xdf\xa3MKV-DATA")
    mkv_result = asyncio.run(upload_routes._upload_original_file_impl(mkv, me, "admin"))
    assert mkv_result["media_type"] == "file"
    assert mkv_result["mime"] == "video/x-matroska"
    assert mkv_result["filename"].endswith(".mkv")
    assert (tmp_path / mkv_result["filename"]).read_bytes() == b"\x1a\x45\xdf\xa3MKV-DATA"
    assert [row["ext"] for row in fake_db.media_uploads.rows] == ["mkv"]


def test_original_tiff_upload_is_converted_to_webp(monkeypatch, tmp_path):
    fake_db = FakeDb()
    monkeypatch.setattr(upload_routes, "PUBLIC_UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(upload_routes, "get_db", lambda: fake_db)
    source = BytesIO()
    Image.new("RGB", (32, 18), "#29B6E8").save(source, format="TIFF")

    result = asyncio.run(upload_routes._upload_original_file_impl(
        FakeUpload("scan.tif", "image/tiff", source.getvalue()),
        {"id": "admin-1", "role": "admin"},
        "gallery",
    ))

    assert result["media_type"] == "image"
    assert result["mime"] == "image/webp"
    assert result["filename"].endswith(".webp")
    assert result["original_url"].endswith(".tif")
    with Image.open(tmp_path / result["filename"]) as img:
        assert img.format == "WEBP"
        assert img.size == (32, 18)
