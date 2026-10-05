"""Turnier-Bracket als Bild (#575): ein PNG wie der Turnierbaum der Website - für den Discord.

Mit Pillow gezeichnet, ohne Browser: je Abschnitt (Winner Bracket, Loser Bracket, Grand Final …) die Runden als
Spalten, je Partie eine Karte mit beiden Namen und dem Ergebnis. Der Sieger steht in Gold, „kampflos“ und „Freilos“ in
Worten, eine laufende Partie mit cyanem Rahmen, eine geplante mit Termin. Halbiert sich eine Runde (K.-o.), verbinden
Linien jede Partie mit ihrer nächsten; bleibt sie gleich groß (Loser Bracket), geht die Linie gerade weiter.

Tabellenphasen (Gruppen, Liga, Swiss) bleiben Text in der Einbettung - ein Bild gibt es nur mit einer K.-o.-Phase.
Sehr große Bäume (mehr als ``MAX_ROUND_MATCHES`` Partien in einer Runde) bleiben ohne Bild; die Einbettung zeigt dann
wie bisher die aktuelle Runde als Text.
"""
from __future__ import annotations

import hashlib
import io
import json
from datetime import datetime

from PIL import Image, ImageDraw

from models import now_utc

FILENAME = "bracket.png"
BOX_W, BOX_H = 250, 58
GAP_X, GAP_Y = 56, 14
MARGIN = 28
HEADER_H = 86
SECTION_LABEL_H = 34
ROUND_LABEL_H = 24
MAX_ROUND_MATCHES = 32
MIN_WIDTH = 640
COLORS = {"bg": (10, 10, 10), "card": (24, 24, 24), "card_done": (20, 20, 20), "border": (56, 56, 56), "live": (41, 182, 232),
          "text": (236, 236, 236), "dim": (128, 128, 128), "gold": (255, 215, 0), "line": (74, 74, 74), "title": (255, 255, 255),
          "section": (41, 182, 232), "final": (255, 215, 0)}


def names_of(registrations: list[dict]) -> dict[str, str]:
    """Anzeigenamen je Anmeldung - dieselbe Regel wie in der Einbettung."""
    names = {}
    for registration in registrations:
        if registration.get("id"):
            names[registration["id"]] = (registration.get("display_name") or registration.get("ingame_name")
                                         or (registration.get("user") or {}).get("display_name") or "Teilnehmer")
    return names


def bracket_sections(matches: list[dict], stages: list[dict]) -> list[dict]:
    """Die K.-o.-Abschnitte in Reihenfolge der Phasen: ``[{"label", "rounds": [[Partie, …], …]}]`` - ohne
    Tabellenphasen und Vorschauen, je Runde nach ``order`` sortiert."""
    from services.discord_bracket import TABLE_STAGE_TYPES, _safe_int, section_label

    stages_by_id = {stage.get("id"): stage for stage in stages if stage.get("id")}
    table_ids = {stage_id for stage_id, stage in stages_by_id.items() if str(stage.get("stage_type") or "") in TABLE_STAGE_TYPES}
    groups: dict[tuple, dict[int, list[dict]]] = {}
    for match in matches:
        if match.get("stage_id") in table_ids or match.get("is_preview"):
            continue
        stage = stages_by_id.get(match.get("stage_id")) or {}
        section = str(match.get("section") or "main").lower()
        key = (_safe_int(stage.get("number"), _safe_int(match.get("stage_number"))), _section_order(section), section)
        groups.setdefault(key, {}).setdefault(_safe_int(match.get("round"), 1), []).append(match)
    out = []
    for (_, _, section), rounds in sorted(groups.items()):
        ordered = [sorted(rounds[number], key=lambda m: _safe_int(m.get("order"), 0)) for number in sorted(rounds)]
        out.append({"label": section_label(section), "rounds": ordered})
    return out


def _section_order(section: str) -> int:
    """Winner Bracket oben, Loser Bracket darunter, die Finals zuletzt."""
    return {"wb": 0, "winner": 0, "main": 0, "lb": 1, "loser": 1, "bronze": 2, "gf": 3, "grand_final": 3, "final": 3}.get(section, 2)


def positions(counts: list[int]) -> list[list[float]]:
    """Mitte jeder Partie je Runde (Abstand zum Abschnittsanfang): die erste Runde gleichmäßig über die Höhe, jede
    halbierte Runde mittig zwischen ihren beiden Vorgängern, eine gleich große auf derselben Höhe, alles andere
    gleichmäßig. Höhe = größte Runde × (Karte + Lücke)."""
    pitch = BOX_H + GAP_Y
    height = max(counts or [0]) * pitch
    out: list[list[float]] = []
    for index, count in enumerate(counts):
        previous = out[-1] if out else []
        if index and len(previous) == count * 2 and count:
            out.append([(previous[2 * i] + previous[2 * i + 1]) / 2 for i in range(count)])
        elif index and len(previous) == count:
            out.append(list(previous))
        else:
            step = height / count if count else pitch
            out.append([step * i + step / 2 for i in range(count)])
    return out


def _slots(match: dict, names: dict[str, str]) -> list[dict]:
    """Beide Zeilen einer Karte: Name, Ergebnis, ob Sieger, ob leer - wie ``match_line`` in der Einbettung."""
    from services.discord_bracket import DONE, _safe_int, _score

    slots = sorted(match.get("slots") or [], key=lambda slot: _safe_int(slot.get("position"), 999))[:2]
    while len(slots) < 2:
        slots.append({})
    results = {row.get("registration_id"): row for row in match.get("results") or []}
    done = str(match.get("status") or "").lower() in DONE
    rows = []
    for slot in slots:
        registration_id = slot.get("registration_id")
        if registration_id:
            name, empty = names.get(registration_id) or "Teilnehmer", False
        else:
            name, empty = ("Freilos" if (slot.get("source") or {}).get("type") == "bye" else "offen"), True
        result = results.get(registration_id) if registration_id else None
        score = _score(result) if done else None
        rows.append({"name": name, "empty": empty, "winner": bool(done and result and result.get("outcome") == "winner"),
                     "score": "" if score is None else str(score)})
    return rows


def _note(match: dict) -> str:
    """Die kleine Zeile unter der Karte: kampflos, live oder der Termin (Wiener Zeit)."""
    from services.discord_bracket import LIVE, VIENNA, _dt

    status = str(match.get("status") or "").lower()
    if status == "forfeit":
        return "kampflos"
    if status in LIVE:
        return "live"
    when = _dt(match.get("scheduled_at"))
    return f"{when.astimezone(VIENNA).strftime('%d.%m., %H:%M')} Uhr" if when and status not in ("completed",) else ""


def signature(sections: list[dict]) -> str:
    """Was das Bild zeigt, als Prüfsumme - ein neues Bild nur, wenn sich daran etwas ändert (auch frühere Runden)."""
    compact = [[[{"status": match.get("status"), "slots": [(slot.get("registration_id"), (slot.get("source") or {}).get("type")) for slot in match.get("slots") or []],
                  "results": sorted((str(row.get("registration_id")), str(row.get("outcome")), str(row.get("score"))) for row in match.get("results") or []),
                  "at": match.get("scheduled_at")} for match in round_matches] for round_matches in section["rounds"]] for section in sections]
    return hashlib.sha1(json.dumps(compact, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")).hexdigest()


def render(tournament: dict, matches: list[dict], stages: list[dict], registrations: list[dict], *, final: bool = False,
           now: datetime | None = None) -> bytes | None:
    """Das Bracket als PNG - oder None (keine K.-o.-Phase, zu groß)."""
    from services.achievement_share import _ellipsis, _font
    from services.discord_bracket import VIENNA, round_label

    sections = bracket_sections(matches, stages)
    if not sections or any(len(round_matches) > MAX_ROUND_MATCHES for section in sections for round_matches in section["rounds"]):
        return None
    names = names_of(registrations)
    columns = max(len(section["rounds"]) for section in sections)
    width = max(MIN_WIDTH, MARGIN * 2 + columns * BOX_W + (columns - 1) * GAP_X)
    layouts = []
    height = HEADER_H
    for section in sections:
        ys = positions([len(round_matches) for round_matches in section["rounds"]])
        body = max((len(round_matches) for round_matches in section["rounds"]), default=1) * (BOX_H + GAP_Y)
        layouts.append((section, ys, height))
        height += SECTION_LABEL_H + ROUND_LABEL_H + body + MARGIN
    height += MARGIN // 2
    image = Image.new("RGB", (width, height), COLORS["bg"])
    draw = ImageDraw.Draw(image)
    title_font, small, name_font, name_bold, label_font = _font(30), _font(15, bold=False), _font(17, bold=False), _font(17), _font(16)

    title = f"{tournament.get('title') or 'Turnier'} – {'Endstand' if final else 'Bracket'}"
    draw.text((MARGIN, 22), _ellipsis(draw, title, title_font, width - 2 * MARGIN), font=title_font, fill=COLORS["final"] if final else COLORS["title"])
    stamp = (now or now_utc()).astimezone(VIENNA).strftime("%d.%m.%Y, %H:%M")
    draw.text((MARGIN, 60), f"{'Endstand' if final else 'Stand'}: {stamp} Uhr", font=small, fill=COLORS["dim"])

    for section, ys, top in layouts:
        if section["label"]:
            draw.text((MARGIN, top + 8), section["label"].upper(), font=label_font, fill=COLORS["section"])
        rounds_top = top + SECTION_LABEL_H
        body_top = rounds_top + ROUND_LABEL_H
        for column, round_matches in enumerate(section["rounds"]):
            x = MARGIN + column * (BOX_W + GAP_X)
            draw.text((x, rounds_top), _ellipsis(draw, round_label(round_matches[0]), small, BOX_W), font=small, fill=COLORS["dim"])
            for row, match in enumerate(round_matches):
                center = body_top + ys[column][row]
                _card(draw, match, names, x, center - BOX_H / 2, fonts=(name_font, name_bold, small))
                if column + 1 < len(section["rounds"]):
                    _connector(draw, ys, column, row, x, body_top)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def _card(draw: ImageDraw.ImageDraw, match: dict, names: dict[str, str], x: float, y: float, *, fonts: tuple) -> None:
    from services.achievement_share import _ellipsis
    from services.discord_bracket import DONE, LIVE

    name_font, name_bold, small = fonts
    status = str(match.get("status") or "").lower()
    border = COLORS["live"] if status in LIVE else COLORS["border"]
    draw.rounded_rectangle((x, y, x + BOX_W, y + BOX_H), radius=6, fill=COLORS["card_done"] if status in DONE else COLORS["card"], outline=border,
                           width=2 if status in LIVE else 1)
    draw.line((x + 8, y + BOX_H / 2, x + BOX_W - 8, y + BOX_H / 2), fill=COLORS["border"], width=1)
    for index, slot in enumerate(_slots(match, names)):
        top = y + 5 + index * (BOX_H / 2)
        font = name_bold if slot["winner"] else name_font
        color = COLORS["gold"] if slot["winner"] else (COLORS["dim"] if slot["empty"] or (status in DONE and not slot["winner"]) else COLORS["text"])
        score_width = draw.textlength(slot["score"], font=font) if slot["score"] else 0
        draw.text((x + 10, top), _ellipsis(draw, slot["name"], font, BOX_W - 28 - score_width), font=font, fill=color)
        if slot["score"]:
            draw.text((x + BOX_W - 10 - score_width, top), slot["score"], font=font, fill=color)
    note = _note(match)
    if note:
        draw.text((x + 2, y + BOX_H + 1), note, font=small, fill=COLORS["live"] if note == "live" else COLORS["dim"])


def _connector(draw: ImageDraw.ImageDraw, ys: list[list[float]], column: int, row: int, x: float, body_top: float) -> None:
    """Linie zur nächsten Runde: halbiert sie sich, im Winkel zur Mitte der nächsten Partie; gleich groß, gerade."""
    here, after = ys[column], ys[column + 1]
    if len(here) == 2 * len(after):
        target = after[row // 2]
    elif len(here) == len(after):
        target = after[row]
    else:
        return
    start_x, end_x = x + BOX_W, x + BOX_W + GAP_X
    mid_x = start_x + GAP_X / 2
    y1, y2 = body_top + here[row], body_top + target
    draw.line((start_x, y1, mid_x, y1), fill=COLORS["line"], width=2)
    draw.line((mid_x, y1, mid_x, y2), fill=COLORS["line"], width=2)
    draw.line((mid_x, y2, end_x, y2), fill=COLORS["line"], width=2)
