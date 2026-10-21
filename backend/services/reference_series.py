"""Externe Serien (#1741): Punkteschema-Vorlagen und das Neurechnen der gespeicherten Stände.

Eine **Spur** (``reference_lineages``, etwa „Lion Racing F1“) ist die Klammer, darunter je Saison und Stufe eine
**Serie** (``reference_series``) mit Kalender (``reference_rounds``), Teilnehmern, Ergebnisblättern je Termin und den
daraus gerechneten Ständen (``reference_standings``). Serien sind keine Turniere: keine Anmeldungen, Matches, Erfolge
oder Saisonpunkte, und keine Sammlung wird mit dem Turnierbereich geteilt.

- **Vorlagen** liegen als Daten in den Einstellungen (``settings``, ``id = points_schemes``) und werden beim Anlegen
  einer Serie kopiert - eine spätere Änderung der Vorlage ändert keine bestehende Serie (Entscheidung 4).
- **Neu gerechnet** wird beim Schreiben: nach einer Regeländerung (und später nach jedem veröffentlichten Ergebnis)
  rechnet ``recompute_standings`` alle Stände der Serie aus Kalender, veröffentlichten Blättern und Teilnehmern -
  öffentliche Seiten lesen nur den gespeicherten Stand.
- **Nacheinander** (``series_write``, ``series_locked``): alles, was Stände einer Saison neu rechnet - Ergebnisse
  speichern, freigeben, verwerfen, alle Kalender-Änderungen, Teilnehmer anlegen und zuordnen, Regeln ändern,
  archivieren und zurückholen - läuft unter einer Sperre je Saison (``services/mutation_lock.py``), samt
  Versionsprüfung, Termin-Status, Aufräumen und Neurechnen. So rechnet nie ein älterer Stand über einen neueren.
- **Andere Saisons** (``follow_aliases_elsewhere``): Zieht eine Zuordnung über den Alias andere Saisons mit, ändert sie
  dort erst nach Freigabe der eigenen Sperre etwas - je Saison unter deren Sperre, Änderung und Neurechnen zusammen,
  nie zwei Sperren ineinander. Ist eine Saison gerade besetzt, merkt sie sich den Nachtrag (``alias_followups``), und
  der nächste Vorgang unter ihrer Sperre zieht ihn nach (``series_write``) - nie halbe Daten in einer Saison. Mehrere
  Aliase auf einmal (Sammelaktion, Zusammenführen, #1929): je Saison die Sperre einmal und einmal neu rechnen.
- **Mehrere zugleich** (``series_write_all``, #1970): nur für die Sichtbarkeit einer Spur bzw. Referenz und ihrer
  Saisons - alle Sperren vorab in fester Reihenfolge, damit bei 409 nichts halb geändert ist.
"""
from __future__ import annotations

import functools
import inspect
import logging
from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import HTTPException

from database import get_db
from models import new_id, now_utc
from services import race_weekend, series_participants
from services.own_teams import own_teams
from services.mutation_lock import MutationLockBusy, mutation_lock, series_write_resource
from services.scoring_rules import normalize_rules

logger = logging.getLogger("tls.reference_series")
SERIES_BUSY = "In dieser Saison wird gerade schon etwas gespeichert. Bitte gleich noch einmal versuchen."
# So lange wartet ein Vorgang auf die Sperre seiner Saison - wie bei Turnieren (mutation_lock-Standard).
SERIES_WAIT_SECONDS = 2.0


async def _catch_up(db, series_id: str) -> None:
    """Unter der Sperre: Nachträge aus Zuordnungen in anderen Saisons, die hier gerade nicht durchkamen
    (``alias_followups``), anwenden und - wenn sich etwas geändert hat - neu rechnen. Ein Fehler darin hält den
    eigentlichen Vorgang nicht auf; der Nachtrag bleibt dann für den nächsten stehen."""
    series = await db.reference_series.find_one({"id": series_id}, {"_id": 0})
    pending = (series or {}).get("alias_followups") or []
    if not pending:
        return
    try:
        changed = []
        for followup in pending:
            changed += await series_participants.follow_alias(db, series_id, followup)
        # Immer neu rechnen, auch wenn diesmal nichts mehr zu ändern war: ein früherer Versuch kann die Teilnehmer schon
        # nachgezogen haben und erst beim Neurechnen gescheitert sein.
        await recompute_standings(db, series)
        # Erst nach dem erfolgreichen Neurechnen austragen: scheitert es, bleibt der Nachtrag für den nächsten Vorgang
        # stehen (das Nachziehen selbst ist wiederholbar).
        await db.reference_series.update_one(
            {"id": series_id}, {"$pull": {"alias_followups": {"id": {"$in": [item.get("id") for item in pending]}}}})
    except Exception:
        logger.exception("Nachträge aus Zuordnungen anderer Saisons ließen sich nicht anwenden")


@asynccontextmanager
async def series_write(db, series_id: str):
    """Sperre je Saison für einen schreibenden Vorgang (Wartezeit wie bei Turnieren). Ist sie zu lange besetzt oder
    geht sie verloren: 409 mit klarer Meldung - nichts halb Geschriebenes. Gleich nach dem Holen zieht sie offene
    Nachträge aus Zuordnungen anderer Saisons nach (``_catch_up``)."""
    try:
        async with mutation_lock(db, series_write_resource(series_id), wait_seconds=SERIES_WAIT_SECONDS):
            await _catch_up(db, series_id)
            yield
    except MutationLockBusy:
        raise HTTPException(409, SERIES_BUSY) from None


@asynccontextmanager
async def series_write_all(db, series_ids):
    """Die Sperren mehrerer Saisons zusammen (#1970: Spur bzw. Referenz und alle verknüpften Saisons). Immer in fester
    Reihenfolge (nach ``id``) geholt, damit zwei solche Vorgänge nie aufeinander warten; jede Sperre wartet höchstens
    ``SERIES_WAIT_SECONDS``. Ist eine besetzt, kommt 409, bevor etwas geändert ist."""
    async with AsyncExitStack() as stack:
        for series_id in sorted({sid for sid in series_ids if sid}):
            await stack.enter_async_context(series_write(db, series_id))
        yield


def series_locked(handler):
    """Decorator für Routen mit ``series_id`` im Pfad: der ganze Vorgang läuft unter ``series_write``. Die Signatur
    wird mit ausgewerteten Typen weitergegeben, damit FastAPI Körper und Abhängigkeiten der Route erkennt."""
    signature = inspect.signature(handler, eval_str=True)

    @functools.wraps(handler)
    async def locked(*args, **kwargs):
        series_id = kwargs["series_id"] if "series_id" in kwargs else args[0]
        async with series_write(get_db(), series_id):
            return await handler(*args, **kwargs)

    locked.__signature__ = signature
    return locked


async def follow_aliases_elsewhere(db, plan: dict[str, list[dict]]) -> tuple[list[str], list[str], list[str]]:
    """Zuordnungen in anderen Saisons nachziehen - erst nach Freigabe der eigenen Sperre aufrufen. ``plan`` nennt je
    Saison ihre Nachträge (ein Alias je Nachtrag; mehrere bei Sammelaktion und Zusammenführen, #1929). Je Saison einmal
    unter ihrer Sperre: Teilnehmer folgen den Aliasen, dann einmal neu rechnen. Ist eine Saison besetzt, merkt sie sich
    die Nachträge (``alias_followups``) für ihren nächsten Vorgang. Liefert (aktualisierte Saisons, wartende Saisons,
    geänderte Teilnehmer)."""
    updated, pending, changed = [], [], []
    for series_id, followups in plan.items():
        try:
            async with series_write(db, series_id):
                moved = []
                for followup in followups:
                    moved += await series_participants.follow_alias(db, series_id, followup)
                series = await db.reference_series.find_one({"id": series_id}, {"_id": 0})
                if moved and series:
                    await recompute_standings(db, series)
        except HTTPException as exc:
            if exc.status_code != 409:
                raise
            requested_at = now_utc().isoformat()
            await db.reference_series.update_one({"id": series_id}, {"$push": {"alias_followups": {"$each": [
                {**followup, "id": new_id(), "requested_at": requested_at} for followup in followups]}}})
            pending.append(series_id)
            continue
        updated.append(series_id)
        changed += moved
    return updated, pending, changed


POINTS_SCHEMES_ID = "points_schemes"
SERIES_KINDS = ("series", "racing", "team_league")

# Vorlagen, die die Migration anlegt (nur, was fehlt - eine bearbeitete Vorlage bleibt). Werte, die der Verein selbst
# festlegt, kommen über die Verwaltung dazu; im Code stehen nur allgemein bekannte Schlüssel.
POINTS_SCHEME_TEMPLATES: tuple[dict, ...] = (
    {
        "id": "organizer",
        "name": "Punkte laut Veranstalter",
        "description": "Die Punkte je Runde stehen in der Ergebnisliste des Veranstalters und werden übernommen.",
        "kinds": list(SERIES_KINDS),
        "rules": {"points_mode": "organizer", "points_by_place": []},
    },
    {
        "id": "formula_1",
        "name": "Formel 1 (25-18-15-12-10-8-6-4-2-1)",
        "description": "Punkte für die ersten zehn, Vorrang nach Plätzen, Teamwertung mit allen Fahrern.",
        "kinds": ["racing", "series"],
        "rules": {"points_mode": "scheme", "points_by_place": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
                  "tiebreakers": ["countback", "latest_result"],
                  "team_scoring": {"enabled": True, "counting_drivers": None, "guests_count": True}},
    },
    {
        "id": "team_league_3_1_0",
        "name": "Team-Liga (Sieg 3, Unentschieden 1, Niederlage 0)",
        "description": "Tabelle nach Punkten, dann Differenz und erzielten Punkten.",
        "kinds": ["team_league"],
        "rules": {"points_mode": "organizer", "points_by_place": [],
                  "match_points": {"win": 3, "draw": 1, "loss": 0},
                  "table_tiebreakers": ["score_diff", "score_for"]},
    },
)


async def points_schemes(db) -> list[dict]:
    """Die Vorlagen aus den Einstellungen, in gespeicherter Reihenfolge."""
    doc = await db.settings.find_one({"id": POINTS_SCHEMES_ID}, {"_id": 0}) or {}
    return [scheme for scheme in doc.get("schemes") or [] if isinstance(scheme, dict) and scheme.get("id")]


async def complete_schemes(db) -> list[dict]:
    """Die Vorlagen mit vollständigen Regeln (Standards ergänzt) - so muss das Formular keine eigenen Standards kennen.
    Eine Vorlage, deren Regeln nicht (mehr) gelten, kommt unverändert, statt die Seite scheitern zu lassen."""
    out = []
    for scheme in await points_schemes(db):
        try:
            rules = normalize_rules(scheme.get("rules") or {})
        except ValueError:
            rules = scheme.get("rules") or {}
        out.append({**scheme, "rules": rules})
    return out


async def add_missing_templates(db) -> int:
    """Legt fehlende Vorlagen an, ohne vorhandene anzufassen. Liefert die Zahl der neuen."""
    present = {scheme["id"] for scheme in await points_schemes(db)}
    missing = [dict(template) for template in POINTS_SCHEME_TEMPLATES if template["id"] not in present]
    if missing:
        await db.settings.update_one(
            {"id": POINTS_SCHEMES_ID},
            {"$push": {"schemes": {"$each": missing}}, "$setOnInsert": {"id": POINTS_SCHEMES_ID}},
            upsert=True,
        )
    return len(missing)


async def recompute_standings(db, series: dict) -> int:
    """Alle Stände einer Serie neu: aus dem Kalender (ohne archivierte Termine), den veröffentlichten Ergebnisblättern
    und den Teilnehmern. Bestehende Stände werden ersetzt, überholte entfernt. Liefert die Zahl der Stände."""
    sid = series["id"]
    rounds = await db.reference_rounds.find({"series_id": sid, "archived_at": None}, {"_id": 0}).to_list(None)
    # Wertung je Lauf (#1930): Termine ohne Handänderung folgen der Vorgabe ihres Laufs - auch nach einer Änderung des
    # Ablaufs oder des Kalenders. Der Kalender bekommt dann einen neuen Stand.
    follow = race_weekend.counts_updates(rounds, series.get("weekend"))
    for round_id, counts in follow.items():
        await db.reference_rounds.update_one({"id": round_id, "series_id": sid}, {"$set": {"counts": counts}})
    if follow:
        await db.reference_series.update_one({"id": sid}, {"$inc": {"calendar_version": 1}})
        rounds = [{**item, "counts": follow[item["id"]]} if item["id"] in follow else item for item in rounds]
    sheets = {row["round_id"]: row async for row in db.reference_round_results.find(
        {"series_id": sid, "status": "published"}, {"_id": 0})}
    participants = await db.reference_participants.find({"series_id": sid}, {"_id": 0}).to_list(None)
    # Mit Punkten je Lauf, Startplatz und Pole aus dem Qualifying (#1930) - ohne Läufe wie ``compute_standings``.
    snapshots = race_weekend.standings(rules=series.get("rules") or {}, rounds=rounds, sheets=sheets,
                                       participants=participants, own_teams=own_teams(series),
                                       weekend=series.get("weekend"))
    computed_at = now_utc().isoformat()
    kept = []
    for snapshot in snapshots:
        key = {"series_id": sid, "round_id": snapshot["round_id"], "scope": snapshot["scope"]}
        await db.reference_standings.update_one(key, {
            "$set": {"round_seq": snapshot["round_seq"], "rows": snapshot["rows"],
                     "rules_version": series.get("rules_version") or 1, "computed_at": computed_at},
            "$setOnInsert": {"id": new_id()},
        }, upsert=True)
        kept.append((snapshot["round_id"], snapshot["scope"]))
    async for stale in db.reference_standings.find({"series_id": sid}, {"_id": 0, "id": 1, "round_id": 1, "scope": 1}):
        if (stale.get("round_id"), stale.get("scope")) not in kept:
            await db.reference_standings.delete_one({"id": stale["id"]})
    return len(snapshots)
