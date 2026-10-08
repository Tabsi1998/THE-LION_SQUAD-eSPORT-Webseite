"""Jahresrückblick „Dein Jahr bei LION“ (#1195): ab Mitte Dezember zum Durchtippen in App und Website.

Gezeigt werden gespielte Turniere (Einzel und Team), Turniersiege und Podestplätze, Spiele, besuchte Events
(eingecheckt), die beste Fast-Lap-Zeit, das Lieblingsspiel (das meistgespielte), neue Erfolge und der Platz in der
Jahreswertung - am Ende ein Bild zum Teilen. Die Zahlen kommen aus denselben Quellen wie Profil, Referenzen und
Jahreswertung (``personal_profile_references``, ``aggregate_leaderboard``), damit sie übereinstimmen.

Zeitraum: Start und Ende stellt der Verein im Admin ein (Standard 15. Dezember bis 31. Jänner). Bis zum Ende zeigt
der Rückblick das Jahr, in dem er gestartet ist. Wer im Jahr weder gespielt noch ein Event besucht noch eine Fast
Lap gefahren hat, bekommt keinen Rückblick und keine Meldung. Die Meldung „Dein Jahr ist da“ kommt einmal je Jahr
(Thema „Erfolge“).

Privat: Den Rückblick sieht nur die Person selbst; das Bild lädt sie mit ihrer Anmeldung und teilt es, wenn sie will.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from PIL import ImageDraw

from models import now_utc
from services import share_image

VIENNA = ZoneInfo("Europe/Vienna")
SETTINGS_ID = "year_review"
DEFAULTS = {"start": "12-15", "end": "01-31"}
START_MONTHS = {10, 11, 12}
END_MONTHS = {1, 2, 3}
NOTIFY_KIND = "year_review"
FINISHED = {"completed", "results_published", "archived"}
PLAYED = {"approved", "checked_in"}
MIN_FOR_COMPARISON = 10
GOLD = share_image.GOLD
DAY = re.compile(r"^(\d{2})-(\d{2})$")
DAYS_IN_MONTH = {1: 31, 2: 29, 3: 31, 10: 31, 11: 30, 12: 31}


# ------------------------------------------------------------------ Zeitraum

def clean_day(value: str, months: set[int]) -> str:
    """„15.12.“, „15.12“ oder „12-15“ → „12-15“; sonst ValueError mit einem Satz."""
    text = str(value or "").strip().rstrip(".")
    match = re.match(r"^(\d{1,2})\.(\d{1,2})$", text)
    if match:
        text = f"{int(match.group(2)):02d}-{int(match.group(1)):02d}"
    match = DAY.match(text)
    if not match:
        raise ValueError("Bitte als Tag.Monat angeben, zum Beispiel 15.12.")
    month, day = int(match.group(1)), int(match.group(2))
    if month not in months:
        raise ValueError("Der Start liegt zwischen Oktober und Dezember, das Ende zwischen Jänner und März." if months == START_MONTHS
                         else "Das Ende liegt zwischen Jänner und März.")
    if not 1 <= day <= DAYS_IN_MONTH[month]:
        raise ValueError("Diesen Tag gibt es in dem Monat nicht.")
    return f"{month:02d}-{day:02d}"


async def load_settings(db) -> dict:
    doc = await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or {}
    out = dict(DEFAULTS)
    for key, months in (("start", START_MONTHS), ("end", END_MONTHS)):
        try:
            out[key] = clean_day(doc.get(key) or DEFAULTS[key], months)
        except ValueError:
            out[key] = DEFAULTS[key]
    return out


def day_label(value: str) -> str:
    month, day = value.split("-")
    return f"{int(day)}.{int(month)}."


def window_year(settings: dict, now: datetime | None = None) -> int | None:
    """Welches Jahr gerade zu sehen ist - None außerhalb des Zeitraums."""
    local = (now or now_utc()).astimezone(VIENNA)
    today = local.strftime("%m-%d")
    if today >= settings["start"]:
        return local.year
    if today <= settings["end"]:
        return local.year - 1
    return None


def window_info(settings: dict, now: datetime | None = None) -> dict:
    """Für die Verwaltung: von wann bis wann, läuft er gerade, welches Jahr."""
    local = (now or now_utc()).astimezone(VIENNA)
    year = window_year(settings, now)
    shown = year if year is not None else local.year
    return {
        "start": settings["start"], "end": settings["end"],
        "start_label": day_label(settings["start"]), "end_label": day_label(settings["end"]),
        "open": year is not None, "year": shown,
        "from_label": f"{day_label(settings['start'])}{shown}", "until_label": f"{day_label(settings['end'])}{shown + 1}",
    }


def _parse(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def year_of(value) -> int | None:
    parsed = _parse(value)
    return parsed.astimezone(VIENNA).year if parsed else None


# ------------------------------------------------------------------ Wer war aktiv

async def _year_tournaments(db, year: int) -> dict[str, dict]:
    docs = await db.tournaments.find({"status": {"$in": sorted(FINISHED)}}, {"_id": 0, "id": 1, "start_date": 1, "created_at": 1}).to_list(10000)
    return {doc["id"]: doc for doc in docs if year_of(doc.get("start_date") or doc.get("created_at")) == year}


async def _year_events(db, year: int) -> dict[str, dict]:
    docs = await db.events.find({}, {"_id": 0, "id": 1, "name": 1, "start_date": 1}).to_list(10000)
    return {doc["id"]: doc for doc in docs if year_of(doc.get("start_date")) == year}


async def _lap_users(db, year: int, user_ids: list[str] | None = None) -> set[str]:
    """Wer im Jahr eine gültige Fast Lap hat - das Jahr der Challenge zählt, ohne Datum das der Runde."""
    challenges = {row["id"]: row for row in await db.f1_challenges.find({}, {"_id": 0, "id": 1, "start_date": 1}).to_list(5000)}
    query: dict = {"is_invalid": {"$ne": True}}
    if user_ids is not None:
        query["user_id"] = {"$in": user_ids}
    out: set[str] = set()
    for lap in await db.f1_lap_times.find(query, {"_id": 0, "user_id": 1, "challenge_id": 1, "created_at": 1}).to_list(100000):
        challenge = challenges.get(lap.get("challenge_id")) or {}
        if lap.get("user_id") and year_of(challenge.get("start_date") or lap.get("created_at")) == year:
            out.add(lap["user_id"])
    return out


async def active_user_ids(db, year: int) -> set[str]:
    """Alle, die im Jahr gespielt, ein Event besucht oder eine Fast Lap gefahren haben (für die Meldung)."""
    tournaments = await _year_tournaments(db, year)
    regs = await db.tournament_registrations.find({"tournament_id": {"$in": list(tournaments)}, "status": {"$in": sorted(PLAYED)}},
                                                  {"_id": 0, "user_id": 1, "team_id": 1}).to_list(100000)
    users = {reg["user_id"] for reg in regs if reg.get("user_id") and not reg.get("team_id")}
    team_ids = sorted({reg["team_id"] for reg in regs if reg.get("team_id")})
    if team_ids:
        users |= {row["user_id"] for row in await db.team_members.find({"team_id": {"$in": team_ids}}, {"_id": 0, "user_id": 1}).to_list(100000) if row.get("user_id")}
    events = await _year_events(db, year)
    if events:
        users |= {row["user_id"] for row in await db.event_registrations.find({"event_id": {"$in": list(events)}, "status": "checked_in"},
                                                                             {"_id": 0, "user_id": 1}).to_list(100000) if row.get("user_id")}
    return users | await _lap_users(db, year)


async def has_activity(db, user_id: str, year: int) -> bool:
    """Schnell für eine Person: gab es im Jahr etwas zum Zurückblicken?"""
    from services.profile_references import _team_ids_for_user
    tournaments = await _year_tournaments(db, year)
    if tournaments:
        team_ids = await _team_ids_for_user(user_id)
        identity = [{"user_id": user_id, "team_id": {"$in": [None, ""]}}] + ([{"team_id": {"$in": team_ids}}] if team_ids else [])
        if await db.tournament_registrations.find_one({"tournament_id": {"$in": list(tournaments)}, "status": {"$in": sorted(PLAYED)}, "$or": identity}, {"_id": 0, "id": 1}):
            return True
    events = await _year_events(db, year)
    if events and await db.event_registrations.find_one({"event_id": {"$in": list(events)}, "user_id": user_id, "status": "checked_in"}, {"_id": 0, "id": 1}):
        return True
    return user_id in await _lap_users(db, year, [user_id])


# ------------------------------------------------------------------ Der Rückblick

async def _comparison(db, year: int, mine: int) -> int | None:
    """„Mehr Turniere als 9 von 10 im Verein“ - nur ab zehn Spielern im Jahr und ab der Hälfte, sonst nichts."""
    if mine <= 0:
        return None
    tournaments = await _year_tournaments(db, year)
    regs = await db.tournament_registrations.find({"tournament_id": {"$in": list(tournaments)}, "status": {"$in": sorted(PLAYED)}},
                                                  {"_id": 0, "tournament_id": 1, "user_id": 1, "team_id": 1}).to_list(100000)
    team_ids = sorted({reg["team_id"] for reg in regs if reg.get("team_id")})
    members: dict[str, list[str]] = defaultdict(list)
    if team_ids:
        for row in await db.team_members.find({"team_id": {"$in": team_ids}}, {"_id": 0, "team_id": 1, "user_id": 1}).to_list(100000):
            members[row["team_id"]].append(row["user_id"])
    per_user: dict[str, set[str]] = defaultdict(set)
    for reg in regs:
        for uid in (members.get(reg["team_id"], []) if reg.get("team_id") else [reg.get("user_id")]):
            if uid:
                per_user[uid].add(reg["tournament_id"])
    counts = [len(ids) for ids in per_user.values()]
    if len(counts) < MIN_FOR_COMPARISON:
        return None
    tenths = min(9, sum(1 for count in counts if count < mine) * 10 // len(counts))
    return tenths if tenths >= 5 else None


async def _season(db, user_id: str, year: int) -> dict | None:
    """Der Platz in der Jahreswertung des Jahres (keine Circuits)."""
    from services.season_service import aggregate_leaderboard
    seasons = await db.seasons.find({"kind": {"$ne": "circuit"}, "status": {"$in": ["active", "completed", "archived"]}},
                                    {"_id": 0, "id": 1, "name": 1, "status": 1, "start_date": 1, "end_date": 1}).to_list(50)
    season = next((s for s in seasons if year_of(s.get("start_date")) == year), None) \
        or next((s for s in seasons if year_of(s.get("end_date")) == year), None) \
        or next((s for s in seasons if s.get("status") == "active" and not s.get("start_date") and not s.get("end_date")), None)
    if not season:
        return None
    standings = await aggregate_leaderboard(season_id=season["id"], limit=5000)
    for index, row in enumerate(standings, start=1):
        if row.get("id") == user_id:
            return {"name": season.get("name") or f"Jahreswertung {year}", "rank": index, "points": row.get("total_points"), "participants": len(standings)}
    return None


async def _achievements(db, user_id: str, year: int) -> dict:
    awards = await db.user_achievements.find({"user_id": user_id}, {"_id": 0, "tier_code": 1, "earned_at": 1}).to_list(5000)
    codes = [a["tier_code"] for a in awards if a.get("tier_code") and year_of(a.get("earned_at")) == year]
    if not codes:
        return {"count": 0, "points": 0, "top": []}
    from achievement_catalog import MATERIALS
    tiers = {t["code"]: t for t in await db.achievements.find({"code": {"$in": codes}}, {"_id": 0}).to_list(len(codes))}
    groups = {g["code"]: g for g in await db.achievement_groups.find({"code": {"$in": sorted({t.get("group_code") for t in tiers.values()})}}, {"_id": 0}).to_list(500)}
    rows = []
    for code in codes:
        tier = tiers.get(code)
        group = groups.get((tier or {}).get("group_code")) or {}
        if not tier or group.get("is_negative"):
            continue
        material = tier.get("material") or "bronze"
        rows.append({"name": tier.get("name") or group.get("name") or "Erfolg", "points": int(tier.get("points") or 0), "rank": int(tier.get("rank") or 0),
                     "material_name": tier.get("material_name") or MATERIALS.get(material, {}).get("name"),
                     "material_color": tier.get("material_color") or MATERIALS.get(material, {}).get("color", GOLD)})
    rows.sort(key=lambda row: (-row["rank"], -row["points"], row["name"]))
    return {"count": len(rows), "points": sum(row["points"] for row in rows), "top": rows[:3]}


async def _events(db, user_id: str, year: int) -> list[dict]:
    events = await _year_events(db, year)
    if not events:
        return []
    regs = await db.event_registrations.find({"event_id": {"$in": list(events)}, "user_id": user_id, "status": "checked_in"}, {"_id": 0, "event_id": 1}).to_list(500)
    seen = sorted({reg["event_id"] for reg in regs}, key=lambda eid: str(events[eid].get("start_date") or ""))
    return [{"name": events[eid].get("name") or "Event", "date": share_image.date_label(events[eid].get("start_date"), vienna=True)} for eid in seen]


async def build_review(db, user: dict, year: int) -> dict | None:
    """Der ganze Rückblick - None, wenn es im Jahr nichts gab."""
    from services.profile_references import personal_profile_references
    from services.result_share import own_registrations
    from services.tournament_path import tournament_path

    refs = await personal_profile_references(user, public_only=False)
    items = refs.get("items") or []
    tournaments = [i for i in items if i.get("kind") == "tournament" and year_of(i.get("date")) == year]
    fastlaps = [i for i in items if i.get("kind") == "fastlap" and year_of(i.get("date")) == year]
    events = await _events(db, user["id"], year)
    if not tournaments and not fastlaps and not events:
        return None

    docs = {d["id"]: d for d in await db.tournaments.find({"$or": [{"slug": {"$in": [t["target_id"] for t in tournaments]}}, {"id": {"$in": [t["target_id"] for t in tournaments]}}]},
                                                         {"_id": 0}).to_list(500)}
    by_ref = {doc.get("slug") or doc["id"]: doc for doc in docs.values()} | {doc["id"]: doc for doc in docs.values()}
    games = games_won = 0
    per_game: dict[str, dict] = {}
    for item in tournaments:
        doc = by_ref.get(item.get("target_id"))
        if not doc:
            continue
        regs, _team = await own_registrations(db, doc, user)
        steps = await tournament_path(db, doc, {reg["id"] for reg in regs}, public=False)
        played = sum(step.get("games", 1) if step.get("kind") == "table" else 1 for step in steps)
        won = sum(step.get("wins", 0) if step.get("kind") == "table" else (1 if step.get("outcome") == "win" else 0) for step in steps)
        games += played
        games_won += won
        game = doc.get("game") if isinstance(doc.get("game"), dict) else {}
        name = doc.get("game_name") or game.get("display_name") or game.get("name")
        if name:
            entry = per_game.setdefault(name, {"name": name, "tournaments": 0, "games": 0})
            entry["tournaments"] += 1
            entry["games"] += played
    favorite = sorted(per_game.values(), key=lambda row: (-row["tournaments"], -row["games"], row["name"]))[0] if per_game else None
    ranked = [t for t in tournaments if t.get("rank")]
    best = sorted(ranked, key=lambda t: (int(t["rank"]), -int(t.get("participant_count") or 0)))[0] if ranked else None
    best_lap = sorted([f for f in fastlaps if f.get("rank")], key=lambda f: (int(f["rank"]), int(f.get("time_ms") or 0)))[0] if any(f.get("rank") for f in fastlaps) else None
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "club_name": 1, "domain": 1}) or {}
    review = {
        "year": year,
        "user": {"username": user.get("username"), "display_name": user.get("display_name") or user.get("username") or "Spieler"},
        "club_name": branding.get("club_name") or "THE LION SQUAD",
        "domain": str(branding.get("domain") or "lionsquad.at").replace("https://", "").replace("http://", "").strip("/"),
        "tournaments": {
            "count": len(tournaments),
            "wins": len([t for t in tournaments if int(t.get("rank") or 0) == 1]),
            "podiums": len([t for t in tournaments if 1 <= int(t.get("rank") or 999) <= 3]),
            "games": games, "games_won": games_won,
            "best": {"title": best.get("title"), "rank": best.get("rank"), "participant_count": best.get("participant_count"), "slug": best.get("target_id")} if best else None,
            "more_than_of_ten": await _comparison(db, year, len(tournaments)),
        },
        "favorite_game": favorite,
        "events": {"count": len(events), "items": events[:5]},
        "fastlap": {
            "count": len(fastlaps),
            "best": {"time": (best_lap.get("time_str") or "").replace(".", ",", 1) if best_lap else None, "track": best_lap.get("subtitle"), "title": best_lap.get("title"),
                     "rank": best_lap.get("rank"), "participant_count": best_lap.get("participant_count")} if best_lap else None,
        },
        "achievements": await _achievements(db, user["id"], year),
        "season": await _season(db, user["id"], year),
        "image_path": "/api/year-review/me/card.png",
    }
    return review


# ------------------------------------------------------------------ Meldung

async def send_notices(db, *, now: datetime | None = None) -> dict:
    """Einmal je Person und Jahr „Dein Jahr ist da“ - nur im Zeitraum und nur mit Aktivität."""
    from services.user_notifications import create_user_notification
    settings = await load_settings(db)
    year = window_year(settings, now)
    if year is None:
        return {"sent": 0, "year": None}
    done = {row["user_id"] for row in await db.year_review_notices.find({"year": year}, {"_id": 0, "user_id": 1}).to_list(100000)}
    candidates = sorted(await active_user_ids(db, year) - done)
    if not candidates:
        return {"sent": 0, "year": year}
    users = await db.users.find({"id": {"$in": candidates}, "is_active": {"$ne": False}, "is_banned": {"$ne": True}}, {"_id": 0, "id": 1}).to_list(len(candidates))
    sent = 0
    for row in users:
        await db.year_review_notices.update_one({"user_id": row["id"], "year": year},
                                                {"$setOnInsert": {"user_id": row["id"], "year": year, "sent_at": (now or now_utc()).isoformat()}}, upsert=True)
        created = await create_user_notification(
            row["id"],
            title=f"Dein Jahr {year} ist da",
            body="Turniere, Siege, Events und Bestzeiten – tipp dich durch dein Jahr bei uns.",
            url="/dein-jahr",
            kind=NOTIFY_KIND,
            meta={"category": "achievements", "year": year, "dedupe_key": f"year_review:{year}"},
        )
        sent += 1 if created else 0
    return {"sent": sent, "year": year}


# ------------------------------------------------------------------ Bild

def render(review: dict) -> bytes:
    """Das Bild zum Teilen, hoch (1080×1920): Jahr, Turniere groß, darunter die Zahlen als Zeilen."""
    size = share_image.STORY
    accent = share_image.hex_color(GOLD)
    cyan = share_image.hex_color(share_image.CYAN)
    image = share_image.canvas(size, accent)
    draw = ImageDraw.Draw(image)
    share_image.frame(draw, size, accent)
    width, height = size
    left, right = 96, width - 96
    draw.text((left, 150), f"{review['club_name']} · ESPORTS".upper(), font=share_image.font(34), fill=cyan)
    draw.text((left, 210), f"Mein {review['year']}", font=share_image.font(96), fill=(255, 255, 255, 255))
    name_font = share_image.fit(draw, review["user"]["display_name"], 44, right - left, min_size=28)
    draw.text((left, 330), share_image.ellipsis(draw, review["user"]["display_name"], name_font, right - left), font=name_font, fill=(255, 255, 255, 170))
    t = review["tournaments"]
    big = str(t["count"]) if t["count"] else str(review["events"]["count"] or review["fastlap"]["count"])
    label = "Turniere gespielt" if t["count"] else ("Events besucht" if review["events"]["count"] else "Fast Laps gefahren")
    big_font = share_image.fit(draw, big, 300, right - left, min_size=120)
    draw.text((left - 8, 420), big, font=big_font, fill=accent)
    y = 420 + draw.textbbox((0, 0), big, font=big_font)[3] + 24
    draw.text((left, y), label, font=share_image.font(56), fill=(255, 255, 255, 255))
    y += 110
    rows = summary_rows(review)
    row_font = share_image.font(38)
    for text, value in rows[:8]:
        if y > height - 300:
            break
        share_image.row(draw, left, y, right - left, text, value, row_font, mark=accent, value_color=accent)
        y += 92
    foot_font = share_image.font(34)
    draw.text((left, height - 170), review["domain"].upper(), font=foot_font, fill=cyan)
    return share_image.png(image)


def summary_rows(review: dict) -> list[tuple[str, str]]:
    """Die Zahlen als Zeilen - leere fallen weg. Dieselben Zeilen stehen auf der letzten Seite."""
    t = review["tournaments"]
    rows: list[tuple[str, str]] = []
    if t["count"]:
        if t["wins"]:
            rows.append(("Turniersiege", str(t["wins"])))
        if t["podiums"]:
            rows.append(("Podestplätze", str(t["podiums"])))
        if t["games"]:
            rows.append(("Spiele", str(t["games"])))
    if review["events"]["count"]:
        rows.append(("Events besucht", str(review["events"]["count"])))
    best = (review["fastlap"] or {}).get("best")
    if best and best.get("time"):
        rows.append((f"Bestzeit {best.get('track') or ''}".strip(), best["time"]))
    if review.get("favorite_game"):
        rows.append(("Lieblingsspiel", review["favorite_game"]["name"]))
    if review.get("season"):
        rows.append(("Jahreswertung", f"Platz {review['season']['rank']}"))
    if review["achievements"]["count"]:
        rows.append(("Neue Erfolge", str(review["achievements"]["count"])))
    return rows
