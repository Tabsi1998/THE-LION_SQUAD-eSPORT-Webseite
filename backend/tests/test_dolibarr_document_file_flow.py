"""Vereinsdokumente als Datei (#849, Vereine ab 1.3.0): die Website holt `…/file` statt JSON mit base64 und reicht
ETag (die Prüfsumme), 304 auf `If-None-Match` und den Teilabruf (`Range` → 206, hinter dem Ende 416, `If-Range`) durch
- so lädt die App nur Geändertes und setzt abgebrochene Downloads fort. Die Rechte prüft das Modul vor jedem Byte
und vor jedem 304; eine ganze Datei muss zur Prüfsumme passen. Ältere Module bleiben beim bisherigen Weg."""
import hashlib
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import FakeDolibarr, document_pdf_bytes  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import dolibarr_client, dolibarr_identity  # noqa: E402
from test_dolibarr_identity_flow import club_member, connect, publish_examples  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fake(monkeypatch):
    instance = FakeDolibarr()
    monkeypatch.setattr(dolibarr_client, "_transport", instance.transport())
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    dolibarr_identity.reset_cache()
    return instance


async def module(flow, version):
    await flow.db.settings.update_one({"id": "dolibarr_sync_state"}, {"$set": {"id": "dolibarr_sync_state", "module_version": version}}, upsert=True)


async def bound_member(flow, fake):
    await connect(flow)
    publish_examples(fake)
    paula = await club_member(flow, "paula")
    flow.act_as(paula)
    assert (await flow.post("/api/membership/me/identity", json={"code": "LION-1234"})).json()["status"] == "bound"
    return paula


@pytest.mark.asyncio
async def test_file_with_etag_304_and_ranges_through_the_website(flow, fake):
    await bound_member(flow, fake)
    await module(flow, "1.3.0")
    whole = document_pdf_bytes(3)
    tag = '"' + hashlib.sha256(whole).hexdigest() + '"'

    # Die Liste nennt die Prüfsumme - damit fragt die App nach.
    letter = next(d for d in (await flow.get("/api/documents")).json() if d["id"] == "dolibarr-3")
    assert letter["checksum"] == tag.strip('"')

    full = await flow.get("/api/documents/dolibarr-3/view")
    assert full.status_code == 200 and full.content == whole
    assert full.headers["etag"] == tag and full.headers["accept-ranges"] == "bytes"
    assert full.headers["content-disposition"] == 'inline; filename="DOC03-1.pdf"'
    # Persönliche Datei: nie im Browser- oder Proxy-Cache (die App hält sie selbst, über die Prüfsumme).
    assert full.headers["content-type"].startswith("application/pdf") and "no-store" in full.headers["cache-control"]
    assert any(path == "/vereine/me/documents/3/file" for path, _ in fake.calls) and not any(path.endswith("/3/pdf") for path, _ in fake.calls)

    # Unverändert: 304 ohne Inhalt - geprüft hat das Modul trotzdem (es kam an).
    same = await flow.get("/api/documents/dolibarr-3/view", headers={"If-None-Match": tag})
    assert same.status_code == 304 and same.content == b"" and same.headers["etag"] == tag
    assert fake.file_requests[-1]["if_none_match"] == tag

    # Fortsetzen: ab Byte 10 - und mit If-Range nur, solange die Fassung gleich ist.
    rest = await flow.get("/api/documents/dolibarr-3/download", headers={"Range": "bytes=10-", "If-Range": tag})
    assert rest.status_code == 206 and rest.content == whole[10:]
    assert rest.headers["content-range"] == f"bytes 10-{len(whole) - 1}/{len(whole)}" and rest.headers["content-disposition"].startswith("attachment;")
    changed = await flow.get("/api/documents/dolibarr-3/view", headers={"Range": "bytes=10-", "If-Range": '"andere-fassung"'})
    assert changed.status_code == 200 and changed.content == whole, "eine geänderte Fassung kommt ganz"
    beyond = await flow.get("/api/documents/dolibarr-3/view", headers={"Range": f"bytes={len(whole) + 5}-"})
    assert beyond.status_code == 416 and beyond.headers["content-range"] == f"bytes */{len(whole)}"

    # Fremdes: 404 - auch mit der richtigen Prüfsumme kein 304.
    foreign = await flow.get("/api/documents/dolibarr-4/view", headers={"If-None-Match": "*"})
    assert foreign.status_code == 404

    # Passen die Bytes nicht zur Prüfsumme, kommt nichts davon an.
    fake.tampered_document_ids.add(2)
    assert (await flow.get("/api/documents/dolibarr-2/view")).status_code == 502


@pytest.mark.asyncio
async def test_public_documents_too_and_older_modules_keep_the_old_way(flow, fake):
    await connect(flow)
    publish_examples(fake)
    gast = await club_member(flow, "max")
    flow.act_as(gast)
    await module(flow, "1.3.2")
    public = await flow.get("/api/documents/dolibarr-1/view")
    assert public.status_code == 200 and public.content == document_pdf_bytes(1)
    assert any(path == "/vereine/documents/1/file" for path, _ in fake.calls)

    # Vereine 1.2 kennt `…/file` nicht: dieselbe Datei über JSON mit base64, ohne ETag.
    fake.calls.clear()
    await module(flow, "1.2.0")
    old = await flow.get("/api/documents/dolibarr-1/view")
    assert old.status_code == 200 and old.content == document_pdf_bytes(1) and "etag" not in old.headers
    assert [path for path, _ in fake.calls if "/documents/1/" in path] == ["/vereine/documents/1/pdf"]
