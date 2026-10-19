"""Regel für Änderungen an veröffentlichten Ergebnisblättern (#1749, Entscheidung des Obmanns): Wer nicht veröffentlichen
darf, ändert ein veröffentlichtes Blatt nie direkt - die Änderung wird ein neuer Entwurf daneben, den der Vorstand
freigibt; bis dahin bleibt das veröffentlichte sichtbar. Nur erfundene Werte, ohne Datenbank."""
import pathlib
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.reference_series_access import (  # noqa: E402
    BOARD,
    CAPTAIN,
    EDIT_PENDING_DRAFT,
    EDIT_SHEET,
    SeriesAccess,
    captain_may_publish,
)

SERIES = {"id": "serie-1", "publish_mode": "review"}


def _access(role: str, can_publish: bool) -> SeriesAccess:
    return SeriesAccess(user={"id": "u"}, series=SERIES, role=role, can_publish=can_publish)


@pytest.mark.parametrize("role,can_publish,sheet,expected", [
    (CAPTAIN, False, None, EDIT_SHEET),
    (CAPTAIN, False, {"status": "draft"}, EDIT_SHEET),
    (CAPTAIN, False, {"status": "published"}, EDIT_PENDING_DRAFT),
    (CAPTAIN, True, {"status": "published"}, EDIT_SHEET),
    (BOARD, True, {"status": "published"}, EDIT_SHEET),
])
def test_a_published_sheet_changes_only_as_a_new_draft_without_the_right_to_publish(role, can_publish, sheet, expected):
    assert _access(role, can_publish).edit_target(sheet) == expected


def test_without_the_right_to_publish_publishing_is_refused_not_silently_turned_into_a_draft():
    captain = _access(CAPTAIN, False)
    assert captain.result_status(None) == "draft"
    with pytest.raises(HTTPException) as refused:
        captain.result_status("published")
    assert refused.value.status_code == 403


@pytest.mark.parametrize("mode,staff_right,expected", [
    ("review", False, False), ("review", True, True), ("direct", False, True), (None, None, False),
])
def test_publishing_directly_needs_the_series_on_direct_or_the_captain_right(mode, staff_right, expected):
    assert captain_may_publish({"publish_mode": mode}, {"can_publish": staff_right}) is expected
