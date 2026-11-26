"""Saisonende-Moment (#1639): Regeln ohne Import von Liga-Diensten - ein Blatt-Modul.

Die Belohnungen (``league_rewards``) fragen hier, ob die Belohnungen des Meisters auf seinen Moment warten (Fabian 26.11., A), und
lesen die Dauer je Season (D) - ohne ``league_moments`` zu importieren, das seinerseits ``league_rewards.players_for`` nutzt. So entsteht
kein Import-Kreis (tests/test_import_cycles_unit.py).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from models import now_utc

# So lange nach dem bestätigten Endstand erscheint der Moment beim nächsten Besuch - danach bleibt nur der Hinweis. Je Season
# einstellbar (Reiter „Belohnungen“, ``league_seasons.moment_days``), Vorgabe 45 Tage.
DAYS_FIELD = "moment_days"
DEFAULT_DAYS = 45
DAYS_MIN, DAYS_MAX = 1, 365
LIMIT = 500


def moment_key(season_id: str, entrant: str) -> str:
    """``<season>:<co-team>`` bzw. ``<season>:user:<person>`` in einer Einzel-Liga."""
    return f"{season_id}:{entrant}"


def clean_days(value) -> int:
    """Tage zwischen 1 und 365 - sonst ``ValueError`` mit deutschem Text."""
    try:
        days = int(value)
    except (TypeError, ValueError):
        raise ValueError("Bitte eine ganze Zahl an Tagen angeben.") from None
    if not DAYS_MIN <= days <= DAYS_MAX:
        raise ValueError(f"Der Saisonende-Moment erscheint {DAYS_MIN} bis {DAYS_MAX} Tage nach dem Endstand.")
    return days


def moment_days(season: dict | None) -> int:
    value = (season or {}).get(DAYS_FIELD)
    return value if isinstance(value, int) and DAYS_MIN <= value <= DAYS_MAX else DEFAULT_DAYS


def fresh(doc: dict, season: dict | None = None, now: datetime | None = None) -> bool:
    """Noch frisch genug, um beim nächsten Besuch zu erscheinen - so viele Tage, wie die Season einstellt (Vorgabe 45)."""
    stamp = doc.get("confirmed_at") or doc.get("created_at")
    try:
        when = datetime.fromisoformat(str(stamp))
    except (TypeError, ValueError):
        return False
    return when >= (now or now_utc()) - timedelta(days=moment_days(season))


async def champions(db, season_id: str) -> list[dict]:
    """Die geltenden Meister-Einträge der Season mit ihrer Anmeldung - aus der Tabelle oder aus den Playoffs, nie ruhende."""
    awards = await db.tournament_awards.find(
        {"league.season_id": season_id, "league.title": "Meister", "reward_key": None, "suspended": {"$ne": True}},
        {"_id": 0, "registration_id": 1, "league": 1}).to_list(LIMIT)
    registration_ids = sorted({award["registration_id"] for award in awards if award.get("registration_id")})
    registrations = {row["id"]: row for row in await db.tournament_registrations.find(
        {"id": {"$in": registration_ids}}, {"_id": 0, "id": 1, "squad_id": 1, "user_id": 1, "team_id": 1, "display_name": 1,
                                             "tournament_id": 1}).to_list(LIMIT)} if registration_ids else {}
    out = []
    for award in awards:
        registration = registrations.get(award.get("registration_id") or "")
        if registration:
            league = award.get("league") or {}
            out.append({"registration": registration, "playoffs": not league.get("staffel"), "staffel": league.get("staffel"),
                        "display_name": league.get("display_name")})
    return out


def entrant_of(registration: dict | None) -> str | None:
    """Das Co-Team einer Anmeldung bzw. ``user:<person>`` in einer Einzel-Liga."""
    registration = registration or {}
    if registration.get("squad_id"):
        return registration["squad_id"]
    return f"user:{registration['user_id']}" if registration.get("user_id") else None


async def held_reward_ids(db, user_id: str, awards: list[dict]) -> set[str]:
    """Belohnungen des Meisters warten auf seinen Moment und kommen als zweite Karte mit: solange der Endstand der Season nicht feststeht,
    und solange die Person den Moment noch sehen wird. Danach (oder ohne Moment für sie) kommen sie wie bisher."""
    awards = [award for award in awards if (award.get("league") or {}).get("season_id") and award.get("registration_id")]
    if not awards:
        return set()
    season_ids = sorted({award["league"]["season_id"] for award in awards})
    winners = {season_id: {entrant_of(champion["registration"]) for champion in await champions(db, season_id)} for season_id in season_ids}
    registration_ids = sorted({award["registration_id"] for award in awards})
    registrations = {row["id"]: row for row in await db.tournament_registrations.find(
        {"id": {"$in": registration_ids}}, {"_id": 0, "id": 1, "squad_id": 1, "user_id": 1}).to_list(len(registration_ids) + 1)}
    seasons = {row["id"]: row for row in await db.league_seasons.find({"id": {"$in": season_ids}}, {"_id": 0}).to_list(len(season_ids) + 1)}
    held: set[str] = set()
    moments: dict[str, dict | None] = {}
    for award in awards:
        season_id = award["league"]["season_id"]
        entrant = entrant_of(registrations.get(award["registration_id"]))
        if not entrant or entrant not in winners.get(season_id, set()):
            continue
        key = moment_key(season_id, entrant)
        if key not in moments:
            moments[key] = await db.league_moments.find_one({"key": key}, {"_id": 0})
        doc = moments[key]
        if doc is None or doc.get("suspended"):
            held.add(award["id"])  # der Endstand der Season steht noch nicht fest - sie kommen mit dem Moment
        elif (doc.get("active", True) and user_id in (doc.get("audience_ids") or []) and user_id not in (doc.get("seen_by") or [])
              and fresh(doc, seasons.get(season_id))):
            held.add(award["id"])  # der Moment kommt noch - mit ihnen als zweiter Karte
    return held
