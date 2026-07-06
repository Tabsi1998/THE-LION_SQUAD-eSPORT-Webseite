import asyncio
import pathlib
import sys
from types import SimpleNamespace

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

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


def test_original_media_upload_accepts_nef_and_mkv(monkeypatch, tmp_path):
    fake_db = FakeDb()
    monkeypatch.setattr(upload_routes, "PUBLIC_UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(upload_routes, "get_db", lambda: fake_db)
    me = {"id": "admin-1", "role": "admin"}

    nef = FakeUpload("DSC_001.NEF", "application/octet-stream", b"NEF-DATA-123")
    nef_result = asyncio.run(upload_routes._upload_original_file_impl(nef, me, "gallery"))

    mkv = FakeUpload("clip.mkv", "video/x-matroska", b"\x1a\x45\xdf\xa3MKV-DATA")
    mkv_result = asyncio.run(upload_routes._upload_original_file_impl(mkv, me, "admin"))

    assert nef_result["media_type"] == "file"
    assert nef_result["mime"] == "image/x-nikon-nef"
    assert nef_result["filename"].endswith(".nef")
    assert (tmp_path / nef_result["filename"]).read_bytes() == b"NEF-DATA-123"

    assert mkv_result["media_type"] == "file"
    assert mkv_result["mime"] == "video/x-matroska"
    assert mkv_result["filename"].endswith(".mkv")
    assert (tmp_path / mkv_result["filename"]).read_bytes() == b"\x1a\x45\xdf\xa3MKV-DATA"
    assert [row["ext"] for row in fake_db.media_uploads.rows] == ["nef", "mkv"]
