"""Die eigene Turnieranmeldung ändern (#2113, L-A2): Ingame-Name, Spieler-IDs und Discord selbst korrigieren.

Bisher ging das nur über die Turnierleitung. Wer die Anmeldung ändern darf: bei Einzelanmeldungen die Person selbst, bei
Team-Anmeldungen nur die Teamleitung (Kapitän und Co-Kapitän). Bis wann: solange die Anmeldung nicht eingecheckt ist und
der Check-in läuft oder noch kommt - danach ändert die Turnierleitung.

Liga-Staffeln: die Spiel-ID einer Season steht eingefroren im Liga-Kader (``league_rosters``, #2108). Ingame-Name und IDs
bleiben dort gesperrt; ändern kann sie nur die Liga-Leitung. Der Discord-Kontakt lässt sich weiter ändern.

Die Änderung gilt nur für diese Anmeldung - das Profil bleibt, wie es ist. Die IDs gehen nur an die Person, die ändern
darf, und ins Protokoll kommen nur die Feldnamen, nie die Werte."""
from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import get_current_user
from database import get_db
from models import now_utc
from routes.tournament_common import (
    _audit_tournament_action,
    _enrich_game_identity,
    _ensure_tournament_unlocked,
    _missing_game_fields,
    _resolve_tid,
    _serialized_tournament_write,
)
from routes.tournament_registration_routes import WAITLIST_MOVE_UP_STATUSES, _check_in_over
from routes.tournament_router import router
from services import tournament_guard, word_filter
from services.league_scope import is_league_staffel
from services.match_audience import responsible_ids, responsible_registration, teams_by_id

EDITABLE_STATUSES = {"pending", "approved", "waitlist"}
MAX_ID_LENGTH = 128
LEAGUE_IDS_LOCKED = ("In der Liga gilt die Spiel-ID für die ganze Season und steht im Liga-Kader. Ingame-Name und IDs ändert "
                     "hier nur die Liga-Leitung.")
NOT_YOURS = "Du hast keine Anmeldung zu diesem Turnier."
ONLY_LEADERSHIP = "Die Anmeldung deines Teams ändert nur die Teamleitung."


class RegistrationSelfUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ingame_name: str | None = Field(default=None, max_length=64)
    discord: str | None = Field(default=None, max_length=64)
    player_ids: dict[str, str] | None = None


async def _edit_block_reason(db, tournament: dict, registration: dict) -> str | None:
    """Warum die Anmeldung nicht mehr selbst geändert werden kann - ``None``, solange es geht."""
    status = registration.get("status")
    if status == "checked_in":
        return "Du bist schon eingecheckt – Änderungen macht jetzt die Turnierleitung."
    if status not in EDITABLE_STATUSES:
        return "Diese Anmeldung lässt sich nicht mehr ändern."
    if tournament.get("status") not in WAITLIST_MOVE_UP_STATUSES:
        return "Das Turnier läuft schon – Änderungen macht jetzt die Turnierleitung."
    if _check_in_over(tournament):
        return "Der Check-in ist vorbei – Änderungen macht jetzt die Turnierleitung."
    # Dieselbe Grenze wie beim Abmelden: wer schon in festen Spielen steht (Gruppen, Schweizer Runde), ändert nicht mehr.
    if await tournament_guard.fixed_match_count(db, tournament["id"], registration["id"]):
        return "Du stehst schon in festen Spielen dieses Turniers – Änderungen macht jetzt die Turnierleitung."
    return None


async def _leads_registration(db, registration: dict, me: dict) -> bool:
    """Einzelanmeldung: die Person selbst. Team-Anmeldung: Kapitän und Co-Kapitän, beim Co-Team einer Liga Captain und
    Vertreter (ohne beide die Teamleitung) - dieselbe Regel wie beim Einchecken (``match_audience``). Wer das Team einst
    angemeldet hat, ändert nach einem Wechsel in der Leitung nichts mehr: darum zählt ``user_id`` hier nicht."""
    if not registration.get("team_id"):
        return registration.get("user_id") == me["id"]
    teams = await teams_by_id(db, [registration])
    return me["id"] in responsible_ids({**registration, "user_id": None}, teams.get(registration["team_id"]))

async def _game_of(db, tournament: dict) -> dict | None:
    game = await db.games.find_one({"id": tournament.get("game_id")}, {"_id": 0}) if tournament.get("game_id") else None
    return await _enrich_game_identity(db, game)


def _id_fields(game: dict | None) -> list[dict]:
    fields = (game or {}).get("effective_player_id_fields") or (game or {}).get("player_id_fields") or []
    return [field for field in fields if isinstance(field, dict) and field.get("key")]


def _clean_player_ids(changes: dict[str, str], fields: list[dict], current: dict | None) -> dict:
    """Nur die Felder des Spiels; ein leerer Wert nimmt die ID weg, ob sie Pflicht ist, prüft der Aufrufer."""
    known = {field["key"] for field in fields}
    unknown = sorted(set(changes) - known)
    if unknown:
        raise HTTPException(status_code=400, detail="Dieses Spiel kennt diese ID nicht.")
    merged = dict(current or {})
    for key, value in changes.items():
        text = str(value or "").strip()
        if len(text) > MAX_ID_LENGTH:
            raise HTTPException(status_code=400, detail=f"Eine ID darf höchstens {MAX_ID_LENGTH} Zeichen haben.")
        if text:
            merged[key] = text
        else:
            merged.pop(key, None)
    return merged


async def _view(db, tournament: dict, registration: dict, me: dict) -> dict:
    game = await _game_of(db, tournament)
    league = is_league_staffel(tournament)
    leads = await _leads_registration(db, registration, me)
    reason = await _edit_block_reason(db, tournament, registration) if leads else ONLY_LEADERSHIP
    # Nur wer ändern darf, sieht die IDs und den Discord-Kontakt der Anmeldung.
    private = {"discord": registration.get("discord"), "player_ids": registration.get("player_ids") or {}} if leads else {}
    return {
        "id": registration.get("id"),
        "status": registration.get("status"),
        "is_team": bool(registration.get("team_id")),
        "ingame_name": registration.get("ingame_name"),
        **private,
        "fields": [{key: field.get(key) for key in ("key", "label", "required", "help_text")} for field in _id_fields(game)],
        "can_edit": reason is None,
        "reason": reason,
        "ids_locked": league,
        "ids_locked_reason": LEAGUE_IDS_LOCKED if league else None,
    }


@router.get("/{tid}/my-registration")
async def my_registration(tid: str, me: dict = Depends(get_current_user)):
    """Die Anmeldung, für die diese Person handelt - mit dem, was sie ändern darf, und dem Grund, wenn nicht."""
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    registration = await responsible_registration(db, tid, me["id"])
    if not registration:
        raise HTTPException(status_code=404, detail=NOT_YOURS)
    return await _view(db, tournament, registration, me)


@router.patch("/{tid}/my-registration")
async def update_my_registration(tid: str, body: RegistrationSelfUpdate, me: dict = Depends(get_current_user),
                                 _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _ensure_tournament_unlocked(db, tid)
    registration = await responsible_registration(db, tid, me["id"])
    if not registration:
        raise HTTPException(status_code=404, detail=NOT_YOURS)
    if not await _leads_registration(db, registration, me):
        raise HTTPException(status_code=403, detail=ONLY_LEADERSHIP)
    blocked = await _edit_block_reason(db, tournament, registration)
    if blocked:
        raise HTTPException(status_code=409, detail=blocked)

    changes = body.model_dump(exclude_unset=True)
    updates: dict = {}
    locked_change = False
    if "ingame_name" in changes:
        name = (changes["ingame_name"] or "").strip()
        if name != (registration.get("ingame_name") or ""):
            locked_change = True
            if not is_league_staffel(tournament):
                if not name:
                    raise HTTPException(status_code=400, detail="Bitte einen Ingame-Namen eintragen.")
                # Der Name steht öffentlich in der Teilnehmerliste - derselbe Wortfilter wie beim Anzeigenamen.
                await word_filter.screen_field(db, name, kind="display_name", user_id=me["id"], ref_id=registration["id"])
                updates["ingame_name"] = name
    if changes.get("player_ids") is not None:
        game = await _game_of(db, tournament)
        current = registration.get("player_ids") or {}
        merged = _clean_player_ids(changes["player_ids"], _id_fields(game), current)
        if merged != current:
            locked_change = True
            if not is_league_staffel(tournament):
                missing = _missing_game_fields(game, merged)
                if missing:
                    raise HTTPException(status_code=400, detail=f"Für dieses Turnier fehlen Pflicht-IDs: {', '.join(missing)}")
                updates["player_ids"] = merged
    if locked_change and is_league_staffel(tournament):
        raise HTTPException(status_code=409, detail=LEAGUE_IDS_LOCKED)
    if "discord" in changes:
        discord = (changes["discord"] or "").strip() or None
        if discord != (registration.get("discord") or None):
            updates["discord"] = discord
    if updates:
        await _audit_tournament_action(db, "tournament.registration.self_update", me["id"], tid,
                                       {"registration_id": registration["id"], "fields": sorted(updates)})
        updates["updated_at"] = now_utc().isoformat()
        await db.tournament_registrations.update_one({"id": registration["id"]}, {"$set": updates})
        registration = {**registration, **updates}
    return await _view(db, tournament, registration, me)
