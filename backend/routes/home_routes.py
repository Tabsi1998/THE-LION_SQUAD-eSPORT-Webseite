"""Public homepage live state — Phase 5.

Aggregates:
* `live`   — anything currently `live`
* `today`  — events/tournaments/challenges happening today
* `soon`   — registration_open, scheduled, check_in (next up)
* `news`   — latest 4 published news visible to the caller

Hides drafts and respects per-object visibility.
"""
import re
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from database import get_db
from auth import get_optional_user, require_area
from models import now_utc
from services import founding
from services.visibility import user_can_see
from services import event_days
from services.public_phase import derive_public_phase

router = APIRouter(prefix="/api/home", tags=["home"])

LIVE_STATUSES = {"live"}
SOON_STATUSES = {"scheduled", "registration_open", "registration_closed", "check_in"}
EVENT_SOON_STATUSES = SOON_STATUSES | {"checkin_open"}
FINISHED_STATUSES = {"completed", "results_published", "archived", "cancelled"}
HIDDEN_STATUSES = {"draft", *FINISHED_STATUSES}
LOCAL_TZ = ZoneInfo("Europe/Vienna")


def _today_window():
    now = datetime.now(LOCAL_TZ)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def _parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _normalize_status(row: dict, kind: str | None = None) -> dict:
    # Events historically use `checkin_open`, while shared UI badges use `check_in`.
    if kind == "event" and row.get("status") == "checkin_open":
        row["source_status"] = "checkin_open"
        row["status"] = "check_in"
    phase_kind = "f1" if kind == "fastlap" else (kind or "content")
    row["public_phase"] = derive_public_phase(row, phase_kind)
    if kind == "event":
        # Mehrtägig (#884): die Karte zeigt „3 Tage · Fr – So“ und den nächsten Tag.
        row["schedule"] = event_days.schedule_view(row)
    return row


def _event_date(row: dict):
    # Mehrtägig (#884): sortiert nach dem laufenden bzw. nächsten Tag.
    return event_days.next_start(row) or _parse_dt(row.get("start_date")) or datetime.max.replace(tzinfo=timezone.utc)


def _row_not_finished(row: dict, now: datetime) -> bool:
    if row.get("status") in FINISHED_STATUSES:
        return False
    end = _parse_dt(row.get("end_date"))
    return not end or end >= now


def _overlaps_window(row: dict, start: datetime, end: datetime) -> bool:
    by_day = event_days.overlaps(row, start, end)
    if by_day is not None:
        return by_day
    row_start = _parse_dt(row.get("start_date"))
    if not row_start:
        return False
    row_end = _parse_dt(row.get("end_date")) or row_start
    return row_start < end and row_end >= start


def _starts_between(row: dict, start: datetime, end: datetime | None = None) -> bool:
    row_start = _parse_dt(row.get("start_date"))
    if not row_start or row_start < start:
        return False
    return end is None or row_start <= end


async def _filter_rows(rows, user, kind: str | None = None):
    out = []
    for r in rows:
        if r.get("status") == "draft":
            continue
        if kind == "tournament" and r.get("is_public") is False:
            continue
        if not await user_can_see(user, r.get("visibility")):
            continue
        out.append(_normalize_status(r, kind))
    return out


async def _attach_events_to_challenges(challenges: list[dict]) -> list[dict]:
    db = get_db()
    event_ids = list({c.get("event_id") for c in challenges if c.get("event_id")})
    if not event_ids:
        return challenges
    events = {
        e["id"]: e for e in await db.events.find(
            {"id": {"$in": event_ids}},
            {"_id": 0, "id": 1, "name": 1, "slug": 1, "start_date": 1, "location": 1},
        ).to_list(100)
    }
    for c in challenges:
        if c.get("event_id") in events:
            c["event"] = events[c["event_id"]]
    return challenges


# Live-Zahlen je Karte (#224): Anmeldungen, laufende Matches, Fahrer. Ein Zähler je Sammlung
# über alle Karten - nicht eine Abfrage je Karte. Zuschauer kommen vom Stream-Slider selbst.
RUNNING_MATCH_STATUSES = ("running", "in_progress")
ACTIVE_TOURNAMENT_REGISTRATIONS = ("approved", "checked_in")
ACTIVE_EVENT_REGISTRATIONS = ("registered", "checked_in")


async def _count_by(collection, field: str, ids: list[str], extra: dict | None = None) -> dict[str, int]:
    if not ids:
        return {}
    match = {field: {"$in": ids}, **(extra or {})}
    counts: dict[str, int] = {}
    async for row in collection.aggregate([{"$match": match}, {"$group": {"_id": f"${field}", "n": {"$sum": 1}}}]):
        counts[row["_id"]] = int(row["n"])
    return counts


def _rows_by_id(groups, kind: str) -> dict[str, list[dict]]:
    """Dieselbe Karte kann in „heute“ und „bald“ liegen - als zwei Objekte. Beide bekommen die Zahl."""
    rows: dict[str, list[dict]] = {}
    for group in groups:
        for row in group.get(kind, []):
            rows.setdefault(row["id"], []).append(row)
    return rows


async def _attach_live_counts(db, *groups: dict) -> None:
    tournaments = _rows_by_id(groups, "tournaments")
    events = _rows_by_id(groups, "events")
    challenges = _rows_by_id(groups, "challenges")
    t_regs = await _count_by(db.tournament_registrations, "tournament_id", list(tournaments), {"status": {"$in": list(ACTIVE_TOURNAMENT_REGISTRATIONS)}})
    t_running = await _count_by(db.matches_v2, "tournament_id", list(tournaments), {"status": {"$in": list(RUNNING_MATCH_STATUSES)}})
    e_regs = await _count_by(db.event_registrations, "event_id", list(events), {"status": {"$in": list(ACTIVE_EVENT_REGISTRATIONS)}})
    for tid, rows in tournaments.items():
        for row in rows:
            row["live_counts"] = {"registered": t_regs.get(tid, 0), "capacity": row.get("max_participants") or None, "running_matches": t_running.get(tid, 0)}
    for eid, rows in events.items():
        for row in rows:
            if row.get("has_registration"):
                row["live_counts"] = {"registered": e_regs.get(eid, 0), "capacity": row.get("max_participants") or None}
    if challenges:
        # Fahrer je Challenge: wie f1_routes zählt, nur für alle Karten auf einmal.
        official = {"challenge_id": {"$in": list(challenges)}, "is_invalid": {"$ne": True},
                    "$or": [{"score_scope": {"$exists": False}}, {"score_scope": {"$ne": "club_reference"}}]}
        drivers: dict[str, set] = {}
        async for lap in db.f1_lap_times.find(official, {"_id": 0, "challenge_id": 1, "user_id": 1}):
            drivers.setdefault(lap["challenge_id"], set()).add(lap.get("user_id"))
        for cid, rows in challenges.items():
            for row in rows:
                row["live_counts"] = {"participants": len(drivers.get(cid, set()))}


@router.get("/state")
async def home_state(user: dict | None = Depends(get_optional_user)):
    db = get_db()
    today_start, today_end = _today_window()
    now = datetime.now(timezone.utc)

    # ---------- LIVE ----------
    live_tournaments = await db.tournaments.find(
        {"status": {"$in": list(LIVE_STATUSES)}}, {"_id": 0},
    ).sort("updated_at", -1).to_list(20)
    live_challenges = await db.f1_challenges.find(
        {"status": {"$in": list(LIVE_STATUSES)}}, {"_id": 0},
    ).sort("updated_at", -1).to_list(20)
    live_events = await db.events.find(
        {"status": {"$in": list(LIVE_STATUSES)}}, {"_id": 0},
    ).sort("updated_at", -1).to_list(20)

    # Mehrtägige Events (#884) sind zwischen zwei Tagen nicht „live“, auch wenn ihr Stand so heißt.
    live_event_rows = [row for row in await _filter_rows(live_events, user, "event") if (row.get("public_phase") or {}).get("state") == "live"]
    live = {
        "tournaments": await _filter_rows(live_tournaments, user, "tournament"),
        "challenges": await _attach_events_to_challenges(await _filter_rows(live_challenges, user, "fastlap")),
        "events": live_event_rows,
    }

    # ---------- TODAY ----------
    today_t = await db.tournaments.find(
        {"start_date": {"$exists": True, "$ne": None}, "status": {"$nin": list(HIDDEN_STATUSES)}}, {"_id": 0},
    ).sort("start_date", 1).to_list(100)
    today_e = await db.events.find(
        {"start_date": {"$exists": True, "$ne": None}, "status": {"$nin": list(HIDDEN_STATUSES)}}, {"_id": 0},
    ).sort("start_date", 1).to_list(100)
    today_c = await db.f1_challenges.find(
        {"start_date": {"$exists": True, "$ne": None}, "status": {"$nin": list(HIDDEN_STATUSES)}}, {"_id": 0},
    ).sort("start_date", 1).to_list(100)
    today_t = [r for r in today_t if _overlaps_window(r, today_start, today_end) and _row_not_finished(r, now)][:20]
    today_e = [r for r in today_e if _overlaps_window(r, today_start, today_end) and _row_not_finished(r, now)][:20]
    today_c = [r for r in today_c if _overlaps_window(r, today_start, today_end) and _row_not_finished(r, now)][:20]

    today = {
        "tournaments": await _filter_rows(today_t, user, "tournament"),
        "events": await _filter_rows(today_e, user, "event"),
        "challenges": await _attach_events_to_challenges(await _filter_rows(today_c, user, "fastlap")),
    }

    # ---------- SOON (next 14 days, registration_open / scheduled / check_in) ----------
    horizon = now + timedelta(days=14)
    soon_t = await db.tournaments.find(
        {"start_date": {"$exists": True, "$ne": None}, "status": {"$in": list(SOON_STATUSES)}}, {"_id": 0},
    ).sort("start_date", 1).to_list(50)
    soon_e = await db.events.find(
        {"start_date": {"$exists": True, "$ne": None}, "status": {"$in": list(EVENT_SOON_STATUSES | {"live"})}}, {"_id": 0},
    ).sort("start_date", 1).to_list(50)
    # Laufende mehrtägige Events zwischen zwei Tagen (#884): der nächste Tag steht unter „bald“.
    soon_e = [row for row in soon_e if row.get("status") != "live" or (event_days.position(row, now) or {}).get("state") == "break"]
    soon_c = await db.f1_challenges.find(
        {"start_date": {"$exists": True, "$ne": None}, "status": {"$in": list(SOON_STATUSES)}}, {"_id": 0},
    ).sort("start_date", 1).to_list(50)

    def _within_horizon(rows):
        return sorted(
            [r for r in rows if _starts_between({**r, "start_date": _event_date(r).isoformat()}, now, horizon) and _row_not_finished(r, now)],
            key=_event_date,
        )

    soon = {
        "tournaments": _within_horizon(await _filter_rows(soon_t, user, "tournament"))[:8],
        "events": _within_horizon(await _filter_rows(soon_e, user, "event"))[:8],
        "challenges": await _attach_events_to_challenges(_within_horizon(await _filter_rows(soon_c, user, "fastlap"))[:8]),
    }

    # ---------- UPCOMING (date-driven, finished content gone) ----------
    upcoming_t = await db.tournaments.find(
        {"start_date": {"$exists": True, "$ne": None}, "status": {"$nin": list(HIDDEN_STATUSES)}},
        {"_id": 0},
    ).sort("start_date", 1).to_list(50)
    upcoming_e = await db.events.find(
        {"start_date": {"$exists": True, "$ne": None}, "status": {"$nin": list(HIDDEN_STATUSES)}},
        {"_id": 0},
    ).sort("start_date", 1).to_list(50)
    upcoming_c = await db.f1_challenges.find(
        {"start_date": {"$exists": True, "$ne": None}, "status": {"$nin": list(HIDDEN_STATUSES)}},
        {"_id": 0},
    ).sort("start_date", 1).to_list(50)
    upcoming_t = sorted([r for r in upcoming_t if _starts_between(r, now) and _row_not_finished(r, now)], key=_event_date)
    upcoming_e = sorted([r for r in upcoming_e if _starts_between(r, now) and _row_not_finished(r, now)], key=_event_date)
    upcoming_c = sorted([r for r in upcoming_c if _starts_between(r, now) and _row_not_finished(r, now)], key=_event_date)
    upcoming = {
        "tournaments": (await _filter_rows(upcoming_t, user, "tournament"))[:6],
        "events": (await _filter_rows(upcoming_e, user, "event"))[:6],
        "challenges": await _attach_events_to_challenges((await _filter_rows(upcoming_c, user, "fastlap"))[:6]),
    }

    # ---------- NEWS (latest published, visibility-filtered) ----------
    news = await db.news_posts.find(
        {"published": True}, {"_id": 0},
    ).sort([("published_at", -1), ("created_at", -1)]).to_list(200)
    visible_news = []
    for n in news:
        published_at = _parse_dt(n.get("published_at") or n.get("created_at"))
        if published_at and published_at > now:
            continue
        if await user_can_see(user, n.get("visibility")):
            visible_news.append(n)
    visible_news.sort(
        key=lambda n: (_parse_dt(n.get("published_at") or n.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc), bool(n.get("pinned"))),
        reverse=True,
    )
    visible_news = visible_news[:8]

    stats = {
        "news": len([n for n in news if (n.get("visibility") in (None, "public")) and not ((_parse_dt(n.get("published_at") or n.get("created_at")) or now) > now)]),
        "events": len(upcoming["events"]),
        "tournaments": len(upcoming["tournaments"]),
        "fastlaps": len(upcoming["challenges"]),
    }
    # Der Verein in Zahlen (#407, #425): dieselben Zähler wie auf „Über den Verein“ (#406).
    club_numbers = await _club_numbers(db)
    club_numbers_shown = (await _about_texts(db)).get("numbers_shown") or list(ABOUT_DEFAULTS["numbers_shown"])

    await _attach_live_counts(db, live, today, soon, upcoming)
    has_live = any(len(v) > 0 for v in live.values())
    # Discord (#581) steht seit #854 im Block „Dabei sein“ im Footer jeder Seite - eigener Abruf `/api/home/discord`.
    return {
        "has_live": has_live,
        "live": live,
        "today": today,
        "soon": soon,
        "upcoming": upcoming,
        "news": visible_news,
        "featured_news": visible_news[:1],
        "stats": stats,
        "club_numbers": club_numbers,
        "club_numbers_shown": club_numbers_shown,
    }


# ---------------------------------------------------------------- Über den Verein (#406)
# Die Seite „Über den Verein“ war reiner Code: Texte, Werte, Spiele und Offline-Aktivitäten standen
# fest. Jetzt kommen Vereinsdaten aus Dolibarr (Gründung, Zweck, gemeinnützig - über den Schalter
# der Vereinsdaten) bzw. aus den Handfeldern, Zahlen werden gezählt, Spiele kommen aus der
# Verwaltung, der Vorstand aus `/board`, „Auch offline“ aus den letzten Vereinsevents - und die
# Leitbild-Texte pflegt die Redaktion unter Admin → Verein → Über uns.

ABOUT_SETTINGS_ID = "about_page"
ABOUT_TEXT_FIELDS = (
    "hero_eyebrow", "hero_title", "hero_text", "values_title", "values_text", "games_title", "games_text",
    "offline_title", "offline_text", "cta_title", "cta_text", "purpose",
)
ABOUT_DEFAULTS = {
    "hero_eyebrow": "Der Verein",
    "hero_title": "Ein Rudel.\nEine Familie.",
    "hero_text": "THE LION SQUAD ist ein offiziell eingetragener österreichischer eSports-Verein mit einem klaren Ziel: **eSports und Gaming fördern** — und zeigen, was Gaming wirklich bedeutet.",
    "values_title": "Mehr als nur Zocken",
    "values_text": "Bei uns geht es nicht nur ums Zocken, sondern um **Gemeinschaft, Spaß und Zusammenhalt**. Egal ob Anfänger oder Pro — niemand bleibt allein oder wird im Stich gelassen.\n\n"
                   "Wir halten zusammen, stehen füreinander ein und leben eine starke, offene Community. Diese Energie, diesen Spaß und diesen Teamgeist tragen wir nach außen — in unsere Events, Turniere und alles, was wir gemeinsam aufbauen.",
    "pillars": ["Fairplay", "Gemeinschaft", "Erfolg", "Leidenschaft"],
    "games_title": "Vom Casual bis zum Cup",
    "games_text": "Wir spielen, worin wir auch in Turnieren antreten — und sind offen für alles, was Spaß macht. Bei uns ist jeder willkommen, Neues auszuprobieren — egal ob kompetitiv, casual oder einfach nur zum Spaß. **Leistung ist cool, aber Gemeinschaft steht immer an erster Stelle.**",
    "offline_title": "Gaming endet nicht am Bildschirm",
    "offline_text": "Wir treffen uns regelmäßig zu gemütlichen **Grillabenden**, spielen **Karten- und Brettspiele** oder unternehmen gemeinsame Aktivitäten, um den Teamgeist und den Zusammenhalt zu stärken.\n\n"
                    "Ob Klettergarten, interne LAN-Party oder einfach ein entspannter Abend — bei uns zählt das Miteinander, online wie offline.",
    "offline_items": ["Grillabende", "Brett- & Kartenspiele", "LAN-Partys", "Klettergarten-Trips", "Gamers Heaven Messe"],
    "cta_title": "Du willst Teil des Rudels werden?",
    "cta_text": "Registriere dich jetzt, lerne uns kennen und bewirb dich auf eine offizielle Vereinsmitgliedschaft.",
    # Handfelder für die Vereinsdaten - Dolibarr gewinnt, sobald der Schalter „Vereinsdaten aus Dolibarr“ an ist.
    "founded_year": None,
    "founded_on": None,
    "purpose": "",
    "nonprofit": None,
    # Der Verein in Zahlen (#621): welche Zähler die Seite zeigt, in dieser Reihenfolge.
    "numbers_shown": ["prizes", "tournaments_completed", "members", "years_active"],
}
# Zähler, die der Betreiber zeigen kann. „achievements“ (vergebene Erfolge) bleibt im JSON, ist aber keine Wahl mehr (#621).
NUMBER_KEYS = ("prizes", "tournaments_completed", "members", "years_active", "tournaments", "events", "participations")
EURO_RE = re.compile(r"(?:€|eur)\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur)", re.IGNORECASE)
# Was „auch offline“ heißt: Termine, bei denen man sich trifft - keine Online-Events, keine internen Termine.
OFFLINE_EVENT_TYPES = ("club_evening", "lan_party", "grill_evening", "expo", "community_evening", "public_event", "mario_kart_event", "tournament_finals", "sponsor_action")
PUBLIC_TOURNAMENT_QUERY = {"status": {"$nin": ["draft", "cancelled"]}, "is_public": {"$ne": False}}


class AboutTexts(BaseModel):
    hero_eyebrow: Optional[str] = Field(None, max_length=60)
    hero_title: Optional[str] = Field(None, max_length=120)
    hero_text: Optional[str] = Field(None, max_length=2000)
    values_title: Optional[str] = Field(None, max_length=120)
    values_text: Optional[str] = Field(None, max_length=4000)
    pillars: Optional[List[str]] = None
    games_title: Optional[str] = Field(None, max_length=120)
    games_text: Optional[str] = Field(None, max_length=4000)
    offline_title: Optional[str] = Field(None, max_length=120)
    offline_text: Optional[str] = Field(None, max_length=4000)
    offline_items: Optional[List[str]] = None
    cta_title: Optional[str] = Field(None, max_length=120)
    cta_text: Optional[str] = Field(None, max_length=1000)
    founded_year: Optional[int] = Field(None, ge=1900, le=2100)
    # Der Gründungstag (#644): ohne ihn kein Vereinsgeburtstag. Leer löscht ihn.
    founded_on: Optional[str] = Field(None, max_length=10)
    purpose: Optional[str] = Field(None, max_length=1000)
    nonprofit: Optional[bool] = None
    numbers_shown: Optional[List[str]] = None


def _clean_number_keys(values) -> list[str]:
    """Nur bekannte Zähler, jeder einmal, höchstens sechs - leer heißt Vorgabe."""
    out = []
    for value in values or []:
        key = str(value or "").strip()
        if key in NUMBER_KEYS and key not in out:
            out.append(key)
    return out[:6]


def euro_amount(value) -> float:
    """Ein Betrag aus einem Preistext wie „50 €“, „EUR 12,50“ oder „Headset (30€)“ - sonst 0."""
    match = EURO_RE.search(str(value or ""))
    if not match:
        return 0.0
    raw = match.group(1) or match.group(2) or "0"
    try:
        return float(raw.replace(",", "."))
    except ValueError:
        return 0.0


def _clean_lines(values, *, limit: int = 12, max_length: int = 80) -> list[str]:
    out = []
    for value in values or []:
        text = str(value or "").strip()[:max_length]
        if text and text not in out:
            out.append(text)
    return out[:limit]


async def _about_texts(db) -> dict:
    saved = await db.settings.find_one({"id": ABOUT_SETTINGS_ID}, {"_id": 0, "id": 0}) or {}
    texts = dict(ABOUT_DEFAULTS)
    for key, value in saved.items():
        if key in ("pillars", "offline_items"):
            texts[key] = _clean_lines(value) or ABOUT_DEFAULTS[key]
        elif key == "numbers_shown":
            texts[key] = _clean_number_keys(value) or list(ABOUT_DEFAULTS[key])
        elif key in ("founded_year", "founded_on", "nonprofit"):
            texts[key] = value
        elif key in ABOUT_DEFAULTS and value not in (None, ""):
            texts[key] = str(value)
    return texts


async def _club_numbers(db) -> dict:
    """Der Verein in Zahlen (#407, #425, #406, #621): echte Zähler, nur was öffentlich zählt - keine Entwürfe,
    keine Absagen, keine nicht-öffentlichen Turniere, keine internen Events. „Turnierteilnahmen“ sind
    die Referenzen (der Verein bei fremden Turnieren), „Preise“ die vergebenen Gewinne aus eigenen Turnieren
    (mit Preisgeld in Euro, wo ein Betrag im Preistext steht), „Turniere gespielt“ die abgeschlossenen, „Jahre
    aktiv“ aus dem Gründungsjahr. „Auszeichnungen“ (vergebene Erfolge) bleibt für alte Clients im JSON."""
    organization = await _about_organization(db)
    founded_year = organization.get("founded_year")
    year = datetime.now(timezone.utc).year
    prize_money = 0.0
    async for prize in db.prize_pickups.find({}, {"_id": 0, "prize_value": 1}):
        prize_money += euro_amount(prize.get("prize_value"))
    return {
        "members": await db.memberships.count_documents({"member_status": {"$in": ["active", "honorary"]}}),
        "tournaments": await db.tournaments.count_documents(PUBLIC_TOURNAMENT_QUERY),
        "tournaments_completed": await db.tournaments.count_documents({**PUBLIC_TOURNAMENT_QUERY, "status": {"$in": ["completed", "results_published", "archived"]}}),
        "events": await db.events.count_documents({"status": {"$nin": ["draft", "cancelled"]}, "visibility": {"$in": [None, "public"]}}),
        "participations": await db.references.count_documents({}),
        "prizes": await db.prize_pickups.count_documents({}),
        "prize_money_eur": round(prize_money, 2),
        "years_active": max(0, year - int(founded_year)) if founded_year else 0,
        "achievements": await db.user_achievements.count_documents({}),
    }


async def _about_organization(db) -> dict:
    """Name, Gründung, Zweck, gemeinnützig, ZVR und Sitz: aus Dolibarr, wenn der Schalter der Vereinsdaten
    gesetzt ist und ein Stand da ist - sonst aus den Handfeldern (Branding und Über-uns-Texte)."""
    from services import club_facts
    from services.public_site_settings import build_public_legal_settings

    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    texts = await _about_texts(db)
    overlay, legal_source = await club_facts.public_legal_source(db, branding)
    legal = build_public_legal_settings(branding, overlay)
    # Gründung (Jahr und Tag): eine Rechnung für Über uns, den Vereinsgeburtstag und die Erfolge (#644).
    founded = await founding.founding(db)
    organization = {
        "name": branding.get("club_name") or "THE LION SQUAD",
        "legal_name": legal.get("legal_name") or "",
        "zvr_number": legal.get("zvr_number") or "",
        "registered_seat": legal.get("registered_seat") or legal.get("city") or "",
        "founded_year": founded["founded_year"],
        "founded_on": founded["founded_on"],
        "purpose": texts.get("purpose") or "",
        "nonprofit": texts.get("nonprofit"),
        "source": "manual",
    }
    if legal_source.get("dolibarr"):
        state = await club_facts.snapshot(db)
        public = club_facts.organization_public(state.get("organization")) if state.get("organization") else None
        if public:
            organization.update({
                "purpose": public.get("purpose") or organization["purpose"],
                "nonprofit": bool(public.get("nonprofit")) if public.get("nonprofit") is not None else organization["nonprofit"],
                "source": "dolibarr",
            })
    return organization


async def _about_game_discord(db, game: dict) -> dict | None:
    """Der eigene Discord-Server eines Spiels für seine Karte (#626) - der Hauptserver steht schon im Footer, darum
    nur ein Server, der dem Spiel (oder seinem Hauptspiel) gehört; ausgeschaltete nie."""
    if not game.get("discord_guild_id"):
        return None
    from services import discord_guilds

    row = await discord_guilds.guild_for_game(db, game)
    if not row or row.get("inherited_from") == "main":
        return None
    server = await discord_guilds.public_server(db, row)
    return server if server.get("available") else None


async def _about_games(db) -> list[dict]:
    """Was wir spielen: die Spiele aus der Verwaltung mit der Zahl öffentlicher Turniere und Referenzen.
    Editionen zählen zu ihrem Hauptspiel; Spiele ohne Turnier und ohne Referenz stehen hinten."""
    games = await db.games.find({}, {"_id": 0, "id": 1, "name": 1, "display_name": 1, "short_name": 1, "slug": 1, "logo_url": 1, "cover_url": 1, "kind": 1, "parent_game_id": 1, "platforms": 1, "discord_guild_id": 1}).to_list(300)
    parent_of = {g["id"]: g.get("parent_game_id") for g in games if g.get("kind") == "edition" and g.get("parent_game_id")}
    counts: dict[str, dict[str, int]] = {}

    def bump(game_id, key):
        root = parent_of.get(game_id, game_id)
        counts.setdefault(root, {"tournaments": 0, "references": 0})[key] += 1

    async for row in db.tournaments.find(PUBLIC_TOURNAMENT_QUERY, {"_id": 0, "game_id": 1}):
        if row.get("game_id"):
            bump(row["game_id"], "tournaments")
    async for row in db.references.find({"is_active": {"$ne": False}}, {"_id": 0, "game_id": 1}):
        if row.get("game_id"):
            bump(row["game_id"], "references")
    out = []
    for game in games:
        if game.get("kind") == "edition":
            continue
        numbers = counts.get(game["id"], {"tournaments": 0, "references": 0})
        out.append({
            "id": game["id"], "name": game.get("display_name") or game.get("name"), "slug": game.get("slug"), "short_name": game.get("short_name"),
            "logo_url": game.get("logo_url"), "cover_url": game.get("cover_url"), "platforms": game.get("platforms") or [],
            "tournaments": numbers["tournaments"], "references": numbers["references"],
            "discord": await _about_game_discord(db, game),
        })
    out.sort(key=lambda g: (-(g["tournaments"] + g["references"]), (g["name"] or "").lower()))
    return out


async def _about_offline_events(db, now: datetime, limit: int = 6) -> list[dict]:
    """Die letzten öffentlichen Treffen mit Bild - als kleine Galerie statt Fließtext."""
    rows = await db.events.find(
        {"status": {"$nin": ["draft", "cancelled"]}, "visibility": {"$in": [None, "public"]}, "event_type": {"$in": list(OFFLINE_EVENT_TYPES)}, "banner_url": {"$nin": [None, ""]}},
        {"_id": 0, "id": 1, "name": 1, "slug": 1, "banner_url": 1, "start_date": 1, "end_date": 1, "event_type": 1, "location": 1},
    ).to_list(500)
    past = [r for r in rows if (_parse_dt(r.get("end_date")) or _parse_dt(r.get("start_date")) or now) < now]
    past.sort(key=lambda r: _parse_dt(r.get("start_date")) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return [{**r, "start_date": r["start_date"].isoformat() if isinstance(r.get("start_date"), datetime) else r.get("start_date"),
             "end_date": r["end_date"].isoformat() if isinstance(r.get("end_date"), datetime) else r.get("end_date")} for r in past[:limit]]


@router.get("/discord")
async def home_discord(response: Response):
    """„Discord jetzt“ für den Block „Dabei sein“ im Footer jeder Seite (#854): nur Zahlen und die Einladung -
    aus dem Stand, den der Job jede Minute ablegt; ohne Widget `available: false`."""
    from services.discord_widget import public_view

    response.headers["Cache-Control"] = "public, max-age=60"
    return await public_view(get_db())


@router.get("/about")
async def about_page():
    db = get_db()
    now = datetime.now(timezone.utc)
    texts = await _about_texts(db)
    return {
        "texts": {key: texts[key] for key in texts if key not in ("founded_year", "founded_on", "purpose", "nonprofit", "numbers_shown")},
        "organization": await _about_organization(db),
        "numbers": await _club_numbers(db),
        "numbers_shown": texts.get("numbers_shown") or list(ABOUT_DEFAULTS["numbers_shown"]),
        "games": await _about_games(db),
        "offline_events": await _about_offline_events(db, now),
    }


@router.get("/about/admin")
async def about_admin(me: dict = Depends(require_area("content"))):
    """Für Admin → Verein → Über uns: die Texte, was Dolibarr liefert und was die Seite sonst zeigt."""
    db = get_db()
    return {"texts": await _about_texts(db), "defaults": ABOUT_DEFAULTS, "organization": await _about_organization(db), "numbers": await _club_numbers(db), "number_keys": list(NUMBER_KEYS),
            "games": len(await _about_games(db)), "offline_events": len(await _about_offline_events(db, datetime.now(timezone.utc)))}


@router.put("/about/admin")
async def about_admin_save(body: AboutTexts, me: dict = Depends(require_area("content"))):
    db = get_db()
    raw = body.model_dump(exclude_unset=True)
    updates: dict = {}
    for key, value in raw.items():
        if key in ("pillars", "offline_items"):
            updates[key] = _clean_lines(value)
        elif key == "numbers_shown":
            updates[key] = _clean_number_keys(value)
        elif key == "founded_on":
            # Ein gültiger Tag, nicht in der Zukunft - oder leer (löscht ihn).
            day = founding.parse_day(value) if value else None
            if value and (not day or day > now_utc().date().isoformat()):
                raise HTTPException(422, "Das Gründungsdatum ist kein gültiger Tag (JJJJ-MM-TT, nicht in der Zukunft).")
            updates[key] = day
        elif key in ("founded_year", "nonprofit"):
            updates[key] = value
        elif isinstance(value, str):
            updates[key] = value.strip()
    # Steht ein Gründungstag, ist sein Jahr das Gründungsjahr - zwei verschiedene Angaben gäbe es sonst nebeneinander.
    if updates.get("founded_on"):
        updates["founded_year"] = int(updates["founded_on"][:4])
    if updates:
        updates["updated_at"] = now_utc().isoformat()
        updates["updated_by"] = me.get("id")
        await db.settings.update_one({"id": ABOUT_SETTINGS_ID}, {"$set": updates, "$setOnInsert": {"id": ABOUT_SETTINGS_ID}}, upsert=True)
    return {"ok": True, "texts": await _about_texts(db)}
