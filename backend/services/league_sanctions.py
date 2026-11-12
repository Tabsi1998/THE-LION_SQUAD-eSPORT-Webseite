"""Strafen im Wettbewerb (E.3, docs/LIGA.md „E.3 Strafen“; Regelwerk § 13, Anlage C.4 bis C.6).

Eine Zeile je Strafe in ``competition_sanctions``. Jede Strafe wählt und begründet die Leitung von Hand (Nr. 32) - hier steht
keine Automatik. Die Wirkung läuft über die vorhandenen Bausteine:

- Sperren (Spielsperre, Teamsperre, Ligaausschluss, externe Sperre): ``bans`` liefert ``league_eligibility`` den Stand
  ``sanctioned`` - damit sperrt dieselbe Prüfung Aufstellung, Check-in und Anmeldung.
- Punktabzug: ein Eintrag in ``tournaments.point_deductions``, den die Tabelle (E.1) abzieht.
- Disqualifikation: das Ausscheiden aus ``tournament_events`` (Regel der Season, Tabellenende).
- Widerruf und stattgegebener Einspruch nehmen genau das zurück.

Die Moderation der Community (``moderation_sanctions``) bleibt getrennt. Texte an Dritte nennen nie Verstoß oder Begründung.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from models import new_id, now_utc
from services.league_sanction_bans import (BAN_KINDS, FINAL, GRANTED, KINDS, OPEN, PLAYER, PROVISIONAL, SQUAD, UPHELD, _local,
                                          covered_matches, parse, sync_proof_hold)
from services.log_safe import log_safe

logger = logging.getLogger("tls.league_sanctions")

ACTIVE_REGISTRATION = ("pending", "approved", "checked_in", "waitlist")
RULE_REF_MIN, RULE_REF_MAX = 2, 200
REASON_MIN, REASON_MAX = 5, 2000
APPEAL_MIN, APPEAL_MAX = 10, 2000
POINTS_MAX, MATCHES_MAX, PROOFS_MAX = 99, 50, 10

# Anlage C.4 als Auswahl: Verstoß, Paragraf und die Ausgangssanktion als Vorschlag. Die Leitung kann alles ändern.
CATALOG: tuple[dict, ...] = (
    {"key": "no_show", "label": "Nichtantritt ohne genehmigten Grund", "rule_ref": "§ 11.4, Anlage C.4", "kind": "match_loss"},
    {"key": "ineligible_player", "label": "Einsatz eines unberechtigten oder gesperrten Spielers", "rule_ref": "Anlage C.4", "kind": "map_loss"},
    {"key": "swap_during_map", "label": "Spielerwechsel während einer Map", "rule_ref": "Anlage C.4", "kind": "map_loss"},
    {"key": "banned_equipment", "label": "Verbotene Waffe, Ausrüstung oder falsche Einstellungen", "rule_ref": "Anlage A, Anlage C.4", "kind": "map_loss"},
    {"key": "wrong_map", "label": "Falsche Map oder Umgehung des Vetos", "rule_ref": "Anlage B, Anlage C.4", "kind": "warning"},
    {"key": "false_result", "label": "Falsches Ergebnis, manipulierte Beweise oder Täuschung", "rule_ref": "Anlage C.4", "kind": "match_loss"},
    {"key": "technical_abuse", "label": "Absichtliche Disconnects oder technische Manipulation", "rule_ref": "Anlage C.4", "kind": "match_loss"},
    {"key": "moss_missing", "label": "MOSS-Datei fehlt, ist unvollständig oder verändert", "rule_ref": "§ 9a, Anlage C.4", "kind": "map_loss"},
    {"key": "cheating", "label": "Cheating, Makros oder Eingabemanipulation", "rule_ref": "Anlage C.4", "kind": "player_ban"},
    {"key": "exploit", "label": "Glitches, Exploits oder verbotene Spielweise", "rule_ref": "§ 5.9, Anlage C.4", "kind": "map_loss"},
    {"key": "team_left", "label": "Team verlässt ein laufendes Spiel", "rule_ref": "§ 11.4, Anlage C.4", "kind": "match_loss"},
    {"key": "stream_sniping", "label": "Stream-Sniping oder unerlaubte Hilfe", "rule_ref": "Anlage C.4", "kind": "map_loss"},
    {"key": "match_fixing", "label": "Matchabsprache oder absichtliches Verlieren", "rule_ref": "Anlage C.4", "kind": "disqualification"},
    {"key": "insult", "label": "Beleidigung, Belästigung oder Diskriminierung", "rule_ref": "§ 13, Anlage C.4", "kind": "warning"},
    {"key": "late_report", "label": "Ergebnis oder Teilnehmerliste nicht fristgerecht", "rule_ref": "§ 10.3, Anlage C.4", "kind": "warning"},
    {"key": "abusive_protest", "label": "Missbräuchlicher Protest oder Falschbeschuldigung", "rule_ref": "Anlage C.4", "kind": "warning"},
    {"key": "ignored_decision", "label": "Missachtung einer Entscheidung der Leitung", "rule_ref": "§ 13, Anlage C.4", "kind": "yellow_card"},
    {"key": "external_ban", "label": "Sperre des Herstellers oder einer Plattform", "rule_ref": "Anlage C.6", "kind": "external"},
)
CATALOG_KEYS = frozenset(row["key"] for row in CATALOG)

NOT_FOUND = "Diese Strafe gibt es nicht."
# Der Grund des Ausscheidens steht öffentlich an der Anmeldung - dort nie der Regelverstoß, nur dass es eine Strafe ist.
REMOVAL_REASON = "Strafe der Liga-Leitung"
SEASON_END_DETAIL = ("Eine Spielsperre endet spätestens mit der laufenden Season. Was darüber hinausgeht, ist eine Teamsperre "
                     "oder ein Ligaausschluss.")


class SanctionProblem(Exception):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status


# ---------------------------------------------------------------- Prüfen der Eingabe


def _text(value, low: int, high: int, detail: str) -> str:
    text = " ".join(str(value or "").split()) if high <= RULE_REF_MAX else str(value or "").strip()
    if not low <= len(text) <= high:
        raise SanctionProblem(detail)
    return text


def _int(value, low: int, high: int, detail: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise SanctionProblem(detail)
    return value


async def _season_frame(db, season_id: str | None, tournament_id: str | None = None) -> tuple[dict | None, dict | None]:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0}) if season_id else None
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0}) if tournament_id else None
    return season, tournament


def _appeal_until(season: dict | None, tournament: dict | None, start: datetime) -> str:
    """Ende der Einspruchsfrist (Nr. 41): ``appeal_hours`` ab Bekanntgabe - in Sperrzeiten ruhend wie in E.2."""
    from services import match_proofs
    from services.matchday_schedule import response_deadline

    hours = match_proofs.setting(tournament, season, "appeal_hours")
    until = (response_deadline(tournament, start, hours) if tournament else None) or start + timedelta(hours=hours)
    return until.isoformat()


# ---------------------------------------------------------------- Prüfen und Anlegen


async def _registration_of_season(db, season: dict, registration_id: str | None) -> tuple[dict, dict]:
    registration = await db.tournament_registrations.find_one({"id": registration_id}, {"_id": 0}) if registration_id else None
    tournament = await db.tournaments.find_one({"id": (registration or {}).get("tournament_id")}, {"_id": 0}) if registration else None
    if not registration or not registration.get("squad_id") or \
            ((tournament or {}).get("league_context") or {}).get("season_id") != season["id"]:
        raise SanctionProblem("Dieses Co-Team ist in dieser Season nicht angemeldet.")
    return registration, tournament


async def _player_registration(db, season: dict, user_id: str) -> tuple[dict, dict] | tuple[None, None]:
    """Die Anmeldung des Co-Teams, in dem die Person in dieser Season steht - nur, wenn es genau eine ist."""
    tournaments = {row["id"]: row for row in await db.tournaments.find(
        {"league_context.season_id": season["id"]}, {"_id": 0}).to_list(200)}
    squads = await db.team_squads.find({"member_ids": user_id}, {"_id": 0, "id": 1}).to_list(100)
    squad_ids = [row["id"] for row in squads if row.get("id")]
    if not tournaments or not squad_ids:
        return None, None
    found = await db.tournament_registrations.find(
        {"tournament_id": {"$in": sorted(tournaments)}, "squad_id": {"$in": squad_ids}, "status": {"$in": list(ACTIVE_REGISTRATION)}},
        {"_id": 0}).to_list(50)
    if len(found) != 1:
        return None, None
    return found[0], tournaments[found[0]["tournament_id"]]


async def check_match(db, season: dict, match_id: str | None, registration: dict | None, *, required: bool) -> dict | None:
    if not match_id:
        if required:
            raise SanctionProblem("Bitte das Spiel wählen, auf das sich die Strafe bezieht.")
        return None
    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    tournament = await db.tournaments.find_one({"id": (match or {}).get("tournament_id")}, {"_id": 0, "league_context": 1}) if match else None
    if not match or ((tournament or {}).get("league_context") or {}).get("season_id") != season["id"]:
        raise SanctionProblem("Dieses Spiel gehört nicht zu dieser Season.")
    sides = {slot.get("registration_id") for slot in match.get("slots") or []}
    if registration and registration["id"] not in sides:
        raise SanctionProblem("Das Co-Team hat in diesem Spiel nicht gespielt.")
    return match


async def _check_proofs(db, match: dict | None, proof_ids) -> list[str]:
    ids = list(dict.fromkeys(str(item) for item in proof_ids or [] if item))
    if not ids:
        return []
    if len(ids) > PROOFS_MAX:
        raise SanctionProblem(f"Höchstens {PROOFS_MAX} Nachweise je Strafe.")
    if not match:
        raise SanctionProblem("Nachweise gehören zu einem Spiel. Bitte zuerst das Spiel wählen.")
    count = await db.match_proof_photos.count_documents({"id": {"$in": ids}, "match_id": match["id"], "status": "attached"})
    if count != len(ids):
        raise SanctionProblem("Ein Nachweis gehört nicht zu diesem Spiel oder wurde entfernt.")
    return ids


async def visible_proofs(db, match: dict | None, user: dict) -> list[dict]:
    """Die Nachweise eines Spiels, die diese Person dort sehen darf (``match_proofs.can_see_doc``: die nicht befangene Leitung mit
    Ergebnis- oder Protest-Recht) - die Auswahl beim Verhängen und die Anzeige an der Strafe."""
    from services import match_proof_refs, match_proofs

    if not match:
        return []
    viewer = await match_proofs.viewer_for(db, match, user)
    rows = await db.match_proof_photos.find({"match_id": match["id"], "status": "attached"}, {"_id": 0}).to_list(500)
    return [match_proofs.proof_view(row, viewer, match_proof_refs.MISSING, can_change=False)
            for row in sorted(rows, key=lambda row: str(row.get("created_at") or "")) if match_proofs.can_see_doc(row, viewer)]


async def require_visible_proofs(db, doc: dict, match: dict | None, user: dict) -> None:
    """Angehängt wird nur, was die Person am Spiel selbst sehen darf."""
    if doc.get("proof_ids") and not set(doc["proof_ids"]) <= {row["id"] for row in await visible_proofs(db, match, user)}:
        raise SanctionProblem("Einen dieser Nachweise darfst du an diesem Spiel nicht sehen. Nachweise sieht die Leitung mit "
                              "„Ergebnisse korrigieren“ oder „Proteste“.", 403)


async def attach_proofs(db, row: dict, doc: dict, user: dict) -> dict:
    """Die Nachweise einer Strafe für die Verwaltung: was diese Person sehen darf, dazu wie viele es insgesamt sind."""
    ids = set(doc.get("proof_ids") or [])
    match = await db.matches_v2.find_one({"id": doc["match_id"]}, {"_id": 0}) if ids and doc.get("match_id") else None
    row["proofs"] = [proof for proof in await visible_proofs(db, match, user) if proof["id"] in ids]
    row["proof_count"] = len(ids)
    return row


def _period(kind: str, state: str, season: dict, registration: dict | None, body: dict, now: datetime) -> dict:
    """``starts_at``, ``ends_at``, ``matches`` - nur für Sperren. Vorläufige Sperren haben kein Ende."""
    from services.match_proof_retention import season_end

    if not KINDS[kind].get("ban"):
        return {"starts_at": now.isoformat(), "ends_at": None, "matches": None}
    start = parse(body.get("starts_at")) if body.get("starts_at") else now
    if start is None:
        raise SanctionProblem("Der Beginn der Sperre ist kein gültiger Zeitpunkt.")
    if start < now - timedelta(minutes=5):
        raise SanctionProblem("Eine Sperre beginnt frühestens jetzt.")
    start = max(start, now)
    if state == PROVISIONAL or kind == "league_exclusion":
        return {"starts_at": start.isoformat(), "ends_at": None, "matches": None}
    end = parse(body.get("ends_at")) if body.get("ends_at") else None
    if body.get("ends_at") and end is None:
        raise SanctionProblem("Das Ende der Sperre ist kein gültiger Zeitpunkt.")
    matches = body.get("matches")
    if kind == "player_ban":
        if (matches is None) == (end is None):
            raise SanctionProblem("Eine Spielsperre braucht entweder eine Anzahl Liga-Spiele (mindestens eines) oder ein Ende.")
        if matches is not None:
            matches = _int(matches, 1, MATCHES_MAX, f"Die Anzahl der Liga-Spiele liegt zwischen 1 und {MATCHES_MAX}.")
            if not registration:
                raise SanctionProblem("Die Person steht in keinem Co-Team dieser Season. Bitte ein Ende statt einer Anzahl Spiele wählen.")
        last = season_end(season)
        if end and last and end > last:
            raise SanctionProblem(SEASON_END_DETAIL)
    else:
        matches = None
        if kind == "team_ban" and end is None:
            raise SanctionProblem("Eine Teamsperre braucht ein Ende.")
    if end and end <= start:
        raise SanctionProblem("Das Ende der Sperre liegt nach ihrem Beginn.")
    return {"starts_at": start.isoformat(), "ends_at": end.isoformat() if end else None, "matches": matches}


async def build(db, season: dict, body: dict, actor: dict, *, now: datetime | None = None) -> tuple[dict, dict | None, dict | None, dict | None]:
    """Prüft die Eingabe und baut die Zeile - schreibt nichts. Liefert ``(Strafe, Anmeldung, Staffel, Spiel)``."""
    now = now or now_utc()
    kind = body.get("kind")
    if kind not in KINDS:
        raise SanctionProblem("Diese Art von Strafe gibt es nicht.")
    target_type = body.get("target_type")
    if target_type not in KINDS[kind]["targets"]:
        raise SanctionProblem(f"{KINDS[kind]['label']} gibt es nur für {'eine Person' if KINDS[kind]['targets'] == (PLAYER,) else 'ein Co-Team'}.")
    state = body.get("state") or FINAL
    if state not in (PROVISIONAL, FINAL) or (state == PROVISIONAL and not KINDS[kind].get("provisional")):
        raise SanctionProblem("Vorläufig geht nur eine Spielsperre oder Teamsperre.")
    rule_ref = _text(body.get("rule_ref"), RULE_REF_MIN, RULE_REF_MAX, "Bitte den Regelverstoß nennen: Paragraf oder Eintrag aus dem Strafkatalog.")
    reason = _text(body.get("reason"), REASON_MIN, REASON_MAX, f"Bitte die Strafe begründen (mindestens {REASON_MIN} Zeichen).")
    catalog_key = body.get("catalog_key") if body.get("catalog_key") in CATALOG_KEYS else None

    user_id = None
    if target_type == SQUAD:
        registration, tournament = await _registration_of_season(db, season, body.get("registration_id"))
    else:
        user_id = str(body.get("user_id") or "")
        if not user_id or not await db.users.find_one({"id": user_id}, {"_id": 1}):
            raise SanctionProblem("Diese Person gibt es nicht.")
        if body.get("registration_id"):
            registration, tournament = await _registration_of_season(db, season, body.get("registration_id"))
            squad = await db.team_squads.find_one({"id": registration["squad_id"]}, {"_id": 0, "member_ids": 1}) or {}
            if user_id not in (squad.get("member_ids") or []):
                raise SanctionProblem("Die Person steht nicht im Kader dieses Co-Teams.")
        else:
            registration, tournament = await _player_registration(db, season, user_id)
    if kind == "disqualification" and registration.get("status") not in ACTIVE_REGISTRATION:
        raise SanctionProblem("Dieses Co-Team ist nicht mehr im Wettbewerb.", 409)
    match = await check_match(db, season, body.get("match_id"), registration, required=bool(KINDS[kind].get("match")))
    points = _int(body.get("points"), 1, POINTS_MAX, f"Der Punktabzug liegt zwischen 1 und {POINTS_MAX}.") if kind == "point_deduction" else None
    doc = {
        "id": new_id(), "league_id": season.get("league_id"), "season_id": season["id"], "kind": kind, "target_type": target_type,
        "user_id": user_id, "squad_id": (registration or {}).get("squad_id"), "team_id": (registration or {}).get("team_id"),
        "tournament_id": (registration or {}).get("tournament_id"), "registration_id": (registration or {}).get("id"),
        "match_id": (match or {}).get("id"), "rule_ref": rule_ref, "catalog_key": catalog_key, "reason": reason,
        "proof_ids": await _check_proofs(db, match, body.get("proof_ids")), "points": points,
        **_period(kind, state, season, registration, body, now),
        "state": state, "final_at": now.isoformat() if state == FINAL else None, "final_by": actor.get("id") if state == FINAL else None,
        "appeal_until": _appeal_until(season, tournament, now) if state == FINAL else None, "appeal": None,
        "revoked_at": None, "revoked_by": None, "revoke_reason": None, "revoked_via": None, "effect": {}, "conflict_reason": None,
        "created_at": now.isoformat(), "created_by": actor.get("id"), "updated_at": now.isoformat(),
    }
    return doc, registration, tournament, match


def side_of(doc: dict) -> dict:
    """Die betroffene Seite für die Befangenheit (B.1): die Person selbst und das Co-Team mit seinem Hauptteam."""
    return {"user_id": doc.get("user_id"), "team_id": doc.get("team_id"), "squad_id": doc.get("squad_id")}


async def audit(db, action: str, doc: dict, actor_id: str | None, **data) -> None:
    """Protokoll ohne Namen und ohne Begründungstext."""
    await db.audit_logs.insert_one({
        "id": new_id(), "action": f"league.sanction.{action}", "actor_id": actor_id, "target_id": doc.get("id"),
        "data": {"sanction_id": doc.get("id"), "kind": doc.get("kind"), "target_type": doc.get("target_type"),
                 "season_id": doc.get("season_id"), "tournament_id": doc.get("tournament_id"),
                 "registration_id": doc.get("registration_id"), "match_id": doc.get("match_id"), "state": doc.get("state"), **data},
        "created_at": now_utc().isoformat(),
    })


# ---------------------------------------------------------------- Wirkung


async def _publish_table(tournament_id: str | None) -> None:
    from services.change_events import publish_api_change

    if tournament_id:
        await publish_api_change("PUT", f"/api/tournaments/{tournament_id}/standings", 200)


async def apply_effect(db, doc: dict, registration: dict | None, tournament: dict | None, actor: dict) -> dict:
    """Schreibt, was die Strafe bewirkt (Punktabzug, Disqualifikation) - Sperren wirken allein über ``bans``. Liefert ``effect``."""
    from services import tournament_events

    kind = doc["kind"]
    if kind == "point_deduction":
        # Am Turnier steht nur, was die Tabelle braucht: kein Grund, keine Person - das Turnier-Dokument ist öffentlich lesbar.
        # Verstoß, Begründung und wer verhängt hat, stehen an der Strafe (``sanction_id``).
        entry = {"id": new_id(), "registration_id": registration["id"], "points": doc["points"],
                 "source": "sanction", "sanction_id": doc["id"], "created_at": doc["created_at"]}
        await db.tournaments.update_one({"id": tournament["id"]}, {"$push": {"point_deductions": entry}})
        await _publish_table(tournament["id"])
        return {"deduction_id": entry["id"]}
    if kind == "disqualification":
        try:
            proposal = await tournament_events.propose_removal(db, tournament, registration, kind="disqualified",
                                                               reason=REMOVAL_REASON, actor_id=actor.get("id"))
            plan = proposal.get("plan") or {}
            done = await tournament_events.confirm_removal(db, tournament, registration, plan.get("id"), kind="disqualified",
                                                           actor_id=actor.get("id"), reason=REMOVAL_REASON)
        except tournament_events.TournamentEventError as problem:
            raise SanctionProblem(problem.detail, problem.status_code) from None
        return {"removal": {"plan_id": plan.get("id"), "previous_status": registration.get("status"),
                            "match_ids": list(done.get("changed_match_ids") or [])}}
    return {}


async def _reopen_match(db, tournament: dict, match: dict, registration_id: str, plan_id: str | None, now_iso: str) -> bool:
    """Ein Spiel, das das Ausscheiden kampflos gewertet oder abgesagt hat, wieder offen - nur, wenn es noch so dasteht."""
    from services import checkin_rules, league_table

    meta = match.get("result_meta") or {}
    if meta.get("removed_registration_id") != registration_id or meta.get("reason") != "disqualified":
        return False
    if match.get("status") == "forfeit" and match.get("forfeit_registration_id") == registration_id:
        update = {"$set": league_table.undo_fields(match, now_iso),
                  "$unset": {"forfeit_registration_id": "", "admin_decision_note": "", "admin_decision_by": "", "admin_decision_at": "",
                             "result_meta": "", "completed_by": ""}}
        await db.matches_v2.update_one({"id": match["id"], "status": "forfeit"}, checkin_rules.new_time_change(tournament, update))
        if plan_id:
            await db.match_reports_v2.delete_one({"id": f"removal-{plan_id}-{match['id']}"})
        return True
    if match.get("status") == "cancelled" and meta.get("source") == "participant_removed":
        kept = {key: value for key, value in meta.items()
                if key not in ("removed_registration_id", "reason", "source", "annulled", "previous_status")}
        previous = meta.get("previous_status") or ("scheduled" if match.get("scheduled_at") else "ready")
        await db.matches_v2.update_one({"id": match["id"], "status": "cancelled"},
                                       {"$set": {"status": previous, "result_meta": kept, "updated_at": now_iso}})
        return True
    return False


async def undo_effect(db, doc: dict, actor_id: str | None) -> None:
    """Nimmt die Wirkung zurück (Widerruf, stattgegebener Einspruch). Sperren enden allein dadurch, dass die Strafe widerrufen ist."""
    from services import league_table, squad_registration

    effect = doc.get("effect") or {}
    tournament_id = doc.get("tournament_id")
    if doc["kind"] == "point_deduction" and tournament_id:
        await db.tournaments.update_one({"id": tournament_id}, {"$pull": {"point_deductions": {"sanction_id": doc["id"]}}})
        await _publish_table(tournament_id)
        return
    if doc["kind"] != "disqualification" or not effect.get("removal"):
        return
    registration = await db.tournament_registrations.find_one({"id": doc.get("registration_id")}, {"_id": 0})
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0})
    if not registration or not tournament or registration.get("status") != "disqualified":
        return
    previous = effect["removal"].get("previous_status") or "approved"
    key = squad_registration.league_squad_key(tournament, registration.get("squad_id"))
    if key and await db.tournament_registrations.find_one({"league_squad_key": key, "id": {"$ne": registration["id"]}}, {"_id": 1}):
        raise SanctionProblem("Das Co-Team ist in dieser Season inzwischen anders angemeldet. Bitte zuerst das klären.", 409)
    now_iso = now_utc().isoformat()
    await db.tournament_registrations.update_one(
        {"id": registration["id"]},
        {"$set": {"status": previous, "updated_at": now_iso, **({"league_squad_key": key} if key else {})}, "$unset": {"removal": ""}})
    matches = await db.matches_v2.find({"tournament_id": tournament_id, "slots.registration_id": registration["id"]}, {"_id": 0}).to_list(500)
    for match in matches:
        if await _reopen_match(db, tournament, match, registration["id"], effect["removal"].get("plan_id"), now_iso):
            await league_table.after_change(db, tournament, match, scored=False)
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "tournament.participant.reinstated", "actor_id": actor_id, "target_id": tournament_id,
        "data": {"registration_id": registration["id"], "sanction_id": doc["id"], "status": previous}, "created_at": now_iso})
    await _publish_table(tournament_id)


# ---------------------------------------------------------------- Schritte


async def _save(db, doc: dict, fields: dict) -> dict:
    fields = {**fields, "updated_at": now_utc().isoformat()}
    await db.competition_sanctions.update_one({"id": doc["id"]}, {"$set": fields})
    doc.update(fields)
    await sync_proof_hold(db, doc)
    return doc


async def create(db, doc: dict, registration: dict | None, tournament: dict | None, actor: dict) -> dict:
    await db.competition_sanctions.insert_one(dict(doc))
    try:
        doc["effect"] = await apply_effect(db, doc, registration, tournament, actor)
    except SanctionProblem:
        await db.competition_sanctions.delete_one({"id": doc["id"]})
        raise
    await _save(db, doc, {"effect": doc["effect"]})
    await audit(db, "create", doc, actor.get("id"), reason_length=len(doc["reason"]), points=doc.get("points"),
                matches=doc.get("matches"), proofs=len(doc.get("proof_ids") or []))
    return doc


async def confirm(db, doc: dict, body: dict, actor: dict) -> dict:
    """Vorläufig → endgültig, jetzt mit Zeitraum. Die Sperre läuft ab ihrem ursprünglichen Beginn weiter."""
    if doc.get("revoked_at") or doc.get("state") != PROVISIONAL:
        raise SanctionProblem("Diese Strafe ist nicht mehr vorläufig.", 409)
    now = now_utc()
    season, tournament = await _season_frame(db, doc.get("season_id"), doc.get("tournament_id"))
    registration = await db.tournament_registrations.find_one({"id": doc.get("registration_id")}, {"_id": 0}) if doc.get("registration_id") else None
    period = _period(doc["kind"], FINAL, season or {"id": doc.get("season_id")}, registration, {**body, "starts_at": None}, now)
    fields = {"state": FINAL, "final_at": now.isoformat(), "final_by": actor.get("id"), "ends_at": period["ends_at"],
              "matches": period["matches"], "appeal_until": _appeal_until(season, tournament, now)}
    await _save(db, doc, fields)
    await audit(db, "confirm", doc, actor.get("id"), matches=doc.get("matches"))
    return doc


async def revoke(db, doc: dict, reason, actor_id: str | None, *, via: str = "revoke") -> dict:
    if doc.get("revoked_at"):
        raise SanctionProblem("Diese Strafe ist schon widerrufen.", 409)
    reason = _text(reason, REASON_MIN, REASON_MAX, f"Bitte den Widerruf begründen (mindestens {REASON_MIN} Zeichen).")
    await undo_effect(db, doc, actor_id)
    await _save(db, doc, {"revoked_at": now_utc().isoformat(), "revoked_by": actor_id, "revoke_reason": reason, "revoked_via": via})
    await audit(db, "revoke", doc, actor_id, via=via, reason_length=len(reason))
    return doc


def appeal_refusal(doc: dict, now: datetime | None = None) -> str | None:
    """Warum gegen diese Strafe (jetzt) kein Einspruch geht - ``None``: Er geht."""
    if doc.get("revoked_at"):
        return "Die Strafe ist widerrufen."
    if doc.get("state") != FINAL:
        return "Eine vorläufige Sperre wird ohnehin geprüft. Der Einspruch ist ab der endgültigen Entscheidung möglich."
    if doc.get("appeal"):
        return "Gegen diese Strafe wurde schon Einspruch eingelegt. Er ist einmal je Entscheidung möglich."
    until = parse(doc.get("appeal_until"))
    if not until or (now or now_utc()) >= until:
        return "Die Einspruchsfrist ist abgelaufen."
    return None


async def submit_appeal(db, doc: dict, user: dict, text) -> dict:
    refusal = appeal_refusal(doc)
    if refusal:
        raise SanctionProblem(refusal, 409)
    text = _text(text, APPEAL_MIN, APPEAL_MAX, f"Bitte den Einspruch begründen (mindestens {APPEAL_MIN} Zeichen).")
    appeal = {"id": new_id(), "by": user.get("id"), "at": now_utc().isoformat(), "text": text, "state": OPEN,
              "decided_by": None, "decided_at": None, "note": None}
    # Einmal je Strafe - auch bei zwei gleichzeitigen Klicks.
    result = await db.competition_sanctions.update_one(
        {"id": doc["id"], "appeal": None, "revoked_at": None}, {"$set": {"appeal": appeal, "updated_at": appeal["at"]}})
    if result.modified_count != 1:
        raise SanctionProblem("Gegen diese Strafe wurde schon Einspruch eingelegt. Er ist einmal je Entscheidung möglich.", 409)
    doc["appeal"] = appeal
    await sync_proof_hold(db, doc)
    await audit(db, "appeal", doc, user.get("id"), text_length=len(text))
    return doc


def own_decision(doc: dict, user: dict | None) -> bool:
    """Hat diese Person die Strafe verhängt oder bestätigt? Dann entscheidet sie nie über den Einspruch (Nr. 41)."""
    return bool(user and user.get("id") and user["id"] in {doc.get("created_by"), doc.get("final_by")})


async def decide_appeal(db, doc: dict, actor: dict, decision: str, note) -> dict:
    appeal = doc.get("appeal") or {}
    if appeal.get("state") != OPEN:
        raise SanctionProblem("Zu dieser Strafe ist kein Einspruch offen.", 409)
    if decision not in (UPHELD, GRANTED):
        raise SanctionProblem("Die Entscheidung ist „Strafe bleibt“ oder „Strafe aufgehoben“.")
    note = _text(note, REASON_MIN, REASON_MAX, f"Bitte die Entscheidung begründen (mindestens {REASON_MIN} Zeichen).")
    if decision == GRANTED and not doc.get("revoked_at"):
        await revoke(db, doc, note, actor.get("id"), via="appeal")
    decided = {**appeal, "state": decision, "decided_by": actor.get("id"), "decided_at": now_utc().isoformat(), "note": note}
    await _save(db, doc, {"appeal": decided})
    await audit(db, "appeal.decide", doc, actor.get("id"), decision=decision, note_length=len(note))
    return doc


# ---------------------------------------------------------------- Betroffene


async def affected_user_ids(db, doc: dict) -> set[str]:
    """Wer die Strafe sieht und Einspruch einlegen darf: die Person - beim Co-Team Captain, Vertreter und Hauptteam-Leitung."""
    from services.match_audience import team_penalty_ids, teams_by_id

    if doc.get("target_type") == PLAYER:
        return {doc["user_id"]} if doc.get("user_id") else set()
    side = {"team_id": doc.get("team_id"), "squad_id": doc.get("squad_id")}
    team = (await teams_by_id(db, [side])).get(doc.get("team_id") or "")
    return team_penalty_ids(side, team)


async def captain_ids(db, doc: dict) -> set[str]:
    """Bei einer Sperre einer Person: Captain, Vertreter und Hauptteam-Leitung ihres Co-Teams - sie stellen auf."""
    if doc.get("target_type") != PLAYER or not doc.get("squad_id") or doc.get("kind") not in BAN_KINDS:
        return set()
    from services.match_audience import team_penalty_ids, teams_by_id

    side = {"team_id": doc.get("team_id"), "squad_id": doc.get("squad_id")}
    team = (await teams_by_id(db, [side])).get(doc.get("team_id") or "")
    return team_penalty_ids(side, team) - {doc.get("user_id")}


async def for_user(db, user_id: str) -> list[dict]:
    """Die Strafen, die diese Person betreffen: die eigenen und die der Co-Teams, für die sie verantwortlich ist."""
    from services.match_audience import team_penalty_registrations

    squad_ids = sorted({reg["squad_id"] for reg in await team_penalty_registrations(db, user_id) if reg.get("squad_id")})
    query = {"$or": [{"target_type": PLAYER, "user_id": user_id}, *([{"target_type": SQUAD, "squad_id": {"$in": squad_ids}}] if squad_ids else [])]}
    return await db.competition_sanctions.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)


# ---------------------------------------------------------------- Ansichten


async def progress(db, doc: dict, now: datetime | None = None) -> dict:
    """``status``: ``revoked``, ``provisional``, ``active`` oder ``served`` (Sperre vorbei), dazu der Satz zum Zeitraum."""
    now = now or now_utc()
    if doc.get("revoked_at"):
        return {"status": "revoked", "period": None}
    if doc.get("kind") not in BAN_KINDS:
        return {"status": "active", "period": f"{doc['points']} {'Punkt' if doc.get('points') == 1 else 'Punkte'} Abzug" if doc.get("points") else None}
    if doc.get("state") == PROVISIONAL:
        return {"status": PROVISIONAL, "period": "vorläufig, bis die Liga-Leitung entschieden hat"}
    if doc.get("matches"):
        left = int(doc["matches"]) - len(await covered_matches(db, doc))
        total = f"{doc['matches']} Liga-{'Spiel' if doc['matches'] == 1 else 'Spiele'}"
        return {"status": "active" if left > 0 else "served", "period": f"{total}, noch {left}" if left > 0 else f"{total}, abgesessen"}
    end = parse(doc.get("ends_at"))
    start = parse(doc.get("starts_at"))
    if end:
        return {"status": "active" if now < end else "served", "period": f"{_local(start) if start else ''} bis {_local(end)}".strip()}
    return {"status": "active", "period": "bis zum Widerruf" if doc.get("kind") != "league_exclusion" else "ohne Ende"}


def _appeal_view(doc: dict, names: dict[str, str], *, with_text: bool) -> dict | None:
    appeal = doc.get("appeal")
    if not appeal:
        return None
    return {"state": appeal.get("state"), "at": appeal.get("at"), "decided_at": appeal.get("decided_at"), "note": appeal.get("note"),
            "by_name": names.get(appeal.get("by") or ""), **({"text": appeal.get("text")} if with_text else {})}


async def view(db, doc: dict, names: dict[str, str], *, now: datetime | None = None, admin: bool = False) -> dict:
    """Die Strafe für die Betroffenen - mit ``admin`` dazu, was nur die Leitung sieht (wer verhängt hat, Nachweise, Wirkung)."""
    now = now or now_utc()
    state = await progress(db, doc, now)
    out = {
        "id": doc["id"], "kind": doc["kind"], "kind_label": KINDS[doc["kind"]]["label"], "target_type": doc.get("target_type"),
        "target_name": names.get(doc.get("user_id") or "") if doc.get("target_type") == PLAYER else names.get(f"squad:{doc.get('squad_id')}"),
        "squad_name": names.get(f"squad:{doc.get('squad_id')}"), "rule_ref": doc.get("rule_ref"), "reason": doc.get("reason"),
        "points": doc.get("points"), "starts_at": doc.get("starts_at"), "ends_at": doc.get("ends_at"), "matches": doc.get("matches"),
        "state": doc.get("state"), "status": state["status"], "period": state["period"], "match_id": doc.get("match_id"),
        "created_at": doc.get("created_at"), "final_at": doc.get("final_at"), "appeal_until": doc.get("appeal_until"),
        "can_appeal": appeal_refusal(doc, now) is None, "appeal": _appeal_view(doc, names, with_text=True),
        "revoked_at": doc.get("revoked_at"), "revoke_reason": doc.get("revoke_reason"), "revoked_via": doc.get("revoked_via"),
    }
    if admin:
        out.update({
            "user_id": doc.get("user_id"), "squad_id": doc.get("squad_id"), "registration_id": doc.get("registration_id"),
            "tournament_id": doc.get("tournament_id"), "catalog_key": doc.get("catalog_key"), "proof_ids": doc.get("proof_ids") or [],
            "created_by_name": names.get(doc.get("created_by") or ""), "revoked_by_name": names.get(doc.get("revoked_by") or ""),
            "decided_by_name": names.get((doc.get("appeal") or {}).get("decided_by") or ""),
        })
    return out


async def names_for(db, docs: list[dict]) -> dict[str, str]:
    """Namen der Personen (Kennung → Name) und Co-Teams (``squad:<id>`` → Name) für die Ansicht."""
    user_ids = sorted({value for doc in docs for value in (
        doc.get("user_id"), doc.get("created_by"), doc.get("revoked_by"), (doc.get("appeal") or {}).get("by"),
        (doc.get("appeal") or {}).get("decided_by")) if value})
    names = {row["id"]: row.get("display_name") or row.get("username") or "Mitglied" for row in await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(len(user_ids) + 1)} if user_ids else {}
    registration_ids = sorted({doc["registration_id"] for doc in docs if doc.get("registration_id")})
    if registration_ids:
        async for row in db.tournament_registrations.find({"id": {"$in": registration_ids}},
                                                          {"_id": 0, "squad_id": 1, "display_name": 1, "team_name": 1, "squad_name": 1}):
            names[f"squad:{row.get('squad_id')}"] = row.get("display_name") or row.get("team_name") or row.get("squad_name") or "Co-Team"
    return names


async def season_targets(db, season: dict) -> list[dict]:
    """Die Staffeln der Season mit ihren Co-Teams, Kadern und Spielen - die Auswahl beim Verhängen."""
    out = []
    tournaments = await db.tournaments.find({"league_context.season_id": season["id"]}, {"_id": 0, "id": 1, "title": 1}).sort("title", 1).to_list(200)
    for tournament in tournaments:
        registrations = await db.tournament_registrations.find(
            {"tournament_id": tournament["id"], "squad_id": {"$type": "string"}}, {"_id": 0}).to_list(500)
        squad_ids = [row["squad_id"] for row in registrations]
        squads = {row["id"]: row for row in await db.team_squads.find({"id": {"$in": squad_ids}}, {"_id": 0, "id": 1, "member_ids": 1}).to_list(len(squad_ids) + 1)}
        member_ids = sorted({uid for squad in squads.values() for uid in squad.get("member_ids") or [] if uid})
        people = {row["id"]: row.get("display_name") or row.get("username") or "Mitglied" for row in await db.users.find(
            {"id": {"$in": member_ids}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(len(member_ids) + 1)}
        names = {row["id"]: row.get("display_name") or row.get("team_name") or row.get("squad_name") or "Co-Team" for row in registrations}
        matches = await db.matches_v2.find({"tournament_id": tournament["id"], "is_preview": {"$ne": True}},
                                           {"_id": 0, "id": 1, "slots": 1, "matchday_number": 1, "round": 1, "status": 1}).to_list(2000)
        out.append({
            "tournament_id": tournament["id"], "title": tournament.get("title") or "Staffel",
            "squads": sorted(({
                "registration_id": row["id"], "squad_id": row["squad_id"], "name": names[row["id"]], "status": row.get("status"),
                "players": sorted(({"id": uid, "name": people.get(uid, "Mitglied")} for uid in (squads.get(row["squad_id"]) or {}).get("member_ids") or [] if uid),
                                  key=lambda item: item["name"].casefold()),
            } for row in registrations), key=lambda item: item["name"].casefold()),
            "matches": sorted(({
                "id": match["id"], "matchday": match.get("matchday_number") or match.get("round"), "status": match.get("status"),
                "registration_ids": [slot.get("registration_id") for slot in match.get("slots") or [] if slot.get("registration_id")],
                "label": " gegen ".join(names.get(slot.get("registration_id"), "offen") for slot in match.get("slots") or []),
            } for match in matches), key=lambda item: (item["matchday"] or 0, item["label"])),
        })
    return out


async def overview(db, season: dict, me: dict) -> dict:
    """Der Reiter „Strafen“ der Season: Strafen der Season und liga-weite Sperren der Liga, neueste zuerst."""
    from services import league_permissions, match_proofs

    docs = await db.competition_sanctions.find(
        {"league_id": season.get("league_id"),
         "$or": [{"season_id": season["id"]}, {"kind": {"$in": [key for key, row in KINDS.items() if row.get("league_wide")]}}]},
        {"_id": 0}).sort("created_at", -1).to_list(1000)
    names = await names_for(db, docs)
    now = now_utc()
    items = []
    for doc in docs:
        row = await attach_proofs(db, await view(db, doc, names, now=now, admin=True), doc, me)
        conflict = await league_permissions.side_conflict(db, me, side_of(doc))
        row["own_side"] = bool(conflict)
        row["own_decision"] = own_decision(doc, me)
        row["other_season"] = doc.get("season_id") != season["id"]
        items.append(row)
    return {
        "items": items,
        "open_appeals": sum(1 for row in items if (row.get("appeal") or {}).get("state") == OPEN),
        "kinds": [{"key": key, "label": row["label"], "targets": list(row["targets"]), "ban": bool(row.get("ban")),
                   "provisional": bool(row.get("provisional")), "match": bool(row.get("match"))} for key, row in KINDS.items()],
        "catalog": [dict(row, kind_label=KINDS[row["kind"]]["label"]) for row in CATALOG],
        "targets": await season_targets(db, season),
        "appeal_hours": match_proofs.setting(None, season, "appeal_hours"),
        "superadmin": league_permissions.is_superadmin(me),
        "limits": {"reason_min": REASON_MIN, "reason_max": REASON_MAX, "points_max": POINTS_MAX, "matches_max": MATCHES_MAX},
    }


# ---------------------------------------------------------------- Nachrichten


def _for_whom(doc: dict, names: dict[str, str]) -> str:
    return f"das Co-Team {names.get('squad:' + str(doc.get('squad_id')), '')}".strip() if doc.get("target_type") == SQUAD else "dich"


async def notify(db, doc: dict, event: str, *, actor_id: str | None = None) -> int:
    """Postfach und Push; Schlüssel ``sanction:<id>:<ereignis>:<user>``. Eine ausgefallene Nachricht hält keine Strafe auf."""
    from services.league_permissions import staff_user_ids
    from services.user_notifications import create_user_notification

    try:
        names = await names_for(db, [doc])
        label = KINDS[doc["kind"]]["label"]
        whom = _for_whom(doc, names)
        affected = await affected_user_ids(db, doc)
        sends: list[tuple[set[str], str, str, str]] = []
        url = "/my/penalties"
        if event == "issued":
            sends.append((affected, f"Strafe der Liga-Leitung: {label}",
                          f"Die Liga-Leitung hat gegen {whom} eine Strafe verhängt: {label}. Begründung und Einspruch findest du unter „Meine Strafen“.", url))
        elif event == "confirmed":
            sends.append((affected, f"{label} bestätigt",
                          f"Die Liga-Leitung hat die vorläufige Sperre gegen {whom} geprüft und bestätigt. Details und Einspruch unter „Meine Strafen“.", url))
        elif event == "revoked":
            sends.append((affected, f"{label} aufgehoben", f"Die Liga-Leitung hat die Strafe gegen {whom} aufgehoben.", url))
        elif event == "appeal_decided":
            kept = (doc.get("appeal") or {}).get("state") == UPHELD
            sends.append((affected, "Einspruch entschieden",
                          f"Dein Einspruch gegen „{label}“ ist entschieden: {'Die Strafe bleibt.' if kept else 'Die Strafe ist aufgehoben.'} Die Begründung steht unter „Meine Strafen“.", url))
        elif event == "appeal":
            staff = await staff_user_ids(db, doc.get("league_id"), ("sanctions",)) - {doc.get("created_by"), doc.get("final_by")} - affected
            sends.append((staff, "Einspruch gegen eine Strafe", f"Gegen „{label}“ wurde Einspruch eingelegt. Es entscheidet eine Person, die die Strafe nicht verhängt hat.",
                          f"/admin/leagues/seasons/{doc.get('season_id')}#strafen"))
        if event in ("issued", "confirmed", "revoked") and doc.get("kind") in BAN_KINDS and doc.get("target_type") == PLAYER:
            player = names.get(doc.get("user_id") or "", "Ein Spieler")
            text = f"{player} ist für die Liga gesperrt und kann nicht aufgestellt werden." if event != "revoked" else f"{player} ist nicht mehr gesperrt."
            sends.append((await captain_ids(db, doc), "Sperre im Kader" if event != "revoked" else "Sperre aufgehoben", text, "/teams"))
        sent = 0
        for user_ids, title, body, link in sends:
            for user_id in sorted(user_ids - {actor_id}):
                if await create_user_notification(
                        user_id, title, body, url=link, kind="match_attention" if event == "appeal" else "tournament_registration",
                        meta={"category": "tournament_updates", "dedupe_key": f"sanction:{doc['id']}:{event}:{user_id}",
                              "sanction_id": doc["id"], "reason": "league_sanction"}):
                    sent += 1
        return sent
    except Exception as exc:  # noqa: BLE001 - eine Nachricht hält keine Strafe auf
        logger.warning("[sanctions] Nachricht zu Strafe %s nicht verschickt: %s", log_safe(doc.get("id")), type(exc).__name__)
        return 0
