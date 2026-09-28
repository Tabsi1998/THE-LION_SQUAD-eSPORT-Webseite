"""Erfolgskatalog (#611): der alte Katalog v4 (``legacy``) mit der neuen Stufenleiter aus ``materials``
versehen - jede Stufe trägt Material, Rang, Namen und Farbe, jede Gruppe eine Kategorie v2 und das
Kennzeichen ``hidden``. Die Kataloge A–D (#612–#615) ersetzen die alten Gruppen Stück für Stück; die
Abbildung alt → neu steht in ``migration_map`` und wird beim Start angewendet.
"""
from .legacy import (  # noqa: F401 - Namen bleiben für alle Aufrufer gleich
    ACHIEVEMENT_GROUPS, ACHIEVEMENT_TIERS, CONDITION_KEY_STATUS, CATEGORY_OVERRIDES,
    DEPRECATED_GROUP_CODES, SPECIAL_GROUP_POLISH, SPECIAL_TIER_POLISH,
)
from .materials import (  # noqa: F401
    CATEGORIES, LADDERS, LEGACY_CATEGORY_MAP, MATERIALS, MATERIAL_ORDER, annotate_group, annotate_tier,
    category_v2, ladder_targets, legacy_level, material_color, material_color_int, material_for_legacy,
    material_name, material_points, material_rank, tier,
)
from .migration_map import GROUP_MAPPING  # noqa: F401

# Zähler aus services/achievement_counters.py (#616): alle live, die Prüfung verlangt bekannte Schlüssel.
COUNTER_KEYS_V2 = (
    "halloween_pumpkin", "snowflakes_clicked", "online_at_new_year", "konami_found", "lost_404", "logo_clicks", "explorer_done",
    "calendar_subscribed", "member_card_added", "app_days", "onboarding_completed", "advent_doors_opened", "easter_eggs_found",
    "discord_linked", "twitch_linked", "youtube_linked", "tiktok_linked", "linked_accounts", "avatar_and_banner", "bio_and_socials",
    "email_verified", "passkey_registered", "notification_prefs_saved", "privacy_reviewed", "newsletter_subscribed", "push_enabled",
    "account_years", "login_streak_max", "level", "prestige_stars", "birthday_logins", "hidden_unlocked", "categories_completed",
    "prizes_received", "tournaments_staffed_completed", "seed_one_count", "tournaments_completed", "fast_registrations", "first_checkins",
    "top8_finishes", "finals_played", "matches_before_9", "matches_after_23", "weekend_matches", "same_opponent_max", "upsets",
    "commendations_received", "commendations_given", "team_size_max", "team_profile_complete", "captain_days", "team_level_max",
    "team_tournaments_played", "events_hosted_completed", "club_events_attended", "season_top10_finishes", "season_wins", "news_read",
    "streams_watched", "reports_actioned",
)
CONDITION_KEY_STATUS.update({key: "live" for key in COUNTER_KEYS_V2})

# Alte Kategorienamen in den Überschreibungen → neue (Streaming & Content → Creator, Fortschritt → Profil).
for _code, _category in list(CATEGORY_OVERRIDES.items()):
    CATEGORY_OVERRIDES[_code] = LEGACY_CATEGORY_MAP.get(_category, _category)


def apply_category_overrides(group: dict) -> dict:
    """Die Gruppe mit ihrer Kategorie v2 und dem Kennzeichen ``hidden`` - ohne das Original zu ändern."""
    override = CATEGORY_OVERRIDES.get(group.get("code"))
    out = {**group, "category": override} if override else dict(group)
    return annotate_group(out)


_GROUPS_BY_CODE = {g["code"]: g for g in ACHIEVEMENT_GROUPS}
for _tier in ACHIEVEMENT_TIERS:
    _tier.update(annotate_tier(_tier, _GROUPS_BY_CODE.get(_tier.get("group_code"))))

GROUP_BY_CODE = {g["code"]: g for g in ACHIEVEMENT_GROUPS}
TIER_BY_CODE = {t["code"]: t for t in ACHIEVEMENT_TIERS}
