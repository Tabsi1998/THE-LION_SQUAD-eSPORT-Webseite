"""Fehler-Sammler (#1657): was von einem Fehler gespeichert wird - und was nie.

Gespeichert werden nur Fehlerart, Stelle (Code-Zeilen ohne Werte), Version und der Pfad ohne Abfrage und Kennungen.
Der Meldungstext einer Ausnahme bleibt draußen: Er kann Namen, E-Mail-Adressen, Tokens, IP-Adressen und Inhalte
enthalten, und Namen lassen sich nicht sicher erkennen. Darum wird nicht nach Personendaten gesucht und ausgeschnitten,
sondern umgekehrt nur übernommen, was sicher Code ist:

- Server: aus dem Traceback Datei, Zeile und Funktionsname je Stufe - nie Quelltext, nie Werte, nie die Meldung.
- Browser und App: aus dem Stack nur Zeilen, die wie eine Code-Stelle aussehen (``name (datei.js:12:3)``); von der
  Adresse bleibt der Dateiname ohne Hash und Abfrage, vom Namen nur Zeichen eines Bezeichners. Alles andere fällt weg.
- Pfade: Vorlage wie ``/news/:slug``; was eine Kennung, ein Slug oder ein Name sein kann, wird zum Platzhalter.

Alles ohne reguläre Ausdrücke auf Eingaben - nur Zeichenlisten und ``split``.
"""
from __future__ import annotations

import os
import string
import traceback
from pathlib import Path

TYPE_LIMIT = 80
VERSION_LIMIT = 40
ROUTE_LIMIT = 120
FRAME_LIMIT = 40
LINE_SCAN_LIMIT = 400
NAME_LIMIT = 80
FILE_LIMIT = 80

_IDENT = set(string.ascii_letters + string.digits + "_$.<>")
_TYPE_CHARS = set(string.ascii_letters + string.digits + "_. ")
_VERSION_CHARS = set(string.ascii_letters + string.digits + ".+-_")
_FILE_CHARS = set(string.ascii_letters + string.digits + "._-")
_SEGMENT_CHARS = set(string.ascii_lowercase + "-_")
# Dateiendungen von Code - ein „Ort“ mit anderer Endung (etwa eine Adresse in der Meldung) ist keine Code-Stelle.
CODE_EXTENSIONS = (".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".bundle", ".hbc", ".py")
BACKEND_DIR = Path(__file__).resolve().parents[1]

# Wie ``vitalsRoute`` im Web: unter diesen Wurzeln ist der zweite Teil ein Slug oder eine Kennung.
DYNAMIC_ROOTS = frozenset({
    "news", "events", "tournaments", "teams", "u", "players", "members", "galerie", "gallery", "fastlap", "f1",
    "seasons", "servers", "references", "sponsors", "partners", "messages", "leagues", "liga", "matches", "karte",
})
STATIC_PATHS = frozenset({
    "/members/area", "/members/benefits", "/members/documents", "/members/news", "/members/membership",
    "/tournaments/new", "/events/new", "/news/new",
})
# Ab dem dritten Teil bleibt nur, was sicher ein fester Teil einer Seite ist; alles andere wird ``:param``.
STATIC_TAILS = frozenset({
    "bracket", "matches", "standings", "regeln", "spieltage", "teams", "anmelden", "edit", "new", "settings", "results",
    "runde", "print", "tv", "live", "chat", "members", "roster", "proof", "checkin", "veto", "history", "stats",
})
PLACEHOLDERS = frozenset({":id", ":slug", ":param"})


def _keep(value: object, allowed: set[str], limit: int) -> str:
    return "".join(char for char in str(value or "") if char in allowed)[:limit]


def clean_error_type(value: object) -> str:
    """Die Fehlerart (``TypeError``, ``HTTP 500``) - nur Zeichen eines Namens, gekürzt."""
    text = " ".join(_keep(value, _TYPE_CHARS, TYPE_LIMIT * 2).split())[:TYPE_LIMIT]
    return text or "Error"


def clean_version(value: object) -> str:
    return _keep(value, _VERSION_CHARS, VERSION_LIMIT)


def _code_file(location: str) -> str | None:
    """Aus ``https://host/assets/index-AbC123.js?x=1`` wird ``index.js``; kein Code - ``None``."""
    path = location.split("?", 1)[0].split("#", 1)[0]
    base = path.replace("\\", "/").rsplit("/", 1)[-1]
    base = _keep(base, _FILE_CHARS, FILE_LIMIT)
    if not base.lower().endswith(CODE_EXTENSIONS):
        return None
    stem, dot, extension = base.rpartition(".")
    # Vite hängt einen Hash an (``TeamPage-AbC12_x9.js``) - ohne ihn fallen gleiche Fehler über Deploys zusammen.
    head, dash, tail = stem.rpartition("-")
    if dash and head and len(tail) == 8:
        stem = head
    return f"{stem}{dot}{extension}"


def _frame_name(raw: str) -> str:
    """Der Funktionsname vor der Stelle - nur, wenn er wie ein Bezeichner aussieht (``async Foo.bar``, ``new X``)."""
    text = " ".join(raw.split())
    if not text or ":" in text or len(text.split(" ")) > 2:
        return ""
    return _keep(text.split(" ")[-1], _IDENT, NAME_LIMIT)


def _client_frame(line: str) -> str | None:
    text = line.strip()
    if text.startswith("at "):
        text = text[3:].strip()
    elif text.startswith("in ") and " " not in text[3:].strip():
        component = _keep(text[3:], _IDENT, NAME_LIMIT)
        return f"in {component}" if component else None
    name = ""
    location = text
    if text.endswith(")") and "(" in text:
        cut = text.rfind("(")
        name, location = text[:cut], text[cut + 1:-1]
    elif "@" in text:
        name, location = text.rsplit("@", 1)
    parts = location.rsplit(":", 2)
    if len(parts) == 3 and parts[1].isdigit() and parts[2].isdigit():
        place = f"{parts[1][:7]}:{parts[2][:7]}"
        file_part = parts[0]
    elif len(parts) >= 2 and parts[-1].isdigit():
        place = parts[-1][:7]
        file_part = location.rsplit(":", 1)[0]
    else:
        return None
    file_name = _code_file(file_part)
    if not file_name:
        return None
    clean_name = _frame_name(name)
    return f"{clean_name} ({file_name}:{place})" if clean_name else f"{file_name}:{place}"


def client_frames(stack: object) -> str:
    """Nur die Code-Stellen eines Browser- oder App-Stacks, höchstens ``FRAME_LIMIT``."""
    frames: list[str] = []
    for line in str(stack or "").splitlines()[:LINE_SCAN_LIMIT]:
        frame = _client_frame(line[:2000])
        if frame:
            frames.append(frame)
            if len(frames) >= FRAME_LIMIT:
                break
    return "\n".join(frames)


def _relative_file(filename: str) -> str:
    path = Path(filename or "")
    try:
        return path.resolve().relative_to(BACKEND_DIR).as_posix()
    except (ValueError, OSError):
        pass
    posix = path.as_posix()
    if "site-packages/" in posix:
        return "site-packages/" + posix.split("site-packages/", 1)[1]
    return os.path.basename(posix)


def server_frames(exc: BaseException) -> str:
    """Datei, Zeile und Funktion je Stufe des Tracebacks - ohne Quelltext und ohne Meldung."""
    frames = traceback.extract_tb(exc.__traceback__)[-FRAME_LIMIT:]
    return "\n".join(f"{_relative_file(frame.filename)}:{frame.lineno} in {_keep(frame.name, _IDENT, NAME_LIMIT)}" for frame in frames)


def _looks_like_id(segment: str) -> bool:
    return any(char.isdigit() for char in segment) or len(segment) > 32


def client_route(value: object) -> str:
    """Die Seite als Vorlage (``/news/:slug``), ohne Abfrage, Anker, Kennungen und Namen."""
    path = str(value or "/").split("?", 1)[0].split("#", 1)[0]
    segments = [segment for segment in path.split("/") if segment][:12]
    plain = "/" + "/".join(segments)
    if not segments:
        return "/"
    if plain in STATIC_PATHS:
        return plain
    out: list[str] = []
    for index, segment in enumerate(segments):
        if segment in PLACEHOLDERS:
            out.append(segment)
        elif index == 0:
            out.append(segment if not _looks_like_id(segment) and set(segment) <= _SEGMENT_CHARS else ":id")
        elif index == 1 and segments[0] == "admin":
            out.append(segment if set(segment) <= _SEGMENT_CHARS else ":param")
        elif index == 1 and segments[0] in DYNAMIC_ROOTS:
            out.append(":slug")
        elif _looks_like_id(segment):
            out.append(":id")
        elif index == 1 and set(segment) <= _SEGMENT_CHARS and len(segment) <= 24:
            out.append(segment)
        else:
            out.append(segment if segment in STATIC_TAILS else ":param")
    return ("/" + "/".join(out))[:ROUTE_LIMIT]


def server_route_fallback(path: str) -> str:
    """Ein Pfad ohne passende Route: jeder Teil mit Ziffern wird ``{id}`` (Kennungen, Zahlen, IP-Adressen)."""
    segments = str(path or "/").split("?", 1)[0].split("/")
    masked = ["{id}" if any(char.isdigit() for char in segment) or len(segment) > 40 else segment for segment in segments]
    return "/".join(masked)[:200] or "/"
