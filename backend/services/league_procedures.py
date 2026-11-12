"""Verfahren in der Liga (E.2, #1619): Beanstandung, Protest und Einspruch - docs/LIGA.md, „D.5/E.2-Vertrag“.

Ein Verfahren ist ein Eintrag in ``matches_v2.disputes[]`` mit ``id`` und ``kind`` (kein zweites System, Nr. 130). Einträge ohne
``kind`` sind Altbestand („Problem melden“ der Turniere) und laufen unverändert weiter.

- **Beanstandung** (``objection``): vor der Bestätigung. Hält das Spiel wie bisher an (``disputed``), die Automatik ruht.
- **Protest** (``protest``): nach der Bestätigung, innerhalb ``protest_hours`` (ruht in Sperrzeiten). Mit ``contested_result_mode``
  ``counts`` bleibt das Ergebnis vorläufig stehen und das Spiel trägt ``contested``; mit ``excluded`` zählt es bis zur Entscheidung nicht.
- **Einspruch** (``appeal``): gegen Protestentscheid, Kampflos-Wertung oder Korrektur. Es entscheidet eine andere Person.

Nie automatisch gewertet: Fristen erinnern und eskalieren nur (``league_procedure_sweep``). Alle Fristen stehen als ISO-Zeit am Eintrag.
Wer was sieht, steht in ``view`` (Nr. 133): die Gegenseite ohne „sofort hingewiesen?“ und MOSS, alle anderen nichts.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from models import new_id, now_utc
from services import league_protest_settings as protest_settings
from services import match_proof_refs as refs
from services.league_scope import is_league_staffel
from services.match_disputes import CATEGORIES, DECIDED_STATUSES, decided_at, league_window_of
from services.matchday_schedule import response_deadline

OBJECTION, PROTEST, APPEAL = "objection", "protest", "appeal"
KINDS = (OBJECTION, PROTEST, APPEAL)
OPEN, WITHDRAWN, DECIDED = "open", "withdrawn", "decided"
REASON_MIN, REASON_MAX = 10, 1000
NOTE_MIN, NOTE_MAX = 10, 2000
STATEMENT_MAX = 2000
ADDITIONS_MAX = 10
AGAINST_TYPES = ("protest_decision", "forfeit", "correction")
RESTORABLE = {"completed", "forfeit", "pending", "ready", "scheduled", "in_progress", "running", "waiting_result"}
KIND_LABELS = {OBJECTION: "Beanstandung", PROTEST: "Protest", APPEAL: "Einspruch"}
WINDOW_CLOSED_DETAIL = "Die Protestfrist für dieses Spiel ist vorbei."
NOT_FOUND_DETAIL = "Verfahren nicht gefunden"
INCIDENT_DETAIL = "Diesen Vorfall gibt es an diesem Spiel nicht."


class ProcedureProblem(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class League:
    tournament: dict
    season: dict | None
    settings: dict

    @property
    def league_id(self) -> str | None:
        return (self.tournament.get("league_context") or {}).get("league_id")

    @property
    def season_id(self) -> str | None:
        return (self.tournament.get("league_context") or {}).get("season_id")


async def context(db, match: dict) -> League | None:
    """Staffel, Season und geltende Einstellungen - ``None`` bei einem Turnier ohne Liga."""
    if not match.get("tournament_id"):
        return None
    tournament = await db.tournaments.find_one({"id": match["tournament_id"]}, {"_id": 0, "creation_key": 0, "billing": 0})
    if not is_league_staffel(tournament):
        return None
    season = await db.league_seasons.find_one({"id": tournament["league_context"].get("season_id")}, {"_id": 0})
    return League(tournament, season, protest_settings.effective(tournament, season))


# ---------------------------------------------------------------- Lesen am Spiel

def is_procedure(row) -> bool:
    return isinstance(row, dict) and row.get("kind") in KINDS and bool(row.get("id"))


def rows(match: dict) -> list[dict]:
    return [row for row in match.get("disputes") or [] if is_procedure(row)]


def state_of(row: dict) -> str:
    if row.get("state") in (OPEN, WITHDRAWN, DECIDED):
        return row["state"]
    return DECIDED if row.get("resolved_at") else WITHDRAWN if row.get("withdrawn_at") else OPEN


def open_rows(match: dict) -> list[dict]:
    return [row for row in rows(match) if state_of(row) == OPEN]


def has_open(match: dict) -> bool:
    return bool(open_rows(match))


def find(match: dict, procedure_id: str) -> dict:
    row = next((row for row in rows(match) if row["id"] == procedure_id), None)
    if row is None:
        raise ProcedureProblem(404, NOT_FOUND_DETAIL)
    return row


def side_ids(match: dict) -> list[str]:
    return [slot.get("registration_id") for slot in match.get("slots") or [] if isinstance(slot, dict) and slot.get("registration_id")]


def other_side(match: dict, registration_id: str | None) -> str | None:
    others = [side for side in side_ids(match) if side != registration_id]
    return others[0] if registration_id and len(others) == 1 else None


def _iso(moment: datetime | None) -> str | None:
    return moment.isoformat() if moment else None


def _hours(league: League, start, hours: int) -> datetime | None:
    """Eine Frist in Stunden ab ``start`` - Zeit in Sperrzeiten und Sperrwochen zählt nicht mit (Nr. 29, 133)."""
    return response_deadline(league.tournament, start, hours)


def base_status(match: dict) -> str:
    """Der Stand, der ohne ein laufendes Verfahren gälte."""
    status = str(match.get("status") or "")
    return str(match.get("status_before_dispute") or "") if status == "disputed" else status


def kind_now(match: dict) -> str:
    return PROTEST if base_status(match) in DECIDED_STATUSES else OBJECTION


def contested(match: dict) -> bool:
    """Zählt das Ergebnis vorläufig, obwohl es angefochten ist? Offener Protest mit ``counts`` oder offener Einspruch."""
    return any(row["kind"] == APPEAL or (row["kind"] == PROTEST and row.get("contested_mode") == "counts") for row in open_rows(match))


def _halts(row: dict) -> bool:
    """Hält dieser offene Eintrag das Spiel an (``disputed``)? Altbestand, Beanstandung und Protest mit ``excluded``."""
    if not is_procedure(row):
        return not row.get("resolved_at")
    if state_of(row) != OPEN:
        return False
    return row["kind"] == OBJECTION or (row["kind"] == PROTEST and row.get("contested_mode") != "counts")


async def window(db, match: dict, league: League, now: datetime | None = None) -> dict:
    """Darf eine Seite jetzt ein Verfahren eröffnen - und bis wann? Vor der Bestätigung immer (Beanstandung), danach
    ``protest_hours`` ab der Bestätigung (ruhend in Sperrzeiten). „Nächstes Spiel des Siegers“ gilt in der Liga nicht (Nr. 129)."""
    # Eine Stelle für Server, Website und App: dieselbe Rechnung wie ``match_disputes.dispute_window`` (``can_dispute``).
    return league_window_of(match, league.tournament, league.settings["protest_hours"], now or now_utc())


# ---------------------------------------------------------------- Schreiben: gemeinsame Bausteine

async def audit(db, action: str, match: dict, actor_id: str | None, row: dict | None = None, **data) -> None:
    """Protokoll ohne Personendaten im Text: Kennungen, Art und Längen - nie Begründung, Namen oder Adressen."""
    await db.audit_logs.insert_one({
        "id": new_id(), "action": action, "target_id": match.get("tournament_id") or match.get("id"), "actor_id": actor_id,
        "data": {"match_id": match.get("id"), **({"procedure_id": row["id"], "kind": row["kind"]} if row else {}), **data},
        "created_at": now_utc().isoformat(),
    })


async def _save_row(db, match: dict, row: dict, extra: dict | None = None) -> dict:
    """Den geänderten Eintrag zurückschreiben. Bedingung ist der Stand, auf dem gerechnet wurde (``updated_at``): Hat inzwischen
    jemand anderes das Spiel geändert, wird nichts überschrieben (409) - die Wege der Seiten laufen ohnehin unter der Schreibsperre."""
    disputes = [row if (is_procedure(item) and item["id"] == row["id"]) else item
                for item in match.get("disputes") or [] if isinstance(item, dict)]
    change = {"disputes": disputes, "updated_at": now_utc().isoformat(), **(extra or {})}
    unset = {key: "" for key, value in change.items() if value is None}
    update = {"$set": {key: value for key, value in change.items() if key not in unset}}
    if unset:
        update["$unset"] = unset
    done = await db.matches_v2.update_one({"id": match["id"], "updated_at": match.get("updated_at")}, update)
    if not getattr(done, "modified_count", 0):
        raise ProcedureProblem(409, "Das Spiel wurde gerade geändert. Bitte noch einmal versuchen.")
    return await db.matches_v2.find_one({"id": match["id"]}, {"_id": 0}) or match


def _settle(match: dict, changed: dict) -> dict:
    """Was am Spiel nach Zurückziehen oder Entscheidung gilt: ``contested`` neu, und ohne haltenden Eintrag der Stand von vorher."""
    disputes = [changed if (is_procedure(row) and row["id"] == changed["id"]) else row
                for row in match.get("disputes") or [] if isinstance(row, dict)]
    after = {**match, "disputes": disputes}
    extra: dict = {"contested": contested(after)}
    if str(match.get("status") or "") == "disputed" and not any(_halts(row) for row in disputes):
        previous = str(match.get("status_before_dispute") or "")
        if previous not in RESTORABLE:
            previous = ("forfeit" if match.get("forfeit_registration_id") else "completed") if match.get("results") else (
                "waiting_result" if match.get("started_at") else "ready")
        extra.update({"status": previous, "status_before_dispute": None})
    return extra


def _text(value, low: int, high: int, detail: str) -> str:
    text = str(value or "").strip()
    if not low <= len(text) <= high:
        raise ProcedureProblem(422, detail)
    return text


def _incident_id(match: dict, value) -> str | None:
    """Der Vorfall muss am selben Spiel stehen - sonst 422, eine fremde Kennung wird nie gespeichert."""
    incident_id = str(value or "").strip()
    if not incident_id:
        return None
    if not any(isinstance(row, dict) and row.get("id") == incident_id for row in match.get("incidents") or []):
        raise ProcedureProblem(422, INCIDENT_DETAIL)
    return incident_id


def _score(value) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 999:
        raise ProcedureProblem(422, "Das angegebene Ergebnis ist nicht gültig: Bitte je Seite eine Zahl von 0 bis 999.")
    return value


def clean_claimed(match: dict, value) -> dict | None:
    """Das abweichende Ergebnis: je Seite ein Stand, auf Wunsch je Map Sieger und Stand."""
    if value in (None, {}, ""):
        return None
    sides = side_ids(match)
    results = value.get("results") if isinstance(value, dict) else None
    if not isinstance(results, list) or {str((row or {}).get("registration_id")) for row in results if isinstance(row, dict)} != set(sides) \
            or len(results) != len(sides):
        raise ProcedureProblem(422, "Bitte das Ergebnis für beide Seiten dieses Spiels angeben.")
    out = {"results": [{"registration_id": row["registration_id"], "score": _score(row.get("score"))} for row in results], "games": []}
    games = value.get("games") or []
    if not isinstance(games, list) or len(games) > 9:
        raise ProcedureProblem(422, "Das angegebene Ergebnis je Map ist nicht gültig.")
    for game in games:
        if not isinstance(game, dict) or isinstance(game.get("position"), bool) or not isinstance(game.get("position"), int) \
                or not 1 <= game["position"] <= 9 or game.get("winner_registration_id") not in (None, *sides):
            raise ProcedureProblem(422, "Das angegebene Ergebnis je Map ist nicht gültig.")
        scores = game.get("scores") or {}
        if not isinstance(scores, dict) or not set(scores) <= set(sides):
            raise ProcedureProblem(422, "Das angegebene Ergebnis je Map ist nicht gültig.")
        out["games"].append({"position": game["position"], "winner_registration_id": game.get("winner_registration_id"),
                             "scores": {side: _score(score) for side, score in scores.items()}})
    return out


def _statement_slot(match: dict, league: League, registration_id: str | None, now: datetime) -> dict | None:
    opponent = other_side(match, registration_id)
    if not opponent:
        return None
    return {"registration_id": opponent, "due_at": _iso(_hours(league, now, league.settings["statement_hours"])),
            "extended_by": None, "text": None, "user_id": None, "at": None}


# ---------------------------------------------------------------- Einreichen

async def submit(db, match: dict, league: League, *, user: dict, registration_id: str | None, reason: str, reason_key: str | None,
                 category: str | None, claimed=None, notified_immediately: bool | None = None, incident_id: str | None = None,
                 photo_id: str | None = None, stage: dict | None = None) -> dict:
    """Beanstandung oder Protest einreichen - die Art ergibt sich aus dem Stand des Spiels. Ein Aufruf ohne ``reason_key`` (App ohne
    neuen Build) bleibt erlaubt und wird mit dem Grund aus ``category`` gespeichert, ohne die neuen Pflichtangaben."""
    now = now_utc()
    guided = reason_key is not None
    key = str(reason_key if guided else (category or "other")).strip()
    spec = protest_settings.reason_of(league.settings, key)
    if spec is None:
        raise ProcedureProblem(422, "Bitte einen Grund aus der Liste wählen.")
    text = str(reason or "").strip()
    if guided:
        text = _text(text, REASON_MIN, REASON_MAX, f"Bitte beschreibe in {REASON_MIN} bis {REASON_MAX} Zeichen, was nicht stimmt.")
    elif not text:
        raise ProcedureProblem(422, "Bitte kurz beschreiben, was nicht stimmt.")
    claim = clean_claimed(match, claimed)
    if guided and key == protest_settings.RESULT_REASON and claim is None:
        raise ProcedureProblem(422, "Bitte das Ergebnis angeben, das aus eurer Sicht stimmt.")
    if guided and spec.get("ask_notified") and not isinstance(notified_immediately, bool):
        raise ProcedureProblem(422, "Bitte angeben, ob ihr die Gegenseite sofort darauf hingewiesen habt.")
    found = await window(db, match, league, now)
    if registration_id and not found["open"]:
        raise ProcedureProblem(409, WINDOW_CLOSED_DETAIL)
    kind = found["kind"] or kind_now(match)
    mine = [row for row in rows(match) if row.get("registration_id") == registration_id and row["kind"] != APPEAL]
    if any(state_of(row) == OPEN for row in mine):
        raise ProcedureProblem(409, "Zu diesem Spiel läuft schon ein Verfahren eurer Seite. Ergänzt es, statt ein zweites zu eröffnen.")
    if any(state_of(row) == WITHDRAWN and row.get("reason_key") == key for row in mine):
        raise ProcedureProblem(409, "Ihr habt ein Verfahren mit diesem Grund zurückgezogen. Ein neues mit demselben Grund ist nicht möglich.")
    incident = _incident_id(match, incident_id)
    photo = None
    if photo_id:
        from services.match_proofs import claim_proof
        photo = await claim_proof(db, photo_id, owner_id=user["id"], match_id=match["id"], kind="dispute")
    if kind == OBJECTION:
        from services.match_deadlines import auto_confirm_due, setting
        due = auto_confirm_due(match, league.tournament, stage)
        evidence_until = due if due and due > now else _hours(league, now, setting("result_confirm_hours_league", league.tournament, stage))
        mode = None
    else:
        evidence_until = refs.parse(found["until"]) or _hours(league, now, league.settings["protest_hours"])
        mode = league.settings["contested_result_mode"]
    entry = {
        "id": new_id(), "kind": kind, "state": OPEN, "user_id": user["id"], "registration_id": registration_id, "at": now.isoformat(),
        "reason_key": key, "category": key if key in CATEGORIES else "other", "reason": text,
        "claimed": claim, "notified_immediately": notified_immediately if spec.get("ask_notified") else None,
        "evidence_until": _iso(evidence_until), "statement": _statement_slot(match, league, registration_id, now),
        "moss_requests": [], "assignee": None, "incident_id": incident, "additions": [],
        # Ohne Zuständige geht der Fall nach der Zielfrist an „manage“ - die Frist steht am Verfahren, nicht in der Einstellung.
        "escalate_at": _iso(_hours(league, now, league.settings["protest_target_hours"])),
        **({"contested_mode": mode} if mode else {}), **({"photo_id": photo["id"]} if photo else {}),
    }
    change: dict = {"updated_at": now.isoformat()}
    if _halts(entry):
        change["status"] = "disputed"
        if str(match.get("status") or "") != "disputed":
            change["status_before_dispute"] = match.get("status") or "pending"
    else:
        change["contested"] = True
    await db.matches_v2.update_one({"id": match["id"]}, {"$push": {"disputes": entry}, "$set": change})
    await audit(db, "match.procedure.open", match, user["id"], entry, reason_key=key, reason_length=len(text),
                **({"incident_id": incident} if incident else {}))
    updated = await db.matches_v2.find_one({"id": match["id"]}, {"_id": 0}) or match
    from services import league_procedure_notify as notify
    await notify.opened(db, updated, league, entry)
    return {"match": updated, "entry": entry}


async def submit_appeal(db, match: dict, league: League, *, user: dict, registration_id: str, against_type: str, ref_id: str,
                        reason: str) -> dict:
    """Einspruch (Nr. 41, 45): einmal je Ausgangsentscheidung, innerhalb ``appeal_hours``. Die Ausgangsentscheidung gilt weiter."""
    now = now_utc()
    text = _text(reason, REASON_MIN, REASON_MAX, f"Bitte begründe den Einspruch in {REASON_MIN} bis {REASON_MAX} Zeichen.")
    if against_type not in AGAINST_TYPES:
        raise ProcedureProblem(422, "Ein Einspruch richtet sich gegen einen Protestentscheid, eine Kampflos-Wertung oder eine Korrektur.")
    if against_type == "protest_decision":
        original = find(match, ref_id)
        if original["kind"] == APPEAL or state_of(original) != DECIDED:
            raise ProcedureProblem(409, "Ein Einspruch geht erst gegen eine Entscheidung - und nicht gegen einen Einspruch.")
        decided, decider = refs.parse(original.get("resolved_at")), original.get("resolved_by")
        until = refs.parse(original.get("appeal_until")) or _hours(league, decided, league.settings["appeal_hours"])
    else:
        meta = match.get("result_meta") or {}
        fits = (str(match.get("status") or "") == "forfeit") if against_type == "forfeit" else bool(meta.get("correction_reason"))
        if ref_id != match["id"] or not fits:
            raise ProcedureProblem(409, "Zu diesem Spiel gibt es keine solche Entscheidung.")
        decided, decider = decided_at(match), match.get("completed_by") or match.get("admin_decision_by")
        until = _hours(league, decided, league.settings["appeal_hours"]) if decided else None
    if until is None or now >= until:
        raise ProcedureProblem(409, "Die Einspruchsfrist ist vorbei.")
    decided_iso = _iso(decided)
    if any(row["kind"] == APPEAL and (row.get("against") or {}).get("type") == against_type
           and (row.get("against") or {}).get("ref_id") == ref_id and (row.get("against") or {}).get("decided_at") == decided_iso
           for row in rows(match)):
        raise ProcedureProblem(409, "Gegen diese Entscheidung wurde schon Einspruch eingelegt. Das geht nur einmal.")
    entry = {
        "id": new_id(), "kind": APPEAL, "state": OPEN, "user_id": user["id"], "registration_id": registration_id, "at": now.isoformat(),
        "reason_key": "other", "category": "other", "reason": text, "claimed": None, "notified_immediately": None,
        "evidence_until": _iso(until), "statement": _statement_slot(match, league, registration_id, now),
        "moss_requests": [], "assignee": None, "incident_id": None, "additions": [],
        "escalate_at": _iso(_hours(league, now, league.settings["protest_target_hours"])),
        "against": {"type": against_type, "ref_id": ref_id, "decided_at": decided_iso, "decided_by": decider},
    }
    await db.matches_v2.update_one({"id": match["id"]}, {
        "$push": {"disputes": entry}, "$set": {"contested": True, "updated_at": now.isoformat()}})
    await audit(db, "match.procedure.open", match, user["id"], entry, against=against_type, reason_length=len(text))
    updated = await db.matches_v2.find_one({"id": match["id"]}, {"_id": 0}) or match
    from services import league_procedure_notify as notify
    await notify.opened(db, updated, league, entry)
    return {"match": updated, "entry": entry}


# ---------------------------------------------------------------- Ergänzen, Zurückziehen, Stellungnahme

def _require_open(row: dict) -> None:
    if state_of(row) != OPEN:
        raise ProcedureProblem(409, "Dieses Verfahren ist abgeschlossen.")


async def amend(db, match: dict, league: League, procedure_id: str, *, user: dict, as_side: str | None, as_lead: bool,
                changes: dict) -> dict:
    """Ergänzen: die einreichende Seite bis ``evidence_until`` (Text, Ergebnis, Vorfall), die Leitung nur die Zuordnung zum Vorfall."""
    row = dict(find(match, procedure_id))
    _require_open(row)
    now = now_utc()
    own = bool(as_side) and as_side == row.get("registration_id")
    if not own and not as_lead:
        raise ProcedureProblem(403, "Ergänzen kann nur die Seite, die das Verfahren eingereicht hat.")
    changed: list[str] = []
    extra: dict = {}
    if own:
        deadline = refs.parse(row.get("evidence_until"))
        if deadline and now > deadline:
            raise ProcedureProblem(409, "Die Frist zum Ergänzen ist vorbei.")
        if changes.get("addition") is not None:
            if len(row.get("additions") or []) >= ADDITIONS_MAX:
                raise ProcedureProblem(409, f"Mehr als {ADDITIONS_MAX} Ergänzungen gehen nicht.")
            text = _text(changes["addition"], REASON_MIN, REASON_MAX, f"Bitte eine Ergänzung mit {REASON_MIN} bis {REASON_MAX} Zeichen.")
            row["additions"] = [*(row.get("additions") or []), {"text": text, "user_id": user["id"], "at": now.isoformat()}]
            changed.append("addition")
        if "claimed" in changes and row["kind"] != APPEAL:
            row["claimed"] = clean_claimed(match, changes["claimed"])
            changed.append("claimed")
    elif any(key in changes for key in ("addition", "claimed")):
        raise ProcedureProblem(403, "Die Leitung ändert nur die Zuordnung zum Vorfall.")
    if "incident_id" in changes and row["kind"] != APPEAL:
        before, after = row.get("incident_id"), _incident_id(match, changes["incident_id"])
        if before != after:
            row["incident_id"] = after
            changed.append("incident_id")
            extra = {"incident_from": before, "incident_to": after}
    if not changed:
        raise ProcedureProblem(422, "Es wurde nichts geändert.")
    updated = await _save_row(db, match, row)
    await audit(db, "match.procedure.amend", match, user["id"], row, fields=changed, by="side" if own else "lead", **extra)
    return updated


async def withdraw(db, match: dict, league: League, procedure_id: str, *, user: dict, as_side: str | None) -> dict:
    """Zurückziehen bis zur Entscheidung - protokolliert; danach kein neues Verfahren dieser Seite mit demselben Grund."""
    row = dict(find(match, procedure_id))
    _require_open(row)
    own = (bool(as_side) and as_side == row.get("registration_id")) or (not row.get("registration_id") and row.get("user_id") == user["id"])
    if not own:
        raise ProcedureProblem(403, "Zurückziehen kann nur die Seite, die das Verfahren eingereicht hat.")
    now = now_utc().isoformat()
    row.update({"state": WITHDRAWN, "withdrawn_at": now, "withdrawn_by": user["id"]})
    updated = await _save_row(db, match, row, _settle(match, row))
    await audit(db, "match.procedure.withdraw", match, user["id"], row, reason_key=row.get("reason_key"))
    from services import league_procedure_notify as notify
    await notify.withdrawn(db, updated, league, row)
    return updated


async def give_statement(db, match: dict, league: League, procedure_id: str, *, user: dict, as_side: str | None, text: str) -> dict:
    """Die Stellungnahme der Gegenseite, bis ``statement.due_at`` - bis dahin lässt sie sich überschreiben."""
    row = dict(find(match, procedure_id))
    _require_open(row)
    slot = dict(row.get("statement") or {})
    if not as_side or as_side != slot.get("registration_id"):
        raise ProcedureProblem(403, "Stellung nimmt die Gegenseite.")
    now = now_utc()
    due = refs.parse(slot.get("due_at"))
    if due and now > due:
        raise ProcedureProblem(409, "Die Frist für die Stellungnahme ist vorbei. Die Leitung kann sie verlängern.")
    body = _text(text, REASON_MIN, STATEMENT_MAX, f"Bitte eine Stellungnahme mit {REASON_MIN} bis {STATEMENT_MAX} Zeichen.")
    row["statement"] = {**slot, "text": body, "user_id": user["id"], "at": now.isoformat()}
    updated = await _save_row(db, match, row)
    await audit(db, "match.procedure.statement", match, user["id"], row, length=len(body))
    from services import league_procedure_notify as notify
    await notify.statement_given(db, updated, league, row)
    return updated


# ---------------------------------------------------------------- Leitung: übernehmen, verlängern, MOSS, entscheiden

def decided_by(row: dict) -> str | None:
    """Wer die Ausgangsentscheidung getroffen hat - über den Einspruch entscheidet diese Person nie."""
    return (row.get("against") or {}).get("decided_by") if row.get("kind") == APPEAL else None


async def assign(db, match: dict, league: League, procedure_id: str, *, user: dict) -> dict:
    """„Übernehmen“ (Nr. 135): sichtbar für beide Seiten, mit Zielfrist. Der Aufrufer hat Recht und Befangenheit geprüft."""
    row = dict(find(match, procedure_id))
    _require_open(row)
    now = now_utc()
    before = (row.get("assignee") or {}).get("user_id")
    row["assignee"] = {"user_id": user["id"], "at": now.isoformat()}
    row["target_at"] = _iso(_hours(league, now, league.settings["protest_target_hours"]))
    row["reminded_at"] = row["escalated_at"] = None
    # Gespeichert wie jede Frist: ``protest_escalate_hours`` nach der Zielfrist, ruhend in Sperrzeiten.
    row["escalate_at"] = _iso(_hours(league, refs.parse(row["target_at"]), league.settings["protest_escalate_hours"]))
    updated = await _save_row(db, match, row)
    await audit(db, "match.procedure.assign", match, user["id"], row, taken_over=bool(before and before != user["id"]))
    from services import league_procedure_notify as notify
    await notify.assigned(db, updated, league, row)
    return updated


async def extend_statement(db, match: dict, league: League, procedure_id: str, *, user: dict, hours: int) -> dict:
    row = dict(find(match, procedure_id))
    _require_open(row)
    slot = dict(row.get("statement") or {})
    if not slot.get("registration_id"):
        raise ProcedureProblem(409, "Zu diesem Verfahren gibt es keine Gegenseite.")
    if isinstance(hours, bool) or not isinstance(hours, int) or not 1 <= hours <= 336:
        raise ProcedureProblem(422, "Bitte um 1 bis 336 Stunden verlängern.")
    now = now_utc()
    start = max(now, refs.parse(slot.get("due_at")) or now)
    row["statement"] = {**slot, "due_at": _iso(_hours(league, start, hours)), "extended_by": user["id"], "expired_at": None}
    updated = await _save_row(db, match, row)
    await audit(db, "match.procedure.statement_extend", match, user["id"], row, hours=hours)
    from services import league_procedure_notify as notify
    await notify.statement_extended(db, updated, league, row)
    return updated


async def request_moss(db, match: dict, league: League, procedure_id: str, *, user: dict, player_id: str) -> dict:
    """Die Leitung fordert die MOSS-Datei eines Spielers an (§ 9a.3) - Frist ``moss_upload_hours``, nie eine automatische Wertung."""
    row = dict(find(match, procedure_id))
    _require_open(row)
    from services.match_audience import player_ids, registrations_for_match, teams_by_id

    registrations = await registrations_for_match(db, match)
    teams = await teams_by_id(db, registrations)
    side = next((reg["id"] for reg in registrations if player_id in player_ids(reg, teams.get(reg.get("team_id") or ""))), None)
    if not side:
        raise ProcedureProblem(422, "Diese Person spielt in diesem Spiel auf keiner Seite.")
    requests = list(row.get("moss_requests") or [])
    if any(item.get("user_id") == player_id and item.get("state") == "requested" for item in requests):
        raise ProcedureProblem(409, "Von dieser Person ist die MOSS-Datei schon angefordert.")
    now = now_utc()
    request = {"id": new_id(), "user_id": player_id, "registration_id": side, "requested_by": user["id"], "at": now.isoformat(),
               "due_at": _iso(_hours(league, now, league.settings["moss_upload_hours"])), "state": "requested"}
    row["moss_requests"] = [*requests, request]
    updated = await _save_row(db, match, row)
    await audit(db, "match.procedure.moss_request", match, user["id"], row, request_id=request["id"])
    from services import league_procedure_notify as notify
    await notify.moss_requested(db, updated, league, row, request)
    return updated


async def excuse_moss(db, match: dict, league: League, procedure_id: str, request_id: str, *, user: dict, reason: str) -> dict:
    """Technische Probleme kann die Leitung begründet entschuldigen (Nr. 109)."""
    row = dict(find(match, procedure_id))
    _require_open(row)
    note = _text(reason, 5, 500, "Bitte kurz begründen, warum die Datei entschuldigt fehlt.")
    requests = [dict(item) for item in row.get("moss_requests") or []]
    target = next((item for item in requests if item.get("id") == request_id), None)
    if target is None:
        raise ProcedureProblem(404, NOT_FOUND_DETAIL)
    if target.get("state") == "uploaded":
        raise ProcedureProblem(409, "Die Datei ist schon da.")
    target.update({"state": "excused", "excused_by": user["id"], "excused_at": now_utc().isoformat(), "excuse_reason": note})
    row["moss_requests"] = requests
    updated = await _save_row(db, match, row)
    await audit(db, "match.procedure.moss_excuse", match, user["id"], row, request_id=request_id)
    return updated


async def note_moss_upload(db, match: dict, ref_id: str, user_id: str) -> None:
    """Die Datei ist da: offene Anforderungen dieser Person an diesem Verfahren gelten als erfüllt."""
    for _attempt in range(3):
        # Der Upload läuft ohne die Schreibsperre des Spiels: auf dem frischen Stand rechnen, bei einer Änderung dazwischen noch einmal.
        fresh = await db.matches_v2.find_one({"id": match["id"]}, {"_id": 0}) or match
        row = next((dict(item) for item in rows(fresh) if item["id"] == ref_id), None)
        if row is None:
            return
        requests = [dict(item) for item in row.get("moss_requests") or []]
        hit = [item for item in requests if item.get("user_id") == user_id and item.get("state") in ("requested", "missing")]
        if not hit:
            return
        now = now_utc().isoformat()
        for item in hit:
            item.update({"state": "uploaded", "uploaded_at": now})
        row["moss_requests"] = requests
        try:
            await _save_row(db, fresh, row)
            return
        except ProcedureProblem:
            continue


def _decided(row: dict, league: League, *, actor_id: str, now: datetime, decision: str, note: str | None) -> dict:
    out = {**row, "state": DECIDED, "resolved_at": now.isoformat(), "resolved_by": actor_id, "decision": decision,
           "decision_note": note}
    # Gegen die Entscheidung über einen Einspruch gibt es keinen weiteren: Sie ist endgültig (§ 13.7).
    if row["kind"] != APPEAL:
        out["appeal_until"] = _iso(_hours(league, now, league.settings["appeal_hours"]))
    return out


async def decide_keep(db, match: dict, league: League, procedure_id: str, *, user: dict, note: str) -> dict:
    """„Ergebnis bleibt“ bzw. „Einspruch abgewiesen“ - mit Pflichtbegründung. „Ergebnis ändern“ läuft über das Ergebnis-Fenster
    (``close_on_result``). Der Aufrufer hat Recht und Befangenheit geprüft."""
    row = dict(find(match, procedure_id))
    _require_open(row)
    text = _text(note, NOTE_MIN, NOTE_MAX, f"Bitte die Entscheidung in mindestens {NOTE_MIN} Zeichen begründen.")
    now = now_utc()
    row = _decided(row, league, actor_id=user["id"], now=now, decision="keep", note=text)
    extra = _settle(match, row)
    updated = await _save_row(db, match, row, {**extra, "dispute_resolved_at": now.isoformat(), "dispute_resolved_by": user["id"]})
    await audit(db, "match.procedure.decide", match, user["id"], row, decision="keep", note_length=len(text),
                **({"status": extra["status"]} if "status" in extra else {}))
    from services import league_procedure_notify as notify
    await notify.decided(db, updated, league, row)
    return updated


def result_refusal(match: dict, user: dict, reason: str | None, *, force: bool) -> tuple[int, str] | None:
    """Darf diese Person das Ergebnis eines Spiels mit offenem Verfahren schreiben? Eine Korrektur entscheidet das Verfahren mit:
    Sie braucht die Begründung - und über einen Einspruch entscheidet nie, wer die Ausgangsentscheidung traf."""
    pending = open_rows(match)
    if not pending:
        return None
    if any(decided_by(row) and decided_by(row) == user.get("id") for row in pending):
        from services.league_permissions import OWN_DECISION_DETAIL
        return 403, OWN_DECISION_DETAIL
    if len(str(reason or "").strip()) < NOTE_MIN:
        return 422, f"Zu diesem Spiel läuft ein Verfahren. Bitte die Entscheidung in mindestens {NOTE_MIN} Zeichen begründen."
    return None


async def no_show_decision_note(db, match: dict, registration_id: str, note: str) -> str | None:
    """Die Begründung, mit der „nicht erschienen“ ein offenes Verfahren mitentscheidet: ein verständlicher Satz mit dem Namen der
    Seite statt des Kurztexts der Automatik („Nicht erschienen – Check-in bis 20:15 nicht erfolgt“). ``None`` ohne offenes Verfahren."""
    if not has_open(match):
        return None
    gone = await db.tournament_registrations.find_one({"id": registration_id}, {"_id": 0, "display_name": 1, "team_name": 1}) or {}
    name = gone.get("display_name") or gone.get("team_name") or "Eine Seite"
    detail = str(note or "").split(" – ", 1)[-1].strip().replace("Turnierleitung", "Liga-Leitung")
    return f"Kampflos gewertet: {name} ist nicht erschienen ({detail})." if detail else f"Kampflos gewertet: {name} ist nicht erschienen."


async def result_decision_refusal(db, match: dict, *, actor_id: str | None, note: str | None, by_players: bool) -> tuple[int, str] | None:
    """Die eine Stelle für jeden Weg, der ein Ergebnis schreibt (Ergebnis-Fenster, Korrektur, Wertung kampflos, „nicht erschienen“,
    gehaltenes Ergebnis): Zu einem Spiel mit offenem Verfahren entscheidet das Ergebnis das Verfahren mit. ``None``: es darf.
    Sonst Status und Klartext - geschrieben wird dann nichts."""
    pending = open_rows(match)
    if not pending:
        return None
    if by_players:
        return 409, "Zu diesem Spiel läuft ein Verfahren. Das Ergebnis entscheidet die Liga-Leitung."
    from services.league_permissions import CONFLICT_DETAIL, OWN_DECISION_DETAIL, conflict_of_interest
    from services.tournament_permissions import has_match_result_permission

    account = await db.users.find_one({"id": actor_id}, {"_id": 0, "id": 1, "role": 1, "areas": 1, "is_active": 1, "is_banned": 1,
                                                       "mfa_enabled": 1}) if actor_id else None
    person = {**account, "auth_mfa_verified": True} if account else None
    if not person or not await has_match_result_permission(person, match, capability="disputes"):
        return 409, "Zu diesem Spiel läuft ein Verfahren. Ein Ergebnis oder eine Wertung entscheidet es mit – das geht nur mit dem Recht „Proteste“."
    if any(decided_by(row) and decided_by(row) == actor_id for row in pending):
        return 409, OWN_DECISION_DETAIL
    conflict = await conflict_of_interest(db, person, match)
    if conflict and not conflict["override"]:
        return 409, CONFLICT_DETAIL
    if len(str(note or "").strip()) < NOTE_MIN:
        return 422, f"Zu diesem Spiel läuft ein Verfahren. Bitte die Entscheidung in mindestens {NOTE_MIN} Zeichen begründen."
    return None


async def close_on_result(db, match: dict, *, actor_id: str, now_iso: str, decision: str, note: str | None) -> None:
    """Die Leitung hat ein Ergebnis zu einem Spiel mit offenem Verfahren eingetragen: Damit sind alle offenen Einträge entschieden -
    Altbestand wie bisher, Verfahren mit Begründung (der Grund der Korrektur) und Einspruchsfrist."""
    league = await context(db, match)
    now = refs.parse(now_iso) or now_utc()
    closed: list[dict] = []
    disputes = []
    for row in match.get("disputes") or []:
        if not isinstance(row, dict):
            continue
        if is_procedure(row):
            if state_of(row) == OPEN and league is not None:
                row = _decided(row, league, actor_id=actor_id, now=now, decision=decision, note=(note or "").strip() or None)
                closed.append(row)
        elif not row.get("resolved_at"):
            row = {**row, "resolved_at": now_iso, "resolved_by": actor_id, "decision": decision}
        disputes.append(row)
    await db.matches_v2.update_one({"id": match["id"]}, {"$set": {
        "disputes": disputes, "dispute_resolved_at": now_iso, "dispute_resolved_by": actor_id, "contested": False,
        # Der Zeit-Job und der MOSS-Upload schreiben nur auf dem Stand, den sie gelesen haben (``_save_row``): Mit dem neuen
        # ``updated_at`` überschreibt ein älterer Schnappschuss diese Entscheidung nicht.
        "updated_at": now_utc().isoformat()}})
    for row in closed:
        await audit(db, "match.procedure.decide", match, actor_id, row, decision=decision, via="result")
    if closed and league is not None:
        from services import league_procedure_notify as notify
        updated = await db.matches_v2.find_one({"id": match["id"]}, {"_id": 0}) or match
        for row in closed:
            await notify.decided(db, updated, league, row)


# ---------------------------------------------------------------- Wer sieht was (Nr. 133)

@dataclass(frozen=True)
class Viewer:
    user_id: str | None = None
    sides: frozenset = frozenset()    # Anmeldungen dieses Spiels, zu deren Spielern die Person gehört
    acting: frozenset = frozenset()   # … für die sie handeln darf
    lead: bool = False                # Leitung mit „Proteste“ oder „Ergebnisse“ - und nicht befangen
    can_decide: bool = False          # … mit „Proteste“
    override: bool = False            # befangener Superadmin mit „Proteste“: handelt nur als Notausnahme mit Pflichtgrund (B.1)


async def viewer_for(db, match: dict, user: dict | None) -> Viewer:
    """Dieselbe Regel wie bei den Nachweisen: Wer zu einer Seite gehört, ist nie „Leitung“ (befangen wie B.1)."""
    if not user or not user.get("id"):
        return Viewer()
    from services import match_proofs
    from services.tournament_permissions import has_match_result_permission

    seen = await match_proofs.viewer_for(db, match, user)
    may = await has_match_result_permission(user, match, capability="disputes")
    override = False
    if may and not seen.lead:
        # Die Grundregel aus B.1 bleibt: Der Superadmin darf im eigenen Spiel als Notausnahme handeln, mit Pflichtgrund im
        # Protokoll. Sehen tut er dabei weiter nur, was seine Seite sieht.
        from services.league_permissions import conflict_of_interest

        conflict = await conflict_of_interest(db, user, match)
        override = bool(conflict and conflict["override"])
    return Viewer(user_id=seen.user_id, sides=seen.sides, acting=seen.acting, lead=seen.lead, can_decide=seen.lead and may,
                  override=override)


def strip_rows(match: dict | None, viewer: Viewer) -> dict | None:
    """Die Verfahren im Spiel-Datensatz für alle außer der nicht befangenen Leitung: Die Einzelheiten stehen, je nach Rolle, im Block
    ``league.procedures`` der Matchseite - im Datensatz bleibt nur, was alte Leser (App) für die eigene Meldung brauchen."""
    from services.match_public_view import without_procedure_details

    return match if viewer.lead else without_procedure_details(match, viewer.user_id)


async def for_viewer(db, match: dict, user: dict | None) -> dict:
    """Ein einzelnes Spiel für diese Person: vollständig nur für die nicht befangene Leitung mit „Proteste“ oder „Ergebnisse“."""
    if not rows(match):
        return match
    return strip_rows(match, await viewer_for(db, match, user))


def _row_needs_cut(row, viewer_id: str | None) -> bool:
    """Trägt diese Zeile mehr, als jede Person bzw. die einreichende Person selbst sehen darf? Schon gekürzte Zeilen (nur die
    öffentlichen Schlüssel, oder die eigene Meldung ohne Internes) brauchen keine weitere Prüfung."""
    from services.match_public_view import PROCEDURE_OWN_HIDDEN, PROCEDURE_PUBLIC_KEYS

    if not is_procedure(row):
        return False
    keys = set(row)
    if keys & PROCEDURE_OWN_HIDDEN:
        return True
    return bool(keys - set(PROCEDURE_PUBLIC_KEYS)) and not (viewer_id and row.get("user_id") == viewer_id)


def _nodes_to_cut(payload, viewer_id: str | None) -> list[dict]:
    """Alle Knoten der Antwort (in jeder Tiefe, ohne Rekursion), deren ``disputes`` noch etwas tragen, das zu prüfen ist."""
    found: list[dict] = []
    todo = [payload]
    while todo:
        current = todo.pop()
        if isinstance(current, dict):
            entries = current.get("disputes")
            if isinstance(entries, list) and any(_row_needs_cut(row, viewer_id) for row in entries):
                found.append(current)
            todo.extend(value for value in current.values() if isinstance(value, (dict, list)))
        elif isinstance(current, list):
            todo.extend(value for value in current if isinstance(value, (dict, list)))
    return found


def carries_details(payload) -> bool:
    """Steckt in der Antwort ein Verfahren mit mehr als den öffentlichen Schlüsseln? Für den Wächter der Antworten: Ein Zähler
    (``"disputes": 3``) oder schon gekürzte Zeilen brauchen weder die Person der Anfrage noch eine Kürzung."""
    return bool(_nodes_to_cut(payload, None))


async def _lead_verdicts(db, nodes: list[dict], user: dict | None) -> dict[int, bool]:
    """Für welche dieser Knoten ist die Person die nicht befangene Leitung? Je Anfrage einmal je Staffel entschieden (ein
    Recht, eine Abfrage der Beteiligung) statt je Spiel - wie ``for_viewer_list``. Lässt sich ein Knoten keinem Spiel zuordnen,
    gilt: nein."""
    verdicts = {id(node): False for node in nodes}
    if not user or not user.get("id"):
        return verdicts
    from services.league_permissions import involved_match_ids
    from services.tournament_permissions import has_match_result_permission

    full: dict[int, dict] = {}
    lookups: dict[str, list[dict]] = {}
    for node in nodes:
        if node.get("tournament_id") and node.get("slots"):
            full[id(node)] = node
        else:
            key = str(node.get("id") or node.get("match_id") or "")
            if key:
                lookups.setdefault(key, []).append(node)
    if lookups:
        stored = await db.matches_v2.find({"id": {"$in": sorted(lookups)}}, {"_id": 0}).to_list(len(lookups) + 1)
        for match in stored:
            for node in lookups.get(match.get("id") or "", []):
                full[id(node)] = match
    by_tournament: dict[str, list[tuple[int, dict]]] = {}
    for key, match in full.items():
        by_tournament.setdefault(str(match.get("tournament_id") or ""), []).append((key, match))
    tournament_ids = sorted(key for key in by_tournament if key)
    tournaments = {row["id"]: row for row in await db.tournaments.find(
        {"id": {"$in": tournament_ids}}, {"_id": 0, "id": 1, "league_context": 1}).to_list(len(tournament_ids) + 1)} if tournament_ids else {}
    for tournament_id, rows_ in by_tournament.items():
        tournament = tournaments.get(tournament_id)
        if not is_league_staffel(tournament):
            # Verfahren gibt es nur in Liga-Staffeln; alles andere wird einzeln geprüft (Helfer mit Einsatz je Spiel).
            for key, match in rows_:
                verdicts[key] = (await viewer_for(db, match, user)).lead
            continue
        if not await has_match_result_permission(user, rows_[0][1], capability=("results", "disputes")):
            continue
        involved = await involved_match_ids(db, user, tournament, [match for _key, match in rows_])
        for key, match in rows_:
            verdicts[key] = match.get("id") not in involved
    return verdicts


async def guard(db, payload, user: dict | None):
    """Für jede Antwort, die ein ganzes Spiel enthalten kann (Melden, Bestätigen, Check-in, Veto, Termin, Ergebnis, Wertung,
    Listen): Verfahren darin bleiben nur für die nicht befangene Leitung mit „Proteste“ oder „Ergebnisse“ ungekürzt. Sucht in jeder
    Tiefe nach Spielen mit Verfahren, die noch nicht gekürzt sind - ohne solche kostet der Aufruf keine Abfrage und ändert nichts.
    Im Zweifel (Knoten ohne erkennbares Spiel) wird gekürzt."""
    viewer_id = (user or {}).get("id")
    nodes = _nodes_to_cut(payload, viewer_id)
    if not nodes:
        return payload
    from services.match_public_view import without_procedure_details

    verdicts = await _lead_verdicts(db, nodes, user)
    cut = {key for key, lead in verdicts.items() if not lead}
    if not cut:
        return payload

    def rebuild(node, depth: int = 0):
        if not isinstance(node, (dict, list)):
            return node
        if depth > 400:
            # So tief verschachtelt ist keine Antwort der API - sicherheitshalber ohne den Teil statt ungeprüft.
            return None if _nodes_to_cut(node, viewer_id) else node
        if isinstance(node, list):
            return [rebuild(value, depth + 1) for value in node]
        out = {key: (value if key == "disputes" else rebuild(value, depth + 1)) for key, value in node.items()}
        return without_procedure_details(out, viewer_id) if id(node) in cut else out

    return rebuild(payload)


def export_view(payload, user_id: str):
    """Für die Auskunft nach DSGVO (``/api/dsgvo/export-my-data``): Die Person bekommt, was sie selbst betrifft - ihre eigene
    Meldung vollständig, ihre eigene Stellungnahme, ihre eigene MOSS-Anforderung. Von Verfahren anderer bleibt nur, dass es sie
    gibt; Anforderungen und Vermerke der Leitung zu Dritten stehen nie in ihrer Auskunft."""
    def own_requests(row: dict) -> list[dict]:
        return [dict(item) for item in row.get("moss_requests") or [] if isinstance(item, dict) and item.get("user_id") == user_id]

    def one(row: dict) -> dict:
        if not is_procedure(row):
            return row
        requests = own_requests(row)
        if row.get("user_id") == user_id:
            return {**row, "moss_requests": requests}
        out = {key: row.get(key) for key in ("at", "id", "kind", "state")}
        slot = row.get("statement") or {}
        if slot.get("user_id") == user_id:
            out["statement"] = {key: slot.get(key) for key in ("registration_id", "text", "at", "due_at")}
        if requests:
            out["moss_requests"] = requests
        return out

    def rebuild(node, depth: int = 0):
        if not isinstance(node, (dict, list)) or depth > 400:
            return node if not isinstance(node, (dict, list)) else None
        if isinstance(node, list):
            return [rebuild(value, depth + 1) for value in node]
        out = {key: (value if key == "disputes" else rebuild(value, depth + 1)) for key, value in node.items()}
        if isinstance(node.get("disputes"), list):
            out["disputes"] = [one(row) if isinstance(row, dict) else row for row in node["disputes"]]
        return out

    return rebuild(payload)


async def for_viewer_list(db, user: dict | None, matches: list[dict], involved: set[str]) -> list[dict]:
    """Die Spiele einer Staffel für eine Person mit Liga-Recht (Spielplan, Baum): Verfahren ungekürzt nur mit „Proteste“ oder
    „Ergebnisse“ und nur in Spielen, an denen sie nicht beteiligt ist. Das Recht gilt für die ganze Staffel - eine Prüfung reicht."""
    from services.match_public_view import without_procedure_details
    from services.tournament_permissions import has_match_result_permission

    probe = next((match for match in matches if rows(match)), None)
    if probe is None:
        return matches
    lead = bool(user) and await has_match_result_permission(user, probe, capability=("results", "disputes"))
    viewer_id = (user or {}).get("id")
    return [without_procedure_details(match, viewer_id) if rows(match) and (not lead or match.get("id") in involved) else match
            for match in matches]


def _moss_view(row: dict, viewer: Viewer, names: dict) -> list[dict]:
    out = []
    for item in row.get("moss_requests") or []:
        # Wie die Datei selbst (Nr. 137): die Person, Captain und Vertreter ihrer Seite, die nicht befangene Leitung.
        for_side = len(viewer.acting) == 1 and item.get("registration_id") in viewer.acting
        if not (viewer.lead or for_side or item.get("user_id") == viewer.user_id):
            continue
        out.append({"id": item.get("id"), "user_id": item.get("user_id"), "name": names.get(item.get("user_id")) or "Spieler",
                    "side": item.get("registration_id"), "at": item.get("at"), "due_at": item.get("due_at"), "state": item.get("state"),
                    "own": item.get("user_id") == viewer.user_id,
                    **({"excuse_reason": item.get("excuse_reason")} if viewer.lead and item.get("excuse_reason") else {})})
    return out


def view(row: dict, match: dict, viewer: Viewer, league: League, names: dict, now: datetime) -> dict | None:
    """Ein Verfahren, wie diese Person es sieht - ``None``: gar nicht."""
    own = bool(row.get("registration_id")) and row["registration_id"] in viewer.sides
    acting_own = bool(row.get("registration_id")) and row["registration_id"] in viewer.acting
    slot = row.get("statement") or {}
    opponent = bool(slot.get("registration_id")) and slot["registration_id"] in viewer.sides
    acting_opponent = bool(slot.get("registration_id")) and slot["registration_id"] in viewer.acting
    if not (own or opponent or viewer.lead or viewer.sides):
        return None
    state = state_of(row)
    is_open = state == OPEN
    evidence_until, due = refs.parse(row.get("evidence_until")), refs.parse(slot.get("due_at"))
    full = own or viewer.lead
    out = {
        "id": row["id"], "kind": row["kind"], "kind_label": KIND_LABELS[row["kind"]], "state": state, "at": row.get("at"),
        "side": row.get("registration_id"), "own": own, "opponent": opponent,
        "reason_key": row.get("reason_key"), "reason_label": protest_settings.reason_label(league.settings, row.get("reason_key")),
        "reason": row.get("reason"),
        "additions": [{"text": item.get("text"), "at": item.get("at")} for item in row.get("additions") or []],
        "evidence_until": row.get("evidence_until"), "incident_id": row.get("incident_id"),
        "statement": ({"side": slot.get("registration_id"), "due_at": slot.get("due_at"), "extended": bool(slot.get("extended_by")),
                       "text": slot.get("text"), "at": slot.get("at"), "expired": bool(due and now > due and not slot.get("text"))}
                      if slot.get("registration_id") else None),
        "assignee": ({"name": names.get(row["assignee"].get("user_id")) or "Liga-Leitung", "at": row["assignee"].get("at"),
                      "own": row["assignee"].get("user_id") == viewer.user_id} if row.get("assignee") else None),
        "target_at": row.get("target_at"),
        "decision": row.get("decision"), "decision_note": row.get("decision_note"), "resolved_at": row.get("resolved_at"),
        "withdrawn_at": row.get("withdrawn_at"), "appeal_until": row.get("appeal_until"),
        "against": ({"type": row["against"].get("type"), "ref_id": row["against"].get("ref_id")} if row.get("against") else None),
        "contested_mode": row.get("contested_mode"),
        "moss_requests": _moss_view(row, viewer, names),
        "can_amend": is_open and acting_own and not (evidence_until and now > evidence_until),
        "can_withdraw": is_open and (acting_own or (not row.get("registration_id") and row.get("user_id") == viewer.user_id)),
        "can_state": is_open and acting_opponent and not (due and now > due),
        "can_lead": is_open and (viewer.can_decide or viewer.override) and decided_by(row) != viewer.user_id,
        "own_decision": is_open and (viewer.can_decide or viewer.override) and decided_by(row) == viewer.user_id,
        "can_appeal": (state == DECIDED and row["kind"] != APPEAL and bool(viewer.acting)
                       and bool(refs.parse(row.get("appeal_until")) and now < refs.parse(row["appeal_until"]))
                       and not any(other["kind"] == APPEAL and (other.get("against") or {}).get("ref_id") == row["id"] for other in rows(match))),
    }
    # Das abweichende Ergebnis sehen beide Seiten und die Leitung (Entscheidung Fabian 12.11.): Die Stellungnahme braucht den Bezug.
    out["claimed"] = row.get("claimed")
    if full:
        # Nur die eigene Seite und die Leitung: die Antwort auf „sofort hingewiesen?“.
        out["notified_immediately"] = row.get("notified_immediately")
    if viewer.lead:
        out.update({"submitted_by": names.get(row.get("user_id")), "resolved_by": names.get(row.get("resolved_by")),
                    "escalated_at": row.get("escalated_at"), "reminded_at": row.get("reminded_at")})
    return out


async def _names(db, match: dict) -> dict[str, str]:
    ids: set[str] = set()
    for row in rows(match):
        ids.update(filter(None, (row.get("user_id"), row.get("resolved_by"), (row.get("assignee") or {}).get("user_id"))))
        ids.update(item.get("user_id") for item in row.get("moss_requests") or [] if item.get("user_id"))
    if not ids:
        return {}
    people = await db.users.find({"id": {"$in": sorted(ids)}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1}).to_list(len(ids))
    return {row["id"]: row.get("display_name") or row.get("username") or "Mitglied" for row in people}


async def page_block(db, match: dict, league: League, user: dict | None, *, now: datetime | None = None,
                     viewer: Viewer | None = None) -> dict:
    """Der Teil ``procedures``/``contested`` im Block ``league`` der Matchseite. Öffentlich nur „in Klärung“."""
    now = now or now_utc()
    viewer = viewer or await viewer_for(db, match, user)
    names = await _names(db, match) if (viewer.sides or viewer.lead) else {}
    shown = [item for item in (view(row, match, viewer, league, names, now) for row in rows(match)) if item]
    found = await window(db, match, league, now)
    in_clarification = contested(match) or (str(match.get("status") or "") == "disputed" and has_open(match))
    appealable = None
    if viewer.acting and str(match.get("status") or "") in DECIDED_STATUSES:
        meta = match.get("result_meta") or {}
        kind = "forfeit" if match.get("status") == "forfeit" else "correction" if meta.get("correction_reason") else None
        decided = decided_at(match)
        until = _hours(league, decided, league.settings["appeal_hours"]) if kind and decided else None
        taken = any(row["kind"] == APPEAL and (row.get("against") or {}).get("type") == kind
                    and (row.get("against") or {}).get("decided_at") == _iso(decided) for row in rows(match))
        # Kam die Korrektur als Entscheidung eines Verfahrens, richtet sich der Einspruch gegen diese Entscheidung (Karte des Verfahrens).
        by_procedure = kind == "correction" and any(
            row["kind"] != APPEAL and state_of(row) == DECIDED and row.get("decision") == "change"
            and (refs.parse(row.get("resolved_at")) or now) >= decided for row in rows(match))
        if until and now < until and not taken and not by_procedure:
            appealable = {"type": kind, "ref_id": match["id"], "until": until.isoformat()}
    players: list[dict] = []
    if (viewer.can_decide or viewer.override) and open_rows(match):
        # Für „MOSS-Datei anfordern“: die Spieler beider Seiten - nur für die Leitung, die entscheiden darf.
        from services.match_audience import player_ids, registrations_for_match, teams_by_id

        registrations = await registrations_for_match(db, match)
        teams = await teams_by_id(db, registrations)
        by_side = {reg["id"]: sorted(player_ids(reg, teams.get(reg.get("team_id") or ""))) for reg in registrations if reg.get("id")}
        wanted = sorted({user_id for ids in by_side.values() for user_id in ids})
        people = await db.users.find({"id": {"$in": wanted}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1}).to_list(len(wanted) + 1)
        known = {row["id"]: row.get("display_name") or row.get("username") or "Spieler" for row in people}
        players = [{"id": user_id, "name": known.get(user_id) or "Spieler", "side": side} for side, ids in by_side.items() for user_id in ids]
    return {
        "procedures": shown,
        "contested": in_clarification,
        "moss_candidates": players,
        "procedure_form": ({
            "kind": found["kind"], "kind_label": KIND_LABELS.get(found["kind"] or "", ""), "until": found["until"],
            "open": bool(found["open"]) and not any(row.get("registration_id") in viewer.acting for row in open_rows(match) if row["kind"] != APPEAL),
            "reasons": league.settings["protest_reasons"], "result_reason": protest_settings.RESULT_REASON,
            "reason_min": REASON_MIN, "reason_max": REASON_MAX,
            "incidents": [{"id": row.get("id"), "position": row.get("position"), "kind": row.get("kind")}
                          for row in match.get("incidents") or [] if isinstance(row, dict) and row.get("id")],
            "appealable": appealable,
        } if viewer.acting else None),
        "procedure_viewer": {"lead": viewer.lead, "can_decide": viewer.can_decide, "override": viewer.override},
    }
