"""Saisonende-Moment (#1639): Regeln ohne Import von Liga-Diensten - ein Blatt-Modul.

Die Belohnungen (``league_rewards``) und der Abschluss (``league_final``) fragen hier, ob der Moment des Meisters eine Person erreicht
(Fabian 26.11., A; M3 der Prüfung): Nur dann warten ihre Belohnungs-Zeremonie und ihre Nachrichten auf ihn. Dazu die Dauer je Season (D).
Ohne ``league_moments`` zu importieren, das seinerseits ``league_rewards.players_for`` nutzt - kein Import-Kreis
(tests/test_import_cycles_unit.py).

**Erreicht** heißt: Es gibt einen Moment für das **Co-Team** (eine Anmeldung ohne Co-Team hat keinen), er gilt und ruht nicht, die
Person ist unter seinen Empfängern, Mitglieder sehen die Season (``members``/``public``), die Person sieht sie selbst, und - frisch
gefragt - sein Endstand steht (``ready``): für Auf- und Abstieg alle Staffeln der Season, für den **Meister** nur seine Liga N samt
Playoffs (Fabian 26.11.: der Meister sofort; die Relegation ändert an ihm nichts). Sonst feiert und meldet sich die Belohnung wie vor
#1639.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from models import now_utc
from services.league_final_read import all_closed
from services.league_scope import ONLY_LEAGUE, RELEGATION

# So lange nach dem bestätigten Endstand erscheint der Moment beim nächsten Besuch - danach bleibt nur der Hinweis. Je Season
# einstellbar (Reiter „Belohnungen“, ``league_seasons.moment_days``), Vorgabe 45 Tage.
DAYS_FIELD = "moment_days"
DEFAULT_DAYS = 45
DAYS_MIN, DAYS_MAX = 1, 365
LIMIT = 500
# Sichtbar für Mitglieder (Fabian 26.11., C): „Aus“ und „Nur Liga-Leitung“ zeigen nichts.
MEMBER_VISIBLE = frozenset({"members", "public"})


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


def member_visible(season: dict | None) -> bool:
    return bool(season) and season.get("status") != "archived" and (season.get("visibility") or "off") in MEMBER_VISIBLE


async def season_closed(db, season_id: str) -> bool:
    """Alle Staffeln aller Arten abgeschlossen (``league_final_read.all_closed``) - frisch gefragt, nie einem veralteten Abgleich trauen."""
    staffeln = await db.tournaments.find({"league_context.season_id": season_id, **ONLY_LEAGUE},
                                         {"_id": 0, "id": 1, "status": 1, "final_table": 1}).to_list(LIMIT)
    return all_closed(staffeln)


async def division_done(db, division_id: str) -> bool:
    """Die Liga N des Meisters ist fertig: alle ihre Staffeln abgeschlossen, auch die Playoffs - die Relegation zählt nicht (sie
    entscheidet über Auf- und Abstieg, nie über den Meister)."""
    staffeln = await db.tournaments.find({"league_context.division_id": division_id, **ONLY_LEAGUE},
                                         {"_id": 0, "id": 1, "status": 1, "final_table": 1, "league_context.kind": 1}).to_list(LIMIT)
    return all_closed([row for row in staffeln if (row.get("league_context") or {}).get("kind") != RELEGATION])


async def ready(db, doc: dict, cache: dict | None = None) -> bool:
    """Steht der Endstand, auf dem dieser Moment beruht? Frisch gefragt - nie einem veralteten Abgleich trauen. Der Meister: seine Liga N
    fertig und sein Meister-Eintrag gilt; Auf- und Abstieg: alle Staffeln der Season. ``cache`` merkt sich die Antworten je Aufruf."""
    cache = cache if cache is not None else {}
    if doc.get("outcome") == "champion" and doc.get("division_id"):
        key = ("division", doc["division_id"])
        if key not in cache:
            cache[key] = await division_done(db, doc["division_id"])
        if not cache[key]:
            return False
        award = await db.tournament_awards.find_one({"league.season_id": doc["season_id"], "league.title": "Meister", "reward_key": None,
                                                     "suspended": {"$ne": True}, "registration_id": {"$in": doc.get("registration_ids") or []}},
                                                    {"_id": 1})
        return bool(award)
    key = ("season", doc["season_id"])
    if key not in cache:
        cache[key] = await season_closed(db, doc["season_id"])
    return cache[key]


def reaches(doc: dict | None, season: dict | None, person: str, *, sees: bool, closed: bool) -> bool:
    """Erreicht der Moment diese Person? ``sees``: Die Person sieht die Season (``can_see_season``); ``closed``: alle Staffeln zu."""
    return bool(doc and doc.get("squad_id") and doc.get("active", True) and not doc.get("suspended")
                and person in (doc.get("audience_ids") or []) and member_visible(season) and sees and closed)


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


async def held_reward_ids(db, user: dict, awards: list[dict], can_see) -> set[str]:
    """Belohnungen des Meisters warten auf seinen Moment und kommen als zweite Karte mit - nur, solange der Moment die Person erreicht
    (``reaches``), sie ihn noch nicht gesehen hat und er frisch ist (höchstens ``moment_days``). Sonst kommen sie wie vor #1639.
    ``can_see``: ``league_service.can_see_season`` (vom Aufrufer, ohne Import-Kreis)."""
    user_id = user["id"]
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
    sees: dict[str, bool] = {}
    cache: dict = {}
    for award in awards:
        season_id = award["league"]["season_id"]
        entrant = entrant_of(registrations.get(award["registration_id"]))
        if not entrant or entrant not in winners.get(season_id, set()):
            continue
        key = moment_key(season_id, entrant)
        if key not in moments:
            moments[key] = await db.league_moments.find_one({"key": key}, {"_id": 0})
        doc = moments[key]
        season = seasons.get(season_id)
        if not doc or user_id in (doc.get("seen_by") or []) or not fresh(doc, season):
            continue
        if season_id not in sees:
            sees[season_id] = bool(member_visible(season) and await can_see(user, season))
        if sees[season_id] and reaches(doc, season, user_id, sees=True, closed=await ready(db, doc, cache)):
            held.add(award["id"])  # der Moment kommt noch - mit ihnen als zweiter Karte
    return held
