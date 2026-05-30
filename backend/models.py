"""Pydantic v2 models for THE LION SQUAD eSports."""
from pydantic import BaseModel, Field, EmailStr, ConfigDict, field_validator
from typing import Optional, List, Literal, Any, Dict
from datetime import datetime, timezone, date
import uuid

MIN_PASSWORD_LENGTH = 10


def now_utc():
    return datetime.now(timezone.utc)


def new_id():
    return str(uuid.uuid4())


# ---------- Users ----------
# Backward compatible Role - keeps old roles as primary key, additional roles via roles[] array
Role = Literal["player", "team_leader", "moderator", "tournament_admin", "club_admin", "superadmin"]
UserType = Literal["guest", "community_user", "club_member"]
VisibilityLevel = Literal["public", "community", "members", "admins", "private"]
DirectMessagePrivacy = Literal["everyone", "friends", "team_members", "club_members", "admins_only", "none"]


class UserRegister(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    email: EmailStr
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=128)
    display_name: Optional[str] = None
    birth_date: Optional[str] = None  # ISO date string
    gender: Optional[Literal["male", "female", "diverse"]] = None
    discord_name: Optional[str] = None
    accept_privacy: bool = Field(..., description="Must be explicitly true")
    accept_terms: bool = Field(..., description="Must be explicitly true")
    newsletter_consent: bool = False  # explicitly opt-in, not auto-checked


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class AdminUserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    email: EmailStr
    password: Optional[str] = Field(default=None, min_length=MIN_PASSWORD_LENGTH, max_length=128)
    display_name: Optional[str] = None
    gender: Optional[Literal["male", "female", "diverse"]] = None
    role: Role = "player"
    is_active: bool = True
    privacy_public_profile: bool = True
    send_invite: bool = True


class UserUpdate(BaseModel):
    """Profile update - all optional, both basic and extended fields."""
    # Basic
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    banner_url: Optional[str] = None
    bio: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    nickname: Optional[str] = None
    birth_date: Optional[str] = None
    gender: Optional[Literal["male", "female", "diverse"]] = None
    country: Optional[str] = None
    state: Optional[str] = None
    city: Optional[str] = None
    # Gaming meta
    favorite_games: Optional[List[str]] = None
    main_platform: Optional[str] = None  # PC / PS5 / Xbox / Switch / Mobile
    main_platforms: Optional[List[str]] = None  # multi-select
    preferred_role: Optional[str] = None
    input_device: Optional[str] = None  # legacy single value
    input_devices: Optional[List[str]] = None  # multi-select: keyboard_mouse / controller / wheel / mobile_touch / arcade
    gaming_subscriptions: Optional[List[str]] = None  # nintendo_online, ea_play, ps_plus, xbox_game_pass, ubisoft_plus, ea_pro, gog_galaxy
    website: Optional[str] = None
    game_ids: Optional[Dict[str, Dict[str, str]]] = None  # game_slug -> field_key -> value
    # Public profile features
    show_twitch_embed: Optional[bool] = None  # show live twitch on public profile
    # Socials (legacy fields for compatibility)
    discord_name: Optional[str] = None
    discord_id: Optional[str] = None
    switch_code: Optional[str] = None
    steam_id: Optional[str] = None
    epic_id: Optional[str] = None
    psn_id: Optional[str] = None
    xbox_id: Optional[str] = None
    riot_id: Optional[str] = None
    # New socials
    twitch_handle: Optional[str] = None
    youtube_handle: Optional[str] = None
    tiktok_handle: Optional[str] = None
    instagram_handle: Optional[str] = None
    x_handle: Optional[str] = None
    nintendo_fc: Optional[str] = None
    ea_id: Optional[str] = None
    battlenet_id: Optional[str] = None
    # Privacy
    privacy_public_profile: Optional[bool] = None
    profile_visibility: Optional[Dict[str, VisibilityLevel]] = None  # field_name -> level
    dm_privacy: Optional[DirectMessagePrivacy] = None
    newsletter_consent: Optional[bool] = None
    notification_preferences: Optional[Dict[str, bool]] = None


class UserPublic(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    username: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    role: Role = "player"
    roles: List[str] = []
    user_type: UserType = "community_user"
    discord_name: Optional[str] = None
    country: Optional[str] = None
    favorite_games: List[str] = []
    privacy_public_profile: bool = True
    is_active: bool = True
    is_banned: bool = False
    created_at: Optional[datetime] = None


# ---------- Membership ----------
MemberStatus = Literal[
    "none", "pending", "active", "inactive", "honorary", "former", "blocked"
]
MembershipType = Literal[
    "ordinary", "supporting", "honorary", "youth", "guest", "former"
]
MemberSincePrecision = Literal["year", "month", "day"]


class MembershipUpdate(BaseModel):
    """Admin sets / updates a user's membership."""
    member_status: Optional[MemberStatus] = None
    membership_type: Optional[MembershipType] = None
    member_number: Optional[str] = None
    member_since: Optional[str] = None  # ISO date
    member_since_precision: Optional[MemberSincePrecision] = None
    internal_role: Optional[str] = None
    notes: Optional[str] = None
    show_member_number_publicly: Optional[bool] = None


class MemberBenefitCreate(BaseModel):
    title: str
    description: Optional[str] = None
    category: Optional[str] = None
    image_url: Optional[str] = None
    link_url: Optional[str] = None
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    visible_for_membership_types: List[str] = []  # empty = all members
    is_active: bool = True
    order_index: int = 0


class MemberBenefitUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    image_url: Optional[str] = None
    link_url: Optional[str] = None
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    visible_for_membership_types: Optional[List[str]] = None
    is_active: Optional[bool] = None
    order_index: Optional[int] = None


# ---------- User Socials (separate table for fine-grained visibility) ----------
SocialPlatform = Literal[
    "discord", "twitch", "youtube", "tiktok", "instagram", "x", "steam",
    "epic", "psn", "xbox", "nintendo", "ea", "riot", "battlenet", "website"
]


class UserSocialCreate(BaseModel):
    platform: SocialPlatform
    value: str
    url: Optional[str] = None
    visibility: VisibilityLevel = "public"


class UserSocialUpdate(BaseModel):
    value: Optional[str] = None
    url: Optional[str] = None
    visibility: Optional[VisibilityLevel] = None


class ForgotPasswordBody(BaseModel):
    email: EmailStr


class ResetPasswordBody(BaseModel):
    token: str
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=128)


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=128)


# ---------- Teams ----------
class TeamCreate(BaseModel):
    name: str
    tag: str = Field(min_length=2, max_length=8)
    description: Optional[str] = None
    logo_url: Optional[str] = None
    banner_url: Optional[str] = None
    discord_link: Optional[str] = None


class TeamUpdate(BaseModel):
    name: Optional[str] = None
    tag: Optional[str] = None
    description: Optional[str] = None
    logo_url: Optional[str] = None
    banner_url: Optional[str] = None
    discord_link: Optional[str] = None
    social_links: Optional[dict] = None


# ---------- Games ----------
GameKind = Literal["standalone", "series", "edition"]


class GameCreate(BaseModel):
    name: str
    slug: Optional[str] = None
    kind: GameKind = "standalone"
    parent_game_id: Optional[str] = None
    identity_source_game_id: Optional[str] = None
    inherit_player_ids: bool = True
    short_name: Optional[str] = None
    logo_url: Optional[str] = None
    cover_url: Optional[str] = None
    platforms: List[str] = []
    genre: Optional[str] = None
    supports_solo: bool = True
    supports_teams: bool = True
    supports_ffa: bool = False
    supports_time_trial: bool = False
    supports_grand_prix: bool = False
    default_team_size: int = 1
    default_format: str = "single_elim"
    player_id_fields: List[dict] = []


class GameUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    kind: Optional[GameKind] = None
    parent_game_id: Optional[str] = None
    identity_source_game_id: Optional[str] = None
    inherit_player_ids: Optional[bool] = None
    short_name: Optional[str] = None
    logo_url: Optional[str] = None
    cover_url: Optional[str] = None
    platforms: Optional[List[str]] = None
    genre: Optional[str] = None
    supports_solo: Optional[bool] = None
    supports_teams: Optional[bool] = None
    supports_ffa: Optional[bool] = None
    supports_time_trial: Optional[bool] = None
    supports_grand_prix: Optional[bool] = None
    default_team_size: Optional[int] = None
    default_format: Optional[str] = None
    player_id_fields: Optional[List[dict]] = None


# ---------- Events ----------
EventType = Literal[
    "club_evening", "lan_party", "public_event", "community_evening",
    "grill_evening", "mario_kart_event", "f1_event", "expo", "online_event",
    "internal", "sponsor_action", "tournament_finals", "general",
]
EventStatus = Literal[
    "draft", "scheduled", "registration_open", "registration_closed",
    "checkin_open", "live", "paused", "completed", "results_published",
    "archived", "cancelled",
]
EventVisibility = Literal["public", "community", "members", "internal"]


class EventCreate(BaseModel):
    name: str
    slug: Optional[str] = None
    description: Optional[str] = None
    event_type: EventType = "general"
    visibility: EventVisibility = "public"
    status: EventStatus = "draft"
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    door_time: Optional[datetime] = None
    registration_opens_at: Optional[datetime] = None
    registration_closes_at: Optional[datetime] = None
    has_registration: bool = False
    registration_url: Optional[str] = None
    allow_companions: bool = False
    max_companions_per_registration: int = Field(0, ge=0, le=20)
    location: Optional[str] = None
    address: Optional[str] = None
    postal_code: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    show_map: bool = True
    organizer_name: Optional[str] = None
    organizer_url: Optional[str] = None
    owned_by_club: bool = True
    show_sponsors: bool = True
    sponsor_ids: List[str] = []
    is_online: bool = False
    is_hybrid: bool = False
    banner_url: Optional[str] = None
    contact: Optional[str] = None
    max_participants: Optional[int] = None
    show_participants: bool = True
    program: Optional[str] = None  # markdown / freitext mit Tagesablauf
    has_live_stream: bool = False
    stream_platform: Optional[str] = None
    stream_url: Optional[str] = None


class EventUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    event_type: Optional[EventType] = None
    visibility: Optional[EventVisibility] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    door_time: Optional[datetime] = None
    registration_opens_at: Optional[datetime] = None
    registration_closes_at: Optional[datetime] = None
    has_registration: Optional[bool] = None
    registration_url: Optional[str] = None
    allow_companions: Optional[bool] = None
    max_companions_per_registration: Optional[int] = Field(default=None, ge=0, le=20)
    location: Optional[str] = None
    address: Optional[str] = None
    postal_code: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    show_map: Optional[bool] = None
    organizer_name: Optional[str] = None
    organizer_url: Optional[str] = None
    owned_by_club: Optional[bool] = None
    show_sponsors: Optional[bool] = None
    sponsor_ids: Optional[List[str]] = None
    is_online: Optional[bool] = None
    is_hybrid: Optional[bool] = None
    banner_url: Optional[str] = None
    contact: Optional[str] = None
    max_participants: Optional[int] = None
    show_participants: Optional[bool] = None
    program: Optional[str] = None
    has_live_stream: Optional[bool] = None
    stream_platform: Optional[str] = None
    stream_url: Optional[str] = None
    status: Optional[EventStatus] = None


EventRegistrationStatus = Literal["registered", "waitlist", "checked_in", "cancelled", "no_show"]


class EventRegistrationCreate(BaseModel):
    companion_count: int = Field(0, ge=0, le=20)
    note: Optional[str] = Field(default=None, max_length=500)


class EventRegistrationUpdate(BaseModel):
    status: Optional[EventRegistrationStatus] = None
    companion_count: Optional[int] = Field(default=None, ge=0, le=20)
    note: Optional[str] = Field(default=None, max_length=500)
    internal_note: Optional[str] = Field(default=None, max_length=1000)


# ---------- Tournaments ----------
TournamentFormat = Literal[
    "single_elim", "double_elim", "round_robin", "swiss",
    "groups", "ffa", "battle_royale", "league", "time_trial", "grand_prix",
    "custom_bracket", "ffa_custom_bracket",
]
# Unified status vocabulary across Events / Tournaments / Challenges / Fast-Lap.
# `scheduled` = announced but not open/live yet.
TournamentStatus = Literal[
    "draft", "scheduled", "registration_open", "registration_closed",
    "check_in", "live", "paused", "completed", "results_published",
    "archived", "cancelled",
]
TeamMode = Literal["solo", "team"]
StreamPlatform = Literal["twitch", "youtube", "kick", "custom"]
TournamentEventMode = Literal["local", "online", "hybrid"]
TournamentResultEntryMode = Literal["staff_only", "player_confirmed", "hybrid"]
TournamentScheduleMode = Literal["fixed_by_staff", "player_proposal", "hybrid"]


def _empty_stream_platform_to_none(value):
    if value == "":
        return None
    return value


class TournamentCreate(BaseModel):
    title: str
    slug: Optional[str] = None
    description: Optional[str] = None
    game_id: str
    platform: Optional[str] = None
    event_id: Optional[str] = None
    format: TournamentFormat = "single_elim"
    format_label: Optional[str] = None
    team_mode: TeamMode = "solo"
    team_size: int = 1
    substitutes_allowed: bool = False
    max_participants: int = 32
    min_participants: int = 2
    registration_enabled: bool = True
    block_club_member_registration: bool = False
    registration_open_from: Optional[datetime] = None
    registration_open_until: Optional[datetime] = None
    check_in_from: Optional[datetime] = None
    check_in_until: Optional[datetime] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    is_public: bool = True
    is_invite_only: bool = False
    rules: Optional[str] = None
    prize_pool: Optional[str] = None
    prize_places: Optional[List[dict]] = None  # [{"group":"overall|winner|loser","place":1,"label":"1. Platz","value":"…"}]
    best_of: int = 1
    bronze_match: bool = False
    match_duration_minutes: int = 30
    stream_link: Optional[str] = None
    twitch_channel: Optional[str] = None
    twitch_enabled: bool = False
    discord_link: Optional[str] = None
    location: Optional[str] = None
    banner_url: Optional[str] = None
    seeding_mode: Literal["manual", "random", "ranking"] = "random"
    # Phase 5: unified stream-per-object
    has_live_stream: bool = False
    stream_platform: Optional[StreamPlatform] = None
    stream_url: Optional[str] = None
    stream_title: Optional[str] = None
    show_chat: bool = False
    event_mode: TournamentEventMode = "online"
    result_entry_mode: Optional[TournamentResultEntryMode] = None
    schedule_mode: Optional[TournamentScheduleMode] = None
    auto_start_enabled: bool = False
    # Phase 7
    season_weight: float = 2.0
    visibility: Literal["public", "community", "members", "internal"] = "public"
    site_banner_enabled: bool = False
    # Optional initial status — admin can publish straight to 'scheduled'.
    status: Optional[TournamentStatus] = None

    _normalize_stream_platform = field_validator("stream_platform", mode="before")(_empty_stream_platform_to_none)


class TournamentUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    game_id: Optional[str] = None
    platform: Optional[str] = None
    event_id: Optional[str] = None
    format: Optional[TournamentFormat] = None
    format_label: Optional[str] = None
    status: Optional[TournamentStatus] = None
    team_mode: Optional[TeamMode] = None
    team_size: Optional[int] = None
    substitutes_allowed: Optional[bool] = None
    max_participants: Optional[int] = None
    min_participants: Optional[int] = None
    registration_enabled: Optional[bool] = None
    block_club_member_registration: Optional[bool] = None
    is_invite_only: Optional[bool] = None
    registration_open_from: Optional[datetime] = None
    registration_open_until: Optional[datetime] = None
    check_in_from: Optional[datetime] = None
    check_in_until: Optional[datetime] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    is_public: Optional[bool] = None
    rules: Optional[str] = None
    prize_pool: Optional[str] = None
    prize_places: Optional[List[dict]] = None
    best_of: Optional[int] = None
    bronze_match: Optional[bool] = None
    match_duration_minutes: Optional[int] = None
    stream_link: Optional[str] = None
    twitch_channel: Optional[str] = None
    twitch_enabled: Optional[bool] = None
    discord_link: Optional[str] = None
    location: Optional[str] = None
    banner_url: Optional[str] = None
    seeding_mode: Optional[Literal["manual", "random", "ranking"]] = None
    has_live_stream: Optional[bool] = None
    stream_platform: Optional[StreamPlatform] = None
    stream_url: Optional[str] = None
    stream_title: Optional[str] = None
    show_chat: Optional[bool] = None
    event_mode: Optional[TournamentEventMode] = None
    result_entry_mode: Optional[TournamentResultEntryMode] = None
    schedule_mode: Optional[TournamentScheduleMode] = None
    auto_start_enabled: Optional[bool] = None
    season_weight: Optional[float] = None
    visibility: Optional[Literal["public", "community", "members", "internal"]] = None
    site_banner_enabled: Optional[bool] = None

    _normalize_stream_platform = field_validator("stream_platform", mode="before")(_empty_stream_platform_to_none)


class RegistrationCreate(BaseModel):
    team_id: Optional[str] = None
    ingame_name: Optional[str] = None
    discord: Optional[str] = None
    platform_id: Optional[str] = None
    player_ids: Optional[Dict[str, str]] = None
    notes: Optional[str] = None
    accept_rules: bool = Field(..., description="Must be explicitly true")
    accept_privacy: bool = Field(..., description="Must be explicitly true")


class RegistrationUpdate(BaseModel):
    status: Optional[Literal["pending", "approved", "rejected", "waitlist", "checked_in", "no_show"]] = None
    seed: Optional[int] = None
    ingame_name: Optional[str] = None


class RegistrationAdminCreate(BaseModel):
    user_id: Optional[str] = None
    team_id: Optional[str] = None
    display_name: Optional[str] = None
    ingame_name: Optional[str] = None
    discord: Optional[str] = None
    platform_id: Optional[str] = None
    player_ids: Optional[Dict[str, str]] = None
    notes: Optional[str] = None
    status: Literal["pending", "approved", "waitlist", "checked_in"] = "approved"
    seed: Optional[int] = None
    replace_registration_id: Optional[str] = None


TournamentStaffRole = Literal["organizer", "referee", "scorekeeper", "station_manager", "stream_operator"]
TournamentStaffScope = Literal["tournament", "stage", "group", "station", "match"]


class TournamentStaffAssignmentCreate(BaseModel):
    user_id: str
    role: TournamentStaffRole
    scope: TournamentStaffScope = "tournament"
    scope_id: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool = True


class TournamentStaffAssignmentUpdate(BaseModel):
    role: Optional[TournamentStaffRole] = None
    scope: Optional[TournamentStaffScope] = None
    scope_id: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


# ---------- Tournament v2 groundwork ----------
StageMatchType = Literal["duel", "ffa"]
StageType = Literal[
    "single_elimination", "double_elimination", "custom_bracket",
    "round_robin_groups", "swiss", "league", "simple",
    "ffa_single_elimination", "ffa_custom_bracket", "ffa_league",
]
TournamentStageStatus = Literal["pending", "ready", "running", "completed", "archived"]


class TournamentStageCreate(BaseModel):
    name: str = "Stage 1"
    number: Optional[int] = None
    match_type: StageMatchType = "duel"
    stage_type: StageType = "single_elimination"
    settings: Dict[str, Any] = Field(default_factory=dict)
    status: TournamentStageStatus = "pending"


class TournamentStageUpdate(BaseModel):
    name: Optional[str] = None
    number: Optional[int] = None
    match_type: Optional[StageMatchType] = None
    stage_type: Optional[StageType] = None
    settings: Optional[Dict[str, Any]] = None
    status: Optional[TournamentStageStatus] = None


# ---------- Matches ----------
MatchStatus = Literal[
    "pending", "ready", "scheduled", "in_progress",
    "waiting_result", "disputed", "completed", "forfeit", "cancelled"
]


class MatchScoreReport(BaseModel):
    score_a: int = Field(ge=0)
    score_b: int = Field(ge=0)
    screenshot_url: Optional[str] = None
    note: Optional[str] = None


class MatchV2ResultEntry(BaseModel):
    registration_id: str
    rank: Optional[int] = Field(default=None, ge=1)
    score: Optional[float] = None
    points: Optional[float] = None
    time_ms: Optional[int] = Field(default=None, ge=0)
    dnf: bool = False
    forfeit: bool = False
    note: Optional[str] = None


class MatchV2ResultSubmit(BaseModel):
    results: List[MatchV2ResultEntry] = Field(min_length=1)
    proof_url: Optional[str] = None
    note: Optional[str] = None


ScheduleProposalAction = Literal["accept", "decline", "counter"]


class MatchScheduleProposalCreate(BaseModel):
    scheduled_at: datetime
    note: Optional[str] = None


class MatchScheduleProposalDecision(BaseModel):
    action: ScheduleProposalAction
    scheduled_at: Optional[datetime] = None
    note: Optional[str] = None


class MatchChatCreate(BaseModel):
    message: str = Field(min_length=1, max_length=1500)


class MatchUpdate(BaseModel):
    status: Optional[MatchStatus] = None
    score_a: Optional[int] = None
    score_b: Optional[int] = None
    winner_id: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    station_id: Optional[str] = None
    admin_note: Optional[str] = None
    map: Optional[str] = None
    best_of: Optional[int] = None
    duration_minutes: Optional[int] = None


class MatchV2Update(BaseModel):
    status: Optional[MatchStatus] = None
    scheduled_at: Optional[datetime] = None
    station_id: Optional[str] = None
    admin_note: Optional[str] = None
    map: Optional[str] = None
    best_of: Optional[int] = None
    duration_minutes: Optional[int] = None


class MatchDispute(BaseModel):
    reason: str


# ---------- F1 ----------
class F1TrackCreate(BaseModel):
    name: str
    image_url: Optional[str] = None
    country: Optional[str] = None
    order_index: int = 0


class F1TrackUpdate(BaseModel):
    name: Optional[str] = None
    image_url: Optional[str] = None
    country: Optional[str] = None
    order_index: Optional[int] = None


class F1ChallengeCreate(BaseModel):
    title: str
    slug: Optional[str] = None
    description: Optional[str] = None
    game_id: Optional[str] = None
    event_id: Optional[str] = None
    vehicle: Optional[str] = None
    weather: Optional[str] = None
    assists_allowed: Optional[str] = None
    controller_type: Optional[str] = None
    platform: Optional[str] = None
    max_attempts: Optional[int] = None
    unlimited_attempts: bool = True
    registration_enabled: bool = True
    block_club_member_results: bool = False
    allow_club_reference_times: bool = True
    show_club_reference_times: bool = True
    online_registration_enabled: bool = False
    registration_open_from: Optional[datetime] = None
    registration_open_until: Optional[datetime] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    is_championship: bool = False
    points_per_position: List[int] = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
    prize_places: Optional[List[dict]] = None
    banner_url: Optional[str] = None
    twitch_channel: Optional[str] = None
    twitch_enabled: bool = False
    # Unified stream-per-object (Phase 5)
    has_live_stream: bool = False
    stream_platform: Optional[StreamPlatform] = None
    stream_url: Optional[str] = None
    stream_title: Optional[str] = None
    show_chat: bool = False
    # Phase 7 weighting
    season_weight: float = 1.0  # default = "Fast-Lap-Challenge"
    visibility: Literal["public", "community", "members", "internal"] = "public"
    site_banner_enabled: bool = False
    status: Optional[TournamentStatus] = None

    _normalize_stream_platform = field_validator("stream_platform", mode="before")(_empty_stream_platform_to_none)


class F1ChallengeUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    status: Optional[TournamentStatus] = None
    event_id: Optional[str] = None
    vehicle: Optional[str] = None
    weather: Optional[str] = None
    assists_allowed: Optional[str] = None
    controller_type: Optional[str] = None
    platform: Optional[str] = None
    max_attempts: Optional[int] = None
    unlimited_attempts: Optional[bool] = None
    registration_enabled: Optional[bool] = None
    block_club_member_results: Optional[bool] = None
    allow_club_reference_times: Optional[bool] = None
    show_club_reference_times: Optional[bool] = None
    online_registration_enabled: Optional[bool] = None
    registration_open_from: Optional[datetime] = None
    registration_open_until: Optional[datetime] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    is_championship: Optional[bool] = None
    points_per_position: Optional[List[int]] = None
    prize_places: Optional[List[dict]] = None
    banner_url: Optional[str] = None
    twitch_channel: Optional[str] = None
    twitch_enabled: Optional[bool] = None
    has_live_stream: Optional[bool] = None
    stream_platform: Optional[StreamPlatform] = None
    stream_url: Optional[str] = None
    stream_title: Optional[str] = None
    show_chat: Optional[bool] = None
    season_weight: Optional[float] = None
    visibility: Optional[Literal["public", "community", "members", "internal"]] = None
    site_banner_enabled: Optional[bool] = None

    _normalize_stream_platform = field_validator("stream_platform", mode="before")(_empty_stream_platform_to_none)


class F1LapTimeCreate(BaseModel):
    user_id: str
    track_id: str
    time_ms: int = Field(ge=0, description="Lap time in milliseconds")
    penalty_seconds: float = 0.0
    is_invalid: bool = False
    score_scope: Literal["official", "club_reference"] = "official"
    proof_url: Optional[str] = None
    admin_note: Optional[str] = None


class F1LapTimeUpdate(BaseModel):
    time_ms: Optional[int] = None
    penalty_seconds: Optional[float] = None
    is_invalid: Optional[bool] = None
    score_scope: Optional[Literal["official", "club_reference"]] = None
    proof_url: Optional[str] = None
    admin_note: Optional[str] = None


# ---------- Stations ----------
class StationCreate(BaseModel):
    name: str
    device_type: str  # switch | switch2 | pc | racing_rig | beamer | stream_setup | admin_desk
    tournament_id: Optional[str] = None
    event_id: Optional[str] = None
    game_id: Optional[str] = None
    notes: Optional[str] = None


class StationUpdate(BaseModel):
    name: Optional[str] = None
    device_type: Optional[str] = None
    tournament_id: Optional[str] = None
    event_id: Optional[str] = None
    game_id: Optional[str] = None
    status: Optional[Literal["free", "busy", "broken", "reserved"]] = None
    current_match_id: Optional[str] = None
    current_match_type: Optional[Literal["matches", "matches_v2"]] = None
    notes: Optional[str] = None


# ---------- News & Sponsors ----------
NewsCategory = Literal[
    "club", "tournaments", "events", "community", "sponsors",
    "members", "teams", "announcement", "recap", "maintenance",
]
NewsVisibility = Literal["public", "community", "members", "internal"]


class NewsCreate(BaseModel):
    title: str
    slug: Optional[str] = None
    excerpt: Optional[str] = None
    content: str
    banner_url: Optional[str] = None
    category: NewsCategory = "club"
    visibility: NewsVisibility = "public"
    published: bool = True
    published_at: Optional[datetime] = None
    pinned: bool = False
    linked_event_ids: List[str] = []
    linked_tournament_ids: List[str] = []
    linked_f1_challenge_ids: List[str] = []
    linked_team_ids: List[str] = []
    mentioned_user_ids: List[str] = []


class NewsUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    excerpt: Optional[str] = None
    content: Optional[str] = None
    banner_url: Optional[str] = None
    category: Optional[NewsCategory] = None
    visibility: Optional[NewsVisibility] = None
    published: Optional[bool] = None
    published_at: Optional[datetime] = None
    pinned: Optional[bool] = None
    linked_event_ids: Optional[List[str]] = None
    linked_tournament_ids: Optional[List[str]] = None
    linked_f1_challenge_ids: Optional[List[str]] = None
    linked_team_ids: Optional[List[str]] = None
    mentioned_user_ids: Optional[List[str]] = None


SponsorTier = Literal["main", "platinum", "gold", "silver", "bronze"]
SponsorContractStatus = Literal["planned", "active", "paused", "expired", "cancelled"]


class SponsorCreate(BaseModel):
    name: str
    logo_url: Optional[str] = None
    link: Optional[str] = None
    description: Optional[str] = None
    tier: SponsorTier = "bronze"
    is_active: bool = True
    contract_status: SponsorContractStatus = "active"
    contract_start: Optional[str] = None
    contract_end: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    internal_notes: Optional[str] = None
    show_on_home: Optional[bool] = None
    show_on_footer: Optional[bool] = None
    show_on_events: Optional[bool] = None
    show_on_tv: Optional[bool] = None
    show_on_pdf: Optional[bool] = None
    show_in_emails: Optional[bool] = None
    event_ids: List[str] = []
    order_index: int = 0


class SponsorUpdate(BaseModel):
    name: Optional[str] = None
    logo_url: Optional[str] = None
    link: Optional[str] = None
    description: Optional[str] = None
    tier: Optional[SponsorTier] = None
    is_active: Optional[bool] = None
    contract_status: Optional[SponsorContractStatus] = None
    contract_start: Optional[str] = None
    contract_end: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    internal_notes: Optional[str] = None
    show_on_home: Optional[bool] = None
    show_on_footer: Optional[bool] = None
    show_on_events: Optional[bool] = None
    show_on_tv: Optional[bool] = None
    show_on_pdf: Optional[bool] = None
    show_in_emails: Optional[bool] = None
    event_ids: Optional[List[str]] = None
    order_index: Optional[int] = None


class PartnerCreate(BaseModel):
    name: str
    logo_url: Optional[str] = None
    link: Optional[str] = None
    description: Optional[str] = None
    kind: str = "verein"
    is_active: bool = True
    order_index: int = 0


class PartnerUpdate(BaseModel):
    name: Optional[str] = None
    logo_url: Optional[str] = None
    link: Optional[str] = None
    description: Optional[str] = None
    kind: Optional[str] = None
    is_active: Optional[bool] = None
    order_index: Optional[int] = None


# ---------- External tournament references ----------
ReferenceVisibility = Literal["public", "community", "members", "internal"]
ReferenceMode = Literal["online", "offline", "hybrid"]
ReferenceStatus = Literal["planned", "active", "completed", "archived"]


class ReferenceCreate(BaseModel):
    title: str
    organizer: Optional[str] = None
    game_id: Optional[str] = None
    game_name: Optional[str] = None
    team_name: Optional[str] = None
    lineup: List[str] = Field(default_factory=list)
    member_profile_ids: List[str] = Field(default_factory=list)
    lineup_members: List[dict] = Field(default_factory=list)
    placement: Optional[int] = Field(default=None, ge=1)
    placement_label: Optional[str] = None
    participant_count: Optional[int] = Field(default=None, ge=1)
    team_count: Optional[int] = Field(default=None, ge=1)
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    location: Optional[str] = None
    mode: ReferenceMode = "online"
    external_url: Optional[str] = None
    bracket_url: Optional[str] = None
    match_url: Optional[str] = None
    result_url: Optional[str] = None
    description: Optional[str] = None
    highlights: Optional[str] = None
    visibility: ReferenceVisibility = "public"
    status: ReferenceStatus = "completed"
    is_active: bool = True
    order_index: int = 0


class ReferenceUpdate(BaseModel):
    title: Optional[str] = None
    organizer: Optional[str] = None
    game_id: Optional[str] = None
    game_name: Optional[str] = None
    team_name: Optional[str] = None
    lineup: Optional[List[str]] = None
    member_profile_ids: Optional[List[str]] = None
    lineup_members: Optional[List[dict]] = None
    placement: Optional[int] = Field(default=None, ge=1)
    placement_label: Optional[str] = None
    participant_count: Optional[int] = Field(default=None, ge=1)
    team_count: Optional[int] = Field(default=None, ge=1)
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    location: Optional[str] = None
    mode: Optional[ReferenceMode] = None
    external_url: Optional[str] = None
    bracket_url: Optional[str] = None
    match_url: Optional[str] = None
    result_url: Optional[str] = None
    description: Optional[str] = None
    highlights: Optional[str] = None
    visibility: Optional[ReferenceVisibility] = None
    status: Optional[ReferenceStatus] = None
    is_active: Optional[bool] = None
    order_index: Optional[int] = None


# ---------- Gallery ----------
GalleryVisibility = Literal["public", "community", "members"]


# ---------- Documents (members area) ----------
DocumentVisibility = Literal["public", "community", "members", "internal"]
DocumentCategory = Literal[
    "statutes", "minutes", "form", "regulations", "guideline",
    "download", "media_kit", "presentation", "template", "other",
]


class DocumentCreate(BaseModel):
    title: str
    description: Optional[str] = None
    category: DocumentCategory = "other"
    visibility: DocumentVisibility = "members"
    file_url: str
    storage_key: Optional[str] = None
    original_filename: Optional[str] = None
    file_size: Optional[int] = None
    mime: Optional[str] = None
    tags: List[str] = []
    order_index: int = 0
    pinned: bool = False
    allow_download: bool = False


class DocumentUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[DocumentCategory] = None
    visibility: Optional[DocumentVisibility] = None
    file_url: Optional[str] = None
    storage_key: Optional[str] = None
    original_filename: Optional[str] = None
    file_size: Optional[int] = None
    mime: Optional[str] = None
    tags: Optional[List[str]] = None
    order_index: Optional[int] = None
    pinned: Optional[bool] = None
    allow_download: Optional[bool] = None


class GalleryAlbumCreate(BaseModel):
    title: str
    slug: Optional[str] = None
    description: Optional[str] = None
    cover_url: Optional[str] = None
    event_id: Optional[str] = None
    tournament_id: Optional[str] = None
    visibility: GalleryVisibility = "public"
    taken_at: Optional[datetime] = None
    published: bool = True
    order_index: int = 0


class GalleryAlbumUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    cover_url: Optional[str] = None
    event_id: Optional[str] = None
    tournament_id: Optional[str] = None
    visibility: Optional[GalleryVisibility] = None
    taken_at: Optional[datetime] = None
    published: Optional[bool] = None
    order_index: Optional[int] = None


class GalleryPhotoCreate(BaseModel):
    image_url: str
    thumbnail_url: Optional[str] = None
    caption: Optional[str] = None
    order_index: int = 0


class GalleryPhotoUpdate(BaseModel):
    caption: Optional[str] = None
    order_index: Optional[int] = None


# ---------- Admin ----------
class RoleUpdate(BaseModel):
    role: Role
