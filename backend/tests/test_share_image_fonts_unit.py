"""Teilen-Bilder und Rankingbanner mit den Lionsquad-Schriften (#2435): Saira Condensed für Überschriften und Zahlen, Outfit für
Text - aus ``static/fonts``, lokal und in Produktion dieselben. Fehlt eine Datei oder ein Zeichen, greift sauber der Ersatz. Die
Bildgrößen bleiben."""
import io
import pathlib
import sys

import pytest
from PIL import Image, ImageDraw

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import achievement_share, league_rank_banner, result_share, reward_share, share_image  # noqa: E402


def _clear_caches():
    for cached in (share_image.font, share_image.system_font, share_image._brand_bytes, share_image._probe, share_image.has_glyph):
        cached.cache_clear()


@pytest.fixture(autouse=True)
def fresh_fonts():
    _clear_caches()
    yield
    _clear_caches()


def test_headings_use_saira_condensed_and_text_uses_outfit():
    heading = share_image.font(40)
    text = share_image.font(28, bold=False)
    assert isinstance(heading, share_image.BrandFont) and heading.getname()[0].startswith("Saira Condensed")
    assert isinstance(text, share_image.BrandFont) and text.getname()[0].startswith("Outfit")
    thin = share_image.ImageFont.FreeTypeFont(io.BytesIO(share_image._brand_bytes("outfit-latin-wght.woff2")), 28)
    assert text.getlength("Spielmacher") > thin.getlength("Spielmacher"), "Outfit in Mittel, nicht die dünne Grundform"
    assert share_image.font(40) is heading, "je Größe einmal geladen"


def test_latin_with_umlauts_is_covered_other_scripts_are_not():
    for char in "Aäöüß€–·…„“":
        assert share_image.has_glyph(True, char) and share_image.has_glyph(False, char), char
    for char in ("č", "ł", "Ж", "★"):  # č, ł, Ж, ★
        assert not share_image.has_glyph(True, char), char
        assert not share_image.has_glyph(False, char), char


def test_a_text_with_a_missing_character_is_measured_and_drawn_by_the_fallback():
    brand = share_image.font(36)
    name = "Łukasz Čapek"  # Łukasz Čapek
    assert not brand.covers(name)
    assert brand.getlength(name) == brand.fallback.getlength(name)
    assert brand.getbbox(name) == brand.fallback.getbbox(name)
    assert brand.covers("Anna Beispiel") and brand.getlength("Anna Beispiel") != brand.fallback.getlength("Anna Beispiel")
    image = Image.new("L", (400, 60))
    ImageDraw.Draw(image).text((0, 0), name, font=brand, fill=255)
    assert image.getbbox(), "der Name ist zu sehen"


def test_a_missing_font_file_falls_back_and_the_images_still_render(monkeypatch, tmp_path):
    monkeypatch.setattr(share_image, "BRAND_FONT_DIR", str(tmp_path))
    _clear_caches()
    fallback = share_image.font(40)
    assert not isinstance(fallback, share_image.BrandFont)
    assert fallback is share_image.system_font(40, True)
    png = league_rank_banner.render({"rank": 2, "teams": 8, "team": "Nordlicht A", "record": {"played": 3, "won": 2, "lost": 1, "points": 6}})
    assert Image.open(io.BytesIO(png)).size == (league_rank_banner.WIDTH, league_rank_banner.HEIGHT)


def test_a_broken_font_file_falls_back(monkeypatch, tmp_path):
    for spec in share_image.BRAND_FONTS.values():
        (tmp_path / spec["file"]).write_bytes(b"keine Schrift")
    monkeypatch.setattr(share_image, "BRAND_FONT_DIR", str(tmp_path))
    _clear_caches()
    assert not isinstance(share_image.font(30, bold=False), share_image.BrandFont)
    assert share_image.has_glyph(False, "A") is False, "ohne ladbare Schrift gilt jedes Zeichen als fehlend - der Ersatz zeichnet"


def _size(png: bytes) -> tuple[int, int]:
    return Image.open(io.BytesIO(png)).size


def test_image_sizes_stay_the_same():
    assert _size(league_rank_banner.render({"rank": 1, "final": True, "teams": 8, "team": "Nordlicht A", "league": "Probe-Liga",
                                            "season": "Season 1", "record": {"played": 7, "won": 5, "lost": 2, "points": 15}})) == (1200, 300)
    assert _size(achievement_share.render_card({"name": "Spielmacher VII", "rank": 7, "material": "diamond", "material_color": "#B9F2FF",
                                                "user": {"display_name": "Łukasz"}, "club_name": "THE LION SQUAD"})) == (1200, 630)
    assert _size(reward_share.render_card({"kind": "medal", "metal": "gold", "place": "1.", "name": "Meister", "holder": "Nordlicht A"})) == (1200, 630)
    result = {"tournament": {"title": "Herbst-Cup"}, "user": {"display_name": "Neonfalke"}, "rank": 1, "participant_count": 16,
              "participant_word": "Spieler", "steps": [], "chips": ["Finale 3:2"], "club_name": "THE LION SQUAD", "domain": "lionsquad.at"}
    assert _size(result_share.render(result, "story")) == share_image.STORY
    assert _size(result_share.render(result, "wide")) == share_image.WIDE
