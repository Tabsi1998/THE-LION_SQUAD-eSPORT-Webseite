"""Farbnamen im Shop auf Deutsch (#2105): eine Stelle übersetzt die Printful-Farben, je Produkt überschreibbar -
englisch nur als letzter Rückfall. Intern bleibt der Printful-Name der Schlüssel."""
import pytest

from services import shop_colors
from services.shop_common import ShopError



@pytest.mark.parametrize("name, german", [
    ("Black", "Schwarz"), ("White", "Weiß"), ("Sport Grey", "Sportgrau"), ("Navy", "Marineblau"),
    ("Dark Heather", "Dunkelgrau meliert"), ("Maroon", "Weinrot"), ("Heather Grey", "Grau meliert"),
    ("Royal", "Königsblau"), ("Light Blue", "Hellblau"), ("Dark Grey", "Dunkelgrau"), ("Forest Green", "Waldgrün"),
    ("Heather Navy", "Marineblau meliert"), ("black", "Schwarz"), ("  Sport   Grey ", "Sportgrau"),
    ("Black/ White", "Schwarz / Weiß"), ("Heather Grey/Black", "Grau meliert / Schwarz"),
])
def test_printful_colours_become_german(name, german):
    assert shop_colors.german(name) == german


def test_unknown_words_keep_the_printful_name_as_last_fallback():
    assert shop_colors.german("Heliconia") == "Heliconia"
    assert shop_colors.german("Dark Heliconia") == "Dark Heliconia", "nie halb übersetzt"
    assert shop_colors.is_translated("Heliconia") is False and shop_colors.is_translated("Black") is True
    assert shop_colors.german("") == "" and shop_colors.german(None) == ""


def test_a_product_can_override_the_label_but_the_key_stays():
    product = {"offer": {"colors": ["Black", "White"], "color_labels": {"Black": "Tiefschwarz"}},
               "printful": {"colors": [{"name": "Black", "code": "#0c0c0c"}, {"name": "White", "code": "#ffffff"},
                                       {"name": "Navy", "code": "#1d2335"}]}}
    assert shop_colors.label(product, "Black") == "Tiefschwarz"
    assert shop_colors.label(product, "White") == "Weiß"
    assert shop_colors.labels_for(product) == {"Black": "Tiefschwarz", "White": "Weiß", "Navy": "Marineblau"}
    assert shop_colors.variant_label(product, {"color": "Black", "size": "M", "label": "Black / M"}) == "Tiefschwarz / M"
    assert shop_colors.variant_label(None, {"color": "Navy", "size": "One size", "label": "Navy / One size"}) == \
        "Marineblau / Einheitsgröße"
    # Eine gespeicherte Bezeichnung einer Bestellung („Black / M“) ohne Variante: dieselbe Übersetzung.
    assert shop_colors.stored_label("Black / M") == "Schwarz / M"
    assert shop_colors.stored_label("Sport Grey / XL") == "Sportgrau / XL"
    assert shop_colors.stored_label("Einzelstück") == "Einzelstück"


def test_overrides_are_checked_against_the_offered_colours():
    colors = ["Black", "White"]
    assert shop_colors.clean_labels({"black": " Tief  schwarz ", "White": ""}, colors) == {"Black": "Tief schwarz"}
    assert shop_colors.clean_labels(None, colors) == {}
    for wrong in ({"Navy": "Blau"}, {"Black": "x" * 41}, {"Black": "Schwarz\n"}, ["Black"], {"Black": 7}):
        with pytest.raises(ShopError):
            shop_colors.clean_labels(wrong, colors)


def test_only_stored_printful_codes_are_valid_colours():
    product = {"printful": {"colors": [{"name": "Black", "code": "#0C0C0C"}, {"name": "Odd", "code": "rot"}],
                            "variants": [{"color": "White", "color_code": "#ffffff"}]}}
    assert shop_colors.codes_of(product) == {"0c0c0c", "ffffff"}
    assert shop_colors.hex_of("#0C0C0C") == "0c0c0c" and shop_colors.hex_of("rot") is None
    assert shop_colors.hex_of("#12345") is None and shop_colors.hex_of(None) is None
