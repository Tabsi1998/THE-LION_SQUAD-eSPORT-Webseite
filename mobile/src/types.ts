export type User = {
  id: string;
  email: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  discord_name?: string | null;
  game_ids?: Record<string, Record<string, string>>;
  role?: string;
  user_type?: string;
  is_club_member?: boolean;
  is_tournament_staff?: boolean;
  membership?: Record<string, unknown> | null;
};

export type AuthResponse = {
  user: User;
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
};

export type Tournament = {
  id: string;
  title: string;
  slug: string;
  status?: string;
  game_name?: string;
  game?: {
    name?: string;
    display_name?: string;
    logo_url?: string | null;
    cover_url?: string | null;
    slug?: string;
    identity_game_name?: string;
    identity_game_slug?: string;
    effective_player_id_fields?: Array<{ key: string; label?: string; required?: boolean; help_text?: string }>;
    player_id_fields?: Array<{ key: string; label?: string; required?: boolean; help_text?: string }>;
  };
  event?: { name?: string; location?: string; start_date?: string | null } | null;
  description?: string | null;
  platform?: string | null;
  max_participants?: number | null;
  participant_count?: number;
  format_label?: string;
  public_phase?: { countdown_kind?: string | null; label?: string; state?: string; target_at?: string | null };
  start_date?: string | null;
  end_date?: string | null;
  registration_enabled?: boolean;
  registration_open_from?: string | null;
  registration_open_until?: string | null;
  check_in_from?: string | null;
  check_in_until?: string | null;
  is_invite_only?: boolean;
  block_club_member_registration?: boolean;
  team_mode?: string;
  team_size?: number;
  show_chat?: boolean;
  banner_url?: string | null;
  format?: string;
  participants?: string[];
  matches?: Match[];
  standings?: Array<{ rank: number; name: string; points?: number; result?: string }>;
  rules?: string[] | string;
  prize_pool?: string | null;
  prize_places?: Array<{ place?: number; label?: string; value?: string }> | null;
  prizes?: string[];
  my_registration?: { id?: string; status?: string; display_name?: string | null; ingame_name?: string | null; team_id?: string | null; user_id?: string | null } | null;
};

export type Team = {
  id: string;
  name: string;
  tag?: string;
  description?: string | null;
  logo_url?: string | null;
  banner_url?: string | null;
  discord_link?: string | null;
  join_code?: string | null;
  is_public?: boolean;
  is_member?: boolean;
  member_count?: number;
  squad_count?: number;
  leader?: { id: string; username?: string; display_name?: string; avatar_url?: string | null };
  leader_id?: string | null;
  co_leader_ids?: string[];
  member_ids?: string[];
  can_manage?: boolean;
  my_role?: string;
  members?: Array<{ id: string; name?: string; username?: string; display_name?: string; role?: string; avatar_url?: string | null; achievements?: string[] }>;
  squads?: TeamSquad[];
  chat_preview?: Array<{ author: string; message: string; time: string }>;
};

export type TeamSquad = {
  id?: string;
  team_id?: string;
  name: string;
  description?: string | null;
  tournament_id?: string | null;
  season_id?: string | null;
  game_id?: string | null;
  game?: string | null;
  record?: string | null;
  member_ids?: string[];
  members?: Array<{ id: string; username?: string; display_name?: string; avatar_url?: string | null }>;
  status?: "active" | "archived" | string;
};

export type TeamInvite = {
  id: string;
  team_id: string;
  user_id: string;
  status?: string;
  created_at?: string;
  team?: Pick<Team, "id" | "name" | "tag" | "logo_url"> | null;
  inviter?: { id?: string; username?: string; display_name?: string; avatar_url?: string | null } | null;
};

export type Match = {
  id: string;
  status?: string;
  scheduled_at?: string | null;
  tournament_id?: string | null;
  tournament_title?: string | null;
  opponent_name?: string | null;
  round?: number | string | null;
  round_name?: string | null;
};

export type Achievement = {
  code: string;
  name: string;
  tier: string;
  points: number;
  accent: string;
};

export type Reference = {
  id: string;
  title: string;
  game: string;
  placement: string;
  mode: string;
  date: string;
};

export type Sponsor = {
  id: string;
  name: string;
  tier: string;
  url?: string;
  link?: string;
  logo_url?: string | null;
  description: string;
};

export type Partner = {
  id: string;
  name: string;
  kind: string;
  url?: string;
  link?: string;
  logo_url?: string | null;
  description: string;
};

export type ClubEvent = {
  id: string;
  title: string;
  name?: string;
  slug?: string;
  type?: string;
  event_type?: string;
  date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  location?: string | null;
  city?: string | null;
  country?: string | null;
  status?: string;
  banner_url?: string | null;
  public_phase?: { countdown_kind?: string | null; label?: string; state?: string; target_at?: string | null };
  has_registration?: boolean;
  registration_url?: string | null;
  registration_opens_at?: string | null;
  registration_closes_at?: string | null;
  allow_companions?: boolean;
  max_companions_per_registration?: number | null;
  own_registration?: { id?: string; status?: string; display_name?: string | null; companion_count?: number; seat_count?: number } | null;
  content_embeds?: ContentEmbed[];
};

export type NewsPost = {
  id: string;
  title: string;
  slug?: string;
  excerpt?: string;
  summary?: string;
  content?: string;
  body?: string;
  category?: string;
  banner_url?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  pinned?: boolean;
  linked_events?: ClubEvent[];
  linked_f1_challenges?: F1Challenge[];
  linked_tournaments?: Tournament[];
  content_embeds?: ContentEmbed[];
  mentioned_users?: PublicUser[];
};

export type ContentEmbed = {
  token: string;
  kind: "event" | "fastlap" | "tournament" | string;
  ref: string;
  item?: {
    id?: string;
    slug?: string;
    title?: string;
    name?: string;
    description?: string | null;
    start_date?: string | null;
    status?: string;
    banner_url?: string | null;
    track_image_url?: string | null;
    track?: { id?: string; slug?: string; name?: string; image_url?: string | null } | null;
    location?: string | null;
    public_phase?: { countdown_kind?: string | null; label?: string; state?: string; target_at?: string | null };
  } | null;
};

export type DashboardAction = {
  id: string;
  type: string;
  label: string;
  detail?: string | null;
  target_type?: "tournament" | "event" | "match" | string;
  target_id?: string | null;
  priority?: number;
};

export type MobileDashboardData = {
  me: {
    tournaments: Tournament[];
    events: ClubEvent[];
    matches: Match[];
    actions: DashboardAction[];
  };
  public: {
    tournaments: Tournament[];
    events: ClubEvent[];
  };
  news: NewsPost[];
  streams: LiveStream[];
  stats: {
    my_tournaments: number;
    my_events: number;
    open_matches: number;
    open_actions: number;
    news: number;
    public_tournaments: number;
    public_events: number;
    live_streams: number;
  };
};

export type LiveStream = {
  user_id?: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  twitch_login?: string | null;
  title?: string | null;
  game_name?: string | null;
  viewer_count?: number;
  thumbnail_url?: string | null;
  stream_url?: string | null;
  public_profile_url?: string | null;
  member_profile?: {
    id?: string;
    slug?: string;
    display_name?: string | null;
    gamertag?: string | null;
    photo_url?: string | null;
  } | null;
};

export type PersonalReferenceItem = {
  id: string;
  kind: "tournament" | "fastlap" | string;
  title: string;
  subtitle?: string | null;
  rank?: number | null;
  points?: number | null;
  status?: string | null;
  date?: string | null;
  target_id?: string | null;
  banner_url?: string | null;
  participant_count?: number | null;
  time_ms?: number | null;
  time_str?: string | null;
};

export type PersonalReferenceData = {
  items: PersonalReferenceItem[];
  stats: {
    total: number;
    tournaments: number;
    fastlaps: number;
    wins: number;
    podiums: number;
    season_points: number;
  };
};

export type F1Track = {
  id: string;
  name?: string;
  country?: string | null;
  image_url?: string | null;
  order_index?: number;
};

export type F1Challenge = {
  id: string;
  slug?: string;
  title: string;
  description?: string | null;
  status?: string;
  public_phase?: { countdown_kind?: string | null; label?: string; state?: string; target_at?: string | null };
  online_registration_enabled?: boolean;
  registration_enabled?: boolean;
  registration_open_from?: string | null;
  registration_open_until?: string | null;
  block_club_member_results?: boolean;
  allow_club_reference_times?: boolean;
  show_club_reference_times?: boolean;
  start_date?: string | null;
  end_date?: string | null;
  banner_url?: string | null;
  vehicle?: string | null;
  weather?: string | null;
  platform?: string | null;
  participant_count?: number;
  track_count?: number;
  tracks?: F1Track[];
  can_manage_times?: boolean;
};

export type F1LeaderboardEntry = {
  user_id: string;
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
  time_ms?: number;
  time_str?: string;
  raw_time_ms?: number;
  penalty_seconds?: number;
  attempts?: number;
  rank?: number;
  gap_str?: string;
  points?: number;
};

export type F1LeaderboardPayload = {
  challenge: F1Challenge;
  track?: F1Track | null;
  entries: F1LeaderboardEntry[];
  club_reference_entries?: F1LeaderboardEntry[];
  club_reference_public?: boolean;
};

export type MemberBenefit = {
  id: string;
  title: string;
  category: string;
  description: string;
  memberOnly: boolean;
};

export type PublicProfile = {
  id: string;
  name: string;
  username: string;
  role: string;
  games: string[];
  achievements: Achievement[];
};

export type PublicUser = {
  id: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  role?: string;
  is_club_member?: boolean;
  can_message?: boolean;
  message_hint?: string;
};

export type ChatMessage = {
  id: string;
  message: string;
  created_at?: string;
  user_id?: string;
  sender_id?: string;
  recipient_id?: string;
  author?: PublicUser | null;
  sender?: PublicUser | null;
  recipient?: PublicUser | null;
  read_at?: string | null;
};

export type DirectConversation = {
  user: PublicUser;
  latest_message?: ChatMessage;
  unread_count?: number;
  can_send?: boolean;
  message_hint?: string;
};

export type DirectThread = {
  user: PublicUser;
  can_send?: boolean;
  message_hint?: string;
  messages: ChatMessage[];
};

export type UserNotification = {
  id: string;
  kind?: string;
  title: string;
  body?: string;
  url?: string;
  read?: boolean;
  created_at?: string;
  meta?: Record<string, unknown>;
};
