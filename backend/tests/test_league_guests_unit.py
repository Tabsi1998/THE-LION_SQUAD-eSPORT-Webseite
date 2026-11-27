"""Gastteams (#1665, Nr. 286): Kennzeichen, Plakette und Angabe der Teamleitung - ohne Datenbank. Erfundene Namen."""

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import league_guests as guests  # noqa: E402


def team(**state) -> dict:
    return {"id": "t1", "name": "Probe Adler", guests.FIELD: state} if state else {"id": "t1", "name": "Probe Adler"}


CONFIRMED = {"confirmed_at": "2026-11-27T10:00:00+00:00"}


def test_without_the_field_nothing_changes():
    plain = team()
    assert guests.badge(plain) is None
    assert guests.badge(plain, short=True) is None
    assert guests.details(plain) is None
    assert guests.pending(plain) is False
    assert guests.text_suffix(plain) == ""
    assert guests.lead_hint(plain) == ""


def test_only_the_league_lead_makes_a_guest_team_the_teams_own_data_does_not():
    # Angabe der Teamleitung ohne Bestätigung: keine Plakette, aber eine offene Angabe für die Liga-Leitung.
    asked = team(kind="club", name="SV Probedorf")
    assert guests.badge(asked) is None
    assert guests.pending(asked) is True
    assert "Bestätige das Kennzeichen im Eingang" in guests.lead_hint(asked)


def test_a_confirmed_club_shows_gast_and_the_club_name_on_the_web_and_only_gast_on_tv():
    state = guests.confirmed_fields({"kind": "club", "name": "SV  Probedorf "}, True)
    confirmed = team(**state)
    assert guests.badge(confirmed) == {"label": "Gast", "org": "SV Probedorf"}
    assert guests.badge(confirmed, short=True) == {"label": "Gast"}
    assert guests.text_suffix(confirmed) == " (Gast)"
    assert guests.pending(confirmed) is False


def test_a_school_name_shows_only_with_the_release_of_the_team_lead():
    state = guests.confirmed_fields({"kind": "school", "name": "Probeschule Nord"}, True)
    assert guests.badge(team(**state)) == {"label": "Gast", "org": None}
    assert guests.badge(team(**{**state, "school_name_public": True})) == {"label": "Gast", "org": "Probeschule Nord"}
    # Die Liga-Leitung sieht den Namen trotzdem.
    assert guests.details(team(**state))["name"] == "Probeschule Nord"
    assert guests.details(team(**state))["school_name_public"] is False


def test_a_change_after_the_confirmation_shows_only_gast_until_it_is_confirmed_again():
    state = guests.confirmed_fields({"kind": "club", "name": "SV Probedorf"}, True)
    changed = team(**{**state, "name": "Etwas ganz anderes"})
    assert guests.badge(changed) == {"label": "Gast", "org": None}
    assert guests.pending(changed) is True
    again = team(**guests.confirmed_fields(guests.state_of(changed), True))
    assert guests.badge(again) == {"label": "Gast", "org": "Etwas ganz anderes"}


def test_confirmed_without_any_data_is_simply_gast():
    confirmed = team(**guests.confirmed_fields({}, True))
    assert guests.badge(confirmed) == {"label": "Gast", "org": None}
    assert guests.pending(confirmed) is False
    assert guests.lead_hint(confirmed) == " Gastteam."


def test_revoking_keeps_the_teams_data_and_drops_only_the_mark():
    state = guests.confirmed_fields({"kind": "club", "name": "SV Probedorf"}, True)
    revoked = guests.confirmed_fields(state, False)
    assert "confirmed_at" not in revoked and "confirmed_name" not in revoked
    assert revoked["name"] == "SV Probedorf"
    assert guests.badge(team(**revoked)) is None
    assert guests.is_empty(revoked) is False
    assert guests.is_empty(guests.confirmed_fields({}, False)) is True


@pytest.mark.parametrize("kind,name,problem", [
    (None, "SV Probedorf", guests.NAME_REQUIRES_KIND),
    ("club", "S", guests.NAME_LENGTH),
    ("school", "x" * (guests.NAME_MAX + 1), guests.NAME_LENGTH),
])
def test_the_team_lead_data_is_checked(kind, name, problem):
    with pytest.raises(ValueError, match=problem.split(" ")[0]):
        guests.org_fields(kind, name, False)


def test_the_school_release_only_counts_for_schools_and_spaces_fold():
    club = guests.org_fields("club", "  SV   Probedorf  ", True)
    assert club["name"] == "SV Probedorf" and club["school_name_public"] is False
    school = guests.org_fields("school", "Probeschule Nord", True)
    assert school["school_name_public"] is True
    cleared = guests.org_fields(None, "", True)
    assert cleared["kind"] is None and cleared["name"] is None


def test_a_very_long_name_is_kept_whole():
    name = "Höhere Technische Bundeslehranstalt für Probeberufe am Probeberg Nord"
    assert len(name) <= guests.NAME_MAX
    state = guests.confirmed_fields(guests.org_fields("school", name, True), True)
    assert guests.badge(team(**state))["org"] == name
