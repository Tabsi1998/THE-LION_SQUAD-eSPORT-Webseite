import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from achievement_catalog import ACHIEVEMENT_GROUPS, ACHIEVEMENT_TIERS


def test_streamer_catalog_is_seeded():
    # Seit Katalog C (#614): „Streamer“ zählt Live-Sessions, „Sendezeit“ die Minuten - beide im Creator-Lila.
    for code, key in (("twitch_sessions", "twitch_live_sessions"), ("twitch_minutes", "twitch_stream_minutes")):
        group = next((g for g in ACHIEVEMENT_GROUPS if g["code"] == code), None)
        assert group is not None, code
        assert group["public"] is True
        assert group["accent_color"] == "#9146FF"
        tiers = [t for t in ACHIEVEMENT_TIERS if t["group_code"] == code]
        assert len(tiers) == 7
        assert {t["condition_key"] for t in tiers} == {key}
    assert not any(g["code"] == "streamer_path" for g in ACHIEVEMENT_GROUPS), "abgelöst"


def test_achievement_catalog_codes_are_unique():
    group_codes = [g["code"] for g in ACHIEVEMENT_GROUPS]
    tier_codes = [t["code"] for t in ACHIEVEMENT_TIERS]
    assert len(group_codes) == len(set(group_codes))
    assert len(tier_codes) == len(set(tier_codes))
