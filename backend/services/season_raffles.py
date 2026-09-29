"""Saison-Gewinne (#641, #678): eine Verlosung zu einem Türchen im Adventkalender - später auch zur Eiersuche.

Mitmachen ist ein eigener Klick: wer ein Türchen nur öffnet, nimmt nicht teil. Gezogen wird per Zufall, jede
Person hat ein Los. Jede Ziehung steht im Protokoll (wann, wer gezogen hat, wie viele Lose, wer gewonnen hat).
Wer gewinnt, erfährt es privat; der Gewinn steht danach unter „Meine Gewinne“ und läuft über dieselbe Abholung
wie ein Turnierpreis. Öffentlich wird nie ein Name - die Seite sagt nur, dass gezogen wurde.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta

from fastapi import HTTPException

from models import new_id, now_utc
from services import seasons
from services.prize_service import DEFAULT_PICKUP_WINDOW_DAYS

logger = logging.getLogger("tls.raffles")

RAFFLES = "season_raffles"
ENTRIES = "season_raffle_entries"
AUDIENCES = {"all": "alle mit Konto", "members": "nur Vereinsmitglieder"}
MAX_WINNERS = 20
# Wer die Verlosung betreut, zieht nicht für sich selbst: Verwaltung und Vorstand sind ausgeschlossen, außer die
# Verlosung gibt sie ausdrücklich frei.
STAFF_AREAS = frozenset({"club", "system", "content", "tournaments", "finance"})
# Tests hängen hier einen Zufall mit fester Saat ein.
_rng = secrets.SystemRandom()


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


def clean_prize(payload, opens: datetime, ends: datetime) -> dict:
    """Die Angaben zum Gewinn - geprüft. ``opens`` und ``ends`` begrenzen den Teilnahmeschluss: frühestens eine
    Stunde nach dem Öffnen, spätestens mit dem Ende der Saison."""
    data = payload if isinstance(payload, dict) else {}
    label = _text(data.get("label"), 120)
    if not label:
        _fail("Der Gewinn braucht einen Namen (zum Beispiel „TLS-Hoodie“).")
    try:
        winners = int(data.get("winners") or 1)
    except (TypeError, ValueError):
        winners = 0
    if not 1 <= winners <= MAX_WINNERS:
        _fail(f"Es können 1 bis {MAX_WINNERS} Personen gewinnen.")
    audience = str(data.get("audience") or "all")
    if audience not in AUDIENCES:
        _fail("Mitmachen können alle mit Konto oder nur Vereinsmitglieder.")
    closes = _moment(data.get("closes_at")) if data.get("closes_at") else ends
    if closes is None:
        _fail("Den Teilnahmeschluss verstehe ich nicht.")
    if closes < opens + timedelta(hours=1):
        _fail("Der Teilnahmeschluss muss mindestens eine Stunde nach dem Öffnen des Türchens liegen.")
    if closes > ends:
        _fail("Der Teilnahmeschluss liegt nach dem Ende des Kalenders.")
    return {
        "prize_label": label, "prize_value": _text(data.get("value"), 120), "winners": winners, "audience": audience,
        "closes_at": closes.isoformat(), "staff_may_enter": data.get("staff_may_enter") is True,
    }


async def for_source(db, source_key: str) -> dict | None:
    return await db[RAFFLES].find_one({"source_key": source_key}, {"_id": 0})


async def entry_count(db, raffle_id: str) -> int:
    return await db[ENTRIES].count_documents({"raffle_id": raffle_id})


async def save(db, *, season: str, year: int, source_key: str, source_label: str, title: str, source_url: str, prize: dict, actor: dict) -> dict:
    """Verlosung anlegen oder ändern. Nach der Ziehung steht sie fest."""
    current = await for_source(db, source_key)
    stamp = now_utc().isoformat()
    if current and current.get("status") == "drawing":
        _fail("Diese Verlosung wird gerade gezogen.", 409)
    if current and current.get("status") == "drawn":
        changed = [key for key in ("prize_label", "prize_value", "winners", "audience", "closes_at", "staff_may_enter") if current.get(key) != prize.get(key)]
        if changed:
            _fail("Die Verlosung ist schon gezogen – der Gewinn lässt sich nicht mehr ändern.", 409)
        return current
    fields = {**prize, "season": season, "year": year, "source_label": source_label, "title": title, "source_url": source_url, "status": "open", "updated_at": stamp, "updated_by": actor.get("id")}
    await db[RAFFLES].update_one(
        {"source_key": source_key},
        {"$set": fields, "$setOnInsert": {"id": new_id(), "source_key": source_key, "draws": [], "created_at": stamp, "created_by": actor.get("id")}},
        upsert=True,
    )
    return await for_source(db, source_key)


async def release(db, source_key: str) -> None:
    """Das Türchen ist kein Gewinn mehr (oder gelöscht). Geht nur, solange niemand mitmacht und nichts gezogen ist."""
    raffle = await for_source(db, source_key)
    if not raffle:
        return
    if raffle.get("status") in ("drawn", "drawing"):
        _fail("Die Verlosung ist schon gezogen – dieses Türchen bleibt, wie es ist.", 409)
    count = await entry_count(db, raffle["id"])
    if count:
        people = "eine Person" if count == 1 else f"{count} Personen"
        _fail(f"An dieser Verlosung {'nimmt' if count == 1 else 'nehmen'} schon {people} teil – das Türchen lässt sich nicht mehr umwidmen oder löschen.", 409)
    await db[RAFFLES].delete_one({"id": raffle["id"]})


# ------------------------------------------------------------------ Wer mitmachen darf

async def _is_member(db, user: dict) -> bool:
    from services.membership_service import get_membership, is_active_member

    if user.get("is_club_member"):
        return True
    return is_active_member(await get_membership(user["id"]))


async def _is_staff(db, user: dict) -> bool:
    from services.permissions import areas_for

    return bool(STAFF_AREAS & await areas_for(user, db))


async def why_not(db, raffle: dict, user: dict | None) -> str | None:
    """Warum diese Person nicht mitmachen kann - None, wenn sie darf. Die Zeit prüft der Aufrufer."""
    if not user or not user.get("id"):
        return "Melde dich an, um mitzumachen."
    if user.get("is_active") is False or user.get("is_banned") or user.get("anonymized_at"):
        return "Mit diesem Konto kannst du nicht mitmachen."
    if raffle.get("audience") == "members" and not await _is_member(db, user):
        return "Diese Verlosung ist für Vereinsmitglieder."
    if not raffle.get("staff_may_enter") and await _is_staff(db, user):
        return "Vorstand und Verwaltung machen bei dieser Verlosung nicht mit."
    return None


def phase(raffle: dict, now: datetime) -> str:
    """``open`` (Teilnahme läuft), ``closed`` (Schluss vorbei, noch nicht gezogen) oder ``drawn``."""
    if raffle.get("status") == "drawn":
        return "drawn"
    if raffle.get("status") == "drawing":
        return "closed"
    closes = _moment(raffle.get("closes_at"))
    return "closed" if closes and now > closes else "open"


def terms(raffle: dict) -> list[str]:
    """Die Teilnahmebedingungen in einfachen Sätzen - für Web und App derselbe Text."""
    closes = _moment(raffle.get("closes_at"))
    until = f"{closes.day}.{closes.month}.{closes.year}, {closes.hour:02d}:{closes.minute:02d} Uhr" if closes else "zum Ende des Kalenders"
    who = "Mitmachen können Vereinsmitglieder mit Konto." if raffle.get("audience") == "members" else "Mitmachen kann, wer ein Konto hat."
    winners = int(raffle.get("winners") or 1)
    return [
        who + ("" if raffle.get("staff_may_enter") else " Vorstand und Verwaltung machen nicht mit."),
        f"Die Teilnahme ist kostenlos und bis {until} möglich. Bis dahin kannst du sie auch zurückziehen.",
        f"Gezogen wird per Zufall; jede Person hat ein Los. Es {'gewinnt eine Person' if winners == 1 else f'gewinnen {winners} Personen'}.",
        "Wer gewinnt, bekommt eine Nachricht auf der Plattform und findet den Gewinn unter „Meine Gewinne“. Namen werden nicht veröffentlicht.",
        "Der Gewinn wird beim Verein abgeholt; eine Auszahlung in bar gibt es nicht.",
    ]


async def public_state(db, raffle: dict | None, viewer: dict | None, now: datetime | None = None) -> dict | None:
    """Was eine Person zur Verlosung sieht - nie, wer sonst mitmacht oder gewonnen hat."""
    if not raffle:
        return None
    now = seasons.to_vienna(now)
    state = phase(raffle, now)
    user_id = (viewer or {}).get("id")
    entered = bool(user_id and await db[ENTRIES].find_one({"raffle_id": raffle["id"], "user_id": user_id}, {"_id": 0, "id": 1}))
    blocked = await why_not(db, raffle, viewer) if state == "open" else None
    won = bool(user_id and state == "drawn" and any(user_id == winner.get("user_id") for draw in raffle.get("draws") or [] for winner in draw.get("winners") or []))
    if state == "drawn":
        hint = "Du hast gewonnen – schau unter „Meine Gewinne“." if won else "Die Verlosung ist gezogen. Wer gewonnen hat, wurde benachrichtigt."
    elif state == "closed":
        hint = "Die Teilnahme ist vorbei – gezogen wird in Kürze."
    else:
        hint = "Du bist dabei. Viel Glück!" if entered else blocked
    return {
        "label": raffle.get("prize_label"), "value": raffle.get("prize_value") or "", "winners": int(raffle.get("winners") or 1),
        "audience": raffle.get("audience") or "all", "closes_at": raffle.get("closes_at"), "status": state,
        "entries": await entry_count(db, raffle["id"]), "entered": entered, "can_enter": state == "open" and not entered and blocked is None,
        "can_withdraw": state == "open" and entered, "won": won, "hint": hint, "terms": terms(raffle),
    }


async def enter(db, raffle: dict, user: dict, now: datetime | None = None) -> dict:
    now = seasons.to_vienna(now)
    if phase(raffle, now) != "open":
        _fail("Die Teilnahme an dieser Verlosung ist vorbei.", 409)
    blocked = await why_not(db, raffle, user)
    if blocked:
        _fail(blocked, 403)
    await db[ENTRIES].update_one(
        {"raffle_id": raffle["id"], "user_id": user["id"]},
        {"$setOnInsert": {"id": new_id(), "raffle_id": raffle["id"], "user_id": user["id"], "entered_at": now_utc().isoformat()}},
        upsert=True,
    )
    return await public_state(db, raffle, user, now)


async def withdraw(db, raffle: dict, user: dict, now: datetime | None = None) -> dict:
    now = seasons.to_vienna(now)
    if phase(raffle, now) != "open":
        _fail("Die Teilnahme ist vorbei – zurückziehen geht nicht mehr.", 409)
    await db[ENTRIES].delete_one({"raffle_id": raffle["id"], "user_id": user["id"]})
    return await public_state(db, raffle, user, now)


# ------------------------------------------------------------------ Ziehen

async def _eligible(db, raffle: dict, exclude: set[str]) -> tuple[int, list[dict]]:
    """(Zahl der Lose, Personen, die jetzt noch gewinnen können) - wer sein Konto gelöscht hat oder gesperrt ist,
    fällt heraus; bei einer Verlosung für Mitglieder zählt die Mitgliedschaft am Tag der Ziehung."""
    entries = await db[ENTRIES].find({"raffle_id": raffle["id"]}, {"_id": 0}).sort("entered_at", 1).to_list(100000)
    ids = [entry["user_id"] for entry in entries]
    users = {row["id"]: row async for row in db.users.find({"id": {"$in": ids}}, {"_id": 0, "password_hash": 0})} if ids else {}
    fit = []
    for entry in entries:
        user = users.get(entry["user_id"])
        if not user or user["id"] in exclude:
            continue
        if await why_not(db, raffle, user) is None:
            fit.append(user)
    return len(entries), fit


async def _award(db, raffle: dict, user: dict, draw_id: str) -> str:
    """Der Gewinn als Abholschein - derselbe Weg wie ein Turnierpreis - und die private Nachricht dazu."""
    stamp = now_utc()
    pickup = {
        "id": new_id(), "source_type": "season", "season_key": raffle.get("season"), "season_year": raffle.get("year"),
        "season_raffle_id": raffle["id"], "season_draw_id": draw_id, "season_source_label": raffle.get("source_label"),
        "source_url": raffle.get("source_url"),
        "tournament_id": None, "tournament_title": raffle.get("title"), "tournament_slug": None,
        "user_id": user["id"], "team_id": None, "place": 0, "prize_group": "raffle", "place_label": "Verlosung",
        "prize_label": raffle.get("prize_label") or "", "prize_value": raffle.get("prize_value") or "",
        "status": "pending", "pickup_deadline": (stamp + timedelta(days=DEFAULT_PICKUP_WINDOW_DAYS)).isoformat(),
        "ready_at": None, "picked_up_at": None, "picked_up_by": None, "notes": "",
        "created_at": stamp.isoformat(), "updated_at": stamp.isoformat(),
    }
    await db.prize_pickups.insert_one(pickup)
    try:
        from services.user_notifications import create_user_notification

        await create_user_notification(
            user["id"], "Du hast gewonnen!",
            f"{raffle.get('title')}, {raffle.get('source_label')}: {raffle.get('prize_label')}. Du findest den Gewinn unter „Meine Gewinne“ – wir melden uns, sobald er abholbereit ist.",
            url="/me/prizes", kind="prize_pending",
            meta={"source_type": "season", "raffle_id": raffle["id"], "pickup_id": pickup["id"], "dedupe_key": f"raffle:{raffle['id']}:{user['id']}"},
        )
    except Exception:  # noqa: BLE001 - der Gewinn steht; die Nachricht ist das Zweite
        logger.warning("[raffles] Nachricht an den Gewinner nicht zugestellt (Verlosung %s)", raffle["id"], exc_info=True)
    return pickup["id"]


async def draw(db, raffle: dict, actor: dict, now: datetime | None = None, close_early: bool = False) -> dict:
    """Die Ziehung. Vor dem Teilnahmeschluss nur mit ``close_early`` - die Teilnahme endet dann in diesem Augenblick."""
    now = seasons.to_vienna(now)
    state = phase(raffle, now)
    if state == "drawn":
        _fail("Diese Verlosung ist schon gezogen.", 409)
    if state == "open" and not close_early:
        closes = _moment(raffle.get("closes_at"))
        _fail(f"Die Teilnahme läuft noch bis {closes.day}.{closes.month}. um {closes.hour:02d}:{closes.minute:02d} Uhr. Früher ziehen geht nur mit „Teilnahme jetzt beenden“.", 409)
    # Nur eine Ziehung zugleich: wer zuerst kommt, sperrt - ein zweiter Klick findet nichts mehr zu ziehen.
    locked = await db[RAFFLES].update_one({"id": raffle["id"], "status": "open"}, {"$set": {"status": "drawing"}})
    if not locked.modified_count:
        _fail("Diese Verlosung wird gerade gezogen oder ist schon gezogen.", 409)
    try:
        total, fit = await _eligible(db, raffle, set())
        if not fit:
            _fail("Niemand kann gewinnen: es hat niemand mitgemacht, der teilnehmen darf.", 409)
        chosen = _rng.sample(fit, min(int(raffle.get("winners") or 1), len(fit)))
        draw_id = new_id()
        stamp = now_utc().isoformat()
        winners = [{"user_id": user["id"], "pickup_id": await _award(db, raffle, user, draw_id)} for user in chosen]
    except BaseException:
        await db[RAFFLES].update_one({"id": raffle["id"], "status": "drawing"}, {"$set": {"status": "open"}})
        raise
    record = {
        "id": draw_id, "kind": "draw", "drawn_at": stamp, "drawn_by": actor.get("id"), "entries": total, "eligible": len(fit),
        "winners": winners, "method": "Zufallsziehung, jede Person ein Los", "closed_early": state == "open",
    }
    update = {"status": "drawn", "drawn_at": stamp, "updated_at": stamp}
    if state == "open":
        update["closes_at"] = now.isoformat()
    await db[RAFFLES].update_one({"id": raffle["id"]}, {"$set": update, "$push": {"draws": record}})
    return await db[RAFFLES].find_one({"id": raffle["id"]}, {"_id": 0})


async def redraw(db, raffle: dict, pickup_id: str, actor: dict) -> dict:
    """Nachziehen: ein Gewinn ist verfallen - unter allen, die noch nicht gewonnen haben, wird ein Ersatz gezogen."""
    if raffle.get("status") != "drawn":
        _fail("Nachziehen geht erst nach der Ziehung.", 409)
    won = {winner["user_id"]: winner for record in raffle.get("draws") or [] for winner in record.get("winners") or []}
    lost = next((winner for winner in won.values() if winner.get("pickup_id") == pickup_id), None)
    if not lost:
        _fail("Dieser Gewinn gehört nicht zu dieser Verlosung.", 404)
    if any(record.get("replaces") == pickup_id for record in raffle.get("draws") or []):
        _fail("Für diesen Gewinn wurde schon nachgezogen.", 409)
    pickup = await db.prize_pickups.find_one({"id": pickup_id}, {"_id": 0, "status": 1})
    if not pickup or pickup.get("status") != "expired":
        _fail("Nachziehen geht nur, wenn der Gewinn verfallen ist (Gewinne → Status „Verfallen“).", 409)
    total, fit = await _eligible(db, raffle, set(won))
    if not fit:
        _fail("Es ist niemand mehr da, der noch nicht gewonnen hat.", 409)
    chosen = _rng.sample(fit, 1)[0]
    draw_id = new_id()
    stamp = now_utc().isoformat()
    record = {
        "id": draw_id, "kind": "redraw", "drawn_at": stamp, "drawn_by": actor.get("id"), "entries": total, "eligible": len(fit),
        "winners": [{"user_id": chosen["id"], "pickup_id": await _award(db, raffle, chosen, draw_id)}],
        "method": "Zufallsziehung unter allen, die noch nicht gewonnen haben", "replaces": pickup_id,
    }
    await db[RAFFLES].update_one({"id": raffle["id"]}, {"$set": {"updated_at": stamp}, "$push": {"draws": record}})
    return await db[RAFFLES].find_one({"id": raffle["id"]}, {"_id": 0})


# ------------------------------------------------------------------ Für die Verwaltung

async def admin_state(db, raffle: dict | None, now: datetime | None = None) -> dict | None:
    """Die Verlosung mit Protokoll - hier stehen Namen, weil die Verwaltung den Gewinn übergeben muss."""
    if not raffle:
        return None
    now = seasons.to_vienna(now)
    ids = {winner["user_id"] for record in raffle.get("draws") or [] for winner in record.get("winners") or []} | {record.get("drawn_by") for record in raffle.get("draws") or []}
    ids.discard(None)
    names = {row["id"]: row.get("display_name") or row.get("username") or "Unbekannt" async for row in db.users.find({"id": {"$in": sorted(ids)}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1})} if ids else {}
    pickups = {row["id"]: row.get("status") async for row in db.prize_pickups.find({"season_raffle_id": raffle["id"]}, {"_id": 0, "id": 1, "status": 1})}
    replaced = {record.get("replaces") for record in raffle.get("draws") or [] if record.get("replaces")}
    protocol = []
    for record in raffle.get("draws") or []:
        protocol.append({
            "id": record["id"], "kind": record.get("kind") or "draw", "drawn_at": record.get("drawn_at"), "drawn_by": names.get(record.get("drawn_by")) or "Unbekannt",
            "entries": record.get("entries"), "eligible": record.get("eligible"), "method": record.get("method"), "closed_early": bool(record.get("closed_early")),
            "replaces": record.get("replaces"),
            "winners": [{
                "user_id": winner["user_id"], "name": names.get(winner["user_id"]) or "Gelöschtes Konto", "pickup_id": winner.get("pickup_id"),
                "pickup_status": pickups.get(winner.get("pickup_id")), "replaced": winner.get("pickup_id") in replaced,
                "can_redraw": pickups.get(winner.get("pickup_id")) == "expired" and winner.get("pickup_id") not in replaced,
            } for winner in record.get("winners") or []],
        })
    state = phase(raffle, now)
    return {
        "id": raffle["id"], "label": raffle.get("prize_label"), "value": raffle.get("prize_value") or "", "winners": int(raffle.get("winners") or 1),
        "audience": raffle.get("audience") or "all", "staff_may_enter": bool(raffle.get("staff_may_enter")), "closes_at": raffle.get("closes_at"),
        "status": state, "entries": await entry_count(db, raffle["id"]), "can_draw": state != "drawn", "needs_close_early": state == "open",
        "terms": terms(raffle), "protocol": protocol,
    }


# ------------------------------------------------------------------ Datenschutz

async def forget_user(db, user_id: str) -> None:
    """Konto gelöscht: die Teilnahmen verschwinden. Das Protokoll einer Ziehung bleibt - es nennt nur die Kennung."""
    await db[ENTRIES].delete_many({"user_id": user_id})
