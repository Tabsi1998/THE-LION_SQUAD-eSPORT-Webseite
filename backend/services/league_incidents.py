"""Vorfälle im Spiel einer Liga-Staffel (docs/LIGA.md, „D.5/E.2-Vertrag“ → „Vorfälle“, #1619; Regelwerk § 9, Anlage C).

Eine Seite meldet einen Vorfall (Disconnect, Rehost, technische Pause, MOSS-Absturz …) mit einem Vorschlag, die Gegenseite stimmt
zu oder lehnt ab; ohne Einigung - oder ohne Antwort bis ``answer_deadline`` - entscheidet die Liga-Leitung (Nr. 24, 131).

- Gespeichert in ``matches_v2.incidents[]``. Der Stand einer Map („in Klärung“, „wiederholt“) ist **abgeleitet** (``map_states``),
  es gibt kein zweites Feld. ``incident_due_at`` am Spiel ist nur der Zeiger für den Zeit-Job (früheste offene Antwortfrist).
- **Kein Ergebnis wird gültig**, solange ein Vorfall offen ist oder die Leitung die Serie nach ihrer Entscheidung noch nicht
  festgestellt hat (``result_block``): Melden bleibt möglich, Bestätigen und die Frist-Automatik ruhen (Nr. 132).
- **Keine Map zählt doppelt** (§ 9.4): ``finalize`` setzt beim gültigen Ergebnis ``status: "replayed"`` und ``incident_id`` an die
  geltende Map; die ungültige Erstaustragung steht nur in ``incidents[].voided``. Zugesprochene Maps und Maps, die nach der
  Entscheidung nicht zählen (Nr. 138), rechnet dieselbe Stelle ein.
- **Kontingent** (§ 9.6): gezählt und angezeigt, nie erzwungen.

Geschrieben wird immer die ganze Liste mit Bedingung auf den gelesenen Stand; die Routen halten dazu die Schreibsperre des Turniers.
Die Regeln ohne Datenbank stehen in ``league_incident_rules`` (Blatt-Modul); schwere Module (Rechte, Nachrichten) werden erst in den
Funktionen geladen.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from models import new_id, now_utc
from services.checkin_rules import clock_text, moment
# Die Regeln ohne Datenbank stehen im Blatt-Modul (kein Import-Kreis über match_deadlines und die Nachrichten) - hier bleiben
# sie unter denselben Namen erreichbar.
from services.league_incident_rules import (  # noqa: F401 - weiterhin über league_incidents erreichbar
    AGREED, ANSWERED_DETAIL, AWARDED, CHANGED_DETAIL, CONTINUE, DECIDED, DECIDED_DETAIL, EXPIRED, FINAL_STATUSES,
    IN_REVIEW, IncidentProblem, KINDS, KIND_LABELS, LATE_DETAIL, LEAD_ONLY_DETAIL, MAX_PAUSE_MINUTES, MAX_PER_MATCH,
    MAX_PLAYERS, MAX_ROUND, MAX_SCORE, NOTE_MAX, NOT_A_SIDE_DETAIL, NOT_FINALIZABLE_DETAIL, NOT_FOUND_DETAIL,
    NO_ACTION, OUTCOMES, OUTCOME_LABELS, PROPOSALS, PROPOSAL_LABELS, PROPOSED, QUOTA_KINDS, REASON_MAX, REASON_MIN,
    REHOST, REJECTED, REPLAY, REPLAY_REASON_MAX, RESTART, VOIDING, WITHDRAWN, _effects, _replay_reason,
    OPEN_HOLD_CODES, REPLAY_FIRST_DETAIL, awaits_replay, confirm_clock, counts_quota, current_reports, due_at, export_steps, final_games, find, incidents_of,
    is_open, map_states, mark_replays, missing_positions, outcome_of, position_of, positions_in_clarification, quota_used,
    replay_cutoff, replay_pending, replay_text, report_refusal, result_block, scrub, setting_of, state_of, surplus_positions,
)
from services.league_presets import INCIDENT_FIELDS
from services.log_safe import log_safe
from services.match_proof_refs import CLOSED_STATUSES

logger = logging.getLogger("tls.league_incidents")


# ---------------------------------------------------------------- Einstellungen

async def settings_for(db, tournament: dict | None) -> dict:
    """Die fünf Werte der Gruppe ``incidents`` für diese Staffel. Die Season wird nur gelesen, wenn der Staffel ein Feld fehlt."""
    season = None
    if any((tournament or {}).get(key) is None for key in INCIDENT_FIELDS):
        season_id = ((tournament or {}).get("league_context") or {}).get("season_id")
        if season_id:
            season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0, **{key: 1 for key in INCIDENT_FIELDS}})
    return {key: setting_of(tournament, season, key) for key in INCIDENT_FIELDS}


# ---------------------------------------------------------------- Das gültige Ergebnis

def _same_series(first: list[dict], second: list[dict]) -> bool:
    def key(games):
        return [(int(game.get("position") or 0), game.get("winner_registration_id")) for game in games]

    return key(first) == key(second)


async def finalize(db, match: dict, games: list[dict] | None, results: list[dict]) -> tuple[list[dict] | None, list[dict]]:
    """Maps und Ergebnis, wie sie gültig werden (Bestätigung, Frist-Automatik, Feststellung). Ohne Vorfall mit Wirkung bleibt alles,
    wie es gemeldet wurde; ändert eine Entscheidung Sieger oder Zahl der Maps, folgt das Ergebnis den Maps."""
    replays, awards = _effects(match)
    if not games or not (replays or awards or surplus_positions(match)):
        return games, results
    from services.match_v2_results import result_best_of

    sides = [slot["registration_id"] for slot in match.get("slots") or [] if isinstance(slot, dict) and slot.get("registration_id")]
    final = final_games(match, games, sides=sides, needed=int(await result_best_of(db, match)) // 2 + 1)
    if _same_series(final, sorted(games, key=lambda row: int(row.get("position") or 0))):
        return final, results
    wins = {side: 0 for side in sides}
    for game in final:
        wins[game["winner_registration_id"]] += 1
    ordered = sorted(wins.items(), key=lambda pair: -pair[1])
    return final, [{"registration_id": side, "rank": index + 1, "score": count} for index, (side, count) in enumerate(ordered)]


# ---------------------------------------------------------------- Eingaben prüfen

def _text(value, maximum: int) -> str:
    text = " ".join(str(value or "").split())
    if len(text) > maximum:
        raise IncidentProblem(f"Der Text ist zu lang (höchstens {maximum} Zeichen).")
    return text


def _reason(value, what: str = "eine Begründung") -> str:
    text = _text(value, REASON_MAX)
    if len(text) < REASON_MIN:
        raise IncidentProblem(f"Bitte {what} angeben (mindestens fünf Zeichen).")
    return text


def _position(value, best_of: int) -> int:
    try:
        position = int(value)
    except (TypeError, ValueError):
        position = 0
    if not 1 <= position <= int(best_of or 1):
        raise IncidentProblem(f"Bitte die Map wählen (1 bis {int(best_of or 1)}).")
    return position


def _score(raw, sides: list[str]) -> dict | None:
    if raw is None or raw == {}:
        return None
    if not isinstance(raw, dict) or set(raw) != set(sides):
        raise IncidentProblem("Bitte den Stand beider Seiten beim Vorfall angeben – oder beide Felder leer lassen.")
    out = {}
    for side, value in raw.items():
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= MAX_SCORE:
            raise IncidentProblem("Der Stand beim Vorfall ist je Seite eine ganze Zahl ab 0.")
        out[side] = value
    return out


def _positions(raw, best_of: int, what: str) -> list[int]:
    items = raw or []
    if not isinstance(items, list) or any(isinstance(item, bool) or not isinstance(item, int) for item in items):
        raise IncidentProblem(f"{what}: bitte Map-Positionen als Zahlen angeben.")
    if any(not 1 <= item <= int(best_of or 1) for item in items) or len(set(items)) != len(items):
        raise IncidentProblem(f"{what}: jede Position höchstens einmal, zwischen 1 und {int(best_of or 1)}.")
    return sorted(items)


def _map_at(match: dict, position: int) -> dict:
    """Modus und Map dieser Position: aus dem Veto, sonst aus der letzten Meldung, die sie nennt."""
    for row in match.get("planned_games") or []:
        if isinstance(row, dict) and int(row.get("position") or 0) == position:
            return {"mode": row.get("mode"), "map_id": row.get("map_id")}
    for report in reversed(match.get("reports") or []):
        for game in (report or {}).get("games") or []:
            if int(game.get("position") or 0) == position:
                return {"mode": game.get("mode"), "map_id": game.get("map_id")}
    return {"mode": None, "map_id": None}


def _voided(match: dict, entry: dict, now_iso: str) -> dict:
    return {**_map_at(match, position_of(entry)), "score": entry.get("score"), "round": entry.get("round"), "at": now_iso}


# ---------------------------------------------------------------- Schreiben

async def _store(db, match: dict, incidents: list[dict], *, user_ids=()) -> dict:
    """Die ganze Liste mit Bedingung auf den gelesenen Stand - ein Schreiber, der inzwischen etwas geändert hat, gewinnt nicht still."""
    now_iso = now_utc().isoformat()
    change: dict = {"$set": {"incidents": incidents, "incident_due_at": due_at(incidents), "updated_at": now_iso}}
    people = sorted({user_id for user_id in user_ids if user_id})
    if people:
        # Derselbe Zeiger wie Check-in und Veto: Auskunft und Kontolöschung finden das Spiel über ``flow.user_ids``.
        change["$addToSet"] = {"flow.user_ids": {"$each": people}}
    written = await db.matches_v2.update_one({"id": match["id"], "incidents": match.get("incidents")}, change)
    if not written.matched_count:
        raise IncidentProblem(CHANGED_DETAIL, 409)
    return {**match, "incidents": incidents, "incident_due_at": due_at(incidents)}


async def _audit(db, action: str, match: dict, actor_id: str | None, entry: dict, **data) -> None:
    """Protokoll ohne freien Text: Kennung, Map, Art, Stand - nie Beschreibung, Begründung oder Namen."""
    await db.audit_logs.insert_one({
        "id": new_id(), "action": action, "target_id": match.get("tournament_id"), "actor_id": actor_id,
        "data": {"match_id": match.get("id"), "stage_id": match.get("stage_id"), "match_key": match.get("match_key"),
                 "incident_id": entry.get("id"), "position": entry.get("position"), "kind": entry.get("kind"),
                 "state": entry.get("state"), **data},
        "created_at": now_utc().isoformat(),
    })


async def _tell(db, match: dict, registration_ids, title: str, text: str, event: str, entry: dict, *, skip: str | None = None,
                lead: bool = False) -> int:
    """Nachricht an die Verantwortlichen der genannten Seiten und - mit ``lead`` - an die Liga-Leitung mit „Ergebnisse“ oder
    „Proteste“, die an dem Spiel nicht beteiligt ist. Je Vorfall und Ereignis einmal (``incident:<id>:<ereignis>``); eine Nachricht hält
    den Schritt nie auf."""
    from services.match_audience import registrations_for_match, responsible_user_ids
    from services.match_notifications import match_title
    from services.user_notifications import create_user_notification

    try:
        registrations = await registrations_for_match(db, match)
        recipients = await responsible_user_ids(db, [reg for reg in registrations if reg.get("id") in set(registration_ids or [])])
        tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "title": 1, "league_context": 1}) or {}
        if lead:
            from services.league_permissions import involved_user_ids, staff_user_ids

            staff = await staff_user_ids(db, (tournament.get("league_context") or {}).get("league_id"), ("results", "disputes"))
            recipients |= staff - await involved_user_ids(db, match)
        body = f"{tournament.get('title') or 'Liga'} · {match_title(match, {reg['id']: reg for reg in registrations if reg.get('id')})}: {text}"
        sent = 0
        for user_id in sorted(recipients - {skip}):
            if await create_user_notification(
                user_id, title, body, url=f"/matches/{match.get('id')}", kind="match_attention",
                meta={"category": "match_reminders", "match_id": match.get("id"), "tournament_id": match.get("tournament_id"),
                      "reason": f"incident_{event}", "dedupe_key": f"incident:{entry.get('id')}:{event}"},
            ):
                sent += 1
        return sent
    except Exception:  # noqa: BLE001 - der Schritt ist schon gespeichert
        logger.warning("[league_incidents] Nachricht zu Spiel %s nicht verschickt", log_safe(match.get("id")), exc_info=True)
        return 0


def _sides(match: dict) -> list[str]:
    return [slot["registration_id"] for slot in match.get("slots") or [] if isinstance(slot, dict) and slot.get("registration_id")]


async def report(db, match: dict, setup, settings: dict, *, user: dict, registration_id: str | None, body: dict,
                 now: datetime | None = None) -> dict:
    """Einen Vorfall melden. ``registration_id``: die Seite, für die die Person handelt - ``None``: die Liga-Leitung (ihr Vorfall
    geht ohne Antwort der Seiten sofort in Klärung). ``setup``: ``league_games.LeagueSetup``. Gibt den neuen Eintrag zurück."""
    status = str(match.get("status") or "")
    if status in FINAL_STATUSES or status in CLOSED_STATUSES:
        raise IncidentProblem(DECIDED_DETAIL, 409)
    if isinstance(match.get("pending_result"), dict):
        raise IncidentProblem("Die Liga-Leitung trägt gerade das Ergebnis ein.", 409)
    sides = setup.reg_ids
    if len(sides) < 2:
        raise IncidentProblem("Das Spiel hat noch keine zwei Seiten.", 409)
    if registration_id is not None and registration_id not in sides:
        raise IncidentProblem("Diese Seite spielt in diesem Spiel nicht.", 404)
    kind = str(body.get("kind") or "").strip()
    if kind not in KINDS:
        raise IncidentProblem("Bitte wählen, was passiert ist.")
    position = _position(body.get("position"), setup.best_of)
    between_maps = bool(body.get("between_maps"))
    if between_maps and kind != "pause":
        raise IncidentProblem("„Zwischen den Maps“ gibt es nur bei einer Pause.")
    before = incidents_of(match)
    if len(before) >= MAX_PER_MATCH:
        raise IncidentProblem("Zu diesem Spiel sind schon sehr viele Vorfälle gemeldet – bitte die Liga-Leitung im Matchchat fragen.", 409)
    if not between_maps and any(is_open(row) and position_of(row) == position for row in before):
        raise IncidentProblem(f"Zu Map {position} läuft schon ein Vorfall – bitte erst diesen abschließen.", 409)
    note = _text(body.get("note"), NOTE_MAX)
    if kind == "other" and len(note) < REASON_MIN:
        raise IncidentProblem("Bitte kurz beschreiben, was passiert ist (mindestens fünf Zeichen).")
    now = now or now_utc()
    now_iso = now.isoformat()
    entry: dict = {
        "id": new_id(), "position": position, "kind": kind, "between_maps": between_maps,
        "reported_by": {"registration_id": registration_id, "user_id": user.get("id")}, "at": now_iso,
        "score": None, "note": note, "proposal": None, "state": PROPOSED, "answer_deadline": now_iso, "answer": None,
        "review_cause": None, "counts_quota": counts_quota(kind, between_maps), "decision": None, "voided": None, "closed_at": None,
    }
    people = [user.get("id")]
    if between_maps:
        # Die Map-Pause nach Anlage C.3 wird nur dokumentiert: ohne Vorschlag, Antwort und Kontingent.
        minutes = body.get("minutes")
        if isinstance(minutes, bool) or not isinstance(minutes, int) or not 0 <= minutes <= MAX_PAUSE_MINUTES:
            raise IncidentProblem(f"Bitte die Länge der Pause in Minuten angeben (0 bis {MAX_PAUSE_MINUTES}).")
        entry.update(minutes=minutes, state=AGREED, closed_at=now_iso)
    else:
        proposal = str(body.get("proposal") or "").strip()
        if proposal not in PROPOSALS:
            raise IncidentProblem("Bitte einen Vorschlag wählen, wie es weitergeht.")
        entry.update(proposal=proposal, score=_score(body.get("score"), sides))
        if body.get("round") is not None:
            number = body.get("round")
            if isinstance(number, bool) or not isinstance(number, int) or not 0 <= number <= MAX_ROUND:
                raise IncidentProblem("Die Runde beim Vorfall ist eine ganze Zahl ab 0.")
            entry["round"] = number
        players = [str(item) for item in body.get("players") or [] if str(item or "").strip()]
        if players:
            roster = set().union(*setup.rosters.values()) if setup.rosters else set()
            if len(players) > MAX_PLAYERS or len(set(players)) != len(players) or any(item not in roster for item in players):
                raise IncidentProblem("Betroffene Personen wählst du aus den Kadern der beiden Seiten, jede höchstens einmal.")
            entry["players"] = players
            people.extend(players)
        if registration_id is None:
            # Die Leitung meldet selbst: Es gibt keine Gegenseite, die antworten müsste - die Map ist sofort in Klärung.
            entry.update(state=IN_REVIEW)
        else:
            entry["answer_deadline"] = (now + timedelta(minutes=int(settings["incident_answer_minutes"]))).isoformat()
    stored = await _store(db, match, [*before, entry], user_ids=people)
    await _audit(db, "match.incident.report", match, user.get("id"), entry, proposal=entry.get("proposal"),
                 by_lead=registration_id is None, between_maps=between_maps)
    where = f"Map {position}"
    label = KIND_LABELS[kind]
    if between_maps:
        return entry
    if registration_id is None:
        await _tell(db, stored, sides, "Map in Klärung",
                    f"Die Liga-Leitung hat zu {where} einen Vorfall aufgenommen („{label}“) und entscheidet. Bis dahin gilt kein Ergebnis.",
                    "review", entry, skip=user.get("id"))
        return entry
    others = [side for side in sides if side != registration_id]
    await _tell(db, stored, others, "Vorfall gemeldet – bitte antworten",
                f"{setup.names.get(registration_id, 'Die Gegenseite')} meldet zu {where} „{label}“ und schlägt vor: "
                f"{PROPOSAL_LABELS[entry['proposal']]}. Bitte bis {clock_text(entry['answer_deadline'])} zustimmen oder ablehnen – "
                "sonst entscheidet die Liga-Leitung.",
                "reported", entry, skip=user.get("id"))
    return entry


def _replace(incidents: list[dict], entry: dict) -> list[dict]:
    return [entry if row.get("id") == entry.get("id") else row for row in incidents]


async def answer(db, match: dict, setup, incident_id: str, *, user: dict, registration_id: str, accept: bool, note=None,
                 now: datetime | None = None) -> dict:
    """Die Gegenseite stimmt zu (``agreed``) oder lehnt ab - dann geht der Vorfall im selben Schritt an die Leitung (``in_review``)."""
    entry = find(match, incident_id)
    now = now or now_utc()
    reporter = (entry.get("reported_by") or {}).get("registration_id")
    if state_of(entry) != PROPOSED:
        raise IncidentProblem(ANSWERED_DETAIL, 409)
    if registration_id not in setup.reg_ids or registration_id == reporter:
        raise IncidentProblem("Auf einen Vorfall antwortet die Gegenseite – Captain oder Vertreter.", 403)
    deadline = moment(entry.get("answer_deadline"))
    if deadline and now > deadline:
        await expire_due(db, match, now=now)
        raise IncidentProblem(LATE_DETAIL, 409)
    now_iso = now.isoformat()
    changed = {**entry, "answer": {"registration_id": registration_id, "user_id": user.get("id"), "at": now_iso,
                                   "note": _text(note, NOTE_MAX)}}
    if accept:
        changed.update(state=AGREED, closed_at=now_iso)
        if entry.get("proposal") in VOIDING:
            changed["voided"] = _voided(match, entry, now_iso)
    else:
        changed.update(state=IN_REVIEW, review_cause=REJECTED)
    stored = await _store(db, match, _replace(incidents_of(match), changed), user_ids=[user.get("id")])
    await _audit(db, "match.incident.answer", match, user.get("id"), changed, accepted=accept)
    side = setup.names.get(registration_id, "Die Gegenseite")
    where = f"Map {position_of(entry)}"
    if accept:
        # Neustart oder Wiederholung: Frühere Meldungen zählen nicht mehr - das steht gleich in der Nachricht.
        again = f" {replay_text(changed)}" if changed.get("voided") else ""
        await _tell(db, stored, [reporter], "Vorfall: Einigung",
                    f"{side} stimmt eurem Vorschlag zu {where} zu: {PROPOSAL_LABELS.get(entry.get('proposal'), 'Vorschlag')}.{again}",
                    "answered", changed, skip=user.get("id"))
    else:
        await _tell_review(db, stored, changed, f"{side} hat den Vorschlag zu {where} abgelehnt.", skip=user.get("id"))
    return changed


async def _tell_review(db, match: dict, entry: dict, lead_in: str, *, skip: str | None = None) -> None:
    where = f"Map {position_of(entry)}"
    await _tell(db, match, _sides(match), "Map in Klärung",
                f"{lead_in} {where} ist jetzt in Klärung – die Liga-Leitung entscheidet. Bis dahin gilt kein Ergebnis; Nachweise könnt "
                "ihr auf der Matchseite ergänzen.", "review", entry, skip=skip, lead=True)


async def withdraw(db, match: dict, setup, incident_id: str, *, user: dict, registration_id: str) -> dict:
    """Die meldende Seite zieht zurück - nur solange niemand geantwortet hat."""
    entry = find(match, incident_id)
    if state_of(entry) != PROPOSED:
        raise IncidentProblem("Zurückziehen geht nur, solange die Gegenseite noch nicht geantwortet hat.", 409)
    if registration_id != (entry.get("reported_by") or {}).get("registration_id"):
        raise IncidentProblem("Zurückziehen kann nur die Seite, die den Vorfall gemeldet hat.", 403)
    changed = {**entry, "state": WITHDRAWN, "closed_at": now_utc().isoformat()}
    stored = await _store(db, match, _replace(incidents_of(match), changed), user_ids=[user.get("id")])
    await _audit(db, "match.incident.withdraw", match, user.get("id"), changed)
    others = [side for side in setup.reg_ids if side != registration_id]
    await _tell(db, stored, others, "Vorfall zurückgezogen",
                f"{setup.names.get(registration_id, 'Die Gegenseite')} hat den Vorfall zu Map {position_of(entry)} zurückgezogen. "
                "Ihr müsst nichts mehr tun.", "withdrawn", changed, skip=user.get("id"))
    return changed


def _settle_fields(setup, raw: dict, *, user: dict, now_iso: str) -> dict:
    missing = _positions(raw.get("missing_positions"), setup.best_of, "Fehlende Maps")
    surplus = _positions(raw.get("surplus_positions"), setup.best_of, "Überzählige Maps")
    if set(missing) & set(surplus):
        raise IncidentProblem("Eine Map kann nicht zugleich fehlen und überzählig sein.")
    return {"missing_positions": missing, "surplus_positions": surplus, "settled_at": now_iso, "settled_by": user.get("id"),
            "settle_reason": _reason(raw.get("reason"), "eine Begründung für die Feststellung der Serie")}


async def decide(db, match: dict, setup, incident_id: str, *, user: dict, outcome: str, registration_id: str | None, reason,
                 conflict_reason: str | None = None, settle: dict | None = None, now: datetime | None = None) -> dict:
    """Die Entscheidung der Leitung (``in_review`` → ``decided``). ``settle``: die Serie gleich feststellen, wenn nichts mehr zu
    spielen ist. Recht und Befangenheit prüft die Route."""
    entry = find(match, incident_id)
    if state_of(entry) != IN_REVIEW:
        raise IncidentProblem("Entschieden wird ein Vorfall, wenn er bei der Liga-Leitung liegt (in Klärung).", 409)
    outcome = str(outcome or "").strip()
    if outcome not in OUTCOMES:
        raise IncidentProblem("Bitte wählen, wie entschieden wird.")
    awarded_to = str(registration_id or "").strip() or None
    if outcome == AWARDED and awarded_to not in setup.reg_ids:
        raise IncidentProblem("Bitte die Seite wählen, der die Map zugesprochen wird.")
    if outcome != AWARDED:
        awarded_to = None
    text = _reason(reason)
    now_iso = (now or now_utc()).isoformat()
    decision = {"outcome": outcome, "registration_id": awarded_to, "reason": text, "by": user.get("id"), "at": now_iso,
                "conflict_reason": (conflict_reason or "").strip() or None, "missing_positions": [], "surplus_positions": [],
                "settled_at": None, "settled_by": None, "settle_reason": None}
    if settle is not None:
        if outcome in VOIDING:
            raise IncidentProblem("Nach „Neustart“ oder „Wiederholung“ wird die Map erst gespielt – die Serie stellst du danach fest.")
        decision.update(_settle_fields(setup, {**settle, "reason": settle.get("reason") or text}, user=user, now_iso=now_iso))
    changed = {**entry, "state": DECIDED, "decision": decision, "closed_at": now_iso}
    if outcome in VOIDING:
        changed["voided"] = _voided(match, entry, now_iso)
    stored = await _store(db, match, _replace(incidents_of(match), changed), user_ids=[user.get("id")])
    await _audit(db, "match.incident.decide", match, user.get("id"), changed, outcome=outcome, settled=settle is not None,
                 **({"awarded_to": awarded_to} if awarded_to else {}))
    extra = f" ({setup.names.get(awarded_to, 'Seite')})" if awarded_to else ""
    again = f" {replay_text(changed)}" if outcome in VOIDING else ""
    await _tell(db, stored, setup.reg_ids, "Vorfall entschieden",
                f"Die Liga-Leitung hat zu Map {position_of(entry)} entschieden: {OUTCOME_LABELS[outcome]}{extra}.{again} Die Begründung "
                "steht auf der Matchseite.", "decided", changed, skip=user.get("id"))
    return changed


async def settle(db, match: dict, setup, incident_id: str, *, user: dict, body: dict, now: datetime | None = None) -> dict:
    """„Serie feststellen“ (zweiter Schritt der Leitung): fehlende und überzählige Maps mit Begründung. Wiederholbar, solange das
    Ergebnis nicht gilt - etwa nachdem eine fehlende Map gespielt ist."""
    entry = find(match, incident_id)
    if state_of(entry) != DECIDED:
        raise IncidentProblem("Die Serie stellst du fest, nachdem über den Vorfall entschieden ist.", 409)
    if str(match.get("status") or "") in FINAL_STATUSES:
        raise IncidentProblem("Das Ergebnis des Spiels steht schon fest.", 409)
    if awaits_replay(match, entry):
        raise IncidentProblem(REPLAY_FIRST_DETAIL.format(position=position_of(entry)), 409)
    now_iso = (now or now_utc()).isoformat()
    fields = _settle_fields(setup, body, user=user, now_iso=now_iso)
    changed = {**entry, "decision": {**(entry.get("decision") or {}), **fields}}
    stored = await _store(db, match, _replace(incidents_of(match), changed), user_ids=[user.get("id")])
    await _audit(db, "match.incident.settle", match, user.get("id"), changed, missing_positions=fields["missing_positions"],
                 surplus_positions=fields["surplus_positions"])
    if fields["missing_positions"]:
        maps = ", ".join(str(item) for item in fields["missing_positions"])
        text = f"Die Liga-Leitung hat die Serie festgestellt: Es fehlt noch Map {maps}. Den Termin setzt die Liga-Leitung an."
    elif fields["surplus_positions"]:
        maps = ", ".join(str(item) for item in fields["surplus_positions"])
        text = f"Die Liga-Leitung hat die Serie festgestellt: Map {maps} zählt nicht. Das Ergebnis kann jetzt bestätigt werden."
    else:
        text = "Die Liga-Leitung hat die Serie festgestellt. Das Ergebnis kann jetzt bestätigt werden."
    await _tell(db, stored, setup.reg_ids, "Serie festgestellt", text, f"settled:{now_iso}", changed, skip=user.get("id"))
    return changed


# ---------------------------------------------------------------- Zeit-Job

async def expire_due(db, match: dict, *, now: datetime | None = None) -> int:
    """Antwortfrist abgelaufen: ``proposed`` → ``in_review`` (``review_cause: expired``) im selben Schritt. Ein zweiter Lauf findet
    nichts mehr; die Nachricht trägt je Vorfall einen festen Schlüssel."""
    now = now or now_utc()
    incidents = incidents_of(match)
    due = [row for row in incidents if state_of(row) == PROPOSED and (moment(row.get("answer_deadline")) or now) <= now]
    if not due:
        return 0
    changed = [{**row, "state": IN_REVIEW, "review_cause": EXPIRED} for row in due]
    by_id = {row["id"]: row for row in changed}
    stored = await _store(db, match, [by_id.get(row.get("id"), row) for row in incidents])
    for entry in changed:
        await _audit(db, "match.incident.expire", match, None, entry)
        await _tell_review(db, stored, entry, "Die Gegenseite hat auf den Vorfall nicht rechtzeitig geantwortet.")
    return len(changed)


async def sweep(db, tournaments: list[dict] | None = None, *, now: datetime | None = None) -> dict:
    """Ein Lauf des Zeit-Jobs (im Fristen-Job ``match_deadlines``): alle Spiele mit erreichter Antwortfrist - mit ``tournaments`` nur
    die dieser Turniere. Geschrieben wird unter der Turniersperre."""
    from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource

    now = now or now_utc()
    query: dict = {"incident_due_at": {"$lte": now.isoformat()}}
    if tournaments is not None:
        ids = [row.get("id") for row in tournaments if row.get("id")]
        if not ids:
            return {"expired": 0}
        query["tournament_id"] = {"$in": ids}
    rows = await db.matches_v2.find(query, {"_id": 0, "id": 1, "tournament_id": 1}).to_list(500)
    expired = 0
    for row in rows:
        count = 0
        try:
            async with mutation_lock(db, tournament_write_resource(row["tournament_id"]), wait_seconds=2.0):
                match = await db.matches_v2.find_one({"id": row["id"]}, {"_id": 0})
                if match:
                    count = await expire_due(db, match, now=now)
                    expired += count
        except MutationLockBusy:
            logger.info("Vorfall an match=%s wartet auf die Turniersperre", log_safe(row.get("id")))
            continue
        except Exception:  # noqa: BLE001 - ein Spiel hält die anderen nicht auf
            logger.warning("[league_incidents] Spiel %s nicht geprüft", log_safe(row.get("id")), exc_info=True)
            continue
        if count:
            try:
                from services.change_events import publish_api_change

                await publish_api_change("POST", f"/api/matches/{row['id']}/incidents", 200)
            except Exception:  # noqa: BLE001 - die Matchseite holt es beim nächsten Abruf
                logger.debug("Live-Meldung für Match %s nicht verschickt", log_safe(row.get("id")), exc_info=True)
    return {"expired": expired}


# ---------------------------------------------------------------- Matchseite

def _has_open_procedure(match: dict, incident_id: str) -> bool:
    """``disputes[].incident_id`` schreibt E.2 - hier nur gelesen: Läuft zu diesem Vorfall ein Verfahren?"""
    return any(isinstance(row, dict) and row.get("incident_id") == incident_id
               and not row.get("resolved_at") and not row.get("withdrawn_at") for row in match.get("disputes") or [])


def incident_view(match: dict, entry: dict, *, names: dict[str, str], people: dict[str, dict], own_id: str | None, can_act: bool,
                  lead: bool, now: datetime) -> dict:
    """Ein Vorfall für Beteiligte und Leitung: Seiten mit Namen, Personen nur als Betroffene - nie, wer für eine Seite gehandelt hat."""
    reporter = (entry.get("reported_by") or {}).get("registration_id")
    state = state_of(entry)
    answer_row = entry.get("answer") if isinstance(entry.get("answer"), dict) else None
    decision = entry.get("decision") if isinstance(entry.get("decision"), dict) else None
    deadline = moment(entry.get("answer_deadline"))
    waiting = state == PROPOSED and not (deadline and now > deadline)
    final = str(match.get("status") or "") in FINAL_STATUSES
    return {
        "id": entry.get("id"), "position": position_of(entry), "kind": entry.get("kind"),
        "kind_label": KIND_LABELS.get(str(entry.get("kind") or ""), "Vorfall"), "between_maps": bool(entry.get("between_maps")),
        "minutes": entry.get("minutes"), "at": entry.get("at"), "score": entry.get("score"), "round": entry.get("round"),
        "players": [people.get(user_id) or {"id": user_id, "name": "Spieler"} for user_id in entry.get("players") or []],
        "note": entry.get("note") or "",
        "reported_by": {"registration_id": reporter, "name": names.get(reporter) if reporter else "Liga-Leitung",
                        "own": bool(reporter) and reporter == own_id},
        "proposal": entry.get("proposal"), "proposal_label": PROPOSAL_LABELS.get(entry.get("proposal")),
        "state": state, "open": is_open(entry), "answer_deadline": entry.get("answer_deadline"),
        # Die Frist ist um, der Job hat den Vorfall aber noch nicht weitergereicht: Antworten geht nicht mehr.
        "expired": state == PROPOSED and not waiting,
        "answer": ({"registration_id": answer_row.get("registration_id"), "name": names.get(answer_row.get("registration_id")),
                    "at": answer_row.get("at"), "note": answer_row.get("note") or ""} if answer_row else None),
        "review_cause": entry.get("review_cause"), "counts_quota": bool(entry.get("counts_quota")),
        "decision": ({"outcome": decision.get("outcome"), "outcome_label": OUTCOME_LABELS.get(decision.get("outcome")),
                      "registration_id": decision.get("registration_id"),
                      "awarded_to": names.get(decision.get("registration_id")) if decision.get("registration_id") else None,
                      "reason": decision.get("reason") or "", "at": decision.get("at"),
                      "missing_positions": list(decision.get("missing_positions") or []),
                      "surplus_positions": list(decision.get("surplus_positions") or []),
                      "settled_at": decision.get("settled_at"), "settle_reason": decision.get("settle_reason") or ""}
                     if decision else None),
        "voided": entry.get("voided"), "closed_at": entry.get("closed_at"),
        "procedure": _has_open_procedure(match, str(entry.get("id") or "")),
        "can_answer": bool(can_act and own_id and reporter and own_id != reporter and waiting),
        "can_withdraw": bool(can_act and own_id and own_id == reporter and state == PROPOSED),
        "can_decide": bool(lead and state == IN_REVIEW),
        # Nach Neustart oder Wiederholung erst, wenn danach neu gemeldet ist - vorher gibt es nichts festzustellen.
        "can_settle": bool(lead and state == DECIDED and not final and not awaits_replay(match, entry)),
        "awaits_replay": awaits_replay(match, entry),
    }


async def page_block(db, setup, *, viewer, can_lead: bool, conflict: dict | None, now: datetime | None = None) -> dict:
    """Die Schlüssel der Vorfälle im Block ``league`` der Matchseite: ``map_state`` für alle (öffentlich nur „in Klärung“ bzw. „Map
    wiederholt“), ``incidents`` und ``incident_info`` für Beteiligte und Leitung. ``viewer``: ``match_proofs.Viewer`` - eine befangene
    Leitung sieht wie ihre Seite, nie als Leitung. ``can_lead``: Die Person hat das Recht zu entscheiden (auch befangen)."""
    match = setup.match
    now = now or now_utc()
    states = map_states(match, setup.best_of)
    surplus = surplus_positions(match)
    block: dict = {"map_state": states, "incidents": [], "incident_info": None}
    if surplus:
        # Öffentlich nur, dass die Position nicht zählt - die Begründung steht beim Vorfall.
        block["map_state"] = [{**row, "surplus": True} if row["position"] in surplus else row for row in states]
    involved = bool(viewer.sides or viewer.acting)
    # Notausnahme (#2203): Der befangene Superadmin entscheidet nur mit Grund - die Seite fragt danach.
    decides = bool(viewer.lead or (can_lead and conflict and conflict.get("override")))
    if not (involved or decides):
        return block
    own_id = next(iter(sorted(viewer.acting or viewer.sides)), None)
    can_act = bool(viewer.acting)
    rows = incidents_of(match)
    wanted = sorted({user_id for row in rows for user_id in row.get("players") or []})
    people: dict[str, dict] = {}
    if wanted:
        for person in await db.users.find({"id": {"$in": wanted}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(len(wanted) + 1):
            people[person["id"]] = {"id": person["id"], "name": person.get("display_name") or person.get("username") or "Spieler"}
    settings = await settings_for(db, setup.tournament)
    status = str(match.get("status") or "")
    closed = status in FINAL_STATUSES or status in CLOSED_STATUSES
    used = quota_used(match)
    hold = result_block(match)
    block["incidents"] = [incident_view(match, row, names=setup.names, people=people, own_id=own_id, can_act=can_act,
                                        lead=decides, now=now) for row in rows]
    block["incident_info"] = {
        "can_report": bool((can_act or decides) and not closed and len(setup.reg_ids) >= 2 and not isinstance(match.get("pending_result"), dict)),
        "as_lead": bool(decides and not can_act),
        "can_decide": decides,
        # Wer entscheiden dürfte, aber beteiligt ist: Die Seite sagt, warum hier nichts zu entscheiden steht (bzw. fragt den
        # Superadmin nach dem Grund der Notausnahme).
        "conflict": conflict if can_lead and conflict else None,
        "kinds": [{"key": key, "label": label} for key, label in KIND_LABELS.items()],
        "proposals": [{"key": key, "label": label} for key, label in PROPOSAL_LABELS.items()],
        "outcomes": [{"key": key, "label": label} for key, label in OUTCOME_LABELS.items()],
        "answer_minutes": int(settings["incident_answer_minutes"]),
        "clarification_mode": settings["clarification_mode"],
        "break_after": int(settings["map_break_after"]), "break_minutes": int(settings["map_break_minutes"]),
        "quota": {"limit": int(settings["incident_quota_per_map"]),
                  "used": [{"registration_id": side, "position": position, "count": count}
                           for side, per_map in sorted(used.items()) for position, count in sorted(per_map.items())]},
        "hold": hold,
        "server_time": now.isoformat(),
    }
    return block


# ---------------------------------------------------------------- Mein Dienst

async def review_rows(db, user: dict, limit: int = 50) -> list[dict]:
    """Mein Dienst: Spiele, in denen eine Map in Klärung ist oder die Serie noch festgestellt werden muss - für die Liga-Leitung mit
    „Ergebnisse“ oder „Proteste“, ohne die Spiele, an denen sie selbst beteiligt ist."""
    from services.league_permissions import can, involved_match_ids, staffel_access

    query = (await staffel_access(db, user)).query()
    if query is None:
        return []
    staffeln = await db.tournaments.find({**query, "status": {"$in": ["live", "paused"]}},
                                         {"_id": 0, "id": 1, "title": 1, "league_context": 1}).to_list(500)
    allowed = {}
    for row in staffeln:
        if await can(user, ("results", "disputes"), (row.get("league_context") or {}).get("league_id"), db=db):
            allowed[row["id"]] = row
    if not allowed:
        return []
    matches = await db.matches_v2.find(
        {"tournament_id": {"$in": sorted(allowed)}, "incidents.state": {"$in": [IN_REVIEW, DECIDED]},
         "status": {"$nin": sorted(FINAL_STATUSES | CLOSED_STATUSES)}, "is_preview": {"$ne": True}},
        {"_id": 0, "id": 1, "tournament_id": 1, "incidents": 1, "round_name": 1, "matchday_label": 1, "matchday_number": 1, "round": 1,
         "slots": 1, "games": 1, "lineups": 1}).to_list(500)
    rows = []
    for tournament_id in sorted({match["tournament_id"] for match in matches}):
        own = [match for match in matches if match["tournament_id"] == tournament_id]
        involved = await involved_match_ids(db, user, allowed[tournament_id], own)
        for match in own:
            hold = result_block(match)
            if match["id"] in involved or not hold or hold["code"] not in ("in_review", "unsettled", "missing"):
                continue
            since = [row.get("at") for row in incidents_of(match) if state_of(row) in (IN_REVIEW, DECIDED) and row.get("at")]
            rows.append({
                "match_id": match["id"], "tournament_id": tournament_id, "title": allowed[tournament_id].get("title"),
                "label": match.get("matchday_label") or match.get("round_name") or (
                    f"Spieltag {match.get('matchday_number') or match.get('round')}" if match.get("matchday_number") or match.get("round") else "Spiel"),
                "code": hold["code"], "position": hold["position"], "since": min(since) if since else None,
                "url": f"/matches/{match['id']}#vorfaelle",
            })
    rows.sort(key=lambda row: str(row.get("since") or ""))
    return rows[:limit]
