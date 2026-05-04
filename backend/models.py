"""Pydantic v2 models for TLS Arena."""
from pydantic import BaseModel, Field, EmailStr, ConfigDict
from typing import Optional, List, Literal, Any, Dict
from datetime import datetime, timezone, date
import uuid


def now_utc():
    return datetime.now(timezone.utc)


def new_id():
    return str(uuid.uuid4())


# ---------- Users ----------
# Backward compatible Role - keeps old roles as primary key, additional roles via roles[] array
Role = Literal["player", "team_leader", "moderator", "tournament_admin", "club_admin", "superadmin"]
UserType = Literal["guest", "community_user", "club_member"]
VisibilityLevel = Literal["public", "community", "members", "admins", "private"]


class UserRegister(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    display_name: Optional[str] = None
    birth_date: Optional[str] = None  # ISO date string
    discord_name: Optional[str] = None
    accept_privacy: bool = True
    accept_terms: bool = True
    newsletter_consent: bool = False  # explicitly opt-in, not auto-checked


class UserLogin(BaseModel):
    email: EmailStr
    password: str


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
    country: Optional[str] = None
    state: Optional[str] = None
    city: Optional[str] = None
    # Gaming meta
    favorite_games: Optional[List[str]] = None
    main_platform: Optional[str] = None  # PC / PS5 / Xbox / Switch / Mobile
    preferred_role: Optional[str] = None
    input_device: Optional[str] = None  # controller / wheel / keyboard_mouse
    website: Optional[str] = None
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
    newsletter_consent: Optional[bool] = None


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


class MembershipUpdate(BaseModel):
    """Admin sets / updates a user's membership."""
    member_status: Optional[MemberStatus] = None
    membership_type: Optional[MembershipType] = None
    member_number: Optional[str] = None
    member_since: Optional[str] = None  # ISO date
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
    new_password: str = Field(min_length=6, max_length=128)


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=128)


# ---------- Teams ----------
class TeamCreate(BaseModel):
    name: str
    tag: str = Field(min_length=2, max_length=8)
    description: Optional[str] = None
    logo_url: Optional[str] = None
    discord_link: Optional[str] = None


class TeamUpdate(BaseModel):
    name: Optional[str] = None
    tag: Optional[str] = None
    description: Optional[str] = None
    logo_url: Optional[str] = None
    discord_link: Optional[str] = None
    social_links: Optional[dict] = None


# ---------- Games ----------
class GameCreate(BaseModel):
    name: str
    slug: str
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


class GameUpdate(BaseModel):
    name: Optional[str] = None
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


# ---------- Events ----------
class EventCreate(BaseModel):
    name: str
    slug: str
    description: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    location: Optional[str] = None
    is_online: bool = False
    is_hybrid: bool = False
    banner_url: Optional[str] = None
    contact: Optional[str] = None


class EventUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    location: Optional[str] = None
    is_online: Optional[bool] = None
    is_hybrid: Optional[bool] = None
    banner_url: Optional[str] = None
    contact: Optional[str] = None
    status: Optional[str] = None


# ---------- Tournaments ----------
TournamentFormat = Literal[
    "single_elim", "double_elim", "round_robin", "swiss",
    "groups", "ffa", "battle_royale", "league", "time_trial", "grand_prix"
]
TournamentStatus = Literal[
    "draft", "registration_open", "check_in", "live", "paused", "completed", "archived"
]
TeamMode = Literal["solo", "duo", "team", "squad"]


class TournamentCreate(BaseModel):
    title: str
    slug: str
    description: Optional[str] = None
    game_id: str
    platform: Optional[str] = None
    event_id: Optional[str] = None
    format: TournamentFormat = "single_elim"
    team_mode: TeamMode = "solo"
    team_size: int = 1
    substitutes_allowed: bool = False
    max_participants: int = 32
    min_participants: int = 2
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
    prize_places: Optional[List[dict]] = None  # [{"place":1,"label":"1. Platz","value":"…"}]
    best_of: int = 1
    bronze_match: bool = False
    stream_link: Optional[str] = None
    twitch_channel: Optional[str] = None
    twitch_enabled: bool = False
    discord_link: Optional[str] = None
    location: Optional[str] = None
    banner_url: Optional[str] = None
    seeding_mode: Literal["manual", "random", "ranking"] = "random"


class TournamentUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    format: Optional[TournamentFormat] = None
    status: Optional[TournamentStatus] = None
    team_mode: Optional[TeamMode] = None
    team_size: Optional[int] = None
    max_participants: Optional[int] = None
    min_participants: Optional[int] = None
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
    stream_link: Optional[str] = None
    twitch_channel: Optional[str] = None
    twitch_enabled: Optional[bool] = None
    discord_link: Optional[str] = None
    location: Optional[str] = None
    banner_url: Optional[str] = None
    seeding_mode: Optional[Literal["manual", "random", "ranking"]] = None


class RegistrationCreate(BaseModel):
    team_id: Optional[str] = None
    ingame_name: Optional[str] = None
    discord: Optional[str] = None
    platform_id: Optional[str] = None
    notes: Optional[str] = None
    accept_rules: bool = True
    accept_privacy: bool = True


class RegistrationUpdate(BaseModel):
    status: Optional[Literal["pending", "approved", "rejected", "waitlist", "checked_in"]] = None
    seed: Optional[int] = None
    ingame_name: Optional[str] = None


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
    slug: str
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
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    is_championship: bool = False
    points_per_position: List[int] = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
    prize_places: Optional[List[dict]] = None
    banner_url: Optional[str] = None
    twitch_channel: Optional[str] = None
    twitch_enabled: bool = False


class F1ChallengeUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[Literal["draft", "registration_open", "live", "paused", "completed"]] = None
    vehicle: Optional[str] = None
    weather: Optional[str] = None
    assists_allowed: Optional[str] = None
    controller_type: Optional[str] = None
    platform: Optional[str] = None
    max_attempts: Optional[int] = None
    unlimited_attempts: Optional[bool] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    is_championship: Optional[bool] = None
    points_per_position: Optional[List[int]] = None
    prize_places: Optional[List[dict]] = None
    banner_url: Optional[str] = None
    twitch_channel: Optional[str] = None
    twitch_enabled: Optional[bool] = None


class F1LapTimeCreate(BaseModel):
    user_id: str
    track_id: str
    time_ms: int = Field(ge=0, description="Lap time in milliseconds")
    penalty_seconds: float = 0.0
    is_invalid: bool = False
    proof_url: Optional[str] = None
    admin_note: Optional[str] = None


class F1LapTimeUpdate(BaseModel):
    time_ms: Optional[int] = None
    penalty_seconds: Optional[float] = None
    is_invalid: Optional[bool] = None
    proof_url: Optional[str] = None
    admin_note: Optional[str] = None


# ---------- Stations ----------
class StationCreate(BaseModel):
    name: str
    device_type: str  # switch | switch2 | pc | racing_rig | beamer | stream_setup | admin_desk
    event_id: Optional[str] = None
    game_id: Optional[str] = None
    notes: Optional[str] = None


class StationUpdate(BaseModel):
    name: Optional[str] = None
    device_type: Optional[str] = None
    status: Optional[Literal["free", "busy", "broken", "reserved"]] = None
    current_match_id: Optional[str] = None
    notes: Optional[str] = None


# ---------- News & Sponsors ----------
class NewsCreate(BaseModel):
    title: str
    slug: str
    excerpt: Optional[str] = None
    content: str
    banner_url: Optional[str] = None
    published: bool = True


class SponsorCreate(BaseModel):
    name: str
    logo_url: Optional[str] = None
    link: Optional[str] = None
    description: Optional[str] = None
    tier: Optional[str] = "standard"


# ---------- Admin ----------
class RoleUpdate(BaseModel):
    role: Role
