"""Die Erklärtexte der Turnier- und Spiel-Erfolge sagen, was gezählt wird (#2337).

Der Audit vom 10.11.2026 fand Texte, die etwas anderes versprachen als die Zählung („Platz 1 oder 2 heißt: du warst im
Finale“, „Jede Anmeldung zählt“, „Einzel, Team, Liga, Cup“ als Formate). Hier stehen die vereinbarten Sätze fest, und die
Formatliste hängt an denselben Schlüsseln wie die Zählung.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import achievement_catalog as catalog  # noqa: E402
from achievement_catalog.catalog_a import FORMAT_NAMES, FORMATS_HOW_TO  # noqa: E402
from services.achievement_participation import format_key  # noqa: E402
from services.competition_formats import FORMAT_CAPABILITIES  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parents[2]


def how_to(code: str) -> str:
    return catalog.GROUP_BY_CODE[code]["how_to"]


def test_vereinbarte_saetze():
    assert how_to("matches_won") == "Gewinn Matches gegen echte Gegner – kampflose Siege zählen, Freilose und Unentschieden nicht."
    assert how_to("finals") == ("Du standest im Finale: im Endspiel, im Grand Final oder im Finallauf. Turniere ohne Finale "
                                "(Jeder gegen jeden, Schweizer System, reine Gruppenphase, Liga) zählen nicht.")
    assert how_to("top_seed") == "Setznummer 1 in einem Turnier mit fester Setzliste, das gespielt wurde – ausgelost, abgesagt und Liga zählen nicht."
    assert how_to("tournaments_completed") == ("Abgeschlossenes Turnier, in dem du gespielt hast, ohne kampflos zu verlieren, auszutreten oder "
                                               "disqualifiziert zu werden.")


def test_champion_podest_und_riesentoeter_nennen_ihre_grenzen():
    for code in ("tournaments_won", "podium", "top8"):
        assert "abgeschlossenen Turnier" in how_to(code) and "(keine Liga)" in how_to(code), code
    assert "mehr als acht Teilnehmern" in how_to("top8")
    assert how_to("giant_slayer").endswith("nur bei fester Setzliste.")


def test_teilnahme_statt_anmeldung_steht_im_text():
    veteran = catalog.GROUP_BY_CODE["tournaments_registered"]
    assert "Anmeldung allein nicht" in veteran["how_to"] and "anmeld" not in veteran["description"].lower()
    steps = [tier["description"] for tier in catalog.ACHIEVEMENT_TIERS if tier["group_code"] == "tournaments_registered"]
    assert steps and all(step.endswith("Turniere gespielt.") and "anmeldung" not in step.lower() for step in steps)
    assert "Match gespielt" in how_to("distinct_games")
    assert "für dein Team gespielt" in how_to("team_tournaments")
    assert "auch gespielt" in how_to("checkin_first")


def test_rampenlicht_und_puenktlich_beschreiben_die_zaehlung():
    spotlight = catalog.GROUP_BY_CODE["featured_match"]
    assert "hinterlegtem Stream" in spotlight["how_to"] and "Freilose" in spotlight["how_to"]
    assert "auf einem Turnier-Stream" not in spotlight["description"], "gezählt wird das Turnier mit Stream, nicht das gezeigte Match"
    assert "angesetzter Startzeit" in how_to("punctual") and "fürs Turnier eingecheckt" in how_to("punctual")


def test_formatvielfalt_nennt_die_formate_die_gezaehlt_werden():
    text = how_to("formats_played")
    assert text == FORMATS_HOW_TO and text.endswith("Jedes Format zählt einmal.")
    assert all(name in text for name in FORMAT_NAMES.values())
    # Jedes Format, das Spiele bekommt, hat einen Namen im Text - über denselben Schlüssel, mit dem gezählt wird.
    countable = {format_key({"format": key}) for key in FORMAT_CAPABILITIES} - {"time_trial", "grand_prix"}
    assert countable == set(FORMAT_NAMES)
    assert format_key({"format": "battle_royale"}) == "ffa" and format_key({"format": "single_elim", "league_context": {"league_id": "l"}}) == "league"
    # Die höchste Stufe muss erreichbar sein.
    targets = [tier["progress_target"] for tier in catalog.ACHIEVEMENT_TIERS if tier["group_code"] == "formats_played"]
    assert max(targets) <= len(FORMAT_NAMES)


def test_formatnamen_stimmen_mit_der_turnierverwaltung():
    labels = (REPO / "frontend" / "src" / "lib" / "tournamentLabels.js").read_text(encoding="utf-8")
    for key, name in FORMAT_NAMES.items():
        if key == "league":
            assert 'league: "Jeder gegen jeden – Hin- und Rückrunde"' in labels, "die Hin- und Rückrunde zählt als Liga"
            continue
        assert f'{key}: "{name}"' in labels, key
