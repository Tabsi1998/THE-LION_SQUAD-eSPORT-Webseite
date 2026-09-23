import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.sponsor_utils import dedupe_public_sponsors


def test_public_sponsors_are_deduped_by_logo_before_rendering():
    sponsors = [
        {"id": "main", "name": "Sponsor A", "logo_url": "/uploads/a.png", "tier": "main"},
        {"id": "copy", "name": "Sponsor A Copy", "logo_url": "/uploads/a.png", "tier": "gold"},
        {"id": "other", "name": "Sponsor B", "logo_url": "/uploads/b.png", "tier": "silver"},
    ]

    deduped = dedupe_public_sponsors(sponsors)

    assert [s["id"] for s in deduped] == ["main", "other"]


def test_event_sponsors_use_same_logo_dedupe_rule():
    sponsors = [
        {"id": "event-a", "name": "Sponsor A", "logo_url": "/uploads/a.png"},
        {"id": "event-b", "name": "Sponsor A Duplicate", "logo_url": "/uploads/a.png"},
    ]

    assert dedupe_public_sponsors(sponsors) == [{**sponsors[0], "since_year": None, "until_year": None}]


def test_public_view_strips_contacts_notes_and_dolibarr_references_but_keeps_the_years():
    # #405: Kontaktdaten, Notizen und Dolibarr-Verweise bleiben intern - öffentlich nur die Jahre.
    view = dedupe_public_sponsors([{
        "id": "a", "name": "Sponsor A", "logo_url": "/uploads/a.png", "contact_name": "P. Beispiel", "contact_email": "p@example.test",
        "internal_notes": "geheim", "dolibarr_id": 12, "contract_start": "2024-03-01", "contract_end": "2026-12-31", "show_on_home": True,
    }])[0]
    assert view == {"id": "a", "name": "Sponsor A", "logo_url": "/uploads/a.png", "show_on_home": True, "since_year": 2024, "until_year": 2026}
