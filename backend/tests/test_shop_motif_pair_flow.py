"""Motiv als Paar (#2084): hell + dunkel in einem Schritt, mit Paar-Prüfung - durch die echte Anwendung.

- Grün: gleiches Format, passende Umrisse, Kontrast ok - beide Fassungen werden gespeichert und je Shirtfarbe
  richtig verwendet.
- Rot: anderes Seitenverhältnis (1,20 zu 1,35), gemischte Formate, bösartiges SVG - nichts wird gespeichert.
- Gelb: verschiedene Logos, Weiß in der Hell-Fassung (mit Markierung) - 409 ohne Bestätigung, mit Bestätigung
  gespeichert.
- Automatische Zuordnung erkennt vertauschte Dateien; scheitert die zweite Datei, bleibt nichts liegen.
- ``pair_stale``, wenn danach nur eine Fassung ersetzt wird; Schwellen einstellbar; Rechte; nginx.

Alle Dateien sind kleine, erfundene SVGs - keine echten Vereinslogos."""
import pathlib
import re
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from test_shop_designs_flow import BASE, design, finance, logo, stored_files  # noqa: E402
from test_shop_designs_flow import flow as designs_flow  # noqa: E402

flow = designs_flow

MOTIF = {"title": "Löwe", "placement": "front_right"}


def svg(shapes: str, *, width: int = 240, height: int = 200) -> bytes:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}">{shapes}</svg>').encode()


def lion(lines: str, word: str = "#27aae1", *, left: int = 10, width: int = 240, height: int = 200) -> bytes:
    """Ein „Logo“: oben die Linien (Farbe ``lines``), unten der Schriftzug (``word``)."""
    return svg(f'<rect x="{left}" y="10" width="100" height="80" fill="{lines}"/>'
               f'<rect x="{left}" y="110" width="100" height="80" fill="{word}"/>', width=width, height=height)


ON_BLACK = lion("#ffffff")   # für dunkle Shirts: weiße Linien
ON_WHITE = lion("#111111")   # für helle Shirts: dieselben Linien fast schwarz


async def pair(flow, dark: bytes, light: bytes, *, key: str = "loewe", route: str = "upload-pair",
               reason: str = "Paar vom Obmann", **form):
    extra = {name: str(value).lower() if isinstance(value, bool) else value for name, value in form.items()}
    fields = {"design_key": key, "reason": reason, **extra}
    return await flow.post(f"{BASE}/designs/{route}", data=fields, files={
        "file_dark": ("loewe-auf-schwarz.svg", dark, "image/svg+xml"),
        "file_light": ("loewe-auf-weiss.svg", light, "image/svg+xml")})


def checks(body: dict) -> dict:
    return {item["key"]: item for item in body["pair"]["checks"]} if "pair" in body else {
        item["key"]: item for item in body["checks"]}


# ---------------------------------------------------------------- Grün

@pytest.mark.asyncio
async def test_a_matching_pair_is_green_both_files_are_kept_and_each_shirt_gets_its_version(flow):
    from services import shop_motifs

    staff = await finance(flow)
    answer = await pair(flow, ON_BLACK, ON_WHITE, **MOTIF)
    assert answer.status_code == 200, answer.text
    body = answer.json()
    uploaded = body["uploaded_pair"]
    assert (uploaded["dark_version"], uploaded["light_version"]) == (1, 2)
    assert uploaded["pair"]["level"] == "green" and "previews" not in uploaded["pair"]
    motif = design(answer, "loewe")
    assert motif["light_mode"] == "file" and motif["light"]["state"] == "file" and motif["light"]["version"] == 2
    assert motif["latest"]["version"] == 1 and motif["latest"]["is_vector"] is True
    assert motif["light"]["latest"]["pair_of"] == 1 and motif["pair_stale"] is False
    assert motif["pair"] == {"stale": False, "dark_version": 1, "light_version": 2, "outdated": None, "hint": None}
    # Keine automatische Fassung: die eigene Datei gilt.
    assert await flow.db.shop_designs.count_documents({"origin": "auto_light"}) == 0

    pick = shop_motifs.file_for_garment
    assert (await pick(flow.db, "loewe", color="Black", color_hex="#0c0c0c"))["version"] == 1
    assert (await pick(flow.db, "loewe", color="White", color_hex="#ffffff"))["version"] == 2
    assert (await pick(flow.db, "loewe", color="Navy", color_hex="#1f2a44"))["version"] == 1

    [entry] = await flow.db.audit_logs.find({"action": "shop.design.pair"}, {"_id": 0}).to_list(5)
    assert entry["actor_id"] == staff["id"] and entry["data"]["dark_version"] == 1
    assert entry["data"]["light_version"] == 2 and entry["data"]["level"] == "green"
    assert entry["data"]["confirmed_warnings"] is False

    # Dasselbe Paar noch einmal: keine neuen Versionen.
    again = await pair(flow, ON_BLACK, ON_WHITE)
    assert again.status_code == 409 and "schon die aktuellen Fassungen (v1 und v2)" in again.json()["detail"]
    assert await flow.db.shop_designs.count_documents({}) == 2


@pytest.mark.asyncio
async def test_the_check_alone_stores_nothing_and_brings_previews(flow):
    await finance(flow)
    answer = await pair(flow, ON_BLACK, ON_WHITE, route="pair-check", key="", placement="front_right")
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["level"] == "green" and body["swapped"] is False and body["summary"] == "Das Paar passt."
    found = checks(body)
    assert found["aspect"]["level"] == "green" and found["aspect"]["dark"] == 1.2
    assert found["overlap"]["value"] == pytest.approx(1.0, abs=0.01)
    assert body["previews"]["dark"].startswith("data:image/png;base64,")
    assert body["marks"] == {"dark": None, "light": None}
    assert body["files"]["dark"]["name"] == "loewe-auf-schwarz.svg" and body["files"]["light"]["is_vector"] is True
    assert body["thresholds"] == {"pair_aspect_tolerance": 0.02, "pair_min_overlap": 0.9,
                                  "pair_contrast_share": 0.03}
    assert stored_files(flow) == [] and await flow.db.shop_designs.count_documents({}) == 0
    assert await flow.db.audit_logs.count_documents({}) == 0
    no_place = await pair(flow, ON_BLACK, ON_WHITE, route="pair-check", key="")
    assert no_place.status_code == 400 and "Platzierung" in no_place.json()["detail"]


# ---------------------------------------------------------------- Rot

@pytest.mark.asyncio
async def test_a_different_aspect_ratio_is_red_and_nothing_is_stored(flow):
    await finance(flow)
    wide = lion("#111111", width=135, height=100, left=5)
    answer = await pair(flow, lion("#ffffff", width=120, height=100, left=5), wide, **MOTIF)
    assert answer.status_code == 400, answer.text
    detail = answer.json()["detail"]
    assert "unterschiedliche Formate: 1,20 zu 1,35 – bitte gleiche Zeichenfläche verwenden" in detail
    assert answer.json()["pair"]["level"] == "red"
    assert checks(answer.json())["aspect"]["deviation"] == pytest.approx(0.125)
    assert stored_files(flow) == [] and await flow.db.shop_designs.count_documents({}) == 0
    assert await flow.db.shop_design_profiles.count_documents({}) == 0
    # Mit bestätigten Warnungen auch nicht - Rot ist Rot.
    confirmed = await pair(flow, lion("#ffffff", width=120, height=100, left=5), wide, confirm_warnings=True, **MOTIF)
    assert confirmed.status_code == 400 and await flow.db.shop_designs.count_documents({}) == 0


@pytest.mark.asyncio
async def test_mixed_formats_and_a_dangerous_svg_are_refused(flow):
    await finance(flow)
    mixed = await flow.post(f"{BASE}/designs/upload-pair", data={"design_key": "loewe", **MOTIF}, files={
        "file_dark": ("loewe.svg", ON_BLACK, "image/svg+xml"),
        "file_light": ("loewe.png", logo(1260, 1050), "image/png")})
    assert mixed.status_code == 400, mixed.text
    assert "selben Format" in mixed.json()["detail"]

    # Zwei PNG gehen auch.
    pngs = await flow.post(f"{BASE}/designs/upload-pair", data={"design_key": "png-paar", **MOTIF}, files={
        "file_dark": ("hell.png", logo(1260, 1050, fill=(255, 255, 255)), "image/png"),
        "file_light": ("dunkel.png", logo(1260, 1050, fill=(17, 17, 17)), "image/png")})
    assert pngs.status_code == 200, pngs.text
    assert pngs.json()["uploaded_pair"]["pair"]["level"] == "green"
    assert await flow.db.shop_designs.count_documents({}) == 2
    await flow.db.shop_designs.delete_many({})
    await flow.db.shop_design_profiles.delete_many({})
    for path in stored_files(flow):
        path.unlink()

    evil = ON_WHITE.replace(b"</svg>", b"<script>alert(1)</script></svg>")
    answer = await pair(flow, ON_BLACK, evil, **MOTIF)
    assert answer.status_code == 400, answer.text
    assert answer.json()["detail"].startswith("Datei für helle Shirts (loewe-auf-weiss.svg):")
    assert "Skript" in answer.json()["detail"]
    assert stored_files(flow) == [] and await flow.db.shop_designs.count_documents({}) == 0
    assert await flow.db.shop_design_profiles.count_documents({}) == 0


# ---------------------------------------------------------------- Gelb

@pytest.mark.asyncio
async def test_two_different_logos_are_yellow_and_need_a_confirmation(flow):
    await finance(flow)
    other = lion("#111111", left=130)
    answer = await pair(flow, ON_BLACK, other, **MOTIF)
    assert answer.status_code == 409, answer.text
    body = answer.json()
    assert body["pair"]["level"] == "yellow" and body["detail"].startswith("Bitte bestätigen:")
    assert "wirklich zwei Fassungen desselben Logos" in body["detail"]
    assert checks(body)["overlap"]["value"] < 0.9 and body["pair"]["previews"]["light"].startswith("data:")
    assert await flow.db.shop_designs.count_documents({}) == 0 and stored_files(flow) == []

    confirmed = await pair(flow, ON_BLACK, other, confirm_warnings=True, **MOTIF)
    assert confirmed.status_code == 200, confirmed.text
    assert any("desselben Logos" in text for text in confirmed.json()["uploaded_pair"]["warnings"])
    [entry] = await flow.db.audit_logs.find({"action": "shop.design.pair"}, {"_id": 0}).to_list(5)
    assert entry["data"]["level"] == "yellow" and entry["data"]["confirmed_warnings"] is True
    assert entry["data"]["checks"]["overlap"] == "yellow"


@pytest.mark.asyncio
async def test_white_in_the_light_version_is_yellow_and_marked(flow):
    await finance(flow)
    answer = await pair(flow, ON_BLACK, ON_BLACK.replace(b"#27aae1", b"#0a2540"), route="pair-check",
                        placement="front_right")
    assert answer.status_code == 200, answer.text
    body = answer.json()
    found = checks(body)
    assert body["level"] == "yellow" and found["contrast_light"]["level"] == "yellow"
    assert found["contrast_light"]["share"] == pytest.approx(0.5, abs=0.02)
    assert "verschwindet auf hellen Shirts" in found["contrast_light"]["text"]
    assert body["marks"]["light"].startswith("data:image/png;base64,") and body["marks"]["dark"] is None
    assert found["overlap"]["level"] == "green"

    # Schwarz in der Dunkel-Fassung ebenso.
    deep = await pair(flow, ON_WHITE, ON_WHITE, route="pair-check", placement="front_right")
    found = checks(deep.json())
    assert found["contrast_dark"]["level"] == "yellow" and deep.json()["marks"]["dark"]


@pytest.mark.asyncio
async def test_the_thresholds_are_settings(flow):
    await finance(flow)
    narrow, wide = lion("#ffffff", width=120, height=100, left=5), lion("#111111", width=135, height=100, left=5)
    answer = await flow.put(f"{BASE}/designs/motif-settings",
                            json={"pair_aspect_tolerance": 0.15, "pair_min_overlap": 0.6, "reason": "Test"})
    assert answer.status_code == 200, answer.text
    assert sorted(answer.json()["changed"]) == ["pair_aspect_tolerance", "pair_min_overlap"]
    settings = answer.json()["motif_settings"]
    assert settings["pair_aspect_tolerance"] == 0.15 and settings["defaults"]["pair_min_overlap"] == 0.9
    assert settings["limits"]["pair_contrast_share_max"] == 0.5 and settings["is_default"] is False
    checked = await pair(flow, narrow, wide, route="pair-check", placement="front_right")
    assert checks(checked.json())["aspect"]["level"] == "green"
    for body in ({"pair_min_overlap": 1.5}, {"pair_contrast_share": 0}, {"pair_aspect_tolerance": "viel"}):
        refused = await flow.put(f"{BASE}/designs/motif-settings", json=body)
        assert refused.status_code == 422, (body, refused.text)


# ---------------------------------------------------------------- Zuordnung

@pytest.mark.asyncio
async def test_swapped_files_are_recognised_and_put_right(flow):
    await finance(flow)
    checked = await pair(flow, ON_WHITE, ON_BLACK, route="pair-check", placement="front_right", auto_assign=True)
    body = checked.json()
    assert body["swapped"] is True and body["level"] == "green"
    assert body["files"]["dark"]["name"] == "loewe-auf-weiss.svg"
    without = await pair(flow, ON_WHITE, ON_BLACK, route="pair-check", placement="front_right")
    assert without.json()["swapped"] is False and without.json()["suggest_swap"] is True
    assert without.json()["level"] == "yellow"

    answer = await pair(flow, ON_WHITE, ON_BLACK, auto_assign=True, **MOTIF)
    assert answer.status_code == 200, answer.text
    motif = design(answer, "loewe")
    assert motif["latest"]["colors"] == ["#27aae1", "#ffffff"], "die weiße Fassung ist die Hauptdatei"
    assert motif["light"]["latest"]["colors"] == ["#111111", "#27aae1"]
    [entry] = await flow.db.audit_logs.find({"action": "shop.design.pair"}, {"_id": 0}).to_list(5)
    assert entry["data"]["swapped"] is True


# ---------------------------------------------------------------- Beide oder keine

@pytest.mark.asyncio
async def test_when_the_second_file_fails_nothing_is_left_behind(flow, monkeypatch):
    from services import shop_catalog

    await finance(flow)
    real = shop_catalog.add_design_version

    async def broken(db, key, **kwargs):
        if kwargs.get("details", {}).get("variant") == "light":
            raise RuntimeError("Platte voll")
        return await real(db, key, **kwargs)

    monkeypatch.setattr(shop_catalog, "add_design_version", broken)
    with pytest.raises(RuntimeError):
        await pair(flow, ON_BLACK, ON_WHITE, **{**MOTIF, "garment_colors": "Schwarz"})
    assert stored_files(flow) == [] and await flow.db.shop_designs.count_documents({}) == 0
    assert await flow.db.shop_design_profiles.count_documents({}) == 0
    assert await flow.db.shop_design_colors.count_documents({}) == 0

    # Bei einem bestehenden Motiv bleibt dessen bisheriger Stand.
    monkeypatch.setattr(shop_catalog, "add_design_version", real)
    assert (await pair(flow, ON_BLACK, ON_WHITE, **MOTIF)).status_code == 200
    files = sorted(path.name for path in stored_files(flow))
    monkeypatch.setattr(shop_catalog, "add_design_version", broken)
    with pytest.raises(RuntimeError):
        await pair(flow, lion("#fefefe"), lion("#121212"))
    assert sorted(path.name for path in stored_files(flow)) == files
    assert await flow.db.shop_designs.count_documents({}) == 2
    assert (await flow.db.shop_design_profiles.find_one({"design_key": "loewe"}))["light_pair"]["dark"] == 1
    assert await flow.db.shop_designs.count_documents({"pending": True}) == 0


@pytest.mark.asyncio
async def test_while_saving_the_old_pair_still_counts_and_half_pairs_never_show(flow, monkeypatch):
    from services import shop_catalog, shop_motifs

    await finance(flow)
    assert (await pair(flow, ON_BLACK, ON_WHITE, **MOTIF)).status_code == 200
    real = shop_catalog.add_design_version
    seen = []

    async def watched(db, key, **kwargs):
        if kwargs.get("details", {}).get("variant") == "light":
            # Die neue Hauptdatei liegt schon - gilt aber noch nicht.
            black = await shop_motifs.file_for_garment(db, key, color="Black", color_hex="#0c0c0c")
            white = await shop_motifs.file_for_garment(db, key, color="White", color_hex="#ffffff")
            view = await shop_motifs.admin_view(db)
            seen.append((black["version"], white["version"], view["designs"][0]["latest"]["version"],
                         len(view["designs"][0]["versions"])))
        return await real(db, key, **kwargs)

    monkeypatch.setattr(shop_catalog, "add_design_version", watched)
    answer = await pair(flow, lion("#fefefe"), lion("#121212"))
    assert answer.status_code == 200, answer.text
    assert seen == [(1, 2, 1, 2)]
    motif = design(answer, "loewe")
    assert (motif["latest"]["version"], motif["light"]["version"]) == (3, 4)
    assert await flow.db.shop_designs.count_documents({"pending": True}) == 0


@pytest.mark.asyncio
async def test_a_version_an_order_points_to_is_never_deleted(flow):
    from services import shop_motifs

    row = {"id": "halb", "design_key": "loewe", "version": 7, "pending": True,
           "file_ref": "shop-designs/" + "c" * 32 + ".png"}
    await flow.db.shop_designs.insert_one(dict(row))
    await flow.db.shop_order_items.insert_one({"id": "pos-1", "designs": [{"design_key": "loewe", "version": 7}]})
    await shop_motifs._remove_pending(flow.db, row)
    assert await flow.db.shop_designs.count_documents({"id": "halb"}) == 1
    await flow.db.shop_order_items.delete_many({})
    await shop_motifs._remove_pending(flow.db, row)
    assert await flow.db.shop_designs.count_documents({"id": "halb"}) == 0
    # Eine freigeschaltete Version löscht der Rückweg nie.
    await flow.db.shop_designs.insert_one({**row, "id": "fertig", "pending": False})
    await shop_motifs._remove_pending(flow.db, {**row, "id": "fertig"})
    assert await flow.db.shop_designs.count_documents({"id": "fertig"}) == 1


@pytest.mark.asyncio
async def test_one_upload_per_motif_and_one_pair_job_per_process(flow):
    from services import shop_motifs
    from services.mutation_lock import mutation_lock

    await finance(flow)
    await flow.db.mutation_locks.create_index("resource", unique=True)  # wie in Produktion (database.py)
    async with mutation_lock(flow.db, "shop:motif:loewe", wait_seconds=0.0):
        busy = await pair(flow, ON_BLACK, ON_WHITE, **MOTIF)
        single = await flow.post(f"{BASE}/designs/upload", data={"design_key": "loewe", **MOTIF},
                                 files={"file": ("l.svg", ON_BLACK, "image/svg+xml")})
    assert busy.status_code == 409 and busy.json()["detail"] == "Für dieses Motiv läuft gerade ein Upload."
    assert single.status_code == 409 and "läuft gerade ein Upload" in single.json()["detail"]
    assert await flow.db.shop_designs.count_documents({}) == 0

    async with shop_motifs._PAIR_SLOT:
        checked = await pair(flow, ON_BLACK, ON_WHITE, route="pair-check", placement="front_right")
        saved = await pair(flow, ON_BLACK, ON_WHITE, **MOTIF)
    for answer in (checked, saved):
        assert answer.status_code == 429 and "bitte gleich noch einmal" in answer.json()["detail"], answer.text
    assert (await pair(flow, ON_BLACK, ON_WHITE, **MOTIF)).status_code == 200


@pytest.mark.asyncio
async def test_the_check_rasterises_small_and_only_saving_in_full(flow, monkeypatch):
    from services import svg_safe

    await finance(flow)
    widths = []
    real = svg_safe.rasterize

    def spy(data, **kwargs):
        widths.append(kwargs.get("width_px"))
        return real(data, **kwargs)

    monkeypatch.setattr(svg_safe, "rasterize", spy)
    checked = await pair(flow, ON_BLACK, ON_WHITE, route="pair-check", placement="back")
    assert checked.status_code == 200, checked.text
    assert widths and max(widths) <= 512, widths
    # Die Passform folgt aus der viewBox: Druckbreite × DPI.
    assert checked.json()["files"]["dark"]["width_px"] == 3600 and checks(checked.json())["aspect"]["level"] == "green"
    widths.clear()
    assert (await pair(flow, ON_BLACK, ON_WHITE, **MOTIF)).status_code == 200
    assert max(widths) == 1260, "erst beim Speichern in voller Druckbreite"


@pytest.mark.asyncio
async def test_the_same_pair_comes_back_after_going_automatic(flow):
    await finance(flow)
    assert (await pair(flow, ON_BLACK, ON_WHITE, **MOTIF)).status_code == 200
    back = await flow.post(f"{BASE}/designs/loewe/light-auto", json={"reason": "Doch automatisch"})
    assert design(back, "loewe")["light"]["state"] == "auto"
    again = await pair(flow, ON_BLACK, ON_WHITE, reason="Doch das Paar")
    assert again.status_code == 200, again.text
    motif = design(again, "loewe")
    assert motif["light_mode"] == "file" and motif["light"]["version"] == 2 and motif["latest"]["version"] == 1
    assert again.json()["uploaded_pair"]["dark_version"] == 1
    assert await flow.db.audit_logs.count_documents({"action": "shop.design.pair"}) == 2
    twice = await pair(flow, ON_BLACK, ON_WHITE)
    assert twice.status_code == 409 and "schon die aktuellen Fassungen" in twice.json()["detail"]


@pytest.mark.asyncio
async def test_without_transparency_the_assignment_is_left_alone_and_flagged(flow):
    await finance(flow)
    dim = logo(1260, 1050, mode="RGB", fill=(30, 30, 30))
    bright = logo(1260, 1050, mode="RGB", fill=(250, 250, 250))
    answer = await flow.post(f"{BASE}/designs/pair-check", data={"placement": "front_right", "auto_assign": "true"},
                             files={"file_dark": ("a.png", dim, "image/png"),
                                    "file_light": ("b.png", bright, "image/png")})
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["swapped"] is False and body["assign_uncertain"] is True
    assert body["files"]["dark"]["name"] == "a.png"
    clear = await pair(flow, ON_WHITE, ON_BLACK, route="pair-check", placement="front_right", auto_assign=True)
    assert clear.json()["swapped"] is True and clear.json()["assign_uncertain"] is False


# ---------------------------------------------------------------- Paar veraltet

@pytest.mark.asyncio
async def test_replacing_only_one_version_marks_the_pair_stale(flow):
    await finance(flow)
    assert (await pair(flow, ON_BLACK, ON_WHITE, **MOTIF)).status_code == 200
    single = await flow.post(f"{BASE}/designs/upload", data={"design_key": "loewe", "reason": "nur hell"},
                             files={"file": ("neu.svg", lion("#ffffff", "#1c8fc2"), "image/svg+xml")})
    assert single.status_code == 200, single.text
    motif = design(single, "loewe")
    assert motif["pair_stale"] is True and motif["latest"]["version"] == 3
    assert motif["pair"]["dark_version"] == 3 and motif["pair"]["light_version"] == 2
    assert motif["pair"]["outdated"] == "light"
    assert "noch Version 2 – auch ersetzen?" in motif["pair"]["hint"]
    assert any("auch ersetzen?" in text for text in single.json()["uploaded"]["warnings"])

    # Eine zweite neue Hauptdatei ändert daran nichts; erst die andere Fassung macht das Paar wieder ganz.
    again = await flow.post(f"{BASE}/designs/upload", data={"design_key": "loewe"},
                            files={"file": ("neu2.svg", lion("#ffffff", "#1c8fc3"), "image/svg+xml")})
    assert design(again, "loewe")["pair_stale"] is True
    light = await flow.post(f"{BASE}/designs/upload", data={"design_key": "loewe", "variant": "light"},
                            files={"file": ("neu-hell.svg", lion("#111111", "#1c8fc3"), "image/svg+xml")})
    assert light.status_code == 200, light.text
    assert design(light, "loewe")["pair_stale"] is False

    # Und anders herum: nur die helle ersetzt.
    lighter = await flow.post(f"{BASE}/designs/upload", data={"design_key": "loewe", "variant": "light"},
                              files={"file": ("hell3.svg", lion("#222222", "#1c8fc3"), "image/svg+xml")})
    motif = design(lighter, "loewe")
    assert motif["pair_stale"] is True and motif["pair"]["outdated"] == "dark"
    # Zurück auf automatisch: kein eigenes Paar mehr, kein Hinweis.
    back = await flow.post(f"{BASE}/designs/loewe/light-auto", json={"reason": "Doch automatisch"})
    assert design(back, "loewe")["pair_stale"] is False


# ---------------------------------------------------------------- Rechte, Grenzen, nginx

@pytest.mark.asyncio
async def test_only_finance_with_a_second_factor_may_check_or_upload_a_pair(flow):
    staff = await finance(flow)
    for role in ("player", "moderator", "tournament_admin"):
        flow.act_as(await flow.add_user(role=role))
        for route in ("upload-pair", "pair-check"):
            answer = await pair(flow, ON_BLACK, ON_WHITE, route=route, **MOTIF)
            assert answer.status_code == 403, (role, route, answer.text)
    flow.act_as({**staff, "auth_mfa_verified": False})
    answer = await pair(flow, ON_BLACK, ON_WHITE, **MOTIF)
    assert answer.status_code == 403 and "Zwei-Faktor" in answer.json()["detail"]
    flow.act_as(None)
    assert (await pair(flow, ON_BLACK, ON_WHITE, route="pair-check", **MOTIF)).status_code == 401
    assert await flow.db.shop_designs.count_documents({}) == 0 and stored_files(flow) == []


@pytest.mark.asyncio
async def test_an_oversized_pair_is_refused_at_the_door(flow, monkeypatch):
    from services import shop_designs

    await finance(flow)
    monkeypatch.setattr(shop_designs, "MAX_BYTES", 1024)
    monkeypatch.setattr(shop_designs, "MAX_UPLOAD_MB", 1)
    big = ON_BLACK.replace(b"</svg>", b"<!--" + b"x" * 300_000 + b"--></svg>")
    for route in ("upload-pair", "pair-check"):
        answer = await pair(flow, big, ON_WHITE, route=route, **MOTIF)
        assert answer.status_code == 413, (route, answer.text)
    assert stored_files(flow) == []


def test_nginx_caps_the_pair_routes_with_their_own_block():
    from services import shop_designs

    nginx = (pathlib.Path(__file__).resolve().parents[2] / "frontend" / "nginx.conf").read_text(encoding="utf-8")
    opener = "location ~ ^/api/admin/shop/designs/(?:upload-pair|pair-check)$ {"
    start = nginx.index(opener)
    block = nginx[start:nginx.index("}", start)]
    limit = re.search(r"client_max_body_size (\d+)m;", block)
    assert limit and 2 * shop_designs.MAX_UPLOAD_MB < int(limit.group(1)) <= 2 * shop_designs.MAX_UPLOAD_MB + 2
    assert "proxy_pass http://backend:8001;" in block
    # Der Block steht in „location ^~ /api/“ - sonst griffe er gar nicht - und hinter dem einzelnen Upload.
    assert nginx.index("location ^~ /api/ {") < start
    assert nginx.index("location = /api/admin/shop/designs/upload {") < start
    assert not re.search(r"location /api/[^\s]*/ \{", nginx)
