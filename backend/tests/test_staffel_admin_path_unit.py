"""Staffel-Seite der Liga-Verwaltung (#2262): der Pfad steht an einer Stelle (``staffel_guard.staffel_admin_path``)."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.staffel_guard import STAFFEL_ADMIN_BASE, staffel_admin_path

STAFFEL = {"id": "t-1", "league_context": {"league_id": "l1", "season_id": "s1", "division_id": "d1", "staffel": "A"}}


def test_a_staffel_gets_the_flat_admin_path_in_the_shape_of_the_api():
    assert STAFFEL_ADMIN_BASE == "/admin/leagues/staffeln"
    assert staffel_admin_path(STAFFEL) == "/admin/leagues/staffeln/t-1"


def test_the_path_can_name_a_tab_or_section():
    assert staffel_admin_path(STAFFEL, "teilnehmer") == "/admin/leagues/staffeln/t-1#teilnehmer"


def test_an_ordinary_tournament_and_a_staffel_without_id_get_no_path():
    assert staffel_admin_path({"id": "t-2"}) is None
    assert staffel_admin_path({"league_context": STAFFEL["league_context"]}) is None
    assert staffel_admin_path(None) is None
