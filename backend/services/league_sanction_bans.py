"""Sperren aus Strafen im Wettbewerb (E.3, docs/LIGA.md „E.3 Strafen“): welche Sperre gerade wirkt und wie lange die Nachweise
einer Strafe bleiben.

Blatt-Modul: ``league_eligibility`` (Spielberechtigung) und ``match_proof_retention`` (Aufbewahrung) lesen hier, ohne dass sich ein
Import-Kreis schließt. Verhängen, Widerruf, Einspruch und die Ansichten stehen in ``league_sanctions``.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from models import now_utc
from services.league_calendar import season_end_at
from services.log_safe import log_safe

logger = logging.getLogger("tls.league_sanctions")

PLAYER, SQUAD = "player", "squad"
PROVISIONAL, FINAL = "provisional", "final"
SANCTIONED = "sanctioned"
OPEN, UPHELD, GRANTED = "open", "upheld", "granted"
DECIDED_MATCH = frozenset({"completed", "forfeit"})
OPEN_END = "9999-12-31T00:00:00+00:00"

# Art → Bezeichnung, wen sie treffen kann und was sie braucht. ``ban``: wirkt auf die Spielberechtigung. ``league_wide``: gilt in
# jeder Season der Liga. ``provisional``: darf vorläufig sein (Nr. 44). ``staffel``: schreibt in die Staffel (Schreibsperre).
KINDS: dict[str, dict] = {
    "warning": {"label": "Verwarnung", "targets": (PLAYER, SQUAD)},
    "yellow_card": {"label": "Gelbe Karte", "targets": (PLAYER, SQUAD)},
    "red_card": {"label": "Rote Karte", "targets": (PLAYER, SQUAD)},
    "point_deduction": {"label": "Punktabzug", "targets": (SQUAD,), "staffel": True},
    "map_loss": {"label": "Mapverlust", "targets": (SQUAD,), "match": True},
    "match_loss": {"label": "Spielverlust", "targets": (SQUAD,), "match": True},
    "player_ban": {"label": "Spielsperre", "targets": (PLAYER,), "ban": True, "provisional": True},
    "team_ban": {"label": "Teamsperre", "targets": (SQUAD,), "ban": True, "provisional": True, "league_wide": True},
    "disqualification": {"label": "Disqualifikation", "targets": (SQUAD,), "staffel": True},
    "league_exclusion": {"label": "Ligaausschluss", "targets": (PLAYER, SQUAD), "ban": True, "league_wide": True},
    "external": {"label": "Externe Sperre", "targets": (PLAYER,), "ban": True, "league_wide": True},
}
BAN_KINDS = tuple(key for key, row in KINDS.items() if row.get("ban"))

PROVISIONAL_TEXT = "Vorläufig gesperrt, die Liga-Leitung prüft."


# ---------------------------------------------------------------- Zeit


def parse(value) -> datetime | None:
    from services.match_proof_refs import parse as _parse

    return _parse(value)


def _local(moment: datetime) -> str:
    from services.matchday_schedule import LOCAL_TZ

    return moment.astimezone(LOCAL_TZ).strftime("%d.%m.%Y, %H:%M")


# ---------------------------------------------------------------- Sperren und Spielberechtigung


@dataclass
class Bans:
    """Die laufenden Sperren eines Kontexts: Person → Sperre, Co-Team → Sperre. Je Sperre ``reason`` (ohne Verstoß), ``until``."""

    users: dict[str, dict] = field(default_factory=dict)
    squads: dict[str, dict] = field(default_factory=dict)


@dataclass
class Frame:
    """Was die Auswertung von Sperren nach Spielen braucht, für viele Strafen einmal geladen: das Ende ihrer Season und die
    entschiedenen Liga-Spiele ihrer Anmeldung, nach Zeitpunkt sortiert."""

    season_ends: dict[str, datetime | None] = field(default_factory=dict)
    decided: dict[str, list[tuple[datetime, str]]] = field(default_factory=dict)


async def frame_for(db, rows: list[dict]) -> Frame:
    """Zwei Abfragen für alle Sperren nach Spielen unter ``rows`` - statt einer je Sperre."""
    counted = [row for row in rows if row.get("matches") and row.get("kind") in BAN_KINDS]
    frame = Frame()
    if not counted:
        return frame
    season_ids = sorted({row["season_id"] for row in counted if row.get("season_id")})
    async for season in db.league_seasons.find({"id": {"$in": season_ids}}, {"_id": 0}):
        frame.season_ends[season["id"]] = season_end_at(season)
    registration_ids = sorted({row["registration_id"] for row in counted if row.get("registration_id")})
    if registration_ids:
        async for match in db.matches_v2.find(
                {"slots.registration_id": {"$in": registration_ids}, "status": {"$in": sorted(DECIDED_MATCH)}},
                {"_id": 0, "id": 1, "completed_at": 1, "is_preview": 1, "slots.registration_id": 1}):
            moment = parse(match.get("completed_at"))
            if match.get("is_preview") or not moment:
                continue
            for slot in match.get("slots") or []:
                if slot.get("registration_id") in registration_ids:
                    frame.decided.setdefault(slot["registration_id"], []).append((moment, match["id"]))
        for played in frame.decided.values():
            played.sort()
    return frame


def covered_matches(row: dict, frame: Frame) -> list[str]:
    """Die gesperrten Spiele einer Sperre nach Spielen: die ersten ``matches`` entschiedenen Liga-Spiele der Anmeldung ab ``starts_at``."""
    count, start = int(row.get("matches") or 0), parse(row.get("starts_at"))
    if not row.get("registration_id") or not count or not start:
        return []
    return [match_id for moment, match_id in frame.decided.get(row["registration_id"], []) if moment >= start][:count]


def season_over(row: dict, frame: Frame, at: datetime) -> bool:
    """Nr. 101: Eine Spielsperre endet spätestens mit ihrer Season - auch wenn nicht alle Spiele abgesessen sind (Team ausgeschieden,
    Person gewechselt, kein Spiel mehr angesetzt). Ohne bestimmbares Season-Ende gilt nur die Zählung."""
    end = frame.season_ends.get(row.get("season_id") or "")
    return bool(end and at >= end)


def _until_text(row: dict, remaining: int | None) -> str:
    whose = "Das Co-Team ist" if row.get("target_type") == SQUAD else "Ist"
    kind = row.get("kind")
    if row.get("state") == PROVISIONAL:
        return PROVISIONAL_TEXT if row.get("target_type") == PLAYER else "Das Co-Team ist vorläufig gesperrt, die Liga-Leitung prüft."
    if kind == "league_exclusion":
        return f"{whose} aus der Liga ausgeschlossen.".replace("Ist aus", "Aus")
    lead = "Extern gesperrt (Hersteller oder Plattform)" if kind == "external" else (
        "Das Co-Team ist gesperrt" if row.get("target_type") == SQUAD else "Gesperrt durch die Liga-Leitung")
    end = parse(row.get("ends_at"))
    if remaining:
        return f"{lead} für noch {remaining} Liga-{'Spiel' if remaining == 1 else 'Spiele'}."
    if remaining == 0:
        return f"{lead} für dieses Liga-Spiel."
    return f"{lead} bis {_local(end)}." if end else f"{lead}."


def ban_state(row: dict, frame: Frame, *, season_id: str | None, match: dict | None = None, now: datetime | None = None) -> dict | None:
    """Wirkt diese Sperre gerade? ``None``: nein. Sonst ``{reason, until, sanction_id, kind}``. Mit ``match`` für genau dieses Spiel:
    ein entschiedenes zählt zu seinem ``completed_at`` (Nachtrag der Teilnehmerliste), ein offenes jetzt."""
    if row.get("revoked_at") or row.get("kind") not in BAN_KINDS:
        return None
    if not KINDS[row["kind"]].get("league_wide") and row.get("season_id") != season_id:
        return None
    decided = bool(match and str(match.get("status") or "") in DECIDED_MATCH)
    at = (parse(match.get("completed_at")) if decided else None) or now or now_utc()
    start = parse(row.get("starts_at"))
    if start and at < start:
        return None
    remaining = None
    if row.get("state") != PROVISIONAL:
        if row.get("matches"):
            covered = covered_matches(row, frame)
            if decided:
                if match.get("id") not in covered:
                    return None
                remaining = 0
            elif len(covered) >= int(row["matches"]) or season_over(row, frame, at):
                return None
            else:
                remaining = int(row["matches"]) - len(covered)
        else:
            end = parse(row.get("ends_at"))
            if end and at >= end:
                return None
    return {"reason": _until_text(row, remaining), "until": row.get("ends_at") if row.get("state") != PROVISIONAL else None,
            "sanction_id": row.get("id"), "kind": row.get("kind"), "remaining_matches": remaining}


async def bans(db, league_id: str | None, season_id: str | None, user_ids, *, match: dict | None = None,
               now: datetime | None = None) -> Bans:
    """Die laufenden Sperren für diese Personen und für alle Co-Teams der Liga - ausgewertet im Speicher."""
    out = Bans()
    if not league_id:
        return out
    wanted = {user_id for user_id in user_ids or [] if user_id}
    # Nur, was noch gelten kann: nicht widerrufen, für diese Personen oder ein Co-Team, und nicht schon vor dem maßgeblichen
    # Zeitpunkt abgelaufen (mit einem Tag Abstand - genau gerechnet wird unten). Ohne Obergrenze: Nichts fällt still weg.
    decided = bool(match and str(match.get("status") or "") in DECIDED_MATCH)
    at = (parse(match.get("completed_at")) if decided else None) or now or now_utc()
    rows = await db.competition_sanctions.find(
        {"league_id": league_id, "kind": {"$in": list(BAN_KINDS)}, "revoked_at": None,
         "$and": [{"$or": [{"target_type": SQUAD}, {"user_id": {"$in": sorted(wanted)}}]},
                  {"$or": [{"ends_at": None}, {"ends_at": {"$gt": (at - timedelta(days=1)).isoformat()}}]}]},
        {"_id": 0}).to_list(None)
    frame = await frame_for(db, rows)
    for row in rows:
        is_squad = row.get("target_type") == SQUAD
        key = row.get("squad_id") if is_squad else row.get("user_id")
        state = ban_state(row, frame, season_id=season_id, match=match, now=now) if key else None
        if state:
            (out.squads if is_squad else out.users).setdefault(key, state)
    return out


def eligibility_row(found: Bans | None, user_id: str, squad_id: str | None) -> dict | None:
    """Der Stand ``sanctioned`` für die Prüfung der Spielberechtigung - ``None``: keine Sperre."""
    if not found:
        return None
    ban = found.users.get(user_id) or (found.squads.get(squad_id) if squad_id else None)
    if not ban:
        return None
    return {"state": SANCTIONED, "ok": False, "reason": ban["reason"], "until": ban.get("until")}


def squad_ban(found: Bans | None, squad_id: str | None) -> dict | None:
    return found.squads.get(squad_id) if found and squad_id else None


# ---------------------------------------------------------------- Aufbewahrung der Nachweise (Nr. 31, 136)


async def hold_until(db, doc: dict, now: datetime | None = None, frame: Frame | None = None) -> str | None:
    """Bis wann die Nachweise dieser Strafe mindestens bleiben: solange sie läuft, ein Einspruch offen ist oder die Frist läuft.
    Eine Sperre nach Spielen hält höchstens bis zum Ende ihrer Season (Nr. 101, 136) - danach gilt die normale Frist."""
    now = now or now_utc()
    if doc.get("revoked_at") and (doc.get("appeal") or {}).get("state") != OPEN:
        return None
    if (doc.get("appeal") or {}).get("state") == OPEN or doc.get("state") == PROVISIONAL:
        return OPEN_END
    moments = [moment for moment in (parse(doc.get("appeal_until")),) if moment]
    if doc.get("kind") in BAN_KINDS:
        if doc.get("matches"):
            frame = frame or await frame_for(db, [doc])
            if len(covered_matches(doc, frame)) < int(doc["matches"]):
                end = frame.season_ends.get(doc.get("season_id") or "")
                if not end:
                    return OPEN_END
                moments.append(end)
        elif doc.get("ends_at"):
            moments.append(parse(doc["ends_at"]))
        else:
            return OPEN_END
    latest = max(moments) if moments else None
    return latest.isoformat() if latest and latest > now else None


async def sync_proof_hold(db, doc: dict, now: datetime | None = None) -> None:
    ids = list(doc.get("proof_ids") or [])
    if not ids:
        return
    until = await hold_until(db, doc, now)
    # Mehrere Strafen können denselben Nachweis halten - es gilt das späteste Ende.
    others = await db.competition_sanctions.find({"proof_ids": {"$in": ids}, "id": {"$ne": doc["id"]}}, {"_id": 0}).to_list(None)
    for proof_id in ids:
        ends = [until, *[await hold_until(db, other, now) for other in others if proof_id in (other.get("proof_ids") or [])]]
        latest = max((end for end in ends if end), default=None)
        await db.match_proof_photos.update_one({"id": proof_id}, {"$set": {"keep_until": latest}} if latest else {"$unset": {"keep_until": ""}})


async def refresh_proof_holds(db, now: datetime | None = None) -> None:
    """Vor dem Aufräumen: ``keep_until`` aller Nachweise an Strafen neu rechnen (eine Sperre nach Spielen endet ohne Schreibvorgang)."""
    # Nur Strafen, die noch etwas halten können (nicht widerrufen) und Nachweise tragen - über den Index auf ``proof_ids``.
    async for doc in db.competition_sanctions.find({"revoked_at": None, "proof_ids": {"$gt": ""}}, {"_id": 0}):
        try:
            await sync_proof_hold(db, doc, now)
        except Exception as exc:  # noqa: BLE001 - ein Fehler an einer Strafe hält das Aufräumen nicht auf; ihr alter Wert bleibt
            logger.warning("[sanctions] Aufbewahrung zu Strafe %s nicht aktualisiert: %s", log_safe(doc.get("id")), type(exc).__name__)


def held(row: dict, now: datetime) -> bool:
    """Hält eine Strafe diesen Nachweis noch?"""
    until = parse(row.get("keep_until"))
    return bool(until and until > now)
