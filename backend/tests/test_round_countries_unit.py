"""Land eines Termins (#1925): aus Ort oder Strecke erkannt - deutsche und englische Ländernamen, Strecken- und
Städtenamen, Klammerzusätze. Kein Treffer bleibt leer. Die Liste der Länder ist dieselbe wie die der Website
(``frontend/src/lib/countries.json``), und zu jedem Land gibt es eine Flagge."""
import json
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import round_countries  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parents[2]

# Ein Kalender wie bei einer großen Rennliga: 24 Rennen, so wie Veranstalter sie schreiben.
CALENDAR = [
    ("Australien", "AU"), ("China (Shanghai)", "CN"), ("Suzuka", "JP"), ("Bahrain", "BH"),
    ("Saudi-Arabien", "SA"), ("USA (Miami)", "US"), ("Imola", "IT"), ("Monaco", "MC"),
    ("Spanien (Barcelona)", "ES"), ("Kanada", "CA"), ("Österreich", "AT"), ("Silverstone", "GB"),
    ("Spa-Francorchamps", "BE"), ("Ungarn", "HU"), ("Zandvoort", "NL"), ("Monza", "IT"),
    ("Aserbaidschan", "AZ"), ("Singapur", "SG"), ("COTA", "US"), ("Mexiko", "MX"),
    ("Interlagos", "BR"), ("Las Vegas", "US"), ("Lusail", "QA"), ("Yas Marina", "AE"),
]


@pytest.mark.parametrize(("venue", "code"), CALENDAR)
def test_a_whole_racing_calendar_is_recognised(venue, code):
    assert round_countries.detect_country(venue) == code


@pytest.mark.parametrize(("text", "code"), [
    ("Azerbaijan", "AZ"), ("Baku City Circuit", "AZ"), ("Great Britain", "GB"), ("Großbritannien", "GB"),
    ("Grossbritannien", "GB"), ("Austin", "US"), ("Circuit of the Americas", "US"), ("Jeddah", "SA"),
    ("Madrid", "ES"), ("Netherlands", "NL"), ("Abu Dhabi", "AE"), ("São Paulo", "BR"), ("Emilia-Romagna", "IT"),
    ("Red Bull Ring", "AT"), ("Oesterreich", "AT"), ("Mexico City", "MX"), ("Qatar", "QA"), ("Losail", "QA"),
    ("Marina Bay", "SG"), ("Hungaroring", "HU"), ("Japan", "JP"), ("Melbourne", "AU"), ("Montréal", "CA"),
    ("Nürburgring Nordschleife", "DE"), ("Portimão", "PT"), ("Le Mans", "FR"), ("Istanbul Park", "TR"),
])
def test_english_and_german_names_tracks_and_cities(text, code):
    assert round_countries.detect_country(text) == code


def test_bracket_additions_and_title_after_venue():
    assert round_countries.detect_country("Großer Preis (Las Vegas)") == "US"
    assert round_countries.detect_country("R5 – Strecke offen", "GP von Belgien") == "BE"
    # Die Strecke zählt vor dem Titel.
    assert round_countries.detect_country("Monza", "Saisonfinale Abu Dhabi") == "IT"


@pytest.mark.parametrize(("title", "code"), [
    # Im Titel zählen nur Länder- und Streckennamen …
    ("GP von Belgien", "BE"), ("Rennen in Monza", "IT"), ("Spa-Francorchamps Klassiker", "BE"), ("Lauf am COTA", "US"),
    ("Mexico City Grand Prix", "MX"),
    # Eindeutige Streckennamen gelten im Titel, auch wenn sie nach Personen heißen.
    ("Circuit Gilles Villeneuve", "CA"), ("Autódromo Hermanos Rodríguez", "MX"), ("Paul Ricard 6h", "FR"),
    # … keine bloßen Städte und keine Wörter, die auch Vor- oder Nachnamen sind.
    ("Austin Powers Gedächtnisrennen", None), ("Las Vegas Nacht", None), ("Spa-Abend", None), ("Holland Cup", None),
    ("Monaco Franze Pokal", None), ("Spielberg Spezial", None), ("Saisonfinale Abu Dhabi", None),
])
def test_the_title_only_knows_countries_and_tracks(title, code):
    assert round_countries.detect_country(None, title) == code
    assert round_countries.detect_country("", title) == code


def test_the_venue_knows_cities_and_name_like_words():
    assert round_countries.detect_country("Austin") == "US"
    assert round_countries.detect_country("Monaco", "Austin Powers Gedächtnisrennen") == "MC"
    assert round_countries.detect_country("Spielberg") == "AT"
    assert round_countries.detect_country("Holland") == "NL"


def test_no_match_stays_empty_and_words_only_count_whole():
    assert round_countries.detect_country("Probe-Ring") is None
    assert round_countries.detect_country("") is None
    assert round_countries.detect_country(None, None) is None
    # „Spa“ steckt in „Spanien“ und „Spaß“ - nur das ganze Wort zählt.
    assert round_countries.detect_country("Spaßrennen") is None
    assert round_countries.detect_country("Spanien") == "ES"


def test_codes_are_checked_and_named():
    assert round_countries.clean_code("it") == "IT"
    assert round_countries.clean_code(" ") is None
    assert round_countries.clean_code(None) is None
    with pytest.raises(ValueError):
        round_countries.clean_code("XX")
    assert round_countries.country_name("AZ") == "Aserbaidschan"


def test_the_website_knows_the_same_countries_and_has_a_flag_for_each():
    names = json.loads((REPO / "frontend/src/lib/countries.json").read_text(encoding="utf-8"))
    assert set(names) == set(round_countries.COUNTRIES)
    for code, name in names.items():
        assert name == round_countries.country_name(code)
        flag = REPO / f"frontend/public/assets/flags/{code.lower()}.svg"
        assert flag.is_file(), flag
        assert flag.read_text(encoding="utf-8").lstrip().startswith("<svg")
