"""Vorfälle im Spiel - die Regeln ohne Datenbank (docs/LIGA.md, „D.5/E.2-Vertrag“ → „Vorfälle“, #1619; Regelwerk § 9, Anlage C).

Blatt-Modul: Stand je Map, was ein Ergebnis aufhält, Kontingent, „keine Map zählt doppelt“ und der Datenschutz-Teil - alles aus dem
Spiel-Datensatz gerechnet. ``match_deadlines`` (Frist-Automatik), ``league_page`` (Staffel-Seite) und ``match_flow`` (Auskunft,
Kontolöschung) lesen von hier, ohne die Abläufe in ``league_incidents`` zu laden (kein Import-Kreis über die Nachrichten).
"""
from __future__ import annotations

from datetime import datetime

from services.checkin_rules import moment
from services.league_presets import CLARIFICATION_MODES, PRESETS
from services.match_proof_refs import CLOSED_INCIDENT_STATES, CLOSED_STATUSES

PROPOSED, AGREED, REJECTED, EXPIRED, IN_REVIEW, DECIDED, WITHDRAWN = (
    "proposed", "agreed", "rejected", "expired", "in_review", "decided", "withdrawn")
# Geschlossen ohne Einigung und ohne Entscheidung: das Spiel endete ohne diesen Vorfall (``match_ended``) oder die Leitung hat ihn
# geschlossen (``lead``). Der Grund steht in ``close_reason``.
CLOSED = "closed"
MATCH_ENDED, BY_LEAD = "match_ended", "lead"
KIND_LABELS = {
    "disconnect": "Verbindungsabbruch",
    "rehost": "Rehost",
    "pause": "Technische Pause",
    "moss_crash": "MOSS-Absturz",
    "restart_early": "Abbruch in der frühen Phase",
    "replay": "Map soll wiederholt werden",
    "other": "Sonstiges",
}
KINDS = tuple(KIND_LABELS)
CONTINUE, REHOST, RESTART, REPLAY, AWARDED, NO_ACTION = "continue_at_score", "rehost", "restart", "replay", "awarded", "no_action"
PROPOSAL_LABELS = {
    CONTINUE: "Beim Stand fortsetzen",
    REHOST: "Rehost beim Stand",
    RESTART: "Neustart (frühe Phase)",
    REPLAY: "Map wiederholen",
}
PROPOSALS = tuple(PROPOSAL_LABELS)
OUTCOME_LABELS = {**PROPOSAL_LABELS, AWARDED: "Map zugesprochen", NO_ACTION: "Keine Maßnahme – die Map gilt wie gemeldet"}
OUTCOMES = tuple(OUTCOME_LABELS)
# Die Erstaustragung wird ungültig (``voided``) - die Map zählt trotzdem nur einmal.
VOIDING = frozenset({RESTART, REPLAY})
# Zählt gegen das Kontingent je Team und Map (§ 9.6) - der MOSS-Absturz nie (§ 9a.6), die Map-Pause auch nicht.
QUOTA_KINDS = frozenset({"rehost", "pause"})
FINAL_STATUSES = frozenset({"completed", "forfeit"})
# Das Spiel ist zu Ende - gespielt, kampflos gewertet, abgesagt oder archiviert. Ein Vorfall hält dann nichts mehr auf.
ENDED_STATUSES = FINAL_STATUSES | CLOSED_STATUSES
NOTE_MAX = 500
REASON_MIN, REASON_MAX = 5, 500
REPLAY_REASON_MAX = 200
MAX_SCORE = 1_000_000
MAX_ROUND = 999
MAX_PLAYERS = 20
MAX_PAUSE_MINUTES = 120
MAX_PER_MATCH = 30

NOT_FOUND_DETAIL = "Diesen Vorfall gibt es an diesem Spiel nicht."
CHANGED_DETAIL = "Gerade hat sich an den Vorfällen etwas geändert – bitte die Seite neu laden."
DECIDED_DETAIL = "Das Spiel ist schon entschieden – ein Vorfall lässt sich nicht mehr melden. Stimmt das Ergebnis nicht, nutze „Problem melden“."
NOT_A_SIDE_DETAIL = "Vorfälle melden Captain oder Vertreter einer Seite – oder die Liga-Leitung."
LEAD_ONLY_DETAIL = "Über einen Vorfall entscheidet die Liga-Leitung mit der Zuständigkeit „Ergebnisse“ oder „Proteste“."
ANSWERED_DETAIL = "Dieser Vorfall ist schon beantwortet oder abgeschlossen."
LATE_DETAIL = "Die Antwortzeit ist vorbei – der Vorfall liegt jetzt bei der Liga-Leitung."
NOT_FINALIZABLE_DETAIL = ("Die Meldungen passen nicht zur Entscheidung der Liga-Leitung über den Vorfall – das Ergebnis trägt die "
                          "Liga-Leitung ein.")
REPLAY_FIRST_DETAIL = ("Map {position} wird erst neu gespielt. Die Serie stellst du fest, sobald das Ergebnis danach neu gemeldet "
                       "ist – oder du trägst es selbst ein.")
# Was die Leitung am Eintragen eines Ergebnisses hindert: nur ein offener Vorfall. Ist entschieden, stellt das eingetragene Ergebnis
# die Serie fest.
OPEN_HOLD_CODES = frozenset({"in_review", "proposed"})


class IncidentProblem(Exception):
    """Etwas passt nicht - mit dem deutschen Satz für die Seite."""

    def __init__(self, detail: str, status_code: int = 422):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


# ---------------------------------------------------------------- Einstellungen

def setting_of(tournament: dict | None, season: dict | None, key: str):
    """Der Wert der Staffel, sonst der Season, sonst die Vorgabe (docs/LIGA.md, „Season-Felder“)."""
    for source in (tournament, season):
        value = (source or {}).get(key)
        if key == "clarification_mode":
            if value in CLARIFICATION_MODES:
                return value
        elif isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            return value
    return PRESETS[key]


# ---------------------------------------------------------------- Ableitungen ohne Datenbank

def incidents_of(match: dict | None) -> list[dict]:
    return [row for row in (match or {}).get("incidents") or [] if isinstance(row, dict)]


def state_of(entry: dict) -> str:
    return str(entry.get("state") or PROPOSED)


def is_open(entry: dict) -> bool:
    return state_of(entry) not in CLOSED_INCIDENT_STATES


def position_of(entry: dict) -> int:
    try:
        return int(entry.get("position") or 0)
    except (TypeError, ValueError):
        return 0


def outcome_of(entry: dict) -> str | None:
    """Was für die Map gilt: bei Einigung der Vorschlag, nach der Entscheidung ihr Ausgang - sonst nichts."""
    state = state_of(entry)
    if state == AGREED:
        return entry.get("proposal") or None
    if state == DECIDED:
        return (entry.get("decision") or {}).get("outcome") or None
    return None


def find(match: dict, incident_id: str) -> dict:
    entry = next((row for row in incidents_of(match) if row.get("id") == incident_id), None)
    if entry is None:
        raise IncidentProblem(NOT_FOUND_DETAIL, 404)
    return entry


def match_ended(match: dict | None) -> bool:
    """Ist das Spiel zu Ende (gespielt, kampflos, abgesagt, archiviert)? Dann ist ein noch offener Vorfall gegenstandslos: Er hält
    nichts auf, steht öffentlich nicht mehr als „in Klärung“ und wird ohne Nachricht geschlossen (``league_incidents.close_ended``)."""
    return str((match or {}).get("status") or "") in ENDED_STATUSES


def open_incidents(match: dict | None) -> list[dict]:
    """Die Vorfälle, über die noch jemand antworten oder entscheiden muss - keine, sobald das Spiel zu Ende ist."""
    return [] if match_ended(match) else [row for row in incidents_of(match) if is_open(row)]


def as_shown(match: dict | None) -> list[dict]:
    """Die Vorfälle, wie sie gelten: In einem beendeten Spiel ist ein noch offener Vorfall geschlossen, auch wenn der Job ihn
    noch nicht geschrieben hat."""
    rows = incidents_of(match)
    if not match_ended(match):
        return rows
    return [{**row, "state": CLOSED, "close_reason": MATCH_ENDED} if is_open(row) else row for row in rows]


def forfeit_refusal(match: dict | None) -> str | None:
    """Warum die Leitung das Spiel gerade nicht kampflos bzw. als „nicht erschienen“ werten kann - ``None``: es geht. Bei einem
    offenen Vorfall entscheidet oder schließt sie ihn zuerst (Entscheidung Nr. 146)."""
    rows = open_incidents(match)
    if not rows:
        return None
    position = min(position_of(row) for row in rows)
    return (f"Zu Map {position} ist ein Vorfall offen. Bitte zuerst über den Vorfall entscheiden oder ihn schließen – erst dann lässt "
            "sich das Spiel kampflos werten.")


def positions_in_clarification(match: dict | None) -> list[int]:
    """Quelle ist der Vorfall: Eine Position ist in Klärung, solange ein Vorfall dieser Position ``in_review`` ist - und das Spiel
    nicht schon zu Ende ist."""
    return sorted({position_of(row) for row in open_incidents(match) if state_of(row) == IN_REVIEW})


def surplus_positions(match: dict | None) -> list[int]:
    """Positionen, die nach einer Entscheidung der Leitung nicht zählen (Nr. 138)."""
    out: set[int] = set()
    for row in incidents_of(match):
        if state_of(row) == DECIDED:
            out.update(int(item) for item in (row.get("decision") or {}).get("surplus_positions") or [])
    return sorted(out)


def missing_positions(match: dict | None) -> list[int]:
    out: set[int] = set()
    for row in incidents_of(match):
        if state_of(row) == DECIDED:
            out.update(int(item) for item in (row.get("decision") or {}).get("missing_positions") or [])
    return sorted(out)


def replay_cutoff(match: dict | None) -> datetime | None:
    """Ab wann Meldungen wieder zählen: der späteste Zeitpunkt, zu dem eine Map für ungültig erklärt wurde (Neustart oder
    Wiederholung, per Einigung oder Entscheidung). ``None``: keine Map wird neu gespielt."""
    moments = []
    for row in incidents_of(match):
        if outcome_of(row) in VOIDING:
            voided_at = moment((row.get("voided") or {}).get("at"))
            if voided_at:
                moments.append(voided_at)
    return max(moments) if moments else None


def current_reports(match: dict | None) -> list[dict]:
    """Die Meldungen, die noch zählen. Wird eine Map neu gestartet oder wiederholt, beschreibt jede frühere Meldung die ungültige
    Austragung: Für Übereinstimmung, Einzelmeldung und Frist-Automatik zählt nur, was **danach** gemeldet wurde."""
    reports = [row for row in (match or {}).get("reports") or [] if isinstance(row, dict)]
    cutoff = replay_cutoff(match)
    if cutoff is None:
        return reports
    return [row for row in reports if (moment(row.get("at")) or cutoff) > cutoff]


def replay_pending(match: dict | None) -> dict | None:
    """Der Vorfall, dessen Neustart oder Wiederholung noch nicht neu gemeldet ist - ``None``: nichts steht aus."""
    cutoff = replay_cutoff(match)
    if cutoff is None or current_reports(match):
        return None
    voiding = [row for row in incidents_of(match) if outcome_of(row) in VOIDING and moment((row.get("voided") or {}).get("at"))]
    return max(voiding, key=lambda row: moment(row["voided"]["at"])) if voiding else None


def awaits_replay(match: dict | None, entry: dict) -> bool:
    """Dieser Vorfall hat die Map für ungültig erklärt, und seither ist nicht neu gemeldet: Die Serie lässt sich noch nicht
    feststellen."""
    return outcome_of(entry) in VOIDING and bool(replay_cutoff(match)) and not current_reports(match)


def replay_text(entry: dict) -> str:
    how = "neu gestartet" if outcome_of(entry) == RESTART else "wiederholt"
    return f"Map {position_of(entry)} wird {how} – danach meldet ihr die Serie neu. Frühere Meldungen zählen nicht mehr."


def result_block(match: dict | None) -> dict | None:
    """Warum gerade kein Ergebnis dieses Spiels gültig wird - ``None``: nichts hält es auf. ``{code, position, text}``.

    Offen ist ein Vorfall, solange er nicht ``agreed``, ``decided`` oder ``withdrawn`` ist. Wird eine Map neu gestartet oder
    wiederholt, gilt nichts, bis danach neu gemeldet ist (``rereport``). Nach einer Entscheidung der Leitung gilt das Ergebnis erst,
    wenn sie die Serie festgestellt hat und keine Position mehr fehlt. Ist das Spiel zu Ende, hält kein Vorfall mehr etwas auf -
    auch keine spätere Korrektur der Leitung."""
    if match_ended(match):
        return None
    rows = incidents_of(match)
    review = [row for row in rows if state_of(row) == IN_REVIEW]
    if review:
        position = min(position_of(row) for row in review)
        return {"code": "in_review", "position": position,
                "text": f"Map {position} ist in Klärung – die Liga-Leitung entscheidet. Bis dahin gilt kein Ergebnis."}
    waiting = [row for row in rows if state_of(row) == PROPOSED]
    if waiting:
        position = min(position_of(row) for row in waiting)
        return {"code": "proposed", "position": position,
                "text": f"Zu Map {position} ist ein Vorfall gemeldet – die Gegenseite antwortet noch. Bis dahin gilt kein Ergebnis."}
    pending = replay_pending(match)
    if pending:
        return {"code": "rereport", "position": position_of(pending), "text": replay_text(pending)}
    decided = [row for row in rows if state_of(row) == DECIDED]
    unsettled = [row for row in decided if not (row.get("decision") or {}).get("settled_at")]
    if unsettled:
        position = min(position_of(row) for row in unsettled)
        return {"code": "unsettled", "position": position,
                "text": (f"Über den Vorfall zu Map {position} ist entschieden. Die Liga-Leitung stellt die Serie noch fest – erst "
                         "dann gilt ein Ergebnis.")}
    missing = missing_positions(match)
    if missing:
        maps = ", ".join(str(item) for item in missing)
        return {"code": "missing", "position": missing[0],
                "text": f"Laut Liga-Leitung fehlt noch Map {maps}. Erst wenn sie gespielt und die Serie festgestellt ist, gilt ein Ergebnis."}
    return None


def report_refusal(match: dict | None, mode: str, positions) -> str | None:
    """``pause_series`` (Nr. 132): Solange eine Map in Klärung ist, beginnt keine weitere - eine Meldung mit einer späteren Position
    lehnt der Server ab. ``continue``: nichts hält die Meldung auf."""
    if mode != "pause_series":
        return None
    reported = sorted(int(item) for item in positions or [] if item)
    for position in positions_in_clarification(match):
        later = [item for item in reported if item > position]
        if later:
            return (f"Map {position} ist in Klärung und die Serie pausiert – Map {later[0]} lässt sich erst melden, wenn die "
                    "Liga-Leitung entschieden hat.")
    return None


def map_states(match: dict | None, best_of: int) -> list[dict]:
    """Je Position ``open`` | ``in_clarification`` | ``replayed`` | ``awarded`` | ``played`` - abgeleitet aus Vorfällen und ``games``."""
    games = {int(game.get("position") or 0): game for game in (match or {}).get("games") or [] if isinstance(game, dict)}
    clarifying = set(positions_in_clarification(match))
    out = []
    for position in range(1, max(int(best_of or 1), 1) + 1):
        game = games.get(position)
        if position in clarifying:
            state = "in_clarification"
        elif game is None:
            state = "open"
        elif game.get("decision") == "awarded":
            state = "awarded"
        elif game.get("status") == "replayed":
            state = "replayed"
        else:
            state = "played"
        out.append({"position": position, "state": state})
    return out


def quota_used(match: dict | None) -> dict[str, dict[int, int]]:
    """Je Seite und Map: die eigenen Vorfälle mit ``counts_quota`` in ``agreed`` oder ``decided`` (§ 9.6)."""
    used: dict[str, dict[int, int]] = {}
    for row in incidents_of(match):
        side = (row.get("reported_by") or {}).get("registration_id")
        if side and row.get("counts_quota") and state_of(row) in (AGREED, DECIDED):
            per_map = used.setdefault(side, {})
            per_map[position_of(row)] = per_map.get(position_of(row), 0) + 1
    return used


def counts_quota(kind: str, between_maps: bool) -> bool:
    return kind in QUOTA_KINDS and not between_maps


def confirm_clock(match: dict | None) -> datetime | None:
    """Wann zuletzt ein Vorfall dieses Spiels endete oder die Serie festgestellt wurde. Die Bestätigungsfrist ruht bis dahin
    (``match_deadlines.auto_confirm_due`` zählt frühestens ab hier)."""
    moments = []
    for row in incidents_of(match):
        for value in (row.get("closed_at"), (row.get("decision") or {}).get("settled_at")):
            parsed = moment(value)
            if parsed:
                moments.append(parsed)
    return max(moments) if moments else None


def due_at(incidents: list[dict]) -> str | None:
    """Die früheste offene Antwortfrist - der Zeiger für den Zeit-Job."""
    deadlines = [row["answer_deadline"] for row in incidents if state_of(row) == PROPOSED and row.get("answer_deadline")]
    return min(deadlines) if deadlines else None


# ---------------------------------------------------------------- Eine Map zählt nie doppelt

def _replay_reason(entry: dict) -> str:
    label = KIND_LABELS.get(str(entry.get("kind") or ""), "Vorfall")
    how = "nach Einigung beider Seiten" if state_of(entry) == AGREED else "nach Entscheidung der Liga-Leitung"
    return f"{label}: Map {'neu gestartet' if outcome_of(entry) == RESTART else 'wiederholt'} {how}"[:REPLAY_REASON_MAX]


def _effects(match: dict | None) -> tuple[dict[int, dict], dict[int, dict]]:
    """Je Position: der letzte Vorfall, nach dem die Map neu gestartet oder wiederholt wurde, und - wenn die letzte Entscheidung der
    Leitung zu dieser Position „zugesprochen“ lautet - diese Entscheidung."""
    replays: dict[int, dict] = {}
    awards: dict[int, dict] = {}
    for row in incidents_of(match):
        outcome = outcome_of(row)
        position = position_of(row)
        if outcome in VOIDING:
            replays[position] = row
        if state_of(row) == DECIDED:
            if outcome == AWARDED:
                awards[position] = row
            else:
                awards.pop(position, None)
    return replays, awards


def mark_replays(match: dict | None, games: list[dict] | None) -> list[dict] | None:
    """Die Maps der Leitung (Eintragen, Korrigieren): Eine Position mit Neustart oder Wiederholung trägt ``status: "replayed"``,
    den Grund und den Vorfall. Sieger, Punkte und Zahl der Maps bleiben, wie die Leitung sie eingibt."""
    if not games:
        return games
    replays, awards = _effects(match)
    out = []
    for game in games:
        position = int(game.get("position") or 0)
        entry = awards.get(position) if game.get("decision") == "awarded" else replays.get(position)
        if entry is None:
            out.append(game)
        elif game.get("decision") == "awarded":
            out.append({**game, "incident_id": entry["id"]})
        else:
            out.append({**game, "status": "replayed", "replay_reason": game.get("replay_reason") or _replay_reason(entry),
                        "incident_id": entry["id"]})
    return out


def final_games(match: dict | None, games: list[dict], *, sides: list[str], needed: int) -> list[dict]:
    """Die geltenden Maps aus den gemeldeten: je Position genau eine Austragung. Neustart und Wiederholung markieren die Map,
    „zugesprochen“ setzt Sieger und Wertung, Maps nach der Entscheidung der Serie zählen nicht (Nr. 138). Passt das Ergebnis danach
    nicht mehr (Lücke, kein Sieger der Serie), trägt die Leitung es ein (``IncidentProblem``, 409)."""
    replays, awards = _effects(match)
    surplus = set(surplus_positions(match))
    wins = {side: 0 for side in sides}
    out = []
    for game in sorted(games, key=lambda row: int(row.get("position") or 0)):
        position = int(game.get("position") or 0)
        if position in surplus or max(wins.values() or [0]) >= needed:
            continue
        award = awards.get(position)
        if award is not None:
            winner = (award.get("decision") or {}).get("registration_id")
            game = {key: value for key, value in game.items() if key not in ("status", "replay_reason")}
            game.update(winner_registration_id=winner, scores={}, decision="awarded", incident_id=award["id"])
        elif position in replays:
            entry = replays[position]
            game = {**game, "status": "replayed", "replay_reason": game.get("replay_reason") or _replay_reason(entry),
                    "incident_id": entry["id"]}
        winner = game.get("winner_registration_id")
        if winner not in wins:
            raise IncidentProblem(NOT_FINALIZABLE_DETAIL, 409)
        wins[winner] += 1
        out.append(game)
    if [int(game["position"]) for game in out] != list(range(1, len(out) + 1)) or max(wins.values() or [0]) < needed:
        raise IncidentProblem(NOT_FINALIZABLE_DETAIL, 409)
    return out


# ---------------------------------------------------------------- Datenschutz (Auskunft, Kontolöschung)

def export_steps(match: dict, user_id: str) -> list[dict]:
    """Für die Auskunft: die eigenen Schritte an Vorfällen dieses Spiels - als Leitung nur der Vorgang."""
    steps = []
    for row in incidents_of(match):
        base = {"incident_id": row.get("id"), "position": row.get("position"), "kind": row.get("kind")}
        reported = row.get("reported_by") or {}
        if reported.get("user_id") == user_id:
            steps.append({**base, "role": "incident_reported", "side": reported.get("registration_id"), "at": row.get("at"),
                          "note": row.get("note") or ""})
        answered = row.get("answer") or {}
        if answered.get("user_id") == user_id:
            steps.append({**base, "role": "incident_answered", "side": answered.get("registration_id"), "at": answered.get("at"),
                          "note": answered.get("note") or ""})
        decision = row.get("decision") or {}
        if decision.get("by") == user_id:
            steps.append({**base, "role": "incident_decided", "at": decision.get("at")})
        if decision.get("settled_by") == user_id:
            steps.append({**base, "role": "incident_settled", "at": decision.get("settled_at")})
        if row.get("closed_by") == user_id:
            steps.append({**base, "role": "incident_closed", "at": row.get("closed_at")})
        if user_id in (row.get("players") or []):
            steps.append({**base, "role": "incident_affected", "at": row.get("at")})
    return steps


def scrub(incidents, user_id: str) -> tuple[list | None, bool]:
    """Kontolöschung: Der Vorfall bleibt (sportlicher Ablauf), die Kennung der Person fällt überall heraus - auch aus den
    Betroffenen."""
    if not isinstance(incidents, list):
        return incidents, False
    changed = False
    out = []
    for row in incidents:
        if not isinstance(row, dict):
            out.append(row)
            continue
        row = dict(row)
        for key in ("reported_by", "answer"):
            if isinstance(row.get(key), dict) and row[key].get("user_id") == user_id:
                row[key] = {**row[key], "user_id": None}
                changed = True
        if isinstance(row.get("decision"), dict):
            decision = dict(row["decision"])
            for key in ("by", "settled_by"):
                if decision.get(key) == user_id:
                    decision[key] = None
                    changed = True
            row["decision"] = decision
        if row.get("closed_by") == user_id:
            row["closed_by"] = None
            changed = True
        if user_id in (row.get("players") or []):
            row["players"] = [item for item in row["players"] if item != user_id]
            changed = True
        out.append(row)
    return out, changed
