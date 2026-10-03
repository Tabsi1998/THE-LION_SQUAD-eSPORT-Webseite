"""Ostereiersuche (#646 S15, #757 E5): versteckte Eier auf Website und App von Karfreitag bis Ostermontag.

Der Server liefert je Seite nur die Eier dieser Seite - mit einem signierten Schlüssel je Person und Ei, der nach
15 Minuten verfällt; es gibt keine Gesamtliste und keine Plätze anderer Seiten. Ein Fund zählt nur angemeldet,
einmal je Ei, nicht schneller als alle drei Sekunden und nur, solange die Suche läuft. Gäste sehen die Eier und
werden zum Anmelden eingeladen - für sie wird nichts gespeichert.

Wer alle Eier hat, kommt von selbst in die Verlosung (Zufall, protokolliert, wie beim Adventkalender); die drei
Schnellsten bekommen eigene Preise. Gewinne erfahren nur die Gewinner, öffentlich steht kein Gewinnername. Die
Rangliste der Schnellsten zeigt nur Personen, deren Profil und Erfolge öffentlich sind.

Jedes Jahr verteilt die Verwaltung die Eier neu: ein Vorschlag mit Saat aus dem Jahr (andere Seiten, andere Kanten,
andere Muster), danach von Hand prüfbar. Ein Ei liegt an einer echten Kante der Seite (Saison-Anker: Karte, Bild,
Kopfzeile, Fußzeile, Löwe) - beschrieben als Art, Nummer und Ecke, nicht als CSS-Selektor; Web und App finden die
Stelle selbst und weichen auf die Fußzeile aus, wenn eine Seite weniger Karten hat.
"""
from __future__ import annotations

import csv
import hashlib
import hmac
import io
import logging
import random
import secrets
from datetime import datetime, timedelta

from fastapi import HTTPException

from models import new_id, now_utc
from services import season_raffles as raffles
from services import seasons

logger = logging.getLogger("tls.easter")

SEASON = "easter_hunt"
SIGNAL = "easter_egg"
HUNTS = "easter_hunts"
EGGS = "easter_eggs"
FINDS = "easter_finds"
PROGRESS = "easter_progress"
CHANNELS = ("web", "app")
DEFAULT_EGGS = {"web": 8, "app": 4}
MAX_EGGS = 30
TOKEN_MINUTES = 15
MIN_GAP_SECONDS = 3
HINT_UNLOCK_HOURS = 24
HINT_MAX = 200
STATUSES = ("draft", "live", "drawn")
PRIZE_KINDS = {"raffle_all": "Verlosung unter allen mit vollem Korb", "fastest_1": "Schnellste:r", "fastest_2": "Zweitschnellste:r", "fastest_3": "Drittschnellste:r"}
# Zwölf Muster - Web und App zeichnen sie gleich.
PATTERNS = ("stripes", "dots", "zigzag", "waves", "checks", "stars", "flowers", "leaves", "hearts", "spiral", "diamonds", "lion")
PLACES = ("top-left", "top-right", "bottom-left", "bottom-right")

# Wo Eier liegen dürfen. Web: öffentliche Seiten mit Karten und Bildern; App: Screens mit benannten Plätzen.
WEB_ROUTES = {
    "/": "Startseite", "/tournaments": "Turniere", "/events": "Events", "/news": "News", "/teams": "Teams",
    "/achievements": "Achievements", "/about": "Über uns", "/community": "Community", "/players": "Spieler",
    "/calendar": "Kalender", "/sponsors": "Sponsoren", "/references": "Referenzen", "/esports": "eSports",
    "/board": "Vorstand", "/values": "Werte",
}
APP_ROUTES = {
    "app:Dashboard": "Home", "app:Tournaments": "Events", "app:Teams": "Teams", "app:Profile": "Profil", "app:More": "Mehr",
    "app:News": "News", "app:Gallery": "Galerie", "app:FastLap": "Fast Laps", "app:SeasonPass": "Jahreswertung",
}
SPOT_KINDS = {"web": ("card", "image", "hero", "header", "footer"), "app": ("card", "hero", "header")}
SPOT_LABELS = {"card": "an einer Karte", "image": "an einem Bild", "hero": "beim Löwen", "header": "in der Kopfzeile", "footer": "in der Fußzeile"}
# Wie oft eine Art im Vorschlag vorkommt: Karten am häufigsten, die Fußzeile selten.
SPOT_WEIGHTS = {"card": 6, "image": 2, "hero": 1, "header": 1, "footer": 1}


def _fail(message: str, status: int = 400):
    raise HTTPException(status_code=status, detail=message)


def _text(value, limit: int) -> str:
    cleaned = "".join(ch for ch in str(value or "") if ch in "\n\t" or ord(ch) >= 32)
    return cleaned.replace("\r\n", "\n").strip()[:limit]


def _moment(value) -> datetime | None:
    if not value:
        return None
    try:
        return seasons.to_vienna(datetime.fromisoformat(str(value).replace("Z", "+00:00")))
    except ValueError:
        return None


# ------------------------------------------------------------------ Zeit

def window(year: int) -> tuple[datetime, datetime]:
    """Karfreitag 0:00 bis Ostermontag 23:59:59 (Wien) - aus dem Kalender der Jahreszeiten."""
    found = seasons.windows_for(SEASON, year)[0]
    return found["start"], found["end"]


async def hunt_for(db, year: int) -> dict | None:
    return await db[HUNTS].find_one({"year": int(year)}, {"_id": 0})


async def running(db, now: datetime | None = None) -> dict | None:
    """Die laufende Suche ({hunt, year, now, channels}) - None, wenn die Saison aus ist, gerade nicht läuft (eine
    erzwungene Vorschau zählt nicht) oder für das Jahr keine Suche freigegeben ist."""
    from routes.seasons_routes import load_context

    now = seasons.to_vienna(now)
    stored, founded = await load_context(db)
    state = next((item for item in seasons.active(now, stored, founded)["seasons"] if item["key"] == SEASON), None)
    if not state or state.get("forced"):
        return None
    current = seasons.current_window(SEASON, now)
    if not current:
        return None
    hunt = await hunt_for(db, current["year"])
    if not hunt or hunt.get("status") != "live":
        return None
    return {"hunt": hunt, "year": current["year"], "now": now, "channels": list(state.get("channels") or CHANNELS)}


def _phase(hunt: dict | None, now: datetime) -> str:
    """``none`` (kein Jahr angelegt), ``draft``, ``upcoming``, ``running``, ``ended`` oder ``drawn``."""
    if not hunt:
        return "none"
    if hunt.get("status") == "drawn":
        return "drawn"
    if hunt.get("status") != "live":
        return "draft"
    start, end = window(int(hunt["year"]))
    if now < start:
        return "upcoming"
    return "running" if now <= end else "ended"


# ------------------------------------------------------------------ Schlüssel

def _sign(hunt: dict, egg_no: int, route: str, subject: str, expires: int) -> str:
    message = f"{hunt['id']}|{egg_no}|{route}|{subject}|{expires}".encode()
    return hmac.new(str(hunt["secret"]).encode(), message, hashlib.sha256).hexdigest()[:32]


def issue_token(hunt: dict, egg: dict, subject: str, now: datetime) -> str:
    expires = int((now + timedelta(minutes=TOKEN_MINUTES)).timestamp())
    return f"{int(egg['egg_no'])}.{expires}.{_sign(hunt, int(egg['egg_no']), egg['route'], subject, expires)}"


def read_token(token: str) -> tuple[int, int, str] | None:
    parts = str(token or "").split(".")
    if len(parts) != 3 or not parts[0].isdigit() or not parts[1].isdigit() or len(parts[2]) != 32:
        return None
    return int(parts[0]), int(parts[1]), parts[2]


def normalize_route(route: str | None) -> str:
    """„/tournaments/“ und „/tournaments?x=1“ sind „/tournaments“; App-Screens heißen „app:Name“."""
    value = str(route or "").strip()
    if value.startswith("app:"):
        return value[:60]
    value = value.split("?")[0].split("#")[0]
    if len(value) > 1:
        value = value.rstrip("/")
    return (value or "/")[:120]


# ------------------------------------------------------------------ Eier je Seite

async def _found_numbers(db, hunt_id: str, user_id: str | None) -> set[int]:
    if not user_id:
        return set()
    return {row["egg_no"] async for row in db[FINDS].find({"hunt_id": hunt_id, "user_id": user_id}, {"_id": 0, "egg_no": 1})}


def egg_view(egg: dict) -> dict:
    return {"egg_no": int(egg["egg_no"]), "spot": egg.get("spot") or {}, "pattern": egg.get("pattern") or PATTERNS[0]}


async def eggs_for(db, viewer: dict | None, route: str, channel: str, now: datetime | None = None) -> dict:
    """Die Eier einer Seite - nur dieser Seite, mit einem Schlüssel je Ei für genau diese Person."""
    run = await running(db, now)
    channel = channel if channel in CHANNELS else "web"
    if not run or channel not in run["channels"]:
        return {"active": False, "eggs": []}
    hunt = run["hunt"]
    route = normalize_route(route)
    user_id = (viewer or {}).get("id")
    found = await _found_numbers(db, hunt["id"], user_id)
    subject = user_id or "guest"
    eggs = await db[EGGS].find({"hunt_id": hunt["id"], "route": route, "channel": channel}, {"_id": 0}).sort("egg_no", 1).to_list(MAX_EGGS)
    return {
        "active": True, "year": run["year"], "total": int(hunt.get("egg_count") or 0), "guest": not user_id,
        "eggs": [{**egg_view(egg), "token": issue_token(hunt, egg, subject, run["now"]), "found": int(egg["egg_no"]) in found} for egg in eggs],
    }


def preview_year(at: datetime | None = None) -> int:
    """Das Jahr einer Vorschau: das Ostern der simulierten Zeit - nach Ostermontag schon das nächste."""
    moment = seasons.to_vienna(at)
    return moment.year if moment.date() <= seasons.easter_monday(moment.year) else moment.year + 1


def preview_for(year: int) -> dict:
    """Ein Vorschau-Token für die Suche eines Jahres - simuliert ist Karsamstag mittags (die Suche läuft, Hinweise
    sind offen). Wirkt nur bei der Person, die es mitschickt, 60 Sekunden lang."""
    at = datetime.combine(seasons.good_friday(int(year)) + timedelta(days=1), datetime.min.time().replace(hour=12), tzinfo=seasons.VIENNA)
    return {"token": seasons.preview_token(SEASON, at_time=at), "seconds": seasons.PREVIEW_SECONDS, "at": at.isoformat()}


async def preview_eggs(db, route: str, channel: str, at: datetime | None = None) -> dict:
    """Vorschau für die Verwaltung (#757, Token „Vorschau 60 Sekunden“): die Eier dieser Seite aus dem Jahr der
    Vorschau - auch im Entwurf und vor Karfreitag, mit Hinweis, damit sich Versteck und Hinweis prüfen lassen. Ohne
    Schlüssel: gefunden wird in der Vorschau nichts."""
    channel = channel if channel in CHANNELS else "web"
    year = preview_year(at)
    rows = await db[EGGS].find({"year": year, "route": normalize_route(route), "channel": channel}, {"_id": 0}).sort("egg_no", 1).to_list(MAX_EGGS)
    total = await db[EGGS].count_documents({"year": year})
    return {
        "active": bool(rows), "preview": True, "year": year, "total": total, "guest": False,
        "eggs": [{**egg_view(egg), "token": "", "found": False, "hint": egg.get("hint") or default_hint(egg)} for egg in rows],
    }


# ------------------------------------------------------------------ Fund

async def find(db, user: dict, token: str, now: datetime | None = None) -> dict:
    """Ein Ei finden. Prüft Schlüssel, Zeit, Tempo und Doppelfund; zählt das Fundstück und prüft die Erfolge."""
    run = await running(db, now)
    if not run:
        _fail("Die Eiersuche läuft gerade nicht.", 409)
    hunt = run["hunt"]
    parsed = read_token(token)
    if not parsed:
        _fail("Dieses Ei kenne ich nicht - lade die Seite neu.")
    egg_no, expires, signature = parsed
    egg = await db[EGGS].find_one({"hunt_id": hunt["id"], "egg_no": egg_no}, {"_id": 0})
    if not egg or egg.get("channel") not in run["channels"]:
        _fail("Dieses Ei kenne ich nicht - lade die Seite neu.")
    expected = _sign(hunt, egg_no, egg["route"], user["id"], expires)
    if not hmac.compare_digest(expected, signature):
        _fail("Dieses Ei gehört zu einer anderen Seite oder einem anderen Konto - lade die Seite neu.", 403)
    stamp = run["now"]
    if expires < int(stamp.timestamp()):
        _fail("Das Ei ist zu lange liegen geblieben - lade die Seite neu.", 410)
    if await db[FINDS].find_one({"hunt_id": hunt["id"], "user_id": user["id"], "egg_no": egg_no}, {"_id": 0, "id": 1}):
        return {**await _progress_view(db, hunt, user["id"]), "egg": egg_view(egg), "already": True, "first": False, "completed_now": False, "newly_awarded": 0}
    # Nicht schneller als alle drei Sekunden - eine Person sucht, ein Skript rennt.
    earlier = (stamp - timedelta(seconds=MIN_GAP_SECONDS)).isoformat()
    gate = await db[PROGRESS].update_one(
        {"hunt_id": hunt["id"], "user_id": user["id"], "$or": [{"last_found_at": {"$lt": earlier}}, {"last_found_at": None}]},
        {"$set": {"last_found_at": stamp.isoformat()}},
    )
    if not gate.matched_count:
        if await db[PROGRESS].find_one({"hunt_id": hunt["id"], "user_id": user["id"]}, {"_id": 0, "user_id": 1}):
            _fail("Langsam - ein Ei nach dem anderen.", 429)
        try:
            await db[PROGRESS].insert_one({"id": new_id(), "hunt_id": hunt["id"], "year": hunt["year"], "user_id": user["id"], "found": 0, "first_found_at": stamp.isoformat(), "last_found_at": stamp.isoformat(), "completed_at": None})
        except Exception:  # noqa: BLE001 - zwei Funde zugleich: der zweite wartet
            _fail("Langsam - ein Ei nach dem anderen.", 429)
    try:
        await db[FINDS].insert_one({"id": new_id(), "hunt_id": hunt["id"], "year": hunt["year"], "user_id": user["id"], "egg_no": egg_no, "found_at": stamp.isoformat()})
    except Exception:  # noqa: BLE001 - derselbe Fund zweimal: zählt einmal
        return {**await _progress_view(db, hunt, user["id"]), "egg": egg_view(egg), "already": True, "first": False, "completed_now": False, "newly_awarded": 0}
    found = await db[FINDS].count_documents({"hunt_id": hunt["id"], "user_id": user["id"]})
    total = int(hunt.get("egg_count") or 0)
    completed_now = False
    update: dict = {"found": found}
    if total and found >= total:
        start, _end = window(int(hunt["year"]))
        update.update({"completed_at": stamp.isoformat(), "duration_seconds": max(0, int((stamp - start).total_seconds()))})
        result = await db[PROGRESS].update_one({"hunt_id": hunt["id"], "user_id": user["id"], "completed_at": None}, {"$set": update})
        completed_now = bool(result.modified_count)
    else:
        await db[PROGRESS].update_one({"hunt_id": hunt["id"], "user_id": user["id"]}, {"$set": update})
    if completed_now:
        await _enter_raffle(db, hunt, user, run["now"])
    newly = await _count_for_achievements(user["id"])
    return {**await _progress_view(db, hunt, user["id"]), "egg": egg_view(egg), "already": False, "first": found == 1, "completed_now": completed_now, "newly_awarded": newly}


async def _count_for_achievements(user_id: str) -> int:
    """Das Fundstück zählen (Karte „Saison-Fundstücke“) und die Erfolge gleich prüfen; scheitert das, holt es die
    Warteschlange nach - der Fund steht trotzdem."""
    from services import achievement_counters as counters

    try:
        await counters.record_signal(user_id, SIGNAL, 1, trusted=True)
        from badges import evaluate_user_progress

        return int(await evaluate_user_progress(user_id, {"signal"}, legacy=False) or 0)
    except Exception:  # noqa: BLE001 - ein Ei scheitert nie an den Erfolgen
        logger.warning("[easter] Erfolge nach dem Fund nicht geprüft", exc_info=True)
        try:
            from services.achievement_queue import request_evaluation

            await request_evaluation([user_id], "easter_egg", sources={"signal"})
        except Exception:  # noqa: BLE001
            pass
        return 0


async def hunts_completed(db, user_id: str) -> int:
    """Wie oft jemand den Korb voll gemacht hat - für „Eierkönig“."""
    return await db[PROGRESS].count_documents({"user_id": user_id, "completed_at": {"$ne": None}})


# ------------------------------------------------------------------ Stand und Rangliste

async def _rank(db, hunt: dict, progress: dict | None) -> int | None:
    if not progress or not progress.get("completed_at"):
        return None
    return 1 + await db[PROGRESS].count_documents({"hunt_id": hunt["id"], "completed_at": {"$ne": None, "$lt": progress["completed_at"]}})


async def _progress_view(db, hunt: dict, user_id: str) -> dict:
    progress = await db[PROGRESS].find_one({"hunt_id": hunt["id"], "user_id": user_id}, {"_id": 0}) or {}
    return {
        "year": hunt["year"], "found": int(progress.get("found") or 0), "total": int(hunt.get("egg_count") or 0),
        "completed_at": progress.get("completed_at"), "rank": await _rank(db, hunt, progress),
    }


def hints_open_at(hunt: dict) -> datetime:
    start, _end = window(int(hunt["year"]))
    return start + timedelta(hours=int(hunt.get("hint_unlock_hours") or HINT_UNLOCK_HOURS))


async def my_state(db, user: dict, year: int | None = None, now: datetime | None = None) -> dict:
    """Der eigene Korb: gefundene Eier mit Muster, Hinweise für die fehlenden (erst einen Tag nach dem Start) und
    der Platz, wenn der Korb voll ist. Ungefundene Eier verraten nichts außer ihrem Hinweis."""
    now = seasons.to_vienna(now)
    hunt = await hunt_for(db, year) if year else await _current_or_latest(db, now)
    if not hunt or hunt.get("status") == "draft":
        return {"active": False}
    finds = await db[FINDS].find({"hunt_id": hunt["id"], "user_id": user["id"]}, {"_id": 0}).sort("found_at", 1).to_list(MAX_EGGS)
    found_numbers = {row["egg_no"] for row in finds}
    eggs = {row["egg_no"]: row async for row in db[EGGS].find({"hunt_id": hunt["id"]}, {"_id": 0})}
    hint_at = hints_open_at(hunt)
    hints_open = now >= hint_at
    missing = [egg for no, egg in sorted(eggs.items()) if no not in found_numbers]
    return {
        **await _progress_view(db, hunt, user["id"]), "active": True, "phase": _phase(hunt, now),
        "eggs": [{"egg_no": row["egg_no"], "pattern": (eggs.get(row["egg_no"]) or {}).get("pattern") or PATTERNS[0], "found_at": row["found_at"]} for row in finds],
        "hints_open_at": hint_at.isoformat(), "hints_open": hints_open,
        "hints": [{"channel": egg.get("channel"), "hint": egg.get("hint") or default_hint(egg)} for egg in missing] if hints_open else [],
        "missing": len(missing),
    }


async def _current_or_latest(db, now: datetime) -> dict | None:
    """Die Suche dieses Jahres, sonst die letzte - für Seite und Korb auch nach Ostern."""
    current = await hunt_for(db, now.year)
    if current:
        return current
    return await db[HUNTS].find_one({"year": {"$lt": now.year}}, {"_id": 0}, sort=[("year", -1)])


async def fastest(db, hunt: dict, limit: int = 10) -> list[dict]:
    """Die Schnellsten mit vollem Korb - gezeigt werden nur öffentliche Profile mit öffentlichen Erfolgen; der Platz
    zählt trotzdem unter allen."""
    rows = await db[PROGRESS].find({"hunt_id": hunt["id"], "completed_at": {"$ne": None}}, {"_id": 0}).sort("completed_at", 1).to_list(500)
    if not rows:
        return []
    users = {u["id"]: u async for u in db.users.find({"id": {"$in": [r["user_id"] for r in rows]}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "privacy_public_profile": 1, "privacy_achievements_public": 1, "is_banned": 1})}
    out = []
    for index, row in enumerate(rows):
        user = users.get(row["user_id"])
        if not user or not user.get("privacy_public_profile") or user.get("privacy_achievements_public") is False or user.get("is_banned"):
            continue
        out.append({"rank": index + 1, "display_name": user.get("display_name") or user.get("username") or "Spieler", "username": user.get("username"),
                    "avatar_url": user.get("avatar_url"), "duration_seconds": int(row.get("duration_seconds") or 0), "completed_at": row["completed_at"]})
        if len(out) >= limit:
            break
    return out


def terms(hunt: dict) -> list[str]:
    """Die Spielregeln in einfachen Sätzen - Web und App zeigen denselben Text."""
    start, end = window(int(hunt["year"]))
    lines = [
        f"Die Suche läuft von Karfreitag, {start.day}.{start.month}., bis Ostermontag, {end.day}.{end.month}.{end.year}, 23:59 Uhr.",
        f"Versteckt sind {int(hunt.get('egg_count') or 0)} Eier auf der Website und in der App. Mitzählen kann, wer angemeldet ist.",
        "Jedes Ei zählt einmal. Wer zu schnell klickt oder Programme sucht lässt, sammelt nichts.",
        f"Ab {hints_open_at(hunt).day}.{hints_open_at(hunt).month}. gibt es zu jedem fehlenden Ei einen Hinweis.",
    ]
    kinds = {prize.get("kind") for prize in hunt.get("prizes") or []}
    if "raffle_all" in kinds:
        lines.append("Wer alle Eier findet, ist automatisch in der Verlosung - gezogen wird nach Ostermontag per Zufall, jede Person hat ein Los.")
    if kinds & {"fastest_1", "fastest_2", "fastest_3"}:
        lines.append("Die Schnellsten mit vollem Korb bekommen eigene Preise; gezählt wird die Zeit ab Karfreitag 0 Uhr.")
    if kinds:
        lines.append("Vorstand und Verwaltung gewinnen nichts. Wer gewinnt, bekommt eine Nachricht und findet den Gewinn unter „Meine Gewinne“; Namen werden nicht veröffentlicht.")
    return lines


async def page(db, viewer: dict | None, now: datetime | None = None) -> dict:
    """Die Seite der Eiersuche: Zeitraum, Preise, Regeln, die Schnellsten - und angemeldet der eigene Korb."""
    now = seasons.to_vienna(now)
    hunt = await _current_or_latest(db, now)
    phase = _phase(hunt, now)
    if phase in ("none", "draft"):
        upcoming = seasons.next_window(SEASON, now)
        return {"phase": "none", "next_start": upcoming["start"].isoformat() if upcoming else None}
    start, end = window(int(hunt["year"]))
    return {
        "phase": phase, "year": hunt["year"], "starts_at": start.isoformat(), "ends_at": end.isoformat(),
        "egg_count": int(hunt.get("egg_count") or 0),
        "prizes": [{"kind": prize["kind"], "label": prize.get("label") or "", "value": prize.get("value") or "", "title": PRIZE_KINDS.get(prize["kind"], "")} for prize in hunt.get("prizes") or []],
        "completed": await db[PROGRESS].count_documents({"hunt_id": hunt["id"], "completed_at": {"$ne": None}}),
        "fastest": await fastest(db, hunt), "terms": terms(hunt),
        "me": await my_state(db, viewer, hunt["year"], now) if viewer and viewer.get("id") else None,
    }


# ------------------------------------------------------------------ Verlosung und Preise

def raffle_key(year: int) -> str:
    return f"easter_hunt:{int(year)}"


async def _enter_raffle(db, hunt: dict, user: dict, now: datetime) -> None:
    """Voller Korb: von selbst in die Verlosung - wer nicht darf (Vorstand, Verwaltung, gesperrt), bleibt draußen."""
    raffle = await raffles.for_source(db, raffle_key(hunt["year"]))
    if not raffle or raffles.phase(raffle, now) != "open":
        return
    full = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0}) or user
    if await raffles.why_not(db, raffle, full):
        return
    await db[raffles.ENTRIES].update_one(
        {"raffle_id": raffle["id"], "user_id": user["id"]},
        {"$setOnInsert": {"id": new_id(), "raffle_id": raffle["id"], "user_id": user["id"], "entered_at": now_utc().isoformat()}},
        upsert=True,
    )


async def _sync_raffle(db, hunt: dict, actor: dict) -> None:
    """Die Verlosung folgt dem Preis „Verlosung unter allen“ - ohne ihn gibt es keine (solange niemand drin ist)."""
    prize = next((p for p in hunt.get("prizes") or [] if p.get("kind") == "raffle_all"), None)
    key = raffle_key(hunt["year"])
    start, end = window(int(hunt["year"]))
    if not prize:
        current = await raffles.for_source(db, key)
        if current and not await raffles.entry_count(db, current["id"]) and current.get("status") != "drawn":
            await db[raffles.RAFFLES].delete_one({"id": current["id"]})
        return
    cleaned = raffles.clean_prize({"label": prize.get("label"), "value": prize.get("value"), "winners": prize.get("winners") or 1, "audience": "all", "closes_at": end.isoformat()}, start, end)
    await raffles.save(db, season=SEASON, year=int(hunt["year"]), source_key=key, source_label="Ostereiersuche",
                       title=f"Ostereiersuche {hunt['year']}", source_url="/ostern", prize=cleaned, actor=actor)


async def _award_fastest(db, hunt: dict, prize: dict, user: dict, place: int) -> str:
    """Ein Preis für die Schnellsten - als Abholschein wie jeder Saison-Gewinn, mit privater Nachricht."""
    stamp = now_utc()
    pickup = {
        "id": new_id(), "source_type": "season", "season_key": SEASON, "season_year": hunt["year"], "season_raffle_id": None,
        "season_draw_id": None, "season_source_label": "Ostereiersuche", "source_url": "/ostern",
        "tournament_id": None, "tournament_title": f"Ostereiersuche {hunt['year']}", "tournament_slug": None,
        "user_id": user["id"], "team_id": None, "place": place, "prize_group": "fastest", "place_label": PRIZE_KINDS.get(prize["kind"], f"Platz {place}"),
        "prize_label": prize.get("label") or "", "prize_value": prize.get("value") or "",
        "status": "pending", "pickup_deadline": (stamp + timedelta(days=raffles.DEFAULT_PICKUP_WINDOW_DAYS)).isoformat(),
        "ready_at": None, "picked_up_at": None, "picked_up_by": None, "notes": "", "created_at": stamp.isoformat(), "updated_at": stamp.isoformat(),
    }
    await db.prize_pickups.insert_one(pickup)
    try:
        from services.user_notifications import create_user_notification

        await create_user_notification(
            user["id"], "Du warst bei den Schnellsten!",
            f"Ostereiersuche {hunt['year']}: Platz {place} mit vollem Korb - {prize.get('label') or 'ein Preis'}. Du findest ihn unter „Meine Gewinne“.",
            url="/me/prizes", kind="prize_pending", meta={"source_type": "season", "pickup_id": pickup["id"], "dedupe_key": f"easter:{hunt['year']}:fastest:{user['id']}"},
        )
    except Exception:  # noqa: BLE001 - der Gewinn steht; die Nachricht ist das Zweite
        logger.warning("[easter] Nachricht an die Schnellsten nicht zugestellt", exc_info=True)
    return pickup["id"]


async def draw(db, year: int, actor: dict, now: datetime | None = None) -> dict:
    """Nach Ostermontag: die Verlosung unter allen mit vollem Korb und die Preise für die drei Schnellsten. Wer
    nicht gewinnen darf (Vorstand, Verwaltung, gesperrt), wird bei den Schnellsten übersprungen."""
    now = seasons.to_vienna(now)
    hunt = await hunt_for(db, year)
    if not hunt:
        _fail("Für dieses Jahr gibt es keine Eiersuche.", 404)
    phase = _phase(hunt, now)
    if phase == "drawn":
        _fail("Die Eiersuche ist schon ausgewertet.", 409)
    if phase != "ended":
        _fail("Ausgewertet wird erst nach Ostermontag.", 409)
    locked = await db[HUNTS].update_one({"id": hunt["id"], "status": "live"}, {"$set": {"status": "drawing"}})
    if not locked.modified_count:
        _fail("Die Auswertung läuft schon.", 409)
    try:
        raffle = await raffles.for_source(db, raffle_key(year))
        raffle_result = None
        raffle_note = None
        if raffle and raffle.get("status") != "drawn" and await raffles.entry_count(db, raffle["id"]):
            try:
                raffle_result = await raffles.draw(db, raffle, actor, now)
            except HTTPException as exc:
                # Niemand im Topf darf gewinnen (zum Beispiel nur Vorstand) - die Schnellsten bekommen ihre Preise trotzdem.
                raffle_note = str(exc.detail)
        winners = []
        prizes = {p["kind"]: p for p in hunt.get("prizes") or []}
        place_kinds = [kind for kind in ("fastest_1", "fastest_2", "fastest_3") if kind in prizes]
        if place_kinds:
            rows = await db[PROGRESS].find({"hunt_id": hunt["id"], "completed_at": {"$ne": None}}, {"_id": 0}).sort("completed_at", 1).to_list(500)
            stand_in = {"staff_may_enter": False, "audience": "all"}
            for row in rows:
                if len(winners) >= len(place_kinds):
                    break
                user = await db.users.find_one({"id": row["user_id"]}, {"_id": 0, "password_hash": 0})
                if not user or await raffles.why_not(db, stand_in, user):
                    continue
                kind = place_kinds[len(winners)]
                winners.append({"user_id": user["id"], "kind": kind, "pickup_id": await _award_fastest(db, hunt, prizes[kind], user, len(winners) + 1)})
    except BaseException:
        await db[HUNTS].update_one({"id": hunt["id"], "status": "drawing"}, {"$set": {"status": "live"}})
        raise
    stamp = now_utc().isoformat()
    record = {"drawn_at": stamp, "drawn_by": actor.get("id"), "fastest": winners, "raffle_id": (raffle_result or {}).get("id"), "raffle_note": raffle_note}
    await db[HUNTS].update_one({"id": hunt["id"]}, {"$set": {"status": "drawn", "drawn_at": stamp, "draw": record, "updated_at": stamp}})
    await db.audit_logs.insert_one({"id": new_id(), "action": "easter.draw", "actor_id": actor.get("id"), "target_id": hunt["id"], "data": {"year": year, "fastest": len(winners), "raffle": bool(raffle_result)}, "created_at": stamp})
    return await admin_view(db, year, now)


# ------------------------------------------------------------------ Verwaltung: Jahr und Eier

def default_hint(egg: dict) -> str:
    routes = WEB_ROUTES if egg.get("channel") == "web" else APP_ROUTES
    where = routes.get(egg.get("route"), "einer Seite")
    spot = SPOT_LABELS.get((egg.get("spot") or {}).get("kind"), "")
    app = " in der App" if egg.get("channel") == "app" else ""
    return f"Schau{app} auf „{where}“ {spot}.".replace("  ", " ").replace(" .", ".")


def clean_egg(payload, egg_no: int) -> dict:
    data = payload if isinstance(payload, dict) else {}
    channel = str(data.get("channel") or "web")
    if channel not in CHANNELS:
        _fail(f"Ei {egg_no}: Website oder App?")
    route = normalize_route(data.get("route"))
    known = WEB_ROUTES if channel == "web" else APP_ROUTES
    if route not in known:
        _fail(f"Ei {egg_no}: diese Seite steht nicht in der Liste möglicher Verstecke.")
    spot = data.get("spot") if isinstance(data.get("spot"), dict) else {}
    kind = str(spot.get("kind") or "card")
    if kind not in SPOT_KINDS[channel]:
        _fail(f"Ei {egg_no}: an dieser Art von Kante kann kein Ei liegen.")
    try:
        index = int(spot.get("index") or 0)
    except (TypeError, ValueError):
        index = 0
    place = str(spot.get("place") or "bottom-right")
    if place not in PLACES:
        _fail(f"Ei {egg_no}: unbekannte Ecke.")
    pattern = str(data.get("pattern") or PATTERNS[(egg_no - 1) % len(PATTERNS)])
    if pattern not in PATTERNS:
        _fail(f"Ei {egg_no}: unbekanntes Muster.")
    egg = {"egg_no": egg_no, "channel": channel, "route": route, "spot": {"kind": kind, "index": max(0, min(index, 15)), "place": place}, "pattern": pattern}
    egg["hint"] = _text(data.get("hint"), HINT_MAX) or default_hint(egg)
    return egg


def propose(year: int, web: int = DEFAULT_EGGS["web"], app: int = DEFAULT_EGGS["app"]) -> list[dict]:
    """Ein Vorschlag mit Saat aus dem Jahr: jedes Jahr andere Seiten, Kanten, Ecken und Muster - die Verwaltung
    prüft und ändert danach von Hand. Auf jeder Seite höchstens zwei Eier, damit die Suche durch die Seite führt."""
    if not 0 <= web <= MAX_EGGS or not 0 <= app <= MAX_EGGS or not 1 <= web + app <= MAX_EGGS:
        _fail(f"Zusammen 1 bis {MAX_EGGS} Eier.")
    rng = random.Random(f"easter-hunt:{int(year)}")
    eggs: list[dict] = []
    for channel, count, routes in (("web", web, list(WEB_ROUTES)), ("app", app, list(APP_ROUTES))):
        slots = [route for route in routes for _ in range(2)]
        rng.shuffle(slots)
        kinds = [kind for kind in SPOT_KINDS[channel] for _ in range(SPOT_WEIGHTS.get(kind, 1))]
        for route in slots[:count]:
            kind = rng.choice(kinds)
            eggs.append({"channel": channel, "route": route, "spot": {"kind": kind, "index": rng.randrange(0, 4) if kind in ("card", "image") else 0, "place": rng.choice(PLACES)}})
    patterns = list(PATTERNS)
    rng.shuffle(patterns)
    out = []
    for index, egg in enumerate(eggs):
        egg["pattern"] = patterns[index % len(patterns)]
        out.append(clean_egg(egg, index + 1))
    return out


def clean_prizes(payload) -> list[dict]:
    rows = payload if isinstance(payload, list) else []
    out, seen = [], set()
    for row in rows[:4]:
        if not isinstance(row, dict):
            continue
        kind = str(row.get("kind") or "")
        if kind not in PRIZE_KINDS or kind in seen:
            _fail("Jede Preisart gibt es einmal: Verlosung unter allen, Schnellste:r, Zweit- und Drittschnellste:r.")
        label = _text(row.get("label"), 120)
        if not label:
            _fail(f"„{PRIZE_KINDS[kind]}“ braucht einen Preis (zum Beispiel „TLS-Hoodie“).")
        prize = {"kind": kind, "label": label, "value": _text(row.get("value"), 120)}
        if kind == "raffle_all":
            try:
                prize["winners"] = max(1, min(int(row.get("winners") or 1), raffles.MAX_WINNERS))
            except (TypeError, ValueError):
                prize["winners"] = 1
        seen.add(kind)
        out.append(prize)
    return out


async def save_hunt(db, year: int, payload: dict, actor: dict, now: datetime | None = None) -> dict:
    """Ein Jahr anlegen oder ändern: Preise, Hinweis-Freigabe, Status (Entwurf oder freigegeben)."""
    now = seasons.to_vienna(now)
    if not 2025 <= int(year) <= 2100:
        _fail("Dieses Jahr gibt es nicht.")
    current = await hunt_for(db, year)
    if current and current.get("status") in ("drawn", "drawing"):
        _fail("Diese Eiersuche ist schon ausgewertet.", 409)
    status = str(payload.get("status") or (current or {}).get("status") or "draft")
    if status not in ("draft", "live"):
        _fail("Status: Entwurf oder freigegeben.")
    egg_count = await db[EGGS].count_documents({"year": int(year)})
    if status == "live" and not egg_count:
        _fail("Ohne Eier lässt sich die Suche nicht freigeben - erst verteilen.")
    try:
        unlock = int(payload.get("hint_unlock_hours", (current or {}).get("hint_unlock_hours", HINT_UNLOCK_HOURS)))
    except (TypeError, ValueError):
        unlock = HINT_UNLOCK_HOURS
    stamp = now_utc().isoformat()
    fields = {"status": status, "prizes": clean_prizes(payload.get("prizes", (current or {}).get("prizes") or [])),
              "hint_unlock_hours": max(0, min(unlock, 96)), "egg_count": egg_count, "updated_at": stamp, "updated_by": actor.get("id")}
    await db[HUNTS].update_one(
        {"year": int(year)},
        {"$set": fields, "$setOnInsert": {"id": new_id(), "year": int(year), "secret": secrets.token_hex(32), "created_at": stamp, "created_by": actor.get("id")}},
        upsert=True,
    )
    hunt = await hunt_for(db, year)
    await db[EGGS].update_many({"year": int(year)}, {"$set": {"hunt_id": hunt["id"]}})
    await _sync_raffle(db, hunt, actor)
    return await admin_view(db, year, now)


async def save_eggs(db, year: int, payload: list, actor: dict, now: datetime | None = None) -> dict:
    """Die Eier eines Jahres ersetzen (nummeriert der Reihe nach). Sobald jemand ein Ei gefunden hat, bleibt die
    Liste stehen - sonst stimmten Körbe und Funde nicht mehr."""
    now = seasons.to_vienna(now)
    hunt = await hunt_for(db, year)
    if hunt and await db[FINDS].find_one({"hunt_id": hunt["id"]}, {"_id": 0, "id": 1}):
        _fail("Es wurden schon Eier gefunden - die Verstecke bleiben jetzt, wie sie sind.", 409)
    rows = payload if isinstance(payload, list) else []
    if not 1 <= len(rows) <= MAX_EGGS:
        _fail(f"1 bis {MAX_EGGS} Eier.")
    eggs = [clean_egg(row, index + 1) for index, row in enumerate(rows)]
    seen = {}
    for egg in eggs:
        key = (egg["route"], egg["spot"]["kind"], egg["spot"]["index"], egg["spot"]["place"])
        if key in seen:
            _fail(f"Ei {egg['egg_no']} liegt an derselben Stelle wie Ei {seen[key]}.")
        seen[key] = egg["egg_no"]
    stamp = now_utc().isoformat()
    await db[EGGS].delete_many({"year": int(year)})
    await db[EGGS].insert_many([{**egg, "id": new_id(), "year": int(year), "hunt_id": (hunt or {}).get("id"), "updated_at": stamp, "updated_by": actor.get("id")} for egg in eggs])
    if hunt:
        await db[HUNTS].update_one({"id": hunt["id"]}, {"$set": {"egg_count": len(eggs), "updated_at": stamp}})
    return await admin_view(db, year, now)


async def admin_view(db, year: int, now: datetime | None = None) -> dict:
    """Ein Jahr für die Verwaltung: Einstellungen, alle Eier mit Hinweis, wie oft jedes gefunden wurde, wie viele
    angefangen und wie viele fertig sind, die Verlosung mit Protokoll und die Schnellsten mit Namen."""
    now = seasons.to_vienna(now)
    hunt = await hunt_for(db, year)
    start, end = window(int(year))
    eggs = await db[EGGS].find({"year": int(year)}, {"_id": 0, "id": 0}).sort("egg_no", 1).to_list(MAX_EGGS)
    counts = {}
    started = completed = 0
    if hunt:
        async for row in db[FINDS].aggregate([{"$match": {"hunt_id": hunt["id"]}}, {"$group": {"_id": "$egg_no", "n": {"$sum": 1}}}]):
            counts[row["_id"]] = row["n"]
        started = await db[PROGRESS].count_documents({"hunt_id": hunt["id"]})
        completed = await db[PROGRESS].count_documents({"hunt_id": hunt["id"], "completed_at": {"$ne": None}})
    raffle = await raffles.for_source(db, raffle_key(year))
    draw_record = (hunt or {}).get("draw") or {}
    names = {}
    ids = [w["user_id"] for w in draw_record.get("fastest") or []]
    if ids:
        names = {u["id"]: u.get("display_name") or u.get("username") or "Unbekannt" async for u in db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1})}
    return {
        "year": int(year), "exists": bool(hunt), "phase": _phase(hunt, now), "status": (hunt or {}).get("status") or "draft",
        "starts_at": start.isoformat(), "ends_at": end.isoformat(), "hints_open_at": hints_open_at(hunt or {"year": year}).isoformat(),
        "hint_unlock_hours": int((hunt or {}).get("hint_unlock_hours", HINT_UNLOCK_HOURS)), "prizes": (hunt or {}).get("prizes") or [],
        "eggs": [{**egg, "found": counts.get(egg["egg_no"], 0)} for egg in eggs], "started": started, "completed": completed,
        "routes": {"web": WEB_ROUTES, "app": APP_ROUTES}, "spot_kinds": {channel: list(kinds) for channel, kinds in SPOT_KINDS.items()},
        "places": list(PLACES), "patterns": list(PATTERNS), "prize_kinds": PRIZE_KINDS,
        "raffle": await raffles.admin_state(db, raffle, now),
        "fastest_awarded": [{**w, "name": names.get(w["user_id"], "Gelöschtes Konto"), "title": PRIZE_KINDS.get(w.get("kind"), "")} for w in draw_record.get("fastest") or []],
        "raffle_note": draw_record.get("raffle_note"),
        "can_draw": _phase(hunt, now) == "ended",
    }


async def participants_csv(db, year: int) -> str:
    """Wer mitgesucht hat (nur für den Vorstand): Name, E-Mail, gefunden, voller Korb um, Platz."""
    hunt = await hunt_for(db, year)
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(["Name", "E-Mail", "Gefunden", "Von", "Voller Korb", "Platz"])
    if not hunt:
        return buffer.getvalue()
    rows = await db[PROGRESS].find({"hunt_id": hunt["id"]}, {"_id": 0}).to_list(100000)
    users = {u["id"]: u async for u in db.users.find({"id": {"$in": [r["user_id"] for r in rows]}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1, "email": 1})}
    completed = sorted((r for r in rows if r.get("completed_at")), key=lambda r: r["completed_at"])
    place = {r["user_id"]: index + 1 for index, r in enumerate(completed)}
    for row in sorted(rows, key=lambda r: (r.get("completed_at") or "9999", -int(r.get("found") or 0))):
        user = users.get(row["user_id"]) or {}
        writer.writerow([user.get("display_name") or user.get("username") or "Gelöschtes Konto", user.get("email") or "", int(row.get("found") or 0),
                         int(hunt.get("egg_count") or 0), row.get("completed_at") or "", place.get(row["user_id"], "")])
    return buffer.getvalue()
