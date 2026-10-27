"""Produktsuche im Printful-Katalog (#2069): Katalog laden (seitenweise, zwischengespeichert), lokal suchen nach Name,
Marke, Modell und Kategorie, ein Dashboard-Link nur bei eindeutigem Treffer. Printful ist der Vertrags-Fake - kein
echter Aufruf. Namen wie bei Printful, Nummern erfunden."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from printful_fake import API_KEY, FakePrintful  # noqa: E402
from services import printful_client, shop_catalog_search, shop_schema  # noqa: E402
from services.printful_client import PrintfulClient  # noqa: E402
from services.shop_common import ShopError  # noqa: E402

NAMES = {
    71: ("Unisex Classic Tee | Gildan 5000", 24), 72: ("All-Over Print Men's Athletic Jersey", 1),
    73: ("Snapback Hat | Yupoong 6089M", 42), 74: ("Black Glossy Mug", 112), 75: ("Beach Towel", 112),
    76: ("Unisex Classic Tee | Gildan 5000 (Kids)", 24),
}


@pytest.fixture
def fake():
    instance = FakePrintful()
    for number, (name, category) in NAMES.items():
        instance.add_product(number, ((number * 100, "M"),), name=name)
        instance.products[number]["main_category_id"] = category
        instance.products[number]["image"] = f"https://files.cdn.printful.com/products/{number}.jpg"
    instance.products[75]["image"] = "https://anderswo.example.test/towel.jpg"
    for extra in range(1000, 1150):  # mehr als eine Seite (100 je Aufruf)
        instance.add_product(extra, ((extra * 100, "M"),), name=f"Testprodukt {extra}")
    return instance


@pytest.fixture
def provider(fake, monkeypatch):
    async def no_wait(_seconds):
        return None

    monkeypatch.setattr(printful_client, "_sleep", no_wait)
    return PrintfulClient(API_KEY, transport=fake.transport())


@pytest_asyncio.fixture
async def db():
    instance = AsyncMongoMockClient()["shop_katalog"]
    await shop_schema.apply(instance)
    await instance.mutation_locks.create_index("resource", unique=True)
    return instance


@pytest.mark.asyncio
async def test_the_catalog_is_loaded_page_by_page_and_cached_for_a_day(db, provider, fake):
    catalog = await shop_catalog_search.load(db, provider=provider)
    assert len(catalog["products"]) == 156 and catalog["stale"] is False
    pages = fake.calls_to("getProducts")
    assert [call["params"]["offset"] for call in pages] == ["0", "100"]
    assert {call["params"]["selling_region_name"] for call in pages} == {"europe"}
    again = await shop_catalog_search.load(db, provider=provider)
    assert again["fetched_at"] == catalog["fetched_at"] and len(fake.calls_to("getProducts")) == 2, "aus dem Speicher"
    await db.shop_printful_catalog.update_one({"id": "catalog"}, {"$set": {"fetched_at": (
        shop_catalog_search.now_utc() - timedelta(hours=25)).isoformat()}})
    await shop_catalog_search.load(db, provider=provider)
    assert len(fake.calls_to("getProducts")) == 4, "nach einem Tag neu"
    fake.fail(500, times=10)
    stale = await shop_catalog_search.load(db, provider=provider, refresh=True)
    assert stale["stale"] is True and stale["error"] and len(stale["products"]) == 156


@pytest.mark.asyncio
async def test_without_any_stored_catalog_a_failure_is_reported(db, provider, fake):
    fake.fail(500, times=10)
    with pytest.raises(ShopError, match="nicht erreichbar"):
        await shop_catalog_search.load(db, provider=provider)
    with pytest.raises(ShopError, match="noch nicht geladen"):
        await shop_catalog_search.load(db, provider=None)


@pytest.mark.asyncio
async def test_search_by_name_brand_model_german_words_and_category(db, provider):
    catalog = await shop_catalog_search.load(db, provider=provider)

    def names(**kwargs):
        return [row["name"] for row in shop_catalog_search.search(catalog, **kwargs)["results"]]

    assert names(query="Gildan 5000") == ["Unisex Classic Tee | Gildan 5000", "Unisex Classic Tee | Gildan 5000 (Kids)"]
    assert names(query="gildan kinder") == ["Unisex Classic Tee | Gildan 5000 (Kids)"]
    assert names(query="Snapback") == ["Snapback Hat | Yupoong 6089M"]
    assert names(query="Kappe") == ["Snapback Hat | Yupoong 6089M"]
    assert names(query="Trikot") == ["All-Over Print Men's Athletic Jersey"]
    assert names(query="Tasse") == ["Black Glossy Mug"]
    assert names(query="Badetuch") == ["Beach Towel"]
    assert names(query="", category_id=112) == ["Beach Towel", "Black Glossy Mug"]
    # Oberkategorie mit Unterkategorien: Men's clothing (1) enthält T-shirts (24).
    assert names(query="classic", category_id=1) == ["Unisex Classic Tee | Gildan 5000", "Unisex Classic Tee | Gildan 5000 (Kids)"]
    assert shop_catalog_search.search(catalog, category_id=1)["total"] == 153, "Treffer gezählt, gezeigt höchstens 40"
    assert names(query="mug", category_id=24) == []
    hit = shop_catalog_search.search(catalog, query="Gildan 5000")["results"][0]
    assert hit["id"] == 71 and hit["techniques"] == ["dtg"] and hit["colors"] == 1 and hit["sizes"] == 1
    assert hit["image"] == "https://files.cdn.printful.com/products/71.jpg"
    towel = shop_catalog_search.search(catalog, query="towel")["results"][0]
    assert towel["image"] is None, "Bilder nur von Printful-Hosts"
    tree = shop_catalog_search.category_tree(catalog)
    assert [(row["title"], row["depth"]) for row in tree][:2] == [("Hats", 0), ("Home & living", 0)]
    assert ("T-shirts", 1) in [(row["title"], row["depth"]) for row in tree]


@pytest.mark.asyncio
async def test_a_dashboard_link_finds_the_product_only_when_it_is_unique(db, provider, fake):
    catalog = await shop_catalog_search.load(db, provider=provider)
    link = ("https://www.printful.com/dashboard/custom/mens/shirts/unisex-classic-tee-gildan-5000"
            "?technique=DTFILM&color=Black&size=S")
    found = shop_catalog_search.search(catalog, link=link)
    assert found["link"]["ok"] is True and [row["id"] for row in found["results"]] == [71]
    assert shop_catalog_search.search(catalog, link="printful.com/dashboard/custom/home-living/black-glossy-mug")["results"][0]["id"] == 74
    for wrong in ("https://evil.example.test/unisex-classic-tee-gildan-5000", "nur Text",
                  "https://www.printful.com/dashboard/custom/mens/shirts/gibt-es-nicht",
                  # nur echte Dashboard-Pfade: Shop-Seite, Vorlagen, http, andere Unterdomäne
                  "https://www.printful.com/custom/mens/shirts/unisex-classic-tee-gildan-5000",
                  "https://www.printful.com/dashboard/product-templates/unisex-classic-tee-gildan-5000",
                  "https://www.printful.com/dashboard/custom/unisex-classic-tee-gildan-5000",
                  "http://www.printful.com/dashboard/custom/mens/unisex-classic-tee-gildan-5000",
                  "https://files.printful.com/dashboard/custom/mens/unisex-classic-tee-gildan-5000",
                  "https://user@www.printful.com/dashboard/custom/mens/unisex-classic-tee-gildan-5000",
                  "https://printful.com:abc/dashboard/custom/mens/shirts/unisex-classic-tee-gildan-5000"):
        assert shop_catalog_search.search(catalog, link=wrong)["results"] == [], wrong
    # Zwei Produkte mit demselben Namen: kein Raten.
    fake.products[1000]["name"] = "Black Glossy Mug"
    twice = await shop_catalog_search.load(db, provider=provider, refresh=True)
    result = shop_catalog_search.search(twice, link="https://www.printful.com/dashboard/custom/home/black-glossy-mug")
    assert result["results"] == [] and "mehrere" in result["link"]["detail"]
    assert shop_catalog_search.slug("Unisex Classic Tee | Gildan 5000") == "unisex-classic-tee-gildan-5000"


def test_a_link_with_an_invalid_port_is_no_dashboard_link():
    assert shop_catalog_search.dashboard_slug("https://printful.com:abc/dashboard/custom/mens/shirts/x-y") is None
    assert shop_catalog_search.dashboard_slug("printful.com:99999/dashboard/custom/mens/shirts/x-y") is None
    assert shop_catalog_search.dashboard_slug("https://printful.com:443/dashboard/custom/mens/shirts/x-y") == "x-y"
