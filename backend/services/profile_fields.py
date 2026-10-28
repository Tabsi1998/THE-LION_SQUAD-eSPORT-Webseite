"""Die Profilfelder, die die Person selbst leeren kann (#2118) - ein Blatt-Modul ohne Abhängigkeiten.

``routes/user_routes.py`` lässt beim Speichern des eigenen Profils für diese Felder auch ``null`` zu, und
``services/account_erasure.py`` entfernt sie (samt allen Feldern des Profilformulars) beim Löschen des Kontos.
"""

USER_NULLABLE_FIELDS = frozenset({
    "display_name", "avatar_url", "banner_url", "bio", "first_name", "last_name",
    "nickname", "birth_date", "gender", "country", "state", "city", "favorite_games",
    "main_platform", "main_platforms", "preferred_role", "input_device",
    "input_devices", "gaming_subscriptions", "website", "game_ids", "discord_name",
    "discord_id", "switch_code", "steam_id", "epic_id", "psn_id", "xbox_id",
    "riot_id", "twitch_handle", "youtube_handle", "tiktok_handle",
    "instagram_handle", "x_handle", "nintendo_fc", "ea_id", "battlenet_id",
    "faceit_handle", "startgg_handle", "roblox_handle", "osu_handle", "lichess_handle", "github_handle", "kick_handle",
    "reddit_handle", "spotify_handle", "threads_handle", "facebook_handle", "linkedin_handle", "snapchat_handle",
    "pinterest_handle", "telegram_handle", "wargaming_handle", "bungie_handle", "mastodon_handle", "bluesky_handle",
    "profile_visibility", "dm_privacy",
})
