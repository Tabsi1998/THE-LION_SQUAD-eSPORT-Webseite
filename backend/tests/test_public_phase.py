from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.public_phase import derive_public_phase


def test_f1_without_online_registration_does_not_show_registration_open():
    phase = derive_public_phase(
        {
            "status": "registration_open",
            "registration_enabled": False,
            "start_date": "2030-06-20T10:00:00+00:00",
        },
        "f1",
        now=datetime(2030, 6, 1, tzinfo=timezone.utc),
    )

    assert phase["state"] == "announced"
    assert phase["label"] == "Angekündigt"
    assert phase["countdown_kind"] == "starts"


def test_f1_with_online_registration_keeps_registration_open():
    phase = derive_public_phase(
        {
            "status": "registration_open",
            "registration_enabled": True,
            "registration_open_from": "2030-06-01T00:00:00+00:00",
            "registration_open_until": "2030-06-10T00:00:00+00:00",
            "start_date": "2030-06-20T10:00:00+00:00",
        },
        "f1",
        now=datetime(2030, 6, 5, tzinfo=timezone.utc),
    )

    assert phase["state"] == "registration_open"
    assert phase["label"] == "Anmeldung offen"
    assert phase["countdown_kind"] == "registration_closes"
