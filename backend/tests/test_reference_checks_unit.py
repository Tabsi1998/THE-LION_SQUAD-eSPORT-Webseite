"""Prüfung beim Speichern einer Referenz (#1755): Datum und Platzierung plausibel. Nur Warnungen, nie ein Fehler -
je Feld eine klare Meldung; die Grenzen kommen aus den Einstellungen mit Vorgabe."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.reference_checks import DEFAULT_SETTINGS, check_reference, normalize_settings  # noqa: E402

TODAY = "2026-10-21"


def _fields(doc, settings=None):
    return [(item["field"], item["code"]) for item in check_reference(doc, TODAY, settings)]


def test_a_plain_reference_has_no_warning():
    doc = {"status": "completed", "start_date": "2026-03-01", "end_date": "2026-03-02",
           "entries": [{"placement": 3, "participant_count": 16}]}
    assert check_reference(doc, TODAY) == []


def test_an_end_before_the_start_is_named_at_the_end_date():
    doc = {"start_date": "2026-03-05", "end_date": "2026-03-01"}
    assert _fields(doc) == [("end_date", "end_before_start")]


def test_an_end_far_after_the_start_is_a_typo_warning():
    doc = {"start_date": "2024-03-01", "end_date": "2026-03-01"}
    assert _fields(doc) == [("end_date", "too_long")]
    # Genau ein Jahr ist noch in Ordnung, die Grenze ist einstellbar.
    assert _fields({"start_date": "2025-03-01", "end_date": "2026-03-01"}) == []
    assert _fields({"start_date": "2026-01-01", "end_date": "2026-03-01"}, {"max_duration_days": 30}) == [
        ("end_date", "too_long")]


def test_a_finished_reference_ending_in_the_future_is_flagged():
    doc = {"status": "completed", "start_date": "2026-10-01", "end_date": "2026-12-01"}
    assert _fields(doc) == [("end_date", "end_in_future")]
    # Laufend oder geplant darf das Ende in der Zukunft liegen; abschaltbar ist die Prüfung auch.
    assert _fields({**doc, "status": "active"}) == []
    assert _fields({**doc, "status": "planned"}) == []
    assert _fields(doc, {"warn_future_end": False}) == []
    # Ohne Status gilt die Vorgabe „abgeschlossen“ wie beim Anlegen.
    assert _fields({"end_date": "2026-12-01"}) == [("end_date", "end_in_future")]
    assert _fields({"end_date": TODAY}) == []


def test_a_placement_above_the_field_size_is_named_at_its_entry():
    doc = {"entries": [{"placement": 2, "participant_count": 16},
                       {"placement": 9, "team_count": 8}]}
    warnings = check_reference(doc, TODAY)
    assert [(item["field"], item["code"]) for item in warnings] == [("entries.1.placement", "placement_above_count")]
    assert "Platz 9" in warnings[0]["message"] and "8" in warnings[0]["message"]
    # Ohne Teilnehmerzahl gibt es nichts zu vergleichen.
    assert _fields({"entries": [{"placement": 40}]}) == []


def test_an_old_reference_without_entries_is_checked_on_its_own_fields():
    doc = {"placement": 20, "participant_count": 16}
    assert _fields(doc) == [("placement", "placement_above_count")]


def test_dates_with_time_and_broken_dates_do_not_break_the_check():
    assert _fields({"start_date": "2026-03-05T10:00:00+00:00", "end_date": "2026-03-01"}) == [
        ("end_date", "end_before_start")]
    assert _fields({"start_date": "kein Datum", "end_date": "2026-03-01"}) == []


def test_settings_fall_back_to_their_defaults():
    assert normalize_settings(None) == DEFAULT_SETTINGS
    assert DEFAULT_SETTINGS == {"max_duration_days": 365, "warn_future_end": True}
    assert normalize_settings({"max_duration_days": "0"})["max_duration_days"] == 365
    assert normalize_settings({"max_duration_days": 90, "warn_future_end": False}) == {
        "max_duration_days": 90, "warn_future_end": False}
