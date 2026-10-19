"""Externe Serien - wer eine Serie bearbeiten darf (#1749).

Zwei Wege, sonst keiner:

- **Vorstand:** der Bereich Redaktion („content“) darf jede Serie - mit bestätigter Zwei-Faktor-Anmeldung, wie jeder
  Verwaltungsbereich (``can_use_area``).
- **Captain:** ein Eintrag in ``reference_series_staff`` für genau diese Serie. Er gilt nur mit bestätigter
  Zwei-Faktor-Anmeldung (Entscheidung 7), nur für aktive Vereinsmitglieder, bis einschließlich ``valid_until`` (Wiener
  Tag, ``club_today``) und nicht in einer archivierten Serie. Geprüft wird bei **jedem** Aufruf aus der Datenbank - nichts wird am Konto zwischengespeichert.

Für Routen, die eine Serie im Pfad haben (``/…/series/{series_id}/…``)::

    @router.post("/admin/series/{series_id}/rounds/{round_id}/result")
    async def save(series_id: str, round_id: str, body: …, access: SeriesAccess = Depends(require_series_editor)):
        round_doc = await access.round(round_id)             # 404, wenn der Termin nicht zu dieser Serie gehört
        status = access.result_status(body.status)            # 403, wenn „published“ ohne Recht zum Veröffentlichen
        …

- ``require_series_editor`` liest ``series_id`` aus dem Pfad; der Parameter muss genau so heißen.
- Kennungen unterhalb der Serie (Termin, Ergebnisblatt, Teilnehmer) nur über ``access.round``, ``access.result`` und
  ``access.participant`` laden: sie suchen immer mit ``series_id`` und antworten sonst mit 404 - so kommt niemand über
  eine Kennung in eine fremde Serie.
- Was nur der Vorstand darf (Serie bearbeiten, archivieren, Captains verwalten, Teilnehmer verknüpfen …), bleibt bei
  ``require_area("content")`` oder ruft ``access.require_board()``.
- Wer veröffentlichen darf, sagt ``access.can_publish``: der Vorstand immer; ein Captain, wenn die Serie auf „direkt“
  steht (``publish_mode``) oder sein Eintrag das Recht hat (``can_publish``). Standard ist für beide „nein“ - Einträge
  eines Captains sind Entwürfe, die der Vorstand freigibt.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from fastapi import Depends, HTTPException

from auth import get_current_user
from database import get_db
from services.dolibarr_policy import club_today
from services.permissions import MFA_MESSAGE, can_use_area, needs_mfa

BOARD = "board"
CAPTAIN = "captain"
NO_RIGHT = "Für diese Serie fehlt dir das Recht. Captains trägt der Vorstand in der Saison ein."
EXPIRED = "Dein Captain-Recht für diese Serie ist abgelaufen. Verlängern kann es der Vorstand."
ARCHIVED = "Diese Serie ist archiviert. Ändern kann sie nur noch der Vorstand."
NOT_MEMBER = "Captain-Rechte gelten nur für aktive Vereinsmitglieder. Bei Fragen zur Mitgliedschaft hilft der Vorstand."
BOARD_ONLY = "Das darf nur der Vorstand (Bereich Redaktion)."
PUBLISH_ONLY_BOARD = "Veröffentlichen gibt in dieser Serie der Vorstand frei. Speichere den Eintrag als Entwurf."

# Was ein Captain von Saison und Spur sieht - ausdrücklich, damit neue Verwaltungsfelder nicht von selbst hinausgehen.
CAPTAIN_SERIES_FIELDS = (
    "id", "lineage_id", "season", "tier", "title", "season_slug", "status", "publish_mode", "default_weekday",
    "default_time", "rules", "rules_version", "rules_note", "team_name", "official_table_url", "external_url",
)
CAPTAIN_LINEAGE_FIELDS = ("id", "title", "kind", "label", "organizer", "game_id", "game_name")


def staff_is_valid(staff: dict | None, today: str | None = None) -> bool:
    """Gilt der Eintrag heute? Ohne gültiges Ablaufdatum gilt er nie - ein fehlendes Datum heißt nicht „für immer“."""
    if not staff:
        return False
    until = staff.get("valid_until")
    if isinstance(until, date):
        until = until.isoformat()
    if not isinstance(until, str):
        return False
    try:
        until = date.fromisoformat(until.strip()).isoformat()
    except ValueError:
        return False
    return (today or club_today()) <= until


async def active_member_ids(db, user_ids) -> set[str]:
    """Wer von diesen Konten heute aktives Vereinsmitglied ist (aktiv oder Ehrenmitglied) - Captain kann nur sein, wer
    Mitglied ist (Entscheidung des Obmanns). Endet die Mitgliedschaft, endet damit auch das Captain-Recht."""
    from services.membership_service import ACTIVE_STATUSES

    wanted = sorted({user_id for user_id in user_ids if user_id})
    if not wanted:
        return set()
    rows = db.memberships.find({"user_id": {"$in": wanted}, "member_status": {"$in": sorted(ACTIVE_STATUSES)}},
                               {"_id": 0, "user_id": 1})
    return {row["user_id"] async for row in rows if row.get("user_id")}


def captain_may_publish(series: dict, staff: dict) -> bool:
    return series.get("publish_mode") == "direct" or staff.get("can_publish") is True


@dataclass
class SeriesAccess:
    """Was die angemeldete Person in dieser einen Serie darf - Ergebnis von ``require_series_editor``."""

    user: dict
    series: dict
    role: str  # "board" oder "captain"
    can_publish: bool
    staff: dict | None = field(default=None)

    @property
    def series_id(self) -> str:
        return self.series["id"]

    @property
    def is_board(self) -> bool:
        return self.role == BOARD

    def require_board(self) -> None:
        if not self.is_board:
            raise HTTPException(403, BOARD_ONLY)

    def result_status(self, requested: str | None) -> str:
        """Der Status, mit dem ein Ergebnisblatt gespeichert werden darf: „draft“ immer, „published“ nur mit Recht.
        Ohne Recht wird nicht still zum Entwurf umgebogen, sondern abgelehnt - die Oberfläche fragt ``can_publish``."""
        status = requested or "draft"
        if status == "published" and not self.can_publish:
            raise HTTPException(403, PUBLISH_ONLY_BOARD)
        return status

    def summary(self) -> dict:
        """Für die Oberfläche: Rolle und Veröffentlichen-Recht (Knöpfe zeigen, nicht prüfen - geprüft wird hier)."""
        out = {"role": self.role, "can_publish": self.can_publish}
        if self.staff:
            out["valid_until"] = self.staff.get("valid_until")
        return out

    def series_view(self, lineage: dict | None) -> dict:
        """Die Saison für die Verwaltungsseite: der Vorstand bekommt alles, ein Captain nur, was er zum Eintragen
        braucht (``CAPTAIN_SERIES_FIELDS``, ``CAPTAIN_LINEAGE_FIELDS``) - keine Ersteller- oder Änderer-Kennungen, keine
        Regel-Historie, keine Sichtbarkeit oder Partner. Neue Felder erscheinen für Captains erst, wenn sie hier stehen."""
        if self.is_board:
            view = dict(self.series)
            view["lineage"] = lineage
        else:
            view = {key: self.series.get(key) for key in CAPTAIN_SERIES_FIELDS}
            view["lineage"] = {key: (lineage or {}).get(key) for key in CAPTAIN_LINEAGE_FIELDS} if lineage else None
        view["access"] = self.summary()
        return view

    def _scoped(self, found: dict | None, missing: str) -> dict:
        if not found:
            raise HTTPException(404, missing)
        return found

    async def round(self, round_id: str) -> dict:
        found = await get_db().reference_rounds.find_one({"id": round_id, "series_id": self.series_id}, {"_id": 0})
        return self._scoped(found, "Termin nicht gefunden.")

    async def result(self, result_id: str) -> dict:
        found = await get_db().reference_round_results.find_one(
            {"id": result_id, "series_id": self.series_id}, {"_id": 0})
        return self._scoped(found, "Ergebnis nicht gefunden.")

    async def participant(self, participant_id: str) -> dict:
        found = await get_db().reference_participants.find_one(
            {"id": participant_id, "series_id": self.series_id}, {"_id": 0})
        return self._scoped(found, "Teilnehmer nicht gefunden.")


async def series_access(user: dict | None, series_id: str, db=None) -> SeriesAccess:
    """Die Prüfung selbst - auch ohne FastAPI nutzbar (Dienste, Tests). Wirft 401/403/404."""
    if not user:
        raise HTTPException(401, "Nicht angemeldet")
    db = db if db is not None else get_db()
    if await can_use_area(user, "content", db=db):
        series = await db.reference_series.find_one({"id": series_id}, {"_id": 0})
        if not series:
            raise HTTPException(404, "Serie nicht gefunden.")
        return SeriesAccess(user=user, series=series, role=BOARD, can_publish=True)
    # Ab hier nur noch Captains. Ob es die Serie gibt, erfährt nur, wer dort eingetragen ist.
    if needs_mfa(user):
        raise HTTPException(403, MFA_MESSAGE)
    staff = await db.reference_series_staff.find_one(
        {"series_id": series_id, "user_id": user["id"], "role": CAPTAIN}, {"_id": 0})
    if not staff:
        raise HTTPException(403, NO_RIGHT)
    if not staff_is_valid(staff):
        raise HTTPException(403, EXPIRED)
    if user["id"] not in await active_member_ids(db, [user["id"]]):
        raise HTTPException(403, NOT_MEMBER)
    series = await db.reference_series.find_one({"id": series_id}, {"_id": 0})
    if not series:
        raise HTTPException(403, NO_RIGHT)
    if series.get("status") == "archived":
        raise HTTPException(403, ARCHIVED)
    return SeriesAccess(user=user, series=series, role=CAPTAIN, can_publish=captain_may_publish(series, staff),
                        staff=staff)


async def require_series_editor(series_id: str, user: dict = Depends(get_current_user)) -> SeriesAccess:
    """FastAPI-Abhängigkeit für Routen mit ``{series_id}`` im Pfad: Vorstand oder gültiger Captain dieser Serie."""
    return await series_access(user, series_id)


async def captain_series(db, user: dict | None, today: str | None = None) -> list[dict]:
    """„Meine Serien“: die Serien, in denen die Person heute Captain ist (nicht archiviert), mit Spur und Ablauf.
    Leer für alle anderen - auch für den Vorstand, der alle Serien in der Verwaltung sieht."""
    if not user:
        return []
    today = today or club_today()
    rows = [row async for row in db.reference_series_staff.find(
        {"user_id": user["id"], "role": CAPTAIN}, {"_id": 0}) if staff_is_valid(row, today)]
    if not rows or user["id"] not in await active_member_ids(db, [user["id"]]):
        return []
    by_series = {row["series_id"]: row for row in rows if row.get("series_id")}
    series = await db.reference_series.find(
        {"id": {"$in": sorted(by_series)}, "status": {"$ne": "archived"}}, {"_id": 0}).to_list(None)
    lineage_ids = sorted({item.get("lineage_id") for item in series if item.get("lineage_id")})
    lineages = {row["id"]: row async for row in db.reference_lineages.find(
        {"id": {"$in": lineage_ids}}, {"_id": 0, "id": 1, "title": 1, "kind": 1, "label": 1})}
    out = []
    for item in series:
        staff = by_series[item["id"]]
        lineage = lineages.get(item.get("lineage_id")) or {}
        out.append({
            "id": item["id"], "season": item.get("season"), "tier": item.get("tier"), "title": item.get("title"),
            "status": item.get("status"), "lineage_title": lineage.get("title"), "lineage_kind": lineage.get("kind"),
            "valid_until": staff.get("valid_until"), "can_publish": captain_may_publish(item, staff),
            "url": f"/admin/reference-series/{item['id']}",
        })
    out.sort(key=lambda row: (str(row.get("lineage_title") or "").casefold(), str(row.get("season") or "")))
    return out


async def has_captain_series(db, user: dict | None) -> bool:
    return bool(await captain_series(db, user))
