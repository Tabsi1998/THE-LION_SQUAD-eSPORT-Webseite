import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from achievement_catalog import ACHIEVEMENT_GROUPS, ACHIEVEMENT_TIERS


def test_streamer_path_catalog_is_seeded():
    group = next((g for g in ACHIEVEMENT_GROUPS if g["code"] == "streamer_path"), None)
    assert group is not None
    assert group["public"] is True
    assert group["accent_color"] == "#9146FF"

    tiers = [t for t in ACHIEVEMENT_TIERS if t["group_code"] == "streamer_path"]
    codes = {t["code"] for t in tiers}
    assert {"streamer_first_live", "streamer_regular", "streamer_marathon", "streamer_prime"} <= codes
    assert {t["condition_key"] for t in tiers} == {"twitch_live_sessions", "twitch_stream_minutes"}


def test_achievement_catalog_codes_are_unique():
    group_codes = [g["code"] for g in ACHIEVEMENT_GROUPS]
    tier_codes = [t["code"] for t in ACHIEVEMENT_TIERS]
    assert len(group_codes) == len(set(group_codes))
    assert len(tier_codes) == len(set(tier_codes))
