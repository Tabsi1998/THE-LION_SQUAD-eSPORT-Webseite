"""Liga auf der Startseite (#2324): sichtbare Seasons in „Nächste Termine“ und als Hinweis, solange die Anmeldung offen ist.

- **Wer was sieht:** dieselbe Regel wie die Ligaseite und ``/api/leagues`` (``league_service.can_see_season``) - nach der
  Sichtbarkeit der Season, nicht nach ihrem Stand. Eine Season im Stand „Entwurf“ mit Sichtbarkeit „öffentlich“ steht also
  drin, eine mit Sichtbarkeit „aus“ nie. Archivierte und beendete Seasons fallen heraus.
- **Einstellbar:** ``promote_on_home`` je Season (Vorgabe an, Reiter „Überblick“). Aus: Die Season steht nirgends auf der
  Startseite, die Ligaseite bleibt, wie sie ist.
- **Stand je Season** im Format von ``public_phase`` (gleiche Plaketten wie Events und Turniere): Anmeldung öffnet,
  Anmeldung offen (bis Anmeldeschluss), Anmeldung geschlossen bzw. Angekündigt (bis zum Start), danach „Spielwoche N von M“.
- **Sortiert** nach dem nächsten Datum, das zählt (``sort_at``): Anmeldeschluss, Öffnen der Anmeldung, Start der Season,
  während der Season der Beginn der nächsten Spielwoche.

Keine Personen, keine Anträge - nur Fenster und freie Plätze aus ``league_applications.public_block``.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from models import now_utc
from services import league_applications, league_look
from services import league_service as leagues
from services.public_phase import STATUS_LABELS

PROMOTE = "promote_on_home"
# Diese Seasons sind vorbei - sie stehen nicht mehr auf der Startseite.
FINISHED_STATUSES = frozenset({"completed", "archived"})
RUNNING = "season_running"
BREAK = "season_break"


def promoted(season: dict) -> bool:
    """Vorgabe an: Seasons von vor #2324 tragen das Feld nicht und werden beworben."""
    return season.get(PROMOTE) is not False


def _phase(state: str, label: str, target: str | None, kind: str | None, now: datetime) -> dict:
    return {"state": state, "label": label, "target_at": target, "next_transition_at": target, "countdown_kind": kind,
            "now": now.isoformat()}


def _iso(value) -> str | None:
    moment = leagues._aware(value)
    return moment.isoformat() if moment else None


def _week_start(day) -> str:
    local = datetime(day.year, day.month, day.day, tzinfo=leagues.VIENNA)
    return local.astimezone(timezone.utc).isoformat()


def season_state(season: dict, now: datetime | None = None) -> tuple[dict, str | None] | None:
    """Plakette (``public_phase``) und Sortierdatum einer Season - ``None``: vorbei, gehört nicht auf die Startseite."""
    now = now or now_utc()
    end = leagues._aware(leagues.season_end(season))
    if season.get("status") in FINISHED_STATUSES or (end and end < now):
        return None
    window = league_applications.window_state(season, now)
    opens, closes = _iso(season.get("application_opens_at")), _iso(season.get("application_closes_at"))
    start = _iso(season.get("start_date"))
    if window == league_applications.OPEN:
        return _phase("registration_open", STATUS_LABELS["registration_open"], closes, "registration_closes", now), closes
    if window == league_applications.UPCOMING:
        return _phase("registration_pending", STATUS_LABELS["registration_pending"], opens, "registration_opens", now), opens
    started = leagues._aware(start)
    if not started or started > now:
        state = "registration_closed" if window == league_applications.CLOSED else "announced"
        return _phase(state, STATUS_LABELS[state], start, "starts", now), start
    return _running(season, now)


def _running(season: dict, now: datetime) -> tuple[dict, str | None]:
    """Während der Season: „Spielwoche 3 von 10“, in einer Sperrwoche „Spielpause“. Sortiert nach der nächsten Spielwoche."""
    weeks = leagues.week_days(season)
    today = now.astimezone(leagues.VIENNA).date()
    blocked = set(leagues.blocked_weeks(season))
    current = next((number for number, (first, last) in enumerate(weeks, start=1) if first <= today <= last), None)
    following = next((first for first, _last in weeks if first > today), None)
    sort_at = _week_start(following) if following else leagues.season_end(season)
    if current is None:
        return _phase(RUNNING, "Läuft", None, None, now), sort_at
    if current in blocked:
        return _phase(BREAK, "Spielpause", None, None, now), sort_at
    # Gezählt werden nur Spielwochen - Sperrwochen sind keine.
    playing = [number for number in range(1, len(weeks) + 1) if number not in blocked]
    position = playing.index(current) + 1
    return _phase(RUNNING, f"Spielwoche {position} von {len(playing)}", None, None, now), sort_at


def _title(league: dict, season: dict) -> str:
    return " · ".join(part for part in (league.get("name"), season.get("name")) if part)


async def home_seasons(db, user: dict | None, now: datetime | None = None) -> list[dict]:
    """Die Seasons für die Startseite, sortiert nach ``sort_at``. ``application`` ist ``None`` ohne Selbstanmeldung."""
    now = now or now_utc()
    out = []
    for league in await db.leagues.find({"status": "active"}, {"_id": 0}).to_list(200):
        seasons = await db.league_seasons.find({"league_id": league["id"], "visibility": {"$ne": "off"},
                                                "status": {"$nin": list(FINISHED_STATUSES)}}, {"_id": 0}).to_list(200)
        for season in seasons:
            if not promoted(season) or not await leagues.can_see_season(user, season):
                continue
            state = season_state(season, now)
            if not state:
                continue
            phase, sort_at = state
            path = f"/liga/{league['slug']}/{season['slug']}"
            look = league_look.effective(league, season)
            out.append({
                "id": season["id"], "kind": "league", "slug": f"{league['slug']}-{season['slug']}",
                "title": _title(league, season), "league_name": league.get("name"), "season_name": season.get("name"),
                "url": path, "apply_url": f"{path}/anmelden",
                "start_date": _iso(season.get("start_date")), "end_date": leagues.season_end(season),
                "sort_at": sort_at, "public_phase": phase,
                "application": await league_applications.public_block(db, season),
                "emblem_url": look["emblem_url"], "banner": look["banner"], "accent_color": look["accent_color"],
            })
    far = (now + timedelta(days=36500)).isoformat()
    out.sort(key=lambda row: (row["sort_at"] or far, row["title"]))
    return out
