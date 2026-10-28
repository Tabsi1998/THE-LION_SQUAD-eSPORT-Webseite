"""Bestand bleibt gleich (#2142): ein Produkt ohne die neuen Angaben (Schrift, Kontur, fester Text, Trikot-Vorlage)
liefert Byte für Byte dieselben Grund- und Bestelldateien wie vor #2142 - gleicher ``layout_hash`` (sonst würden alle
erzeugten Dateien „veraltet“), gleicher ``rules_hash`` der Gamertag-Datei und dieselben Pixel.

Die Prüfsummen unten sind vor #2142 mit genau diesem Ablauf gerechnet. Die Pixel-Prüfsumme nimmt die dekodierten Pixel
(Größe, Modus, DPI, RGBA) statt der PNG-Bytes - so hängt sie nicht an der zlib-Fassung der Plattform. Nur synthetische
Bilder und erfundene Namen."""
import hashlib
import pathlib
import sys

import pytest
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services import shop_catalog, shop_designs, shop_orders, shop_print_files, shop_products  # noqa: E402
from shop_testdata import publish_unchecked  # noqa: E402
from test_shop_allover_unit import background, upload  # noqa: E402
from test_shop_products_unit import (  # noqa: E402,F401 - Fixtures und Helfer der Produktverwaltung
    BACK, BILLING, BY, LION, SHIPPING, WHITE_M, configured, db, design_dir, fake, provider, variant_for)

NAME = {"kind": "gamertag", "preset": "text_opposite", "text_height_cm": 1.0, "max_width_cm": 6.0}
NUMBER = {"kind": "member_number", "preset": "text_back_top"}
ALLOVER_NAME = {"kind": "gamertag", "preset": "text_back_top"}

# Vor #2142 gerechnet (Stand origin/main mit #2141).
GOLDEN: dict[str, str] = {
    "layout back|Black": "d29be7d4aa46a136deef45b7601935585d77db58db2d0fd6bde62483effba84e",
    "base back|Black": "d8fc90871086809e0873219be645c15bf0a6ef010112a712a7f0e8024e628b19",
    "layout back|White": "d29be7d4aa46a136deef45b7601935585d77db58db2d0fd6bde62483effba84e",
    "base back|White": "d8fc90871086809e0873219be645c15bf0a6ef010112a712a7f0e8024e628b19",
    "layout front|Black": "c5c659fd64db560fb13f271ce78d290ed8373374e8c6b0a952ac72f528b328c8",
    "base front|Black": "f84cff8a7d5627d76534636da369b4463ebd8c10b093320b8c92a773f9b26575",
    "layout front|White": "420bd19fadf1c50f8d032a0dcca9830daae0bd5e741af7d0aca168cd1749698a",
    "base front|White": "1b2a4c1dcb4f3b0bc73f279ed7bff6bea465b512705b092a0251f2865496fab7",
    "order back base": "d8fc90871086809e0873219be645c15bf0a6ef010112a712a7f0e8024e628b19",
    "order front personal": "7ace80b58c2a99dccd949e2dddb0847cb97f67120db1c142992057c912ccc932",
    "gamertag front rules": "8259b1fcbafa1b1289aed2778dda528337bcf7dfb79aaf52e7eb376fd0ea8525",
    "gamertag front pixels": "758b90b3ec2bb1e5bca4918b17c7619558c3beb1cc686c7ed9608036665af3bc",
    "allover layout back|White": "305949e9ddbca5ed710f0fd0989ea4e690fa0c237f1537f12f0ba7210c6bc113",
    "allover base back|White": "4a4d4d7afded836e9645e34f7ad5f69683a5788d5959426cfaf655ca6939bc07",
}

def pixels(path) -> str:
    with Image.open(path) as img:
        img.load()
        head = f"{img.mode}|{img.size}|{img.info.get('dpi')}|".encode()
        return hashlib.sha256(head + img.convert("RGBA").tobytes()).hexdigest()


async def plans(db, product_id: str) -> dict:
    product = await shop_catalog.get_product(db, product_id)
    found, _context = await shop_print_files.plans_for(db, product)
    return {f"{row['key']}|{color}": plan for row, plan, color, _ids in found if plan is not None}


@pytest.mark.asyncio
async def test_existing_products_keep_layout_hash_rules_hash_and_pixels(db, provider):
    seen: dict[str, str] = {}
    # 1. Motiv und Position: Löwe und Gamertag mit eigener Größe vorne, Rückenmotiv und Vereinsnummer hinten.
    product = await configured(db, provider, generate=False, personalization="both")
    await shop_products.set_layout(db, product["id"], [{"key": "front", "layers": [LION, NAME]},
                                                       {"key": "back", "layers": [BACK, NUMBER]}],
                                   included_placement="front", **BY)
    await shop_products.generate_print_files(db, product["id"], **BY)
    for key, plan in sorted((await plans(db, product["id"])).items()):
        seen[f"layout {key}"] = plan.layout_hash
        base = await shop_print_files.current_base(db, product["id"], plan)
        seen[f"base {key}"] = pixels(shop_designs._path_of(base["file_ref"]))
    await publish_unchecked(db, product["id"])
    white = await variant_for(db, product["id"], WHITE_M)
    order, _ = await shop_orders.place_order(
        db, idempotency_key="bestand-2142", lines=[{"variant_id": white["id"], "quantity": 1, "gamertag": "Testlöwe"}],
        user_id="konto-1", buyer_kind="member", shipping_estimate_cents=490, billing_address=dict(BILLING),
        shipping_address=dict(SHIPPING), actor_id="konto-1")
    (item,) = await shop_orders.items_for(db, order["id"])
    for row in sorted(item["print_files"], key=lambda row: row["placement"]):
        stored = await db.shop_print_files.find_one({"id": row["file_id"]}, {"_id": 0})
        seen[f"order {row['placement']} {row['kind']}"] = pixels(shop_designs._path_of(stored["file_ref"]))
        if row.get("gamertag_file_id"):
            tag = await db.shop_gamertag_files.find_one({"id": row["gamertag_file_id"]}, {"_id": 0})
            seen[f"gamertag {row['placement']} rules"] = tag["rules_hash"]
            seen[f"gamertag {row['placement']} pixels"] = pixels(shop_designs._path_of(tag["file_ref"]))
    # 2. Allover (#2141): Hintergrund, Rückenmotiv und Gamertag oben.
    other = await configured(db, provider, generate=False, title="Trikot Bestand")
    await shop_products.set_layout(db, other["id"], [{"key": "front", "layers": [LION]},
                                                     {"key": "back", "mode": "upload",
                                                      "layers": [BACK, ALLOVER_NAME]}],
                                   included_placement="front", **BY)
    await upload(db, other["id"], "White", background())
    await shop_products.generate_print_files(db, other["id"], **BY)
    allover = (await plans(db, other["id"]))["back|White"]
    seen["allover layout back|White"] = allover.layout_hash
    base = await shop_print_files.current_base(db, other["id"], allover)
    seen["allover base back|White"] = pixels(shop_designs._path_of(base["file_ref"]))
    if not GOLDEN:
        pytest.fail("Prüfsummen fehlen:\n" + "\n".join(f'    "{key}": "{value}",' for key, value in seen.items()))
    assert seen == GOLDEN
