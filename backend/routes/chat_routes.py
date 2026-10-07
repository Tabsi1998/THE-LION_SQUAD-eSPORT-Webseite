"""Alle Chats an einem Ort (#1148).

Direktnachrichten, Team-, Turnier- und Match-Chats einer Person stehen in einer Liste: je Unterhaltung Name, Bild,
letzte Nachricht, Zeit und die Zahl der Ungelesenen, das Neueste oben. Die Chats selbst bleiben, wo sie sind - die
Liste zeigt nur, was es gibt, und führt hin.

Wer was sieht, ist dieselbe Regel wie in den Chats selbst, nur enger gefasst, damit die Liste nicht überläuft:
- Direktnachrichten: die eigenen Unterhaltungen (wie ``/api/messages/conversations``).
- Team-Chats: Teams, in denen man Mitglied, Leitung oder Co-Leitung ist.
- Turnier-Chats: Turniere, bei denen man (selbst oder mit dem Team) bestätigt angemeldet ist - wenn der Chat dort
  eingeschaltet ist -, und Turniere, bei denen man als Turnierleitung eingetragen ist.
- Match-Chats: eigene Matches und Matches im Bereich der eigenen Turnierleitung, sobald dort geschrieben wurde.
Turnier- und Match-Chats verschwinden 3 Tage nach Turnierende aus der Liste; auf ihrer Seite bleiben sie lesbar.

„Ungelesen“: Direktnachrichten wie bisher je Nachricht (``read_at``). Für die anderen Chats merkt sich der Server je
Person und Unterhaltung „gelesen bis“ (``chat_reads``); Web und App setzen die Marke beim Öffnen des Chats
(``POST /api/chats/{kind}/{id}/read``) - so ist die Zahl überall gleich. Ohne Marke zählen nur die Nachrichten der
letzten drei Tage, damit alte Chats nicht mit hundert Ungelesenen auftauchen.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from database import get_db
from models import now_utc
from services import word_filter
from services.chat_attachments import chat_message_preview

router = APIRouter(prefix="/api/chats", tags=["chats"])

CHAT_KINDS = ("direct", "team", "tournament", "match")
KIND_LABELS = {"direct": "Nachricht", "team": "Team-Chat", "tournament": "Turnier-Chat", "match": "Match-Chat"}
ACTIVE_REGISTRATION_STATUSES = ["approved", "checked_in"]
ENDED_TOURNAMENT_STATUSES = {"completed", "results_published", "archived", "cancelled"}
INACTIVE_TEAM_STATUSES = {"archived", "dissolved", "deleted"}
# Turnier- und Match-Chats bleiben nach dem Turnierende noch so lange in der Liste.
ENDED_GRACE = timedelta(days=3)
# Ohne „gelesen bis“ zählen nur Nachrichten aus diesem Zeitraum als ungelesen.
UNREAD_WITHOUT_MARK = timedelta(days=3)
UNREAD_CAP = 99
PREVIEW_LENGTH = 90
# Benachrichtigungen, die mit dem Lesen eines Chats erledigt sind (Glocke und Liste zählen dasselbe).
READ_NOTIFICATION_KINDS = {
    "team": (["team_chat_message", "team_chat_mention"], "meta.team_id"),
    "tournament": (["tournament_chat_message", "tournament_chat_mention"], "meta.tournament_id"),
    "match": (["match_chat_message", "match_chat_mention"], "meta.match_id"),
}


def _parse(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _iso(value) -> str:
    parsed = _parse(value)
    return parsed.isoformat() if parsed else ""


def _label(user: dict | None) -> str:
    return (user or {}).get("display_name") or (user or {}).get("username") or "Benutzer"


def chat_key(kind: str, target_id: str) -> str:
    return f"{kind}:{target_id}"


def tournament_chat_listed(tournament: dict, now: datetime) -> bool:
    """Steht der Turnier-Chat (und die Match-Chats darin) noch in der Liste? Bis 3 Tage nach dem Ende."""
    status = str(tournament.get("status") or "")
    end = _parse(tournament.get("end_date"))
    ended_at = None
    if status in ENDED_TOURNAMENT_STATUSES:
        ended_at = end or _parse(tournament.get("updated_at")) or _parse(tournament.get("start_date"))
    elif end and end < now:
        ended_at = end
    if not ended_at:
        return True
    return now - ended_at <= ENDED_GRACE


def _preview(message: dict | None, users: dict[str, dict]) -> dict | None:
    if not message:
        return None
    author_id = message.get("user_id") or message.get("sender_id")
    return {
        "text": chat_message_preview(message, PREVIEW_LENGTH),
        "author": _label(users.get(author_id)) if author_id else "",
        "author_id": author_id,
        "created_at": _iso(message.get("created_at")),
    }


async def _read_marks(db, user_id: str) -> dict[str, str]:
    rows = await db.chat_reads.find({"user_id": user_id}, {"_id": 0, "key": 1, "read_at": 1}).to_list(2000)
    return {row["key"]: row.get("read_at") or "" for row in rows if row.get("key")}


async def _chat_summary(db, collection: str, field: str, target_id: str, me_id: str, mark: str | None, now: datetime) -> tuple[dict | None, int]:
    """Letzte sichtbare Nachricht und Zahl der Ungelesenen in einem Gruppen-Chat."""
    base = {field: target_id, "deleted_at": {"$exists": False}}
    latest_rows = await getattr(db, collection).find(base, {"_id": 0}).sort("created_at", -1).to_list(8)
    latest = next((row for row in latest_rows if word_filter.visible_to(row, me_id)), None)
    since = mark or (now - UNREAD_WITHOUT_MARK).isoformat()
    unread_rows = await getattr(db, collection).find(
        {**base, "user_id": {"$ne": me_id}, "created_at": {"$gt": since}},
        {"_id": 0, "user_id": 1, "moderation": 1},
    ).to_list(UNREAD_CAP + 1)
    unread = sum(1 for row in unread_rows if word_filter.visible_to(row, me_id))
    return latest, min(unread, UNREAD_CAP)


async def _direct_items(db, me: dict) -> list[dict]:
    rows = await db.direct_messages.find(
        {"$or": [{"sender_id": me["id"]}, {"recipient_id": me["id"]}]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(600)
    threads: dict[str, dict] = {}
    for row in rows:
        if not word_filter.visible_to(row, me["id"]):
            continue
        other_id = row.get("recipient_id") if row.get("sender_id") == me["id"] else row.get("sender_id")
        if not other_id:
            continue
        thread = threads.setdefault(other_id, {"latest": row, "unread": 0})
        if row.get("recipient_id") == me["id"] and not row.get("read_at"):
            thread["unread"] += 1
    if not threads:
        return []
    users = {me["id"]: me}
    users.update({u["id"]: u for u in await db.users.find(
        {"id": {"$in": list(threads)}, "is_active": {"$ne": False}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1},
    ).to_list(600)})
    items = []
    for other_id, thread in threads.items():
        other = users.get(other_id)
        if not other:
            continue
        items.append({
            "kind": "direct",
            "target_id": other_id,
            "title": _label(other),
            "username": other.get("username"),
            "image": other.get("avatar_url"),
            "url": f"/messages/{other_id}",
            "last_message": _preview(thread["latest"], users),
            "unread_count": min(thread["unread"], UNREAD_CAP),
        })
    return items


async def _my_teams(db, me_id: str) -> list[dict]:
    teams = await db.teams.find(
        {"$or": [{"member_ids": me_id}, {"leader_id": me_id}, {"co_leader_ids": me_id}]},
        {"_id": 0, "id": 1, "name": 1, "tag": 1, "logo_url": 1, "status": 1},
    ).to_list(100)
    return [team for team in teams if str(team.get("status") or "active") not in INACTIVE_TEAM_STATUSES]


async def _team_items(db, me: dict, teams: list[dict], marks: dict[str, str], now: datetime) -> tuple[list[dict], list[dict]]:
    items, latest_messages = [], []
    for team in teams:
        latest, unread = await _chat_summary(db, "team_chat_messages", "team_id", team["id"], me["id"], marks.get(chat_key("team", team["id"])), now)
        if latest:
            latest_messages.append(latest)
        items.append({
            "kind": "team",
            "target_id": team["id"],
            "title": team.get("name") or "Team",
            "tag": team.get("tag"),
            "image": team.get("logo_url"),
            "url": f"/teams/{team['id']}",
            "_latest": latest,
            "unread_count": unread,
        })
    return items, latest_messages


async def _my_registrations(db, me_id: str, team_ids: list[str]) -> list[dict]:
    query = {"status": {"$in": ACTIVE_REGISTRATION_STATUSES}, "$or": [{"user_id": me_id}]}
    if team_ids:
        query["$or"].append({"team_id": {"$in": team_ids}})
    return await db.tournament_registrations.find(
        query, {"_id": 0, "id": 1, "tournament_id": 1, "user_id": 1, "team_id": 1},
    ).to_list(1000)


async def _staff_assignments(db, me_id: str) -> list[dict]:
    return await db.tournament_staff_assignments.find(
        {"user_id": me_id, "is_active": {"$ne": False}},
        {"_id": 0, "tournament_id": 1, "scope": 1, "scope_id": 1},
    ).to_list(500)


def _assignment_covers(assignment: dict, match: dict) -> bool:
    """Dieselbe Regel wie im Match-Chat: Turnier, Stage, Station oder das Match selbst."""
    scope = assignment.get("scope") or "tournament"
    scope_id = assignment.get("scope_id")
    if assignment.get("tournament_id") != match.get("tournament_id"):
        return False
    if scope == "tournament" or not scope_id:
        return True
    if scope == "match":
        return scope_id == match.get("id")
    if scope == "stage":
        return scope_id == match.get("stage_id")
    if scope == "station":
        return scope_id == match.get("station_id")
    return False


async def _tournament_items(db, me: dict, tournaments: dict[str, dict], participant_ids: set[str], staff_ids: set[str], marks: dict[str, str], now: datetime) -> tuple[list[dict], list[dict]]:
    items, latest_messages = [], []
    for tid, tournament in tournaments.items():
        staff = tid in staff_ids
        # Wie im Turnier-Chat: Teilnehmer nur, wenn der Chat dort eingeschaltet ist; die Turnierleitung immer.
        if not staff and not (tid in participant_ids and tournament.get("show_chat") is True):
            continue
        latest, unread = await _chat_summary(db, "tournament_chat_messages", "tournament_id", tid, me["id"], marks.get(chat_key("tournament", tid)), now)
        if latest:
            latest_messages.append(latest)
        items.append({
            "kind": "tournament",
            "target_id": tid,
            "slug": tournament.get("slug"),
            "title": tournament.get("title") or "Turnier",
            "image": tournament.get("logo_url") or tournament.get("banner_url"),
            "url": f"/tournaments/{tournament.get('slug') or tid}/chat",
            "_latest": latest,
            "unread_count": unread,
        })
    return items, latest_messages


async def _match_items(db, me: dict, tournaments: dict[str, dict], registration_ids: set[str], assignments: list[dict], marks: dict[str, str], now: datetime) -> tuple[list[dict], list[dict]]:
    fields = {"_id": 0, "id": 1, "tournament_id": 1, "stage_id": 1, "station_id": 1, "slots": 1, "match_key": 1, "round_name": 1}
    candidates: dict[str, dict] = {}
    if registration_ids:
        for match in await db.matches_v2.find({"slots.registration_id": {"$in": sorted(registration_ids)}}, fields).to_list(1000):
            if match.get("tournament_id") in tournaments:
                candidates[match["id"]] = match
    staff_tids = sorted({row.get("tournament_id") for row in assignments if row.get("tournament_id") in tournaments})
    if staff_tids:
        chatted = await db.match_chat_messages.distinct("match_id", {"tournament_id": {"$in": staff_tids}})
        if chatted:
            for match in await db.matches_v2.find({"id": {"$in": [mid for mid in chatted if mid not in candidates]}}, fields).to_list(1000):
                if any(_assignment_covers(row, match) for row in assignments):
                    candidates[match["id"]] = match
    if not candidates:
        return [], []
    # Nur Matches, in denen schon geschrieben wurde - sonst stünde jedes Spiel eines großen Turniers in der Liste.
    with_messages = set(await db.match_chat_messages.distinct("match_id", {"match_id": {"$in": list(candidates)}}))
    matches = [match for mid, match in candidates.items() if mid in with_messages]
    reg_ids = {slot.get("registration_id") for match in matches for slot in (match.get("slots") or []) if slot.get("registration_id")}
    regs = {row["id"]: row for row in await db.tournament_registrations.find(
        {"id": {"$in": sorted(reg_ids)}}, {"_id": 0, "id": 1, "display_name": 1},
    ).to_list(2000)} if reg_ids else {}
    items, latest_messages = [], []
    for match in matches:
        names = [regs.get(slot.get("registration_id"), {}).get("display_name") for slot in (match.get("slots") or [])]
        names = [name for name in names if name]
        latest, unread = await _chat_summary(db, "match_chat_messages", "match_id", match["id"], me["id"], marks.get(chat_key("match", match["id"])), now)
        if latest:
            latest_messages.append(latest)
        tournament = tournaments.get(match.get("tournament_id")) or {}
        items.append({
            "kind": "match",
            "target_id": match["id"],
            "title": " gegen ".join(names) if len(names) >= 2 else (match.get("round_name") or match.get("match_key") or "Match"),
            "context": tournament.get("title"),
            "url": f"/matches/{match['id']}",
            "_latest": latest,
            "unread_count": unread,
        })
    return items, latest_messages


async def build_chat_list(db, me: dict, now: datetime | None = None) -> dict:
    now = now or now_utc()
    marks = await _read_marks(db, me["id"])
    teams = await _my_teams(db, me["id"])
    team_ids = [team["id"] for team in teams]
    registrations = await _my_registrations(db, me["id"], team_ids)
    assignments = await _staff_assignments(db, me["id"])
    participant_ids = {row.get("tournament_id") for row in registrations if row.get("tournament_id")}
    staff_ids = {row.get("tournament_id") for row in assignments if row.get("tournament_id")}
    tournaments = {}
    if participant_ids or staff_ids:
        rows = await db.tournaments.find(
            {"id": {"$in": sorted(participant_ids | staff_ids)}},
            {"_id": 0, "id": 1, "slug": 1, "title": 1, "status": 1, "end_date": 1, "start_date": 1, "updated_at": 1, "show_chat": 1, "logo_url": 1, "banner_url": 1},
        ).to_list(1000)
        tournaments = {row["id"]: row for row in rows if tournament_chat_listed(row, now)}

    direct = await _direct_items(db, me)
    team_items, team_latest = await _team_items(db, me, teams, marks, now)
    tournament_items, tournament_latest = await _tournament_items(db, me, tournaments, participant_ids, staff_ids, marks, now)
    registration_ids = {row["id"] for row in registrations if row.get("id")}
    match_items, match_latest = await _match_items(db, me, tournaments, registration_ids, assignments, marks, now)

    author_ids = {row.get("user_id") for row in [*team_latest, *tournament_latest, *match_latest] if row.get("user_id")}
    authors = {me["id"]: me}
    if author_ids:
        authors.update({u["id"]: u for u in await db.users.find(
            {"id": {"$in": sorted(author_ids)}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1},
        ).to_list(1000)})

    items = list(direct)
    for item in [*team_items, *tournament_items, *match_items]:
        item["last_message"] = _preview(item.pop("_latest"), authors)
        items.append(item)
    for item in items:
        item["key"] = chat_key(item["kind"], item["target_id"])
        item["subtitle"] = KIND_LABELS[item["kind"]]
        item["updated_at"] = (item.get("last_message") or {}).get("created_at") or ""
    # Das Neueste oben; Unterhaltungen ohne Nachricht (ein neues Team, ein Turnier vor dem Start) am Ende.
    items.sort(key=lambda item: item["title"].lower())
    items.sort(key=lambda item: item["updated_at"], reverse=True)
    return {"items": items, "unread_total": sum(int(item.get("unread_count") or 0) for item in items)}


@router.get("")
async def list_chats(me: dict = Depends(get_current_user)):
    return await build_chat_list(get_db(), me)


@router.get("/unread")
async def unread_chats(me: dict = Depends(get_current_user)):
    """Nur die Zahl für den Tab „Community“ und das Menü - ohne die Liste mitzuschicken."""
    data = await build_chat_list(get_db(), me)
    return {"unread_total": data["unread_total"]}


@router.post("/{kind}/{target_id}/read")
async def mark_chat_read(kind: str, target_id: str, me: dict = Depends(get_current_user)):
    """„Gelesen bis jetzt“ für eine Unterhaltung - Web und App rufen das beim Öffnen des Chats."""
    if kind not in CHAT_KINDS or not target_id or len(target_id) > 120:
        raise HTTPException(status_code=404, detail="Unterhaltung nicht gefunden")
    db = get_db()
    now = now_utc().isoformat()
    if kind == "direct":
        await db.direct_messages.update_many(
            {"sender_id": target_id, "recipient_id": me["id"], "read_at": {"$exists": False}},
            {"$set": {"read_at": now}},
        )
        await db.notifications.update_many(
            {"user_id": me["id"], "kind": "direct_message", "meta.thread_user_id": target_id, "read": {"$ne": True}},
            {"$set": {"read": True}},
        )
        return {"ok": True, "read_at": now}
    collection = {"team": "teams", "tournament": "tournaments", "match": "matches_v2"}[kind]
    # Turniere kommen auch mit ihrer Adresse (Slug) - die Marke gilt immer für die Kennung.
    query = {"$or": [{"id": target_id}, {"slug": target_id}]} if kind == "tournament" else {"id": target_id}
    found = await getattr(db, collection).find_one(query, {"_id": 0, "id": 1})
    if not found:
        raise HTTPException(status_code=404, detail="Unterhaltung nicht gefunden")
    target_id = found["id"]
    await db.chat_reads.update_one(
        {"user_id": me["id"], "key": chat_key(kind, target_id)},
        {"$set": {"user_id": me["id"], "key": chat_key(kind, target_id), "kind": kind, "target_id": target_id, "read_at": now}},
        upsert=True,
    )
    kinds, meta_field = READ_NOTIFICATION_KINDS[kind]
    await db.notifications.update_many(
        {"user_id": me["id"], "kind": {"$in": kinds}, meta_field: target_id, "read": {"$ne": True}},
        {"$set": {"read": True}},
    )
    return {"ok": True, "read_at": now}
