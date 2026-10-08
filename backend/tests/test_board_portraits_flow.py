"""Vorstand (#1252, #1332): freigestellte Fotos werden beim Hochladen erkannt (auch ältere einmal von der Platte), Rollen
stehen in der Form der Person, offene Funktionen tragen einen Satz zum Aufwand, nicht freigegebene Namen bleiben weg, und
die Statuten stehen je nach Schalter für alle auf „Vorstand“ - aus Dolibarr nur freigegeben, sonst aus den Dokumenten."""
import io
import pathlib
import sys

import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from routes import document_routes, upload_routes  # noqa: E402
from services import club_facts, dolibarr_client, media_scan, photo_cutout  # noqa: E402
from services.dolibarr_client import DolibarrClient, load_settings  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    public = tmp_path / "public"
    public.mkdir()
    monkeypatch.setattr(upload_routes, "PUBLIC_UPLOAD_DIR", public)
    monkeypatch.setattr(photo_cutout, "PUBLIC_UPLOAD_DIR", public)
    monkeypatch.setattr(document_routes, "PRIVATE_DOC_DIR", tmp_path / "docs")
    monkeypatch.setattr(media_scan, "auto_process", False)
    photo_cutout._DISK_CACHE.clear()
    instance, shutdown = make_flow()
    import server
    monkeypatch.setattr(server, "public_upload_dir", public)
    instance.public = public
    instance.docs = tmp_path / "docs"
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fake(monkeypatch):
    instance = FakeDolibarr()
    monkeypatch.setattr(dolibarr_client, "_transport", instance.transport())
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    return instance


def portrait(transparent: bool) -> bytes:
    """Kopf und Schultern: freigestellt (durchsichtiger Hintergrund) oder mit grauem Hintergrund."""
    img = Image.new("RGBA", (60, 80), (0, 0, 0, 0) if transparent else (90, 90, 90, 255))
    for x in range(15, 45):
        for y in range(10, 80):
            img.putpixel((x, y), (210, 170, 140, 255))
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.mark.asyncio
async def test_upload_recognises_cutout_portraits(flow):
    flow.act_as(await flow.add_user(role="club_admin", name="vorstand"))
    cut = await flow.post("/api/uploads/image", files={"file": ("leo.png", portrait(True), "image/png")})
    assert cut.status_code == 200, cut.text
    assert cut.json()["cutout"] is True
    plain = await flow.post("/api/uploads/image", files={"file": ("mira.png", portrait(False), "image/png")})
    assert plain.json()["cutout"] is False
    stored = {row["url"]: row["cutout"] async for row in flow.db.media_uploads.find({}, {"_id": 0, "url": 1, "cutout": 1})}
    assert stored == {cut.json()["url"]: True, plain.json()["url"]: False}
    # Ein JPG hat keine Deckkraft-Ebene - nie freigestellt.
    buffer = io.BytesIO()
    Image.new("RGB", (40, 40), (0, 0, 0)).save(buffer, format="JPEG")
    assert photo_cutout.is_cutout(Image.open(io.BytesIO(buffer.getvalue()))) is False


@pytest.mark.asyncio
async def test_board_marks_cutout_photos_genders_titles_and_carries_vacancy_texts(flow):
    # Ein älteres Foto ohne Vermerk wird einmal von der Platte geprüft und dann vermerkt; fremde Adressen nie.
    (flow.public / "alt.png").write_bytes(portrait(True))
    await flow.db.media_uploads.insert_one({"id": "m-alt", "url": "/api/static/uploads/alt.png", "filename": "alt.png"})
    await flow.db.media_uploads.insert_one({"id": "m-neu", "url": "/api/static/uploads/neu.png", "filename": "neu.png", "cutout": False})
    await flow.db.club_member_profiles.insert_many([
        {"id": "cp-leo", "slug": "leoloewe", "display_name": "Leo Beispiel", "gamertag": "LeoLöwe", "real_name": "Leo Beispiel", "gender": "male", "photo_url": "/api/static/uploads/alt.png", "is_active": True},
        {"id": "cp-mira", "slug": "miramaus", "display_name": "Mira Muster", "gamertag": "MiraMaus", "real_name": "Mira Muster", "gender": "female", "photo_url": "/api/static/uploads/neu.png", "is_active": True},
        {"id": "cp-sina", "slug": "sternnebel", "display_name": "Sina Muster", "gamertag": "SternNebel", "gender": "female", "photo_url": "https://example.test/fremd.png", "is_active": True},
    ])
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    board = (await flow.get("/api/board?manual=true")).json()
    ids = {p["slug"]: p["id"] for p in board}
    reply = await flow.patch(f"/api/board/{ids['obmann']}", json={"user_id": "cp-leo"})
    assert reply.status_code == 200
    reply = await flow.patch(f"/api/board/{ids['kassier']}", json={"user_id": "cp-mira", "deputy_user_id": "cp-sina"})
    assert reply.status_code == 200
    saved = await flow.put("/api/board/vacancy-texts", json={"texts": {"schriftfuehrer": "  Zwei Stunden im Monat,\n Einschulung inklusive. ", "obmann-stv": "Einmal im Monat Sitzung."}})
    assert saved.status_code == 200 and saved.json()["texts"]["schriftfuehrer"] == "Zwei Stunden im Monat, Einschulung inklusive."

    flow.act_as(None)
    board = {p["slug"]: p for p in (await flow.get("/api/board?active_only=true")).json()}
    obmann, kassier, schrift = board["obmann"], board["kassier"], board["schriftfuehrer"]
    assert obmann["user"]["photo_cutout"] is True and obmann["display_title"] == "Obmann" and obmann["neutral_title"] == "Obmann/Obfrau"
    assert kassier["user"]["photo_cutout"] is False and kassier["display_title"] == "Kassierin" and kassier["neutral_title"] == "Kassier:in"
    assert kassier["deputy_user"]["photo_cutout"] is False and kassier["deputy_title"] == "Kassierin"
    assert schrift["neutral_title"] == "Schriftführer:in", "für „Wir suchen …“ die kurze Form"
    assert schrift["user"] is None and schrift["vacancy_text"] == "Zwei Stunden im Monat, Einschulung inklusive."
    assert obmann["deputy_vacancy_text"] == "Einmal im Monat Sitzung." and kassier["deputy_vacancy_text"] == ""
    assert (await flow.db.media_uploads.find_one({"id": "m-alt"}))["cutout"] is True, "der Vermerk wird nachgetragen"

    # Ein leerer Satz löscht; nur die Vereinsverwaltung darf schreiben.
    flow.act_as(admin)
    reply = await flow.put("/api/board/vacancy-texts", json={"texts": {"obmann-stv": " "}})
    assert reply.json()["texts"] == {"schriftfuehrer": "Zwei Stunden im Monat, Einschulung inklusive."}
    flow.act_as(await flow.add_user(role="player"))
    reply = await flow.put("/api/board/vacancy-texts", json={"texts": {"obmann": "x"}})
    assert reply.status_code == 403


async def connect(flow):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": "live", "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY), "instance": "verein", "entity": 1,
    }}, upsert=True)


@pytest.mark.asyncio
async def test_dolibarr_board_withholds_names_and_uses_the_form_of_the_person(flow, fake):
    await connect(flow)
    fake.board = [
        {"code": "obmann", "label": "Obmann/Obfrau", "board": True, "represents": True, "auditor": False, "holders": [{"name": "Olga Obfrau", "since": "2024-04-01"}]},
        {"code": "kassier", "label": "Kassier:in", "board": True, "represents": False, "auditor": False, "holders": [{"name": None, "since": "2024-04-01"}]},
        {"code": "jugend", "label": "Jugendreferent:in", "board": True, "represents": False, "auditor": False, "holders": []},
    ]
    settings = await load_settings(flow.db)
    reply = await club_facts.refresh(flow.db, settings, DolibarrClient(settings))
    assert reply["ok"] is True
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"id": "branding", "legal_from_dolibarr": True}}, upsert=True)
    olga = await flow.add_user(role="player", name="olga")
    await flow.db.memberships.insert_one({"id": "m-olga", "user_id": olga["id"], "member_status": "active", "source": "dolibarr", "dolibarr": {"functions": [{"code": "obmann", "label": "Obmann/Obfrau"}]}})
    await flow.db.club_member_profiles.insert_one({"id": "cp-olga", "user_id": olga["id"], "slug": "olga", "display_name": "Olga Obfrau", "gamertag": "OlgaGG", "gender": "female", "is_active": True})
    await flow.db.settings.insert_one({"id": "board_vacancies", "texts": {"jugend": "Für Jugendliche da sein."}})

    board = {p["slug"]: p for p in (await flow.get("/api/board?active_only=true")).json()}
    assert board["obmann"]["display_title"] == "Obfrau" and board["obmann"]["neutral_title"] == "Obmann/Obfrau"
    assert board["obmann"]["user"]["real_name"] == "Olga Obfrau" and board["obmann"]["user"]["photo_cutout"] is False
    # Nicht freigegeben: kein Name, keine Person - und die Rolle bleibt neutral.
    assert board["kassier"]["user"] is None and board["kassier"]["name_withheld"] is True and board["kassier"]["display_title"] == "Kassier:in"
    assert board["jugend"]["vacant"] is True and board["jugend"]["vacancy_text"] == "Für Jugendliche da sein."


@pytest.mark.asyncio
async def test_statutes_are_public_by_default_from_documents_or_only_what_dolibarr_releases(flow, fake):
    # Ohne Dolibarr und ohne Dokument: nichts; mit Dokument (auch „nur Mitglieder“) für alle - interne nie.
    assert (await flow.get("/api/board/statutes")).json() == {"available": False, "reason": "no_document"}
    flow.docs.mkdir()
    (flow.docs / "statuten.pdf").write_bytes(b"%PDF-1.7 statuten")
    await flow.db.documents.insert_many([
        {"id": "doc-intern", "title": "Entwurf", "category": "statutes", "visibility": "internal", "storage_key": "entwurf.pdf", "created_at": "2026-09-01T10:00:00+00:00"},
        {"id": "doc-statuten", "title": "Statuten 2026", "category": "statutes", "visibility": "members", "storage_key": "statuten.pdf", "mime": "application/pdf",
         "original_filename": "statuten.pdf", "created_at": "2026-01-10T10:00:00+00:00"},
    ])
    public = (await flow.get("/api/board/statutes")).json()
    assert public["available"] is True and public["source"] == "documents" and public["current"]["title"] == "Statuten 2026"
    assert public["pdf_url"] == "/api/board/statutes/document"
    pdf = await flow.get("/api/board/statutes/document")
    assert pdf.status_code == 200 and pdf.content == b"%PDF-1.7 statuten" and pdf.headers["content-type"].startswith("application/pdf")

    # Schalter aus: wie früher nur im Mitgliederbereich - auch die Datei.
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"id": "branding", "statutes_public": False}}, upsert=True)
    assert (await flow.get("/api/board/statutes")).json() == {"available": False, "reason": "members_only"}
    assert (await flow.get("/api/board/statutes/document")).status_code == 404

    # Mit Dolibarr: die freigegebene Fassung aus dem Vereinsmodul, das Dokument zählt nicht.
    await connect(flow)
    settings = await load_settings(flow.db)
    await club_facts.refresh(flow.db, settings, DolibarrClient(settings))
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"legal_from_dolibarr": True, "statutes_public": True}})
    released = (await flow.get("/api/board/statutes")).json()
    assert released["available"] is True and released["source"] == "dolibarr" and released["pdf_url"] == f"/api/board/statutes/{released['current']['id']}/pdf"
    assert (await flow.get("/api/board/statutes/document")).status_code == 404
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"statutes_public": False}})
    assert (await flow.get(f"/api/board/statutes/{released['current']['id']}/pdf")).status_code == 404
    # Im Modul nicht freigegeben: es erscheint nichts.
    fake.statutes_public = False
    await club_facts.refresh(flow.db, settings, DolibarrClient(settings))
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"statutes_public": True}})
    assert (await flow.get("/api/board/statutes")).json() == {"available": False, "reason": "not_published"}

    # Der Schalter liegt unter Dolibarr → Funktionen und sagt, was gerade erscheint.
    flow.act_as(await flow.add_user(role="superadmin", name="admin"))
    rows = {row["key"]: row for row in (await flow.get("/api/admin/dolibarr/status")).json()["features"]}
    assert rows["statutes"]["switch"] == {"on": True} and rows["statutes"]["enabled"] is False and "nicht für die Öffentlichkeit freigegeben" in rows["statutes"]["state"]
    reply = await flow.put("/api/admin/dolibarr/features", json={"key": "statutes", "on": False})
    assert reply.status_code == 200
    assert (await flow.db.settings.find_one({"id": "branding"}))["statutes_public"] is False


@pytest.mark.asyncio
async def test_contact_form_knows_the_volunteer_topic(flow):
    topics = {row["value"]: row["label"] for row in (await flow.get("/api/contact/topics")).json()}
    assert topics["volunteer"] == "Mitarbeit im Verein"
    sent = await flow.post("/api/contact/submit", json={"name": "Nora Neu", "email": "nora@beispielverein.at", "topic": "volunteer",
                                                       "subject": "Interesse: Jugendreferentin", "message": "Ich hätte Zeit.", "accept_privacy": True})
    assert sent.status_code == 200, sent.text
