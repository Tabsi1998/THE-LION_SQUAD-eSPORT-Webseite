
export function dateInputValue(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function profileToForm(user) {
  return {
    // basic
    display_name: user.display_name || "",
    first_name: user.first_name || "",
    last_name: user.last_name || "",
    bio: user.bio || "",
    birth_date: dateInputValue(user.birth_date),
    gender: user.gender || "",
    country: user.country || "",
    city: user.city || "",
    avatar_url: user.avatar_url || "",
    banner_url: user.banner_url || "",
    // gaming
    favorite_games: (user.favorite_games || []).join(", "),
    main_platform: user.main_platform || "",
    main_platforms: user.main_platforms || (user.main_platform ? [user.main_platform] : []),
    preferred_role: user.preferred_role || "",
    input_device: user.input_device || "",
    input_devices: user.input_devices || (user.input_device ? [user.input_device] : []),
    gaming_subscriptions: user.gaming_subscriptions || [],
    game_ids: user.game_ids || {},
    // socials
    discord_name: user.discord_name || "",
    twitch_handle: user.twitch_handle || "",
    show_twitch_embed: user.show_twitch_embed ?? false,
    youtube_handle: user.youtube_handle || "",
    tiktok_handle: user.tiktok_handle || "",
    instagram_handle: user.instagram_handle || "",
    x_handle: user.x_handle || "",
    steam_id: user.steam_id || "",
    epic_id: user.epic_id || "",
    psn_id: user.psn_id || "",
    xbox_id: user.xbox_id || "",
    nintendo_fc: user.nintendo_fc || user.switch_code || "",
    ea_id: user.ea_id || "",
    riot_id: user.riot_id || "",
    battlenet_id: user.battlenet_id || "",
    faceit_handle: user.faceit_handle || "",
    startgg_handle: user.startgg_handle || "",
    roblox_handle: user.roblox_handle || "",
    osu_handle: user.osu_handle || "",
    lichess_handle: user.lichess_handle || "",
    github_handle: user.github_handle || "",
    kick_handle: user.kick_handle || "",
    reddit_handle: user.reddit_handle || "",
    spotify_handle: user.spotify_handle || "",
    threads_handle: user.threads_handle || "",
    facebook_handle: user.facebook_handle || "",
    linkedin_handle: user.linkedin_handle || "",
    snapchat_handle: user.snapchat_handle || "",
    pinterest_handle: user.pinterest_handle || "",
    telegram_handle: user.telegram_handle || "",
    wargaming_handle: user.wargaming_handle || "",
    bungie_handle: user.bungie_handle || "",
    mastodon_handle: user.mastodon_handle || "",
    bluesky_handle: user.bluesky_handle || "",
    website: user.website || "",
    // privacy
    privacy_public_profile: user.privacy_public_profile ?? true,
    newsletter_consent: !!user.newsletter_consent,
    notification_preferences: user.notification_preferences || {},
    profile_visibility: user.profile_visibility || {},
    dm_privacy: user.dm_privacy || "everyone",
  };
}

export function profileFormPayload(form) {
  const payload = { ...(form || {}) };
  if (!payload.gender) payload.gender = null;
  if (typeof payload.favorite_games === "string") {
    payload.favorite_games = payload.favorite_games
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return payload;
}

export function flattenAchievementTiers(data) {
  return (data?.groups || []).flatMap((group) =>
    (group.tiers || []).map((tier) => ({
      ...tier,
      group_code: group.code,
      group_name: group.name,
      group_category: group.category,
      group_accent: group.accent_color || "#29B6E8",
    }))
  );
}

export function achievementInsights(data) {
  const tiers = flattenAchievementTiers(data);
  const earned = tiers.filter((tier) => tier.earned);
  const openProgress = tiers
    .filter((tier) => !tier.earned && !tier.manual_only && tier.condition_status !== "planned" && Number(tier.target || 0) > 0)
    .sort((a, b) => {
      const byPercent = Number(b.percent || 0) - Number(a.percent || 0);
      if (byPercent) return byPercent;
      const aMissing = Number(a.target || 0) - Number(a.current || 0);
      const bMissing = Number(b.target || 0) - Number(b.current || 0);
      if (aMissing !== bMissing) return aMissing - bMissing;
      return Number(b.points || 0) - Number(a.points || 0);
    });
  const manual = tiers.filter((tier) => !tier.earned && tier.manual_only);
  const planned = tiers.filter((tier) => !tier.earned && tier.condition_status === "planned");
  const points = (data?.awards || []).reduce((sum, award) => sum + Number(award.points || 0), 0);
  return {
    tiers,
    earned,
    openProgress,
    manual,
    planned,
    points,
    total: tiers.length,
    earnedPercent: tiers.length ? Math.round((earned.length / tiers.length) * 100) : 0,
  };
}

