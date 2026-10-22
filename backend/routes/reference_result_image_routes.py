"""Externe Serien - Ergebnis-Bild auslesen (#1756): einen Screenshot des Veranstalters auf dem eigenen Server lesen
(Tesseract, kein externer Dienst) und als Zeilen für die Vorschau des Ergebnis-Blatts (#1744) zurückgeben.

Rechte wie beim Eintragen: Vorstand (Bereich Redaktion) und gültige Captains der Saison (``require_series_editor``,
#1749); der Termin muss zur Serie aus dem Pfad gehören. Gespeichert wird **nichts** - weder das Bild noch ein
Ergebnis. Erst wenn jemand die Zeilen im Blatt prüft (unsichere sind gelb) und übernimmt, entsteht ein Blatt über
``PUT …/results``.

**GET …/results/image** - ob und mit welcher Vorlage ausgelesen werden kann::

    {template: {id, name, fields, header} | null, available, max_mb, formats}

``available`` ist falsch, wenn es keine Vorlage gibt (Art ohne Vorlage oder abgeschaltet) oder Tesseract auf dem
Server fehlt.

**POST …/results/image** - Body ist das Bild selbst (PNG, JPG oder WebP, ``Content-Type`` beliebig; geprüft wird der
Inhalt). Antwort::

    {template, rows: [{index, place, dnf, marks, start_number, name, participant_id, team, grid, time, gap, points,
                       color, uncertain: [Feld], read: {Feld: gelesen}}],
     track: {name, uncertain} | null, session: {name, kind: race|sprint|qualifying} | null,
     fastest_lap | pole: {name, participant_id, time, uncertain, read} | null,
     driver_of_the_day: {name, participant_id, uncertain, read} | null, uncertain_rows,
     team_colors: {Team: "#rrggbb"}, suggested_round: {id, code, venue, club_day} | null,
     warnings: [{code, message}]}

``session`` und ``suggested_round`` (der Termin, zu dem die Strecke im Bild passt) sind nur Hinweise; ``color`` und
``team_colors`` (Schriftfarbe von Startnummer bzw. Team) sind ein Vorschlag für Teamfarben - gespeichert wird nichts.
Saisontabellen und Kalender (keine Zeiten) lehnt die Route mit 422 ab - dafür gibt es
``GET``/``POST /admin/series/{series_id}/season-table/image?table=drivers|teams`` (#1999, nur Vorstand): die Saison-
bzw. Teamtabelle des Veranstalters mit denselben Grenzen, demselben Rate-Limit und derselben Warteschlange; Antwort
``{template, kind, detected, columns: [{label, kind}], rows: [{cells, uncertain, read, notes}], uncertain_cells,
warnings}`` (``services/result_image_table.py``).

- **Grenzen:** Größe ``MAX_IMAGE_UPLOAD_MB`` (schon am Kopf der Anfrage geprüft), Pixel ``MAX_IMAGE_PIXELS`` (am Kopf
  der Bilddatei, vor dem Dekodieren) - wie bei jedem Bild-Upload (``services/image_upload.py``). Das Bild wird nur im
  Speicher gelesen; die Anfrage wird dafür nicht als Formular (mit Zwischendatei) angenommen.
- **Rate-Limit** je Konto: ``RESULT_IMAGE_RATE_LIMIT`` Bilder je ``RESULT_IMAGE_RATE_WINDOW_SECONDS`` (Standard 30 in
  10 Minuten), je Konto ein Bild zur Zeit; gleichzeitig liest der Server höchstens ``RESULT_IMAGE_CONCURRENCY`` Bilder
  (Standard 1). Dekodiert wird erst mit einem freien Platz - wer wartet, hält nur die Datei, kein entpacktes Bild.
- **Zeitbudget** je Bild (``RESULT_IMAGE_OCR_BUDGET_SECONDS``, Standard 60): reicht es nicht für die Seite, kommt 422;
  reicht es nur nicht für die zweiten Lesungen, ist der Rest gelb (Warnung ``out_of_time``).
- **Datenschutz:** Aliase der Mitglieder helfen beim Wiedererkennen nur, wenn der Vorstand liest (wie in #1743);
  Captains bekommen nur, was sie im Blatt ohnehin sehen (Name und Kennung der Teilnehmer).
- Meldungen sind feste Texte, nie aus einer Ausnahme gebaut. Lesen und Abgleich: ``services/result_image_ocr.py`` und
  ``services/result_image_match.py``, Vorlagen: ``services/result_image_templates.py``.
"""
from __future__ import annotations

import asyncio
import functools
import logging
import os
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from database import get_db
from routes.reference_result_routes import MAX_ROWS
from routes.reference_season_table_routes import known_teams
from services import result_image_match, result_image_ocr, result_image_table, result_image_templates, season_table
from services.image_upload import MAX_BYTES, MAX_IMAGE_UPLOAD_MB
from services.rate_limit import enforce_rate_limit, keyed_subject
from services.reference_series_access import SeriesAccess, require_series_editor
from services.scoring_rules import counted_results, normalize_rules
from services.series_identity import normalize_name
from services.series_participants import series_game_id

logger = logging.getLogger("tls-arena.result-image")
router = APIRouter(prefix="/api/reference-series", tags=["reference-series"])

BASE = "/admin/series/{series_id}/rounds/{round_id}/results/image"
FORMATS = ["image/png", "image/jpeg", "image/webp"]


def _env_int(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


RATE_LIMIT = _env_int("RESULT_IMAGE_RATE_LIMIT", 30)
RATE_WINDOW_SECONDS = _env_int("RESULT_IMAGE_RATE_WINDOW_SECONDS", 600)
CONCURRENCY = _env_int("RESULT_IMAGE_CONCURRENCY", 1)
QUEUE_SECONDS = 30
_gate = asyncio.Semaphore(CONCURRENCY)
_reading_accounts: set[str] = set()  # Konten, deren Bild dieser Prozess gerade liest - je Konto eins zur Zeit

NO_TEMPLATE = ("Für diese Serie ist keine Vorlage für Ergebnis-Bilder festgelegt. Der Vorstand wählt sie bei Spur oder "
               "Saison.")
UNAVAILABLE = "Die Texterkennung ist auf dem Server gerade nicht verfügbar. Bitte die Liste einfügen oder abtippen."
BUSY = "Gerade wird schon ein Bild gelesen. Bitte gleich noch einmal versuchen."
BUSY_ACCOUNT = "Dein letztes Bild wird noch gelesen. Bitte warte, bis es fertig ist."
TOO_SLOW = ("Das Bild braucht zu lange zum Lesen. Bitte nur die Ergebnistabelle als Screenshot einfügen - oder die "
            "Liste einfügen.")
OUT_OF_TIME = "Das Bild war zu aufwendig, um alles zweimal zu lesen - die gelben Felder bitte genau prüfen."
TOO_MANY = "Zu viele Bilder in kurzer Zeit. Bitte warte noch {wait}."
NO_TABLE = ("Im Bild wurde keine Ergebnistabelle gefunden. Passt die Vorlage zum Bild? Sonst die Liste einfügen oder "
            "abtippen.")
NOT_A_RESULT = ("Das Bild sieht nicht nach einem Rennergebnis aus (keine Zeiten) - etwa eine Saisontabelle oder der "
                "Kalender? Bitte das Ergebnis dieses Termins einfügen.")
TOO_MANY_ROWS = (f"Im Bild stehen mehr als {MAX_ROWS} Ergebniszeilen - so viele nimmt ein Ergebnis-Blatt nicht. Bitte "
                 "nur das Ergebnis dieses Termins einfügen.")
BLURRY = "Das Bild ist unscharf oder sehr klein - bitte die gelben Felder genau prüfen."
NO_HEADER = "Die Kopfzeile der Tabelle wurde nicht erkannt - die Spalten sind nach der Vorlage geschätzt."
PARTICIPANT_FIELDS = {"_id": 0, "id": 1, "name": 1, "start_number": 1, "default_team": 1, "link": 1, "profile_id": 1,
                      "guest_name": 1}


async def _template(db, series: dict) -> dict | None:
    lineage = await db.reference_lineages.find_one({"id": series.get("lineage_id")},
                                                   {"_id": 0, "kind": 1, "result_image_template": 1}) or {}
    return result_image_templates.get(result_image_templates.effective_id(series, lineage))


async def _body(request: Request) -> bytes:
    """Der Body als Bytes, höchstens ``MAX_BYTES`` - die angegebene Länge wird vor dem Lesen geprüft."""
    declared = request.headers.get("content-length") or ""
    if declared.isdigit() and int(declared) > MAX_BYTES:
        raise HTTPException(413, result_image_ocr.TOO_LARGE)
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BYTES:
            raise HTTPException(413, result_image_ocr.TOO_LARGE)
        chunks.append(chunk)
    return b"".join(chunks)


def _no_team_names(series: dict) -> list[str]:
    """Einträge „kein Team“ der Saison (#1960, etwa „Ersatzfahrer“) - sie bleiben beim Lesen stehen."""
    try:
        return normalize_rules(series.get("rules") or {})["team_scoring"]["no_team_names"]
    except ValueError:
        return normalize_rules({})["team_scoring"]["no_team_names"]


async def _aliases(db, series: dict, participants: list[dict]) -> list[dict]:
    """Aliase, die auf Teilnehmer dieser Saison zeigen (Mitglied über das Profil, Gast über den Namen) - für das Spiel
    der Spur oder für alle Spiele. Nur für den Vorstand."""
    by_profile = {row["profile_id"]: row["id"] for row in participants
                  if row.get("link") == "member" and row.get("profile_id")}
    by_guest = {normalize_name(row["guest_name"]): row["id"] for row in participants
                if row.get("link") == "guest" and row.get("guest_name")}
    if not by_profile and not by_guest:
        return []
    game_id = await series_game_id(db, series)
    guest_names = sorted({row["guest_name"] for row in participants
                          if row.get("link") == "guest" and row.get("guest_name")})
    rows = await db.reference_aliases.find(
        {"$or": [{"profile_id": {"$in": sorted(by_profile)}}, {"guest_name": {"$in": guest_names}}]},
        {"_id": 0, "name": 1, "target": 1, "profile_id": 1, "guest_name": 1, "game_id": 1}).to_list(2000)
    out = []
    for alias in rows:
        if alias.get("game_id") not in (game_id, None) or not alias.get("name"):
            continue
        pid = (by_guest.get(normalize_name(alias.get("guest_name"))) if alias.get("target") == "guest"
               else by_profile.get(alias.get("profile_id")))
        if pid:
            out.append({"name": alias["name"], "participant_id": pid})
    return out


async def _suggested_round(db, series_id: str, round_doc: dict, track: str) -> dict | None:
    """Der Termin der Saison, zu dem die Strecke im Bild passt - wenn es nicht dieser ist. Nur ein Vorschlag."""
    if not track:
        return None
    rounds = await db.reference_rounds.find(
        {"series_id": series_id, "archived_at": None},
        {"_id": 0, "id": 1, "code": 1, "title": 1, "venue": 1, "club_day": 1, "order": 1}).to_list(500)

    def score(item: dict) -> float:
        return max((result_image_match.similarity(track, str(item.get(key) or "")) for key in ("venue", "title")),
                   default=0.0)

    scored = sorted(((score(item), item) for item in rounds), key=lambda pair: (-pair[0], pair[1].get("order") or 0))
    if not scored or scored[0][0] < 0.72 or scored[0][1]["id"] == round_doc["id"]:
        return None
    if score(round_doc) >= scored[0][0]:
        return None
    best = scored[0][1]
    return {key: best.get(key) for key in ("id", "code", "venue", "club_day")}


def _warnings(reading: result_image_ocr.Reading, built: dict, round_doc: dict, suggestion: dict | None) -> list[dict]:
    out = []
    if not reading.header_found:
        out.append({"code": "no_header", "message": NO_HEADER})
    if reading.out_of_time:
        out.append({"code": "out_of_time", "message": OUT_OF_TIME})
    if reading.text_height < 8 or reading.mean_conf < 85:
        out.append({"code": "blurry", "message": BLURRY})
    venue = str(round_doc.get("venue") or "").strip()
    track = (built.get("track") or {}).get("name") or ""
    if suggestion:
        label = " · ".join(str(part) for part in (suggestion.get("code"), suggestion.get("venue")) if part)
        out.append({"code": "other_track", "message": (
            f"Im Bild steht „{track[:80]}“ - das passt zum Termin {label[:100]}, nicht zu diesem. Richtiger Termin?")})
    elif venue and track and result_image_match.similarity(track, venue) < 0.72:
        out.append({"code": "other_track", "message": (
            f"Im Bild steht die Strecke „{track[:80]}“, beim Termin „{venue[:80]}“ - richtiges Bild?")})
    return out


async def _read_in_turn(body: bytes, template: dict, reader=None, max_rows: int = MAX_ROWS):
    """Mit freiem Platz (``_gate``) dekodieren und lesen - wartende Anfragen halten nur die Datei. ``reader``: wie
    gelesen wird (Ergebnis: ``result_image_ocr.read``, Saisontabelle: ``result_image_table.read_table``)."""
    try:
        await asyncio.wait_for(_gate.acquire(), timeout=QUEUE_SECONDS)
    except asyncio.TimeoutError:
        raise HTTPException(503, BUSY) from None
    started = time.monotonic()
    try:
        opened = await asyncio.to_thread(result_image_ocr.open_image, body)
        del body
        if opened.image is None:
            raise HTTPException(opened.status, opened.message)
        # Höchstens so viele Zeilen wie die Vorschau nimmt - dieselbe Grenze (``MAX_ROWS`` bzw. die der Saisontabelle).
        return await asyncio.to_thread(reader or result_image_ocr.read, opened.image, template,
                                       max_rows=max_rows), started
    except result_image_ocr.OcrUnavailable:
        raise HTTPException(503, UNAVAILABLE) from None
    except result_image_ocr.OutOfTime:
        raise HTTPException(422, TOO_SLOW) from None
    finally:
        _gate.release()


# ---------------------------------------------------------------- Saison- und Teamtabelle (#1999)
TABLE_BASE = "/admin/series/{series_id}/season-table/image"
NO_SEASON_TABLE = ("Im Bild wurde keine Tabelle mit Namen und Punkten gefunden. Bitte nur die Tabelle als Screenshot "
                   "einfügen - oder den Text einfügen.")
TOO_MANY_TABLE_ROWS = (f"Im Bild stehen mehr als {season_table.MAX_ROWS} Zeilen - so viele nimmt die Saisontabelle "
                       "nicht.")
TEAM_LEAGUE_TABLE = "In der Team-Liga gilt die Tabelle laut Veranstalter im Ergebnisblatt des Spieltags."


def _table_template() -> dict:
    return {"id": result_image_table.TEMPLATE["id"], "name": result_image_table.TEMPLATE["name"]}


async def _sum_explainer(db, series: dict, participants: list[dict], rounds_in_table: int):
    """Erklärt eine Abweichung „Summe der Runden ≠ Punkte“ einer Fahrertabelle wie beim Text-Einfügen
    (``season_table.explain_total``): Streichresultate nach den Regeln der Saison, Aktivitätspunkte und Anpassungen
    (#1960) des Fahrers. ``None``, wenn die Regeln sich nicht anwenden lassen."""
    try:
        rules = normalize_rules(series.get("rules") or {})
    except ValueError:
        return None
    calendar = await db.reference_rounds.count_documents(
        {"series_id": series["id"], "archived_at": None, "status": {"$ne": "cancelled"}})
    total_rounds = max(calendar, rounds_in_table, int(series.get("planned_rounds") or 0))  # #2015: geplante Termine
    by_name = {row.get("name"): row["id"] for row in participants if row.get("name")}
    adjusted: dict[str, float] = {}
    for item in series.get("adjustments") or []:
        if item.get("kind", "participant") == "participant" and item.get("participant_id"):
            adjusted[item["participant_id"]] = adjusted.get(item["participant_id"], 0) + (item.get("points") or 0)
    activity = rules["activity_points"]

    def explain(name: str, values: list, summed, total) -> str | None:
        results = [{"round_id": str(index), "seq": index + 1, "points": value}
                   for index, value in enumerate(values) if value is not None]
        _, gone = counted_results(results, rules, total_rounds)
        dropped = sum(item["points"] for item in results if item["round_id"] in set(gone))
        bonus = activity["points"] * sum(1 for item in results if item["seq"] >= activity["from_round"])
        parts = {"dropped": -dropped, "activity": bonus, "adjustment": adjusted.get(by_name.get(name), 0)}
        out = season_table.explain_total(summed, total, parts)
        if out["state"] != "explained":
            return None
        return " · ".join(f"{item['text']} {'+' if item['points'] > 0 else '−'}{abs(item['points'])}"
                          for item in out["explains"])

    return explain


def _table_warnings(reading) -> list[dict]:
    out = []
    if not reading.header_found:
        out.append({"code": "no_header", "message": NO_HEADER})
    if reading.out_of_time:
        out.append({"code": "out_of_time", "message": OUT_OF_TIME})
    if reading.text_height < 8 or reading.mean_conf < 75:
        out.append({"code": "blurry", "message": BLURRY})
    return out


@router.get(TABLE_BASE)
async def season_table_image_info(series_id: str, access: SeriesAccess = Depends(require_series_editor)):
    """Ob der Server eine Saison- bzw. Teamtabelle lesen kann (nur Vorstand)."""
    access.require_board()
    return {"template": _table_template(), "available": result_image_ocr.available(),
            "max_mb": MAX_IMAGE_UPLOAD_MB, "formats": FORMATS}


@router.post(TABLE_BASE)
async def read_season_table_image(series_id: str, request: Request,
                                  table: Literal["drivers", "teams"] = Query("drivers"),
                                  access: SeriesAccess = Depends(require_series_editor)):
    """Saison- bzw. Teamtabelle lesen (#1999) - wie ein Ergebnis-Bild mit Grenzen, Rate-Limit und gelb = unsicher;
    ``NOT_A_RESULT`` gilt hier nicht (Tabellen haben keine Zeiten). Speichert nichts."""
    access.require_board()
    db = get_db()
    lineage = await db.reference_lineages.find_one({"id": access.series.get("lineage_id")}, {"_id": 0, "kind": 1}) or {}
    if lineage.get("kind") == "team_league":
        raise HTTPException(409, TEAM_LEAGUE_TABLE)
    if not result_image_ocr.available():
        raise HTTPException(503, UNAVAILABLE)
    await enforce_rate_limit(request, "result_image", RATE_LIMIT, RATE_WINDOW_SECONDS,
                             subject=keyed_subject(access.user["id"]), message=TOO_MANY)
    account = access.user["id"]
    if account in _reading_accounts:
        raise HTTPException(429, BUSY_ACCOUNT)
    _reading_accounts.add(account)
    try:
        # Die Summenprobe hängt an der Art der Tabelle - sie kommt erst nach dem Abgleich der Namen.
        reader = functools.partial(result_image_table.read_table, sums=False)
        reading, started = await _read_in_turn(await _body(request), result_image_table.TEMPLATE, reader=reader,
                                               max_rows=season_table.MAX_ROWS)
    finally:
        _reading_accounts.discard(account)
    if reading.too_many_rows:
        raise HTTPException(422, TOO_MANY_TABLE_ROWS)
    if not reading.rows or "name" not in reading.kinds:
        raise HTTPException(422, NO_SEASON_TABLE)
    participants = await db.reference_participants.find({"series_id": series_id}, PARTICIPANT_FIELDS).to_list(None)
    # Eine Team-Tabelle bleibt eine, auch wenn sie in „Saisontabelle einlesen“ landet (die Namensspalte heißt „Team“).
    table = "teams" if reading.detected == "teams" else table
    if table == "teams":
        known = {name: name for name in await known_teams(db, access.series, participants)}
    else:
        # Teilnehmer der Saison; Aliase der Mitglieder (nur Vorstand, wie #1743) führen zum Namen des Teilnehmers.
        by_id = {row["id"]: row.get("name") for row in participants if row.get("name")}
        known = {name: name for name in by_id.values()}
        for alias in await _aliases(db, access.series, participants):
            if by_id.get(alias["participant_id"]):
                known.setdefault(alias["name"], by_id[alias["participant_id"]])
    result_image_table.match_names(reading, known)
    if table == "teams":
        # „Punkte“ einer Teamtabelle ist oft die aktuelle Besetzung (#1960), die Zellen sind je Rennen - nur Hinweis.
        result_image_table.check_sums(reading, strict=False)
    else:
        rounds = reading.kinds.count("round")
        result_image_table.check_sums(reading, strict=True,
                                      explain=await _sum_explainer(db, access.series, participants, rounds))
    payload = result_image_table.to_payload(reading, kind=table)
    logger.info("[result-image] table %s rows (%s uncertain cells) in %.1fs", len(payload["rows"]),
                payload["uncertain_cells"], time.monotonic() - started)
    return {"template": _table_template(), **payload, "warnings": _table_warnings(reading)}


@router.get(BASE)
async def result_image_info(series_id: str, round_id: str, access: SeriesAccess = Depends(require_series_editor)):
    """Welche Vorlage gilt und ob der Server lesen kann."""
    await access.round(round_id)
    template = await _template(get_db(), access.series)
    return {"template": result_image_templates.summary(template),
            "available": bool(template) and result_image_ocr.available(),
            "max_mb": MAX_IMAGE_UPLOAD_MB, "formats": FORMATS}


@router.post(BASE)
async def read_result_image(series_id: str, round_id: str, request: Request,
                            access: SeriesAccess = Depends(require_series_editor)):
    """Das Bild lesen und als Zeilen zurückgeben - speichert nichts."""
    db = get_db()
    round_doc = await access.round(round_id)
    template = await _template(db, access.series)
    if template is None:
        raise HTTPException(409, NO_TEMPLATE)
    if not result_image_ocr.available():
        raise HTTPException(503, UNAVAILABLE)
    await enforce_rate_limit(request, "result_image", RATE_LIMIT, RATE_WINDOW_SECONDS,
                             subject=keyed_subject(access.user["id"]), message=TOO_MANY)
    # Je Konto ein Bild zur Zeit - so stellt niemand viele große Dateien in die Warteschlange.
    account = access.user["id"]
    if account in _reading_accounts:
        raise HTTPException(429, BUSY_ACCOUNT)
    _reading_accounts.add(account)
    try:
        reading, started = await _read_in_turn(await _body(request), template)
    finally:
        _reading_accounts.discard(account)
    if reading.too_many_rows:
        raise HTTPException(422, TOO_MANY_ROWS)

    participants = await db.reference_participants.find({"series_id": series_id}, PARTICIPANT_FIELDS).to_list(None)
    aliases = await _aliases(db, access.series, participants) if access.is_board else []
    built = result_image_match.build(reading, template, participants, aliases=aliases,
                                     no_team_names=_no_team_names(access.series))
    logger.info("[result-image] read %s rows (%s uncertain) in %.1fs", len(built["rows"]), built["uncertain_rows"],
                time.monotonic() - started)
    if not built["rows"]:
        raise HTTPException(422, NO_TABLE)
    if not built.pop("is_result"):
        raise HTTPException(422, NOT_A_RESULT)
    suggestion = await _suggested_round(db, series_id, round_doc, (built.get("track") or {}).get("name") or "")
    return {"template": result_image_templates.summary(template), **built, "suggested_round": suggestion,
            "warnings": _warnings(reading, built, round_doc, suggestion)}
