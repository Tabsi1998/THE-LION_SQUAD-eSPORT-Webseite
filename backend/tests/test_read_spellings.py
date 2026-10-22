"""Gelernte Schreibweisen aus Ergebnis-Bildern (#2012): was gelernt und was wieder vergessen wird - ohne Datenbank.
Nur erfundene Namen."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services import read_spellings  # noqa: E402
from services.result_image_match import build  # noqa: E402
from test_result_image_match import TEMPLATE, reading, row  # noqa: E402


def test_a_correction_against_a_learned_name_replaces_it():
    """Prüfer zu #2012: „Jonsa“ war bei Jonas gelernt; der Vorstand ordnet dieselbe Lesung jetzt Jonsaxx zu. Die alte
    Schreibweise wird bei Jonas vergessen und bei Jonsaxx gelernt - sie macht Jonas nie wieder grün."""
    parts = [{"id": "a", "name": "Jonas", "read_aliases": [{"name": "Jonsa", "at": "x"}]},
             {"id": "b", "name": "Jonsaxx"}]
    learn, forget = read_spellings.name_spellings([("b", "Jonsa")], parts)
    assert learn == [{"participant_id": "b", "name": "Jonsa"}]
    assert forget == [{"participant_id": "a", "name": "Jonsa"}]
    after = [{"id": "a", "name": "Jonas", "read_aliases": []}, {"id": "b", "name": "Jonsaxx", "read_aliases": [
        {"name": "Jonsa"}]}]
    out = build(reading(row("1", "", "Jonsa", strips={"name": "Jonsa"})), TEMPLATE, after)["rows"][0]
    assert (out["participant_id"], out["uncertain"]) == ("b", [])


def test_a_correction_to_the_own_name_still_forgets_the_other_spelling():
    """„Maxx“ war bei Maxi gelernt, ist aber genau der Name von „Max X“: nichts Neues zu lernen - aber Maxi vergisst die
    Schreibweise, denn der Vorstand hat sie Max X zugeordnet."""
    parts = [{"id": "a", "name": "Maxi", "read_aliases": [{"name": "Maxx"}]}, {"id": "b", "name": "Max X"}]
    assert read_spellings.name_spellings([("b", "Maxx")], parts) == ([], [{"participant_id": "a", "name": "Maxx"}])


def test_a_real_name_of_another_participant_is_never_forgotten_or_learned():
    parts = [{"id": "a", "name": "Anna Probe"}, {"id": "b", "name": "Anna Probe2"}]
    assert read_spellings.name_spellings([("b", "Anna Probe")], parts) == ([], [])


def test_a_correction_against_a_learned_team_replaces_it():
    """Team „Rotr Rcng“ war falsch als „Blaupfeil GP“ gelernt, der Vorstand ordnet es jetzt „Rotor Racing“ zu: die alte
    Zuordnung fällt weg, die neue gilt. Dieselbe Zuordnung noch einmal lernt nichts."""
    known = ["Rotor Racing", "Blaupfeil GP"]
    learned = [{"read": "Rotr Rcng", "team": "Blaupfeil GP", "at": "x"}]
    learn, forget = read_spellings.team_spellings([("Rotor Racing", "Rotr Rcng")], known, learned)
    assert learn == [{"read": "Rotr Rcng", "team": "Rotor Racing"}]
    assert forget == [{"read": "Rotr Rcng", "team": "Blaupfeil GP"}]
    assert read_spellings.team_spellings([("Blaupfeil GP", "Rotr Rcng")], known, learned) == ([], [])
    # Passt die Lesung einem anderen Team mindestens so gut, wird nichts Neues gelernt - die alte Zuordnung fällt
    # trotzdem weg: sie macht nie wieder grün.
    old = [{"read": "Rotr", "team": "Rotor"}]
    assert read_spellings.team_spellings([("Rotrix", "Rotr")], ["Rotor", "Rotrix"], old) == (
        [], [{"read": "Rotr", "team": "Rotor"}])
    out = build(reading(row("1", "", "Jonas", "Rotr", strips={"name": "Jonas", "team": "Rotr"})), TEMPLATE,
                [{"id": "a", "name": "Jonas"}], teams=["Rotor", "Rotrix"], team_aliases=[])["rows"][0]
    assert "team" in out["uncertain"]
