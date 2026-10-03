"""Logo und Banner der Partner aus dem Vereinsmodul (#880, Vereine 1.9.0): der Sponsoren-Abgleich holt je Partner die
hinterlegten Bilder; Website und App zeigen die Fassung für dunklen Hintergrund (sonst hell, sonst den Upload), Mails
und PDFs die für hellen (sonst den Upload, sonst dunkel). Geladen wird nur bei neuer Prüfsumme, gespeichert nur, was
zur Prüfsumme passt; was in Dolibarr verschwindet, verschwindet auch auf der Website. Ein altes Modul wird nicht gefragt."""
import hashlib
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import dolibarr_client, sponsor_images  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402

DARK, LIGHT, BANNER = b"\x89PNG-dunkles-logo", b"\x89PNG-helles-logo", b"\xff\xd8JPEG-banner-dunkel"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fake(monkeypatch, tmp_path):
    instance = FakeDolibarr()
    monkeypatch.setattr(dolibarr_client, "_transport", instance.transport())
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    monkeypatch.setattr(sponsor_images, "UPLOAD_DIR", tmp_path)
    instance.uploads = tmp_path
    return instance


async def setup(flow, fake, module_version="1.9.0"):
    """Alpha (Sponsor Gold, mit Upload-Logo von Hand) und Gamma (Partner) - in Dolibarr mit Bildern."""
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": "live", "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY), "instance": "verein", "entity": 1,
    }}, upsert=True)
    await flow.db.settings.update_one({"id": "dolibarr_sync_state"}, {"$set": {"id": "dolibarr_sync_state", "module_version": module_version}}, upsert=True)
    sponsor = fake.add_category("Sponsor")
    gold = fake.add_category("Gold", parent=int(sponsor["id"]))
    partner = fake.add_category("Partner")
    alpha = fake.add_thirdparty("Alpha Energy", url="https://alpha.test")
    gamma = fake.add_thirdparty("Gamma Verein", url="https://gamma.test")
    fake.categorize(alpha["id"], int(sponsor["id"]), int(gold["id"]))
    fake.categorize(gamma["id"], int(partner["id"]))
    fake.add_partner(alpha["id"], "Alpha Energy", url="https://alpha.test", images={
        ("logo", "dark"): (DARK, "image/png"), ("logo", "light"): (LIGHT, "image/png"), ("banner", "dark"): (BANNER, "image/jpeg")})
    fake.add_partner(gamma["id"], "Gamma Verein", categories=((8, "Partner"),), images={("logo", "light"): (LIGHT + b"-gamma", "image/png")})
    await flow.db.sponsors.insert_one({"id": "s-alpha", "name": "Alpha Energy", "tier": "gold", "logo_url": "/uploads/alpha.png", "is_active": True,
                                       "show_in_emails": True, "show_on_pdf": True})
    admin = await flow.add_user(role="club_admin")
    flow.act_as(admin)
    switched = await flow.patch("/api/admin/dolibarr/sponsors", json={"from_dolibarr": True})
    assert switched.status_code == 200, switched.text
    return alpha, gamma, switched.json()["result"]


def files(fake) -> list[str]:
    return sorted(path.name for path in fake.uploads.iterdir())


async def public_alpha(flow) -> dict:
    return next(s for s in (await flow.get("/api/sponsors")).json() if s["name"] == "Alpha Energy")


@pytest.mark.asyncio
async def test_each_surface_gets_its_version_and_the_raw_data_stays_inside(flow, fake):
    alpha, gamma, result = await setup(flow, fake)
    assert result["images"] == {"partners": 2, "fetched": 4, "kept": 0, "removed": 0, "failed": 0}
    assert files(fake) == sorted(f"dolibarr-partner-{pid}-{kind}-{variant}-{sha}.{ext}" for pid, kind, variant, sha, ext in (
        (alpha["id"], "logo", "dark", hashlib.sha256(DARK).hexdigest()[:12], "png"),
        (alpha["id"], "logo", "light", hashlib.sha256(LIGHT).hexdigest()[:12], "png"),
        (alpha["id"], "banner", "dark", hashlib.sha256(BANNER).hexdigest()[:12], "jpg"),
        (gamma["id"], "logo", "light", hashlib.sha256(LIGHT + b"-gamma").hexdigest()[:12], "png"),
    ))

    # Website und App: dunkel vor hell vor Upload; Banner ebenso. Die Rohdaten aus Dolibarr gehen nicht hinaus.
    shown = await public_alpha(flow)
    assert shown["logo_url"].startswith(f"/api/static/uploads/dolibarr-partner-{alpha['id']}-logo-dark-") and shown["logo_source"] == "dolibarr-dark"
    assert shown["banner_url"].startswith(f"/api/static/uploads/dolibarr-partner-{alpha['id']}-banner-dark-")
    assert "dolibarr_images" not in shown and "dolibarr_id" not in shown
    gamma_public = next(p for p in (await flow.get("/api/partners")).json() if p["name"] == "Gamma Verein")
    assert "-logo-light-" in gamma_public["logo_url"] and "banner_url" not in gamma_public, "nur hell da: dann hell"

    # Mails und PDFs sind hell: die helle Fassung.
    from email_service import _email_sponsor_block
    from routes.export_routes import _pdf_sponsors
    block = await _email_sponsor_block()
    assert f"dolibarr-partner-{alpha['id']}-logo-light-" in block and "-logo-dark-" not in block
    pdf = await _pdf_sponsors(flow.db)
    assert "-logo-light-" in pdf[0]["logo_url"]

    # Die Verwaltung sieht, welche Fassungen da sind und was gezeigt wird; ihr Upload bleibt erhalten.
    admin_row = next(s for s in (await flow.get("/api/sponsors/admin")).json() if s["name"] == "Alpha Energy")
    assert admin_row["logo_url"] == "/uploads/alpha.png"
    assert admin_row["dolibarr_image_summary"] == {"logo": {"variants": ["dark", "light"], "shown": "dolibarr-dark"},
                                                   "banner": {"variants": ["dark"], "shown": "dolibarr-dark"}}
    view = (await flow.get("/api/admin/dolibarr/sponsors")).json()
    assert view["last_run"]["images"]["fetched"] == 4


@pytest.mark.asyncio
async def test_only_new_checksums_are_fetched_and_removals_fall_back_to_the_upload(flow, fake):
    alpha, _gamma, _result = await setup(flow, fake)
    assert len(fake.image_requests) == 4

    again = (await flow.post("/api/admin/dolibarr/sponsors/refresh")).json()
    assert again["images"]["kept"] == 4 and again["images"]["fetched"] == 0 and len(fake.image_requests) == 4, "unverändert: kein Abruf"

    old_dark = (await public_alpha(flow))["logo_url"].rsplit("/", 1)[-1]
    fake.set_partner_image(alpha["id"], "logo", "dark", DARK + b"-neu")
    changed = (await flow.post("/api/admin/dolibarr/sponsors/refresh")).json()
    assert changed["images"]["fetched"] == 1 and len(fake.image_requests) == 5
    new_dark = (await public_alpha(flow))["logo_url"].rsplit("/", 1)[-1]
    assert new_dark != old_dark and new_dark in files(fake) and old_dark not in files(fake), "neue Fassung da, alte Datei weg"

    # In Dolibarr entfernt: auf der Website weg - erst der Banner, dann die Logos bis zurück zum Upload.
    fake.set_partner_image(alpha["id"], "banner", "dark", None)
    await flow.post("/api/admin/dolibarr/sponsors/refresh")
    assert "banner_url" not in await public_alpha(flow) and not any("-banner-" in name for name in files(fake))
    fake.set_partner_image(alpha["id"], "logo", "dark", None)
    await flow.post("/api/admin/dolibarr/sponsors/refresh")
    assert "-logo-light-" in (await public_alpha(flow))["logo_url"]
    fake.set_partner_image(alpha["id"], "logo", "light", None)
    await flow.post("/api/admin/dolibarr/sponsors/refresh")
    shown = await public_alpha(flow)
    assert shown["logo_url"] == "/uploads/alpha.png" and "logo_source" not in shown
    assert "dolibarr_images" not in await flow.db.sponsors.find_one({"name": "Alpha Energy"}, {"_id": 0})


@pytest.mark.asyncio
async def test_a_tampered_file_is_never_stored_an_outage_keeps_the_images_and_an_old_module_is_not_asked(flow, fake):
    alpha, _gamma, _result = await setup(flow, fake)
    kept_before = files(fake)

    # Bytes passen nicht zur Prüfsumme: nicht gespeichert, die bisherige Fassung bleibt.
    fake.set_partner_image(alpha["id"], "logo", "dark", DARK + b"-zweite-fassung")
    fake.tampered_partner_images.add((alpha["id"], "logo", "dark"))
    tampered = (await flow.post("/api/admin/dolibarr/sponsors/refresh")).json()
    assert tampered["images"]["failed"] == 1 and files(fake) == kept_before
    assert (await public_alpha(flow))["logo_source"] == "dolibarr-dark", "die alte, geprüfte Fassung bleibt stehen"

    # Die Partnerliste fällt aus: nichts ändert sich, der Fehler steht im Lauf.
    fake.tampered_partner_images.clear()
    fake.fail_with, fake.fail_paths = 503, {"/vereine/partners"}
    outage = (await flow.post("/api/admin/dolibarr/sponsors/refresh")).json()
    assert outage["images"] == {"error": "unavailable"} and files(fake) == kept_before
    fake.fail_with, fake.fail_paths = None, set()

    # Vereine vor 1.9.0 kennt die Partnerbilder nicht: kein Aufruf, die Bilder bleiben, wie sie sind.
    await flow.db.settings.update_one({"id": "dolibarr_sync_state"}, {"$set": {"module_version": "1.8.0"}})
    calls_before = sum(1 for path, _ in fake.calls if path.startswith("/vereine/partners"))
    old = (await flow.post("/api/admin/dolibarr/sponsors/refresh")).json()
    assert old["images"] == {"skipped": "module_version"}
    assert sum(1 for path, _ in fake.calls if path.startswith("/vereine/partners")) == calls_before


def test_pick_follows_the_background():
    doc = {"logo_url": "/uploads/eigen.png", "dolibarr_images": {"logo": {"dark": {"url": "/d.png"}, "light": {"url": "/h.png"}}}}
    assert sponsor_images.pick(doc, "logo", "dark") == ("/d.png", "dolibarr-dark")
    assert sponsor_images.pick(doc, "logo", "light") == ("/h.png", "dolibarr-light")
    only_dark = {"logo_url": "/uploads/eigen.png", "dolibarr_images": {"logo": {"dark": {"url": "/d.png"}}}}
    assert sponsor_images.pick(only_dark, "logo", "light") == ("/uploads/eigen.png", "upload"), "hell: lieber das Upload als ein weißes Logo"
    assert sponsor_images.pick({"dolibarr_images": {"logo": {"dark": {"url": "/d.png"}}}}, "logo", "light") == ("/d.png", "dolibarr-dark")
    assert sponsor_images.pick({}, "banner") == (None, "")
