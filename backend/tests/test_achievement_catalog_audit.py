import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from achievement_catalog import ACHIEVEMENT_GROUPS, ACHIEVEMENT_TIERS, CONDITION_KEY_STATUS


def test_catalog_codes_and_public_names_are_unique():
    group_codes = [g["code"] for g in ACHIEVEMENT_GROUPS]
    tier_codes = [t["code"] for t in ACHIEVEMENT_TIERS]
    assert len(group_codes) == len(set(group_codes))
    assert len(tier_codes) == len(set(tier_codes))

    public_group_codes = {g["code"] for g in ACHIEVEMENT_GROUPS if g.get("public") and not g.get("is_negative")}
    public_names = [t["name"] for t in ACHIEVEMENT_TIERS if t["group_code"] in public_group_codes]
    duplicates = [name for name, count in Counter(public_names).items() if count > 1]
    assert duplicates == []


def test_every_tier_references_existing_group_and_known_condition_status():
    group_codes = {g["code"] for g in ACHIEVEMENT_GROUPS}
    assert all(t["group_code"] in group_codes for t in ACHIEVEMENT_TIERS)

    used_condition_keys = {t.get("condition_key") for t in ACHIEVEMENT_TIERS if t.get("condition_key")}
    assert used_condition_keys <= set(CONDITION_KEY_STATUS)
    assert {"live", "counter", "planned"} >= set(CONDITION_KEY_STATUS.values())


def test_live_progress_targets_are_monotonic_within_group():
    by_group_and_key = defaultdict(list)
    for tier in ACHIEVEMENT_TIERS:
        key = tier.get("condition_key")
        if not key or CONDITION_KEY_STATUS.get(key) != "live":
            continue
        by_group_and_key[(tier["group_code"], key)].append(tier)

    for (group_code, key), tiers in by_group_and_key.items():
        ordered = sorted(tiers, key=lambda t: t["level"])
        targets = [int(t.get("progress_target") or 0) for t in ordered]
        assert targets == sorted(targets), f"{group_code}/{key} targets are not monotonic: {targets}"


def test_membership_tenure_is_marked_member_only():
    membership_tiers = [t for t in ACHIEVEMENT_TIERS if t["group_code"] == "membership_tenure"]
    assert membership_tiers
    assert all(t.get("member_only") is True for t in membership_tiers)


def test_level_progression_has_long_term_milestones():
    tiers = [t for t in ACHIEVEMENT_TIERS if t["group_code"] == "level_progression"]
    targets = {t["code"]: t["progress_target"] for t in tiers}
    assert targets["level_progression_10"] == 8100
    assert targets["level_progression_15"] == 19600
    assert targets["level_progression_20"] == 36100
