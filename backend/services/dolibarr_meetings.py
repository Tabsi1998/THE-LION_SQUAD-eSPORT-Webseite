"""Generalversammlung und Abstimmungen aus der Vereinsakte (#327, Vereine 1.4).

Die Website hat keine eigene Wahl-Engine: Sitzungen, Einladungen, Tagesordnung, Anträge, Abstimmungen,
Stimmrechte und Ergebnisse führt das Vereinsmodul; die Website zeigt, was ``GET /vereine/me/meetings`` und
``GET /vereine/me/ballots`` für diese Person liefern, und reicht Zu-/Absage, Anträge und Stimmen durch.
Der Weg zur Akte ist derselbe wie bei den eigenen Daten (``dolibarr_identity.access_for``): die bestätigte
Zuordnung (``member_id``, Modul ab 1.4.0 mit den Rechten „im Namen jedes Mitglieds handeln“ und, für
Stimmen, „… abstimmen“) oder die Bindung per Einladungscode mit den Fähigkeiten ``meetings`` bzw. ``votes``.

Eine Stimme ist bewusst: die Website fragt vor dem Senden nach, und die ``external_id`` einer Stimme
hängt an Konto, Abstimmung und Stimmrecht - nicht an der Antwort. Ein Doppelklick, ein zweites Gerät
oder ein Verbindungsabbruch ergeben so dieselbe Anfrage; eine andere Antwort unter demselben Stimmrecht
weist das Modul mit 409 ab, und die Website behauptet nie, sie hätte abgestimmt, wenn sie es nicht weiß.
Welche Antwort jemand gegeben hat, schreibt die Website nirgends hin: kein Audit, kein Log.
"""
from __future__ import annotations

import hashlib
import json
from datetime import date

from services import dolibarr_identity
from services.dolibarr_client import DolibarrClient, DolibarrError, load_settings

KIND_LABELS = {"board": "Vorstandssitzung", "general": "Generalversammlung", "extraordinary": "Außerordentliche Generalversammlung"}
FORMAT_LABELS = {"physical": "vor Ort", "virtual": "online", "hybrid": "vor Ort und online"}
MEETING_STATUS_LABELS = {"invited": "eingeladen", "held": "abgehalten", "cancelled": "abgesagt"}
RESPONSE_LABELS = {"": "noch keine Antwort", "yes": "zugesagt", "no": "abgesagt", "maybe": "vielleicht"}
MOTION_STATUS_LABELS = {"received": "eingegangen", "accepted": "auf der Tagesordnung", "rejected": "nicht aufgenommen"}
BALLOT_KIND_LABELS = {"resolution": "Beschluss", "election": "Wahl", "statutes": "Statutenänderung", "dissolution": "Auflösung"}
BALLOT_STATUS_LABELS = {"released": "angekündigt", "open": "offen", "closed": "geschlossen", "evaluated": "ausgezählt", "cancelled": "abgesagt"}
RIGHT_REASON_TEXTS = {
    "own": "dein eigenes Stimmrecht",
    "proxy": "Vollmacht",
    "represented": "du hast eine Vollmacht gegeben – dein Vertreter stimmt für dich",
    "no_voting_right": "laut Einladung nicht stimmberechtigt",
    "not_member": "am Versammlungstag kein Mitglied",
}
OUTCOME_LABELS = {"passed": "angenommen", "rejected": "abgelehnt", "no_quorum": "nicht beschlussfähig", "no_majority": "keine Mehrheit – eine Stichwahl folgt als neue Abstimmung"}
VOTE_CONFLICTS = {
    "not_open": "Die Abstimmung ist noch nicht offen.",
    "closed": "Die Abstimmung ist schon geschlossen.",
    "channel": "Diese Abstimmung läuft nicht über die Website.",
    "used": "Dieses Stimmrecht ist schon genutzt – jede Stimme zählt einmal.",
    "not_present": "Du stehst nicht auf der Anwesenheitsliste der Versammlung – erst dort eintragen lassen, dann abstimmen.",
    "external_id": "Für dieses Stimmrecht liegt schon eine andere Stimme von dir vor – sie bleibt, eine Stimme lässt sich nicht ändern.",
}
VOTE_RIGHT_LABEL = "Über die API im Namen jedes Mitglieds abstimmen"
REASON_TEXTS = {
    "not_connected": "Die Mitgliederverwaltung ist nicht live angebunden.",
    "not_bound": "Dafür muss dein Konto mit deinem Mitgliedseintrag verbunden sein – das passiert von selbst über die bestätigte "
                 "E-Mail-Adresse oder durch den Vorstand (Dolibarr → Zuordnungen); alternativ mit einem Einladungscode unter Meine Mitgliedschaft.",
    "right_missing": dolibarr_identity.MEMBER_RIGHT_TEXT,
    "vote_right_missing": ("Die Website darf im Vereinsmodul noch nicht im Namen der Mitglieder abstimmen – der Vorstand gibt dem API-Benutzer "
                           f"der Website in Dolibarr das Recht „{VOTE_RIGHT_LABEL}“."),
    "no_capability_meetings": "Deine Verbindung erlaubt Versammlungen noch nicht – der Vorstand schaltet die Fähigkeit „Versammlungen“ in Dolibarr ein.",
    "no_capability_votes": "Deine Verbindung erlaubt Abstimmungen noch nicht – der Vorstand schaltet die Fähigkeit „Abstimmungen“ in Dolibarr ein.",
}
MOTION_TITLE_MAX = 255
MOTION_TEXT_MAX = 5000


class MeetingsError(Exception):
    def __init__(self, status: int, detail: str, reason: str | None = None):
        super().__init__(detail)
        self.status = status
        self.detail = detail
        self.reason = reason


async def _access(db, user: dict):
    """Anbindung live und ein Weg zur Akte - sonst der Grund. Die Fähigkeit prüft jeder Teil selbst."""
    settings = await load_settings(db)
    if settings.get("mode") != "live":
        return settings, None, None, "not_connected"
    access = await dolibarr_identity.access_for(db, settings, user["id"])
    if not access:
        return settings, None, None, "not_bound"
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        return settings, access, None, exc.kind
    return settings, access, client, None


def _lacks(access: dict, capability: str) -> str | None:
    """Über die Bindung muss die Fähigkeit dabei sein; über die Mitgliedsnummer entscheidet das Modul (Recht)."""
    if access["mode"] == "subject" and capability not in access["capabilities"]:
        return f"no_capability_{capability}"
    return None


async def _denied(db, access: dict, *, votes: bool = False) -> str:
    """403 vom Modul: über die Bindung ist sie widerrufen; über die Mitgliedsnummer fehlt ein Recht - bei Stimmen
    das eigene Recht „… abstimmen“, das die übrige Akte nicht betrifft."""
    if access["mode"] == "member" and votes:
        return "vote_right_missing"
    await dolibarr_identity.forbidden(db, access)
    return "right_missing" if access["mode"] == "member" else "not_bound"


def _external_id(prefix: str, user_id: str, *parts) -> str:
    digest = hashlib.sha256(json.dumps(parts, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]
    return f"web-{prefix}-{str(user_id)[:8]}-{digest}"[:64]


def _iso(today: date | None) -> str:
    return (today or date.today()).isoformat()


# ---------------------------------------------------------------- Ansichten (reine Rechnung)

def motion_view(row: dict) -> dict:
    status = str(row.get("status") or "")
    return {
        "external_id": row.get("external_id"), "title": row.get("title") or "", "text": row.get("text") or "",
        "received_at": row.get("received_at"), "late": bool(row.get("late")), "status": status,
        "status_label": MOTION_STATUS_LABELS.get(status, status),
    }


def meeting_view(row: dict, today: date | None = None) -> dict:
    """Eine Sitzung, wie Web und App sie zeigen - mit Beschriftungen und dem, was die Person jetzt tun kann."""
    now = _iso(today)
    kind, status, response = str(row.get("kind") or ""), str(row.get("status") or ""), str(row.get("response") or "")
    day = str(row.get("day") or "")
    deadline = str(row.get("motion_deadline") or "")
    upcoming = status == "invited" and day >= now
    return {
        "id": int(row.get("id") or 0), "kind": kind, "kind_label": KIND_LABELS.get(kind, kind), "title": row.get("title") or "",
        "day": day, "time": row.get("time") or "", "timezone": row.get("timezone") or "", "format": row.get("format") or "",
        "format_label": FORMAT_LABELS.get(str(row.get("format") or ""), row.get("format") or ""), "place": row.get("place") or "",
        "access": row.get("access") or "", "status": status, "status_label": MEETING_STATUS_LABELS.get(status, status),
        "agenda": [str(item) for item in (row.get("agenda") or [])], "voting": bool(row.get("voting")),
        "response": response, "response_label": RESPONSE_LABELS.get(response, response), "responded_at": row.get("responded_at") or "",
        "motion_deadline": deadline, "motions": [motion_view(m) for m in (row.get("motions") or []) if isinstance(m, dict)],
        "upcoming": upcoming, "can_respond": upcoming,
        "can_motion": upcoming and kind in ("general", "extraordinary"),
        "motion_late": bool(deadline) and now > deadline,
    }


def _right_view(row: dict, labels: dict) -> dict:
    state, reason, option = str(row.get("state") or ""), str(row.get("reason") or ""), str(row.get("option") or "")
    return {
        "right_id": int(row.get("right_id") or 0), "for": row.get("for") or "self", "name": row.get("name") or "",
        "state": state, "reason": reason, "reason_text": RIGHT_REASON_TEXTS.get(reason, reason),
        "option": option, "option_label": labels.get(option, option),
        "can_use": state == "open" and int(row.get("right_id") or 0) > 0,
    }


def _result_view(result: dict | None, options: list[dict], labels: dict) -> dict | None:
    if not isinstance(result, dict):
        return None
    counts = result.get("counts") if isinstance(result.get("counts"), dict) else {}
    outcome, winner = str(result.get("outcome") or ""), str(result.get("winner") or "")
    return {
        "revision": int(result.get("revision") or 0), "outcome": outcome, "outcome_label": OUTCOME_LABELS.get(outcome, outcome),
        "passed": bool(result.get("passed")), "valid": int(result.get("valid") or 0), "abstain": int(result.get("abstain") or 0),
        "counts": [{"code": option["code"], "label": option["label"], "count": int(counts.get(option["code"]) or 0)} for option in options],
        "winner": winner, "winner_label": labels.get(winner, winner),
    }


def ballot_view(row: dict) -> dict:
    options = [{"code": str(o.get("code") or ""), "label": str(o.get("label") or "")} for o in (row.get("options") or []) if isinstance(o, dict)]
    labels = {o["code"]: o["label"] for o in options}
    rights = [_right_view(r, labels) for r in (row.get("rights") or []) if isinstance(r, dict)]
    kind, status = str(row.get("kind") or ""), str(row.get("status") or "")
    return {
        "id": int(row.get("id") or 0), "meeting_id": int(row.get("meeting_id") or 0), "meeting": row.get("meeting") or "",
        "day": row.get("day") or "", "item": int(row.get("item") or 0), "kind": kind, "kind_label": BALLOT_KIND_LABELS.get(kind, kind),
        "question": row.get("question") or "", "status": status, "status_label": BALLOT_STATUS_LABELS.get(status, status),
        "closes": row.get("closes") or "", "timezone": row.get("timezone") or "", "options": options, "rights": rights,
        "can_vote": status == "open" and any(right["can_use"] for right in rights),
        "result": _result_view(row.get("result"), options, labels),
    }


# ---------------------------------------------------------------- Lesen

async def overview(db, user: dict, *, today: date | None = None) -> dict:
    """Sitzungen und Abstimmungen der Person - je Teil mit dem Grund, wenn er fehlt."""
    settings, access, client, reason = await _access(db, user)
    if reason:
        return {"available": False, "reason": reason, "text": REASON_TEXTS.get(reason, ""), "meetings": [], "ballots": [],
                "meetings_reason": reason, "meetings_text": REASON_TEXTS.get(reason, ""), "ballots_reason": reason, "ballots_text": REASON_TEXTS.get(reason, "")}
    out: dict = {"available": True, "reason": None, "text": "", "meetings": [], "ballots": [], "meetings_reason": None, "meetings_text": "",
                 "ballots_reason": None, "ballots_text": ""}
    lacking = _lacks(access, "meetings")
    if lacking:
        out["meetings_reason"], out["meetings_text"] = lacking, REASON_TEXTS[lacking]
    else:
        try:
            rows = await client.my_meetings(access["params"])
            out["meetings"] = [meeting_view(row, today) for row in rows]
            await dolibarr_identity.member_call_ok(db, access)
        except DolibarrError as exc:
            if exc.kind == "forbidden":
                out["meetings_reason"] = await _denied(db, access)
                out["meetings_text"] = REASON_TEXTS[out["meetings_reason"]]
            else:
                out["meetings_reason"], out["meetings_text"] = exc.kind, f"Dolibarr antwortet gerade nicht ({exc.text})."
    lacking = _lacks(access, "votes")
    if lacking:
        out["ballots_reason"], out["ballots_text"] = lacking, REASON_TEXTS[lacking]
    else:
        try:
            rows = await client.my_ballots(access["params"])
            out["ballots"] = [ballot_view(row) for row in rows]
        except DolibarrError as exc:
            if exc.kind == "forbidden":
                out["ballots_reason"] = await _denied(db, access, votes=True)
                out["ballots_text"] = REASON_TEXTS[out["ballots_reason"]]
            else:
                out["ballots_reason"], out["ballots_text"] = exc.kind, f"Dolibarr antwortet gerade nicht ({exc.text})."
    return out


# ---------------------------------------------------------------- Schreiben

async def _writer(db, user: dict, capability: str):
    settings, access, client, reason = await _access(db, user)
    if reason:
        raise MeetingsError(403, REASON_TEXTS.get(reason, "Nicht möglich."), reason=reason)
    lacking = _lacks(access, capability)
    if lacking:
        raise MeetingsError(409, REASON_TEXTS[lacking], reason=lacking)
    return access, client


async def _raise_for(db, access: dict, exc: DolibarrError, *, conflict: str, not_found: str, votes: bool = False) -> None:
    if exc.kind == "forbidden":
        reason = await _denied(db, access, votes=votes)
        raise MeetingsError(403, REASON_TEXTS[reason], reason=reason) from exc
    if exc.kind == "not_found":
        raise MeetingsError(404, not_found) from exc
    if exc.kind == "conflict":
        raise MeetingsError(409, conflict) from exc
    if exc.kind == "bad_request":
        raise MeetingsError(400, "Die Mitgliederverwaltung hat das abgewiesen (Wert passt nicht).") from exc
    raise MeetingsError(503, f"Dolibarr antwortet gerade nicht ({exc.text}).") from exc


async def respond(db, user: dict, meeting_id: int, response: str, *, today: date | None = None) -> dict:
    """Zu- oder Absage - keine Anwesenheit, keine Stimme."""
    if response not in ("yes", "no", "maybe"):
        raise MeetingsError(400, "Antwort bitte als yes, no oder maybe.")
    access, client = await _writer(db, user, "meetings")
    try:
        row = await client.respond_meeting(access["params"], int(meeting_id), {"response": response})
    except DolibarrError as exc:
        await _raise_for(db, access, exc, conflict="Die Sitzung ist vorbei oder abgesagt – eine Antwort ist nicht mehr möglich.",
                         not_found="Zu dieser Sitzung bist du nicht eingeladen.")
    return meeting_view(row, today)


async def submit_motion(db, user: dict, meeting_id: int, title: str, text: str) -> dict:
    """Antrag zur Tagesordnung - genau einmal je Inhalt; ob er aufgenommen wird, entscheidet der Vorstand."""
    title = str(title or "").strip()
    text = str(text or "").strip()
    if len(title) < 3:
        raise MeetingsError(400, "Der Antrag braucht einen Titel (mindestens 3 Zeichen).")
    if len(title) > MOTION_TITLE_MAX or len(text) > MOTION_TEXT_MAX:
        raise MeetingsError(400, f"Titel bis {MOTION_TITLE_MAX}, Text bis {MOTION_TEXT_MAX} Zeichen.")
    access, client = await _writer(db, user, "meetings")
    payload = {"external_id": _external_id("motion", user["id"], int(meeting_id), title, text), "title": title, "text": text}
    try:
        row = await client.submit_motion(access["params"], int(meeting_id), payload)
    except DolibarrError as exc:
        await _raise_for(db, access, exc, conflict="Unter derselben Kennung liegt schon ein anderer Antrag – bitte die Seite neu laden.",
                         not_found="Zu dieser Versammlung bist du nicht eingeladen, oder sie nimmt keine Anträge an.")
    return motion_view(row)


def _conflict_text(exc: DolibarrError) -> str:
    """Das Modul nennt im 409 den Grund (not_open, closed, channel, used, not_present, external_id)."""
    text = str((exc.detail or {}).get("message") or "").lower()
    for code, sentence in VOTE_CONFLICTS.items():
        if code in text:
            return sentence
    return "Die Stimme wurde nicht angenommen – die Abstimmung ist nicht offen oder das Stimmrecht schon genutzt."


async def cast_vote(db, user: dict, ballot_id: int, right_id: int, option: str) -> dict:
    """Eine Stimme mit einem Stimmrecht aus der Liste - dieselbe Anfrage noch einmal ist dieselbe Stimme."""
    option = str(option or "").strip()
    if not option or len(option) > 16:
        raise MeetingsError(400, "Bitte eine Antwort wählen.")
    if int(right_id or 0) <= 0:
        raise MeetingsError(400, "Mit diesem Stimmrecht kannst du nicht abstimmen.")
    access, client = await _writer(db, user, "votes")
    # Die Kennung hängt nicht an der Antwort: ein zweiter Versuch mit anderer Antwort ist keine neue Stimme.
    payload = {"right_id": int(right_id), "option": option, "external_id": _external_id("vote", user["id"], int(ballot_id), int(right_id))}
    try:
        row = await client.cast_vote(access["params"], int(ballot_id), payload)
    except DolibarrError as exc:
        if exc.kind == "conflict":
            raise MeetingsError(409, _conflict_text(exc)) from exc
        if exc.kind == "bad_request":
            raise MeetingsError(400, "Diese Antwort gibt es bei dieser Abstimmung nicht.") from exc
        await _raise_for(db, access, exc, votes=True, conflict="", not_found="Diese Abstimmung oder dieses Stimmrecht gehört nicht zu dir.")
    return ballot_view(row)
