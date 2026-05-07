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

    assert dedupe_public_sponsors(sponsors) == [sponsors[0]]
